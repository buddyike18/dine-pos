import React, { useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import { getIdToken, getCurrentActor, StaffRole } from '../../../src/lib/firebase';
import {
  checkBackendReachable,
  classifyApiError,
  updateOrderStatus,
} from '../../../src/lib/api';
import { config } from '../../../src/config';
import { fetchWithTimeout } from '../../../src/lib/network';

type OrderStatus = 'SENT' | 'READY' | 'COMPLETED';

type OrderItem = {
  name?: string;
  menu_item_name?: string;
  quantity?: number;
  qty?: number;
};

type Order = {
  id: string;
  status: OrderStatus;
  items: OrderItem[];
  total_cents?: number;
  total_price?: number;
  created_at?: string;
};

function formatMoneyFromOrder(o: Order) {
  if (typeof o.total_cents === 'number') return `$${(o.total_cents / 100).toFixed(2)}`;
  if (typeof o.total_price === 'number') return `$${o.total_price.toFixed(2)}`;
  return '—';
}

function shortId(id: string) {
  if (!id) return '';
  return id.replace(/-/g, '').slice(-6).toUpperCase();
}

function mapBackendStatusToPosStatus(status: string): OrderStatus | null {
  const s = (status || '').toUpperCase();
  if (s === 'READY') return 'READY';
  if (s === 'CLOSED') return 'COMPLETED';
  if (s === 'COMPLETED' || s === 'COMPLETE') return 'COMPLETED';
  if (s === 'OPEN') return 'SENT';
  if (s === 'SENT') return 'SENT';
  if (s === 'CANCELLED') return null;
  return 'SENT';
}

function normalizeOrder(raw: any): Order | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id : null;
  if (!id) return null;

  const status = mapBackendStatusToPosStatus(raw.status || raw.state || '');
  if (!status) return null;

  const items: OrderItem[] = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.line_items)
    ? raw.line_items
    : [];

  return {
    id,
    status,
    items,
    total_cents: typeof raw.total_cents === 'number' ? raw.total_cents : undefined,
    total_price: typeof raw.total_price === 'number' ? raw.total_price : undefined,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
  };
}

function showLoadError(
    e: unknown,
    setKind?: (k: 'network' | 'auth' | 'permission' | null) => void,
    setMsg?: (m: string) => void
  ) {
    const kind = classifyApiError(e);
  
    if (kind === 'network') {
      setKind?.('network');
      setMsg?.('Backend unreachable. Check network or server IP.');
      return;
    }
    if (kind === 'auth') {
      setKind?.('auth');
      setMsg?.('Please sign in again.');
      return;
    }
    if (kind === 'permission') {
      setKind?.('permission');
      setMsg?.('Your account is not allowed to view orders.');
      return;
    }
  
    Alert.alert('Orders failed to load', (e as any)?.message || 'Unknown error');
}

function showActionError(e: unknown) {
  const kind = classifyApiError(e);
  if (kind === 'network') {
    Alert.alert('Offline', 'Backend unreachable. Action not sent.');
    return;
  }
  if (kind === 'auth') {
    Alert.alert('Not signed in', 'Please sign in again.');
    return;
  }
  if (kind === 'permission') {
    Alert.alert('No permission', 'Your account is not allowed to update orders.');
    return;
  }
  if (kind === 'conflict') {
    Alert.alert('Invalid transition', (e as any)?.message || 'Order cannot transition to that status.');
    return;
  }
  Alert.alert('Failed to update order status', (e as any)?.message || 'Unknown error');
}

// Helper: load orders by status from POS-safe endpoint
async function listOrdersByStatus(opts: { token: string; apiBaseUrl: string; status: string }) {
  const { token, apiBaseUrl, status } = opts;
  if (!apiBaseUrl) {
    const err: any = new Error('Missing API base URL');
    err.status = 400;
    throw err;
  }

  const url = `${apiBaseUrl.replace(/\/$/, '')}/api/orders/status/${encodeURIComponent(status)}`;
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      msg = j?.error || j?.message || msg;
    } catch {
      // ignore
    }
    const err: any = new Error(msg);
    err.status = res.status;
    throw err;
  }

  const j = await res.json();
  // Backend returns `{ filtered: rows }`
  return Array.isArray(j?.filtered) ? j.filtered : [];
}

export default function OrdersScreen() {
  const apiBaseUrl = config.api.baseUrl;

  const [role, setRole] = useState<StaffRole | 'Unknown'>('Unknown');

  // POS must not behave like a kitchen screen. Status actions are manager-scope only.
  const canAct = role === 'Owner' || role === 'Manager';

  const [queueTab, setQueueTab] = useState<OrderStatus>('SENT');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inFlightIds, setInFlightIds] = useState<Set<string>>(new Set());
  const [isOnline, setIsOnline] = useState(true);
  const [loadErrorKind, setLoadErrorKind] = useState<
    'network' | 'auth' | 'permission' | 'missing_api' | null
  >(null);
  const [loadErrorMsg, setLoadErrorMsg] = useState<string>('');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadInFlightRef = useRef(false);
  const refreshingRef = useRef(false);

  const sentOrders = useMemo(() => orders.filter((o) => o.status === 'SENT'), [orders]);
  const readyOrders = useMemo(() => orders.filter((o) => o.status === 'READY'), [orders]);
  const completedOrders = useMemo(() => orders.filter((o) => o.status === 'COMPLETED'), [orders]);

  const current =
    queueTab === 'SENT' ? sentOrders : queueTab === 'READY' ? readyOrders : completedOrders;

  async function loadQueues(showSpinner: boolean) {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    try {
      if (!apiBaseUrl) {
        setLoadErrorKind('missing_api');
        setLoadErrorMsg('Set EXPO_PUBLIC_API_BASE_URL in dine-pos/.env');
        setLoading(false);
        return;
      }

      // Reachability check: used to disable actions and avoid misleading optimistic updates.
      const reachable = await checkBackendReachable({ timeoutMs: 2000 });
      setIsOnline(reachable);

      if (!reachable) {
        setLoadErrorKind('network');
        setLoadErrorMsg('Backend unreachable. Check network or server IP.');
        if (showSpinner) setLoading(false);
        return;
      } else {
        // Clear prior load banners once online again (poll callback can have stale closures).
        setLoadErrorKind(null);
        setLoadErrorMsg('');
      }

      const token = await getIdToken();
      if (!token) {
        setLoadErrorKind('auth');
        setLoadErrorMsg('Please sign in again.');
        setLoading(false);
        return;
      }

      if (showSpinner) setLoading(true);

      try {
        // SENT tab should include both OPEN and SENT
        // READY tab uses READY
        // COMPLETED tab uses CLOSED
        const [openData, sentData, readyData, closedData] = await Promise.all([
          listOrdersByStatus({ token, apiBaseUrl, status: 'OPEN' }),
          listOrdersByStatus({ token, apiBaseUrl, status: 'SENT' }),
          listOrdersByStatus({ token, apiBaseUrl, status: 'READY' }),
          listOrdersByStatus({ token, apiBaseUrl, status: 'CLOSED' }),
        ]);

        const allRaw = [...openData, ...sentData, ...readyData, ...closedData];
        const allOrders: Order[] = allRaw
          .map(normalizeOrder)
          .filter((o): o is Order => o !== null);

        // Deduplicate by id (OPEN+SENT often overlap depending on backend semantics)
        const byId = new Map<string, Order>();
        for (const o of allOrders) byId.set(o.id, o);

        // Clear prior load banners on successful load.
        if (loadErrorKind) {
          setLoadErrorKind(null);
          setLoadErrorMsg('');
        }

        setOrders(Array.from(byId.values()));
      } catch (e) {
        showLoadError(e, (k) => setLoadErrorKind(k), (m) => setLoadErrorMsg(m));
      } finally {
        if (showSpinner) setLoading(false);
      }
    } finally {
      loadInFlightRef.current = false;
    }
  }

  useEffect(() => {
    void loadQueues(true);

    // Phase 6.3: load role on mount
    void (async () => {
      try {
        const r = (await getCurrentActor())?.role ?? 'Unknown';
        setRole(r);
      } catch {
        setRole('Unknown');
      }
    })();

    // Phase 6.3: keep polling, but disable actions when offline.
    pollRef.current = setInterval(() => {
      if (refreshingRef.current) return;
      void loadQueues(false);
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRefresh() {
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      try {
        const r = (await getCurrentActor())?.role ?? 'Unknown';
        setRole(r);
      } catch {
        setRole('Unknown');
      }
      await loadQueues(false);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  async function handleStatusUpdate(order: Order) {
    // Phase 6.3: Enforce read-only at action time.
    if (!canAct) {
      Alert.alert('Read-only', 'Your role does not allow updating orders.');
      return;
    }
    // Safeguard: never allow actions when offline.
    if (!isOnline) {
      Alert.alert('Offline', 'Actions are disabled while offline.');
      return;
    }

    if (inFlightIds.has(order.id)) return;

    let newStatusBackend: 'READY' | 'CLOSED' | null = null;
    let newStatusPos: OrderStatus | null = null;

    if (order.status === 'SENT') {
      newStatusBackend = 'READY';
      newStatusPos = 'READY';
    } else if (order.status === 'READY') {
      newStatusBackend = 'CLOSED';
      newStatusPos = 'COMPLETED';
    } else {
      return;
    }

    setInFlightIds((prev) => new Set(prev).add(order.id));

    // Optimistic update: move order to new status (only when online)
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: newStatusPos! } : o)));

    try {
      const token = await getIdToken();
      if (!token) {
        const err: any = new Error('Not signed in');
        err.status = 401;
        throw err;
      }

      await updateOrderStatus({
        token,
        orderId: order.id,
        status: newStatusBackend,
      });
      // Phase 6.8: sync with server truth after successful mutation.
      await loadQueues(false);
    } catch (e) {
      // Rollback optimistic update on failure
      setOrders((prev) => prev.map((o) => (o.id === order.id ? order : o)));
      showActionError(e);
    } finally {
      setInFlightIds((prev) => {
        const copy = new Set(prev);
        copy.delete(order.id);
        return copy;
      });
    }
  }

  function renderActionButton(o: Order) {
    const disabled = inFlightIds.has(o.id) || !isOnline || !canAct;

    if (o.status === 'SENT') {
      return (
        <TouchableOpacity
          onPress={() => handleStatusUpdate(o)}
          disabled={disabled}
          style={[styles.actionBtn, disabled && styles.actionBtnDisabled]}
          accessibilityLabel={`Mark order #${shortId(o.id)} as Ready`}
        >
          <Text style={[styles.actionBtnText, disabled && styles.actionBtnTextDisabled]}>
            Mark Ready
          </Text>
        </TouchableOpacity>
      );
    }

    if (o.status === 'READY') {
      return (
        <TouchableOpacity
          onPress={() => handleStatusUpdate(o)}
          disabled={disabled}
          style={[styles.actionBtn, disabled && styles.actionBtnDisabled]}
          accessibilityLabel={`Mark order #${shortId(o.id)} as Completed`}
        >
          <Text style={[styles.actionBtnText, disabled && styles.actionBtnTextDisabled]}>
            Mark Completed
          </Text>
        </TouchableOpacity>
      );
    }

    return null;
  }

  function renderOrder(o: Order) {
    const lines = (o.items || []).slice(0, 4).map((it) => {
      const qty = it.quantity ?? it.qty ?? 1;
      const name = it.name ?? it.menu_item_name ?? 'Item';
      return `${qty}× ${name}`;
    });

    const extra = (o.items?.length || 0) - lines.length;

    return (
      <Pressable
        onPress={() => router.push(`/(tabs)/orders/${o.id}`)}
        style={({ pressed }) => [styles.orderCard, pressed && styles.orderCardPressed]}
        accessibilityRole="button"
        accessibilityLabel={`Open order #${shortId(o.id)} details`}
      >
        <View style={styles.orderTopRow}>
          <Text style={styles.orderId}>#{shortId(o.id)}</Text>
          <Text style={styles.orderTotal}>{formatMoneyFromOrder(o)}</Text>
        </View>

        <Text style={styles.orderStatus}>{o.status}</Text>

        <View style={{ marginTop: 10, gap: 4 }}>
          {lines.map((t, idx) => (
            <Text key={`${o.id}:${idx}`} style={styles.itemLine}>
              {t}
            </Text>
          ))}
          {extra > 0 ? <Text style={styles.itemLine}>+ {extra} more</Text> : null}
        </View>

        <View style={{ marginTop: 12 }}>{renderActionButton(o)}</View>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Orders</Text>
          <Text style={styles.subtitle}>Live view of orders in your allowed scope.</Text>
        </View>

        {loadErrorKind === 'missing_api' ? (
          <View style={styles.alertBanner}>
            <Text style={styles.alertTitle}>Missing API config</Text>
            <Text style={styles.alertText}>
              {loadErrorMsg || 'Set EXPO_PUBLIC_API_BASE_URL in dine-pos/.env'}
            </Text>
          </View>
        ) : loadErrorKind === 'auth' ? (
          <View style={styles.alertBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Not signed in</Text>
              <Text style={styles.alertText}>{loadErrorMsg || 'Please sign in again.'}</Text>
            </View>
            <Pressable onPress={() => router.push('/(tabs)/settings')} style={styles.alertBtn}>
              <Text style={styles.alertBtnText}>Go to Settings</Text>
            </Pressable>
          </View>
        ) : loadErrorKind === 'permission' ? (
          <View style={styles.alertBanner}>
            <Text style={styles.alertTitle}>No permission</Text>
            <Text style={styles.alertText}>
              {loadErrorMsg || 'Your account is not allowed to view orders.'}
            </Text>
          </View>
        ) : !isOnline ? (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>Offline — actions disabled</Text>
          </View>
        ) : !canAct ? (
          <View style={styles.readOnlyBanner}>
            <Text style={styles.readOnlyText}>Read-only — insufficient role ({role})</Text>
          </View>
        ) : null}

        <View style={styles.tabRow}>
          <Pressable
            onPress={() => setQueueTab('SENT')}
            style={[styles.tabBtn, queueTab === 'SENT' && styles.tabBtnActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: queueTab === 'SENT' }}
          >
            <Text style={[styles.tabText, queueTab === 'SENT' && styles.tabTextActive]}>
              {`SENT (${sentOrders.length})`}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setQueueTab('READY')}
            style={[styles.tabBtn, queueTab === 'READY' && styles.tabBtnActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: queueTab === 'READY' }}
          >
            <Text style={[styles.tabText, queueTab === 'READY' && styles.tabTextActive]}>
              {`READY (${readyOrders.length})`}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setQueueTab('COMPLETED')}
            style={[styles.tabBtn, queueTab === 'COMPLETED' && styles.tabBtnActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: queueTab === 'COMPLETED' }}
          >
            <Text style={[styles.tabText, queueTab === 'COMPLETED' && styles.tabTextActive]}>
              {`COMPLETED (${completedOrders.length})`}
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>Loading orders…</Text>
          </View>
        ) : (
          <FlatList
            data={current}
            keyExtractor={(o) => o.id}
            renderItem={({ item }) => renderOrder(item)}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>No orders</Text>
                <Text style={styles.emptyText}>Create an order in “New Order” to validate end-to-end flow.</Text>
              </View>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111111',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 16,
    color: '#666666',
  },
  offlineBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#111111',
    backgroundColor: '#FFFFFF',
  },
  offlineText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#111111',
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  readOnlyBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#111111',
    backgroundColor: '#FFFFFF',
  },
  readOnlyText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#111111',
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  alertBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#111111',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  alertTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#111111',
    letterSpacing: 0.4,
  },
  alertText: {
    marginTop: 2,
    fontSize: 13,
    color: '#333333',
  },
  alertBtn: {
    borderWidth: 1,
    borderColor: '#111111',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  alertBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#111111',
  },
  tabRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  tabBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  tabBtnActive: {
    backgroundColor: '#111111',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#111111',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  sep: {
    height: 12,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111111',
  },
  emptyWrap: {
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111111',
  },
  emptyText: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
  },
  orderCard: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 14,
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  orderCardPressed: {
    opacity: 0.92,
  },
  orderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  orderId: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111111',
  },
  orderTotal: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111111',
  },
  orderStatus: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '900',
    color: '#666666',
    letterSpacing: 0.6,
  },
  itemLine: {
    fontSize: 14,
    color: '#111111',
  },
  actionBtn: {
    backgroundColor: '#111111',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  actionBtnDisabled: {
    backgroundColor: '#999999',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  actionBtnTextDisabled: {
    color: '#DDDDDD',
  },
});
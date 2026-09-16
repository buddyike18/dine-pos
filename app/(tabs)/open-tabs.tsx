import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  listActiveOrders,
  type BackendOrder,
} from '../../src/lib/api';
import { getIdToken } from '../../src/lib/firebase';

type OrderContext = 'BAR' | 'TABLE' | 'QUICK';

function classifyOrder(order: BackendOrder): OrderContext {
  if (order.check_id) return 'BAR';
  if (order.table_id) return 'TABLE';
  return 'QUICK';
}

function shortOrderId(orderId: string): string {
  return orderId.replace(/-/g, '').slice(-6).toUpperCase();
}

function formatMoney(cents?: number): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) {
    return '—';
  }

  return `$${(cents / 100).toFixed(2)}`;
}

function itemCount(order: BackendOrder): number {
  const items = Array.isArray(order.items)
    ? order.items
    : Array.isArray(order.line_items)
      ? order.line_items
      : [];

  return items.reduce((total, item) => {
    const quantity =
      typeof item?.quantity === 'number' && Number.isFinite(item.quantity)
        ? item.quantity
        : 1;

    return total + Math.max(0, quantity);
  }, 0);
}

function contextLabel(order: BackendOrder): string {
  const context = classifyOrder(order);

  if (context === 'TABLE') {
    return order.table_id ? `Table ${order.table_id}` : 'Table';
  }

  if (context === 'BAR') {
    return 'Bar';
  }

  return 'Quick Order';
}

function paymentLabel(order: BackendOrder): string | null {
  if (typeof order.payment_status === 'string' && order.payment_status.trim()) {
    return order.payment_status.trim().replace(/_/g, ' ');
  }

  if (order.is_paid === true) return 'Paid';

  if (
    typeof order.balance_cents === 'number' &&
    Number.isFinite(order.balance_cents)
  ) {
    return order.balance_cents <= 0 ? 'Paid' : 'Payment due';
  }

  return null;
}

export default function OpenTabsScreen() {
  const router = useRouter();

  const [orders, setOrders] = useState<BackendOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async (mode: 'load' | 'refresh' = 'load') => {
    if (mode === 'refresh') {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const token = await getIdToken();

      if (!token) {
        throw new Error('Authentication required.');
      }

      const activeOrders = await listActiveOrders({ token });

      // Authorization is backend-authoritative. Render exactly what /orders/active returns.
      setOrders(activeOrders);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to load open tabs.';

      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadOrders('load');
    }, [loadOrders])
  );

  if (loading && orders.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.secondaryText}>Loading open tabs...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void loadOrders('refresh')}
        />
      }
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>

        <View style={styles.headerText}>
          <Text style={styles.title}>Open Tabs</Text>
          <Text style={styles.subtitle}>Active orders available to you</Text>
        </View>

        <Pressable
          onPress={() => void loadOrders('refresh')}
          disabled={refreshing}
          style={styles.refreshButton}
        >
          <Text style={styles.refreshButtonText}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Text>
        </Pressable>
      </View>

      {error ? (
        <View style={styles.messageCard}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={() => void loadOrders('load')}
            style={styles.retryButton}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </Pressable>
        </View>
      ) : null}

      {!error && orders.length === 0 ? (
        <View style={styles.messageCard}>
          <Text style={styles.emptyTitle}>No open tabs</Text>
          <Text style={styles.secondaryText}>
            There are no active orders available to this account.
          </Text>
        </View>
      ) : null}

      {orders.map((order) => {
        const count = itemCount(order);
        const payment = paymentLabel(order);

        return (
          <Pressable
            key={order.id}
            onPress={() =>
              router.push({
                pathname: '/orders/[orderId]',
                params: { orderId: order.id },
              })
            }
            style={({ pressed }) => [
              styles.orderCard,
              pressed ? styles.orderCardPressed : null,
            ]}
          >
            <View style={styles.rowTop}>
              <View>
                <Text style={styles.context}>{contextLabel(order)}</Text>
                <Text style={styles.orderId}>
                  Order #{shortOrderId(order.id)}
                </Text>
              </View>

              <Text style={styles.status}>
                {String(order.status ?? '').replace(/_/g, ' ')}
              </Text>
            </View>

            <View style={styles.metadataRow}>
              <Text style={styles.metadata}>
                {count} {count === 1 ? 'item' : 'items'}
              </Text>

              <Text style={styles.metadata}>
                {formatMoney(order.total_cents)}
              </Text>

              {payment ? (
                <Text style={styles.metadata}>{payment}</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    padding: 20,
    paddingTop: 54,
    gap: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 14,
    color: '#666',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#e7e7e7',
  },
  backButtonText: {
    fontWeight: '600',
    color: '#111',
  },
  refreshButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#111',
  },
  refreshButtonText: {
    fontWeight: '600',
    color: '#fff',
  },
  orderCard: {
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d8d8d8',
  },
  orderCardPressed: {
    opacity: 0.7,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  context: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111',
  },
  orderId: {
    marginTop: 3,
    fontSize: 13,
    color: '#666',
  },
  status: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    textTransform: 'uppercase',
  },
  metadataRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 14,
  },
  metadata: {
    fontSize: 14,
    color: '#444',
    textTransform: 'capitalize',
  },
  messageCard: {
    padding: 18,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d8d8d8',
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111',
  },
  secondaryText: {
    fontSize: 14,
    color: '#666',
  },
  errorText: {
    fontSize: 14,
    color: '#9b1c1c',
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#111',
  },
  retryButtonText: {
    fontWeight: '600',
    color: '#fff',
  },
});

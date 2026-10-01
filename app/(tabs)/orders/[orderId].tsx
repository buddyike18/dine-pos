import { useCallback, useEffect, useState } from 'react';
import { Alert, View, Text, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useStripe } from '@stripe/stripe-react-native';

import { OpenTabDetailShell } from '../../../src/features/open-tabs/OpenTabDetailShell';
import {
  createPaymentIntent,
  getOrderById,
  getOrderEvents,
} from '../../../src/lib/api';
import { getCurrentActor, getIdToken } from '../../../src/lib/firebase';

type OrderItemModifier = {
  id?: string;
  group_id?: string | null;
  option_id?: string | null;
  group_name?: string;
  option_name?: string;
  price_delta_cents?: number;
  quantity?: number;
  group_name_snapshot?: string;
  option_name_snapshot?: string;
  price_delta_cents_snapshot?: number;
};

type OrderItem = {
  id?: string;
  name?: string;
  menu_item_name?: string;
  qty?: number;
  quantity?: number;
  price_cents?: number;
  unit_price_cents?: number;
  modifiers?: OrderItemModifier[];
};

type Order = {
  id: string;
  status: string;
  items: OrderItem[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents?: number;
  comped_cents?: number;
  payment_method?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
  sent_at?: string | null;
  ready_at?: string | null;
};

type OrderEvent = {
  id?: string;
  event_type?: string;
  from_status?: string | null;
  to_status?: string | null;
  actor_role?: string | null;
  actor_user_id?: string | null;
  actor_firebase_uid?: string | null;
  meta?: any;
  created_at?: string | null;
};

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function titleCase(input: string) {
  const s = (input || '').toString().trim();
  if (!s) return '—';
  return s
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatPaymentMethod(method?: string | null) {
  const m = (method || '').toString().trim().toLowerCase();
  if (!m) return '—';
  if (m === 'card' || m === 'credit' || m === 'credit_card') return 'Card';
  if (m === 'cash') return 'Cash';
  if (m === 'comp' || m === 'complimentary') return 'Comp';
  return titleCase(m);
}

function formatDateTime(value?: string | null) {
  const v = (value || '').toString().trim();
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v; // fall back to raw if not ISO
  return d.toLocaleString();
}

const QUICK_SETTLEMENT_POLL_ATTEMPTS = 12;
const QUICK_SETTLEMENT_POLL_DELAY_MS = 500;

function waitForQuickSettlement(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isSettledQuickOrder(order: Order) {
  const totalCents = Number(order.total_cents ?? 0);
  const paidCents = Number(order.paid_cents ?? 0);
  const compedCents = Number(order.comped_cents ?? 0);

  return (
    order.status === 'SENT' &&
    paidCents + compedCents >= totalCents
  );
}

export default function OrderDetailsScreen() {
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const params = useLocalSearchParams<{ orderId?: string | string[] }>();
  const orderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId;
  const normalizedOrderId = typeof orderId === 'string' ? orderId.trim() : '';
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uiRole, setUiRole] = useState<'Manager' | 'Employee' | 'unknown'>('unknown');
  const [roleLoading, setRoleLoading] = useState(true);
  const [paymentRunning, setPaymentRunning] = useState(false);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);

  const [events, setEvents] = useState<OrderEvent[] | null>(null);
  const [eventsForbidden, setEventsForbidden] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        if (mounted) {
          setLoading(true);
          setError(null);
          setUiRole('unknown');
          setRoleLoading(true);
          // Reset event state so we never render stale manager events after account/route changes.
          setEvents(null);
          setEventsForbidden(false);
          setEventsError(null);
          setEventsLoading(false);
        }
        if (!normalizedOrderId) {
          throw new Error('Invalid order id');
        }

        const token = await getIdToken();
        if (!token) throw new Error('Not signed in');

        const data = await getOrderById(normalizedOrderId, token);

        let resolvedRole: 'Manager' | 'Employee' | 'unknown' = 'unknown';
        try {
          const actor = await getCurrentActor();
          console.log('[QUICK_ACTOR_AUDIT]', {
            firebaseUid: actor?.firebaseUid ?? null,
            role: actor?.role ?? null,
          });
          if (actor?.role === 'Manager' || actor?.role === 'Employee') {
            resolvedRole = actor.role;
          }
        } catch {
          resolvedRole = 'unknown';
        }

        if (mounted) {
          setOrder(data);
          setUiRole(resolvedRole);
          setRoleLoading(false);
          setLoading(false);
          setEventsLoading(true);
        }

        // Phase 7.3: Manager-only, read-only event history (backend-authoritative).
        try {
          const ev = await getOrderEvents(normalizedOrderId, token);
          if (mounted) {
            setEvents(Array.isArray(ev) ? ev : []);
            setEventsForbidden(false);
            setEventsError(null);
          }
        } catch (ee: any) {
          const status = ee?.status;
          const msg = ee?.message || '';
          const isForbidden = status === 403 || /forbidden/i.test(msg) || /permission/i.test(msg);
          if (mounted) {
            setEvents(null);
            setEventsForbidden(isForbidden);
            setEventsError(isForbidden ? null : msg || 'Failed to load events');
          }
        } finally {
          if (mounted) {
            setEventsLoading(false);
          }
        }
      } catch (e: any) {
        if (mounted) {
          setError(e?.message || 'Failed to load order');
          setLoading(false);
          setRoleLoading(false);
          setEventsLoading(false);
        }
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [normalizedOrderId]);

  const refreshQuickOrder = useCallback(
    async (targetOrderId: string, token: string) => {
      const refreshedOrder = await getOrderById(targetOrderId, token);
      setOrder(refreshedOrder);
      return refreshedOrder;
    },
    []
  );

  const confirmQuickSettlement = useCallback(
    async (targetOrderId: string, token: string) => {
      for (
        let attempt = 0;
        attempt < QUICK_SETTLEMENT_POLL_ATTEMPTS;
        attempt += 1
      ) {
        const refreshedOrder = await getOrderById(targetOrderId, token);

        if (isSettledQuickOrder(refreshedOrder)) {
          setOrder(refreshedOrder);
          setPaymentSubmitted(false);
          return true;
        }

        if (attempt < QUICK_SETTLEMENT_POLL_ATTEMPTS - 1) {
          await waitForQuickSettlement(QUICK_SETTLEMENT_POLL_DELAY_MS);
        }
      }

      return false;
    },
    []
  );

  const checkQuickPaymentStatus = useCallback(async () => {
    if (paymentRunning || !order) return;

    setPaymentRunning(true);

    try {
      const token = await getIdToken(true);

      if (!token) {
        throw new Error('Authentication required to check Quick Order payment.');
      }

      const refreshedOrder = await refreshQuickOrder(order.id, token);

      if (isSettledQuickOrder(refreshedOrder)) {
        setPaymentSubmitted(false);
        return;
      }

      Alert.alert(
        'Payment still processing',
        'Dine has not yet confirmed authoritative settlement. Do not submit another payment.'
      );
    } catch (error) {
      Alert.alert(
        'Unable to Check Payment',
        error instanceof Error
          ? error.message
          : 'Unable to check Quick Order payment.'
      );
    } finally {
      setPaymentRunning(false);
    }
  }, [order, paymentRunning, refreshQuickOrder]);

  const payQuickOrder = useCallback(async () => {
    if (paymentRunning || paymentSubmitted || !order) return;

    setPaymentRunning(true);

    try {
      const token = await getIdToken(true);

      if (!token) {
        throw new Error('Authentication required to pay Quick Order.');
      }

      // Authoritative precheck before creating any payment attempt.
      const currentOrder = await refreshQuickOrder(order.id, token);

      if (isSettledQuickOrder(currentOrder)) {
        setPaymentSubmitted(false);
        return;
      }

      const currentTotalCents = Number(currentOrder.total_cents ?? 0);
      const currentPaidCents = Number(currentOrder.paid_cents ?? 0);
      const currentCompedCents = Number(currentOrder.comped_cents ?? 0);
      const currentOpenBalanceCents = Math.max(
        currentTotalCents - currentPaidCents - currentCompedCents,
        0
      );

      if (currentOpenBalanceCents <= 0) return;

      const paymentIntent = await createPaymentIntent({
        orderId: currentOrder.id,
        idempotencyKey: `pos-quick-order-${currentOrder.id}`,
        token,
      });

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'Dine',
        paymentIntentClientSecret: paymentIntent.clientSecret,
      });

      if (initError) {
        throw new Error(
          initError.message || 'Unable to initialize Quick Order payment.'
        );
      }

      const { error: paymentError } = await presentPaymentSheet();

      if (paymentError) {
        if (
          String(paymentError.code)
            .toLowerCase()
            .includes('cancel')
        ) {
          return;
        }

        throw new Error(
          paymentError.message || 'Unable to complete Quick Order payment.'
        );
      }

      // Stripe accepted submission. Do not expose another charge attempt
      // until authoritative Dine settlement is checked.
      setPaymentSubmitted(true);

      const settled = await confirmQuickSettlement(
        currentOrder.id,
        token
      );

      if (settled) return;

      Alert.alert(
        'Payment submitted',
        'Stripe accepted the payment, but Dine is still waiting for authoritative settlement. Do not submit another payment.'
      );
    } catch (error) {
      Alert.alert(
        'Unable to Pay Quick Order',
        error instanceof Error
          ? error.message
          : 'Unable to complete Quick Order payment.'
      );
    } finally {
      setPaymentRunning(false);
    }
  }, [
    confirmQuickSettlement,
    initPaymentSheet,
    order,
    paymentRunning,
    paymentSubmitted,
    presentPaymentSheet,
    refreshQuickOrder,
  ]);

  if (loading || roleLoading) {
    return (
      <View style={styles.center}>
        <Text>Loading order...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.center}>
        <Text>No order found.</Text>
      </View>
    );
  }

  const totalCents = Number(order.total_cents || 0);
  const paidCents = Number(order.paid_cents || 0);
  const compedCents = Number(order.comped_cents || 0);
  const openBalanceCents = Math.max(totalCents - paidCents - compedCents, 0);
  const paymentState =
    openBalanceCents <= 0
      ? 'Paid'
      : paidCents + compedCents > 0
        ? 'Partial'
        : 'Unpaid';

  return (
    <OpenTabDetailShell
      title={`Order #${order.id.replace(/-/g, '').slice(-6).toUpperCase()}`}
      status={titleCase(order.status)}
      onBack={() => router.back()}
      footer={
        uiRole !== 'Manager' ? (
          <View style={styles.actions}>
            <Pressable
              style={styles.secondaryActionButton}
              onPress={() =>
                router.push({
                  pathname: '/quick-order',
                  params: { existingOrderId: order.id },
                })
              }
            >
              <Text style={styles.secondaryActionButtonText}>Add Order</Text>
            </Pressable>

            {openBalanceCents > 0 ? (
              <Pressable
                style={[
                  styles.primaryButton,
                  paymentRunning && styles.primaryButtonDisabled,
                ]}
                disabled={paymentRunning}
                onPress={
                  paymentSubmitted
                    ? checkQuickPaymentStatus
                    : payQuickOrder
                }
              >
                <Text style={styles.primaryButtonText}>
                  {paymentRunning
                    ? 'Checking...'
                    : paymentSubmitted
                      ? 'Check Payment Status'
                      : `Pay ${formatMoney(openBalanceCents)}`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : undefined
      }
    >
      {uiRole !== 'Manager' ? (
        <>
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Open Balance</Text>
            <Text style={styles.balanceValue}>
              {formatMoney(openBalanceCents)}
            </Text>
          </View>

          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Order Total</Text>
              <Text style={styles.summaryValue}>
                {formatMoney(totalCents)}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Paid</Text>
              <Text style={styles.summaryValue}>
                {formatMoney(paidCents)}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Payment State</Text>
              <Text style={styles.summaryValue}>
                {paymentState}
              </Text>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Order</Text>
            <Text style={styles.sectionCount}>1</Text>
          </View>

          <View style={styles.ordersList}>
            <View style={styles.orderCard}>
              <View style={styles.orderHeader}>
                <View>
                  <Text style={styles.orderReference}>
                    #{order.id.replace(/-/g, '').slice(-6).toUpperCase()}
                  </Text>
                  <Text style={styles.orderStatus}>
                    {titleCase(order.status)}
                  </Text>
                </View>

                <Text style={styles.orderTotal}>
                  {formatMoney(totalCents)}
                </Text>
              </View>

              {order.items.length > 0 ? (
                <View style={styles.itemList}>
                  {order.items.map((it, idx) => {
                    const qty = it.qty ?? it.quantity ?? 1;
                    const name =
                      it.name ?? it.menu_item_name ?? 'Item';
                    const unit =
                      it.price_cents ?? it.unit_price_cents ?? 0;
                    const mods = Array.isArray(it.modifiers)
                      ? it.modifiers
                      : [];

                    return (
                      <View
                        key={it.id ?? `${name}-${idx}`}
                        style={styles.operationalItemBlock}
                      >
                        <View style={styles.itemRow}>
                          <Text
                            numberOfLines={2}
                            style={styles.operationalItemName}
                          >
                            {qty}× {name}
                          </Text>

                          <Text style={styles.itemPrice}>
                            {formatMoney(unit * qty)}
                          </Text>
                        </View>

                        {mods.map((m, modIdx) => {
                          const optionName =
                            m.option_name_snapshot ??
                            m.option_name ??
                            'Modifier';
                          const delta =
                            m.price_delta_cents_snapshot ??
                            m.price_delta_cents ??
                            0;
                          const modQty = m.quantity ?? 1;

                          return (
                            <View
                              key={
                                m.id ??
                                `${optionName}-${modIdx}`
                              }
                              style={styles.operationalModifierRow}
                            >
                              <Text style={styles.operationalModifierText}>
                                {modQty > 1 ? `${modQty}× ` : ''}
                                {optionName}
                              </Text>

                              <Text style={styles.operationalModifierText}>
                                {delta
                                  ? formatMoney(delta * modQty)
                                  : ''}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.noItemsText}>
                  No item detail available.
                </Text>
              )}
            </View>
          </View>

        </>
      ) : (
        <>
      {/* Items */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Items</Text>
        {(Array.isArray(order.items) ? order.items : []).map((item, idx) => {
          const qty = (item.qty ?? item.quantity ?? 1) as number;
          const name = item.name || item.menu_item_name || 'Item';
          const key = item.id ? `item:${item.id}` : `idx:${idx}`;

          const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];

          return (
            <View key={key} style={styles.itemBlock}>
              <View style={styles.row}>
                <Text style={styles.itemName}>
                  {qty}× {name}
                </Text>
              </View>

              {modifiers.map((modifier, modifierIdx) => {
                const modifierQty = modifier.quantity ?? 1;
                const groupName = modifier.group_name || modifier.group_name_snapshot;
                const optionName = modifier.option_name || modifier.option_name_snapshot || 'Modifier';
                const priceDelta =
                  modifier.price_delta_cents ?? modifier.price_delta_cents_snapshot ?? 0;
                const modifierKey =
                  modifier.id ||
                  modifier.option_id ||
                  `${key}:modifier:${modifierIdx}`;

                return (
                  <View key={modifierKey} style={styles.modifierRow}>
                    <Text style={styles.modifierText}>
                      {modifierQty > 1 ? `${modifierQty}× ` : ''}
                      {groupName ? `${groupName}: ` : ''}
                      {optionName}
                    </Text>
                    {priceDelta !== 0 ? (
                      <Text style={styles.modifierPrice}>
                        {priceDelta > 0 ? '+' : '-'}
                        {formatMoney(Math.abs(priceDelta))}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>

      {/* Totals */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Totals</Text>
        <View style={styles.row}>
          <Text>Subtotal</Text>
          <Text>{formatMoney(order.subtotal_cents)}</Text>
        </View>
        <View style={styles.row}>
          <Text>Tax</Text>
          <Text>{formatMoney(order.tax_cents)}</Text>
        </View>
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatMoney(order.total_cents)}</Text>
        </View>
      </View>

      {/* Payment */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Payment</Text>
        <Text>Method: {formatPaymentMethod(order.payment_method)}</Text>
        <Text>Paid at: {formatDateTime(order.paid_at)}</Text>
      </View>

      {/* Timeline */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Timeline</Text>
        <Text>Created: {formatDateTime(order.created_at)}</Text>
        <Text>Sent: {formatDateTime(order.sent_at)}</Text>
        <Text>Ready: {formatDateTime(order.ready_at)}</Text>
      </View>

      {/* Event History (Manager Only) */}
      {!eventsForbidden ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Event History</Text>
          {eventsLoading ? <Text style={styles.muted}>Loading event history...</Text> : null}
          {eventsError ? <Text style={styles.error}>{eventsError}</Text> : null}
          {!eventsLoading && events && events.length === 0 ? <Text style={styles.muted}>No events.</Text> : null}
          {!eventsLoading && Array.isArray(events) && events.length > 0
            ? events.map((ev, idx) => {
                const key = ev.id ? `ev:${ev.id}` : `ev-idx:${idx}`;
                const when = formatDateTime(ev.created_at);
                const et = titleCase(String(ev.event_type || 'event'));
                const from = ev.from_status ? titleCase(String(ev.from_status)) : '—';
                const to = ev.to_status ? titleCase(String(ev.to_status)) : '—';
                const actor = ev.actor_role ? titleCase(String(ev.actor_role)) : '—';
                const reason = ev?.meta?.reason ? String(ev.meta.reason) : '';

                return (
                  <View key={key} style={styles.eventRow}>
                    <Text style={styles.eventTitle}>{et}</Text>
                    <Text style={styles.eventMeta}>{when}</Text>
                    <Text style={styles.eventMeta}>Actor: {actor}</Text>
                    {(from !== '—' || to !== '—') ? (
                      <Text style={styles.eventMeta}>Status: {from} → {to}</Text>
                    ) : null}
                    {reason ? <Text style={styles.eventMeta}>Reason: {reason}</Text> : null}
                  </View>
                );
              })
            : null}
        </View>
      ) : null}
        </>
      )}
    </OpenTabDetailShell>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    padding: 16,
    gap: 12,
  },
  card: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#FFFFFF',
  },
  orderId: {
    fontSize: 16,
    fontWeight: '900',
  },
  status: {
    marginTop: 4,
    fontSize: 13,
    color: '#555',
  },
  balanceCard: {
    borderWidth: 1,
    borderColor: '#c8bda8',
    borderRadius: 14,
    backgroundColor: '#fffaf2',
    padding: 22,
    marginBottom: 16,
  },
  balanceLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6f675d',
    marginBottom: 6,
  },
  balanceValue: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    color: '#211e1a',
  },
  summaryCard: {
    borderWidth: 1,
    borderColor: '#ddd5c8',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    marginBottom: 24,
  },
  summaryRow: {
    minHeight: 54,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#6f675d',
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#211e1a',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5ded3',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#847b70',
  },
  ordersList: {
    width: '100%',
  },
  orderCard: {
    borderWidth: 1,
    borderColor: '#ddd5c8',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    padding: 18,
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 20,
  },
  orderReference: {
    fontSize: 16,
    fontWeight: '700',
    color: '#211e1a',
  },
  orderStatus: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '600',
    color: '#847b70',
  },
  orderTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: '#211e1a',
  },
  itemList: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5ded3',
  },
  operationalItemBlock: {
    paddingVertical: 4,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 4,
  },
  operationalItemName: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: '#4c463e',
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4c463e',
  },
  operationalModifierRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingLeft: 18,
    paddingVertical: 2,
  },
  operationalModifierText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#847b70',
  },
  noItemsText: {
    marginTop: 12,
    fontSize: 13,
    color: '#847b70',
  },
  actions: {
    marginTop: 28,
    gap: 12,
  },
  secondaryActionButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c8bda8',
    backgroundColor: '#ffffff',
    paddingHorizontal: 20,
  },
  secondaryActionButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#211e1a',
  },
  primaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#211e1a',
    paddingHorizontal: 20,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  sectionTitle: {
    fontWeight: '900',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  itemName: {
    flex: 1,
    marginRight: 8,
  },
  itemBlock: {
    marginBottom: 6,
  },
  modifierRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 16,
    marginBottom: 4,
  },
  modifierText: {
    flex: 1,
    marginRight: 8,
    color: '#666',
    fontSize: 12,
  },
  modifierPrice: {
    color: '#666',
    fontSize: 12,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 8,
    paddingVertical: 4,
    paddingRight: 12,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  totalRow: {
    marginTop: 8,
  },
  totalLabel: {
    fontWeight: '900',
  },
  totalValue: {
    fontWeight: '900',
  },
  error: {
    color: 'red',
  },
  muted: {
    color: '#666',
  },
  eventRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#EEE',
  },
  eventTitle: {
    fontWeight: '900',
    marginBottom: 2,
  },
  eventMeta: {
    color: '#555',
    fontSize: 12,
    marginBottom: 2,
  },
});
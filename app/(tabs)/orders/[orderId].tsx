import { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getOrderById, getOrderEvents } from '../../../src/lib/api';
import { getIdToken } from '../../../src/lib/firebase';

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

export default function OrderDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ orderId?: string | string[] }>();
  const orderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId;
  const normalizedOrderId = typeof orderId === 'string' ? orderId.trim() : '';
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

        if (mounted) {
          setOrder(data);
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
          setEventsLoading(false);
        }
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [normalizedOrderId]);

  if (loading) {
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Header */}
      <View style={styles.card}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.orderId}>Order #{order.id.replace(/-/g, '').slice(-6).toUpperCase()}</Text>
        <Text style={styles.status}>{titleCase(order.status)}</Text>
      </View>

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
    </ScrollView>
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
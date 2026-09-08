import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  BarCheck,
  listBarChecks,
} from '../../src/lib/api';
import { getIdToken } from '../../src/lib/firebase';

export default function BarOpenTabsScreen() {
  const router = useRouter();

  const [checks, setChecks] = useState<BarCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTabs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();


      if (!token) {
        throw new Error('Staff authentication is required.');
      }

      const loaded = await listBarChecks({
        token,
        status: 'OPEN',
      });


      setChecks(
        loaded
          .filter((check) => check.status === 'OPEN')
          .sort((a, b) => {
            const aChair =
              typeof a.chair_number === 'number'
                ? a.chair_number
                : Number.MAX_SAFE_INTEGER;
            const bChair =
              typeof b.chair_number === 'number'
                ? b.chair_number
                : Number.MAX_SAFE_INTEGER;

            if (aChair !== bChair) {
              return aChair - bChair;
            }

            return new Date(a.opened_at).getTime()
              - new Date(b.opened_at).getTime();
          })
      );
    } catch (loadError) {
      console.warn('[bar-tabs] Failed to load open tabs', loadError);

      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load open tabs.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadTabs();
    }, [loadTabs])
  );

  const formatMoney = (cents: number) =>
    `$${(Math.max(0, cents) / 100).toFixed(2)}`;

  const renderTab = (check: BarCheck) => {
    const chairNumber =
      typeof check.chair_number === 'number'
        ? check.chair_number
        : null;

    const seatLabel =
      check.chair_display_name?.trim()
      || (chairNumber !== null ? `Bar ${chairNumber}` : 'Bar');

    const tabName =
      check.display_name?.trim()
      || seatLabel;

    const orderCountLabel =
      `${check.order_count} ${check.order_count === 1 ? 'order' : 'orders'}`;

    const referenceLabel =
      `#${check.id.replace(/-/g, '').slice(-6).toUpperCase()}`;

    return (
      <Pressable
        key={check.id}
        onPress={() => {
          router.push({
            pathname: '/bar/check/[checkId]',
            params: {
              checkId: check.id,
              ...(chairNumber !== null
                ? { chairNumber: String(chairNumber) }
                : {}),
            },
          });
        }}
        style={({ pressed }) => [
          styles.tabRow,
          pressed && styles.tabRowPressed,
        ]}
      >
        <View style={styles.tabRowText}>
          <View style={styles.tabTopLine}>
            <View style={styles.tabIdentity}>
              <Text style={styles.tabPrimary}>{tabName}</Text>
              <Text style={styles.tabSecondary}>
                {seatLabel} • {check.payment_state} • {referenceLabel}
              </Text>
            </View>

            <View style={styles.tabBalance}>
              <Text style={styles.amountOwed}>
                {formatMoney(check.amount_owed_cents)}
              </Text>
              <Text style={styles.balanceLabel}>Open Balance</Text>
              <Text style={styles.tabTotal}>
                Tab total {formatMoney(check.total_cents)}
              </Text>
            </View>
          </View>

          <View style={styles.tabMetaRow}>
            <Text style={styles.tabMetaText}>{orderCountLabel}</Text>
            <Text style={styles.tabMetaText}>
              Paid {formatMoney(check.paid_cents)}
            </Text>
          </View>
        </View>

        <Text style={styles.openAction}>Open</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Open Tabs</Text>
          <Text style={styles.subtitle}>
            {checks.length} open {checks.length === 1 ? 'tab' : 'tabs'}
          </Text>
        </View>

        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
        >
          <Text style={styles.backButtonText}>Back to Bar</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" />
            <Text style={styles.stateText}>Loading open tabs…</Text>
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Text style={styles.stateTitle}>Unable to load open tabs</Text>
            <Text style={styles.stateText}>{error}</Text>

            <Pressable
              onPress={() => void loadTabs()}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.backButtonPressed,
              ]}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : checks.length === 0 ? (
          <View style={styles.centerState}>
            <Text style={styles.stateTitle}>No open tabs</Text>
            <Text style={styles.stateText}>
              Open tabs will appear here after a bar seat starts a check.
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {checks.map(renderTab)}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4efe6',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111111',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#6b6258',
  },
  backButton: {
    backgroundColor: '#111111',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  backButtonPressed: {
    opacity: 0.82,
  },
  backButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  content: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d8cdbd',
    backgroundColor: '#fffaf2',
    overflow: 'hidden',
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  tabRow: {
    minHeight: 76,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d8cdbd',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tabRowPressed: {
    opacity: 0.76,
  },
  tabRowText: {
    flex: 1,
    paddingRight: 18,
  },
  tabTopLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  tabIdentity: {
    flex: 1,
  },
  tabBalance: {
    alignItems: 'flex-end',
  },
  tabPrimary: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  tabSecondary: {
    marginTop: 5,
    fontSize: 13,
    fontWeight: '600',
    color: '#6b6258',
  },
  amountOwed: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111111',
  },
  balanceLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    color: '#6b6258',
  },
  tabTotal: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6258',
  },
  tabMetaRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  tabMetaText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b6258',
  },
  openAction: {
    fontSize: 14,
    fontWeight: '800',
    color: '#4f463b',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  stateTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
    textAlign: 'center',
  },
  stateText: {
    marginTop: 10,
    maxWidth: 420,
    fontSize: 15,
    lineHeight: 21,
    color: '#6b6258',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 18,
    backgroundColor: '#111111',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});

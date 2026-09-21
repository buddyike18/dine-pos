import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import {
  type BackendOrder,
  type BarCheck,
  listActiveOrders,
  listBarChecks,
} from "../../src/lib/api";

import { getIdToken } from "../../src/lib/firebase";

type TableTab = {
  tableId: string;
  tableLabel: string;
  orders: BackendOrder[];
  amountOwedCents: number;
  totalCents: number;
};

type QuickTab = {
  order: BackendOrder;
  amountOwedCents: number;
};

const cents = (value: unknown): number => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 0;

  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
};

const orderAmountOwed = (order: BackendOrder): number =>
  Math.max(
    0,
    cents(order.total_cents)
      - cents(order.paid_cents)
      - cents(order.comped_cents)
  );

const formatMoney = (value: number): string =>
  `$${(Math.max(0, value) / 100).toFixed(2)}`;

const shortRef = (id: string): string =>
  `#${id.replace(/-/g, "").slice(-6).toUpperCase()}`;

const getTableLabel = (order: BackendOrder): string => {
  const raw =
    (order as BackendOrder & {
      table_label?: string | null;
      table_number?: string | number | null;
    }).table_label
    ?? (order as BackendOrder & {
      table_number?: string | number | null;
    }).table_number;

  if (raw !== null && raw !== undefined && String(raw).trim()) {
    const label = String(raw).trim();
    return /^table\b/i.test(label) ? label : `Table ${label}`;
  }

  return `Table ${order.table_id}`;
};

export default function OpenTabsScreen() {
  const router = useRouter();

  const [orders, setOrders] = useState<BackendOrder[]>([]);
  const [barChecks, setBarChecks] = useState<BarCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOpenTabs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();

      if (!token) {
        throw new Error("Staff authentication is required.");
      }

      const [activeOrders, checks] = await Promise.all([
        listActiveOrders({ token }),
        listBarChecks({
          token,
          status: "OPEN",
        }).catch((barError: any) => {
          if (barError?.status === 403) {
            return [];
          }

          throw barError;
        }),
      ]);

      setOrders(activeOrders);
      setBarChecks(
        checks.filter(
          (check) =>
            check.status === "OPEN"
            && cents(check.amount_owed_cents) > 0
        )
      );
    } catch (loadError) {
      console.warn("[open-tabs] Failed to load open tabs", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load open tabs."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadOpenTabs();
    }, [loadOpenTabs])
  );

  const { tableTabs, quickTabs } = useMemo(() => {
    const tableMap = new Map<string, TableTab>();
    const unresolvedQuickTabs: QuickTab[] = [];

    for (const order of orders) {
      // BAR accounting/navigation is check-scoped below.
      if (order.check_id) {
        continue;
      }

      const amountOwedCents = orderAmountOwed(order);

      // Open Tabs is financial, not merely lifecycle-active.
      if (amountOwedCents <= 0) {
        continue;
      }

      if (order.table_id) {
        const tableId = String(order.table_id);
        const existing = tableMap.get(tableId);

        if (existing) {
          existing.orders.push(order);
          existing.amountOwedCents += amountOwedCents;
          existing.totalCents += cents(order.total_cents);
        } else {
          tableMap.set(tableId, {
            tableId,
            tableLabel: getTableLabel(order),
            orders: [order],
            amountOwedCents,
            totalCents: cents(order.total_cents),
          });
        }

        continue;
      }

      unresolvedQuickTabs.push({
        order,
        amountOwedCents,
      });
    }

    return {
      tableTabs: Array.from(tableMap.values()).sort((a, b) =>
        a.tableLabel.localeCompare(b.tableLabel, undefined, {
          numeric: true,
        })
      ),
      quickTabs: unresolvedQuickTabs,
    };
  }, [orders]);

  const openBarChecks = useMemo(
    () =>
      [...barChecks].sort((a, b) => {
        const aChair =
          typeof a.chair_number === "number"
            ? a.chair_number
            : Number.MAX_SAFE_INTEGER;
        const bChair =
          typeof b.chair_number === "number"
            ? b.chair_number
            : Number.MAX_SAFE_INTEGER;

        return aChair - bChair;
      }),
    [barChecks]
  );

  const totalOpenContexts =
    tableTabs.length + openBarChecks.length + quickTabs.length;

  const renderTableTab = (tab: TableTab) => {
    const orderCount = tab.orders.length;

    return (
      <Pressable
        key={`table-${tab.tableId}`}
        onPress={() => {
          router.push({
            pathname: "/table/[tableId]",
            params: {
              tableId: tab.tableId,
              mode: "settlement",
            },
          });
        }}
        style={({ pressed }) => [
          styles.tabRow,
          pressed && styles.tabRowPressed,
        ]}
      >
        <View style={styles.tabRowText}>
          <Text style={styles.tabPrimary}>{tab.tableLabel}</Text>
          <Text style={styles.tabSecondary}>
            {orderCount} {orderCount === 1 ? "open order" : "open orders"}
          </Text>
        </View>

        <View style={styles.balance}>
          <Text style={styles.amountOwed}>
            {formatMoney(tab.amountOwedCents)}
          </Text>
          <Text style={styles.balanceLabel}>Open Balance</Text>
        </View>

        <Text style={styles.openAction}>Open</Text>
      </Pressable>
    );
  };

  const renderBarCheck = (check: BarCheck) => {
    const chairNumber =
      typeof check.chair_number === "number"
        ? check.chair_number
        : null;

    const seatLabel =
      chairNumber !== null ? `Bar ${chairNumber}` : "Bar";

    const tabName = check.display_name?.trim() || seatLabel;

    return (
      <Pressable
        key={`bar-${check.id}`}
        onPress={() => {
          router.push({
            pathname: "/bar/check/[checkId]",
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
          <Text style={styles.tabPrimary}>{tabName}</Text>
          <Text style={styles.tabSecondary}>
            {seatLabel} • {check.order_count}{" "}
            {check.order_count === 1 ? "order" : "orders"} • {shortRef(check.id)}
          </Text>
        </View>

        <View style={styles.balance}>
          <Text style={styles.amountOwed}>
            {formatMoney(cents(check.amount_owed_cents))}
          </Text>
          <Text style={styles.balanceLabel}>Open Balance</Text>
        </View>

        <Text style={styles.openAction}>Open</Text>
      </Pressable>
    );
  };

  const renderQuickTab = ({ order, amountOwedCents }: QuickTab) => (
    <Pressable
      key={`quick-${order.id}`}
      onPress={() => {
        router.push({
          pathname: "/orders/[orderId]",
          params: { orderId: order.id },
        });
      }}
      style={({ pressed }) => [
        styles.tabRow,
        pressed && styles.tabRowPressed,
      ]}
    >
      <View style={styles.tabRowText}>
        <Text style={styles.tabPrimary}>Quick Order</Text>
        <Text style={styles.tabSecondary}>{shortRef(order.id)}</Text>
      </View>

      <View style={styles.balance}>
        <Text style={styles.amountOwed}>
          {formatMoney(amountOwedCents)}
        </Text>
        <Text style={styles.balanceLabel}>Open Balance</Text>
      </View>

      <Text style={styles.openAction}>Open</Text>
    </Pressable>
  );

  const renderSection = (
    title: string,
    count: number,
    children: React.ReactNode
  ) => {
    if (count === 0) {
      return null;
    }

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.sectionRows}>{children}</View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Open Tabs</Text>
          <Text style={styles.subtitle}>
            {totalOpenContexts} unresolved{" "}
            {totalOpenContexts === 1 ? "tab" : "tabs"}
          </Text>
        </View>

        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
        >
          <Text style={styles.backButtonText}>Back</Text>
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
              onPress={() => void loadOpenTabs()}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.backButtonPressed,
              ]}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : totalOpenContexts === 0 ? (
          <View style={styles.centerState}>
            <Text style={styles.stateTitle}>No open tabs</Text>
            <Text style={styles.stateText}>
              Unresolved table, bar, and quick-order balances will appear here.
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {renderSection(
              "Tables",
              tableTabs.length,
              tableTabs.map(renderTableTab)
            )}

            {renderSection(
              "Bar",
              openBarChecks.length,
              openBarChecks.map(renderBarCheck)
            )}

            {renderSection(
              "Quick Orders",
              quickTabs.length,
              quickTabs.map(renderQuickTab)
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4efe6",
    padding: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111111",
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: "#6b6258",
  },
  backButton: {
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#c9bca9",
    backgroundColor: "#fffaf2",
  },
  backButtonPressed: {
    opacity: 0.7,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111111",
  },
  content: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 32,
    gap: 22,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#6b6258",
  },
  sectionRows: {
    gap: 10,
  },
  tabRow: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d7cbbb",
    backgroundColor: "#fffaf2",
  },
  tabRowPressed: {
    opacity: 0.72,
  },
  tabRowText: {
    flex: 1,
    minWidth: 0,
  },
  tabPrimary: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111111",
  },
  tabSecondary: {
    marginTop: 5,
    fontSize: 13,
    color: "#6b6258",
  },
  balance: {
    alignItems: "flex-end",
  },
  amountOwed: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111111",
  },
  balanceLabel: {
    marginTop: 3,
    fontSize: 11,
    color: "#6b6258",
    textTransform: "uppercase",
  },
  openAction: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111111",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111111",
    textAlign: "center",
  },
  stateText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: "#6b6258",
    textAlign: "center",
  },
  retryButton: {
    marginTop: 18,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: "#111111",
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#ffffff",
  },
});

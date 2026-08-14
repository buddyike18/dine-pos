import React, { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, View } from "react-native";


import {
  Surface,
  Stack,
  Row,
  TextPrimitive,
  ButtonPrimitive,
  ModalShell,
} from "../../src/design-system";


import { resolveHighestPriorityState } from "../../src/design-system/foundations/statePriority";
import {
  getOrderEvents,
  getOrderPaidCents,
  getOrderPaymentState,
  getOrderTotalCents,
  isOrderFullyPaid,
  listOrdersForTable,
  listTableAssignments,
  updateOrderStatus,
  voidOrder,
  compOrder,
  resetTable,
  type ManagerInterventionReason,
  type TableAssignment,
} from "../../src/lib/api";
import { auth, getIdToken, getCurrentActor, type StaffRole } from "../../src/lib/firebase";
import { floorTablesStore } from "../../src/state/floorTables.store";
import { background } from "../../src/design-system/tokens/colors";

type TimelineActor = "EMPLOYEE" | "MANAGER" | "CUSTOMER" | "SYSTEM" | "UNKNOWN";

type TimelineRow = {
  id: string;
  createdAt: string;
  eventType: string;
  actor: TimelineActor;
  fromStatus?: string;
  toStatus?: string;
};

type TableOrder = {
  id: string;
  status: string;
  createdAt: string;
  openedAt: string;
  items: Array<{
    name: string;
    quantity: number;
    modifierLabels: string[];
  }>;
  paidCents: number;
  totalCents: number;
  paymentState: "unpaid" | "partial" | "paid";
  fullyPaid: boolean;
  timelineRows: TimelineRow[];
};

function getOrderAttentionPriority(order: TableOrder) {
  if (order.status === "OPEN" && order.fullyPaid) return 0;
  if (order.status === "SENT") return 1;
  if (order.status === "OPEN") return 2;
  if (order.status === "READY") return 3;
  return 4;
}

type OrderAction = "SEND" | "MARK_READY" | "RECALL";
type ManagerOrderAction = "VOID_ORDER" | "COMP_ORDER";
type AnyOrderAction = OrderAction | ManagerOrderAction;
type PendingOrderActionMap = Record<string, AnyOrderAction | undefined>;

type OrderActionMessageMap = Record<string, string | undefined>;
type OrderActionSuccessMap = Record<string, string | undefined>;


function normalizeActor(value: unknown): TimelineActor {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (!normalized) return "UNKNOWN";
  if (normalized === "CUSTOMER") return "CUSTOMER";
  if (normalized === "MANAGER") return "MANAGER";
  if (normalized === "EMPLOYEE") return "EMPLOYEE";
  if (normalized === "STAFF") return "EMPLOYEE";
  if (normalized === "SYSTEM") return "SYSTEM";

  return "UNKNOWN";
}

function normalizeTableKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeOrderStatus(value: unknown) {
  return String(value ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
}

function isTerminalOrderStatus(status: string) {
  const normalized = normalizeOrderStatus(status);
  return (
    normalized === "VOID" ||
    normalized === "CANCELLED" ||
    normalized === "COMP" ||
    normalized === "COMPED"
  );
}

function formatOrderItemName(item: any) {
  const directName = String(
    item?.name_snapshot ?? item?.name ?? item?.item_name ?? ""
  ).trim();
  if (directName) return directName;

  const nestedName = String(
    item?.menu_item?.name ?? item?.menuItem?.name ?? item?.menuItemName ?? ""
  ).trim();

  if (nestedName) return nestedName;

  return "Unnamed Item";
}

function normalizeOrderItems(items: unknown) {
  if (!Array.isArray(items)) {
    return [] as Array<{
      name: string;
      quantity: number;
      modifierLabels: string[];
    }>;
  }

  return items.map((item: any) => {
    const modifiers = Array.isArray(item?.modifiers)
      ? item.modifiers
      : Array.isArray(item?.order_item_modifiers)
        ? item.order_item_modifiers
        : [];

    const modifierLabels = modifiers
      .map((modifier: any) =>
        String(
          modifier?.option_name_snapshot ??
            modifier?.option_name ??
            modifier?.name ??
            ""
        ).trim()
      )
      .filter(Boolean);

    return {
      name: formatOrderItemName(item),
      quantity: Number(item?.quantity ?? item?.qty ?? 1) || 1,
      modifierLabels,
    };
  });
}

function getSafeTime(value: unknown) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return 0;

  const time = new Date(rawValue).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function compareTimelineRows(a: TimelineRow, b: TimelineRow) {
  const aTime = getSafeTime(a.createdAt);
  const bTime = getSafeTime(b.createdAt);

  if (aTime !== bTime) {
    return aTime - bTime;
  }

  return a.id.localeCompare(b.id);
}

function compareTableOrders(a: TableOrder, b: TableOrder) {
  const aPriority = getOrderAttentionPriority(a);
  const bPriority = getOrderAttentionPriority(b);

  if (aPriority !== bPriority) {
    return aPriority - bPriority;
  }

  const aTime = getSafeTime(a.openedAt || a.createdAt);
  const bTime = getSafeTime(b.openedAt || b.createdAt);

  if (aTime !== bTime) {
    return bTime - aTime;
  }

  return b.id.localeCompare(a.id);
}


function getOrderDisplayLabel(order: TableOrder) {
  const shortId = order.id.slice(-6).toUpperCase();
  return shortId ? `Order ${shortId}` : "Order";
}

function shouldConfirmAction(action: AnyOrderAction) {
  return action === "RECALL" || action === "VOID_ORDER" || action === "COMP_ORDER";
}

function getSuccessMessage(action: AnyOrderAction) {
  if (action === "SEND") return "Sent to kitchen.";
  if (action === "MARK_READY") return "Marked ready.";
  if (action === "RECALL") return "Recalled to open.";
  if (action === "VOID_ORDER") return "Voided.";
  return "Comped.";
}

function getActionErrorMessage(action: AnyOrderAction) {
  if (action === "SEND") return "Unable to send order.";
  if (action === "MARK_READY") return "Unable to mark order ready.";
  if (action === "RECALL") return "Unable to recall order.";
  if (action === "VOID_ORDER") return "Unable to void order.";
  return "Unable to comp order.";
}

function getSpecificActionErrorMessage(error: unknown, action: AnyOrderAction) {
  const fallbackMessage = getActionErrorMessage(action);
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("auth") ||
    normalizedMessage.includes("token") ||
    normalizedMessage.includes("sign in") ||
    normalizedMessage.includes("unauthorized") ||
    normalizedMessage.includes("401")
  ) {
    return "Session expired. Please sign in again.";
  }

  if (
    normalizedMessage.includes("forbidden") ||
    normalizedMessage.includes("permission") ||
    normalizedMessage.includes("403")
  ) {
    return "Only managers can perform this action";
  }

  if (
    normalizedMessage.includes("invalid") ||
    normalizedMessage.includes("transition") ||
    normalizedMessage.includes("not allowed") ||
    normalizedMessage.includes("409") ||
    normalizedMessage.includes("400")
  ) {
    return "This order can no longer be changed";
  }

  if (
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("failed to fetch") ||
    normalizedMessage.includes("network request failed") ||
    normalizedMessage.includes("internet") ||
    normalizedMessage.includes("offline")
  ) {
    return "Network unavailable. Check connection.";
  }

  if (
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("timed out") ||
    normalizedMessage.includes("abort")
  ) {
    return "Unable to confirm action. Please retry.";
  }

  if (
    normalizedMessage.includes("500") ||
    normalizedMessage.includes("502") ||
    normalizedMessage.includes("503") ||
    normalizedMessage.includes("504")
  ) {
    return "Backend unavailable. Please retry.";
  }

  return fallbackMessage;
}

function formatMoneyCents(cents: number) {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function getPaymentStateLabel(order: TableOrder) {
  if (order.paymentState === "paid" || order.fullyPaid) return "PAID";
  if (order.paymentState === "partial") return "PARTIAL";
  return "UNPAID";
}



function getConfirmationConfig(args: {
  action: AnyOrderAction;
  orderLabel: string;
}): { title: string; message: string; confirmLabel: string } {
  const { action, orderLabel } = args;

  if (action === "RECALL") {
    return {
      title: "Recall Order",
      message: `${orderLabel} will move back to OPEN.`,
      confirmLabel: "Recall",
    };
  }

  if (action === "VOID_ORDER") {
    return {
      title: "Void Order",
      message: `${orderLabel} will be voided. This action cannot be undone.`,
      confirmLabel: "Void",
    };
  }

  return {
    title: "Comp Order",
    message: `${orderLabel} will be comped. Revenue will be removed.`,
    confirmLabel: "Comp",
  };
}


function getNextStatusForAction(action: OrderAction): "SENT" | "READY" | "OPEN" {
  if (action === "SEND") return "SENT";
  if (action === "MARK_READY") return "READY";
  return "OPEN";
}

async function loadTableOrdersFromBackend(args: {
  token: string;
  tableId: string;
}): Promise<TableOrder[]> {
  const { token, tableId } = args;

  const matchingOrders = await listOrdersForTable({
    token,
    tableId,
  });

  const nextOrders = await Promise.all(
    matchingOrders
      .map((order: any) => ({
        id: String(order?.id ?? "").trim(),
        status: normalizeOrderStatus(order?.status),
        createdAt: String(order?.created_at ?? order?.createdAt ?? "").trim(),
        openedAt: String(order?.opened_at ?? order?.openedAt ?? "").trim(),
        items: normalizeOrderItems(order?.items ?? order?.line_items),
        paidCents: getOrderPaidCents(order),
        totalCents: getOrderTotalCents(order),
        paymentState: getOrderPaymentState(order),
        fullyPaid: isOrderFullyPaid(order),
      }))
      .filter((order) => order.id)
      .sort((a, b) => {
        const aTime = getSafeTime(a.openedAt || a.createdAt);
        const bTime = getSafeTime(b.openedAt || b.createdAt);

        if (aTime !== bTime) {
          return bTime - aTime;
        }

        return b.id.localeCompare(a.id);
      })
      .map(async (order) => {
        let events: unknown[] = [];

        try {
          const nextEvents = await getOrderEvents(order.id, token);
          events = Array.isArray(nextEvents) ? nextEvents : [];
        } catch (error) {
          console.warn(`[table/${tableId}] failed to load events for order ${order.id}`, error);
        }
        const timelineRows = events
          .map((event: any): TimelineRow | null => {
            const eventId = String(event?.id ?? "").trim();
            const createdAt = String(event?.created_at ?? event?.createdAt ?? "").trim();
            const eventType = String(event?.event_type ?? event?.eventType ?? "").trim();

            if (!eventId || !createdAt || !eventType) {
              return null;
            }

            return {
              id: eventId,
              createdAt,
              eventType: eventType.toUpperCase(),
              actor: normalizeActor(event?.actor_type ?? event?.actor),
              fromStatus: String(event?.from_status ?? event?.fromStatus ?? "").trim(),
              toStatus: String(event?.to_status ?? event?.toStatus ?? "").trim(),
            };
          })
          .filter((event: TimelineRow | null): event is TimelineRow => event !== null)
          .sort(compareTimelineRows)
          .reverse();

        return {
          ...order,
          timelineRows,
        } satisfies TableOrder;
      })
  );

  return nextOrders.sort(compareTableOrders);
}

export default function TableDetailScreen() {
  const { tableId } = useLocalSearchParams<{ tableId: string }>();
  const router = useRouter();

  const safeTableId = String(tableId ?? "");
  const normalizedSafeTableId = normalizeTableKey(safeTableId);

  const [storeTables, setStoreTables] = useState(floorTablesStore.getTables());
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [tableOrders, setTableOrders] = useState<TableOrder[]>([]);
  const [assignedStaffName, setAssignedStaffName] = useState<string | null>(null);
  const [pendingOrderActions, setPendingOrderActions] = useState<PendingOrderActionMap>({});
  useEffect(() => {
    if (!safeTableId) {
      setAssignedStaffName(null);
      return;
    }

    let cancelled = false;

    const loadAssignment = async () => {
      try {
        const token = await getIdToken();

        if (!token) {
          if (!cancelled) {
            setAssignedStaffName(null);
          }
          return;
        }

        const assignments = await listTableAssignments({ token });
        const matchingAssignment = Array.isArray(assignments)
          ? assignments.find((assignment: TableAssignment) => {
              return normalizeTableKey(assignment?.table_id) === normalizedSafeTableId;
            })
          : null;
        const nextStaffName = String(matchingAssignment?.staff_name ?? "").trim();

        if (!cancelled) {
          setAssignedStaffName(nextStaffName || null);
        }
      } catch (error) {
        if (!cancelled) {
          setAssignedStaffName(null);
        }
      }
    };

    loadAssignment();

    return () => {
      cancelled = true;
    };
  }, [normalizedSafeTableId, safeTableId]);
  const [orderActionErrors, setOrderActionErrors] = useState<OrderActionMessageMap>({});
  const [orderActionSuccesses, setOrderActionSuccesses] = useState<OrderActionSuccessMap>({});
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [uiRole, setUiRole] = useState<StaffRole | "unknown">("unknown");
  const [roleLoading, setRoleLoading] = useState(true);
  const [selectedOrderFilter, setSelectedOrderFilter] = useState<"OPEN" | "SENT" | "READY" | "CLOSED">("OPEN");
  const hasInitializedOrderFilterRef = useRef(false);
  useEffect(() => {
    let cancelled = false;

    const loadRole = async () => {
      try {
        setRoleLoading(true);
        const actor = await getCurrentActor();
        const nextRole = actor?.role ?? "unknown";

        if (!cancelled) {
          setUiRole(nextRole);
        }
      } catch {
        if (!cancelled) {
          setUiRole("unknown");
        }
      } finally {
        if (!cancelled) {
          setRoleLoading(false);
        }
      }
    };

    loadRole();

    const unsubscribe = onAuthStateChanged(auth, () => {
      if (cancelled) return;

      setUiRole("unknown");
      setRoleLoading(true);
      void loadRole();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function retryLoadTimeline() {
    if (!safeTableId) {
      return;
    }

    try {
      setTimelineLoading(true);
      setTimelineError(null);

      const token = await getIdToken();

      if (!token) {
        setTableOrders([]);
        setTimelineError("Sign in required.");
        return;
      }

      const nextOrders = await loadTableOrdersFromBackend({
        token,
        tableId: normalizedSafeTableId,
      });

      setTableOrders(Array.isArray(nextOrders) ? nextOrders : []);
      setOrderActionErrors({});
      setOrderActionSuccesses({});
      setTimelineError(null);
    } catch (error) {
      setTimelineError("Connection issue. Showing last known backend state.");
    } finally {
      setTimelineLoading(false);
    }
  }

  const pendingOrderActionsRef = useRef<PendingOrderActionMap>({});
  const actionRefreshInFlightRef = useRef(false);

  useEffect(() => {
    pendingOrderActionsRef.current = pendingOrderActions;
  }, [pendingOrderActions]);

  function hasPendingOrderAction(orderId: string) {
    return Boolean(pendingOrderActionsRef.current[orderId]);
  }

  useEffect(() => {
    if (!safeTableId) {
      return;
    }

    floorTablesStore.clearBadge(safeTableId);

    const interval = setInterval(() => {
      setStoreTables(floorTablesStore.getTables());
    }, 250);

    return () => clearInterval(interval);
  }, [safeTableId]);

  const table = useMemo(() => {
    return storeTables.find((t) => normalizeTableKey(t.id) === normalizedSafeTableId);
  }, [normalizedSafeTableId, storeTables]);

  const activeOrders = tableOrders.filter(
    (order) => order.status === "OPEN" || order.status === "SENT"
  );

  const completedOrders = tableOrders.filter(
    (order) => order.status === "READY"
  );

  const terminalOrders = tableOrders.filter((order) =>
    isTerminalOrderStatus(order.status)
  );

  const openOrders = tableOrders.filter((order) => order.status === "OPEN");
  const sentOrders = tableOrders.filter((order) => order.status === "SENT");
  const readyOrders = completedOrders;
  const closedOrders = terminalOrders;

  const filteredActiveOrders =
    selectedOrderFilter === "OPEN"
      ? openOrders
      : selectedOrderFilter === "SENT"
        ? sentOrders
        : [];
  const filteredCompletedOrders = selectedOrderFilter === "READY" ? readyOrders : [];
  const filteredTerminalOrders = selectedOrderFilter === "CLOSED" ? closedOrders : [];
  const selectedFilteredOrderCount =
    filteredActiveOrders.length + filteredCompletedOrders.length + filteredTerminalOrders.length;
  const selectedFilterEmptyMessage = `No ${selectedOrderFilter} orders at this table.`;

  useEffect(() => {
    if (hasInitializedOrderFilterRef.current || tableOrders.length === 0) {
      return;
    }

    hasInitializedOrderFilterRef.current = true;

    if (openOrders.length > 0) {
      setSelectedOrderFilter("OPEN");
      return;
    }

    if (sentOrders.length > 0) {
      setSelectedOrderFilter("SENT");
      return;
    }

    if (readyOrders.length > 0) {
      setSelectedOrderFilter("READY");
      return;
    }

    if (closedOrders.length > 0) {
      setSelectedOrderFilter("CLOSED");
    }
  }, [closedOrders.length, openOrders.length, readyOrders.length, sentOrders.length, tableOrders.length]);

  const resolvedState = useMemo(() => {
    if (activeOrders.some((order) => order.status === "SENT")) return "sent";
    if (activeOrders.some((order) => order.status === "OPEN")) return "open";
    if (activeOrders.length === 0 && completedOrders.length > 0) return "ready";

    if (!table) return "idle";
    return resolveHighestPriorityState([table.state]);
  }, [activeOrders, completedOrders, table]);

  const resetBlockingOrder = tableOrders.find((order) => {
    if (order.status === "OPEN") return true;
    if (order.status === "SENT") return true;
    if (order.status === "READY" && !order.fullyPaid) return true;
    return false;
  });
  const isResetBlocked = Boolean(resetBlockingOrder);
  const resetBlockReason = isResetBlocked
    ? "Complete or close all orders before resetting"
    : null;
  const hasUnsafeConnectionState = Boolean(timelineError && tableOrders.length > 0);
  const isManager = uiRole === "Owner" || uiRole === "Manager";
  const roleLabel = roleLoading
    ? "Checking role"
    : isManager
      ? "Manager"
      : uiRole === "Employee"
        ? "Staff"
        : "Role Unknown";

  function getResetErrorMessage(error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";
    const normalizedMessage = message.toLowerCase();

    if (
      normalizedMessage.includes("auth") ||
      normalizedMessage.includes("token") ||
      normalizedMessage.includes("sign in") ||
      normalizedMessage.includes("unauthorized") ||
      normalizedMessage.includes("401")
    ) {
      return "Session expired. Please sign in again.";
    }

    if (
      normalizedMessage.includes("complete or close") ||
      normalizedMessage.includes("table_reset_blocked") ||
      normalizedMessage.includes("409")
    ) {
      return "Complete or close all orders before resetting";
    }

    if (
      normalizedMessage.includes("network") ||
      normalizedMessage.includes("failed to fetch") ||
      normalizedMessage.includes("network request failed") ||
      normalizedMessage.includes("internet") ||
      normalizedMessage.includes("offline")
    ) {
      return "Network unavailable. Check connection.";
    }

    if (
      normalizedMessage.includes("timeout") ||
      normalizedMessage.includes("timed out") ||
      normalizedMessage.includes("abort")
    ) {
      return "Unable to confirm reset. Please retry.";
    }

    if (
      normalizedMessage.includes("500") ||
      normalizedMessage.includes("502") ||
      normalizedMessage.includes("503") ||
      normalizedMessage.includes("504")
    ) {
      return "Backend unavailable. Please retry.";
    }

    return "Unable to reset table.";
  }

  async function handleResetTable() {
    if (resetPending) {
      return;
    }

    if (isResetBlocked) {
      setResetError("Complete or close all orders before resetting");
      return;
    }

    try {
      setResetPending(true);
      setResetError(null);

      const token = await getIdToken();

      if (!token) {
        setResetError("Session expired. Please sign in again.");
        return;
      }

      await resetTable({
        token,
        tableId: normalizedSafeTableId,
      });

      const nextOrders = await loadTableOrdersFromBackend({
        token,
        tableId: normalizedSafeTableId,
      });

      setTableOrders(Array.isArray(nextOrders) ? nextOrders : []);
      setOrderActionErrors({});
      setOrderActionSuccesses({});
      floorTablesStore.clearBadge(safeTableId);
      setShowResetConfirm(false);
      setTimelineError(null);
      setTimelineLoading(false);
    } catch (error) {
      setResetError(getResetErrorMessage(error));
    } finally {
      setResetPending(false);
    }
  }

  async function handleOrderAction(orderId: string, action: AnyOrderAction) {
    if (hasPendingOrderAction(orderId)) {
      return;
    }

    if (hasUnsafeConnectionState) {
      setOrderActionErrors((current) => ({
        ...current,
        [orderId]: "Connection issue. Refresh backend truth before this action can be safely attempted.",
      }));
      return;
    }

    const requiresManager =
      action === "RECALL" ||
      action === "VOID_ORDER" ||
      action === "COMP_ORDER";

    if (requiresManager && !isManager) {
      setOrderActionErrors((current) => ({
        ...current,
        [orderId]: "Only managers can perform this action",
      }));
      return;
    }

    pendingOrderActionsRef.current = {
      ...pendingOrderActionsRef.current,
      [orderId]: action,
    };
    actionRefreshInFlightRef.current = true;

    setPendingOrderActions((current) => ({
      ...current,
      [orderId]: action,
    }));
    setOrderActionErrors((current) => {
      const next = { ...current };
      delete next[orderId];
      return next;
    });
    setOrderActionSuccesses((current) => {
      const next = { ...current };
      delete next[orderId];
      return next;
    });

    try {
      const token = await getIdToken();

      if (!token) {
        setOrderActionErrors((current) => ({
          ...current,
          [orderId]: "Session expired. Please sign in again.",
        }));
        return;
      }

      const reason: ManagerInterventionReason = "Manager intervention from Table Detail";

      setTimelineError(null);

      if (action === "VOID_ORDER") {
        await voidOrder({
          token,
          orderId,
          reason,
        });
      } else if (action === "COMP_ORDER") {
        await compOrder({
          token,
          orderId,
          reason,
        });
      } else {
        const nextStatus = getNextStatusForAction(action);

        await updateOrderStatus({
          token,
          orderId,
          status: nextStatus,
        });
      }

      const nextOrders = await loadTableOrdersFromBackend({
        token,
        tableId: normalizedSafeTableId,
      });

      setTableOrders((current) => {
        const resolvedNextOrders = Array.isArray(nextOrders) ? nextOrders : [];

        if (resolvedNextOrders.length === 0 && current.length > 0) {
          return current;
        }

        return resolvedNextOrders;
      });
      setOrderActionErrors((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
      setOrderActionSuccesses((current) => ({
        ...current,
        [orderId]: getSuccessMessage(action),
      }));
      setTimelineLoading(false);
    } catch (error) {
      setOrderActionErrors((current) => ({
        ...current,
        [orderId]: getSpecificActionErrorMessage(error, action),
      }));
    } finally {
      setPendingOrderActions((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
      const nextPendingActions = { ...pendingOrderActionsRef.current };
      delete nextPendingActions[orderId];
      pendingOrderActionsRef.current = nextPendingActions;
      actionRefreshInFlightRef.current = false;
    }
  }

  function handleActionPress(orderId: string, action: AnyOrderAction) {
    const order = tableOrders.find((entry) => entry.id === orderId);
    const orderLabel = order ? getOrderDisplayLabel(order) : "This order";

    if (!shouldConfirmAction(action)) {
      handleOrderAction(orderId, action);
      return;
    }

    const confirmation = getConfirmationConfig({ action, orderLabel });

    Alert.alert(
      confirmation.title,
      confirmation.message,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: confirmation.confirmLabel,
          style: "destructive",
          onPress: () => {
            handleOrderAction(orderId, action);
          },
        },
      ]
    );
  }

  useEffect(() => {
    if (!safeTableId) {
      setTableOrders([]);
      setOrderActionErrors({});
      setOrderActionSuccesses({});
      setResetError(null);
      setTimelineLoading(false);
      setTimelineError(null);
      return;
    }

    let cancelled = false;

    const loadTimeline = async () => {
      try {
        setTimelineLoading(true);

        const token = await getIdToken();

        if (!token) {
          if (!cancelled) {
            setTableOrders([]);
            setTimelineError("Sign in required.");
            setTimelineLoading(false);
          }
          return;
        }
        if (
          actionRefreshInFlightRef.current ||
          Object.keys(pendingOrderActionsRef.current).length > 0
        ) {
          if (!cancelled) {
            setTimelineLoading(false);
          }
          return;
        }
        setTimelineError(null);

        const nextOrders = await loadTableOrdersFromBackend({
          token,
          tableId: normalizedSafeTableId,
        });

        if (!cancelled) {
          const resolvedNextOrders = Array.isArray(nextOrders) ? nextOrders : [];

          setTableOrders((current) => {
            if (
              resolvedNextOrders.length === 0 &&
              current.length > 0 &&
              actionRefreshInFlightRef.current
            ) {
              return current;
            }

            return resolvedNextOrders;
          });

          setOrderActionErrors((current) => {
            if (Object.keys(current).length === 0) {
              return current;
            }

            const next: OrderActionMessageMap = {};
            const liveOrderIds = new Set(resolvedNextOrders.map((order) => order.id));

            for (const orderId of Object.keys(current)) {
              if (pendingOrderActionsRef.current[orderId]) {
                next[orderId] = current[orderId];
                continue;
              }

              if (!liveOrderIds.has(orderId)) {
                continue;
              }
            }

            return next;
          });

          setOrderActionSuccesses((current) => {
            if (Object.keys(current).length === 0) {
              return current;
            }

            const next: OrderActionSuccessMap = {};
            const liveOrderIds = new Set(resolvedNextOrders.map((order) => order.id));

            for (const orderId of Object.keys(current)) {
              if (pendingOrderActionsRef.current[orderId]) {
                next[orderId] = current[orderId];
                continue;
              }

              if (!liveOrderIds.has(orderId)) {
                continue;
              }
            }

            return next;
          });

          setTimelineLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setTimelineError("Connection issue. Showing last known backend state.");
          setTimelineLoading(false);
        }
      }
    };

    loadTimeline();

    const interval = setInterval(() => {
      loadTimeline();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [normalizedSafeTableId]);

  if (!table) {
    return (
      <View style={{ flex: 1, backgroundColor: background.app }}>
        <Surface padding={4} style={{ backgroundColor: "#fffaf2", borderColor: "#c8bda8", borderWidth: 1 }}>
          <TextPrimitive variant="bodyMd">No table found.</TextPrimitive>
        </Surface>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: background.app }}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            <Row
              justify="space-between"
              align="center"
              style={{
                borderWidth: 1,
                borderColor: "#c8bda8",
                backgroundColor: "#fffaf2",
                borderRadius: 14,
                paddingVertical: 10,
                paddingHorizontal: 12,
                marginBottom: 8,
              }}
            >
              <Stack gap={1}>
                <TextPrimitive variant="headingLg" style={{ fontWeight: "900", letterSpacing: -0.4 }}>
                  {table.label}
                </TextPrimitive>
                <TextPrimitive variant="bodyMd" style={{ color: "#4f463b", fontWeight: "700" }}>
                  {resolvedState.toUpperCase()} • {roleLabel}
                </TextPrimitive>
                {assignedStaffName ? (
                  <TextPrimitive variant="bodySm" style={{ color: "#6f6252", fontWeight: "800" }}>
                    Server: {assignedStaffName}
                  </TextPrimitive>
                ) : null}
              </Stack>

              <Pressable
                accessibilityRole="button"
                onPress={() => router.back()}
                style={{
                  borderWidth: 1,
                  borderColor: "#c8bda8",
                  backgroundColor: "#fffaf2",
                  borderRadius: 999,
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                }}
              >
                <TextPrimitive variant="bodySm" style={{ color: "#4f463b", fontWeight: "900" }}>
                  Back
                </TextPrimitive>
              </Pressable>
            </Row>

            <Row style={{ flexWrap: "wrap", gap: 12, paddingTop: 2, paddingBottom: 8 }}>
              {(["OPEN", "SENT", "READY", "CLOSED"] as const).map((filter) => {
                const isSelected = selectedOrderFilter === filter;
                return (
                  <Pressable
                    key={filter}
                    accessibilityRole="button"
                    onPress={() => setSelectedOrderFilter(filter)}
                    style={{
                      borderWidth: 1,
                      borderColor: isSelected ? "#8f1f2f" : "#c8bda8",
                      backgroundColor: isSelected ? "#8f1f2f" : "#fffaf2",
                      borderRadius: 999,
                      paddingVertical: 6,
                      paddingHorizontal: 14,
                      marginRight: 0,
                    }}
                  >
                    <TextPrimitive
                      variant="bodySm"
                      style={{
                        color: isSelected ? "#fffaf2" : "#4f463b",
                        fontWeight: "800",
                        letterSpacing: 0.5,
                      }}
                    >
                      {filter}
                    </TextPrimitive>
                  </Pressable>
                );
              })}
            </Row>



            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingTop: 6, paddingBottom: 132 }}
              showsVerticalScrollIndicator
            >
              {resetError ? (
                <View
                  style={{
                    backgroundColor: "#f3ede3",
                    borderLeftWidth: 2,
                    borderLeftColor: "#c8bda8",
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    marginBottom: 8,
                  }}
                >
                  <TextPrimitive variant="bodySm">{resetError}</TextPrimitive>
                </View>
              ) : null}
              {hasUnsafeConnectionState ? (
                <View
                  style={{
                    backgroundColor: "#f3ede3",
                    borderLeftWidth: 2,
                    borderLeftColor: "#c8bda8",
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    marginBottom: 8,
                  }}
                >
                  <Stack gap={1}>
                    <TextPrimitive variant="bodySm">{timelineError}</TextPrimitive>
                    <TextPrimitive variant="bodySm">
                      Actions are locked until backend truth is restored.
                    </TextPrimitive>
                    <ButtonPrimitive
                      hierarchy="secondary"
                      label={timelineLoading ? "Retrying" : "Retry"}
                      disabled={timelineLoading}
                      onPress={retryLoadTimeline}
                    />
                  </Stack>
                </View>
              ) : null}
              {timelineLoading && tableOrders.length === 0 ? (
                <Surface padding={3} style={{ backgroundColor: "#fffaf2", borderColor: "#c8bda8", borderWidth: 1 }}>
                  <TextPrimitive variant="bodySm">Loading orders.</TextPrimitive>
                </Surface>
              ) : timelineError && tableOrders.length === 0 ? (
                <Surface padding={3} style={{ backgroundColor: "#fffaf2", borderColor: "#c8bda8", borderWidth: 1 }}>
                  <Stack gap={2}>
                    <TextPrimitive variant="bodySm">{timelineError}</TextPrimitive>
                    <ButtonPrimitive
                      hierarchy="secondary"
                      label={timelineLoading ? "Retrying" : "Retry"}
                      disabled={timelineLoading}
                      onPress={retryLoadTimeline}
                    />
                  </Stack>
                </Surface>
              ) : tableOrders.length === 0 ? (
                <Surface padding={3} style={{ backgroundColor: "#fffaf2", borderColor: "#c8bda8", borderWidth: 1 }}>
                  <TextPrimitive variant="bodySm">No live orders.</TextPrimitive>
                </Surface>
              ) : (
                <Stack gap={3} style={{ paddingTop: 2 }}>
                  {selectedFilteredOrderCount === 0 ? (
                    <Surface padding={3} style={{ backgroundColor: "#fffaf2", borderColor: "#c8bda8", borderWidth: 1 }}>
                      <Stack gap={1}>
                        <TextPrimitive variant="bodySm" style={{ color: "#6f6252", fontWeight: "900", letterSpacing: 0.7, textTransform: "uppercase" }}>
                          {selectedOrderFilter}
                        </TextPrimitive>
                        <TextPrimitive variant="bodyMd" style={{ color: "#111111", fontWeight: "900" }}>
                          {selectedFilterEmptyMessage}
                        </TextPrimitive>
                        <TextPrimitive variant="bodySm" style={{ color: "#6f6252" }}>
                          Choose another status to view this table’s other orders.
                        </TextPrimitive>
                      </Stack>
                    </Surface>
                  ) : null}

                  {filteredActiveOrders.length > 0 ? (
                    <Stack gap={1}>
                      {filteredActiveOrders.map((order) => {
                          const orderLabel = getOrderDisplayLabel(order);

                          return (
                            <Surface key={order.id} padding={2} style={{ backgroundColor: "#fffaf2", borderColor: "#c8bda8", borderWidth: 1 }}>
                              <Stack gap={1}>
                                <Stack gap={1}>
                                  <Row justify="space-between" align="center">
                                    <TextPrimitive variant="bodyMd" style={{ fontWeight: "900", letterSpacing: -0.1 }}>{orderLabel}</TextPrimitive>
                                    <View
                                      style={{
                                        borderWidth: 1,
                                        borderColor:
                                          order.status === "READY"
                                            ? "#9fd8a8"
                                            : order.status === "SENT"
                                              ? "#c8bda8"
                                              : "#c8bda8",
                                        borderRadius: 8,
                                        paddingHorizontal: 10,
                                        paddingVertical: 4,
                                        backgroundColor:
                                          order.status === "READY"
                                            ? "#9fd8a8"
                                            : order.status === "SENT"
                                              ? "#efe7d8"
                                              : "#f3ede3",
                                      }}
                                    >
                                      <TextPrimitive
                                        variant="bodySm"
                                        style={{
                                          color:
                                            order.status === "READY"
                                              ? "#0b140d"
                                              : order.status === "SENT"
                                                ? "#4f463b"
                                                : "#111111",
                                          fontWeight: "900",
                                          fontSize: 12,
                                          letterSpacing: 0.6,
                                        }}
                                      >
                                        {order.status}
                                      </TextPrimitive>
                                    </View>
                                  </Row>
                                  <Row justify="space-between" align="center">
                                    <TextPrimitive variant="bodySm" style={{ color: "#6f6252", fontWeight: "900", letterSpacing: 0.7, textTransform: "uppercase" }}>
                                      {getPaymentStateLabel(order)}
                                    </TextPrimitive>
                                    <TextPrimitive variant="bodySm" style={{ color: "#4f463b", fontWeight: "800" }}>
                                      {formatMoneyCents(order.paidCents)} / {formatMoneyCents(order.totalCents)}
                                    </TextPrimitive>
                                  </Row>
                                </Stack>
                                <View style={{ height: 1, backgroundColor: "#c8bda8" }} />

                                {orderActionErrors[order.id] ? (
                                  <View
                                    style={{
                                      backgroundColor: "#f3ede3",
                                      borderLeftWidth: 2,
                                      borderLeftColor: "#c8bda8",
                                      borderRadius: 7,
                                      paddingHorizontal: 10,
                                      paddingVertical: 4,
                                    }}
                                  >
                                    <TextPrimitive variant="bodySm">{orderActionErrors[order.id]}</TextPrimitive>
                                  </View>
                                ) : orderActionSuccesses[order.id] ? (
                                  <View
                                    style={{
                                      backgroundColor: "#f3ede3",
                                      borderLeftWidth: 2,
                                      borderLeftColor: "#c8bda8",
                                      borderRadius: 7,
                                      paddingHorizontal: 10,
                                      paddingVertical: 4,
                                    }}
                                  >
                                    <TextPrimitive variant="bodySm">{orderActionSuccesses[order.id]}</TextPrimitive>
                                  </View>
                                ) : null}

                                <Stack gap={1}>
                                  {(Array.isArray(order.items) ? order.items : []).map((item, index) => (
                                    <Row key={`${order.id}-item-${index}`} justify="space-between" align="center" style={{ paddingVertical: 0 }}>
                                      <Stack gap={1}>
                                        <TextPrimitive variant="bodySm" style={{ color: "#111111", fontWeight: "700" }}>
                                          {item.name}
                                        </TextPrimitive>
                                        {item.modifierLabels.length > 0 ? (
                                          <TextPrimitive variant="bodySm" style={{ color: "#6f6252", marginTop: 2 }}>
                                            {item.modifierLabels.join(", ")}
                                          </TextPrimitive>
                                        ) : null}
                                      </Stack>
                                      <TextPrimitive variant="bodySm" style={{ color: "#4f463b", fontWeight: "800" }}>×{item.quantity}</TextPrimitive>
                                    </Row>
                                  ))}
                                </Stack>
                                {order.status === "OPEN" ? (
                                  isManager || order.fullyPaid ? (
                                    <>
                                      <View style={{ height: 1, backgroundColor: "#c8bda8" }} />
                                      <Stack gap={1}>
                                        {!order.fullyPaid ? (
                                          <View
                                            style={{
                                              backgroundColor: "#f3ede3",
                                              borderLeftWidth: 2,
                                              borderLeftColor: "#c8bda8",
                                              borderRadius: 7,
                                              paddingHorizontal: 10,
                                              paddingVertical: 4,
                                            }}
                                          >
                                            <TextPrimitive variant="bodySm">
                                              Awaiting payment before this order can be sent.
                                            </TextPrimitive>
                                          </View>
                                        ) : null}
                                        {order.fullyPaid ? (
                                          <ButtonPrimitive
                                            hierarchy="primary"
                                            label={pendingOrderActions[order.id] === "SEND" ? "Sending" : "SEND ORDER"}
                                            disabled={
                                              hasUnsafeConnectionState ||
                                              pendingOrderActions[order.id] === "SEND" ||
                                              pendingOrderActions[order.id] === "COMP_ORDER" ||
                                              pendingOrderActions[order.id] === "VOID_ORDER"
                                            }
                                            onPress={() => handleActionPress(order.id, "SEND")}
                                          />
                                        ) : null}
                                        {isManager ? (
                                          <>
                                            <TextPrimitive variant="bodySm" style={{ color: "#6f6252", fontWeight: "700", letterSpacing: 0.2, textTransform: "uppercase" }}>
                                              Manager actions
                                            </TextPrimitive>
                                            <Row>
                                              <View style={{ flex: 1, marginRight: 8 }}>
                                                <ButtonPrimitive
                                                  hierarchy="secondary"
                                                  label={pendingOrderActions[order.id] === "COMP_ORDER" ? "Comping" : "COMP ORDER"}
                                                  disabled={
                                                    hasUnsafeConnectionState ||
                                                    pendingOrderActions[order.id] === "SEND" ||
                                                    pendingOrderActions[order.id] === "COMP_ORDER" ||
                                                    pendingOrderActions[order.id] === "VOID_ORDER"
                                                  }
                                                  onPress={() => handleActionPress(order.id, "COMP_ORDER")}
                                                  style={{ backgroundColor: "#efe7d8", borderColor: "#c8bda8", paddingVertical: 4 }}
                                                />
                                              </View>
                                              <View style={{ flex: 1 }}>
                                                <ButtonPrimitive
                                                  hierarchy="destructive"
                                                  label={pendingOrderActions[order.id] === "VOID_ORDER" ? "Voiding" : "VOID ORDER"}
                                                  disabled={
                                                    hasUnsafeConnectionState ||
                                                    pendingOrderActions[order.id] === "SEND" ||
                                                    pendingOrderActions[order.id] === "COMP_ORDER" ||
                                                    pendingOrderActions[order.id] === "VOID_ORDER"
                                                  }
                                                  onPress={() => handleActionPress(order.id, "VOID_ORDER")}
                                                  style={{ paddingVertical: 4 }}
                                                />
                                              </View>
                                            </Row>
                                          </>
                                        ) : null}
                                      </Stack>
                                    </>
                                  ) : (
                                    <>
                                      <View style={{ height: 1, backgroundColor: "#c8bda8" }} />
                                      <View
                                        style={{
                                          backgroundColor: "#f3ede3",
                                          borderLeftWidth: 2,
                                          borderLeftColor: "#c8bda8",
                                          borderRadius: 7,
                                          paddingHorizontal: 10,
                                          paddingVertical: 4,
                                        }}
                                      >
                                        <TextPrimitive variant="bodySm">
                                          Awaiting payment before this order can be sent.
                                        </TextPrimitive>
                                      </View>
                                    </>
                                  )
                                ) : order.status === "SENT" ? (
                                  <>
                                    <View style={{ height: 1, backgroundColor: "#c8bda8" }} />
                                    <Stack gap={1}>
                                      {isManager ? (
                                        <>
                                          <TextPrimitive variant="bodySm" style={{ color: "#6f6252", fontWeight: "700", letterSpacing: 0.2, textTransform: "uppercase" }}>
                                            Manager actions
                                          </TextPrimitive>
                                          <ButtonPrimitive
                                            hierarchy="secondary"
                                            label={pendingOrderActions[order.id] === "RECALL" ? "Recalling" : "RECALL ORDER"}
                                            disabled={
                                              hasUnsafeConnectionState ||
                                              pendingOrderActions[order.id] === "RECALL" ||
                                              pendingOrderActions[order.id] === "COMP_ORDER" ||
                                              pendingOrderActions[order.id] === "VOID_ORDER"
                                            }
                                            onPress={() => handleActionPress(order.id, "RECALL")}
                                            style={{ backgroundColor: "#efe7d8", borderColor: "#c8bda8", paddingVertical: 4 }}
                                          />
                                          <Row>
                                            <View style={{ flex: 1, marginRight: 8 }}>
                                              <ButtonPrimitive
                                                hierarchy="secondary"
                                                label={pendingOrderActions[order.id] === "COMP_ORDER" ? "Comping" : "COMP ORDER"}
                                                disabled={
                                                  hasUnsafeConnectionState ||
                                                  pendingOrderActions[order.id] === "RECALL" ||
                                                  pendingOrderActions[order.id] === "COMP_ORDER" ||
                                                  pendingOrderActions[order.id] === "VOID_ORDER"
                                                }
                                                onPress={() => handleActionPress(order.id, "COMP_ORDER")}
                                                style={{ backgroundColor: "#efe7d8", borderColor: "#c8bda8", paddingVertical: 4 }}
                                              />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                              <ButtonPrimitive
                                                hierarchy="destructive"
                                                label={pendingOrderActions[order.id] === "VOID_ORDER" ? "Voiding" : "VOID ORDER"}
                                                disabled={
                                                  hasUnsafeConnectionState ||
                                                  pendingOrderActions[order.id] === "RECALL" ||
                                                  pendingOrderActions[order.id] === "COMP_ORDER" ||
                                                  pendingOrderActions[order.id] === "VOID_ORDER"
                                                }
                                                onPress={() => handleActionPress(order.id, "VOID_ORDER")}
                                                style={{ paddingVertical: 4 }}
                                              />
                                            </View>
                                          </Row>
                                        </>
                                      ) : null}
                                    </Stack>
                                  </>
                                ) : null}
                              </Stack>
                            </Surface>
                          );
                      })}
                    </Stack>
                  ) : null}

                  {filteredCompletedOrders.length > 0 ? (
                    <Stack gap={1}>
                      {filteredCompletedOrders.map((order) => {
                          const orderLabel = getOrderDisplayLabel(order);

                          return (
                            <Surface key={order.id} padding={2} style={{ backgroundColor: "#fffaf2", borderColor: "#c8bda8", borderWidth: 1 }}>
                              <Stack gap={1}>
                                <Stack gap={1}>
                                  <Row justify="space-between" align="center">
                                    <TextPrimitive variant="bodyMd" style={{ fontWeight: "900", letterSpacing: -0.1 }}>{orderLabel}</TextPrimitive>
                                    <View
                                      style={{
                                        borderWidth: 1,
                                        borderColor:
                                          order.status === "READY"
                                            ? "#9fd8a8"
                                            : order.status === "SENT"
                                              ? "#c8bda8"
                                              : "#c8bda8",
                                        borderRadius: 8,
                                        paddingHorizontal: 10,
                                        paddingVertical: 4,
                                        backgroundColor:
                                          order.status === "READY"
                                            ? "#9fd8a8"
                                            : order.status === "SENT"
                                              ? "#efe7d8"
                                              : "#f3ede3",
                                      }}
                                    >
                                      <TextPrimitive
                                        variant="bodySm"
                                        style={{
                                          color:
                                            order.status === "READY"
                                              ? "#0b140d"
                                              : order.status === "SENT"
                                                ? "#4f463b"
                                                : "#111111",
                                          fontWeight: "900",
                                          fontSize: 12,
                                          letterSpacing: 0.6,
                                        }}
                                      >
                                        {order.status}
                                      </TextPrimitive>
                                    </View>
                                  </Row>
                                  <Row justify="space-between" align="center">
                                    <TextPrimitive variant="bodySm" style={{ color: "#6f6252", fontWeight: "900", letterSpacing: 0.7, textTransform: "uppercase" }}>
                                      {getPaymentStateLabel(order)}
                                    </TextPrimitive>
                                    <TextPrimitive variant="bodySm" style={{ color: "#4f463b", fontWeight: "800" }}>
                                      {formatMoneyCents(order.paidCents)} / {formatMoneyCents(order.totalCents)}
                                    </TextPrimitive>
                                  </Row>
                                </Stack>

                                <View style={{ height: 1, backgroundColor: "#c8bda8" }} />

                                <Stack gap={1}>
                                  {(Array.isArray(order.items) ? order.items : []).map((item, index) => (
                                    <Row key={`${order.id}-item-${index}`} justify="space-between" align="center" style={{ paddingVertical: 0 }}>
                                      <Stack gap={1}>
                                        <TextPrimitive variant="bodySm" style={{ color: "#111111", fontWeight: "700" }}>
                                          {item.name}
                                        </TextPrimitive>
                                        {item.modifierLabels.length > 0 ? (
                                          <TextPrimitive variant="bodySm" style={{ color: "#6f6252", marginTop: 2 }}>
                                            {item.modifierLabels.join(", ")}
                                          </TextPrimitive>
                                        ) : null}
                                      </Stack>
                                      <TextPrimitive variant="bodySm" style={{ color: "#4f463b", fontWeight: "800" }}>×{item.quantity}</TextPrimitive>
                                    </Row>
                                  ))}
                                </Stack>
                                {isManager ? (
                                  <>
                                    <TextPrimitive variant="bodySm" style={{ color: "#6f6252", fontWeight: "700", letterSpacing: 0.2, textTransform: "uppercase" }}>
                                      Manager actions
                                    </TextPrimitive>
                                    <ButtonPrimitive
                                      hierarchy="secondary"
                                      label={pendingOrderActions[order.id] === "RECALL" ? "Recalling" : "RECALL ORDER"}
                                      disabled={
                                        hasUnsafeConnectionState ||
                                        pendingOrderActions[order.id] === "RECALL" ||
                                        pendingOrderActions[order.id] === "COMP_ORDER" ||
                                        pendingOrderActions[order.id] === "VOID_ORDER"
                                      }
                                      onPress={() => handleActionPress(order.id, "RECALL")}
                                      style={{ backgroundColor: "#efe7d8", borderColor: "#c8bda8", paddingVertical: 4 }}
                                    />
                                    <Row>
                                      <View style={{ flex: 1, marginRight: 8 }}>
                                        <ButtonPrimitive
                                          hierarchy="secondary"
                                          label={pendingOrderActions[order.id] === "COMP_ORDER" ? "Comping" : "COMP ORDER"}
                                          disabled={
                                            hasUnsafeConnectionState ||
                                            pendingOrderActions[order.id] === "RECALL" ||
                                            pendingOrderActions[order.id] === "COMP_ORDER" ||
                                            pendingOrderActions[order.id] === "VOID_ORDER"
                                          }
                                          onPress={() => handleActionPress(order.id, "COMP_ORDER")}
                                          style={{ backgroundColor: "#efe7d8", borderColor: "#c8bda8", paddingVertical: 4 }}
                                        />
                                      </View>
                                      <View style={{ flex: 1 }}>
                                        <ButtonPrimitive
                                          hierarchy="destructive"
                                          label={pendingOrderActions[order.id] === "VOID_ORDER" ? "Voiding" : "VOID ORDER"}
                                          disabled={
                                            hasUnsafeConnectionState ||
                                            pendingOrderActions[order.id] === "RECALL" ||
                                            pendingOrderActions[order.id] === "COMP_ORDER" ||
                                            pendingOrderActions[order.id] === "VOID_ORDER"
                                          }
                                          onPress={() => handleActionPress(order.id, "VOID_ORDER")}
                                          style={{ paddingVertical: 4 }}
                                        />
                                      </View>
                                    </Row>
                                  </>
                                ) : null}
                              </Stack>
                            </Surface>
                          );
                      })}
                    </Stack>
                  ) : null}

                  {filteredTerminalOrders.length > 0 ? (
                    <Stack gap={1}>
                      {filteredTerminalOrders.map((order) => {
                          const orderLabel = getOrderDisplayLabel(order);

                          return (
                            <Surface key={order.id} padding={2} style={{ backgroundColor: "#fffaf2", borderColor: "#c8bda8", borderWidth: 1 }}>
                              <Stack gap={1}>
                                <Row justify="space-between" align="center">
                                  <TextPrimitive variant="bodySm" style={{ color: "#6f6252", fontWeight: "800", letterSpacing: -0.1 }}>
                                    {orderLabel}
                                  </TextPrimitive>
                                  <TextPrimitive
                                    variant="bodySm"
                                    style={{
                                      color: "#6f6252",
                                      fontWeight: "900",
                                      letterSpacing: 0.6,
                                      textTransform: "uppercase",
                                    }}
                                  >
                                    {order.status}
                                  </TextPrimitive>
                                </Row>
                              </Stack>
                            </Surface>
                          );
                      })}
                    </Stack>
                  ) : null}

                  {selectedOrderFilter === "SENT" && !isManager && filteredActiveOrders.length > 0 ? (
                    <Surface padding={1} style={{ backgroundColor: "#f6f2eb", borderColor: "#c8bda8", borderWidth: 0 }}>
                      <TextPrimitive variant="bodySm" style={{ color: "#6f6252", fontWeight: "600" }}>
                        Sent orders are with the kitchen. Manager actions are hidden for staff.
                      </TextPrimitive>
                    </Surface>
                  ) : null}
                </Stack>
              )}
            </ScrollView>
          </View>

          <View
            style={{
              backgroundColor: "#efe7d8",
              borderColor: "#c8bda8",
              borderTopWidth: 1,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderBottomWidth: 1,
              borderRadius: 10,
              padding: 0,
              opacity: 0.96,
            }}
          >
            <Stack gap={2}>
              <ButtonPrimitive
                hierarchy="secondary"
                label={hasUnsafeConnectionState ? "Ordering Locked" : "Ordering Mode"}
                disabled={hasUnsafeConnectionState}
                onPress={() => router.push(`/table/${safeTableId}/order`)}
              />

              <ButtonPrimitive
                hierarchy="destructive"
                label={resetPending ? "Resetting" : isResetBlocked ? "Reset Locked" : "Reset Table"}
                disabled={resetPending || isResetBlocked || hasUnsafeConnectionState}
                onPress={() => {
                  setResetError(null);
                  setShowResetConfirm(true);
                }}
              />
            </Stack>
          </View>
        </View>

        <ModalShell
          visible={showResetConfirm}
          title="Reset Table"
          description={
            isResetBlocked
              ? "Complete or close all orders before resetting"
              : "Reset this table? This will clear all activity."
          }
          confirmLabel={resetPending ? "Resetting" : isResetBlocked ? "Reset Locked" : "Confirm Reset"}
          cancelLabel="Cancel"
          onConfirm={handleResetTable}
          onCancel={() => {
            if (resetPending) {
              return;
            }

            setShowResetConfirm(false);
          }}
        />
      </View>
    </View>
  );
}
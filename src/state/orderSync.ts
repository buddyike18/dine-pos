import { listActiveOrders } from "../lib/api";
import { floorTablesStore } from "./floorTables.store";
import { resolveHighestPriorityState } from "../design-system/foundations/statePriority";

const POLL_INTERVAL_MS = 5000;

const TABLE_ID_ALIASES: Record<string, string> = {
  T1: "41",
  T2: "42",
  T3: "43",
  T4: "44",
  MAIN: "MAIN",
  FLOOR1: "FLOOR1",
  FLOOR2: "FLOOR2",
  FLOOR3: "FLOOR3",
  FLOOR4: "FLOOR4",
};

type SeenOrderSnapshot = {
  status: string;
};

function getAwarenessEventKey(kind: "order-created" | "order-ready", orderId: string): string {
  return `${kind}:${orderId}`;
}

const seenOrders = new Map<string, SeenOrderSnapshot>();
let hasSeededBaseline = false;

let pollHandle: ReturnType<typeof setInterval> | null = null;
let isPolling = false;
let getToken: (() => Promise<string | null>) | null = null;
let hasUnknownActiveTableMismatch = false;
let hasMalformedActiveOrders = false;

function normalizeTableId(tableId: string | number | null | undefined): string | null {
  if (tableId === null || tableId === undefined) return null;

  const normalized = String(tableId).trim();
  if (normalized.length === 0) {
    return null;
  }

  const upperNormalized = normalized.toUpperCase();
  return TABLE_ID_ALIASES[upperNormalized] ?? normalized;
}

function normalizeStatus(status: string | null | undefined): string {
  return String(status ?? "").trim().toUpperCase();
}

async function pollOrders() {
  if (isPolling) return;
  isPolling = true;

  try {
    const token = getToken ? await getToken() : null;
    if (!token) {
      floorTablesStore.setAwarenessDegraded();
      return;
    }

    const orders = await listActiveOrders({ token });
    const activeOrderIds = new Set<string>();
    const nextTableStates = new Map<string, Array<"active" | "ready">>();
    const shouldEmitAwarenessEvents = hasSeededBaseline;
    hasUnknownActiveTableMismatch = false;
    hasMalformedActiveOrders = false;

    for (const order of orders) {
      const orderId = String(order.id ?? "").trim();
      const tableId = normalizeTableId(order.table_id);
      const checkId =
        order.check_id === undefined || order.check_id === null
          ? null
          : String(order.check_id).trim().length > 0
            ? String(order.check_id).trim()
            : null;
      const status = normalizeStatus(order.status);
      const orderType =
        typeof order.type === "string"
          ? order.type.trim().toUpperCase()
          : "DINE_IN";

      const hasActiveStatus =
        status === "OPEN" || status === "SENT" || status === "READY";
      const hasTableContext = Boolean(tableId);
      const hasCheckContext = Boolean(checkId);

      const hasValidServiceContext =
        orderType === "QUICK"
          ? !hasTableContext && !hasCheckContext
          : hasTableContext !== hasCheckContext;

      if (!orderId || !hasActiveStatus || !hasValidServiceContext) {
        hasMalformedActiveOrders = true;
        console.warn("[orderSync] malformed active order skipped", {
          rawOrder: order,
          normalizedOrderId: orderId,
          normalizedTableId: tableId,
          normalizedCheckId: checkId,
          normalizedStatus: status,
          normalizedType: orderType,
        });
        continue;
      }

      activeOrderIds.add(orderId);

      if (orderType === "QUICK") {
        seenOrders.set(orderId, { status });
        continue;
      }

      if (checkId && !tableId) {
        seenOrders.set(orderId, { status });
        continue;
      }

      if (!tableId) {
        hasMalformedActiveOrders = true;
        continue;
      }

      const hasKnownTable = floorTablesStore.getTables().some((table) => table.id === tableId);
      if (!hasKnownTable) {
        hasUnknownActiveTableMismatch = true;
        console.warn(`[orderSync] active order references unknown tableId: ${tableId}`, {
          orderId,
          rawTableId: order.table_id,
          status,
        });
        continue;
      }

      const statesForTable = nextTableStates.get(tableId) ?? [];
      statesForTable.push(status === "READY" ? "ready" : "active");
      nextTableStates.set(tableId, statesForTable);

      const previous = seenOrders.get(orderId);
      const isNewOrder = !previous;
      const becameReady = !!previous && previous.status !== "READY" && status === "READY";

      if (shouldEmitAwarenessEvents && isNewOrder) {
        floorTablesStore.incrementUnseenOnce(
          tableId,
          getAwarenessEventKey("order-created", orderId)
        );
      }

      if (shouldEmitAwarenessEvents && becameReady) {
        floorTablesStore.incrementUnseenOnce(
          tableId,
          getAwarenessEventKey("order-ready", orderId)
        );
      }

      seenOrders.set(orderId, { status });
    }

    for (const table of floorTablesStore.getTables()) {
      const statesForTable = nextTableStates.get(table.id);

      if (!statesForTable || statesForTable.length === 0) {
        floorTablesStore.setTableState(table.id, resolveHighestPriorityState(["idle"]));
        continue;
      }

      floorTablesStore.setTableState(
        table.id,
        resolveHighestPriorityState(statesForTable)
      );
    }

    for (const orderId of Array.from(seenOrders.keys())) {
      if (!activeOrderIds.has(orderId)) {
        seenOrders.delete(orderId);
      }
    }
    hasSeededBaseline = true;
    if (hasUnknownActiveTableMismatch || hasMalformedActiveOrders) {
      floorTablesStore.setAwarenessDegraded();
    } else {
      floorTablesStore.setAwarenessHealthy();
    }
  } catch (error) {
    console.warn("[orderSync] poll failed", error);
    floorTablesStore.setAwarenessDegraded();
  } finally {
    isPolling = false;
  }
}

export function startOrderSync(tokenProvider?: () => Promise<string | null>) {
  if (pollHandle) return;

  if (tokenProvider) {
    getToken = tokenProvider;
  }

  void pollOrders();
  pollHandle = setInterval(() => {
    void pollOrders();
  }, POLL_INTERVAL_MS);
}

export function stopOrderSync() {
  if (!pollHandle) return;

  clearInterval(pollHandle);
  pollHandle = null;
  isPolling = false;
  getToken = null;
  seenOrders.clear();
  hasSeededBaseline = false;
  hasUnknownActiveTableMismatch = false;
  hasMalformedActiveOrders = false;
  floorTablesStore.setAwarenessHealthy();
}
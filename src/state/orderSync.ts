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
      const status = normalizeStatus(order.status);

      if (!orderId || !tableId || (status !== "OPEN" && status !== "SENT" && status !== "READY")) {
        hasMalformedActiveOrders = true;
        console.warn("[orderSync] malformed active order skipped", {
          rawOrder: order,
          normalizedOrderId: orderId,
          normalizedTableId: tableId,
          normalizedStatus: status,
        });
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

      activeOrderIds.add(orderId);

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
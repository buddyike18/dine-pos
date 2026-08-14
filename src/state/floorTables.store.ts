import { TableState } from "../design-system/foundations/statePriority";

export type FloorTable = {
  id: string;
  label: string;
  state: TableState;
  unseenCount: number;
};

type AwarenessEventKey = string;
type AwarenessStatus = "healthy" | "degraded";
export type FloorTablesSnapshot = {
  tables: FloorTable[];
  awarenessStatus: AwarenessStatus;
};
type FloorTablesListener = (snapshot: FloorTablesSnapshot) => void;

type FloorTablesState = {
  getSnapshot: () => FloorTablesSnapshot;
  getTables: () => FloorTable[];
  subscribe: (listener: FloorTablesListener) => () => void;
  incrementUnseen: (tableId: string) => void;
  incrementUnseenOnce: (tableId: string, eventKey: AwarenessEventKey) => void;
  clearBadge: (tableId: string) => void;
  resetTable: (tableId: string) => void;
  setTableState: (tableId: string, state: TableState) => void;
  setAwarenessHealthy: () => void;
  setAwarenessDegraded: () => void;
};

const BASE_TABLES: FloorTable[] = [
  { id: "11", label: "11", state: "idle", unseenCount: 0 },
  { id: "12", label: "12", state: "idle", unseenCount: 0 },
  { id: "13", label: "13", state: "idle", unseenCount: 0 },
  { id: "14", label: "14", state: "idle", unseenCount: 0 },

  { id: "21", label: "21", state: "idle", unseenCount: 0 },
  { id: "22", label: "22", state: "idle", unseenCount: 0 },
  { id: "23", label: "23", state: "idle", unseenCount: 0 },
  { id: "24", label: "24", state: "idle", unseenCount: 0 },

  { id: "31", label: "31", state: "idle", unseenCount: 0 },
  { id: "32", label: "32", state: "idle", unseenCount: 0 },
  { id: "33", label: "33", state: "idle", unseenCount: 0 },
  { id: "34", label: "34", state: "idle", unseenCount: 0 },
  { id: "35", label: "35", state: "idle", unseenCount: 0 },

  { id: "41", label: "41", state: "idle", unseenCount: 0 },
  { id: "42", label: "42", state: "idle", unseenCount: 0 },
  { id: "43", label: "43", state: "idle", unseenCount: 0 },
  { id: "44", label: "44", state: "idle", unseenCount: 0 },
  { id: "45", label: "45", state: "idle", unseenCount: 0 },

  { id: "51", label: "51", state: "idle", unseenCount: 0 },
  { id: "52", label: "52", state: "idle", unseenCount: 0 },
  { id: "53", label: "53", state: "idle", unseenCount: 0 },

  { id: "61", label: "61", state: "idle", unseenCount: 0 },
  { id: "62", label: "62", state: "idle", unseenCount: 0 },
  { id: "63", label: "63", state: "idle", unseenCount: 0 },

  { id: "71", label: "71", state: "idle", unseenCount: 0 },
  { id: "72", label: "72", state: "idle", unseenCount: 0 },
  { id: "73", label: "73", state: "idle", unseenCount: 0 },
  { id: "74", label: "74", state: "idle", unseenCount: 0 },
  { id: "75", label: "75", state: "idle", unseenCount: 0 },
  { id: "76", label: "76", state: "idle", unseenCount: 0 },

  { id: "main", label: "Main", state: "idle", unseenCount: 0 },
  { id: "floor1", label: "Floor 1", state: "idle", unseenCount: 0 },
  { id: "floor2", label: "Floor 2", state: "idle", unseenCount: 0 },
  { id: "floor3", label: "Floor 3", state: "idle", unseenCount: 0 },
  { id: "floor4", label: "Floor 4", state: "idle", unseenCount: 0 },
];

let tables: FloorTable[] = [...BASE_TABLES];
let awarenessStatus: AwarenessStatus = "healthy";
const processedAwarenessEventKeys = new Set<AwarenessEventKey>();
const listeners = new Set<FloorTablesListener>();

function emitChange() {
  const snapshot: FloorTablesSnapshot = {
    tables: [...tables],
    awarenessStatus,
  };

  listeners.forEach((listener) => {
    listener(snapshot);
  });
}

export const floorTablesStore: FloorTablesState = {
  getSnapshot() {
    return {
      tables: [...tables],
      awarenessStatus,
    };
  },

  getTables() {
    return [...tables];
  },

  subscribe(listener) {
    listeners.add(listener);
    listener({
      tables: [...tables],
      awarenessStatus,
    });

    return () => {
      listeners.delete(listener);
    };
  },

  incrementUnseen(tableId) {
    const hasTable = tables.some((t) => t.id === tableId);
    if (!hasTable) {
      if (__DEV__) {
        console.warn(
          `[floorTablesStore] incrementUnseen called with unknown tableId: ${tableId}`
        );
      }
      return;
    }

    let changed = false;
    tables = tables.map((t) => {
      if (t.id !== tableId) {
        return t;
      }

      changed = true;
      return { ...t, unseenCount: t.unseenCount + 1 };
    });

    if (changed) {
      emitChange();
    }
  },

  incrementUnseenOnce(tableId, eventKey) {
    if (processedAwarenessEventKeys.has(eventKey)) {
      return;
    }

    const hasTable = tables.some((t) => t.id === tableId);
    if (!hasTable) {
      if (__DEV__) {
        console.warn(
          `[floorTablesStore] incrementUnseenOnce called with unknown tableId: ${tableId}`
        );
      }
      return;
    }

    let changed = false;
    tables = tables.map((t) => {
      if (t.id !== tableId) {
        return t;
      }

      changed = true;
      return { ...t, unseenCount: t.unseenCount + 1 };
    });

    if (!changed) {
      return;
    }

    processedAwarenessEventKeys.add(eventKey);
    emitChange();
  },

  clearBadge(tableId) {
    const hasTable = tables.some((t) => t.id === tableId);
    if (!hasTable) {
      if (__DEV__) {
        console.warn(
          `[floorTablesStore] clearBadge called with unknown tableId: ${tableId}`
        );
      }
      return;
    }

    let changed = false;
    tables = tables.map((t) => {
      if (t.id !== tableId || t.unseenCount === 0) {
        return t;
      }

      changed = true;
      return { ...t, unseenCount: 0 };
    });

    if (changed) {
      emitChange();
    }
  },

  resetTable(tableId) {
    const hasTable = tables.some((t) => t.id === tableId);
    if (!hasTable) {
      if (__DEV__) {
        console.warn(
          `[floorTablesStore] resetTable called with unknown tableId: ${tableId}`
        );
      }
      return;
    }

    let changed = false;
    tables = tables.map((t) => {
      if (t.id !== tableId || t.unseenCount === 0) {
        return t;
      }

      changed = true;
      return { ...t, unseenCount: 0 };
    });

    if (changed) {
      emitChange();
    }
  },

  setTableState(tableId, state) {
    const hasTable = tables.some((t) => t.id === tableId);
    if (!hasTable) {
      if (__DEV__) {
        console.warn(
          `[floorTablesStore] setTableState called with unknown tableId: ${tableId}`
        );
      }
      return;
    }

    let changed = false;
    tables = tables.map((t) => {
      if (t.id !== tableId) {
        return t;
      }

      if (t.state === state) {
        return t;
      }

      changed = true;
      return {
        ...t,
        state,
      };
    });

    if (changed) {
      emitChange();
    }
  },

  setAwarenessHealthy() {
    if (awarenessStatus === "healthy") {
      return;
    }

    awarenessStatus = "healthy";
    emitChange();
  },

  setAwarenessDegraded() {
    if (awarenessStatus === "degraded") {
      return;
    }

    awarenessStatus = "degraded";
    emitChange();
  },
};
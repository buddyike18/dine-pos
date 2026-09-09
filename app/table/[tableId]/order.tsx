import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";

import PosOrderingWorkspace, {
  type PosOrderContext,
} from "../../../src/features/orders/PosOrderingWorkspace";
import { floorTablesStore } from "../../../src/state/floorTables.store";
import { resolveHighestPriorityState } from "../../../src/design-system/foundations/statePriority";

const STATE_LABELS: Record<string, string> = {
  urgent: "NEEDS ATTENTION",
  ready: "READY",
  paid: "SENT",
  active: "OPEN",
  idle: "IDLE",
};

export default function OrderingModeScreen() {
  const { tableId } = useLocalSearchParams<{ tableId: string }>();

  const safeTableId =
    typeof tableId === "string" ? tableId.trim() : "";
  const hasValidTableId = safeTableId.length > 0;

  const [storeTables, setStoreTables] = useState(
    floorTablesStore.getTables()
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setStoreTables(floorTablesStore.getTables());
    }, 250);

    return () => clearInterval(interval);
  }, []);

  const table = useMemo(() => {
    return storeTables.find((t) => t.id === safeTableId);
  }, [safeTableId, storeTables]);

  const resolvedState = useMemo(() => {
    if (!table) return "idle";
    return resolveHighestPriorityState([table.state]);
  }, [table]);

  const context: PosOrderContext = {
    kind: "TABLE",
    id: safeTableId,
    displayLabel: table?.label ?? "Unknown",
    statusLabel:
      STATE_LABELS[resolvedState] ?? resolvedState.toUpperCase(),
    unavailable: !hasValidTableId || !table,
    unavailableMessage:
      "Table unavailable. Return to floorboard and try again.",
  };

  return <PosOrderingWorkspace context={context} />;
}

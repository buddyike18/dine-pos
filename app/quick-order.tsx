import PosOrderingWorkspace from "../src/features/orders/PosOrderingWorkspace";

export default function QuickOrderScreen() {
  return (
    <PosOrderingWorkspace
      context={{
        kind: "QUICK",
        displayLabel: "Quick Order",
        statusLabel: "OPEN",
        unavailable: false,
        unavailableMessage: "Quick Order unavailable.",
      }}
    />
  );
}

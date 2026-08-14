// src/design-system/components/TableTile/TableTile.tsx
import React from "react";
import { Pressable, View, ViewStyle } from "react-native";

import { TableState } from "../../foundations/statePriority";
import { Space } from "../../tokens/spacing";

import { toStyle } from "../../utils/toStyle";
import { assertValidSpacing } from "../../utils/assertTokens";

import { Surface } from "../../primitives/Surface/Surface";
import { Row } from "../../primitives/Row/Row";
import { Stack } from "../../primitives/Stack/Stack";
import { TextPrimitive } from "../../primitives/TextPrimitive/TextPrimitive";
import { Badge } from "../../primitives/Badge/Badge";

/**
 * TableTile
 *
 * Floor Board atomic unit.
 *
 * Contains only:
 * - Table identifier
 * - Single resolved table state (visual)
 * - Badge (unseen increments) — shown only if count > 0
 *
 * Prohibitions:
 * - No revenue
 * - No item list
 * - No timestamps
 * - No micro-details
 */

interface TableTileProps {
  tableLabel: string; // e.g. "T1"
  state: TableState;
  assignedStaffName?: string;

  /**
   * Unseen badge count.
   * Incremented upstream on Paid + Ready events only.
   * Cleared upstream when table is opened.
   */
  unseenCount: number;

  onPress: () => void;

  /**
   * Tile sizing is controlled by the Floor Board grid.
   * Tile must not enforce explicit width/height.
   */
  padding?: Space;
  style?: ViewStyle;
}

const STATE_LABELS: Record<TableState, string> = {
  urgent: "NEEDS ATTENTION",
  ready: "READY",
  paid: "SENT",
  active: "OPEN",
  idle: "IDLE",
};

export const TableTile: React.FC<TableTileProps> = ({
  tableLabel,
  state,
  assignedStaffName,
  unseenCount,
  onPress,
  padding = 2, // 16
  style,
}) => {
  const resolvedPadding = toStyle.spacing(padding);

  if (__DEV__) {
    assertValidSpacing(resolvedPadding);
  }

  const stateAccent = state; // maps 1:1 to StateToken names in colors.ts
  const isIdle = state === "idle";
  const isReadySignal = state === "ready" || state === "urgent";

  const containerStyle: ViewStyle = {
    flex: 1,
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        containerStyle,
        style,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Surface
        padding={padding}
        elevation={0}
        stateAccent={stateAccent}
        style={{
          backgroundColor: "#fffaf2",
          borderColor: "#c8bda8",
          borderWidth: 1,
          minHeight: 84,
        }}
      >
        <Row justify="space-between" align="flex-start" gap={2}>
          <Stack gap={1}>
            <TextPrimitive
              variant="headingLg"
              weight="bold"
              neutralColor={900}
            >
              {tableLabel}
            </TextPrimitive>

            <TextPrimitive
              variant="bodySm"
              weight={isReadySignal ? "bold" : isIdle ? "regular" : "bold"}
              neutralColor={isIdle ? 500 : 700}
            >
              {STATE_LABELS[state]}
            </TextPrimitive>

            {assignedStaffName ? (
              <TextPrimitive variant="bodySm" weight="regular" neutralColor={600}>
                Server: {assignedStaffName}
              </TextPrimitive>
            ) : null}
          </Stack>

          <View style={{ transform: [{ scale: 0.86 }], marginTop: -2 }}>
            {unseenCount > 0 ? (
              <Badge
                count={unseenCount}
                state={
                  state === "urgent"
                    ? "urgent"
                    : state === "ready"
                    ? "ready"
                    : state === "paid"
                    ? "paid"
                    : "active"
                }
              />
            ) : null}
          </View>
        </Row>
      </Surface>
    </Pressable>
  );
};

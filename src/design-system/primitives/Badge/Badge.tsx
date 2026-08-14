

// src/design-system/primitives/Badge/Badge.tsx

import React from "react";
import { View, ViewStyle } from "react-native";

import { StateToken } from "../../tokens/colors";
import { Radius } from "../../tokens/radius";
import { Space } from "../../tokens/spacing";

import { toStyle } from "../../utils/toStyle";
import {
  assertValidColor,
  assertValidRadius,
  assertValidSpacing,
} from "../../utils/assertTokens";

import { TextPrimitive } from "../TextPrimitive/TextPrimitive";

/**
 * Badge
 *
 * Event increment indicator.
 *
 * Rules:
 * - Only increments on Paid + Ready events (enforced upstream).
 * - Clears when table is opened (enforced upstream).
 * - Not visible if count <= 0.
 * - Displays "9+" if count > 9.
 * - Red only if state === "urgent".
 * - No raw styling values allowed.
 */

interface BadgeProps {
  count: number;
  state?: StateToken; // optional override (e.g. urgent)
  radius?: Radius;
  paddingX?: Space;
  paddingY?: Space;
  style?: ViewStyle;
}

export const Badge: React.FC<BadgeProps> = ({
  count,
  state = "active",
  radius = "sm",
  paddingX = 1, // 8
  paddingY = 1, // 8
  style,
}) => {
  if (count <= 0) return null;

  const displayValue = count > 9 ? "9+" : String(count);

  const resolvedRadius = toStyle.radius(radius);
  const resolvedPaddingX = toStyle.spacing(paddingX);
  const resolvedPaddingY = toStyle.spacing(paddingY);
  const resolvedBackground = toStyle.stateColor(
    state === "urgent" ? "urgent" : state
  );

  if (__DEV__) {
    assertValidRadius(resolvedRadius);
    assertValidSpacing(resolvedPaddingX);
    assertValidSpacing(resolvedPaddingY);
    assertValidColor(resolvedBackground);
  }

  const baseStyle: ViewStyle = {
    backgroundColor: resolvedBackground,
    borderRadius: resolvedRadius,
    paddingHorizontal: resolvedPaddingX,
    paddingVertical: resolvedPaddingY,
    alignSelf: "flex-start",
    minWidth: resolvedPaddingX * 2,
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <View style={[baseStyle, style]}>
      <TextPrimitive
        variant="labelSm"
        weight="bold"
        neutralColor={0}
      >
        {displayValue}
      </TextPrimitive>
    </View>
  );
};
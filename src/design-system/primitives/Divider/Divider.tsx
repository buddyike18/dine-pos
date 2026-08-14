

// src/design-system/primitives/Divider/Divider.tsx

import React from "react";
import { View, ViewStyle } from "react-native";

import { Space } from "../../tokens/spacing";
import { toStyle } from "../../utils/toStyle";
import { assertValidSpacing, assertValidColor } from "../../utils/assertTokens";

/**
 * Divider
 *
 * Hard structural separator.
 * Always 1px height.
 * Always neutral-200.
 * No decorative variants.
 */

interface DividerProps {
  insetX?: Space; // horizontal inset using spacing tokens
  style?: ViewStyle;
}

export const Divider: React.FC<DividerProps> = ({
  insetX,
  style,
}) => {
  const horizontalInset =
    insetX !== undefined ? toStyle.spacing(insetX) : 0;

  const color = toStyle.neutralColor(200);

  if (__DEV__) {
    if (insetX !== undefined) {
      assertValidSpacing(horizontalInset);
    }
    assertValidColor(color);
  }

  const baseStyle: ViewStyle = {
    height: 1,
    backgroundColor: color,
    marginHorizontal: horizontalInset,
    width: "100%",
  };

  return <View style={[baseStyle, style]} />;
};
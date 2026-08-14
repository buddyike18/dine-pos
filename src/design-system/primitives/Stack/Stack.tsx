

// src/design-system/primitives/Stack/Stack.tsx

import React from "react";
import { View, ViewStyle } from "react-native";

import { Space } from "../../tokens/spacing";
import { toStyle } from "../../utils/toStyle";
import { assertValidSpacing } from "../../utils/assertTokens";

interface StackProps {
  children: React.ReactNode;
  gap?: Space;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  style?: ViewStyle;
}

/**
 * Stack
 *
 * Vertical layout primitive.
 * Enforces 8pt spacing system.
 * No margins allowed inside children — use gap only.
 */
export const Stack: React.FC<StackProps> = ({
  children,
  gap,
  align,
  justify,
  style,
}) => {
  const resolvedGap = gap !== undefined ? toStyle.spacing(gap) : 0;

  if (__DEV__ && gap !== undefined) {
    assertValidSpacing(resolvedGap);
  }

  const baseStyle: ViewStyle = {
    flexDirection: "column",
    alignItems: align,
    justifyContent: justify,
    rowGap: resolvedGap,
  };

  return <View style={[baseStyle, style]}>{children}</View>;
};
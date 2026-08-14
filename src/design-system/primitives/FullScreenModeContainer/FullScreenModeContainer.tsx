// src/design-system/primitives/FullScreenModeContainer/FullScreenModeContainer.tsx

import React from "react";
import { View, ViewStyle, SafeAreaView } from "react-native";

import { Space } from "../../tokens/spacing";
import { background } from "../../tokens/colors";
import { toStyle } from "../../utils/toStyle";
import { assertValidSpacing, assertValidColor } from "../../utils/assertTokens";

/**
 * FullScreenModeContainer
 *
 * Used exclusively for Ordering Mode.
 *
 * Rules:
 * - Occupies full device frame.
 * - Hides floor navigation (handled upstream).
 * - No split panels.
 * - No floating overlays.
 * - Fixed background (app background).
 * - Token-locked padding.
 */

interface FullScreenModeContainerProps {
  children: React.ReactNode;
  padding?: Space;
  style?: ViewStyle;
}

export const FullScreenModeContainer: React.FC<
  FullScreenModeContainerProps
> = ({ children, padding = 3, style }) => {
  const resolvedPadding = toStyle.spacing(padding);
  const backgroundColor = background.app;

  if (__DEV__) {
    assertValidSpacing(resolvedPadding);
    assertValidColor(backgroundColor);
  }

  const baseStyle: ViewStyle = {
    flex: 1,
    backgroundColor,
    padding: resolvedPadding,
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={[baseStyle, style]}>{children}</View>
    </SafeAreaView>
  );
};

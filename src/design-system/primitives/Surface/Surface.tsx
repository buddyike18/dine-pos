

// src/design-system/primitives/Surface/Surface.tsx

import React from "react";
import { View, ViewStyle } from "react-native";

import { Space } from "../../tokens/spacing";
import { Radius } from "../../tokens/radius";
import { ElevationLevel } from "../../tokens/elevation";
import { StateToken } from "../../tokens/colors";

import { toStyle } from "../../utils/toStyle";
import {
  assertValidSpacing,
  assertValidRadius,
  assertValidColor,
} from "../../utils/assertTokens";

interface SurfaceProps {
  children: React.ReactNode;

  padding?: Space;
  radius?: Radius;
  elevation?: ElevationLevel;

  /**
   * Optional state accent strip (left border).
   * Used to communicate table state without full fill.
   */
  stateAccent?: StateToken;

  style?: ViewStyle;
}

/**
 * Surface
 *
 * Structural container.
 * No business logic.
 * No layout decisions beyond token application.
 */
export const Surface: React.FC<SurfaceProps> = ({
  children,
  padding,
  radius = "md",
  elevation = 0,
  stateAccent,
  style,
}) => {
  const resolvedPadding =
    padding !== undefined ? toStyle.spacing(padding) : undefined;

  const resolvedRadius = toStyle.radius(radius);
  const resolvedElevation = toStyle.elevation(elevation);

  if (__DEV__) {
    if (resolvedPadding !== undefined) {
      assertValidSpacing(resolvedPadding);
    }

    assertValidRadius(resolvedRadius);

    if (stateAccent) {
      const color = toStyle.stateColor(stateAccent);
      assertValidColor(color);
    }
  }

  const baseStyle: ViewStyle = {
    backgroundColor: toStyle.neutralColor(0),
    borderRadius: resolvedRadius,
    ...resolvedElevation,
  };

  if (resolvedPadding !== undefined) {
    baseStyle.padding = resolvedPadding;
  }

  if (stateAccent) {
    baseStyle.borderLeftWidth = 6;
    baseStyle.borderLeftColor = toStyle.stateColor(stateAccent);
  }

  return <View style={[baseStyle, style]}>{children}</View>;
};
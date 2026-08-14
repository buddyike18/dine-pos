

// src/design-system/primitives/TextPrimitive/TextPrimitive.tsx

import React from "react";
import { Text, TextStyle } from "react-native";

import {
  TypeVariant,
  FontWeight,
} from "../../tokens/typography";
import {
  NeutralToken,
  StateToken,
} from "../../tokens/colors";

import { toStyle } from "../../utils/toStyle";
import {
  assertValidColor,
  assertValidTypography,
} from "../../utils/assertTokens";

interface TextPrimitiveProps {
  children: React.ReactNode;

  variant: TypeVariant;
  weight?: FontWeight;

  /**
   * Either neutral or state color token.
   * No raw hex values allowed.
   */
  neutralColor?: NeutralToken;
  stateColor?: StateToken;

  align?: TextStyle["textAlign"];

  style?: TextStyle;
}

/**
 * TextPrimitive
 *
 * Token-locked typography component.
 * No inline font styling.
 * No raw color values.
 * No letter spacing adjustments.
 */
export const TextPrimitive: React.FC<TextPrimitiveProps> = ({
  children,
  variant,
  weight = "regular",
  neutralColor,
  stateColor,
  align,
  style,
}) => {
  const typography = toStyle.typography(variant, weight);

  const resolvedColor = stateColor
    ? toStyle.stateColor(stateColor)
    : neutralColor !== undefined
    ? toStyle.neutralColor(neutralColor)
    : toStyle.neutralColor(900);

  if (__DEV__) {
    assertValidTypography(
      typography.fontSize,
      typography.lineHeight
    );
    assertValidColor(resolvedColor);
  }

  const baseStyle: TextStyle = {
    ...typography,
    color: resolvedColor,
    textAlign: align,
  };

  return <Text style={[baseStyle, style]}>{children}</Text>;
};
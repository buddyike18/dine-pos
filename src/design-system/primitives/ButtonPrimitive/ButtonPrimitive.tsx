// src/design-system/primitives/ButtonPrimitive/ButtonPrimitive.tsx

import React from "react";
import { Pressable, ViewStyle, GestureResponderEvent } from "react-native";

import {
  InteractionHierarchy,
  BUTTON_HEIGHT,
  resolveInteraction,
} from "../../tokens/interaction";
import { Radius } from "../../tokens/radius";

import { toStyle } from "../../utils/toStyle";
import { assertValidColor, assertValidRadius } from "../../utils/assertTokens";

import { TextPrimitive } from "../TextPrimitive/TextPrimitive";

interface ButtonPrimitiveProps {
  label: string;

  hierarchy: InteractionHierarchy;

  onPress: (event: GestureResponderEvent) => void;

  disabled?: boolean;
  fullWidth?: boolean;

  radius?: Radius;

  style?: ViewStyle;
}

/**
 * ButtonPrimitive
 *
 * Strict interaction control.
 * Fixed height (48).
 * Single-line label only.
 * Token-locked colors + typography (no inline overrides).
 */
export const ButtonPrimitive: React.FC<ButtonPrimitiveProps> = ({
  label,
  hierarchy,
  onPress,
  disabled = false,
  fullWidth = false,
  radius = "sm",
  style,
}) => {
  const resolvedInteraction = resolveInteraction(hierarchy);
  const resolvedRadius = toStyle.radius(radius);

  if (__DEV__) {
    assertValidRadius(resolvedRadius);
    assertValidColor(resolvedInteraction.backgroundColor);
    assertValidColor(resolvedInteraction.borderColor);
  }

  const baseStyle: ViewStyle = {
    height: BUTTON_HEIGHT,
    borderRadius: resolvedRadius,
    backgroundColor: disabled
      ? toStyle.neutralColor(200)
      : resolvedInteraction.backgroundColor,
    borderWidth: resolvedInteraction.borderWidth,
    borderColor: resolvedInteraction.borderColor,
    alignItems: "center",
    justifyContent: "center",
    width: fullWidth ? "100%" : undefined,
    opacity: disabled ? 0.6 : 1,
  };

  // Text color is token-locked (no raw values).
  // - Disabled: neutral-500
  // - Secondary: neutral-700
  // - Primary/Destructive: neutral-0
  const textNeutralToken = disabled
    ? 500
    : hierarchy === "secondary"
    ? 700
    : 0;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[baseStyle, style]}
    >
      <TextPrimitive variant="bodyMd" weight="bold" neutralColor={textNeutralToken}>
        {label}
      </TextPrimitive>
    </Pressable>
  );
};
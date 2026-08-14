// src/design-system/primitives/ModalShell/ModalShell.tsx

import React from "react";
import {
  Modal,
  View,
  ViewStyle,
  Pressable,
} from "react-native";

import { Space } from "../../tokens/spacing";
import { Radius } from "../../tokens/radius";

import { toStyle } from "../../utils/toStyle";
import {
  assertValidSpacing,
  assertValidRadius,
  assertValidColor,
} from "../../utils/assertTokens";

import { Surface } from "../Surface/Surface";
import { Stack } from "../Stack/Stack";
import { Row } from "../Row/Row";
import { TextPrimitive } from "../TextPrimitive/TextPrimitive";
import { ButtonPrimitive } from "../ButtonPrimitive/ButtonPrimitive";

/**
 * ModalShell
 *
 * Strict destructive confirmation container.
 *
 * Rules:
 * - Locks background interaction.
 * - Destructive button on right.
 * - Secondary cancel on left.
 * - No swipe-to-dismiss.
 * - Explicit close required.
 */

interface ModalShellProps {
  visible: boolean;

  title: string;
  description?: string;

  confirmLabel: string;
  cancelLabel: string;

  onConfirm: () => void;
  onCancel: () => void;

  padding?: Space;
  radius?: Radius;

  style?: ViewStyle;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  visible,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  padding = 4, // 32
  radius = "lg",
  style,
}) => {
  const resolvedPadding = toStyle.spacing(padding);
  const resolvedRadius = toStyle.radius(radius);
  const overlayColor = toStyle.neutralColor(900);

  if (__DEV__) {
    assertValidSpacing(resolvedPadding);
    assertValidRadius(resolvedRadius);
    assertValidColor(overlayColor);
  }

  const overlayStyle: ViewStyle = {
    flex: 1,
    backgroundColor: overlayColor,
    opacity: 0.4,
    justifyContent: "center",
    alignItems: "center",
  };

  const containerStyle: ViewStyle = {
    width: "80%",
    maxWidth: 520,
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {}} // explicit only
    >
      <Pressable style={overlayStyle} onPress={() => {}}>
        <View style={containerStyle}>
          <Surface
            padding={padding}
            radius={radius}
            elevation={2}
            style={style}
          >
            <Stack gap={4}>
              <Stack gap={2}>
                <TextPrimitive
                  variant="headingLg"
                  weight="semibold"
                >
                  {title}
                </TextPrimitive>

                {description ? (
                  <TextPrimitive
                    variant="bodyMd"
                    neutralColor={700}
                  >
                    {description}
                  </TextPrimitive>
                ) : null}
              </Stack>

              <Row gap={3} justify="flex-end">
                <ButtonPrimitive
                  label={cancelLabel}
                  hierarchy="secondary"
                  onPress={onCancel}
                />
                <ButtonPrimitive
                  label={confirmLabel}
                  hierarchy="destructive"
                  onPress={onConfirm}
                />
              </Row>
            </Stack>
          </Surface>
        </View>
      </Pressable>
    </Modal>
  );
};
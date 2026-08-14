// src/design-system/tokens/interaction.ts

import { neutral, state, surface } from "./colors";

/**
 * Interaction hierarchy — strict and limited.
 * Only three levels: primary, secondary, destructive.
 */

export const BUTTON_HEIGHT = 48 as const;

export const interaction = {
  primary: {
    backgroundColor: state.active,
    borderWidth: 0,
    borderColor: neutral[0],
    textColor: neutral[0],
  },
  secondary: {
    backgroundColor: surface.default,
    borderWidth: 1,
    borderColor: surface.border,
    textColor: neutral[700],
  },
  destructive: {
    backgroundColor: state.urgent,
    borderWidth: 0,
    borderColor: neutral[0],
    textColor: neutral[0],
  },
} as const;

export type InteractionHierarchy = keyof typeof interaction;

/**
 * Guard function to prevent custom interaction styling.
 * Use only in primitives.
 */
export function resolveInteraction(level: InteractionHierarchy) {
  return interaction[level];
}
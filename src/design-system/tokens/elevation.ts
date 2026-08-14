

// src/design-system/tokens/elevation.ts

import { neutral } from "./colors";

/**
 * Elevation system — structural emphasis only.
 * No shadows. No blur. No visual softness.
 */
export const elevation = {
  0: {
    borderWidth: 0,
    borderColor: "transparent",
  },
  1: {
    borderWidth: 1,
    borderColor: neutral[200],
  },
  2: {
    borderWidth: 2,
    borderColor: neutral[300],
  },
} as const;

export type ElevationLevel = keyof typeof elevation;

/**
 * Guard function to prevent custom elevation usage.
 * Use only in primitives.
 */
export function resolveElevation(level: ElevationLevel) {
  return elevation[level];
}
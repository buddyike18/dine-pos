

// src/design-system/tokens/spacing.ts

export const GRID_UNIT = 8 as const;

export const space = {
  1: 8,
  2: 16,
  3: 24,
  4: 32,
  5: 40,
  6: 48,
  7: 56,
  8: 64,
  9: 72,
  10: 80,
} as const;

export type Space = keyof typeof space;

/**
 * Guard function to prevent raw spacing values.
 * Use only in primitives.
 */
export function resolveSpace(token: Space): number {
  return space[token];
}
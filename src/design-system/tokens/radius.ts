

// src/design-system/tokens/radius.ts

export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
} as const;

export type Radius = keyof typeof radius;

/**
 * Guard function to prevent raw radius values.
 * Use only in primitives.
 */
export function resolveRadius(token: Radius): number {
  return radius[token];
}
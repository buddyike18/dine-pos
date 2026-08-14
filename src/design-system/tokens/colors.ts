// src/design-system/tokens/colors.ts

/**
 * Neutral scale — structural foundation only.
 * No decorative usage.
 */
export const neutral = {
  0: "#FFFFFF",
  50: "#F6F7F8",
  100: "#ECEFF1",
  200: "#D6DBDF",
  300: "#B0B7BD",
  400: "#8C939A",
  500: "#5F666C",
  600: "#3E444A",
  700: "#2A2F34",
  800: "#1C2024",
  900: "#111417",
} as const;

export type NeutralToken = keyof typeof neutral;

export const background = {
  app: "#f6f2eb",
} as const;

export const surface = {
  default: "#fffaf2",
  muted: "#f3ede3",
  border: "#c8bda8",
} as const;

/**
 * State colors — meaning only.
 * One urgent state per table.
 */
export const state = {
  idle: neutral[300],
  active: neutral[700],
  paid: "#2F6FED",
  ready: "#1f8f3a",
  urgent: "#C1362F",
  disabled: neutral[200],
} as const;

export type StateToken = keyof typeof state;

/**
 * Guard functions to prevent raw color usage.
 * Use only in primitives.
 */
export function resolveNeutral(token: NeutralToken): string {
  return neutral[token];
}

export function resolveState(token: StateToken): string {
  return state[token];
}
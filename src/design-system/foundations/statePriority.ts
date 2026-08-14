// src/design-system/foundations/statePriority.ts

/**
 * State precedence — single urgent state enforcement.
 *
 * A table may visually communicate only ONE state at a time.
 * Higher index does NOT mean higher priority.
 * Order in this array defines priority from highest → lowest.
 */

export const STATE_PRIORITY = [
  "urgent",
  "ready",
  "paid",
  "active",
  "idle",
] as const;

export type TableState = typeof STATE_PRIORITY[number];

/**
 * Resolves the highest-priority state from a set of possible states.
 * Must be used wherever state is derived.
 */
export function resolveHighestPriorityState(
  states: TableState[]
): TableState {
  if (__DEV__) {
    for (const state of states) {
      if (!STATE_PRIORITY.includes(state)) {
        throw new Error(
          `[StatePriorityViolation] Invalid table state detected: ${state}`
        );
      }
    }
  }

  for (const priority of STATE_PRIORITY) {
    if (states.includes(priority)) {
      return priority;
    }
  }

  return "idle";
}



// src/design-system/foundations/layoutRules.ts

import { space } from "../tokens/spacing";

/**
 * Global layout invariants.
 * These values are structural and cannot be overridden per screen.
 */


/**
 * Pilot Floor Board Grid — 4 tables (2x2 fixed).
 * No responsive experimentation in Phase 1–2.
 */
export const FLOOR_GRID_ROWS = 2 as const;
export const FLOOR_GRID_COLS = 2 as const;

/**
 * Fixed spacing rules.
 * All layout gaps must come from spacing tokens.
 */
export const FLOOR_GRID_GAP = space[3]; // 24

/**
 * Standard surface padding across screens.
 * Prevents improvisational spacing.
 */
export const SURFACE_PADDING = space[3]; // 24

/**
 * Section vertical rhythm.
 * All major sections must align to this value.
 */
export const SECTION_GAP = space[4]; // 32

/**
 * Content max width guard (for future scalability).
 * Not active in pilot but locked for consistency.
 */
export const MAX_CONTENT_WIDTH = 1024 as const;
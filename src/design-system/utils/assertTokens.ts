// src/design-system/utils/assertTokens.ts

import { space } from "../tokens/spacing";
import { radius } from "../tokens/radius";
import { background, neutral, state, surface } from "../tokens/colors";
import { type } from "../tokens/typography";

/**
 * Development-only guards to prevent raw values
 * from leaking into primitives.
 *
 * These checks should only throw in __DEV__.
 */

const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : true;

function invariant(condition: boolean, message: string) {
  if (isDev && !condition) {
    throw new Error(`[DesignSystemViolation] ${message}`);
  }
}

export function assertValidSpacing(value: number) {
  const validValues = Object.values(space);
  invariant(
    validValues.includes(value as any),
    `Invalid spacing value: ${value}. Use spacing tokens only.`
  );
}

export function assertValidRadius(value: number) {
  const validValues = Object.values(radius);
  invariant(
    validValues.includes(value as any),
    `Invalid radius value: ${value}. Use radius tokens only.`
  );
}

export function assertValidColor(value: string) {
  const validNeutrals = Object.values(neutral);
  const validStates = Object.values(state);
  const validBackgrounds = Object.values(background);
  const validSurfaces = Object.values(surface);

  invariant(
    validNeutrals.includes(value as any) ||
      validStates.includes(value as any) ||
      validBackgrounds.includes(value as any) ||
      validSurfaces.includes(value as any),
    `Invalid color value: ${value}. Use color tokens only.`
  );
}

export function assertValidTypography(
  fontSize: number,
  lineHeight: number
) {
  const validTypes = Object.values(type);

  const match = validTypes.some(
    (t) => t.fontSize === fontSize && t.lineHeight === lineHeight
  );

  invariant(
    match,
    `Invalid typography values: ${fontSize}/${lineHeight}. Use typography tokens only.`
  );
}
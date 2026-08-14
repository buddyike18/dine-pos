

// src/design-system/tokens/typography.ts

export const fontWeights = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export type FontWeight = keyof typeof fontWeights;

export const type = {
  displayLg: {
    fontSize: 32,
    lineHeight: 40,
  },
  displayMd: {
    fontSize: 28,
    lineHeight: 36,
  },
  headingLg: {
    fontSize: 24,
    lineHeight: 32,
  },
  headingMd: {
    fontSize: 20,
    lineHeight: 28,
  },
  bodyLg: {
    fontSize: 18,
    lineHeight: 24,
  },
  bodyMd: {
    fontSize: 16,
    lineHeight: 24,
  },
  bodySm: {
    fontSize: 14,
    lineHeight: 20,
  },
  labelSm: {
    fontSize: 12,
    lineHeight: 16,
  },
} as const;

export type TypeVariant = keyof typeof type;

/**
 * Guard function to prevent raw typography values.
 * Use only in primitives.
 */
export function resolveType(variant: TypeVariant) {
  return type[variant];
}
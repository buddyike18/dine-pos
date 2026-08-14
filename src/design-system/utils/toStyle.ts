

// src/design-system/utils/toStyle.ts

import { Space, resolveSpace } from "../tokens/spacing";
import { Radius, resolveRadius } from "../tokens/radius";
import { TypeVariant, resolveType, FontWeight, fontWeights } from "../tokens/typography";
import { NeutralToken, StateToken, resolveNeutral, resolveState } from "../tokens/colors";
import { ElevationLevel, resolveElevation } from "../tokens/elevation";

/**
 * The only translator from tokens → React Native style objects.
 * Screens must never construct raw style values.
 */

export const toStyle = {
  spacing: (token: Space) => resolveSpace(token),

  radius: (token: Radius) => resolveRadius(token),

  typography: (variant: TypeVariant, weight: FontWeight = "regular") => {
    const base = resolveType(variant);

    return {
      fontSize: base.fontSize,
      lineHeight: base.lineHeight,
      fontWeight: fontWeights[weight],
    };
  },

  neutralColor: (token: NeutralToken) => resolveNeutral(token),

  stateColor: (token: StateToken) => resolveState(token),

  elevation: (level: ElevationLevel) => resolveElevation(level),
};
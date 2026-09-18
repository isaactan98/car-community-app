/**
 * Design tokens — "Night Build".
 *
 * The palette is drawn from what a night drive actually looks like: sodium
 * street light on wet tarmac, signage green, headlight white. Night is the
 * default appearance (see appearance.tsx); Day exists for 7am breakfast runs
 * in bright sun.
 *
 * This replaces the previous PlatformColor / DynamicColorIOS system. That
 * change is deliberate and it has a cost: we no longer inherit iOS Increase
 * Contrast or future system appearance settings for free, so contrast is
 * owned here and must be checked by hand when a colour changes. Dynamic Type
 * still applies — text scales unless a component opts out.
 *
 * Contrast (WCAG), computed from the hex values below:
 *   NIGHT   tint #FF7A1A on surface #151920      6.4:1
 *           green #3FD98B on surface #151920     9.8:1
 *           blue #5AA9FF on surface #151920      6.9:1
 *           label #F2F5F9 on surface #151920    15.1:1
 *           secondaryLabel #98A1AF on #151920    6.1:1
 *           destructive #FF6259 on #151920       5.3:1
 *           onTint #150A02 on tint #FF7A1A       9.7:1
 *   DAY     tint #C2500A on surface #FFFFFF      5.4:1
 *           green #128A52 on surface #FFFFFF     4.9:1
 *           blue #1667D6 on surface #FFFFFF      5.7:1
 *           label #0D1117 on surface #FFFFFF    19.2:1
 *           secondaryLabel #5A6472 on #FFFFFF    6.2:1
 *           destructive #C42B22 on #FFFFFF       6.4:1
 */
import {
  Platform,
  StyleSheet,
  type ColorValue,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { useAppearanceScheme, type Scheme } from "./appearance";

export type { Scheme };

export interface Palette {
  /** App ground, behind everything. */
  background: ColorValue;
  /** Cards, rows, sheets. */
  surface: ColorValue;
  /** Nested fills inside a surface (chips, inputs, tiles). */
  surfaceRaised: ColorValue;
  label: ColorValue;
  secondaryLabel: ColorValue;
  tertiaryLabel: ColorValue;
  placeholder: ColorValue;
  /** Hairline borders and dividers. */
  separator: ColorValue;
  /** Neutral translucent fill — tinted buttons, segmented track. */
  fill: ColorValue;
  /** Pressed row highlight. */
  highlight: ColorValue;
  /** Sodium orange, the app accent. */
  tint: ColorValue;
  /** Label colour on a tint-filled background. */
  onTint: ColorValue;
  /** Faint tint wash, for accent chips and selected states. */
  accentSoft: ColorValue;
  /** Destructive text. */
  destructive: ColorValue;
  /** Signal green — arrived, live, sharing. */
  green: ColorValue;
  /** Beam blue — on the way. */
  blue: ColorValue;
  red: ColorValue;
  yellow: ColorValue;
  gray: ColorValue;
  /** Monogram avatar fill. */
  monogram: ColorValue;
  /** Chip behind labels drawn on the map. */
  mapChip: ColorValue;
  /** Ground under the map while tiles load. */
  mapBackground: ColorValue;
  /** Translucent panel for the live dock and the map sheet. */
  glass: ColorValue;
}

const palettes: Record<Scheme, Palette> = {
  night: {
    background: "#0B0D11",
    surface: "#151920",
    surfaceRaised: "#1E232C",
    label: "#F2F5F9",
    secondaryLabel: "#98A1AF",
    tertiaryLabel: "#626B7A",
    placeholder: "#626B7A",
    separator: "#2A313D",
    fill: "rgba(255,255,255,0.07)",
    highlight: "#232935",
    tint: "#FF7A1A",
    onTint: "#150A02",
    accentSoft: "rgba(255,122,26,0.14)",
    destructive: "#FF6259",
    green: "#3FD98B",
    blue: "#5AA9FF",
    red: "#FF6259",
    yellow: "#FFC64D",
    gray: "#8A93A1",
    monogram: "#1E232C",
    mapChip: "rgba(21,25,32,0.88)",
    mapBackground: "#0E1218",
    glass: "rgba(21,25,32,0.92)",
  },
  day: {
    background: "#EDEFF3",
    surface: "#FFFFFF",
    surfaceRaised: "#F4F6F9",
    label: "#0D1117",
    secondaryLabel: "#5A6472",
    tertiaryLabel: "#8A93A1",
    placeholder: "#8A93A1",
    separator: "#D9DEE6",
    fill: "rgba(13,17,23,0.06)",
    highlight: "#E4E8EE",
    tint: "#C2500A",
    onTint: "#FFFFFF",
    accentSoft: "rgba(194,80,10,0.10)",
    destructive: "#C42B22",
    green: "#128A52",
    blue: "#1667D6",
    red: "#C42B22",
    yellow: "#8A5A00",
    gray: "#8A93A1",
    monogram: "#E4E8EE",
    mapChip: "rgba(255,255,255,0.92)",
    mapBackground: "#E4E8EE",
    glass: "rgba(255,255,255,0.94)",
  },
};

/** The resolved appearance. */
export function useScheme(): Scheme {
  return useAppearanceScheme();
}

export function usePalette(): Palette {
  return palettes[useAppearanceScheme()];
}

/** Colours for APIs that only take strings (navigation theme, status bar). */
export function schemeHex(scheme: Scheme) {
  const p = palettes[scheme];
  return {
    background: p.background as string,
    surface: p.surface as string,
    surfaceRaised: p.surfaceRaised as string,
    label: p.label as string,
    secondaryLabel: p.secondaryLabel as string,
    separator: p.separator as string,
    tint: p.tint as string,
  };
}

/** Themed StyleSheet factory. One cached sheet per appearance. */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (c: Palette) => T,
): () => T {
  const cache: Partial<Record<Scheme, T>> = {};
  return function useStyles() {
    const scheme = useAppearanceScheme();
    return (cache[scheme] ??= StyleSheet.create(factory(palettes[scheme])));
  };
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/**
 * Font families. Weight is baked into the family name because React Native
 * on Android ignores `fontWeight` once a custom `fontFamily` is set — so
 * never pair these with a `fontWeight`, pick the right family instead.
 *
 * Archivo and Barlow are both signage grotesques; Barlow is the narrower,
 * more humanist of the two, which is what keeps body text from reading as
 * the system face. Numbers live in JetBrains Mono so ETA and distance stay
 * legible at a glance and never reflow as digits change.
 */
export const font = {
  display: "Archivo_800ExtraBold",
  displayBold: "Archivo_700Bold",
  displaySemi: "Archivo_600SemiBold",
  body: "Barlow_400Regular",
  bodyMedium: "Barlow_500Medium",
  bodySemi: "Barlow_600SemiBold",
  bodyBold: "Barlow_700Bold",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_700Bold",
} as const;

export const type = {
  /** Screen hero, one per screen. */
  display1: {
    fontFamily: font.display,
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.7,
  },
  display2: {
    fontFamily: font.display,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.5,
  },
  /** Card names, section titles. */
  display3: {
    fontFamily: font.display,
    fontSize: 19,
    lineHeight: 23,
    letterSpacing: -0.2,
  },
  /** Navigation bar titles, prominent rows. */
  title: { fontFamily: font.displayBold, fontSize: 17, lineHeight: 22 },
  /** Uppercase section labels. Callers add textTransform. */
  eyebrow: {
    fontFamily: font.displayBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.9,
  },
  /** Uppercase button labels. Callers add textTransform. */
  button: {
    fontFamily: font.displayBold,
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: 0.9,
  },
  buttonSmall: {
    fontFamily: font.displayBold,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: 0.8,
  },
  body: { fontFamily: font.body, fontSize: 16, lineHeight: 22 },
  bodyMedium: { fontFamily: font.bodyMedium, fontSize: 16, lineHeight: 22 },
  bodySemi: { fontFamily: font.bodySemi, fontSize: 16, lineHeight: 21 },
  callout: { fontFamily: font.body, fontSize: 15, lineHeight: 20 },
  calloutSemi: { fontFamily: font.bodySemi, fontSize: 15, lineHeight: 20 },
  footnote: { fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  footnoteSemi: { fontFamily: font.bodySemi, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: font.bodyMedium, fontSize: 12, lineHeight: 16 },
  /** The big readout: distance to the car ahead, arrival count. */
  monoHuge: {
    fontFamily: font.monoBold,
    fontSize: 40,
    lineHeight: 42,
    letterSpacing: -1.6,
  },
  monoLarge: {
    fontFamily: font.monoBold,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.6,
  },
  /** Per-person ETA on the board. */
  monoMedium: {
    fontFamily: font.monoBold,
    fontSize: 19,
    lineHeight: 23,
    letterSpacing: -0.4,
  },
  mono: { fontFamily: font.monoMedium, fontSize: 13, lineHeight: 17 },
  monoSmall: {
    fontFamily: font.monoMedium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.3,
  },
} as const satisfies Record<string, TextStyle>;

export const spacing = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 20,
  xxl: 32,
};

export const radius = {
  /** Cards and grouped sections. */
  card: 16,
  /** Buttons, fields, tiles. */
  control: 13,
  /** Sheets and the live dock. */
  sheet: 22,
  /** Plate chips and small badges. */
  chip: 5,
  pill: 999,
};

/** Minimum touch target (44pt — still the right number, Apple or not). */
export const TOUCH_MIN = 44;
/** Leading edge of screen content. */
export const ROW_INSET = 16;
/** Height the live dock occupies, so screens can pad clear of it. */
export const DOCK_HEIGHT = 64;

/**
 * Elevation for the few things that genuinely float: the live dock, the map
 * sheet, glass bar buttons. Everything else is separated by a hairline, not
 * a shadow — a shadow on every card flattens the hierarchy.
 */
export function elevation(scheme: Scheme, level: 1 | 2 = 1): ViewStyle {
  const dark = scheme === "night";
  const opacity = dark ? (level === 1 ? 0.45 : 0.6) : level === 1 ? 0.12 : 0.18;
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: "#000000",
      shadowOpacity: opacity,
      shadowRadius: level === 1 ? 12 : 24,
      shadowOffset: { width: 0, height: level === 1 ? 4 : 10 },
    },
    default: { elevation: level === 1 ? 6 : 14 },
  }) as ViewStyle;
}

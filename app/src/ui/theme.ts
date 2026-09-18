/**
 * Design tokens, following Apple's HIG:
 * - Colours are semantic and adapt to Light, Dark and Increase Contrast. On
 *   iOS they are the real system colours (PlatformColor) — never hard-coded
 *   copies — so sheets get elevated backgrounds and accessibility settings
 *   apply for free. Custom colours use DynamicColorIOS with contrast variants,
 *   the code equivalent of an asset-catalog Color Set.
 * - Android has no equivalent API, so it gets hex palettes that mirror the
 *   iOS values, selected by the current colour scheme.
 * - Type follows the iOS text styles (Large, the default Dynamic Type size).
 *
 * Contrast (WCAG) of the custom colours, computed from the hex values:
 *   tint light  #B84C0B  4.62:1 on #F2F2F7, 5.15:1 behind white labels
 *   tint dark   #F47929  6.17:1 on #1C1C1E; label #1A0E04 on it 6.87:1
 *   secondary light #6C6C70 5.23:1 on white (Apple's own is 3.4:1)
 *   secondary dark  #98989F 5.94:1 on #1C1C1E
 */
import {
  DynamicColorIOS,
  Platform,
  PlatformColor,
  StyleSheet,
  useColorScheme,
  type ColorValue,
  type TextStyle,
} from "react-native";

export interface Palette {
  /** systemGroupedBackground — behind grouped lists */
  background: ColorValue;
  /** secondarySystemGroupedBackground — list rows, cards */
  surface: ColorValue;
  /** tertiarySystemGroupedBackground — inside rows */
  surfaceRaised: ColorValue;
  label: ColorValue;
  secondaryLabel: ColorValue;
  tertiaryLabel: ColorValue;
  placeholder: ColorValue;
  separator: ColorValue;
  /** tertiarySystemFill — tinted buttons, segmented track */
  fill: ColorValue;
  /** systemGray4 — pressed row highlight */
  highlight: ColorValue;
  /** Brand orange, the app accent. */
  tint: ColorValue;
  /** Label colour on a tint-filled background. */
  onTint: ColorValue;
  /** Destructive text (accessible red). */
  destructive: ColorValue;
  green: ColorValue;
  blue: ColorValue;
  red: ColorValue;
  yellow: ColorValue;
  gray: ColorValue;
  /** Contacts-style monogram avatar fill. */
  monogram: ColorValue;
  /** Opaque-ish chip behind labels drawn on the map. */
  mapChip: ColorValue;
}

type Scheme = "light" | "dark";

const TINT = { light: "#B84C0B", dark: "#F47929" };

const iosPalette: Palette = {
  background: PlatformColor("systemGroupedBackground"),
  surface: PlatformColor("secondarySystemGroupedBackground"),
  surfaceRaised: PlatformColor("tertiarySystemGroupedBackground"),
  label: PlatformColor("label"),
  secondaryLabel: DynamicColorIOS({
    light: "#6C6C70",
    dark: "#98989F",
    highContrastLight: "#48484A",
    highContrastDark: "#C7C7CC",
  }),
  tertiaryLabel: PlatformColor("tertiaryLabel"),
  placeholder: PlatformColor("placeholderText"),
  separator: PlatformColor("separator"),
  fill: PlatformColor("tertiarySystemFill"),
  highlight: PlatformColor("systemGray4"),
  tint: DynamicColorIOS({
    light: TINT.light,
    dark: TINT.dark,
    highContrastLight: "#95370A",
    highContrastDark: "#FF9D5E",
  }),
  onTint: DynamicColorIOS({ light: "#FFFFFF", dark: "#1A0E04" }),
  destructive: DynamicColorIOS({
    light: "#D70015",
    dark: "#FF6961",
    highContrastLight: "#B0000F",
    highContrastDark: "#FF8A84",
  }),
  green: PlatformColor("systemGreen"),
  blue: PlatformColor("systemBlue"),
  red: PlatformColor("systemRed"),
  yellow: PlatformColor("systemYellow"),
  gray: PlatformColor("systemGray"),
  monogram: DynamicColorIOS({ light: "#8E8E93", dark: "#636366" }),
  mapChip: DynamicColorIOS({
    light: "rgba(255,255,255,0.94)",
    dark: "rgba(28,28,30,0.94)",
  }),
};

const androidPalettes: Record<Scheme, Palette> = {
  light: {
    background: "#F2F2F7",
    surface: "#FFFFFF",
    surfaceRaised: "#F2F2F7",
    label: "#000000",
    secondaryLabel: "#6C6C70",
    tertiaryLabel: "#C4C4C6",
    placeholder: "#A6A6AA",
    separator: "#C6C6C8",
    fill: "rgba(118,118,128,0.12)",
    highlight: "#D1D1D6",
    tint: TINT.light,
    onTint: "#FFFFFF",
    destructive: "#D70015",
    green: "#34C759",
    blue: "#007AFF",
    red: "#FF3B30",
    yellow: "#FFCC00",
    gray: "#8E8E93",
    monogram: "#8E8E93",
    mapChip: "rgba(255,255,255,0.94)",
  },
  dark: {
    background: "#000000",
    surface: "#1C1C1E",
    surfaceRaised: "#2C2C2E",
    label: "#FFFFFF",
    secondaryLabel: "#98989F",
    tertiaryLabel: "#5B5B60",
    placeholder: "#6E6E73",
    separator: "#38383A",
    fill: "rgba(118,118,128,0.24)",
    highlight: "#3A3A3C",
    tint: TINT.dark,
    onTint: "#1A0E04",
    destructive: "#FF6961",
    green: "#30D158",
    blue: "#0A84FF",
    red: "#FF453A",
    yellow: "#FFD60A",
    gray: "#8E8E93",
    monogram: "#636366",
    mapChip: "rgba(28,28,30,0.94)",
  },
};

export function useScheme(): Scheme {
  return useColorScheme() === "dark" ? "dark" : "light";
}

/** Colours for the current appearance. On iOS they adapt natively. */
export function usePalette(): Palette {
  const scheme = useScheme();
  return Platform.OS === "ios" ? iosPalette : androidPalettes[scheme];
}

/**
 * Hex values for APIs that only take strings (navigation theme, status bar).
 * Prefer usePalette() everywhere else.
 */
export function schemeHex(scheme: Scheme) {
  const p = androidPalettes[scheme];
  return {
    background: p.background as string,
    surface: p.surface as string,
    label: p.label as string,
    separator: p.separator as string,
    tint: TINT[scheme],
  };
}

/**
 * Themed StyleSheet factory. iOS colours are dynamic, so one sheet serves
 * both appearances; Android builds (and caches) one per scheme.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (c: Palette) => T,
): () => T {
  const cache: Partial<Record<Scheme | "ios", T>> = {};
  return function useStyles() {
    const scheme = useScheme();
    const key = Platform.OS === "ios" ? "ios" : scheme;
    const palette = Platform.OS === "ios" ? iosPalette : androidPalettes[scheme];
    return (cache[key] ??= StyleSheet.create(factory(palette)));
  };
}

/** iOS text styles at the default (Large) Dynamic Type size. */
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700" },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: "600" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 22 },
  callout: { fontSize: 16, lineHeight: 21 },
  subheadline: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption1: { fontSize: 12, lineHeight: 16 },
  caption2: { fontSize: 11, lineHeight: 13 },
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
  /** Inset grouped sections (concentric with iOS 26 device corners). */
  group: 26,
  control: 12,
  pill: 999,
};

/** Minimum touch target (HIG 44 pt). */
export const TOUCH_MIN = 44;
/** Leading edge of list content; separators inset to align with text. */
export const ROW_INSET = 16;

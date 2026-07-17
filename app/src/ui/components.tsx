/** Small shared UI atoms. */
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { formatAge } from "../lib/staleness";
import { wazeUrl } from "../lib/waze";
import { colors, spacing } from "./theme";

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
  small,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger" | "waze";
  disabled?: boolean;
  small?: boolean;
}) {
  const bg =
    kind === "primary"
      ? colors.accent
      : kind === "danger"
        ? colors.red
        : kind === "waze"
          ? colors.wazeBlue
          : colors.card;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        {
          backgroundColor: bg,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
          borderWidth: kind === "secondary" ? 1 : 0,
          borderColor: colors.border,
        },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          small && styles.buttonTextSmall,
          { color: kind === "waze" ? "#00222E" : colors.text },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/** One-tap Waze handoff (R5). */
export function WazeButton({
  lat,
  lng,
  label,
  small = true,
}: {
  lat: number;
  lng: number;
  label?: string;
  small?: boolean;
}) {
  return (
    <Button
      title={label ?? "Waze"}
      kind="waze"
      small={small}
      onPress={() => {
        // Fire-and-forget: if Waze isn't installed the browser fallback of
        // the universal link handles it. Never crash on failure.
        Linking.openURL(wazeUrl(lat, lng)).catch(() => {});
      }}
    />
  );
}

/** Offline / stale-data banner (R6). */
export function OfflineBanner({
  visible,
  lastUpdatedAt,
  now,
}: {
  visible: boolean;
  lastUpdatedAt: number | null;
  now: number;
}) {
  if (!visible) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>
        Offline — data stale
        {lastUpdatedAt !== null
          ? ` (last update ${formatAge(lastUpdatedAt, now)} ago)`
          : ""}
        . Waze links still work.
      </Text>
    </View>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} size="large" />
      {label ? <Text style={styles.loadingText}>{label}</Text> : null}
    </View>
  );
}

export function StatePill({ state }: { state: string }) {
  const bg =
    state === "active"
      ? colors.green
      : state === "upcoming"
        ? colors.amber
        : colors.stale;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={styles.pillText}>{state.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 10,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSmall: {
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
  buttonText: { fontWeight: "700", fontSize: 15 },
  buttonTextSmall: { fontSize: 13 },
  banner: {
    backgroundColor: colors.amber,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
  },
  bannerText: { color: "#3A2A00", fontWeight: "600", fontSize: 13 },
  screen: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.l,
    marginBottom: spacing.m,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.m,
  },
  loadingText: { color: colors.textDim },
  pill: {
    borderRadius: 999,
    paddingHorizontal: spacing.s,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  pillText: { fontSize: 11, fontWeight: "800", color: "#0F1115" },
});

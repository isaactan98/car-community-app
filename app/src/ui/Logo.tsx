/**
 * Runs brand mark — the diagonal accelerating dot trail. Rendered from the
 * bundled PNG (assets/logo-mark.png) so it stays crisp at any size without a
 * vector dependency. `Wordmark` pairs the mark with the "Runs" name for
 * headers and the invite screen.
 */
import { Image, StyleSheet, Text, View } from "react-native";

import { colors } from "./theme";

const MARK = require("../../assets/logo-mark.png");

export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <Image
      source={MARK}
      accessibilityIgnoresInvertColors
      accessibilityLabel="Runs logo"
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <View style={styles.row}>
      <LogoMark size={Math.round(size * 1.4)} />
      <Text style={[styles.word, { fontSize: size }]}>Runs</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  word: { color: colors.text, fontWeight: "800", letterSpacing: 0.5 },
});

/**
 * Invite entry (R1 share-in / hard constraint 3): invite code + display name
 * → POST /auth/join → token persisted. No other auth of any kind.
 * If the app was opened via a runs:// deep link carrying a code, prefill it.
 */
import * as ExpoLinking from "expo-linking";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError } from "../api/client";
import { useSession } from "../session/SessionContext";
import { Button, Screen } from "../ui/components";
import { colors, spacing } from "../ui/theme";

function codeFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = ExpoLinking.parse(url);
    const qp = parsed.queryParams ?? {};
    const raw = qp["code"] ?? qp["inviteCode"] ?? qp["invite"];
    if (typeof raw === "string" && raw.length > 0) return raw;
  } catch {
    // not a parseable link — ignore
  }
  return null;
}

export default function InviteScreen() {
  const { join } = useSession();
  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill the code when the app was opened via a runs:// invite link.
  useEffect(() => {
    const apply = (incoming: string | null) => {
      const code = codeFromUrl(incoming);
      if (code) setInviteCode(code);
    };
    const sub = Linking.addEventListener("url", ({ url }) => apply(url));
    Linking.getInitialURL().then(apply, () => {});
    return () => sub.remove();
  }, []);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (inviteCode.trim().length === 0 || displayName.trim().length === 0) {
      setError("Enter the invite code and your display name.");
      return;
    }
    setBusy(true);
    try {
      await join(inviteCode, displayName);
      // SessionProvider flips the navigator to the main stack.
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("That invite code was not accepted.");
      } else if (err instanceof ApiError && err.network) {
        setError("Can't reach the server. Check your connection and try again.");
      } else {
        setError("Join failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.wrap} behavior="padding">
        <Text style={styles.title}>Runs</Text>
        <Text style={styles.subtitle}>
          Private group. Enter the invite code you were given.
        </Text>
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Invite code"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            value={inviteCode}
            onChangeText={setInviteCode}
          />
          <TextInput
            style={styles.input}
            placeholder="Display name"
            placeholderTextColor={colors.textDim}
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={40}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            title={busy ? "Joining…" : "Join"}
            onPress={submit}
            disabled={busy}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: spacing.xl },
  title: {
    color: colors.text,
    fontSize: 40,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    color: colors.textDim,
    textAlign: "center",
    marginTop: spacing.s,
    marginBottom: spacing.xl,
  },
  form: { gap: spacing.m },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    fontSize: 16,
  },
  error: { color: colors.red },
});

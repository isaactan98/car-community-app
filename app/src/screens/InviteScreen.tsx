/**
 * Invite entry (R1 share-in / hard constraint 3): invite code + display name
 * → POST /auth/join → token persisted. No other auth of any kind.
 * If the app was opened via a runs:// deep link carrying a code, prefill it.
 *
 * The screen leads with the group's own words — "set a place and go" — and
 * with the three privacy promises, because for a 50-person WhatsApp group the
 * only real question is whether this thing tracks them. The invite code is
 * the hero field: it's the one thing the screen exists for.
 */
import * as ExpoLinking from "expo-linking";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "../api/client";
import { useSession } from "../session/SessionContext";
import { Button, InlineBanner, Screen, TextField } from "../ui/components";
import { haptic } from "../ui/haptics";
import { makeStyles, spacing, type, usePalette } from "../ui/theme";

const PROMISES: { lead: string; rest: string }[] = [
  {
    lead: "Location only during a run.",
    rest: " It starts when the run goes live and stops the second it ends.",
  },
  {
    lead: "Speed is never recorded.",
    rest: " Not stored, not sent, not shown. Anywhere.",
  },
  {
    lead: "Invite only.",
    rest: " No signup, no discovery, no strangers.",
  },
];

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
  const s = useStyles();
  const c = usePalette();
  const { join, signedOutReason } = useSession();
  const insets = useSafeAreaInsets();
  const nameRef = useRef<TextInput>(null);
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

  const ready = inviteCode.trim().length > 0 && displayName.trim().length > 0;

  const submit = async () => {
    if (busy || !ready) return;
    setError(null);
    setBusy(true);
    try {
      await join(inviteCode, displayName);
      haptic.success();
      // SessionProvider flips the navigator to the main stack.
    } catch (err) {
      haptic.error();
      if (err instanceof ApiError && err.status === 401) {
        setError("That invite code wasn't accepted. Check it with whoever sent it.");
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
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[s.content, { paddingTop: insets.top + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View style={s.trail} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <View key={i} style={i < 3 ? s.dotOn : s.dotOff} />
            ))}
          </View>
          <Text style={s.wordmark} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
            Runs
          </Text>

          <Text style={s.headline} maxFontSizeMultiplier={1.5}>
            Set a place.{"\n"}
            <Text style={s.headlineAccent}>Go.</Text>
          </Text>

          <View style={s.promises}>
            {PROMISES.map((p) => (
              <View key={p.lead} style={s.promise}>
                <View style={s.promiseDot} />
                <Text style={s.promiseText}>
                  <Text style={s.promiseLead}>{p.lead}</Text>
                  {p.rest}
                </Text>
              </View>
            ))}
          </View>

          {signedOutReason ? (
            <View style={s.notice}>
              <InlineBanner
                icon="warning"
                tone="warning"
                title="You've been signed out"
                body={signedOutReason}
              />
            </View>
          ) : null}

          <View style={s.fields}>
            <TextField
              label="Invite code"
              placeholder="RUNS-1A2B3C4D"
              mono
              hero
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => nameRef.current?.focus()}
              value={inviteCode}
              onChangeText={(t) => {
                setInviteCode(t);
                setError(null);
              }}
            />
            <TextField
              ref={nameRef}
              label="Your name"
              placeholder="As the group knows you"
              autoCapitalize="words"
              autoComplete="name"
              textContentType="nickname"
              returnKeyType="join"
              onSubmitEditing={submit}
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={40}
            />
          </View>

          <Text style={[s.footnote, error ? { color: c.destructive } : null]}
            accessibilityRole={error ? "alert" : undefined}
          >
            {error ?? "Ask the run organiser for an invite code or link."}
          </Text>
        </ScrollView>

        <View style={[s.bottom, { paddingBottom: insets.bottom + spacing.m }]}>
          <Button
            title={busy ? "Joining…" : "Join the group"}
            onPress={submit}
            loading={busy}
            disabled={!ready}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },

  trail: { flexDirection: "row", gap: 7, alignItems: "center", marginBottom: spacing.m },
  dotOn: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: c.tint },
  dotOff: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 1.5,
    borderColor: c.tertiaryLabel,
  },
  wordmark: {
    ...type.display1,
    fontSize: 44,
    lineHeight: 46,
    letterSpacing: -1.4,
    textTransform: "uppercase",
    color: c.label,
  },

  headline: {
    ...type.display2,
    fontSize: 30,
    lineHeight: 34,
    color: c.label,
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
  headlineAccent: { color: c.tint },

  promises: { gap: spacing.m, marginBottom: spacing.xl },
  promise: { flexDirection: "row", gap: spacing.m },
  promiseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: c.tint,
    marginTop: 7,
  },
  promiseText: { ...type.callout, color: c.secondaryLabel, flex: 1 },
  promiseLead: { ...type.calloutSemi, color: c.label },

  notice: { marginBottom: spacing.l },
  fields: { gap: spacing.m },
  footnote: {
    ...type.footnote,
    color: c.tertiaryLabel,
    marginTop: spacing.m,
    paddingHorizontal: spacing.xs,
  },
  bottom: { paddingHorizontal: spacing.xl, paddingTop: spacing.s },
}));

/**
 * Invite entry (R1 share-in / hard constraint 3): invite code + display name
 * → POST /auth/join → token persisted. No other auth of any kind.
 * If the app was opened via a runs:// deep link carrying a code, prefill it.
 *
 * Laid out like Apple's own welcome screens: app icon, a large title, three
 * feature rows, then the form and a pinned Continue-style button.
 */
import * as ExpoLinking from "expo-linking";
import { useEffect, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "../api/client";
import { useSession } from "../session/SessionContext";
import {
  Button,
  Group,
  InlineBanner,
  Screen,
  TextFieldRow,
} from "../ui/components";
import { haptic } from "../ui/haptics";
import { Icon, type IconName } from "../ui/Icon";
import { makeStyles, spacing, type, usePalette } from "../ui/theme";

const APP_ICON = require("../../assets/icon.png");

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "group",
    title: "See Who's Coming",
    body: "The arrival board shows who's at the meetup and who's still on the way.",
  },
  {
    icon: "map",
    title: "Live Group Map",
    body: "Glance at everyone during a drive, then hand off to Waze.",
  },
  {
    icon: "lock",
    title: "Private by Design",
    body: "Your location is shared only during runs you join, and stops when they end.",
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
      <KeyboardAvoidingView style={s.flex} behavior="padding">
        <ScrollView
          contentContainerStyle={[s.content, { paddingTop: insets.top + spacing.xxl }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Image
            source={APP_ICON}
            style={s.icon}
            accessibilityIgnoresInvertColors
            accessibilityLabel="Runs app icon"
          />
          <Text style={s.title} accessibilityRole="header" maxFontSizeMultiplier={1.6}>
            Welcome to Runs
          </Text>

          <View style={s.features}>
            {FEATURES.map((f) => (
              <View key={f.title} style={s.feature}>
                <View style={s.featureIcon}>
                  <Icon name={f.icon} size={30} color={c.tint} />
                </View>
                <View style={s.featureText}>
                  <Text style={s.featureTitle}>{f.title}</Text>
                  <Text style={s.featureBody}>{f.body}</Text>
                </View>
              </View>
            ))}
          </View>

          {signedOutReason ? (
            <View style={s.notice}>
              <InlineBanner
                icon="warning"
                tone="warning"
                title="You've Been Signed Out"
                body={signedOutReason}
              />
            </View>
          ) : null}

          <Group
            footer={
              error ? (
                <Text style={s.error} accessibilityRole="alert">
                  {error}
                </Text>
              ) : (
                "Ask the run organiser for an invite code or link."
              )
            }
          >
            <TextFieldRow
              label="Invite Code"
              placeholder="RUNS-1A2B3C4D"
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
            <TextFieldRow
              ref={nameRef}
              label="Your Name"
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
          </Group>
        </ScrollView>

        <View style={[s.bottom, { paddingBottom: insets.bottom + spacing.m }]}>
          <Button
            title={busy ? "Joining…" : "Join Group"}
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
  icon: {
    width: 80,
    height: 80,
    borderRadius: 18,
    borderCurve: "continuous",
    alignSelf: "center",
  },
  title: {
    ...type.largeTitle,
    color: c.label,
    textAlign: "center",
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  features: { gap: spacing.xl, marginBottom: spacing.xxl, paddingHorizontal: spacing.xs },
  feature: { flexDirection: "row", alignItems: "center", gap: spacing.l },
  featureIcon: { width: 40, alignItems: "center" },
  featureText: { flex: 1, gap: 2 },
  featureTitle: { ...type.headline, color: c.label },
  featureBody: { ...type.subheadline, color: c.secondaryLabel },
  notice: { marginBottom: spacing.xl },
  error: { color: c.destructive },
  bottom: { paddingHorizontal: spacing.xl, paddingTop: spacing.s },
}));

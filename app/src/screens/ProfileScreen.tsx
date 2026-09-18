/**
 * You: identity, the garage (R2 — free-text car names via /me/cars), the
 * appearance choice, what's being shared right now, and leaving the group on
 * this phone.
 *
 * The garage is the one screen in the app that's purely about cars, so it
 * gets cards with plate chips rather than list rows. The privacy panel is
 * deliberately prominent: for a 50-person WhatsApp group deciding whether to
 * install this, "what is it sharing?" is the only question that matters.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { addCar, deleteCar, getMe } from "../api/client";
import type { Car } from "../api/types";
import {
  activeSessionRunId,
  liveDiagnostics,
  subscribeLiveSession,
  type LiveDiagnostics,
} from "../live/liveSession";
import type { ScreenProps } from "../navigation/types";
import { useSession } from "../session/SessionContext";
import {
  Avatar,
  Button,
  Card,
  Eyebrow,
  InlineBanner,
  Loading,
  Plate,
  Segmented,
  TextField,
  confirmAction,
} from "../ui/components";
import { APPEARANCE_OPTIONS, useAppearance, type AppearanceMode } from "../ui/appearance";
import { haptic } from "../ui/haptics";
import { Icon } from "../ui/Icon";
import {
  DOCK_HEIGHT,
  ROW_INSET,
  makeStyles,
  radius,
  spacing,
  type,
  usePalette,
} from "../ui/theme";

/** "4s" / "2m" / "never" — the age of the last frame from the server. */
function formatAgeMs(ms: number | null): string {
  if (ms === null) return "never";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

/**
 * The connection panel's data, re-read on a timer.
 *
 * Polling rather than subscribing is deliberate: half the value is the *age*
 * of the last inbound frame, which changes with the clock and not with any
 * event the session emits.
 */
function useDiagnostics(intervalMs = 1000): LiveDiagnostics {
  const [d, setD] = useState<LiveDiagnostics>(() => liveDiagnostics());
  useEffect(() => {
    const t = setInterval(() => setD(liveDiagnostics()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return d;
}

/** One label/value line in the connection panel. */
function DiagRow({ label, value }: { label: string; value: string }) {
  const s = useStyles();
  return (
    <View style={s.diagRow}>
      <Text style={s.diagLabel}>{label}</Text>
      <Text style={s.diagValue} numberOfLines={2} selectable>
        {value}
      </Text>
    </View>
  );
}

/** True while a live session is sharing — the honest answer for the panel. */
function useIsSharing(): boolean {
  const [sharing, setSharing] = useState(() => activeSessionRunId() !== null);
  useEffect(
    () => subscribeLiveSession(() => setSharing(activeSessionRunId() !== null)),
    [],
  );
  return sharing;
}

export default function ProfileScreen({ navigation }: ScreenProps<"Profile">) {
  const s = useStyles();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const { member, logout } = useSession();
  const { mode, setMode } = useAppearance();
  const sharing = useIsSharing();
  const diag = useDiagnostics();
  const addRef = useRef<TextInput>(null);
  const [cars, setCars] = useState<Car[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(
    () =>
      getMe()
        .then((me) => {
          setCars(me.cars);
          setOffline(false);
        })
        .catch(() => {
          setCars((prev) => prev ?? []);
          setOffline(true);
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    try {
      await addCar(trimmed);
      haptic.success();
      setName("");
      await load();
    } catch {
      haptic.error();
      Alert.alert("Couldn't add car", "The server is unreachable or rejected it.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (car: Car) => {
    const ok = await confirmAction({
      title: `Remove ${car.name}?`,
      message: "Runs you've already joined keep showing it.",
      confirmLabel: "Remove car",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCar(car.id);
      await load();
    } catch {
      haptic.error();
      Alert.alert("Couldn't remove car", "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const leaveGroup = async () => {
    const ok = await confirmAction({
      title: "Leave the group on this phone?",
      message: "Any location sharing stops now. You'll need an invite code to join again.",
      confirmLabel: "Leave group",
      destructive: true,
    });
    if (ok) await logout();
  };

  if (cars === null) return <Loading />;

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[
        s.content,
        { paddingBottom: insets.bottom + DOCK_HEIGHT + spacing.xxl },
      ]}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <View style={s.identity}>
        <Avatar name={member?.displayName ?? "?"} size={62} state="self" />
        <View style={s.identityText}>
          <Text style={s.name} accessibilityRole="header" numberOfLines={2}>
            {member?.displayName ?? "Member"}
          </Text>
          <Text style={s.caption}>MEMBER OF THE GROUP</Text>
        </View>
      </View>

      {offline ? (
        <View style={s.block}>
          <InlineBanner
            icon="offline"
            tone="warning"
            title="Offline"
            body="Your garage may be out of date."
            actionLabel="Retry"
            onAction={() => void load()}
          />
        </View>
      ) : null}

      <View style={s.block}>
        <Eyebrow title="Garage" count={cars.length} />
        <View style={s.grid}>
          {cars.map((car) => (
            <Pressable
              key={car.id}
              accessibilityRole="button"
              accessibilityLabel={car.name}
              accessibilityHint="Press and hold to remove this car"
              onLongPress={() => void remove(car)}
              disabled={busy}
              style={({ pressed }) => [
                s.carCard,
                pressed && { backgroundColor: c.highlight },
              ]}
            >
              <Plate name={car.name} />
              <Text style={s.carName} numberOfLines={2}>
                {car.name}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a car"
            onPress={() => addRef.current?.focus()}
            style={({ pressed }) => [s.addCard, pressed && { opacity: 0.6 }]}
          >
            <Icon name="add" size={20} color={c.secondaryLabel} />
            <Text style={s.addText}>Add a car</Text>
          </Pressable>
        </View>

        <TextField
          ref={addRef}
          label="Add a car"
          placeholder="e.g. GR86"
          value={name}
          onChangeText={setName}
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={() => void add()}
          editable={!busy}
          containerStyle={s.addField}
          trailing={
            busy && name.trim() ? (
              <ActivityIndicator color={c.secondaryLabel} />
            ) : name.trim() ? (
              <Button title="Add" role="plain" size="small" onPress={() => void add()} />
            ) : null
          }
        />
        <Text style={s.hint}>
          Pick one of these when you join a run so the group knows what you&apos;re
          bringing. Press and hold a car to remove it.
        </Text>
      </View>

      <View style={s.block}>
        <Eyebrow title="Appearance" />
        <Segmented<AppearanceMode>
          options={APPEARANCE_OPTIONS}
          value={mode}
          onChange={setMode}
        />
        <Text style={s.hint}>
          Night is the default — most runs happen after dark, and a white screen in
          a moving car is worse than a dim one.
        </Text>
      </View>

      <View style={s.block}>
        <Eyebrow title="Privacy" />
        <Card style={s.privacy}>
          <View style={s.privacyTop}>
            <View style={[s.privacyDot, { backgroundColor: sharing ? c.green : c.gray }]} />
            <Text style={s.privacyTitle}>
              {sharing ? "Sharing now — a run is live" : "Not sharing anything"}
            </Text>
          </View>
          <Text style={s.privacyBody}>
            Your location is shared only while a run you joined is active, and only
            with that run. It stops the moment the run ends or you leave. No speed is
            ever recorded.
          </Text>
        </Card>
      </View>

      <View style={s.block}>
        <Eyebrow title="Connection" />
        <Card style={s.diag}>
          <DiagRow label="Server" value={diag.serverUrl} />
          <DiagRow label="Live socket" value={diag.wsEndpoint} />
          <DiagRow
            label="Status"
            value={
              diag.runId === null
                ? "idle — no run is live"
                : diag.connected
                  ? `connected · last update ${formatAgeMs(diag.inboundAgeMs)}`
                  : `not connected · retry #${diag.reconnectAttempt}`
            }
          />
          <DiagRow
            label="Last close"
            value={
              diag.lastCloseCode === null && diag.lastCloseReason === null
                ? diag.everConnected
                  ? "none"
                  : "never connected"
                : `${diag.lastCloseCode ?? "—"}${
                    diag.lastCloseReason ? ` · ${diag.lastCloseReason}` : ""
                  }`
            }
          />
          <DiagRow
            label="Recovery"
            value={
              diag.forcedReconnects === 0
                ? "none needed"
                : `${diag.forcedReconnects} forced reconnects${
                    diag.lastForcedReason ? ` · last: ${diag.lastForcedReason}` : ""
                  }`
            }
          />
          <DiagRow label="Sent" value={`${diag.positionsSent} positions`} />
        </Card>
        <Text style={s.hint}>
          For debugging only. &quot;Server&quot; is the address this build was
          compiled against — if it isn&apos;t the one you expect, the app was built
          without EXPO_PUBLIC_SERVER_URL set. No location data appears here.
        </Text>
      </View>

      <Button
        title="Leave the group on this phone"
        role="destructive"
        size="regular"
        onPress={() => void leaveGroup()}
      />
      <Text style={s.hint}>
        Signs you out on this phone. You&apos;ll need an invite code to rejoin.
      </Text>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: ROW_INSET, paddingTop: spacing.s },

  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.l,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.xs,
  },
  identityText: { flex: 1, gap: 2 },
  name: { ...type.display1, color: c.label },
  caption: { ...type.monoSmall, color: c.tertiaryLabel },

  block: { marginBottom: spacing.xxl, gap: spacing.m },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.m },
  carCard: {
    flexGrow: 1,
    flexBasis: "46%",
    minHeight: 92,
    gap: spacing.s,
    padding: spacing.m,
    backgroundColor: c.surface,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: c.separator,
  },
  carName: { ...type.display3, fontSize: 16, lineHeight: 20, color: c.label },
  addCard: {
    flexGrow: 1,
    flexBasis: "46%",
    minHeight: 92,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: spacing.m,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: c.separator,
  },
  addText: { ...type.calloutSemi, color: c.secondaryLabel },
  addField: { marginTop: spacing.xs },

  hint: { ...type.footnote, color: c.tertiaryLabel, paddingHorizontal: spacing.xs },

  privacy: { padding: spacing.l, gap: spacing.s },
  privacyTop: { flexDirection: "row", alignItems: "center", gap: spacing.s },
  privacyDot: { width: 8, height: 8, borderRadius: 4 },
  privacyTitle: { ...type.calloutSemi, color: c.label, flex: 1 },
  privacyBody: { ...type.footnote, color: c.secondaryLabel },

  diag: { padding: spacing.l, gap: spacing.s },
  diagRow: { gap: 2 },
  diagLabel: { ...type.monoSmall, color: c.tertiaryLabel },
  diagValue: { ...type.footnote, color: c.label },
}));

/**
 * Run detail / roll call (R2 + R3):
 * - attendee board with status, "4/7 arrived", and live ETA from WS snapshots
 * - RSVP join/leave; the car picker is a native sheet (CarPickerScreen)
 * - share button exposing the run's invite deep link
 * - creator start/end controls, Waze handoff for meetup/destination (R5)
 * - degraded mode: cached run + snapshot with offline banner (R6)
 * - auto start/stop of location sharing per R7
 *
 * Presentation notes: the car reads as a plate rather than a grey subtitle,
 * ETA gets the size the number deserves (it's what people open this screen
 * for), and arrived rows carry three redundant signals — filled avatar, tick,
 * green edge — so the state survives glare and colour blindness.
 */
import { useFocusEffect } from "@react-navigation/native";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import {
  Alert,
  Linking,
  Pressable,
  SectionList,
  Share,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, endRun, getRun, leaveRun, startRun } from "../api/client";
import type { AttendeeStatus, Place, Run, RunState } from "../api/types";
import { BATTERY_GUIDE_URL } from "../config";
import {
  activeSessionRunId,
  startLiveSession,
  stopLiveSession,
  subscribeToRun,
  type StartHooks,
} from "../live/liveSession";
import { formatEta } from "../lib/eta";
import { compareEta, formatWhen } from "../lib/format";
import {
  arrivalCounts,
  initialLiveRunState,
  liveRunReducer,
} from "../lib/snapshotCache";
import type { ScreenProps } from "../navigation/types";
import { useSession } from "../session/SessionContext";
import { cacheRun, loadCachedRun, loadCachedSnapshot } from "../storage/storage";
import {
  ArrivalDots,
  Avatar,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  InlineBanner,
  LiveBadge,
  Loading,
  OfflineBanner,
  Plate,
  WazeButton,
  confirmAction,
} from "../ui/components";
import { haptic } from "../ui/haptics";
import { Icon } from "../ui/Icon";
import { PLACE_LABEL, type PlaceKind } from "../ui/mapMarkers";
import {
  DOCK_HEIGHT,
  ROW_INSET,
  TOUCH_MIN,
  makeStyles,
  radius,
  spacing,
  type,
  usePalette,
} from "../ui/theme";
import { useNow } from "../ui/useNow";

interface BoardRow {
  memberId: string;
  displayName: string;
  carName: string | null;
  status: AttendeeStatus;
  etaSeconds: number | null;
}

function openBatteryGuide() {
  void Linking.openURL(BATTERY_GUIDE_URL).catch(() => {
    Alert.alert(
      "Couldn't open the guide",
      "Find the battery setup steps in the app's README / repo.",
    );
  });
}

/**
 * UI side of the two-step background-permission flow (A6). liveSession owns the
 * permission *sequence*; these callbacks own the plain-language copy.
 */
const permissionHooks: StartHooks = {
  explainBackground: () =>
    new Promise<boolean>((resolve) => {
      Alert.alert(
        "Keep sharing when your screen is off",
        'Runs needs "Allow all the time" location so your kaki can still see you ' +
          "on the map when your screen is locked or Waze is in front. We only " +
          "share while a run you've joined is active — never otherwise.",
        [
          { text: "Not now", style: "cancel", onPress: () => resolve(false) },
          { text: "Continue", onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    }),
  offerSettings: () =>
    new Promise<boolean>((resolve) => {
      Alert.alert(
        'Set location to "Allow all the time"',
        "Android needs you to switch this app's location to \"Allow all the " +
          'time" in Settings so your position keeps updating with the screen ' +
          "off. Some phones also need Runs exempted from battery optimisation.",
        [
          {
            text: "Battery guide",
            onPress: () => {
              openBatteryGuide();
              resolve(false);
            },
          },
          { text: "Not now", style: "cancel", onPress: () => resolve(false) },
          { text: "Open settings", onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    }),
};

/** Who's in, then who's still coming (soonest first). */
function boardSections(
  rows: BoardRow[],
  state: RunState,
): { key: string; title: string; data: BoardRow[] }[] {
  const incoming = rows.filter((r) => r.status === "rsvped").sort(compareEta);
  const arrived = rows.filter((r) => r.status === "arrived");
  const sections =
    state === "upcoming"
      ? [{ key: "going", title: "Going", data: [...incoming, ...arrived] }]
      : [
          {
            key: "arrived",
            title: state === "ended" ? "Checked in" : "At the meetup",
            data: arrived,
          },
          {
            key: "incoming",
            title: state === "ended" ? "Didn't check in" : "On the way",
            data: incoming,
          },
        ];
  // No empty sections, so SectionList falls back to ListEmptyComponent.
  return sections.filter((s) => s.data.length > 0);
}

export default function RunDetailScreen({
  route,
  navigation,
}: ScreenProps<"RunDetail">) {
  const s = useStyles();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const { runId } = route.params;
  const { member, token } = useSession();
  const now = useNow(10_000);
  const [state, dispatch] = useReducer(liveRunReducer, initialLiveRunState);
  const [busy, setBusy] = useState(false);
  // True when we're sharing but only in the foreground (background permission
  // not granted) — drives the battery/permission help link (A6/A7).
  const [foregroundOnly, setForegroundOnly] = useState(false);
  // null = not known yet (session still starting) — show nothing rather than
  // flash a false "not sharing" warning.
  const [sharing, setSharing] = useState<boolean | null>(() =>
    activeSessionRunId() === runId ? true : null,
  );

  const run = state.run;
  const selfId = member?.id ?? "";
  const myAttendee = run?.attendees.find((a) => a.memberId === selfId);
  const joined = !!myAttendee && myAttendee.status !== "left";
  const isCreator = run?.creatorId === selfId;

  const load = useCallback(async () => {
    try {
      const fresh = await getRun(runId);
      dispatch({ type: "run_loaded", run: fresh, fromCache: false });
      void cacheRun(fresh);
    } catch {
      dispatch({ type: "run_fetch_failed" });
      const cached = await loadCachedRun(runId);
      if (cached) {
        dispatch({ type: "run_loaded", run: cached, fromCache: true });
      }
      const cachedSnap = await loadCachedSnapshot(runId);
      dispatch({
        type: "hydrate_cache",
        snapshot: cachedSnap?.snapshot ?? null,
        snapshotAt: cachedSnap?.savedAt ?? null,
      });
    }
  }, [runId]);

  // Also refreshes after the car picker sheet closes.
  useFocusEffect(
    useCallback(() => {
      void load();
      const interval = setInterval(() => {
        // Light poll keeps the board fresh for members without a socket
        // (not joined, or run still upcoming).
        if (activeSessionRunId() !== runId) void load();
      }, 15_000);
      return () => clearInterval(interval);
    }, [load, runId]),
  );

  // Live session events → reducer.
  useEffect(() => {
    return subscribeToRun(runId, (event) => {
      if (event.kind === "message") {
        dispatch({
          type: "ws_message",
          message: event.message,
          receivedAt: event.receivedAt,
        });
      } else if (event.kind === "connection") {
        dispatch({
          type: event.connected ? "ws_connected" : "ws_disconnected",
        });
      } else if (event.kind === "sharing") {
        setSharing(event.sharing);
      }
    });
  }, [runId]);

  // R7: sharing starts only when this member has joined an active run —
  // and hard-stops when the run ends (liveSession handles the end signal).
  useEffect(() => {
    if (!run || !token || !selfId) return;
    if (run.state === "active" && joined) {
      void startLiveSession(run, token, selfId, permissionHooks).then((res) => {
        setSharing(res.started);
        if (!res.started && res.error === "Location permission denied") {
          Alert.alert(
            "Location access needed",
            "Others can't see you on the run without location access. You can still view the board.",
          );
        }
        // Sharing works but only while the app is open — surface the guide so
        // the user can grant "Allow all the time" / fix battery settings.
        setForegroundOnly(res.started && !res.background);
      });
    } else if (run.state === "ended" && activeSessionRunId() === run.id) {
      void stopLiveSession();
    }
  }, [run, token, selfId, joined]);

  const shareRun = useCallback(async (r: Run) => {
    if (!r.inviteDeepLink) return;
    try {
      await Share.share({
        message:
          `Join "${r.name}" on Runs — ${formatWhen(r.startsAt, Date.now())}, ` +
          `meeting at ${r.meetup.label}.\n${r.inviteDeepLink}`,
      });
    } catch {
      // user dismissed / no share targets — fine
    }
  }, []);

  const canShare = !!run && run.state !== "ended" && !!run.inviteDeepLink;
  useLayoutEffect(() => {
    const share = () => {
      if (run) void shareRun(run);
    };
    navigation.setOptions({
      headerRight: canShare
        ? () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share invite link"
              onPress={share}
              hitSlop={6}
              style={({ pressed }) => [s.headerIcon, pressed && { opacity: 0.6 }]}
            >
              <Icon name="share" size={19} color={c.label} />
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, run, canShare, shareRun, s, c]);

  const rows: BoardRow[] = useMemo(() => {
    if (state.snapshot) {
      return state.snapshot.members.map((m) => ({
        memberId: m.memberId,
        displayName: m.displayName,
        carName: m.carName,
        status: m.status,
        etaSeconds: m.etaSeconds,
      }));
    }
    return (run?.attendees ?? [])
      .filter((a) => a.status !== "left")
      .map((a) => ({
        memberId: a.memberId,
        displayName: a.displayName,
        carName: a.carName,
        status: a.status,
        etaSeconds: null,
      }));
  }, [state.snapshot, run]);

  const counts = arrivalCounts(run);

  const openCarPicker = () =>
    navigation.navigate("CarPicker", {
      runId,
      currentCar: joined ? (myAttendee?.carName ?? null) : null,
    });

  const doLeave = async () => {
    const ok = await confirmAction({
      title: "Leave this run?",
      message:
        run?.state === "active"
          ? "You'll stop sharing your location and drop off the board."
          : "You'll be taken off the list of people going.",
      confirmLabel: "Leave run",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      // Privacy hard stop first (R7) — even if the request then fails, we
      // are no longer sharing.
      if (activeSessionRunId() === runId) await stopLiveSession();
      await leaveRun(runId);
      await load();
    } catch (err) {
      haptic.error();
      Alert.alert(
        "Couldn't leave the run",
        err instanceof ApiError && err.network
          ? "The server is unreachable — you've stopped sharing your location either way."
          : "Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const doStart = async () => {
    const ok = await confirmAction({
      title: "Start the run now?",
      message:
        "Everyone who joined will start sharing their live location with the group.",
      confirmLabel: "Start run",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await startRun(runId);
      haptic.success();
      await load();
    } catch {
      haptic.error();
      Alert.alert("Couldn't start the run", "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const doEnd = async () => {
    const ok = await confirmAction({
      title: "End the run for everyone?",
      message: "Location sharing stops for all members and the run moves to past runs.",
      confirmLabel: "End run",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await endRun(runId);
      if (activeSessionRunId() === runId) await stopLiveSession();
      await load();
    } catch {
      haptic.error();
      Alert.alert("Couldn't end the run", "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!run) {
    return state.offline ? (
      <View style={s.fill}>
        <EmptyState
          icon="offline"
          title="Can't load this run"
          body="The server is unreachable and there's no saved copy of this run on your phone yet."
        >
          <Button title="Try again" size="regular" role="tinted" onPress={() => void load()} />
        </EmptyState>
      </View>
    ) : (
      <Loading />
    );
  }

  const active = run.state === "active";
  const sections = boardSections(rows, run.state);

  let primary: ReactNode = null;
  if (run.state === "ended") {
    primary = (
      <InlineBanner
        icon="clock"
        tone="neutral"
        title="This run has ended"
        body="Location sharing has stopped for everyone."
      />
    );
  } else if (!joined) {
    primary = (
      <View style={s.primary}>
        <Button title="Join run" onPress={openCarPicker} loading={busy} />
        <Text style={s.helper}>
          {active
            ? "You'll share your location with the group until the run ends or you leave."
            : "Pick the car you're bringing. Location sharing only starts when the run goes live."}
        </Text>
      </View>
    );
  } else if (active) {
    primary = (
      <View style={s.primary}>
        <Button
          title="Open live map"
          icon="map"
          onPress={() => navigation.navigate("LiveMap", { runId })}
        />
        {sharing === true && !foregroundOnly ? (
          <InlineBanner
            icon="sharing"
            tone="success"
            title="Sharing your location"
            body="Stops automatically when the run ends or you leave."
          />
        ) : sharing === true && foregroundOnly ? (
          <InlineBanner
            icon="warning"
            tone="warning"
            title="Sharing pauses when locked"
            body={'Allow location "Always" so the group can still see you.'}
            actionLabel="Fix"
            onAction={openBatteryGuide}
          />
        ) : sharing === false ? (
          <InlineBanner
            icon="warning"
            tone="warning"
            title="Not sharing your location"
            body="Location access is off, so the group can't see you on the map."
            actionLabel="Settings"
            onAction={() => void Linking.openSettings()}
          />
        ) : null}
      </View>
    );
  } else {
    primary = (
      <InlineBanner
        icon="arrived"
        tone="success"
        title="You're going"
        body="Location sharing starts automatically when the run goes live."
      />
    );
  }

  const header = (
    <View>
      {state.offline && !state.connected ? (
        <View style={s.banner}>
          <OfflineBanner
            visible
            lastUpdatedAt={state.snapshotAt}
            now={now}
            onRetry={() => void load()}
          />
        </View>
      ) : null}

      <View style={s.hero}>
        <View style={s.heroTop}>
          {active ? (
            <LiveBadge />
          ) : (
            <Text style={s.eyebrow}>
              {run.state === "upcoming" ? "Upcoming" : "Ended"}
            </Text>
          )}
          <Text style={s.heroWhen} numberOfLines={1}>
            {formatWhen(run.startsAt, now).toUpperCase()}
            {isCreator ? " · YOUR RUN" : ""}
          </Text>
        </View>
        <Text style={s.title} accessibilityRole="header" maxFontSizeMultiplier={1.8}>
          {run.name}
        </Text>
      </View>

      <Card style={s.route}>
        <PlaceLeg kind="meetup" place={run.meetup} />
        {run.destination ? (
          <>
            <View style={s.legConnector}>
              <View style={s.legLine} />
            </View>
            <PlaceLeg kind="destination" place={run.destination} />
          </>
        ) : null}
      </Card>

      {run.state !== "upcoming" && counts.total > 0 ? (
        <View
          style={s.tally}
          accessible
          accessibilityRole="summary"
          accessibilityLabel={`${counts.arrived} of ${counts.total} ${
            run.state === "ended" ? "checked in" : "arrived"
          }`}
        >
          <Text style={s.tallyNumber} allowFontScaling={false}>
            {counts.arrived}
            <Text style={s.tallyOf}>/{counts.total}</Text>
          </Text>
          <View style={s.tallyRight}>
            <Text style={s.tallyLabel}>
              {run.state === "ended" ? "Checked in" : "Arrived"}
            </Text>
            <ArrivalDots arrived={counts.arrived} total={counts.total} />
          </View>
        </View>
      ) : null}

      <View style={s.actions}>
        {primary}
        {isCreator && run.state === "upcoming" ? (
          <Button
            title="Start run"
            icon="start"
            role={joined ? "filled" : "tinted"}
            onPress={doStart}
            loading={busy}
          />
        ) : null}
      </View>

      {joined && run.state !== "ended" ? (
        <Pressable
          onPress={openCarPicker}
          accessibilityRole="button"
          accessibilityLabel={`Your car, ${myAttendee?.carName ?? "none"}`}
          accessibilityHint="Change the car you're bringing"
          style={({ pressed }) => [s.carRow, pressed && { backgroundColor: c.highlight }]}
        >
          <Icon name="car" size={20} color={c.tint} />
          <Text style={s.carLabel}>You&apos;re bringing</Text>
          <Plate name={myAttendee?.carName ?? null} self />
          <Icon name="chevron" size={13} weight="semibold" color={c.tertiaryLabel} />
        </Pressable>
      ) : null}
    </View>
  );

  const canLeave = joined && run.state !== "ended";
  const canEnd = isCreator && active;

  return (
    <SectionList
      style={s.list}
      sections={sections}
      keyExtractor={(r) => r.memberId}
      contentContainerStyle={[
        s.content,
        { paddingBottom: insets.bottom + DOCK_HEIGHT + spacing.xxl },
      ]}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      renderSectionHeader={({ section }) => (
        <Eyebrow
          title={section.title}
          count={section.data.length}
          style={s.sectionHeader}
        />
      )}
      renderSectionFooter={() => <View style={s.sectionGap} />}
      renderItem={({ item, index, section }) => (
        <RollCallRow
          row={item}
          isSelf={item.memberId === selfId}
          runState={run.state}
          first={index === 0}
          last={index === section.data.length - 1}
        />
      )}
      ListEmptyComponent={
        <EmptyState
          icon="group"
          title="Nobody's joined yet"
          body="Share the invite link so the group can RSVP."
        />
      }
      ListFooterComponent={
        canLeave || canEnd ? (
          <View style={s.footer}>
            {canLeave ? (
              <Button
                title="Leave run"
                role="destructive"
                size="regular"
                onPress={doLeave}
                disabled={busy}
              />
            ) : null}
            {canEnd ? (
              <Button
                title="End run for everyone"
                role="destructive"
                size="regular"
                onPress={doEnd}
                disabled={busy}
              />
            ) : null}
          </View>
        ) : null
      }
    />
  );
}

function PlaceLeg({ kind, place }: { kind: PlaceKind; place: Place }) {
  const s = useStyles();
  const meetup = kind === "meetup";
  return (
    <View style={s.leg}>
      <View style={s.legMarker}>
        <View style={meetup ? s.legDotMeetup : s.legDotDestination} />
      </View>
      <View style={s.legText}>
        <Text style={s.legKind}>{PLACE_LABEL[kind].toUpperCase()}</Text>
        <Text style={s.legLabel} numberOfLines={2}>
          {place.label}
        </Text>
      </View>
      <WazeButton
        lat={place.lat}
        lng={place.lng}
        place={`the ${PLACE_LABEL[kind].toLowerCase()}`}
      />
    </View>
  );
}

function RollCallRow({
  row,
  isSelf,
  runState,
  first,
  last,
}: {
  row: BoardRow;
  isSelf: boolean;
  runState: RunState;
  first: boolean;
  last: boolean;
}) {
  const s = useStyles();
  const c = usePalette();
  const arrived = row.status === "arrived";

  // Three redundant signals carry "arrived": the filled avatar, the tick, and
  // the green edge. Never colour alone.
  let status: ReactNode = null;
  let spoken = "";
  if (arrived && runState !== "upcoming") {
    const label = runState === "ended" ? "Checked in" : "Arrived";
    status = (
      <View style={s.statusRow}>
        <Icon name="arrived" size={15} color={runState === "ended" ? c.secondaryLabel : c.green} />
        <Text style={s.statusText}>{label}</Text>
      </View>
    );
    spoken = label.toLowerCase();
  } else if (runState === "active") {
    if (row.etaSeconds !== null) {
      const eta = formatEta(row.etaSeconds);
      status = <Text style={s.eta}>{eta}</Text>;
      spoken = `on the way, ${eta} away`;
    } else {
      status = (
        <View style={s.statusRow}>
          <Text style={s.statusMuted}>No signal yet</Text>
        </View>
      );
      spoken = "on the way, no signal yet";
    }
  }

  return (
    <View
      style={[
        s.person,
        first && s.personFirst,
        last && s.personLast,
        arrived && runState === "active" && s.personArrived,
      ]}
      accessible
      accessibilityLabel={[
        row.displayName,
        isSelf ? "you" : null,
        row.carName ?? "riding along",
        spoken || null,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <Avatar
        name={row.displayName}
        state={isSelf ? "self" : arrived && runState === "active" ? "arrived" : "default"}
      />
      <View style={s.personText}>
        <Text style={s.personName} numberOfLines={1}>
          {row.displayName}
          {isSelf ? <Text style={s.you}> (You)</Text> : null}
        </Text>
        <Plate name={row.carName} self={isSelf} />
      </View>
      <View style={s.personStatus}>{status}</View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  fill: { flex: 1, backgroundColor: c.background, justifyContent: "center" },
  list: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: ROW_INSET, paddingTop: spacing.xs },
  headerIcon: {
    minWidth: TOUCH_MIN - 8,
    minHeight: TOUCH_MIN - 8,
    alignItems: "center",
    justifyContent: "center",
  },
  banner: { marginBottom: spacing.l },

  hero: { gap: spacing.s, marginBottom: spacing.l, paddingHorizontal: spacing.xs },
  heroTop: { flexDirection: "row", alignItems: "center", gap: spacing.s },
  eyebrow: { ...type.eyebrow, textTransform: "uppercase", color: c.secondaryLabel },
  heroWhen: { ...type.monoSmall, color: c.tertiaryLabel, flexShrink: 1 },
  title: { ...type.display1, color: c.label },

  route: { padding: spacing.l, gap: 0, marginBottom: spacing.l },
  leg: { flexDirection: "row", alignItems: "center", gap: spacing.m },
  legMarker: { width: 14, alignItems: "center" },
  legDotMeetup: { width: 11, height: 11, borderRadius: 6, backgroundColor: c.tint },
  legDotDestination: { width: 11, height: 11, borderRadius: 2, backgroundColor: c.label },
  legConnector: { width: 14, alignItems: "center", paddingVertical: 2 },
  legLine: {
    width: 0,
    height: 20,
    borderLeftWidth: 2,
    borderStyle: "dotted",
    borderColor: c.separator,
  },
  legText: { flex: 1, gap: 1 },
  legKind: { ...type.eyebrow, fontSize: 10, letterSpacing: 1.6, color: c.tertiaryLabel },
  legLabel: { ...type.bodySemi, color: c.label },

  tally: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.l,
    marginBottom: spacing.l,
    paddingHorizontal: spacing.xs,
  },
  tallyNumber: { ...type.monoHuge, color: c.label },
  tallyOf: { color: c.tertiaryLabel },
  tallyRight: { flex: 1, gap: 6 },
  tallyLabel: {
    ...type.eyebrow,
    textTransform: "uppercase",
    color: c.secondaryLabel,
  },

  actions: { gap: spacing.m, marginBottom: spacing.l },
  primary: { gap: spacing.m },
  helper: {
    ...type.footnote,
    color: c.tertiaryLabel,
    textAlign: "center",
    paddingHorizontal: spacing.l,
  },

  carRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    minHeight: TOUCH_MIN,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    backgroundColor: c.surface,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: c.separator,
    marginBottom: spacing.s,
  },
  carLabel: { ...type.callout, color: c.secondaryLabel, flex: 1 },

  sectionHeader: { marginTop: spacing.l },
  sectionGap: { height: spacing.s },

  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    minHeight: 62,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    backgroundColor: c.surface,
    borderWidth: 0.5,
    borderColor: c.separator,
    borderTopWidth: 0,
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
  },
  personFirst: {
    borderTopWidth: 0.5,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  personLast: {
    borderBottomLeftRadius: radius.card,
    borderBottomRightRadius: radius.card,
  },
  personArrived: { borderLeftColor: c.green },
  personText: { flex: 1, gap: 4, alignItems: "flex-start" },
  personName: { ...type.bodySemi, color: c.label },
  you: { ...type.callout, color: c.tertiaryLabel },
  personStatus: { alignItems: "flex-end", minWidth: 72 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusText: { ...type.footnote, color: c.secondaryLabel },
  statusMuted: { ...type.footnote, color: c.tertiaryLabel },
  eta: { ...type.monoMedium, color: c.label },

  footer: { gap: spacing.m, marginTop: spacing.xl },
}));

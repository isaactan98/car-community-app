/**
 * Run detail / arrival board (R2 + R3):
 * - attendee list with status, "12/18 arrived", arrived list, incoming list
 *   with live ETA from WS snapshots
 * - RSVP join/leave; the car picker is a native sheet (CarPickerScreen)
 * - share button exposing the run's invite deep link
 * - creator start/end controls, Waze handoff for meetup/destination (R5)
 * - degraded mode: cached run + snapshot with offline banner (R6)
 * - auto start/stop of location sharing per R7
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
  Platform,
  Pressable,
  SectionList,
  Share,
  Text,
  View,
} from "react-native";

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
import {
  cacheRun,
  loadCachedRun,
  loadCachedSnapshot,
} from "../storage/storage";
import {
  ArrivalDots,
  Avatar,
  Button,
  EmptyState,
  Group,
  InlineBanner,
  ListRow,
  LiveBadge,
  Loading,
  OfflineBanner,
  SectionHeader,
  WazeButton,
  confirmAction,
  rowPosition,
  type RowPosition,
} from "../ui/components";
import { haptic } from "../ui/haptics";
import { Icon } from "../ui/Icon";
import { PLACE_LABEL, type PlaceKind } from "../ui/mapMarkers";
import { ROW_INSET, TOUCH_MIN, makeStyles, spacing, type, usePalette } from "../ui/theme";
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
      "Couldn't Open the Guide",
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
        "Keep Sharing When Your Screen Is Off",
        'Runs needs "Allow all the time" location so your kaki can still see you ' +
          "on the map when your screen is locked or Waze is in front. We only " +
          "share while a run you've joined is active — never otherwise.",
        [
          { text: "Not Now", style: "cancel", onPress: () => resolve(false) },
          { text: "Continue", onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    }),
  offerSettings: () =>
    new Promise<boolean>((resolve) => {
      Alert.alert(
        'Set Location to "Allow All the Time"',
        "Android needs you to switch this app's location to \"Allow all the " +
          'time" in Settings so your position keeps updating with the screen ' +
          "off. Some phones also need Runs exempted from battery optimisation.",
        [
          {
            text: "Battery Guide",
            onPress: () => {
              openBatteryGuide();
              resolve(false);
            },
          },
          { text: "Not Now", style: "cancel", onPress: () => resolve(false) },
          { text: "Open Settings", onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    }),
};

/** Board sections: who's still coming (soonest first), then who's there. */
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
            key: "incoming",
            title: state === "ended" ? "Didn't Check In" : "On the Way",
            data: incoming,
          },
          {
            key: "arrived",
            title: state === "ended" ? "Checked In" : "Arrived",
            data: arrived,
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
            "Location Access Needed",
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
      // iOS: native bar button with the standard share symbol.
      unstable_headerRightItems: () =>
        canShare
          ? [
              {
                type: "button",
                label: "Share",
                icon: { type: "sfSymbol", name: "square.and.arrow.up" },
                onPress: share,
                accessibilityLabel: "Share invite link",
              },
            ]
          : [],
      headerRight:
        Platform.OS !== "ios" && canShare
          ? () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share invite link"
                onPress={share}
                style={s.headerIcon}
              >
                <Icon name="share" size={22} color={c.label} />
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
      title: "Leave This Run?",
      message:
        run?.state === "active"
          ? "You'll stop sharing your location and drop off the arrival board."
          : "You'll be taken off the list of people going.",
      confirmLabel: "Leave Run",
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
        "Couldn't Leave the Run",
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
      title: "Start the Run Now?",
      message:
        "Everyone who joined will start sharing their live location with the group.",
      confirmLabel: "Start Run",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await startRun(runId);
      haptic.success();
      await load();
    } catch {
      haptic.error();
      Alert.alert("Couldn't Start the Run", "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const doEnd = async () => {
    const ok = await confirmAction({
      title: "End the Run for Everyone?",
      message: "Location sharing stops for all members and the run moves to past runs.",
      confirmLabel: "End Run",
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
      Alert.alert("Couldn't End the Run", "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!run) {
    return state.offline ? (
      <View style={s.fill}>
        <EmptyState
          icon="offline"
          title="Can't Load This Run"
          body="The server is unreachable and there's no saved copy of this run on your phone yet."
        >
          <Button title="Try Again" size="regular" role="tinted" onPress={() => void load()} />
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
        title="This Run Has Ended"
        body="Location sharing has stopped for everyone."
      />
    );
  } else if (!joined) {
    primary = (
      <View style={s.primary}>
        <Button title="Join Run" onPress={openCarPicker} loading={busy} />
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
          title="Open Live Map"
          icon="map"
          onPress={() => navigation.navigate("LiveMap", { runId })}
        />
        {sharing === true && !foregroundOnly ? (
          <InlineBanner
            icon="sharing"
            tone="success"
            title="Sharing Your Location"
            body="Stops automatically when the run ends or you leave."
          />
        ) : sharing === true && foregroundOnly ? (
          <InlineBanner
            icon="warning"
            tone="warning"
            title="Sharing Pauses When Locked"
            body={'Allow location "Always" so the group can still see you.'}
            actionLabel="Fix"
            onAction={openBatteryGuide}
          />
        ) : sharing === false ? (
          <InlineBanner
            icon="warning"
            tone="warning"
            title="Not Sharing Your Location"
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
        title="You're Going"
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
        {active ? (
          <LiveBadge />
        ) : (
          <Text style={s.eyebrow}>{run.state === "upcoming" ? "Upcoming" : "Ended"}</Text>
        )}
        <Text style={s.title} accessibilityRole="header" maxFontSizeMultiplier={2}>
          {run.name}
        </Text>
        <Text style={s.when}>
          {formatWhen(run.startsAt, now)}
          {isCreator ? " · Organised by you" : ""}
        </Text>
      </View>

      <View style={s.actions}>
        {primary}
        {isCreator && run.state === "upcoming" ? (
          <Button
            title="Start Run"
            icon="start"
            role={joined ? "filled" : "tinted"}
            onPress={doStart}
            loading={busy}
          />
        ) : null}
      </View>

      <Group header="Route">
        <PlaceRow kind="meetup" place={run.meetup} />
        {run.destination ? <PlaceRow kind="destination" place={run.destination} /> : null}
      </Group>

      {joined && run.state !== "ended" ? (
        <Group header="Your RSVP">
          <ListRow
            leading={<Icon name="car" size={24} color={c.tint} />}
            title="Car"
            value={myAttendee?.carName ?? "None"}
            chevron
            onPress={openCarPicker}
            accessibilityLabel={`Car, ${myAttendee?.carName ?? "none"}`}
            accessibilityHint="Change the car you're bringing"
          />
        </Group>
      ) : null}

      {run.state !== "upcoming" && counts.total > 0 ? (
        <Group header="Arrival Board">
          <ListRow
            accessibilityLabel={`${counts.arrived} of ${counts.total} ${
              run.state === "ended" ? "checked in" : "arrived"
            }`}
            accessibilityRole="summary"
          >
            <View style={s.summary}>
              <Text style={s.summaryText}>
                {counts.arrived} of {counts.total}{" "}
                {run.state === "ended" ? "checked in" : "arrived"}
              </Text>
              <ArrivalDots arrived={counts.arrived} total={counts.total} />
            </View>
          </ListRow>
        </Group>
      ) : null}
    </View>
  );

  const destructiveRows = [
    joined && run.state !== "ended" ? (
      <ListRow key="leave" title="Leave Run" destructive onPress={doLeave} disabled={busy} />
    ) : null,
    isCreator && active ? (
      <ListRow
        key="end"
        title="End Run for Everyone"
        destructive
        onPress={doEnd}
        disabled={busy}
      />
    ) : null,
  ].filter(Boolean);

  return (
    <SectionList
      style={s.list}
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={(r) => r.memberId}
      contentContainerStyle={s.content}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      renderSectionHeader={({ section }) => (
        <SectionHeader title={section.title} count={section.data.length} />
      )}
      renderSectionFooter={() => <View style={s.sectionGap} />}
      renderItem={({ item, index, section }) => (
        <AttendeeRow
          row={item}
          isSelf={item.memberId === selfId}
          runState={run.state}
          position={rowPosition(index, section.data.length)}
        />
      )}
      ListEmptyComponent={
        <EmptyState
          icon="group"
          title="Nobody's Joined Yet"
          body="Share the invite link so the group can RSVP."
        />
      }
      ListFooterComponent={
        destructiveRows.length > 0 ? <Group>{destructiveRows}</Group> : null
      }
    />
  );
}

function PlaceRow({
  kind,
  place,
  position,
}: {
  kind: PlaceKind;
  place: Place;
  position?: RowPosition;
}) {
  const c = usePalette();
  return (
    <ListRow
      position={position}
      leading={
        <Icon
          name={kind === "meetup" ? "meetup" : "destination"}
          size={26}
          color={kind === "meetup" ? c.tint : c.label}
        />
      }
      title={place.label}
      subtitle={PLACE_LABEL[kind]}
      trailing={
        <WazeButton
          lat={place.lat}
          lng={place.lng}
          place={`the ${PLACE_LABEL[kind].toLowerCase()}`}
        />
      }
    />
  );
}

function AttendeeRow({
  row,
  isSelf,
  runState,
  position,
}: {
  row: BoardRow;
  isSelf: boolean;
  runState: RunState;
  position: RowPosition;
}) {
  const s = useStyles();
  const c = usePalette();
  const arrived = row.status === "arrived";

  // Colour lives on the symbol; the words stay in label colours so the
  // state reads without colour and passes contrast in both appearances.
  let status: ReactNode = null;
  let spoken = "";
  if (runState === "active") {
    if (arrived) {
      status = (
        <View style={s.status}>
          <Icon name="arrived" size={17} color={c.green} />
          <Text style={s.statusText}>Arrived</Text>
        </View>
      );
      spoken = "arrived";
    } else if (row.etaSeconds !== null) {
      const eta = row.etaSeconds < 45 ? "Arriving" : formatEta(row.etaSeconds);
      status = (
        <View style={s.status}>
          <Icon name="car" size={15} color={c.blue} />
          <Text style={s.eta}>{eta}</Text>
        </View>
      );
      spoken = `on the way, ${eta} away`;
    } else {
      status = <Text style={s.statusText}>On the way</Text>;
      spoken = "on the way";
    }
  } else if (runState === "ended" && arrived) {
    status = (
      <View style={s.status}>
        <Icon name="arrived" size={17} color={c.secondaryLabel} />
        <Text style={s.statusText}>Checked in</Text>
      </View>
    );
  }

  return (
    <ListRow
      position={position}
      leading={<Avatar name={row.displayName} />}
      trailing={status}
      accessibilityLabel={[row.displayName, isSelf ? "you" : null, row.carName, spoken || null]
        .filter(Boolean)
        .join(", ")}
    >
      <View style={s.personText}>
        <Text style={s.personName} numberOfLines={1}>
          {row.displayName}
          {isSelf ? <Text style={s.you}> (You)</Text> : null}
        </Text>
        <Text style={s.personCar} numberOfLines={1}>
          {row.carName ?? "No car listed"}
        </Text>
      </View>
    </ListRow>
  );
}

const useStyles = makeStyles((c) => ({
  fill: { flex: 1, backgroundColor: c.background, justifyContent: "center" },
  list: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: ROW_INSET, paddingTop: spacing.s, paddingBottom: spacing.xxl },
  headerIcon: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
  banner: { marginBottom: spacing.m },
  hero: {
    gap: spacing.xs,
    marginTop: spacing.s,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.xs,
  },
  eyebrow: {
    ...type.footnote,
    fontWeight: "600",
    color: c.secondaryLabel,
    textTransform: "uppercase",
  },
  title: { ...type.title1, color: c.label },
  when: { ...type.body, color: c.secondaryLabel },
  actions: { gap: spacing.m, marginBottom: spacing.xxl - spacing.s },
  primary: { gap: spacing.m },
  helper: {
    ...type.footnote,
    color: c.secondaryLabel,
    textAlign: "center",
    paddingHorizontal: spacing.l,
  },
  summary: { flex: 1, gap: spacing.s, paddingVertical: spacing.xs },
  summaryText: { ...type.headline, color: c.label },
  sectionGap: { height: spacing.xl },
  personText: { flex: 1, gap: 2 },
  personName: { ...type.body, color: c.label },
  you: { color: c.secondaryLabel },
  personCar: { ...type.subheadline, color: c.secondaryLabel },
  status: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusText: { ...type.subheadline, color: c.secondaryLabel },
  eta: { ...type.headline, color: c.label },
}));

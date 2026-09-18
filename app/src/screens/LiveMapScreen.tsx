/**
 * Live map for an active run (R4):
 * - all participants' last positions from WS snapshots on a MapLibre map
 *   (OpenFreeMap style — no Mapbox/Google)
 * - per-dot staleness indicator when last update > 60 s
 * - "distance to car ahead" readout (nearest participant ahead along my
 *   bearing to destination/meetup — simple version per spec)
 * - Waze handoff for meetup, destination, and any member's last position (R5)
 * - degraded mode: renders the cached snapshot with an offline banner (R6)
 *
 * The readout is the biggest thing on the screen on purpose. This is the
 * number a driver checks at 100km/h on the Second Link; it has to be legible
 * without focusing on the phone. Below it, the crew strip lists the convoy in
 * road order, left to right, so "where is everyone" is one glance rather than
 * a list to read.
 */
import {
  Camera,
  Map,
  Marker,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getRun } from "../api/client";
import type { LatLng, SnapshotMember } from "../api/types";
import { MAP_STYLE_DARK_URL, MAP_STYLE_MUTED_URL } from "../config";
import { activeSessionRunId, isSocketConnected, subscribeToRun } from "../live/liveSession";
import { formatEta } from "../lib/eta";
import { distanceToCarAhead, formatDistance, haversineMeters } from "../lib/geo";
import { initialLiveRunState, liveRunReducer } from "../lib/snapshotCache";
import { formatAge, isStale } from "../lib/staleness";
import type { ScreenProps } from "../navigation/types";
import { useSession } from "../session/SessionContext";
import { cacheRun, loadCachedRun, loadCachedSnapshot } from "../storage/storage";
import { Avatar, Button, LiveBadge, Loading, WazeButton } from "../ui/components";
import { haptic } from "../ui/haptics";
import { Icon, type IconName } from "../ui/Icon";
import {
  PLACE_MARKER_PROPS,
  PersonDot,
  PlaceMarker,
  personMarkerProps,
} from "../ui/mapMarkers";
import {
  elevation,
  makeStyles,
  radius,
  spacing,
  type,
  usePalette,
  useScheme,
  type Palette,
} from "../ui/theme";
import { useNow } from "../ui/useNow";

/** Below this zoom, arrived members fold into the meetup pin. */
const CLUSTER_ZOOM = 12;

type Bounds = [west: number, south: number, east: number, north: number];

function boundsOf(points: LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  // A single point (or everyone at the meetup) would zoom to street level;
  // pad to roughly a 2 km box instead.
  const pad = 0.01;
  if (east - west < pad) {
    west -= pad;
    east += pad;
  }
  if (north - south < pad) {
    south -= pad;
    north += pad;
  }
  return [west, south, east, north];
}

function dotColor(
  c: Palette,
  m: SnapshotMember,
  isSelf: boolean,
  stale: boolean,
): ColorValue {
  if (stale) return c.gray;
  if (isSelf) return c.tint;
  return m.status === "arrived" ? c.green : c.blue;
}

export default function LiveMapScreen({ route, navigation }: ScreenProps<"LiveMap">) {
  const s = useStyles();
  const c = usePalette();
  const scheme = useScheme();
  const { runId } = route.params;
  const { member } = useSession();
  const insets = useSafeAreaInsets();
  const [state, dispatch] = useReducer(liveRunReducer, initialLiveRunState);
  const now = useNow(5000);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [zoom, setZoom] = useState(10);
  const [sheetHeight, setSheetHeight] = useState(240);
  const reduceMotion = useReduceMotion();
  const cameraRef = useRef<CameraRef>(null);
  const autoFitDone = useRef(false);
  const markerPressedAt = useRef(0);

  const selfId = member?.id ?? "";
  const run = state.run;

  const load = useCallback(async () => {
    try {
      const fresh = await getRun(runId);
      dispatch({ type: "run_loaded", run: fresh, fromCache: false });
      void cacheRun(fresh);
    } catch {
      dispatch({ type: "run_fetch_failed" });
      const cached = await loadCachedRun(runId);
      if (cached) dispatch({ type: "run_loaded", run: cached, fromCache: true });
    }
    // Always try the cached snapshot so a dead server still renders dots.
    const cachedSnap = await loadCachedSnapshot(runId);
    dispatch({
      type: "hydrate_cache",
      snapshot: cachedSnap?.snapshot ?? null,
      snapshotAt: cachedSnap?.savedAt ?? null,
    });
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // We almost always arrive here after RunDetail already opened the socket,
    // so the initial `ws_connected` event fired before we subscribed. Seed from
    // the live session's current state, or the map would show a false
    // "Offline — data stale" banner for the whole run.
    if (activeSessionRunId() === runId && isSocketConnected()) {
      dispatch({ type: "ws_connected" });
    }
    return subscribeToRun(runId, (event) => {
      if (event.kind === "message") {
        dispatch({
          type: "ws_message",
          message: event.message,
          receivedAt: event.receivedAt,
        });
      } else if (event.kind === "connection") {
        dispatch({ type: event.connected ? "ws_connected" : "ws_disconnected" });
      }
    });
  }, [runId]);

  const members: SnapshotMember[] = state.snapshot?.members ?? [];
  const positioned = members.filter((m) => m.lastPosition !== null);
  const me = members.find((m) => m.memberId === selfId);
  const selectedMember = positioned.find((m) => m.memberId === selected) ?? null;

  // Leave room for the bar above and the sheet below.
  const fitPadding = {
    top: insets.top + 64,
    bottom: sheetHeight + 24,
    left: 48,
    right: 48,
  };

  const fitAll = (duration: number) => {
    if (!run) return;
    const points: LatLng[] = [run.meetup];
    if (run.destination) points.push(run.destination);
    for (const m of positioned) points.push(m.lastPosition!);
    const bounds = boundsOf(points);
    if (bounds) {
      cameraRef.current?.fitBounds(bounds, {
        padding: fitPadding,
        duration: reduceMotion ? 0 : duration,
      });
    }
  };

  const centerOn = (pos: LatLng | null | undefined) => {
    if (!pos) return;
    cameraRef.current?.flyTo({
      center: [pos.lng, pos.lat],
      zoom: 14,
      duration: reduceMotion ? 0 : 600,
    });
  };

  const fitOnFirstPositions = useEffectEvent(() => fitAll(0));
  // Once the map is up and the first positions are in, frame everyone.
  useEffect(() => {
    if (autoFitDone.current || !mapReady || positioned.length === 0) return;
    autoFitDone.current = true;
    fitOnFirstPositions();
  }, [mapReady, positioned.length]);

  // Cheap enough to derive every render (≤ tens of members).
  const carAhead =
    run && me?.lastPosition
      ? distanceToCarAhead(
          me.lastPosition,
          run.destination ?? run.meetup,
          positioned
            .filter(
              (m) =>
                m.memberId !== selfId &&
                m.lastPosition !== null &&
                !isStale(m.lastPosition.ts, now),
            )
            .map((m) => ({
              memberId: m.memberId,
              displayName: m.displayName,
              position: m.lastPosition!,
            })),
        )
      : null;

  if (!run) return <Loading />;

  const stale =
    !state.connected || (state.snapshotAt !== null && now - state.snapshotAt > 60_000);
  const clustered = zoom < CLUSTER_ZOOM;
  const visible = positioned.filter(
    (m) =>
      !clustered ||
      m.status !== "arrived" ||
      m.memberId === selfId ||
      m.memberId === selected,
  );
  const gathered = clustered ? positioned.length - visible.length : 0;

  const initialBounds = boundsOf(
    run.destination ? [run.meetup, run.destination] : [run.meetup],
  )!;

  const hasMe = !!me?.lastPosition;

  return (
    <View style={s.root}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={scheme === "night" ? MAP_STYLE_DARK_URL : MAP_STYLE_MUTED_URL}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onRegionDidChange={(e) => setZoom(e.nativeEvent.zoom)}
        onPress={() => {
          // MapLibre also fires the map's onPress right after a marker's;
          // ignore that echo or tapping a dot would deselect it instantly.
          if (Date.now() - markerPressedAt.current > 400) setSelected(null);
        }}
        compass={false}
        logoPosition={{ top: insets.top + 60, left: 12 }}
        attributionPosition={{ top: insets.top + 60, left: 96 }}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ bounds: initialBounds, padding: fitPadding }}
        />
        {visible.map((m) => {
          const pos = m.lastPosition!;
          const memberStale = isStale(pos.ts, now);
          const isSelf = m.memberId === selfId;
          return (
            <Marker
              key={m.memberId}
              lngLat={[pos.lng, pos.lat]}
              {...personMarkerProps(isSelf)}
              onPress={() => {
                markerPressedAt.current = Date.now();
                haptic.selection();
                setSelected(m.memberId);
              }}
            >
              <PersonDot
                name={m.displayName}
                color={dotColor(c, m, isSelf, memberStale)}
                isSelf={isSelf}
                selected={m.memberId === selected}
                note={memberStale ? formatAge(pos.ts, now) : undefined}
              />
            </Marker>
          );
        })}
        {/* Places last so they stay on top of the crowd at the meetup. */}
        <Marker lngLat={[run.meetup.lng, run.meetup.lat]} {...PLACE_MARKER_PROPS}>
          <PlaceMarker kind="meetup" count={gathered} />
        </Marker>
        {run.destination ? (
          <Marker
            lngLat={[run.destination.lng, run.destination.lat]}
            {...PLACE_MARKER_PROPS}
          >
            <PlaceMarker kind="destination" />
          </Marker>
        ) : null}
      </Map>

      <View style={[s.overbar, { paddingTop: insets.top + spacing.s }]} pointerEvents="box-none">
        <GlassButton
          icon="chevron"
          label="Back"
          flip
          onPress={() => navigation.goBack()}
        />
        {!stale ? <LiveBadge style={s.liveOnMap} /> : null}
        <View style={s.spacer} />
        {hasMe ? (
          <GlassButton
            icon="locate"
            label="My location"
            onPress={() => centerOn(me?.lastPosition)}
          />
        ) : null}
        <GlassButton icon="fitAll" label="Show everyone" onPress={() => fitAll(600)} />
      </View>

      <Sheet
        onLayout={(h) => setSheetHeight(h)}
        style={{ paddingBottom: insets.bottom + spacing.l }}
      >
        <View style={s.grab} />

        {selectedMember?.lastPosition ? (
          <SelectedMember
            member={selectedMember}
            isSelf={selectedMember.memberId === selfId}
            now={now}
            onClose={() => setSelected(null)}
          />
        ) : (
          <View
            style={s.ahead}
            accessible
            accessibilityLabel={
              carAhead
                ? `Car ahead: ${carAhead.displayName}, ${formatDistance(carAhead.distanceMeters)}`
                : "No car ahead of you"
            }
          >
            {carAhead ? (
              <>
                <Text style={s.aheadNumber} numberOfLines={1} allowFontScaling={false}>
                  {formatDistance(carAhead.distanceMeters)}
                </Text>
                <Text style={s.aheadWho} numberOfLines={2}>
                  to <Text style={s.aheadName}>{carAhead.displayName}</Text>,{"\n"}the car
                  ahead of you
                </Text>
              </>
            ) : (
              <Text style={s.aheadEmpty} numberOfLines={2}>
                {!hasMe
                  ? "Finding your position…"
                  : positioned.length <= 1
                    ? state.connected
                      ? "Nobody else is sharing a position yet."
                      : "No positions saved on this phone yet."
                    : "Nobody ahead of you — you're leading."}
              </Text>
            )}
          </View>
        )}

        {positioned.length > 0 ? (
          <CrewStrip
            members={positioned}
            me={me ?? null}
            selfId={selfId}
            selected={selected}
            now={now}
            onSelect={(m) => {
              setSelected(m.memberId);
              centerOn(m.lastPosition);
            }}
          />
        ) : null}

        <View style={s.wazeRow}>
          <WazeButton
            lat={(run.destination ?? run.meetup).lat}
            lng={(run.destination ?? run.meetup).lng}
            label={`Waze to ${(run.destination ?? run.meetup).label}`}
            place={run.destination ? "the destination" : "the meetup"}
            role="filled"
            size="large"
            style={s.flex}
          />
        </View>

        <StatusLine
          stale={stale}
          snapshotAt={state.snapshotAt}
          now={now}
          onRetry={() => void load()}
        />
      </Sheet>
    </View>
  );
}

/** Camera flights are zoom animations; skip them under Reduce Motion. */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

/**
 * Liquid Glass on iOS 26+ — the one Apple material worth keeping, because
 * floating controls over a map is exactly what it's for. Opaque everywhere
 * else and whenever Reduce Transparency is on.
 */
function Sheet({
  children,
  onLayout,
  style,
}: {
  children: ReactNode;
  onLayout: (height: number) => void;
  style?: object;
}) {
  const s = useStyles();
  const scheme = useScheme();
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setReduceTransparency);
    const sub = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setReduceTransparency,
    );
    return () => sub.remove();
  }, []);
  const glass = isLiquidGlassAvailable() && !reduceTransparency;
  const layout = (e: { nativeEvent: { layout: { height: number } } }) =>
    onLayout(e.nativeEvent.layout.height);
  return glass ? (
    <GlassView
      style={[s.sheet, elevation(scheme, 2), style]}
      glassEffectStyle="regular"
      onLayout={layout}
    >
      {children}
    </GlassView>
  ) : (
    <View style={[s.sheet, s.sheetOpaque, elevation(scheme, 2), style]} onLayout={layout}>
      {children}
    </View>
  );
}

/**
 * The convoy in road order. Distance is from you, so the strip reads as
 * "who's near me" without opening anything.
 */
function CrewStrip({
  members,
  me,
  selfId,
  selected,
  now,
  onSelect,
}: {
  members: SnapshotMember[];
  me: SnapshotMember | null;
  selfId: string;
  selected: string | null;
  now: number;
  onSelect: (m: SnapshotMember) => void;
}) {
  const s = useStyles();
  const myPos = me?.lastPosition ?? null;
  const ordered = [...members].sort((a, b) => {
    if (a.memberId === selfId) return -1;
    if (b.memberId === selfId) return 1;
    if (!myPos || !a.lastPosition || !b.lastPosition) return 0;
    return (
      haversineMeters(myPos, a.lastPosition) - haversineMeters(myPos, b.lastPosition)
    );
  });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.strip}
      accessibilityLabel="Everyone on this run"
    >
      {ordered.map((m) => {
        const isSelf = m.memberId === selfId;
        const pos = m.lastPosition!;
        const memberStale = isStale(pos.ts, now);
        const detail = memberStale
          ? `${formatAge(pos.ts, now)} ago`
          : isSelf
            ? (m.carName ?? "You")
            : m.status === "arrived"
              ? "Arrived"
              : myPos
                ? formatDistance(haversineMeters(myPos, pos))
                : formatEta(m.etaSeconds);
        return (
          <Pressable
            key={m.memberId}
            accessibilityRole="button"
            accessibilityLabel={`${isSelf ? "You" : m.displayName}, ${detail}`}
            accessibilityState={{ selected: m.memberId === selected }}
            onPress={() => onSelect(m)}
            style={({ pressed }) => [
              s.chip,
              m.memberId === selected && s.chipSelected,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Avatar
              name={m.displayName}
              size={26}
              state={
                isSelf ? "self" : m.status === "arrived" && !memberStale ? "arrived" : "default"
              }
            />
            <View style={s.chipText}>
              <Text style={s.chipName} numberOfLines={1}>
                {isSelf ? "You" : m.displayName}
              </Text>
              <Text style={s.chipDetail} numberOfLines={1}>
                {detail}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function StatusLine({
  stale,
  snapshotAt,
  now,
  onRetry,
}: {
  stale: boolean;
  snapshotAt: number | null;
  now: number;
  onRetry: () => void;
}) {
  const s = useStyles();
  const c = usePalette();
  if (stale) {
    return (
      <View style={s.status} accessibilityRole="alert">
        <Icon name="offline" size={14} color={c.yellow} />
        <Text style={s.statusText} numberOfLines={2}>
          Offline
          {snapshotAt !== null ? ` · last update ${formatAge(snapshotAt, now)} ago` : ""}
        </Text>
        <Button title="Retry" role="plain" size="small" onPress={onRetry} />
      </View>
    );
  }
  return (
    <View style={s.status}>
      <View style={s.statusDot} />
      <Text style={s.statusText} numberOfLines={1}>
        Sharing your location — stops when the run ends.
      </Text>
    </View>
  );
}

function SelectedMember({
  member,
  isSelf,
  now,
  onClose,
}: {
  member: SnapshotMember;
  isSelf: boolean;
  now: number;
  onClose: () => void;
}) {
  const s = useStyles();
  const c = usePalette();
  const pos = member.lastPosition!;
  const status =
    member.status === "arrived"
      ? "At the meetup"
      : member.etaSeconds !== null
        ? `ETA ${formatEta(member.etaSeconds)}`
        : "On the way";
  return (
    <View style={s.selected}>
      <View style={s.selectedTop}>
        <Avatar
          name={member.displayName}
          size={42}
          state={isSelf ? "self" : member.status === "arrived" ? "arrived" : "default"}
        />
        <View style={s.flex}>
          <Text style={s.selectedName} numberOfLines={1}>
            {isSelf ? "You" : member.displayName}
          </Text>
          <Text style={s.selectedMeta} numberOfLines={2}>
            {[member.carName, status, `updated ${formatAge(pos.ts, now)} ago`]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={8}
          style={s.close}
        >
          <Icon name="close" size={13} weight="bold" color={c.secondaryLabel} />
        </Pressable>
      </View>
      {!isSelf ? (
        <WazeButton
          lat={pos.lat}
          lng={pos.lng}
          label={`Waze to ${member.displayName}`}
          place={member.displayName}
          size="regular"
        />
      ) : null}
    </View>
  );
}

function GlassButton({
  icon,
  label,
  flip,
  onPress,
}: {
  icon: IconName;
  label: string;
  /** Chevron points right by default; the back button needs it mirrored. */
  flip?: boolean;
  onPress: () => void;
}) {
  const s = useStyles();
  const c = usePalette();
  const scheme = useScheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        s.glassButton,
        elevation(scheme, 1),
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon
        name={icon}
        size={17}
        weight="semibold"
        color={c.label}
        style={flip ? s.flip : undefined}
      />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.mapBackground },
  flex: { flex: 1 },
  spacer: { flex: 1 },
  flip: { transform: [{ rotate: "180deg" }] },

  overbar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
  },
  liveOnMap: { marginLeft: spacing.xs },
  glassButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.glass,
    borderWidth: 0.5,
    borderColor: c.separator,
  },

  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderCurve: "continuous",
    borderTopWidth: 0.5,
    borderColor: c.separator,
    paddingHorizontal: spacing.l,
    paddingTop: spacing.s,
    gap: spacing.m,
    overflow: "hidden",
  },
  sheetOpaque: { backgroundColor: c.glass },
  grab: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.separator,
    alignSelf: "center",
  },

  ahead: { flexDirection: "row", alignItems: "flex-end", gap: spacing.m },
  aheadNumber: { ...type.monoHuge, color: c.label },
  aheadWho: { ...type.footnote, color: c.secondaryLabel, flex: 1, paddingBottom: 4 },
  aheadName: { ...type.footnoteSemi, color: c.label },
  aheadEmpty: { ...type.bodyMedium, color: c.secondaryLabel, flex: 1 },

  strip: { gap: spacing.s, paddingVertical: 2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingLeft: 5,
    paddingRight: spacing.m,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: c.fill,
    borderWidth: 1,
    borderColor: "transparent",
  },
  chipSelected: { borderColor: c.tint },
  chipText: { gap: 0 },
  chipName: { ...type.caption, fontSize: 12.5, color: c.label },
  chipDetail: { ...type.monoSmall, fontSize: 10.5, color: c.secondaryLabel },

  wazeRow: { flexDirection: "row", gap: spacing.s },

  status: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 20 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.green },
  statusText: { ...type.footnote, fontSize: 12, color: c.secondaryLabel, flex: 1 },

  selected: { gap: spacing.m },
  selectedTop: { flexDirection: "row", alignItems: "center", gap: spacing.m },
  selectedName: { ...type.display3, color: c.label },
  selectedMeta: { ...type.footnote, color: c.secondaryLabel },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.fill,
  },
}));

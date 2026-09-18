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
 * Laid out like Apple Maps: a full-bleed map under a transparent bar with
 * glass controls, and one floating Liquid Glass card for the readout.
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
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
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
import { distanceToCarAhead, formatDistance } from "../lib/geo";
import { initialLiveRunState, liveRunReducer } from "../lib/snapshotCache";
import { formatAge, isStale } from "../lib/staleness";
import type { ScreenProps } from "../navigation/types";
import { useSession } from "../session/SessionContext";
import { cacheRun, loadCachedRun, loadCachedSnapshot } from "../storage/storage";
import { Avatar, Button, Loading, WazeButton } from "../ui/components";
import { haptic } from "../ui/haptics";
import { Icon, type IconName } from "../ui/Icon";
import {
  PLACE_MARKER_PROPS,
  PersonDot,
  PlaceMarker,
  personMarkerProps,
} from "../ui/mapMarkers";
import {
  TOUCH_MIN,
  makeStyles,
  spacing,
  type,
  usePalette,
  useScheme,
  type Palette,
} from "../ui/theme";
import { useNow } from "../ui/useNow";

/** Below this zoom, arrived members fold into the meetup pin (HIG › Maps). */
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
  const [cardHeight, setCardHeight] = useState(220);
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

  // Leave room for the bar above and the floating card below.
  const fitPadding = {
    top: insets.top + 64,
    bottom: cardHeight + insets.bottom + 24,
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

  const centerOnMe = () => {
    const pos = me?.lastPosition;
    if (!pos) return;
    cameraRef.current?.flyTo({
      center: [pos.lng, pos.lat],
      zoom: 14,
      duration: reduceMotion ? 0 : 600,
    });
  };

  // Bar buttons are created when their availability changes; route presses
  // to the latest closures.
  const actions = useRef({ fitAll, centerOnMe });
  useLayoutEffect(() => {
    actions.current = { fitAll, centerOnMe };
  });

  const hasMe = !!me?.lastPosition;
  useLayoutEffect(() => {
    const fit = () => actions.current.fitAll(600);
    const locate = () => actions.current.centerOnMe();
    navigation.setOptions({
      unstable_headerRightItems: () => [
        ...(hasMe
          ? [
              {
                type: "button" as const,
                label: "My Location",
                icon: { type: "sfSymbol" as const, name: "location.fill" as const },
                onPress: locate,
              },
            ]
          : []),
        {
          type: "button" as const,
          label: "Show Everyone",
          icon: {
            type: "sfSymbol" as const,
            name: "arrow.up.left.and.arrow.down.right" as const,
          },
          onPress: fit,
        },
      ],
    });
  }, [navigation, hasMe]);

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

  return (
    <View style={s.root}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={scheme === "dark" ? MAP_STYLE_DARK_URL : MAP_STYLE_MUTED_URL}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onRegionDidChange={(e) => setZoom(e.nativeEvent.zoom)}
        onPress={() => {
          // MapLibre also fires the map's onPress right after a marker's;
          // ignore that echo or tapping a dot would deselect it instantly.
          if (Date.now() - markerPressedAt.current > 400) setSelected(null);
        }}
        compass={false}
        logoPosition={{ top: insets.top + 56, left: 12 }}
        attributionPosition={{ top: insets.top + 56, left: 96 }}
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

      {Platform.OS !== "ios" ? (
        <View style={[s.controls, { top: spacing.m }]}>
          {hasMe ? (
            <MapControl icon="locate" label="My location" onPress={centerOnMe} />
          ) : null}
          <MapControl icon="fitAll" label="Show everyone" onPress={() => fitAll(600)} />
        </View>
      ) : null}

      <View
        style={[s.cardWrap, { paddingBottom: insets.bottom + spacing.s }]}
        pointerEvents="box-none"
      >
        <FloatingCard onLayout={(h) => setCardHeight(h)}>
          <StatusLine
            stale={stale}
            snapshotAt={state.snapshotAt}
            now={now}
            onRetry={() => void load()}
          />

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
                  : undefined
              }
            >
              <Text style={s.overline}>Car Ahead</Text>
              <Text style={s.aheadValue} numberOfLines={1} maxFontSizeMultiplier={1.6}>
                {carAhead
                  ? `${carAhead.displayName} · ${formatDistance(carAhead.distanceMeters)}`
                  : me?.lastPosition
                    ? "Nobody Ahead"
                    : "Finding You…"}
              </Text>
              {positioned.length === 0 ? (
                <Text style={s.caption}>
                  {state.connected
                    ? "Nobody is sharing a position yet."
                    : "No positions saved on this phone yet."}
                </Text>
              ) : null}
            </View>
          )}

          <View style={s.waze}>
            <Text style={s.overline}>Open in Waze</Text>
            <View style={s.wazeRow}>
              <WazeButton
                lat={run.meetup.lat}
                lng={run.meetup.lng}
                label="Meetup"
                place="the meetup"
                style={s.flex}
              />
              {run.destination ? (
                <WazeButton
                  lat={run.destination.lat}
                  lng={run.destination.lng}
                  label="Destination"
                  place="the destination"
                  style={s.flex}
                />
              ) : null}
            </View>
          </View>
        </FloatingCard>
      </View>
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
 * Liquid Glass on iOS 26+ (functional layer only, per HIG › Materials); an
 * opaque card elsewhere and whenever Reduce Transparency is on.
 */
function FloatingCard({
  children,
  onLayout,
}: {
  children: ReactNode;
  onLayout: (height: number) => void;
}) {
  const s = useStyles();
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
    <GlassView style={s.card} glassEffectStyle="regular" onLayout={layout}>
      {children}
    </GlassView>
  ) : (
    <View style={[s.card, s.cardOpaque]} onLayout={layout}>
      {children}
    </View>
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
        <Icon name="offline" size={15} color={c.yellow} />
        <Text style={s.statusText} numberOfLines={2}>
          Offline
          {snapshotAt !== null ? ` · last update ${formatAge(snapshotAt, now)} ago` : ""}
        </Text>
        <Button title="Retry" role="plain" size="regular" onPress={onRetry} />
      </View>
    );
  }
  return (
    <View style={s.status}>
      <View style={s.liveDot} />
      <Text style={s.statusText}>
        Live{snapshotAt !== null ? ` · updated ${formatAge(snapshotAt, now)} ago` : ""}
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
        <Avatar name={member.displayName} size={44} />
        <View style={s.flex}>
          <Text style={s.selectedName} numberOfLines={1}>
            {isSelf ? "You" : member.displayName}
          </Text>
          <Text style={s.caption} numberOfLines={2}>
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
          <Icon name="close" size={14} weight="bold" color={c.secondaryLabel} />
        </Pressable>
      </View>
      {!isSelf ? (
        <WazeButton
          lat={pos.lat}
          lng={pos.lng}
          label={`Waze to ${member.displayName}`}
          place={member.displayName}
          size="large"
        />
      ) : null}
    </View>
  );
}

function MapControl({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const s = useStyles();
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.control, pressed && { opacity: 0.7 }]}
    >
      <Icon name={icon} size={20} color={c.label} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.background },
  flex: { flex: 1 },
  controls: { position: "absolute", right: spacing.m, gap: spacing.s },
  control: {
    width: TOUCH_MIN,
    height: TOUCH_MIN,
    borderRadius: TOUCH_MIN / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surface,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  cardWrap: {
    position: "absolute",
    left: spacing.s,
    right: spacing.s,
    bottom: 0,
  },
  card: {
    borderRadius: 34,
    borderCurve: "continuous",
    padding: spacing.l,
    gap: spacing.m,
    overflow: "hidden",
  },
  cardOpaque: {
    backgroundColor: c.surface,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  status: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 22 },
  statusText: { ...type.footnote, color: c.secondaryLabel, flex: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.green },
  ahead: { gap: 2 },
  overline: {
    ...type.footnote,
    fontWeight: "600",
    color: c.secondaryLabel,
    textTransform: "uppercase",
  },
  aheadValue: { ...type.title2, color: c.label },
  caption: { ...type.subheadline, color: c.secondaryLabel },
  waze: { gap: spacing.s },
  wazeRow: { flexDirection: "row", gap: spacing.s },
  selected: { gap: spacing.m },
  selectedTop: { flexDirection: "row", alignItems: "center", gap: spacing.m },
  selectedName: { ...type.headline, color: c.label },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.fill,
  },
}));

/**
 * The live dock (R4/R5).
 *
 * A persistent bar shown app-wide while a run you've joined is active. It
 * exists because the map is the product and it used to be five steps away:
 * open app → find the run → open it → wait for the fetch → tap "Open Live
 * Map", all while moving. Now it's one tap from anywhere.
 *
 * It doubles as the privacy indicator required by R7: the dock is visible if
 * and only if a live session is running, so "am I sharing?" is answered
 * without opening anything. It leaves the instant the run ends: a short
 * slide down, never a lingering fade, so it can't be mistaken for "still
 * sharing".
 *
 * It renders from the live session's own socket traffic — no extra polling,
 * no extra request — and falls back to the degraded-mode cache for the run
 * name so a dead server still leaves the dock usable (C5).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { LatLng, Run, SnapshotMember } from "../api/types";
import {
  activeSessionRunId,
  subscribeLiveSession,
} from "../live/liveSession";
import { distanceToCarAhead, formatDistance } from "../lib/geo";
import { loadCachedRun } from "../storage/storage";
import { Avatar, LiveBadge, PressableScale } from "./components";
import { Icon } from "./Icon";
import {
  DOCK_HEIGHT,
  ROW_INSET,
  TOUCH_MIN,
  elevation,
  makeStyles,
  radius,
  spacing,
  type,
  usePalette,
  useScheme,
} from "./theme";
import { useReduceMotion } from "./useReduceMotion";

interface DockData {
  runId: string;
  run: Run | null;
  members: SnapshotMember[];
}

/** Who's in: attendees who left don't count toward the board (R3). */
function counts(members: SnapshotMember[]): { arrived: number; total: number } {
  const present = members.filter((m) => m.status !== "left");
  return {
    arrived: present.filter((m) => m.status === "arrived").length,
    total: present.length,
  };
}

/**
 * The single most useful line while driving: who's next up the road and how
 * far. Falls back to the arrival count before anyone has a fix.
 */
function aheadLine(
  data: DockData,
  selfId: string,
  arrived: number,
  total: number,
): string {
  const me = data.members.find((m) => m.memberId === selfId);
  const target: LatLng | null = data.run
    ? (data.run.destination ?? data.run.meetup)
    : null;
  if (me?.lastPosition && target) {
    const ahead = distanceToCarAhead(
      me.lastPosition,
      target,
      data.members
        .filter(
          (m) =>
            m.memberId !== selfId &&
            m.status !== "left" &&
            m.lastPosition !== null,
        )
        .map((m) => ({
          memberId: m.memberId,
          displayName: m.displayName,
          position: m.lastPosition!,
        })),
    );
    if (ahead) {
      return `${ahead.displayName} · ${formatDistance(ahead.distanceMeters)} ahead`;
    }
  }
  if (total > 0) return `${arrived} of ${total} arrived`;
  return "Sharing your location";
}

export function LiveDock({
  selfId,
  hidden,
  hiddenForRunId,
  onOpen,
}: {
  selfId: string;
  /** True on the map itself and on modal presentations. */
  hidden: boolean;
  /** Hide while this run's own detail screen is showing. */
  hiddenForRunId?: string;
  onOpen: (runId: string) => void;
}) {
  const s = useStyles();
  const c = usePalette();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<DockData | null>(null);
  // Keeps the subscription callback from re-reading stale state.
  const runIdRef = useRef<string | null>(null);

  const adoptRun = useCallback((runId: string) => {
    if (runIdRef.current === runId) return;
    runIdRef.current = runId;
    setData({ runId, run: null, members: [] });
    // Degraded-mode cache first: RunDetail wrote it, so the name is there
    // even when the server is unreachable.
    loadCachedRun(runId)
      .then((run) => {
        setData((prev) =>
          prev && prev.runId === runId && run ? { ...prev, run } : prev,
        );
      })
      .catch(() => {
        // Name stays blank; the dock still works as a map shortcut.
      });
  }, []);

  const clear = useCallback(() => {
    runIdRef.current = null;
    setData(null);
  }, []);

  useEffect(() => {
    // The session may already be running when this mounts (app relaunch into
    // an active run), so seed before subscribing.
    const existing = activeSessionRunId();
    if (existing) adoptRun(existing);

    return subscribeLiveSession((event) => {
      const runId = activeSessionRunId();
      if (!runId) {
        clear();
        return;
      }
      adoptRun(runId);
      if (event.kind === "message" && event.message.type === "snapshot") {
        const members = event.message.members;
        setData((prev) =>
          prev && prev.runId === runId ? { ...prev, members } : prev,
        );
      }
    });
  }, [adoptRun, clear]);

  const visible = !!data && !hidden && data.runId !== hiddenForRunId;

  // What's on screen. Trails `data` by one exit animation, so the dock can
  // slide away showing what it showed rather than vanishing mid-frame.
  const [shown, setShown] = useState<DockData | null>(null);
  if (visible && data !== shown) setShown(data);

  const reduce = useReduceMotion();
  const progress = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduce ? 0 : visible ? 320 : 180,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && !visible) setShown(null);
    });
    return () => anim.stop();
  }, [visible, reduce, progress]);

  if (!shown) return null;

  const { arrived, total } = counts(shown.members);
  const name = shown.run?.name ?? "Live run";
  const line = aheadLine(shown, selfId, arrived, total);
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [reduce ? 0 : DOCK_HEIGHT / 2, 0],
  });

  return (
    <Animated.View
      style={[
        s.wrap,
        { bottom: insets.bottom + spacing.s, left: ROW_INSET - 6, right: ROW_INSET - 6 },
        { opacity: progress, transform: [{ translateY }] },
      ]}
      // A dock on its way out can't be tapped.
      pointerEvents={visible ? "box-none" : "none"}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${name}, live. ${line}. Open the live map.`}
        onPress={() => onOpen(shown.runId)}
        scaleTo={0.98}
        pressedStyle={{ opacity: 0.9 }}
        style={[s.dock, elevation(scheme, 2)]}
      >
        {total > 0 ? (
          <View style={s.tally} accessible={false}>
            <Text style={s.tallyText} allowFontScaling={false}>
              {arrived}/{total}
            </Text>
          </View>
        ) : (
          <Avatar name={name} size={36} state="arrived" />
        )}

        <View style={s.text}>
          <View style={s.titleLine}>
            <LiveBadge />
            <Text style={s.name} numberOfLines={1}>
              {name}
            </Text>
          </View>
          <Text style={s.line} numberOfLines={1}>
            {line}
          </Text>
        </View>

        <View style={s.cta} accessible={false}>
          <Icon name="map" size={16} color={c.onTint} />
          <Text style={s.ctaText} maxFontSizeMultiplier={1.3}>
            Map
          </Text>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { position: "absolute" },
  dock: {
    minHeight: DOCK_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    backgroundColor: c.glass,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: c.separator,
    paddingLeft: spacing.m,
    paddingRight: spacing.s,
    paddingVertical: spacing.s,
  },
  tally: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.green,
    alignItems: "center",
    justifyContent: "center",
  },
  tallyText: { ...type.monoSmall, fontSize: 12, color: c.background },
  text: { flex: 1, gap: 2, minWidth: 0 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: spacing.s },
  name: { ...type.title, fontSize: 15, color: c.label, flexShrink: 1 },
  line: { ...type.monoSmall, color: c.secondaryLabel },
  cta: {
    minHeight: TOUCH_MIN - 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: c.tint,
    borderRadius: radius.control - 3,
    paddingHorizontal: spacing.m,
  },
  ctaText: { ...type.buttonSmall, color: c.onTint },
}));

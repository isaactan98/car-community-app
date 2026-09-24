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
 * without opening anything. It disappears the instant the run ends.
 *
 * It renders from the live session's own socket traffic — no extra polling,
 * no extra request — and falls back to the degraded-mode cache for the run
 * name so a dead server still leaves the dock usable (C5).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { LatLng, Run, SnapshotMember } from "../api/types";
import {
  activeSessionRunId,
  subscribeLiveSession,
} from "../live/liveSession";
import { distanceToCarAhead, formatDistance } from "../lib/geo";
import { loadCachedRun } from "../storage/storage";
import { Avatar, LiveBadge } from "./components";
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
  onOpen,
}: {
  selfId: string;
  /** True on the map itself and on modal presentations. */
  hidden: boolean;
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

  if (!data || hidden) return null;

  const { arrived, total } = counts(data.members);
  const name = data.run?.name ?? "Live run";
  const line = aheadLine(data, selfId, arrived, total);

  return (
    <View
      style={[
        s.wrap,
        { bottom: insets.bottom + spacing.s, left: ROW_INSET - 6, right: ROW_INSET - 6 },
      ]}
      pointerEvents="box-none"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, live. ${line}. Open the live map.`}
        onPress={() => onOpen(data.runId)}
        style={({ pressed }) => [
          s.dock,
          elevation(scheme, 2),
          pressed && { opacity: 0.85 },
        ]}
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
      </Pressable>
    </View>
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

/**
 * Run list (R1): active + upcoming + recent ended, grouped. Falls back to
 * the cached list with an offline banner when the server is unreachable
 * (R6) — never a blank screen.
 */
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useLayoutEffect, useState } from "react";
import {
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from "react-native";

import { listRuns } from "../api/client";
import type { Run, RunState } from "../api/types";
import { formatWhen } from "../lib/format";
import { arrivalCounts } from "../lib/snapshotCache";
import type { ScreenProps } from "../navigation/types";
import { useSession } from "../session/SessionContext";
import { cacheRunList, loadCachedRunList } from "../storage/storage";
import {
  ArrivalDots,
  Button,
  EmptyState,
  ListRow,
  LiveBadge,
  Loading,
  OfflineBanner,
  SectionHeader,
  rowPosition,
  type RowPosition,
} from "../ui/components";
import { Icon, type IconName } from "../ui/Icon";
import { ROW_INSET, TOUCH_MIN, makeStyles, spacing, type, usePalette } from "../ui/theme";
import { useNow } from "../ui/useNow";

const SECTIONS: { state: RunState; title: string }[] = [
  { state: "active", title: "Happening Now" },
  { state: "upcoming", title: "Upcoming" },
  { state: "ended", title: "Past Runs" },
];

function groupRuns(runs: Run[]): { title: string; data: Run[] }[] {
  const byStart = (a: Run, b: Run) => a.startsAt.localeCompare(b.startsAt);
  return SECTIONS.map(({ state, title }) => {
    const data = runs.filter((r) => r.state === state).sort(byStart);
    // Past runs: most recent first.
    if (state === "ended") data.reverse();
    return { title, data };
  }).filter((s) => s.data.length > 0);
}

function isGoing(run: Run, selfId: string): boolean {
  return run.attendees.some((a) => a.memberId === selfId && a.status !== "left");
}

export default function RunListScreen({ navigation }: ScreenProps<"Runs">) {
  const s = useStyles();
  const c = usePalette();
  const { member } = useSession();
  const selfId = member?.id ?? "";
  const now = useNow(30_000);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useLayoutEffect(() => {
    const newRun = () => navigation.navigate("CreateRun");
    const profile = () => navigation.navigate("Profile");
    navigation.setOptions({
      // iOS: native bar buttons with SF Symbols (Liquid Glass on iOS 26).
      unstable_headerRightItems: () => [
        {
          type: "button",
          label: "Profile",
          icon: { type: "sfSymbol", name: "person.crop.circle" },
          onPress: profile,
          accessibilityLabel: "Profile and garage",
        },
        {
          type: "button",
          label: "New Run",
          icon: { type: "sfSymbol", name: "plus" },
          onPress: newRun,
          accessibilityLabel: "New run",
        },
      ],
      headerRight:
        Platform.OS === "ios"
          ? undefined
          : () => (
              <View style={s.headerButtons}>
                <HeaderIcon icon="add" label="New run" onPress={newRun} />
                <HeaderIcon icon="profile" label="Profile and garage" onPress={profile} />
              </View>
            ),
    });
  }, [navigation, s]);

  const load = useCallback(async () => {
    try {
      const fresh = await listRuns();
      setRuns(fresh);
      setOffline(false);
      void cacheRunList(fresh);
    } catch {
      const cached = await loadCachedRunList();
      setRuns((prev) => prev ?? cached ?? []);
      setOffline(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (runs === null) return <Loading />;

  return (
    <SectionList
      style={s.list}
      contentInsetAdjustmentBehavior="automatic"
      sections={groupRuns(runs)}
      keyExtractor={(item) => item.id}
      contentContainerStyle={s.content}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.secondaryLabel} />
      }
      ListHeaderComponent={
        offline ? (
          <View style={s.banner}>
            <OfflineBanner visible lastUpdatedAt={null} now={now} onRetry={() => void refresh()} />
          </View>
        ) : null
      }
      renderSectionHeader={({ section }) => <SectionHeader title={section.title} prominent />}
      renderSectionFooter={() => <View style={s.sectionGap} />}
      renderItem={({ item, index, section }) => (
        <RunRow
          run={item}
          going={isGoing(item, selfId)}
          now={now}
          position={rowPosition(index, section.data.length)}
          onPress={() => navigation.navigate("RunDetail", { runId: item.id })}
        />
      )}
      ListEmptyComponent={
        <EmptyState
          icon="car"
          title="No Runs Yet"
          body="Plan a meetup, then share the invite link with your group."
        >
          <Button
            title="New Run"
            icon="add"
            size="regular"
            onPress={() => navigation.navigate("CreateRun")}
          />
        </EmptyState>
      }
    />
  );
}

function RunRow({
  run,
  going,
  now,
  position,
  onPress,
}: {
  run: Run;
  going: boolean;
  now: number;
  position: RowPosition;
  onPress: () => void;
}) {
  const s = useStyles();
  const c = usePalette();
  const { arrived, total } = arrivalCounts(run);
  const active = run.state === "active";
  const ended = run.state === "ended";
  const when = formatWhen(run.startsAt, now);
  const route = run.destination
    ? `${run.meetup.label} → ${run.destination.label}`
    : run.meetup.label;
  const countLabel = active
    ? `${arrived} of ${total} arrived`
    : `${total} ${ended ? "went" : "going"}`;

  return (
    <ListRow
      position={position}
      onPress={onPress}
      chevron
      accessibilityLabel={[
        run.name,
        active ? "live now" : null,
        when,
        route,
        countLabel,
        going ? (ended ? "you went" : "you're going") : null,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <View style={s.rowText}>
        <View style={s.titleLine}>
          <Text style={[s.name, ended && s.dim]} numberOfLines={3}>
            {run.name}
          </Text>
          {active ? <LiveBadge /> : null}
        </View>
        <Text style={s.meta}>{when}</Text>
        <Text style={s.meta} numberOfLines={2}>
          {route}
        </Text>
        {active && total > 0 ? (
          <View style={s.arrival}>
            <ArrivalDots arrived={arrived} total={total} />
            <Text style={s.arrivalText}>{countLabel}</Text>
          </View>
        ) : null}
        <View style={s.footerLine}>
          {going ? (
            <>
              <Icon name="arrived" size={14} color={ended ? c.secondaryLabel : c.tint} />
              <Text style={[s.going, ended && s.goingPast]}>
                {ended ? "You went" : "You're going"}
              </Text>
              {!active ? <Text style={s.footnote}>·</Text> : null}
            </>
          ) : null}
          {!active ? <Text style={s.footnote}>{countLabel}</Text> : null}
        </View>
      </View>
    </ListRow>
  );
}

function HeaderIcon({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={{ minWidth: TOUCH_MIN, minHeight: TOUCH_MIN, alignItems: "center", justifyContent: "center" }}
    >
      <Icon name={icon} size={24} color={c.label} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  list: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: ROW_INSET, paddingBottom: spacing.xxl },
  banner: { marginTop: spacing.s, marginBottom: spacing.s },
  sectionGap: { height: spacing.l },
  headerButtons: { flexDirection: "row", alignItems: "center" },
  rowText: { flex: 1, gap: 3, paddingVertical: 2 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: spacing.s },
  name: { ...type.headline, color: c.label, flexShrink: 1 },
  dim: { color: c.secondaryLabel },
  meta: { ...type.subheadline, color: c.secondaryLabel },
  arrival: { gap: 6, marginTop: spacing.s },
  arrivalText: { ...type.subheadline, fontWeight: "600", color: c.label },
  footerLine: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  going: { ...type.footnote, fontWeight: "600", color: c.tint },
  goingPast: { color: c.secondaryLabel },
  footnote: { ...type.footnote, color: c.secondaryLabel },
}));

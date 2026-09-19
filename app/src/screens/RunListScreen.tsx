/**
 * Run list (R1): active + upcoming + recent ended.
 *
 * Weight follows state. A run happening right now is a hero card carrying the
 * convoy's dot trail and a direct route to the map; an upcoming run is a
 * compact card; a past run collapses to a log line. One uniform row for all
 * three is why nothing used to stand out.
 *
 * Falls back to the cached list with an offline banner when the server is
 * unreachable (R6) — never a blank screen.
 */
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import {
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { listRuns } from "../api/client";
import type { Run, RunState } from "../api/types";
import { formatShortDate, formatWhen } from "../lib/format";
import { runLegCounts } from "../lib/snapshotCache";
import type { ScreenProps } from "../navigation/types";
import { useSession } from "../session/SessionContext";
import { cacheRunList, loadCachedRunList } from "../storage/storage";
import {
  ArrivalDots,
  AvatarStack,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  LiveBadge,
  Loading,
  OfflineBanner,
} from "../ui/components";
import { Icon, type IconName } from "../ui/Icon";
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

const SECTIONS: { state: RunState; title: string }[] = [
  { state: "active", title: "Happening now" },
  { state: "upcoming", title: "Upcoming" },
  { state: "ended", title: "Past" },
];

interface Section {
  title: string;
  state: RunState;
  data: Run[];
}

function groupRuns(runs: Run[]): Section[] {
  const byStart = (a: Run, b: Run) => a.startsAt.localeCompare(b.startsAt);
  return SECTIONS.map(({ state, title }) => {
    const data = runs.filter((r) => r.state === state).sort(byStart);
    // Past runs: most recent first.
    if (state === "ended") data.reverse();
    return { title, state, data };
  }).filter((s) => s.data.length > 0);
}

/** Everyone still on the roster — people who left aren't part of the crew. */
function crew(run: Run) {
  return run.attendees.filter((a) => a.status !== "left");
}

function isGoing(run: Run, selfId: string): boolean {
  return run.attendees.some((a) => a.memberId === selfId && a.status !== "left");
}

export default function RunListScreen({ navigation }: ScreenProps<"Runs">) {
  const s = useStyles();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const { member } = useSession();
  const selfId = member?.id ?? "";
  const now = useNow(30_000);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  const bar = (
    <View style={[s.bar, { paddingTop: insets.top + spacing.s }]}>
      <Text style={s.wordmark} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
        Runs
      </Text>
      <BarButton
        icon="profile"
        label="You and your garage"
        onPress={() => navigation.navigate("Profile")}
      />
      <BarButton
        icon="add"
        label="New run"
        onPress={() => navigation.navigate("CreateRun")}
      />
    </View>
  );

  if (runs === null) {
    return (
      <View style={s.screen}>
        {bar}
        <Loading />
      </View>
    );
  }

  return (
    <View style={s.screen}>
      {bar}
      <SectionList<Run, Section>
        sections={groupRuns(runs)}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + DOCK_HEIGHT + spacing.xxl },
        ]}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={c.tint}
            colors={[c.tint as string]}
          />
        }
        ListHeaderComponent={
          offline ? (
            <View style={s.banner}>
              <OfflineBanner
                visible
                lastUpdatedAt={null}
                now={now}
                onRetry={() => void refresh()}
              />
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <Eyebrow
            title={section.title}
            count={section.state === "active" ? undefined : section.data.length}
            style={s.sectionHeader}
          />
        )}
        renderSectionFooter={() => <View style={s.sectionGap} />}
        renderItem={({ item, section }) => {
          const going = isGoing(item, selfId);
          const open = () => navigation.navigate("RunDetail", { runId: item.id });
          if (section.state === "active") {
            return (
              <HeroRunCard
                run={item}
                selfId={selfId}
                now={now}
                onOpen={open}
                onMap={() => navigation.navigate("LiveMap", { runId: item.id })}
              />
            );
          }
          if (section.state === "ended") {
            return <PastRow run={item} going={going} onPress={open} />;
          }
          return (
            <UpcomingCard
              run={item}
              selfId={selfId}
              going={going}
              now={now}
              onPress={open}
            />
          );
        }}
        ItemSeparatorComponent={() => <View style={s.itemGap} />}
        ListEmptyComponent={
          <EmptyState
            icon="car"
            title="No runs yet"
            body="Plan a meetup, then share the invite link with your group."
          >
            <Button
              title="New run"
              icon="add"
              size="regular"
              onPress={() => navigation.navigate("CreateRun")}
            />
          </EmptyState>
        }
      />
    </View>
  );
}

/**
 * The live run. Everything a driver needs before they've focused on the
 * screen: that it's live, who's in, and one tap to the map.
 */
function HeroRunCard({
  run,
  selfId,
  now,
  onOpen,
  onMap,
}: {
  run: Run;
  selfId: string;
  now: number;
  onOpen: () => void;
  onMap: () => void;
}) {
  const s = useStyles();
  // Leg-aware: once the convoy has left the meetup this card counts who has
  // reached the destination, not who once stood at the petrol station.
  const { leg, there, total } = runLegCounts(run);
  const people = crew(run);
  const names = people.map((a) => a.displayName);
  const selfIndex = people.findIndex((a) => a.memberId === selfId);

  return (
    <Card style={s.hero}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${run.name}, live now, ${there} of ${total} ${
          leg === "destination" ? "at the destination" : "arrived"
        }`}
        accessibilityHint="Opens the run"
        style={s.heroBody}
      >
        <View style={s.heroTop}>
          <LiveBadge />
          <Text style={s.heroStarted}>
            {formatWhen(run.startsAt, now).toUpperCase()}
          </Text>
        </View>

        <Text style={s.heroName} numberOfLines={2}>
          {run.name}
        </Text>
        <RouteLine run={run} />

        <View style={s.heroCount}>
          <Text style={s.heroTally}>
            {there}
            <Text style={s.heroTallyOf}>/{total}</Text>
          </Text>
          <Text style={s.heroArrived} numberOfLines={1}>
            {leg === "destination" ? "at destination" : "arrived"}
          </Text>
          <View style={s.heroDots}>
            <ArrivalDots arrived={there} total={total} />
          </View>
        </View>

        {names.length > 0 ? (
          <AvatarStack names={names} selfIndex={selfIndex} />
        ) : null}
      </Pressable>

      <Button title="Open live map" icon="map" onPress={onMap} style={s.heroButton} />
    </Card>
  );
}

function UpcomingCard({
  run,
  selfId,
  going,
  now,
  onPress,
}: {
  run: Run;
  selfId: string;
  going: boolean;
  now: number;
  onPress: () => void;
}) {
  const s = useStyles();
  const c = usePalette();
  const people = crew(run);
  const names = people.map((a) => a.displayName);
  const selfIndex = people.findIndex((a) => a.memberId === selfId);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[
        run.name,
        formatWhen(run.startsAt, now),
        `${people.length} going`,
        going ? "you're going" : null,
      ]
        .filter(Boolean)
        .join(", ")}
      style={({ pressed }) => [s.card, pressed && { backgroundColor: c.highlight }]}
    >
      <View style={s.cardTop}>
        <Text style={s.cardName} numberOfLines={2}>
          {run.name}
        </Text>
        <Text style={s.cardWhen}>{formatWhen(run.startsAt, now).toUpperCase()}</Text>
      </View>
      <RouteLine run={run} />
      <View style={s.cardBottom}>
        {names.length > 0 ? (
          <AvatarStack names={names} selfIndex={selfIndex} />
        ) : (
          <Text style={s.cardMeta}>Nobody&apos;s joined yet</Text>
        )}
        {going ? (
          <View style={s.goingChip}>
            <Text style={s.goingText}>You&apos;re in</Text>
          </View>
        ) : (
          <Icon name="chevron" size={13} weight="semibold" color={c.tertiaryLabel} />
        )}
      </View>
    </Pressable>
  );
}

/** Past runs are a log, not a feed. One line, scannable down the column. */
function PastRow({
  run,
  going,
  onPress,
}: {
  run: Run;
  going: boolean;
  onPress: () => void;
}) {
  const s = useStyles();
  const c = usePalette();
  const people = crew(run);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[
        run.name,
        formatShortDate(run.startsAt),
        `${people.length} went`,
        going ? "you went" : null,
      ]
        .filter(Boolean)
        .join(", ")}
      style={({ pressed }) => [s.past, pressed && { backgroundColor: c.highlight }]}
    >
      <Text style={s.pastName} numberOfLines={1}>
        {run.name}
      </Text>
      {going ? (
        <Icon name="arrived" size={13} color={c.tertiaryLabel} />
      ) : null}
      <Text style={s.pastMeta}>
        {formatShortDate(run.startsAt).toUpperCase()} · {people.length} WENT
      </Text>
    </Pressable>
  );
}

function RouteLine({ run }: { run: Run }) {
  const s = useStyles();
  return (
    <View style={s.route}>
      <Text style={s.routeText} numberOfLines={1}>
        {run.meetup.label}
      </Text>
      {run.destination ? (
        <>
          <Text style={s.routeArrow}>→</Text>
          <Text style={s.routeText} numberOfLines={1}>
            {run.destination.label}
          </Text>
        </>
      ) : null}
    </View>
  );
}

function BarButton({
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
      hitSlop={6}
      style={({ pressed }) => [s.barButton, pressed && { opacity: 0.6 }]}
    >
      <Icon name={icon} size={19} color={c.label} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.background },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingHorizontal: ROW_INSET,
    paddingBottom: spacing.m,
  },
  wordmark: {
    ...type.display1,
    textTransform: "uppercase",
    color: c.label,
    flex: 1,
  },
  barButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.fill,
    alignItems: "center",
    justifyContent: "center",
  },

  content: { paddingHorizontal: ROW_INSET },
  banner: { marginBottom: spacing.l },
  sectionHeader: { marginTop: spacing.s },
  sectionGap: { height: spacing.xl },
  itemGap: { height: spacing.m },

  // --- live hero ---
  hero: { overflow: "hidden" },
  heroBody: { padding: spacing.l, gap: spacing.s },
  heroTop: { flexDirection: "row", alignItems: "center", gap: spacing.s },
  heroStarted: { ...type.monoSmall, color: c.tertiaryLabel, flexShrink: 1 },
  heroName: { ...type.display2, color: c.label },
  heroCount: { flexDirection: "row", alignItems: "center", gap: spacing.s, marginTop: 2 },
  heroTally: { ...type.monoLarge, color: c.label },
  heroTallyOf: { color: c.tertiaryLabel },
  heroArrived: { ...type.footnote, color: c.secondaryLabel },
  heroDots: { flex: 1, alignItems: "flex-end" },
  heroButton: {
    marginHorizontal: spacing.l,
    marginBottom: spacing.l,
    marginTop: spacing.xs,
  },

  // --- upcoming ---
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: c.separator,
    padding: spacing.l,
    gap: spacing.s,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.m },
  cardName: { ...type.display3, color: c.label, flex: 1 },
  cardWhen: { ...type.monoSmall, color: c.tint, marginTop: 3 },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.m,
    marginTop: 2,
  },
  cardMeta: { ...type.footnote, color: c.tertiaryLabel },
  goingChip: {
    borderWidth: 0.5,
    borderColor: c.tint,
    borderRadius: radius.chip,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  goingText: {
    ...type.eyebrow,
    fontSize: 10,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: c.tint,
  },

  // --- past ---
  past: {
    minHeight: TOUCH_MIN,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingVertical: spacing.m,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 0.5,
    borderBottomColor: c.separator,
  },
  pastName: { ...type.bodyMedium, color: c.secondaryLabel, flex: 1 },
  pastMeta: { ...type.monoSmall, color: c.tertiaryLabel },

  // --- shared ---
  route: { flexDirection: "row", alignItems: "center", gap: 6 },
  routeText: { ...type.footnote, color: c.secondaryLabel, flexShrink: 1 },
  routeArrow: { ...type.footnote, color: c.tertiaryLabel },
}));

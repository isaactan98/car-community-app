/**
 * Run list (R1): active + upcoming + recent ended, grouped. Falls back to
 * the cached list with an offline banner when the server is unreachable
 * (R6) — never a blank screen.
 */
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import {
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { listRuns } from "../api/client";
import type { Run } from "../api/types";
import { arrivalCounts } from "../lib/snapshotCache";
import type { ScreenProps } from "../navigation/types";
import { useSession } from "../session/SessionContext";
import { cacheRunList, loadCachedRunList } from "../storage/storage";
import {
  Button,
  Loading,
  OfflineBanner,
  Screen,
  StatePill,
} from "../ui/components";
import { colors, spacing } from "../ui/theme";
import { useNow } from "../ui/useNow";

const STATE_ORDER: Run["state"][] = ["active", "upcoming", "ended"];

function groupRuns(runs: Run[]): { title: string; data: Run[] }[] {
  return STATE_ORDER.map((state) => ({
    title:
      state === "active" ? "Active" : state === "upcoming" ? "Upcoming" : "Ended",
    data: runs.filter((r) => r.state === state),
  })).filter((s) => s.data.length > 0);
}

function formatStartsAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RunListScreen({ navigation }: ScreenProps<"Runs">) {
  const { member, logout } = useSession();
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

  if (runs === null) return <Loading label="Loading runs…" />;

  return (
    <Screen>
      <OfflineBanner visible={offline} lastUpdatedAt={null} now={now} />
      <SectionList
        sections={groupRuns(runs)}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.accent}
          />
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => {
          const { arrived, total } = arrivalCounts(item);
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => navigation.navigate("RunDetail", { runId: item.id })}
            >
              <View style={styles.rowTop}>
                <Text style={styles.runName} numberOfLines={1}>
                  {item.name}
                </Text>
                <StatePill state={item.state} />
              </View>
              <Text style={styles.runMeta}>
                {formatStartsAt(item.startsAt)} · {item.meetup.label}
              </Text>
              <Text style={styles.runMeta}>
                {total} joined
                {item.state !== "upcoming" ? ` · ${arrived}/${total} arrived` : ""}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No runs yet. Create the first one.
            </Text>
          </View>
        }
      />
      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <View style={styles.footerGrow}>
            <Button
              title="+ New run"
              onPress={() => navigation.navigate("CreateRun")}
            />
          </View>
          <Button
            title="Garage"
            kind="secondary"
            onPress={() => navigation.navigate("Garage")}
          />
        </View>
        <Pressable onPress={() => void logout()}>
          <Text style={styles.signout}>
            Signed in as {member?.displayName ?? "?"} — leave group
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: spacing.l, paddingBottom: 120 },
  sectionHeader: {
    color: colors.textDim,
    fontWeight: "800",
    fontSize: 13,
    textTransform: "uppercase",
    marginTop: spacing.m,
    marginBottom: spacing.s,
  },
  row: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.l,
    marginBottom: spacing.m,
    gap: spacing.xs,
  },
  rowPressed: { opacity: 0.7 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s,
  },
  runName: { color: colors.text, fontSize: 17, fontWeight: "700", flex: 1 },
  runMeta: { color: colors.textDim, fontSize: 13 },
  empty: { padding: spacing.xl, alignItems: "center" },
  emptyText: { color: colors.textDim },
  footer: {
    padding: spacing.l,
    gap: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  footerRow: { flexDirection: "row", gap: spacing.m, alignItems: "center" },
  footerGrow: { flex: 1 },
  signout: { color: colors.textDim, textAlign: "center", fontSize: 12 },
});

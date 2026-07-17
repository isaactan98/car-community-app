/**
 * Live map for an active run (R4):
 * - all participants' last positions from WS snapshots on a MapLibre map
 *   (OpenFreeMap style — no Mapbox/Google)
 * - per-dot staleness indicator when last update > 60 s
 * - "distance to car ahead" readout (nearest participant ahead along my
 *   bearing to destination/meetup — simple version per spec)
 * - Waze handoff for meetup, destination, and any member's last position (R5)
 * - degraded mode: renders the cached snapshot with an offline banner (R6)
 */
import { Camera, Map, Marker } from "@maplibre/maplibre-react-native";
import { useCallback, useEffect, useReducer, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { getRun } from "../api/client";
import type { SnapshotMember } from "../api/types";
import { MAP_STYLE_URL } from "../config";
import { subscribeLiveSession } from "../live/liveSession";
import { distanceToCarAhead, formatDistance } from "../lib/geo";
import {
  initialLiveRunState,
  liveRunReducer,
} from "../lib/snapshotCache";
import { formatAge, isStale } from "../lib/staleness";
import type { ScreenProps } from "../navigation/types";
import { useSession } from "../session/SessionContext";
import {
  cacheRun,
  loadCachedRun,
  loadCachedSnapshot,
} from "../storage/storage";
import {
  Button,
  Loading,
  OfflineBanner,
  Screen,
  WazeButton,
} from "../ui/components";
import { colors, spacing } from "../ui/theme";
import { useNow } from "../ui/useNow";

export default function LiveMapScreen({ route }: ScreenProps<"LiveMap">) {
  const { runId } = route.params;
  const { member } = useSession();
  const [state, dispatch] = useReducer(liveRunReducer, initialLiveRunState);
  const now = useNow(5000);
  const [selected, setSelected] = useState<string | null>(null);

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
    return subscribeLiveSession((event) => {
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
  }, []);

  const members: SnapshotMember[] = state.snapshot?.members ?? [];
  const positioned = members.filter((m) => m.lastPosition !== null);
  const me = members.find((m) => m.memberId === selfId);
  const selectedMember = positioned.find((m) => m.memberId === selected) ?? null;

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

  if (!run) return <Loading label="Loading map…" />;

  const stale =
    !state.connected ||
    (state.snapshotAt !== null && now - state.snapshotAt > 60_000);

  return (
    <Screen>
      <OfflineBanner
        visible={stale}
        lastUpdatedAt={state.snapshotAt}
        now={now}
      />
      <View style={styles.mapWrap}>
        <Map style={styles.map} mapStyle={MAP_STYLE_URL}>
          <Camera
            initialViewState={{
              center: [run.meetup.lng, run.meetup.lat],
              zoom: 10,
            }}
          />
          <Marker lngLat={[run.meetup.lng, run.meetup.lat]}>
            <View style={styles.flagPin}>
              <Text style={styles.flagText}>M</Text>
            </View>
          </Marker>
          {run.destination ? (
            <Marker lngLat={[run.destination.lng, run.destination.lat]}>
              <View style={[styles.flagPin, { backgroundColor: colors.accent }]}>
                <Text style={styles.flagText}>D</Text>
              </View>
            </Marker>
          ) : null}
          {positioned.map((m) => {
            const pos = m.lastPosition!;
            const memberStale = isStale(pos.ts, now);
            const isSelf = m.memberId === selfId;
            return (
              <Marker
                key={m.memberId}
                lngLat={[pos.lng, pos.lat]}
                onPress={() => setSelected(m.memberId)}
              >
                <View style={styles.dotWrap}>
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor: memberStale
                          ? colors.stale
                          : isSelf
                            ? colors.accent
                            : colors.green,
                      },
                    ]}
                  />
                  <Text style={styles.dotLabel} numberOfLines={1}>
                    {m.displayName}
                    {memberStale ? ` · ${formatAge(pos.ts, now)}` : ""}
                  </Text>
                </View>
              </Marker>
            );
          })}
        </Map>
      </View>

      <View style={styles.panel}>
        <Text style={styles.ahead}>
          {carAhead
            ? `Car ahead: ${carAhead.displayName} — ${formatDistance(carAhead.distanceMeters)}`
            : me?.lastPosition
              ? "No car ahead of you"
              : "Waiting for your position…"}
        </Text>
        {positioned.length === 0 ? (
          <Text style={styles.dim}>
            No positions yet
            {state.connected ? "" : " — showing nothing rather than lying"}.
          </Text>
        ) : null}
        {selectedMember?.lastPosition ? (
          <View style={styles.selectedRow}>
            <View style={styles.selectedText}>
              <Text style={styles.selectedName}>
                {selectedMember.displayName}
              </Text>
              <Text style={styles.dim}>
                Updated {formatAge(selectedMember.lastPosition.ts, now)} ago
              </Text>
            </View>
            <WazeButton
              lat={selectedMember.lastPosition.lat}
              lng={selectedMember.lastPosition.lng}
              label="Waze to them"
            />
          </View>
        ) : null}
        <View style={styles.wazeRow}>
          <WazeButton
            lat={run.meetup.lat}
            lng={run.meetup.lng}
            label="Waze: meetup"
            small={false}
          />
          {run.destination ? (
            <WazeButton
              lat={run.destination.lat}
              lng={run.destination.lng}
              label="Waze: destination"
              small={false}
            />
          ) : null}
        </View>
        {!state.connected && positioned.length === 0 && !state.snapshot ? (
          <Button title="Retry" kind="secondary" small onPress={() => void load()} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  mapWrap: { flex: 1 },
  map: { flex: 1 },
  flagPin: {
    backgroundColor: colors.green,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  flagText: { fontWeight: "800", fontSize: 11, color: "#0F1115" },
  dotWrap: { alignItems: "center", maxWidth: 110 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#fff",
  },
  dotLabel: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "700",
    backgroundColor: "rgba(15,17,21,0.75)",
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: "hidden",
    marginTop: 2,
  },
  panel: {
    padding: spacing.l,
    gap: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  ahead: { color: colors.text, fontWeight: "800", fontSize: 16 },
  dim: { color: colors.textDim, fontSize: 12 },
  selectedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.m,
  },
  selectedText: { flex: 1 },
  selectedName: { color: colors.text, fontWeight: "700" },
  wazeRow: { flexDirection: "row", gap: spacing.m },
});

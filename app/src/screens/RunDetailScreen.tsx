/**
 * Run detail / arrival board (R2 + R3):
 * - attendee list with status, "12/18 arrived", arrived list, incoming list
 *   with live ETA from WS snapshots
 * - RSVP join/leave with car picker backed by /me/cars (simple garage)
 * - share button exposing the run's invite deep link
 * - creator start/end controls, Waze handoff for meetup/destination (R5)
 * - degraded mode: cached run + snapshot with offline banner (R6)
 * - auto start/stop of location sharing per R7
 */
import { useFocusEffect } from "@react-navigation/native";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import {
  Alert,
  FlatList,
  Modal,
  Share,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  View,
} from "react-native";

import {
  ApiError,
  addCar,
  endRun,
  getMe,
  getRun,
  leaveRun,
  rsvp,
  startRun,
} from "../api/client";
import type { AttendeeStatus, Car } from "../api/types";
import {
  activeSessionRunId,
  startLiveSession,
  stopLiveSession,
  subscribeLiveSession,
} from "../live/liveSession";
import { formatEta } from "../lib/eta";
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
  Button,
  Card,
  Loading,
  OfflineBanner,
  Screen,
  StatePill,
  WazeButton,
} from "../ui/components";
import { colors, spacing } from "../ui/theme";
import { useNow } from "../ui/useNow";

interface BoardRow {
  memberId: string;
  displayName: string;
  carName: string | null;
  status: AttendeeStatus;
  etaSeconds: number | null;
}

export default function RunDetailScreen({
  route,
  navigation,
}: ScreenProps<"RunDetail">) {
  const { runId } = route.params;
  const { member, token } = useSession();
  const now = useNow(10_000);
  const [state, dispatch] = useReducer(liveRunReducer, initialLiveRunState);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

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
    return subscribeLiveSession((event) => {
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
      }
    });
  }, []);

  // R7: sharing starts only when this member has joined an active run —
  // and hard-stops when the run ends (liveSession handles the end signal).
  useEffect(() => {
    if (!run || !token || !selfId) return;
    if (run.state === "active" && joined) {
      void startLiveSession(run, token, selfId).then((res) => {
        if (!res.started && res.error === "Location permission denied") {
          Alert.alert(
            "Location permission needed",
            "Others can't see you on the run without location access. You can still view the board.",
          );
        }
      });
    } else if (run.state === "ended" && activeSessionRunId() === run.id) {
      void stopLiveSession();
    }
  }, [run, token, selfId, joined]);

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
    return (run?.attendees ?? []).map((a) => ({
      memberId: a.memberId,
      displayName: a.displayName,
      carName: a.carName,
      status: a.status,
      etaSeconds: null,
    }));
  }, [state.snapshot, run]);

  const arrivedRows = rows.filter((r) => r.status === "arrived");
  const incomingRows = rows.filter((r) => r.status === "rsvped");
  const counts = arrivalCounts(run);

  const doRsvp = async (carId: string | null) => {
    setPickerOpen(false);
    setBusy(true);
    try {
      await rsvp(runId, carId);
      await load();
    } catch (err) {
      Alert.alert(
        "RSVP failed",
        err instanceof ApiError && err.network
          ? "Server unreachable."
          : "Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const doLeave = async () => {
    setBusy(true);
    try {
      // Privacy hard stop first (R7) — even if the request then fails, we
      // are no longer sharing.
      if (activeSessionRunId() === runId) await stopLiveSession();
      await leaveRun(runId);
      await load();
    } catch (err) {
      Alert.alert(
        "Leave failed",
        err instanceof ApiError && err.network
          ? "Server unreachable — you are no longer sharing location either way."
          : "Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const doStart = async () => {
    setBusy(true);
    try {
      await startRun(runId);
      await load();
    } catch {
      Alert.alert("Could not start run");
    } finally {
      setBusy(false);
    }
  };

  const doEnd = async () => {
    setBusy(true);
    try {
      await endRun(runId);
      if (activeSessionRunId() === runId) await stopLiveSession();
      await load();
    } catch {
      Alert.alert("Could not end run");
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!run?.inviteDeepLink) return;
    try {
      await Share.share({ message: run.inviteDeepLink });
    } catch {
      // user dismissed / no share targets — fine
    }
  };

  if (!run) {
    return state.offline ? (
      <Screen>
        <OfflineBanner visible lastUpdatedAt={null} now={now} />
        <View style={styles.center}>
          <Text style={styles.dimText}>
            Server unreachable and no cached copy of this run yet.
          </Text>
          <Button title="Retry" onPress={() => void load()} />
        </View>
      </Screen>
    ) : (
      <Loading label="Loading run…" />
    );
  }

  return (
    <Screen>
      <OfflineBanner
        visible={state.offline && !state.connected}
        lastUpdatedAt={state.snapshotAt}
        now={now}
      />
      <FlatList
        data={[...arrivedRows, ...incomingRows]}
        keyExtractor={(r) => r.memberId}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={2}>
                {run.name}
              </Text>
              <StatePill state={run.state} />
            </View>
            <Text style={styles.meta}>
              {new Date(run.startsAt).toLocaleString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>

            <Card>
              <View style={styles.placeRow}>
                <View style={styles.placeText}>
                  <Text style={styles.placeKind}>Meetup</Text>
                  <Text style={styles.placeLabel}>{run.meetup.label}</Text>
                </View>
                <WazeButton lat={run.meetup.lat} lng={run.meetup.lng} />
              </View>
              {run.destination ? (
                <View style={[styles.placeRow, styles.placeRowDivider]}>
                  <View style={styles.placeText}>
                    <Text style={styles.placeKind}>Destination</Text>
                    <Text style={styles.placeLabel}>
                      {run.destination.label}
                    </Text>
                  </View>
                  <WazeButton
                    lat={run.destination.lat}
                    lng={run.destination.lng}
                  />
                </View>
              ) : null}
            </Card>

            <View style={styles.actionsRow}>
              {joined ? (
                <Button
                  title="Leave run"
                  kind="danger"
                  small
                  disabled={busy}
                  onPress={doLeave}
                />
              ) : (
                <Button
                  title="Join run"
                  small
                  disabled={busy || run.state === "ended"}
                  onPress={() => setPickerOpen(true)}
                />
              )}
              <Button title="Share invite" kind="secondary" small onPress={share} />
              {isCreator && run.state === "upcoming" ? (
                <Button title="Start run" small disabled={busy} onPress={doStart} />
              ) : null}
              {isCreator && run.state === "active" ? (
                <Button title="End run" kind="danger" small disabled={busy} onPress={doEnd} />
              ) : null}
            </View>

            {run.state === "active" ? (
              <Button
                title="Open live map"
                onPress={() => navigation.navigate("LiveMap", { runId })}
              />
            ) : null}

            <Text style={styles.boardTitle}>
              {counts.arrived}/{counts.total} arrived
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.attendeeRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    item.status === "arrived" ? colors.green : colors.amber,
                },
              ]}
            />
            <View style={styles.attendeeText}>
              <Text style={styles.attendeeName}>
                {item.displayName}
                {item.memberId === selfId ? " (you)" : ""}
              </Text>
              <Text style={styles.attendeeCar}>
                {item.carName ?? "No car listed"}
              </Text>
            </View>
            <Text
              style={[
                styles.attendeeEta,
                item.status === "arrived" && { color: colors.green },
              ]}
            >
              {item.status === "arrived"
                ? "Arrived"
                : `ETA ${formatEta(item.etaSeconds)}`}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.dimText}>Nobody has joined yet.</Text>
        }
      />

      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <CarPicker onPick={doRsvp} onCancel={() => setPickerOpen(false)} />
      </Modal>
    </Screen>
  );
}

/** Car picker for RSVP (R2): garage cars + "no car" + inline quick-add. */
function CarPicker({
  onPick,
  onCancel,
}: {
  onPick: (carId: string | null) => void;
  onCancel: () => void;
}) {
  const [cars, setCars] = useState<Car[] | null>(null);
  const [newCar, setNewCar] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then((me) => setCars(me.cars))
      .catch(() => {
        setCars([]);
        setError("Couldn't load your garage — you can still join without a car.");
      });
  }, []);

  const quickAdd = async () => {
    const name = newCar.trim();
    if (name.length === 0) return;
    try {
      const car = await addCar(name);
      onPick(car.id);
    } catch {
      setError("Couldn't add that car right now.");
    }
  };

  return (
    <View style={styles.modalBackdrop}>
      <View style={styles.modalSheet}>
        <Text style={styles.modalTitle}>Which car are you bringing?</Text>
        {error ? <Text style={styles.modalError}>{error}</Text> : null}
        {cars === null ? (
          <Text style={styles.dimText}>Loading garage…</Text>
        ) : (
          cars.map((car) => (
            <Pressable
              key={car.id}
              style={styles.modalRow}
              onPress={() => onPick(car.id)}
            >
              <Text style={styles.modalRowText}>{car.name}</Text>
            </Pressable>
          ))
        )}
        <View style={styles.modalAddRow}>
          <TextInput
            style={styles.modalInput}
            placeholder="Add a car (free text)"
            placeholderTextColor={colors.textDim}
            value={newCar}
            onChangeText={setNewCar}
            maxLength={60}
          />
          <Button title="Add & pick" small onPress={quickAdd} />
        </View>
        <Pressable style={styles.modalRow} onPress={() => onPick(null)}>
          <Text style={styles.modalRowText}>Join without a car</Text>
        </Pressable>
        <Button title="Cancel" kind="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.l, paddingBottom: 60 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.l,
    padding: spacing.xl,
  },
  headerBlock: { gap: spacing.m, marginBottom: spacing.m },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.s,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", flex: 1 },
  meta: { color: colors.textDim },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.m,
  },
  placeRowDivider: {
    marginTop: spacing.m,
    paddingTop: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  placeText: { flex: 1 },
  placeKind: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  placeLabel: { color: colors.text, fontSize: 15, fontWeight: "600" },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s },
  boardTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginTop: spacing.s,
  },
  attendeeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    paddingVertical: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  attendeeText: { flex: 1 },
  attendeeName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  attendeeCar: { color: colors.textDim, fontSize: 12 },
  attendeeEta: { color: colors.amber, fontWeight: "700", fontSize: 13 },
  dimText: { color: colors.textDim, textAlign: "center" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.l,
    gap: spacing.m,
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  modalError: { color: colors.amber, fontSize: 13 },
  modalRow: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.m,
  },
  modalRowText: { color: colors.text, fontWeight: "600" },
  modalAddRow: { flexDirection: "row", gap: spacing.s, alignItems: "center" },
  modalInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
});

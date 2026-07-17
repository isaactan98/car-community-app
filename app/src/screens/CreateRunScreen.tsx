/**
 * Create run (R1): name, meetup picked on a MapLibre map (tap to drop pin),
 * optional destination, date/time. POSTs /runs per the contract.
 */
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Camera, Map, Marker } from "@maplibre/maplibre-react-native";
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError, createRun } from "../api/client";
import type { LatLng } from "../api/types";
import { MAP_STYLE_URL } from "../config";
import type { ScreenProps } from "../navigation/types";
import { Button, Screen } from "../ui/components";
import { colors, spacing } from "../ui/theme";

// Default view: JB–SG corridor, where the group drives.
const DEFAULT_CENTER: [number, number] = [103.76, 1.42];

type PinMode = "meetup" | "destination";

export default function CreateRunScreen({
  navigation,
}: ScreenProps<"CreateRun">) {
  const [name, setName] = useState("");
  const [pinMode, setPinMode] = useState<PinMode>("meetup");
  const [meetup, setMeetup] = useState<LatLng | null>(null);
  const [meetupLabel, setMeetupLabel] = useState("");
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [destinationLabel, setDestinationLabel] = useState("");
  const [startsAt, setStartsAt] = useState<Date>(() => {
    const d = new Date();
    d.setHours(d.getHours() + 24, 0, 0, 0); // default: tomorrow, on the hour
    return d;
  });
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [busy, setBusy] = useState(false);

  const onPickerChange = (event: DateTimePickerEvent, date?: Date) => {
    setPicker(null);
    if (event.type === "set" && date) setStartsAt(date);
  };

  const submit = async () => {
    if (busy) return;
    if (name.trim().length === 0) {
      Alert.alert("Missing name", "Give the run a name.");
      return;
    }
    if (!meetup) {
      Alert.alert("Missing meetup", "Tap the map to drop the meetup pin.");
      return;
    }
    setBusy(true);
    try {
      const run = await createRun({
        name: name.trim(),
        meetup: {
          ...meetup,
          label: meetupLabel.trim() || "Meetup point",
        },
        destination: destination
          ? { ...destination, label: destinationLabel.trim() || "Destination" }
          : null,
        startsAt: startsAt.toISOString(),
      });
      navigation.replace("RunDetail", { runId: run.id });
    } catch (err) {
      Alert.alert(
        "Could not create run",
        err instanceof ApiError && err.network
          ? "Server unreachable. Try again when you're back online."
          : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <TextInput
          style={styles.input}
          placeholder="Run name (e.g. Sunday JB breakfast run)"
          placeholderTextColor={colors.textDim}
          value={name}
          onChangeText={setName}
          maxLength={80}
        />

        <View style={styles.segment}>
          {(["meetup", "destination"] as PinMode[]).map((mode) => (
            <Pressable
              key={mode}
              style={[
                styles.segmentItem,
                pinMode === mode && styles.segmentItemActive,
              ]}
              onPress={() => setPinMode(mode)}
            >
              <Text
                style={[
                  styles.segmentText,
                  pinMode === mode && styles.segmentTextActive,
                ]}
              >
                {mode === "meetup" ? "Set meetup pin" : "Set destination pin"}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.mapWrap}>
          <Map
            style={styles.map}
            mapStyle={MAP_STYLE_URL}
            onPress={(e) => {
              const lngLat = e.nativeEvent.lngLat;
              if (!lngLat) return;
              const point: LatLng = { lat: lngLat[1], lng: lngLat[0] };
              if (pinMode === "meetup") setMeetup(point);
              else setDestination(point);
            }}
          >
            <Camera initialViewState={{ center: DEFAULT_CENTER, zoom: 9 }} />
            {meetup ? (
              <Marker lngLat={[meetup.lng, meetup.lat]}>
                <View style={[styles.pin, { backgroundColor: colors.green }]}>
                  <Text style={styles.pinText}>M</Text>
                </View>
              </Marker>
            ) : null}
            {destination ? (
              <Marker lngLat={[destination.lng, destination.lat]}>
                <View style={[styles.pin, { backgroundColor: colors.accent }]}>
                  <Text style={styles.pinText}>D</Text>
                </View>
              </Marker>
            ) : null}
          </Map>
        </View>
        <Text style={styles.hint}>
          Tap the map to place the {pinMode} pin.
          {meetup ? " Meetup set." : ""}
          {destination ? " Destination set." : " Destination is optional."}
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Meetup label (e.g. Caltex before Tuas)"
          placeholderTextColor={colors.textDim}
          value={meetupLabel}
          onChangeText={setMeetupLabel}
          maxLength={80}
        />
        <TextInput
          style={styles.input}
          placeholder="Destination label (optional)"
          placeholderTextColor={colors.textDim}
          value={destinationLabel}
          onChangeText={setDestinationLabel}
          maxLength={80}
        />
        {destination ? (
          <Button
            title="Clear destination"
            kind="secondary"
            small
            onPress={() => {
              setDestination(null);
              setDestinationLabel("");
            }}
          />
        ) : null}

        <View style={styles.dateRow}>
          <View style={styles.dateItem}>
            <Button
              title={startsAt.toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
              kind="secondary"
              onPress={() => setPicker("date")}
            />
          </View>
          <View style={styles.dateItem}>
            <Button
              title={startsAt.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
              kind="secondary"
              onPress={() => setPicker("time")}
            />
          </View>
        </View>
        {picker ? (
          <DateTimePicker
            value={startsAt}
            mode={picker}
            onChange={onPickerChange}
          />
        ) : null}

        <Button
          title={busy ? "Creating…" : "Create run"}
          onPress={submit}
          disabled={busy}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.l, gap: spacing.m },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    fontSize: 15,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  segmentItem: { flex: 1, paddingVertical: spacing.s, alignItems: "center" },
  segmentItemActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textDim, fontWeight: "600", fontSize: 13 },
  segmentTextActive: { color: colors.text },
  mapWrap: {
    height: 280,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: { flex: 1 },
  hint: { color: colors.textDim, fontSize: 12 },
  pin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  pinText: { color: "#0F1115", fontWeight: "800", fontSize: 12 },
  dateRow: { flexDirection: "row", gap: spacing.m },
  dateItem: { flex: 1 },
});

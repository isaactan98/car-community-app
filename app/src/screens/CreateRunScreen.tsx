/**
 * Create run (R1): name, meetup picked on a MapLibre map (tap to drop pin),
 * optional destination, date/time. POSTs /runs per the contract.
 *
 * A create flow wants room to type, so fields are stacked label-over-value
 * cards rather than preference rows with a fixed label column. Date and time
 * are mono tiles you can read at a glance instead of disclosure rows that
 * hide what you picked.
 */
import { Camera, Map, Marker } from "@maplibre/maplibre-react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { usePreventRemove } from "@react-navigation/native";
import { useLayoutEffect, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, createRun } from "../api/client";
import type { LatLng } from "../api/types";
import { MAP_STYLE_DARK_URL, MAP_STYLE_URL } from "../config";
import type { ScreenProps } from "../navigation/types";
import {
  Button,
  FieldTile,
  Segmented,
  TextField,
  confirmAction,
} from "../ui/components";
import { haptic } from "../ui/haptics";
import {
  PLACE_MARKER_PROPS,
  PlaceMarker,
  type PlaceKind,
} from "../ui/mapMarkers";
import {
  ROW_INSET,
  makeStyles,
  radius,
  schemeHex,
  spacing,
  type,
  useScheme,
} from "../ui/theme";

// Default view: JB–SG corridor, where the group drives.
const DEFAULT_CENTER: [number, number] = [103.76, 1.42];

/** Replace the calendar day of `base`, keeping its time. */
function withDate(base: Date, picked: Date): Date {
  const d = new Date(base);
  d.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  return d;
}

/** Replace the time of `base`, keeping its calendar day. */
function withTime(base: Date, picked: Date): Date {
  const d = new Date(base);
  d.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return d;
}

export default function CreateRunScreen({ navigation }: ScreenProps<"CreateRun">) {
  const s = useStyles();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [pinMode, setPinMode] = useState<PlaceKind>("meetup");
  const [meetup, setMeetup] = useState<LatLng | null>(null);
  const [meetupLabel, setMeetupLabel] = useState("");
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [destinationLabel, setDestinationLabel] = useState("");
  const [startsAt, setStartsAt] = useState<Date>(() => {
    const d = new Date();
    d.setHours(d.getHours() + 24, 0, 0, 0); // default: tomorrow, on the hour
    return d;
  });
  const [busy, setBusy] = useState(false);
  // Set just before we leave on purpose, so the discard guard stands aside.
  const leaving = useRef(false);

  const missing = [
    name.trim().length === 0 ? "a name" : null,
    meetup ? null : "a meetup pin",
  ].filter((m): m is string => m !== null);
  const valid = missing.length === 0;
  const dirty =
    name.trim().length > 0 || !!meetup || !!destination || meetupLabel.length > 0;

  const submit = async () => {
    if (busy || !meetup || !valid) return;
    setBusy(true);
    try {
      const run = await createRun({
        name: name.trim(),
        meetup: { ...meetup, label: meetupLabel.trim() || "Meetup point" },
        destination: destination
          ? { ...destination, label: destinationLabel.trim() || "Destination" }
          : null,
        startsAt: startsAt.toISOString(),
      });
      haptic.success();
      leaving.current = true;
      navigation.goBack();
      navigation.navigate("RunDetail", { runId: run.id });
    } catch (err) {
      haptic.error();
      Alert.alert(
        "Couldn't create the run",
        err instanceof ApiError && err.network
          ? "The server is unreachable. Try again when you're back online."
          : "Something went wrong. Try again.",
      );
      setBusy(false);
    }
  };

  usePreventRemove(dirty && !busy, ({ data }) => {
    if (leaving.current) {
      navigation.dispatch(data.action);
      return;
    }
    void confirmAction({
      title: "Discard this run?",
      confirmLabel: "Discard changes",
      destructive: true,
    }).then((ok) => {
      if (ok) {
        leaving.current = true;
        navigation.dispatch(data.action);
      }
    });
  });

  // Keep the submit closure fresh without recreating the bar every keystroke.
  const submitRef = useRef(submit);
  useLayoutEffect(() => {
    submitRef.current = submit;
  });

  const pinSet = pinMode === "meetup" ? !!meetup : !!destination;
  const mapHint =
    pinMode === "meetup"
      ? pinSet
        ? "Tap again to move the meetup"
        : "Tap the map to drop the meetup pin"
      : pinSet
        ? "Tap again to move the destination"
        : "Optional · tap where the drive ends";

  return (
    <View style={s.root}>
      <View style={[s.bar, { paddingTop: insets.top + spacing.m }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={() => navigation.goBack()}
          hitSlop={8}
          style={({ pressed }) => [s.cancel, pressed && { opacity: 0.6 }]}
        >
          <Text style={s.cancelText}>Cancel</Text>
        </Pressable>
        <Text style={s.title} accessibilityRole="header">
          New run
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        <TextField
          label="Call it"
          placeholder="Sunday breakfast run"
          hero
          value={name}
          onChangeText={setName}
          maxLength={80}
          autoCapitalize="words"
          autoFocus
          returnKeyType="done"
        />

        <Segmented
          options={[
            { key: "meetup", label: "Meetup", done: !!meetup },
            { key: "destination", label: "Destination", done: !!destination },
          ]}
          value={pinMode}
          onChange={(k) => {
            haptic.selection();
            setPinMode(k);
          }}
        />

        <View style={s.mapWrap}>
          <Map
            style={s.map}
            mapStyle={scheme === "night" ? MAP_STYLE_DARK_URL : MAP_STYLE_URL}
            compass={false}
            onPress={(e) => {
              const lngLat = e.nativeEvent.lngLat;
              if (!lngLat) return;
              const point: LatLng = { lat: lngLat[1], lng: lngLat[0] };
              haptic.selection();
              if (pinMode === "meetup") setMeetup(point);
              else setDestination(point);
            }}
          >
            <Camera initialViewState={{ center: DEFAULT_CENTER, zoom: 9 }} />
            {meetup ? (
              <Marker lngLat={[meetup.lng, meetup.lat]} {...PLACE_MARKER_PROPS}>
                <PlaceMarker kind="meetup" />
              </Marker>
            ) : null}
            {destination ? (
              <Marker
                lngLat={[destination.lng, destination.lat]}
                {...PLACE_MARKER_PROPS}
              >
                <PlaceMarker kind="destination" />
              </Marker>
            ) : null}
          </Map>
          <View style={s.mapHint} pointerEvents="none">
            <Text style={s.mapHintText}>{mapHint.toUpperCase()}</Text>
          </View>
        </View>

        {pinMode === "meetup" ? (
          <TextField
            label="Meetup name"
            placeholder="e.g. Caltex before Tuas"
            value={meetupLabel}
            onChangeText={setMeetupLabel}
            maxLength={80}
            returnKeyType="done"
          />
        ) : (
          <TextField
            label="Destination name"
            placeholder="e.g. Desaru Coast"
            value={destinationLabel}
            onChangeText={setDestinationLabel}
            maxLength={80}
            returnKeyType="done"
          />
        )}

        {pinMode === "destination" && destination ? (
          <Button
            title="Remove destination"
            role="destructive"
            size="regular"
            onPress={() => {
              setDestination(null);
              setDestinationLabel("");
            }}
          />
        ) : null}

        <Starts value={startsAt} tint={schemeHex(scheme).tint} onChange={setStartsAt} />

        <Text style={s.footnote}>
          {valid
            ? "Everyone who joins gets one-tap Waze directions to these places. Nobody shares location until you start the run."
            : `Add ${missing.join(" and ")} to create the run.`}
        </Text>
      </ScrollView>

      <View style={[s.bottom, { paddingBottom: insets.bottom + spacing.m }]}>
        <Button
          title={busy ? "Creating…" : "Create run"}
          onPress={() => void submitRef.current()}
          loading={busy}
          disabled={!valid}
        />
      </View>
    </View>
  );
}

/**
 * Start date and time. iOS shows the native compact pickers in place (like
 * Calendar); Android opens the system dialogs from two mono tiles.
 */
function Starts({
  value,
  tint,
  onChange,
}: {
  value: Date;
  /** Hex tint — the picker's accentColor only accepts strings. */
  tint: string;
  onChange: (d: Date) => void;
}) {
  const s = useStyles();
  const today = new Date();

  if (Platform.OS === "ios") {
    return (
      <View style={s.starts}>
        <Text style={s.startsLabel}>STARTS</Text>
        <DateTimePicker
          value={value}
          mode="datetime"
          display="compact"
          accentColor={tint}
          minimumDate={today}
          minuteInterval={5}
          accessibilityLabel="Start date and time"
          onValueChange={(_, picked) => onChange(withTime(picked, picked))}
        />
      </View>
    );
  }

  const open = (mode: "date" | "time") =>
    DateTimePickerAndroid.open({
      value,
      mode,
      minimumDate: mode === "date" ? today : undefined,
      onValueChange: (_, picked) =>
        onChange(mode === "date" ? withDate(value, picked) : withTime(value, picked)),
    });

  return (
    <View style={s.startsRow}>
      <FieldTile
        label="Date"
        value={value
          .toLocaleDateString(undefined, { day: "numeric", month: "short" })
          .toUpperCase()}
        onPress={() => open("date")}
        accessibilityHint="Opens the date picker"
        style={s.flex}
      />
      <FieldTile
        label="Time"
        value={value.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}
        onPress={() => open("time")}
        accessibilityHint="Opens the time picker"
        style={s.flex}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.background },
  flex: { flex: 1 },

  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    paddingHorizontal: ROW_INSET,
    paddingBottom: spacing.m,
  },
  cancel: { minHeight: 32, justifyContent: "center" },
  cancelText: { ...type.calloutSemi, color: c.tint },
  title: {
    ...type.display2,
    textTransform: "uppercase",
    color: c.label,
    flex: 1,
    textAlign: "right",
  },

  content: {
    paddingHorizontal: ROW_INSET,
    paddingTop: spacing.s,
    paddingBottom: spacing.xxl,
    gap: spacing.m,
  },

  mapWrap: {
    height: 260,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: c.separator,
    overflow: "hidden",
    backgroundColor: c.mapBackground,
  },
  map: { flex: 1 },
  mapHint: {
    position: "absolute",
    top: spacing.s,
    alignSelf: "center",
    backgroundColor: c.mapChip,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.m,
    paddingVertical: 5,
  },
  mapHintText: {
    ...type.eyebrow,
    fontSize: 9.5,
    letterSpacing: 1.3,
    color: c.label,
  },

  starts: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.m,
    minHeight: 62,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    backgroundColor: c.surface,
    borderRadius: radius.control,
    borderWidth: 0.5,
    borderColor: c.separator,
  },
  startsLabel: { ...type.eyebrow, color: c.tertiaryLabel },
  startsRow: { flexDirection: "row", gap: spacing.m },

  footnote: {
    ...type.footnote,
    color: c.tertiaryLabel,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
  },
  bottom: {
    paddingHorizontal: ROW_INSET,
    paddingTop: spacing.m,
    borderTopWidth: 0.5,
    borderTopColor: c.separator,
    backgroundColor: c.background,
  },
}));

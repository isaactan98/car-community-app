/**
 * Create run (R1): name, meetup picked on a MapLibre map (tap to drop pin),
 * optional destination, date/time. POSTs /runs per the contract.
 *
 * Presented as a modal sheet like Calendar's New Event: Cancel on the
 * leading edge, a prominent Add on the trailing edge, and a Discard Changes
 * confirmation if people swipe away with edits (HIG › Sheets).
 */
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { Camera, Map, Marker } from "@maplibre/maplibre-react-native";
import { usePreventRemove } from "@react-navigation/native";
import { useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { ApiError, createRun } from "../api/client";
import type { LatLng } from "../api/types";
import { MAP_STYLE_DARK_URL, MAP_STYLE_URL } from "../config";
import type { ScreenProps } from "../navigation/types";
import {
  Group,
  ListRow,
  Segmented,
  TextFieldRow,
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
  TOUCH_MIN,
  makeStyles,
  schemeHex,
  spacing,
  type,
  usePalette,
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
  const c = usePalette();
  const scheme = useScheme();
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
        "Couldn't Create the Run",
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
      title: "Discard This Run?",
      confirmLabel: "Discard Changes",
      destructive: true,
    }).then((ok) => {
      if (ok) {
        leaving.current = true;
        navigation.dispatch(data.action);
      }
    });
  });

  // Bar buttons are created once per state change; always call the latest.
  const submitRef = useRef(submit);
  useLayoutEffect(() => {
    submitRef.current = submit;
  });

  useLayoutEffect(() => {
    const cancel = () => navigation.goBack();
    const add = () => void submitRef.current();
    navigation.setOptions({
      unstable_headerLeftItems: () => [
        { type: "button", label: "Cancel", onPress: cancel },
      ],
      unstable_headerRightItems: () => [
        {
          type: "button",
          label: busy ? "Adding…" : "Add",
          variant: "prominent",
          disabled: !valid || busy,
          onPress: add,
        },
      ],
      headerLeft:
        Platform.OS === "ios"
          ? undefined
          : () => <HeaderText label="Cancel" onPress={cancel} />,
      headerRight:
        Platform.OS === "ios"
          ? undefined
          : () =>
              busy ? (
                <ActivityIndicator color={c.tint} />
              ) : (
                <HeaderText label="Add" onPress={add} disabled={!valid} bold />
              ),
    });
  }, [navigation, valid, busy, c]);

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
    <ScrollView
      style={s.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
    >
      <Group>
        <TextFieldRow
          placeholder="Run Name"
          accessibilityLabel="Run name"
          value={name}
          onChangeText={setName}
          maxLength={80}
          autoCapitalize="words"
          autoFocus
          returnKeyType="done"
        />
      </Group>

      <Group>
        <StartsRow value={startsAt} tint={schemeHex(scheme).tint} onChange={setStartsAt} />
      </Group>

      <Group
        header="Location"
        footer={
          valid
            ? "Everyone who joins gets one-tap Waze directions to these places."
            : `Add ${missing.join(" and ")} to create the run.`
        }
      >
        <ListRow>
          <View style={s.segment}>
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
          </View>
        </ListRow>
        <ListRow flush>
          <View style={s.mapWrap}>
            <Map
              style={s.map}
              mapStyle={scheme === "dark" ? MAP_STYLE_DARK_URL : MAP_STYLE_URL}
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
              <Text style={s.mapHintText}>{mapHint}</Text>
            </View>
          </View>
        </ListRow>
        {pinMode === "meetup" ? (
          <TextFieldRow
            label="Name"
            placeholder="e.g. Caltex before Tuas"
            value={meetupLabel}
            onChangeText={setMeetupLabel}
            maxLength={80}
            returnKeyType="done"
          />
        ) : (
          <TextFieldRow
            label="Name"
            placeholder="e.g. Desaru Coast"
            value={destinationLabel}
            onChangeText={setDestinationLabel}
            maxLength={80}
            returnKeyType="done"
          />
        )}
        {pinMode === "destination" && destination ? (
          <ListRow
            title="Remove Destination"
            destructive
            onPress={() => {
              setDestination(null);
              setDestinationLabel("");
            }}
          />
        ) : null}
      </Group>
    </ScrollView>
  );
}

/**
 * "Starts" row. iOS shows the native compact date and time pickers in place
 * (like Calendar); Android opens the system dialogs from tappable values.
 */
function StartsRow({
  position,
  value,
  tint,
  onChange,
}: {
  position?: "only" | "first" | "middle" | "last";
  value: Date;
  /** Hex tint — the picker's accentColor only accepts strings. */
  tint: string;
  onChange: (d: Date) => void;
}) {
  const s = useStyles();
  const today = new Date();
  if (Platform.OS === "ios") {
    return (
      <ListRow position={position}>
        <View style={s.starts}>
          <Text style={s.startsLabel}>Starts</Text>
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
      </ListRow>
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
    <ListRow position={position}>
      <View style={s.starts}>
        <Text style={s.startsLabel}>Starts</Text>
        <View style={s.startsValues}>
          <Pressable accessibilityRole="button" onPress={() => open("date")} style={s.chip}>
            <Text style={s.chipText}>
              {value.toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => open("time")} style={s.chip}>
            <Text style={s.chipText}>
              {value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </Text>
          </Pressable>
        </View>
      </View>
    </ListRow>
  );
}

function HeaderText({
  label,
  onPress,
  disabled,
  bold,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  bold?: boolean;
}) {
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[s.headerText, disabled && { opacity: 0.35 }]}
    >
      <Text style={[s.headerTextLabel, bold && s.headerTextBold]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: ROW_INSET, paddingTop: spacing.l, paddingBottom: spacing.xxl },
  segment: { flex: 1 },
  mapWrap: { flex: 1, height: 280 },
  map: { flex: 1 },
  mapHint: {
    position: "absolute",
    top: spacing.s,
    alignSelf: "center",
    backgroundColor: c.mapChip,
    borderRadius: 999,
    paddingHorizontal: spacing.m,
    paddingVertical: 6,
  },
  mapHintText: { ...type.footnote, fontWeight: "600", color: c.label },
  starts: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.m,
  },
  startsLabel: { ...type.body, color: c.label },
  startsValues: { flexDirection: "row", gap: spacing.s },
  chip: {
    minHeight: TOUCH_MIN - 8,
    justifyContent: "center",
    paddingHorizontal: spacing.m,
    borderRadius: 8,
    backgroundColor: c.fill,
  },
  chipText: { ...type.body, color: c.label },
  headerText: {
    minHeight: TOUCH_MIN,
    minWidth: TOUCH_MIN,
    justifyContent: "center",
    paddingHorizontal: spacing.s,
  },
  headerTextLabel: { ...type.body, color: c.tint },
  headerTextBold: { fontWeight: "600" },
}));

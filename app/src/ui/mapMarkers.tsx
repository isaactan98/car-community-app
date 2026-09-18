/**
 * Map annotations shared by the create-run picker and the live map, styled
 * like MapKit markers: places are glyph pins, people are dots. Use the
 * exported anchor/offset props with <Marker> so the pin tip or dot centre
 * lands exactly on its coordinate.
 */
import { Text, View, type ColorValue } from "react-native";

import { Icon } from "./Icon";
import { makeStyles, type, usePalette } from "./theme";

export type PlaceKind = "meetup" | "destination";

export const PLACE_LABEL: Record<PlaceKind, string> = {
  meetup: "Meetup",
  destination: "Destination",
};

/** Pin tip sits on the coordinate; the caption floats above the crowd. */
export const PLACE_MARKER_PROPS = { anchor: "bottom" } as const;

export function PlaceMarker({
  kind,
  count,
}: {
  kind: PlaceKind;
  /** Members gathered here while zoomed out (clustered into the pin). */
  count?: number;
}) {
  const s = useStyles();
  const c = usePalette();
  const caption =
    count && count > 0 ? `${PLACE_LABEL[kind]} · ${count} here` : PLACE_LABEL[kind];
  return (
    <View style={s.placeWrap} accessibilityLabel={caption}>
      <Text style={s.caption} numberOfLines={1} maxFontSizeMultiplier={1.5}>
        {caption}
      </Text>
      <View style={[s.pin, kind === "destination" ? s.pinDestination : s.pinMeetup]}>
        <Icon
          name={kind === "meetup" ? "meetup" : "destination"}
          size={16}
          color={kind === "meetup" ? c.onTint : c.surface}
        />
      </View>
      <View style={[s.tail, kind === "destination" ? s.pinDestination : s.pinMeetup]} />
    </View>
  );
}

// Padding enlarges the tap area around the small dot.
const DOT_PAD = 6;

function dotSize(isSelf?: boolean): number {
  return isSelf ? 22 : 18;
}

/** Dot centre on the coordinate; the name label hangs below it. */
export function personMarkerProps(isSelf: boolean): {
  anchor: "top";
  offset: [x: number, y: number];
} {
  return { anchor: "top", offset: [0, -(DOT_PAD + dotSize(isSelf) / 2)] };
}

export function PersonDot({
  name,
  color,
  isSelf,
  selected,
  note,
}: {
  name: string;
  color: ColorValue;
  isSelf?: boolean;
  selected?: boolean;
  /** Extra label text, e.g. staleness age. */
  note?: string;
}) {
  const s = useStyles();
  const size = dotSize(isSelf);
  return (
    <View style={s.personWrap}>
      <View
        style={[
          s.dot,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            borderWidth: selected ? 4 : 2.5,
          },
        ]}
      />
      <Text
        style={[s.label, selected && s.labelSelected]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.5}
      >
        {isSelf ? "You" : name}
        {note ? ` · ${note}` : ""}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  placeWrap: { alignItems: "center" },
  caption: {
    ...type.caption1,
    fontWeight: "600",
    color: c.label,
    backgroundColor: c.mapChip,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 3,
  },
  pin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  pinMeetup: { backgroundColor: c.tint },
  pinDestination: { backgroundColor: c.label },
  // A rotated square reads as the marker's tail pointing at the spot.
  tail: {
    width: 8,
    height: 8,
    transform: [{ rotate: "45deg" }],
    marginTop: -5,
  },
  personWrap: { alignItems: "center", maxWidth: 120, padding: DOT_PAD },
  dot: {
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  label: {
    ...type.caption2,
    fontWeight: "600",
    color: c.label,
    backgroundColor: c.mapChip,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    overflow: "hidden",
    marginTop: 3,
  },
  labelSelected: { backgroundColor: c.tint, color: c.onTint },
}));

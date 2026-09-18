/**
 * Map annotations shared by the create-run picker and the live map. Places
 * are glyph pins, people are dots with a mono caption — the same numeric
 * voice the rest of the app speaks in, so a label on the map and a row on
 * the board read as the same system.
 *
 * Use the exported anchor/offset props with <Marker> so the pin tip or dot
 * centre lands exactly on its coordinate.
 */
import { Text, View, type ColorValue } from "react-native";

import { Icon } from "./Icon";
import { makeStyles, radius, type, usePalette } from "./theme";

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
      <Text style={s.caption} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {caption.toUpperCase()}
      </Text>
      <View style={[s.pin, kind === "destination" ? s.pinDestination : s.pinMeetup]}>
        <Icon
          name={kind === "meetup" ? "meetup" : "destination"}
          size={15}
          color={kind === "meetup" ? c.onTint : c.background}
        />
      </View>
      <View style={[s.tail, kind === "destination" ? s.pinDestination : s.pinMeetup]} />
    </View>
  );
}

// Padding enlarges the tap area around the small dot.
const DOT_PAD = 6;

function dotSize(isSelf?: boolean): number {
  return isSelf ? 20 : 16;
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
            borderWidth: selected ? 3.5 : 2.5,
          },
        ]}
      />
      <Text
        style={[s.label, selected && s.labelSelected]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.4}
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
    ...type.eyebrow,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.4,
    color: c.label,
    backgroundColor: c.mapChip,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.chip,
    overflow: "hidden",
    marginBottom: 3,
  },
  pin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.3,
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
  personWrap: { alignItems: "center", maxWidth: 124, padding: DOT_PAD },
  dot: {
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  label: {
    ...type.monoSmall,
    fontSize: 10,
    lineHeight: 13,
    color: c.label,
    backgroundColor: c.mapChip,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: "hidden",
    marginTop: 3,
  },
  labelSelected: { backgroundColor: c.tint, color: c.onTint },
}));

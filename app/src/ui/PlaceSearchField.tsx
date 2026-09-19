/**
 * Text search for a map pin (R9).
 *
 * Picking a meetup used to mean hunting for it on a map at zoom 9, which is
 * fine for a carpark you can see and useless for "that Caltex before Tuas".
 *
 * Two rules are structural rather than cosmetic, and both come from the free
 * OSM geocoder's usage policy (docs/CONTRACT.md): never one request per
 * keystroke, and never a query so short it cannot mean anything. The debounce
 * and the minimum length below are how this component keeps that promise; the
 * server caches and rate-limits behind it.
 *
 * Results are OpenStreetMap data, so they are credited wherever they appear.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { ApiError, searchPlaces } from "../api/client";
import type { LatLng, PlaceResult } from "../api/types";
import {
  PLACE_SEARCH_DEBOUNCE_MS,
  PLACE_SEARCH_LIMIT,
  PLACE_SEARCH_MIN_CHARS,
} from "../config";
import { TextField } from "./components";
import { haptic } from "./haptics";
import { Icon } from "./Icon";
import { makeStyles, radius, spacing, TOUCH_MIN, type, usePalette } from "./theme";

type Status = "idle" | "searching" | "empty" | "limited" | "error";

export function PlaceSearchField({
  label,
  placeholder,
  near,
  onPick,
}: {
  label: string;
  placeholder: string;
  /**
   * Map centre, read at search time. A getter rather than a value because the
   * map pans constantly and nothing here should re-render (or re-search) for
   * it — but the bias point still has to be current when a query fires.
   */
  near: () => LatLng | null;
  onPick: (place: PlaceResult) => void;
}) {
  const s = useStyles();
  const c = usePalette();
  const [text, setText] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every search carries a generation; a slow answer to an abandoned query is
  // dropped rather than overwriting a newer one.
  const generation = useRef(0);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /**
   * Typing schedules a search rather than performing one. The delay is the
   * whole point: one request per keystroke is outside what the free geocoder
   * upstream allows, and would earn the group a 429 (or worse) in a week.
   */
  const onChangeText = (value: string) => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    const query = value.trim();
    const id = ++generation.current; // abandons anything in flight
    if (query.length < PLACE_SEARCH_MIN_CHARS) {
      setResults([]);
      setStatus("idle");
      return;
    }
    setStatus("searching");
    timer.current = setTimeout(() => {
      // `near()` is read here, not at render: the map pans constantly and the
      // bias point has to be wherever it is *now*.
      searchPlaces(query, near(), PLACE_SEARCH_LIMIT)
        .then((found) => {
          if (id !== generation.current) return;
          setResults(found);
          setStatus(found.length === 0 ? "empty" : "idle");
        })
        .catch((err: unknown) => {
          if (id !== generation.current) return;
          setResults([]);
          setStatus(err instanceof ApiError && err.status === 429 ? "limited" : "error");
        });
    }, PLACE_SEARCH_DEBOUNCE_MS);
  };

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    generation.current += 1;
    setText("");
    setResults([]);
    setStatus("idle");
  };

  const pick = (place: PlaceResult) => {
    haptic.selection();
    clear();
    onPick(place);
  };

  const note = statusNote(status);

  return (
    <View style={s.wrap}>
      <TextField
        label={label}
        placeholder={placeholder}
        value={text}
        onChangeText={onChangeText}
        maxLength={80}
        autoCorrect={false}
        returnKeyType="search"
        trailing={
          status === "searching" ? (
            <ActivityIndicator size="small" color={c.secondaryLabel} />
          ) : text.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={8}
              onPress={clear}
              style={s.clear}
            >
              <Icon name="close" size={12} weight="bold" color={c.secondaryLabel} />
            </Pressable>
          ) : (
            <Icon name="search" size={17} color={c.tertiaryLabel} />
          )
        }
      />

      {results.length > 0 ? (
        <View style={s.results} accessibilityLabel="Search results">
          {results.map((place, index) => (
            <Pressable
              key={`${place.lat},${place.lng},${index}`}
              accessibilityRole="button"
              accessibilityLabel={
                place.detail ? `${place.label}, ${place.detail}` : place.label
              }
              accessibilityHint="Drops the pin here"
              onPress={() => pick(place)}
              style={({ pressed }) => [
                s.result,
                index > 0 && s.resultDivided,
                pressed && { backgroundColor: c.highlight },
              ]}
            >
              <Icon name="meetup" size={17} color={c.tint} />
              <View style={s.resultText}>
                <Text style={s.resultLabel} numberOfLines={1}>
                  {place.label}
                </Text>
                {place.detail ? (
                  <Text style={s.resultDetail} numberOfLines={1}>
                    {place.detail}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
          <Text style={s.credit}>Results © OpenStreetMap contributors</Text>
        </View>
      ) : null}

      {note ? (
        <Text
          style={s.note}
          accessibilityRole={status === "error" || status === "limited" ? "alert" : undefined}
        >
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function statusNote(status: Status): string | null {
  switch (status) {
    case "empty":
      return "Nothing found. Try the area name, or just tap the map.";
    case "limited":
      return "Searching too fast — wait a moment, or tap the map.";
    case "error":
      return "Search is unavailable right now. Tap the map to drop the pin.";
    default:
      return null;
  }
}

const useStyles = makeStyles((c) => ({
  wrap: { gap: spacing.s },
  clear: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.fill,
  },
  results: {
    backgroundColor: c.surface,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: c.separator,
    overflow: "hidden",
  },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    minHeight: TOUCH_MIN + 8,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
  },
  resultDivided: { borderTopWidth: 0.5, borderTopColor: c.separator },
  resultText: { flex: 1, gap: 1 },
  resultLabel: { ...type.bodySemi, color: c.label },
  resultDetail: { ...type.footnote, color: c.secondaryLabel },
  credit: {
    ...type.caption,
    fontSize: 10.5,
    color: c.tertiaryLabel,
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
    paddingTop: 2,
  },
  note: { ...type.footnote, color: c.secondaryLabel, paddingHorizontal: spacing.xs },
}));

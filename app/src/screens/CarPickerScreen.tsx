/**
 * RSVP car picker (R2), presented as a native resizable sheet with a grabber
 * (Cancel on the leading edge, swipe to dismiss). Choosing a car saves the
 * RSVP and closes the sheet; the run screen refreshes on focus.
 *
 * This stays a grouped list on purpose — it's a short pick-one decision, and
 * the card treatment used elsewhere would add weight without adding clarity.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { ApiError, addCar, getMe, rsvp } from "../api/client";
import type { Car } from "../api/types";
import type { ScreenProps } from "../navigation/types";
import {
  Button,
  Group,
  InlineBanner,
  ListRow,
  Plate,
  TextFieldRow,
} from "../ui/components";
import { haptic } from "../ui/haptics";
import { Icon } from "../ui/Icon";
import { ROW_INSET, makeStyles, spacing, type, usePalette } from "../ui/theme";

type Saving = string | "none" | "new" | null;

export default function CarPickerScreen({
  route,
  navigation,
}: ScreenProps<"CarPicker">) {
  const s = useStyles();
  const c = usePalette();
  const { runId, currentCar } = route.params;
  const [cars, setCars] = useState<Car[] | null>(null);
  const [newCar, setNewCar] = useState("");
  const [saving, setSaving] = useState<Saving>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then((me) => setCars(me.cars))
      .catch(() => {
        setCars([]);
        setError("Couldn't load your garage — you can still join without a car.");
      });
  }, []);

  const pick = async (carId: string | null, key: Saving) => {
    setSaving(key);
    setError(null);
    try {
      await rsvp(runId, carId);
      haptic.success();
      navigation.goBack();
    } catch (err) {
      haptic.error();
      setError(
        err instanceof ApiError && err.network
          ? "The server is unreachable. Try again when you're back online."
          : "Couldn't save your RSVP. Try again.",
      );
      setSaving(null);
    }
  };

  const addAndPick = async () => {
    const name = newCar.trim();
    if (name.length === 0 || saving) return;
    setSaving("new");
    try {
      const car = await addCar(name);
      await pick(car.id, "new");
    } catch {
      haptic.error();
      setError("Couldn't add that car right now.");
      setSaving(null);
    }
  };

  const busy = saving !== null;

  return (
    <View style={s.root}>
      <View style={s.bar}>
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
          What are you bringing?
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {error ? (
          <View style={s.error}>
            <InlineBanner
              icon="warning"
              tone="warning"
              title="Something went wrong"
              body={error}
            />
          </View>
        ) : null}

        <Group header="Your garage" footer="Shown next to your name on the board.">
          {cars === null ? (
            <ListRow>
              <ActivityIndicator color={c.secondaryLabel} />
            </ListRow>
          ) : (
            cars.map((car) => (
              <ListRow
                key={car.id}
                leading={<Icon name="car" size={20} color={c.tint} />}
                onPress={() => void pick(car.id, car.id)}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityLabel={car.name}
                accessibilityState={{ checked: car.name === currentCar }}
                trailing={
                  saving === car.id ? (
                    <ActivityIndicator color={c.secondaryLabel} />
                  ) : car.name === currentCar ? (
                    <Icon name="check" size={16} weight="semibold" color={c.tint} />
                  ) : null
                }
              >
                <View style={s.carRow}>
                  <Text style={s.carName} numberOfLines={1}>
                    {car.name}
                  </Text>
                  <Plate name={car.name} self={car.name === currentCar} />
                </View>
              </ListRow>
            ))
          )}
          <ListRow
            leading={<Icon name="group" size={19} color={c.secondaryLabel} />}
            title="Without a car"
            subtitle="Riding along or not sure yet"
            onPress={() => void pick(null, "none")}
            disabled={busy}
            accessibilityRole="radio"
            accessibilityState={{ checked: currentCar === null }}
            trailing={
              saving === "none" ? <ActivityIndicator color={c.secondaryLabel} /> : null
            }
          />
        </Group>

        <Group header="Add a car">
          <TextFieldRow
            leading={<Icon name="addCircle" size={20} color={c.green} />}
            placeholder="e.g. GR86"
            accessibilityLabel="New car name"
            value={newCar}
            onChangeText={setNewCar}
            returnKeyType="done"
            onSubmitEditing={() => void addAndPick()}
            maxLength={60}
            editable={!busy}
            trailing={
              newCar.trim().length > 0 ? (
                <Button
                  title="Add"
                  role="plain"
                  size="small"
                  loading={saving === "new"}
                  onPress={() => void addAndPick()}
                />
              ) : null
            }
          />
        </Group>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.background },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    paddingHorizontal: ROW_INSET,
    paddingTop: spacing.xl,
    paddingBottom: spacing.m,
  },
  cancel: { minHeight: 32, justifyContent: "center" },
  cancelText: { ...type.calloutSemi, color: c.tint },
  title: {
    ...type.display3,
    color: c.label,
    flex: 1,
    textAlign: "right",
  },
  content: {
    paddingHorizontal: ROW_INSET,
    paddingTop: spacing.s,
    paddingBottom: spacing.xxl,
  },
  error: { marginBottom: spacing.l },
  carRow: { flex: 1, gap: 4, alignItems: "flex-start" },
  carName: { ...type.bodySemi, color: c.label },
}));

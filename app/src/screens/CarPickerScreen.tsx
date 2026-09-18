/**
 * RSVP car picker (R2), presented as a native resizable sheet with a grabber
 * (HIG › Sheets: Cancel on the leading edge, swipe to dismiss). Choosing a
 * car saves the RSVP and closes the sheet; the run screen refreshes on focus.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { ApiError, addCar, getMe, rsvp } from "../api/client";
import type { Car } from "../api/types";
import type { ScreenProps } from "../navigation/types";
import {
  Button,
  Group,
  InlineBanner,
  ListRow,
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
        <Button
          title="Cancel"
          role="plain"
          size="regular"
          onPress={() => navigation.goBack()}
          style={s.barSide}
        />
        <Text style={s.barTitle} accessibilityRole="header">
          Choose Your Car
        </Text>
        <View style={s.barSide} />
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {error ? (
          <View style={s.error}>
            <InlineBanner icon="warning" tone="warning" title="Something Went Wrong" body={error} />
          </View>
        ) : null}

        <Group header="Your Garage" footer="Shown next to your name on the arrival board.">
          {cars === null ? (
            <ListRow>
              <ActivityIndicator color={c.secondaryLabel} />
            </ListRow>
          ) : (
            cars.map((car) => (
              <ListRow
                key={car.id}
                leading={<Icon name="car" size={22} color={c.tint} />}
                title={car.name}
                onPress={() => void pick(car.id, car.id)}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityState={{ checked: car.name === currentCar }}
                trailing={
                  saving === car.id ? (
                    <ActivityIndicator color={c.secondaryLabel} />
                  ) : car.name === currentCar ? (
                    <Icon name="check" size={17} weight="semibold" color={c.tint} />
                  ) : null
                }
              />
            ))
          )}
          <ListRow
            leading={<Icon name="group" size={20} color={c.secondaryLabel} />}
            title="Without a Car"
            subtitle="Riding along or not sure yet"
            onPress={() => void pick(null, "none")}
            disabled={busy}
            trailing={saving === "none" ? <ActivityIndicator color={c.secondaryLabel} /> : null}
          />
        </Group>

        <Group header="Add a Car">
          <TextFieldRow
            leading={<Icon name="addCircle" size={22} color={c.green} />}
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
                  size="regular"
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
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.l,
    paddingBottom: spacing.s,
  },
  barSide: { minWidth: 88, alignItems: "flex-start" },
  barTitle: { ...type.headline, color: c.label, flex: 1, textAlign: "center" },
  content: { paddingHorizontal: ROW_INSET, paddingTop: spacing.s, paddingBottom: spacing.xxl },
  error: { marginBottom: spacing.l },
}));

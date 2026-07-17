/**
 * Simple garage (R2): add/remove free-text car names via /me/cars.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { addCar, deleteCar, getMe } from "../api/client";
import type { Car } from "../api/types";
import { Button, Loading, Screen } from "../ui/components";
import { colors, spacing } from "../ui/theme";

export default function GarageScreen() {
  const [cars, setCars] = useState<Car[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(
    () =>
      getMe()
        .then((me) => {
          setCars(me.cars);
          setOffline(false);
        })
        .catch(() => {
          setCars((prev) => prev ?? []);
          setOffline(true);
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    try {
      await addCar(trimmed);
      setName("");
      await load();
    } catch {
      Alert.alert("Couldn't add car", "Server unreachable or rejected it.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (car: Car) => {
    setBusy(true);
    try {
      await deleteCar(car.id);
      await load();
    } catch {
      Alert.alert("Couldn't remove car");
    } finally {
      setBusy(false);
    }
  };

  if (cars === null) return <Loading label="Loading garage…" />;

  return (
    <Screen>
      <View style={styles.content}>
        {offline ? (
          <Text style={styles.offline}>Offline — garage may be stale.</Text>
        ) : null}
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder='Car name (free text, e.g. "ND2 MX-5")'
            placeholderTextColor={colors.textDim}
            value={name}
            onChangeText={setName}
            maxLength={60}
            onSubmitEditing={add}
          />
          <Button title="Add" small onPress={add} disabled={busy} />
        </View>
        <FlatList
          data={cars}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.carName}>{item.name}</Text>
              <Button
                title="Remove"
                kind="danger"
                small
                disabled={busy}
                onPress={() => remove(item)}
              />
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No cars yet. Add what you drive so RSVPs can show it.
            </Text>
          }
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: spacing.l, gap: spacing.m },
  offline: { color: colors.amber, fontSize: 13 },
  addRow: { flexDirection: "row", gap: spacing.s, alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  carName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  empty: { color: colors.textDim, textAlign: "center", marginTop: spacing.xl },
});

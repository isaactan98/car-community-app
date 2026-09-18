/**
 * Profile: who you are, your simple garage (R2 — free-text car names via
 * /me/cars), and leaving the group on this phone. Laid out like an Apple
 * account page; the garage uses the standard Edit/Done pattern for removal.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { addCar, deleteCar, getMe } from "../api/client";
import type { Car } from "../api/types";
import type { ScreenProps } from "../navigation/types";
import { useSession } from "../session/SessionContext";
import {
  Avatar,
  Button,
  Group,
  InlineBanner,
  ListRow,
  Loading,
  TextFieldRow,
  confirmAction,
} from "../ui/components";
import { haptic } from "../ui/haptics";
import { Icon } from "../ui/Icon";
import { ROW_INSET, TOUCH_MIN, makeStyles, spacing, type, usePalette } from "../ui/theme";

export default function ProfileScreen({ navigation }: ScreenProps<"Profile">) {
  const s = useStyles();
  const c = usePalette();
  const { member, logout } = useSession();
  const [cars, setCars] = useState<Car[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [editing, setEditing] = useState(false);

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

  const hasCars = (cars?.length ?? 0) > 0;
  const isEditing = editing && hasCars;

  useLayoutEffect(() => {
    const toggle = () => setEditing((e) => !e);
    const label = isEditing ? "Done" : "Edit";
    navigation.setOptions({
      unstable_headerRightItems: () =>
        hasCars
          ? [
              {
                type: "button",
                label,
                variant: isEditing ? "done" : "plain",
                onPress: toggle,
              },
            ]
          : [],
      headerRight:
        Platform.OS !== "ios" && hasCars
          ? () => (
              <Pressable accessibilityRole="button" onPress={toggle} style={s.headerButton}>
                <Text style={s.headerButtonText}>{label}</Text>
              </Pressable>
            )
          : undefined,
    });
  }, [navigation, hasCars, isEditing, s]);

  const add = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    try {
      await addCar(trimmed);
      haptic.success();
      setName("");
      await load();
    } catch {
      haptic.error();
      Alert.alert("Couldn't Add Car", "The server is unreachable or rejected it.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (car: Car) => {
    const ok = await confirmAction({
      title: `Remove ${car.name}?`,
      message: "Runs you've already joined keep showing it.",
      confirmLabel: "Remove Car",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCar(car.id);
      await load();
    } catch {
      haptic.error();
      Alert.alert("Couldn't Remove Car", "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const leaveGroup = async () => {
    const ok = await confirmAction({
      title: "Leave the Group on This Phone?",
      message: "Any location sharing stops now. You'll need an invite code to join again.",
      confirmLabel: "Leave Group",
      destructive: true,
    });
    if (ok) await logout();
  };

  if (cars === null) return <Loading />;

  return (
    <ScrollView
      style={s.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <View style={s.identity}>
        <Avatar name={member?.displayName ?? "?"} size={84} />
        <Text style={s.name} accessibilityRole="header">
          {member?.displayName ?? "Member"}
        </Text>
        <Text style={s.caption}>Member of the group</Text>
      </View>

      {offline ? (
        <View style={s.banner}>
          <InlineBanner
            icon="offline"
            tone="warning"
            title="Offline"
            body="Your garage may be out of date."
            actionLabel="Retry"
            onAction={() => void load()}
          />
        </View>
      ) : null}

      <Group
        header="Garage"
        footer="Pick one of these when you join a run so the group knows what you're bringing."
      >
        {cars.map((car) => (
          <ListRow
            key={car.id}
            leading={
              isEditing ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${car.name}`}
                  onPress={() => void remove(car)}
                  disabled={busy}
                  hitSlop={10}
                >
                  <Icon name="remove" size={24} color={c.red} />
                </Pressable>
              ) : (
                <Icon name="car" size={22} color={c.tint} />
              )
            }
            title={car.name}
          />
        ))}
        <TextFieldRow
          leading={<Icon name="addCircle" size={24} color={c.green} />}
          placeholder="Add Car"
          accessibilityLabel="Add a car"
          value={name}
          onChangeText={setName}
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={() => void add()}
          editable={!busy}
          trailing={
            busy && name.trim() ? (
              <ActivityIndicator color={c.secondaryLabel} />
            ) : name.trim() ? (
              <Button title="Add" role="plain" size="regular" onPress={() => void add()} />
            ) : null
          }
        />
      </Group>

      <Group footer="Signs you out on this phone. You'll need an invite code to rejoin.">
        <ListRow title="Leave Group" destructive onPress={() => void leaveGroup()} />
      </Group>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: ROW_INSET, paddingBottom: spacing.xxl },
  identity: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xl },
  name: { ...type.title2, color: c.label, marginTop: spacing.s },
  caption: { ...type.subheadline, color: c.secondaryLabel },
  banner: { marginBottom: spacing.xl },
  headerButton: {
    minHeight: TOUCH_MIN,
    minWidth: TOUCH_MIN,
    justifyContent: "center",
    paddingHorizontal: spacing.s,
  },
  headerButtonText: { ...type.body, color: c.label },
}));

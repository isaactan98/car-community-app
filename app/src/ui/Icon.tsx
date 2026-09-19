/**
 * One icon system: SF Symbols on iOS, the matching Material Symbols on
 * Android (both via expo-symbols). Icons are decorative by default — the
 * control that contains them carries the accessibility label.
 */
import {
  SymbolView,
  type SymbolViewProps,
  type SymbolWeight,
} from "expo-symbols";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";

type PlatformNames = Exclude<SymbolViewProps["name"], string>;
type SFSymbol = NonNullable<PlatformNames["ios"]>;
type AndroidSymbol = NonNullable<PlatformNames["android"]>;

const ICONS = {
  add: { ios: "plus", android: "add" },
  addCircle: { ios: "plus.circle.fill", android: "add_circle" },
  profile: { ios: "person.crop.circle", android: "account_circle" },
  share: { ios: "square.and.arrow.up", android: "share" },
  directions: {
    ios: "arrow.triangle.turn.up.right.diamond.fill",
    android: "directions",
  },
  locate: { ios: "location.fill", android: "my_location" },
  fitAll: { ios: "arrow.up.left.and.arrow.down.right", android: "zoom_out_map" },
  car: { ios: "car.fill", android: "directions_car" },
  arrived: { ios: "checkmark.circle.fill", android: "check_circle" },
  clock: { ios: "clock.fill", android: "schedule" },
  meetup: { ios: "mappin.circle.fill", android: "location_on" },
  destination: { ios: "flag.checkered", android: "sports_score" },
  chevron: { ios: "chevron.right", android: "chevron_right" },
  offline: { ios: "wifi.slash", android: "wifi_off" },
  warning: { ios: "exclamationmark.triangle.fill", android: "warning" },
  sharing: { ios: "location.circle.fill", android: "share_location" },
  lock: { ios: "lock.fill", android: "lock" },
  group: { ios: "person.2.fill", android: "group" },
  map: { ios: "map.fill", android: "map" },
  close: { ios: "xmark", android: "close" },
  remove: { ios: "minus.circle.fill", android: "remove_circle" },
  check: { ios: "checkmark", android: "check" },
  stale: { ios: "exclamationmark.circle.fill", android: "error" },
  start: { ios: "flag.fill", android: "flag" },
  live: { ios: "dot.radiowaves.left.and.right", android: "cell_tower" },
  calendar: { ios: "calendar", android: "schedule" },
  search: { ios: "magnifyingglass", android: "search" },
} satisfies Record<string, { ios: SFSymbol; android: AndroidSymbol }>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  color,
  weight,
  style,
}: {
  name: IconName;
  size?: number;
  color: ColorValue;
  weight?: SymbolWeight;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SymbolView
      name={ICONS[name]}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
      style={[{ width: size, height: size }, style]}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

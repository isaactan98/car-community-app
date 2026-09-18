/**
 * Shared UI built on iOS system patterns: inset grouped lists, capsule
 * buttons, monogram avatars, action-sheet confirmations. Every tappable
 * meets the 44 pt minimum target.
 */
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

import { initials } from "../lib/format";
import { formatAge } from "../lib/staleness";
import { wazeUrl } from "../lib/waze";
import { Icon, type IconName } from "./Icon";
import {
  ROW_INSET,
  TOUCH_MIN,
  makeStyles,
  radius,
  spacing,
  type,
  usePalette,
} from "./theme";

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonRole = "filled" | "tinted" | "plain" | "destructive";

/**
 * Capsule button. Use "filled" for the one most likely action per view
 * (HIG › Buttons: one or two prominent buttons at most), "tinted" for
 * secondary actions, "plain" for inline links.
 */
export function Button({
  title,
  onPress,
  role = "filled",
  size = "large",
  icon,
  loading,
  disabled,
  style,
  accessibilityLabel,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  role?: ButtonRole;
  size?: "large" | "regular";
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const s = useStyles();
  const c = usePalette();
  const fg =
    role === "filled" ? c.onTint : role === "destructive" ? c.destructive : c.tint;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        s.button,
        size === "large" ? s.buttonLarge : s.buttonRegular,
        role === "filled" && s.buttonFilled,
        (role === "tinted" || role === "destructive") && s.buttonTinted,
        role === "plain" && s.buttonPlain,
        { opacity: disabled ? 0.35 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : icon ? (
        <Icon name={icon} size={size === "large" ? 19 : 16} color={fg} />
      ) : null}
      <Text
        style={[size === "large" ? s.buttonTextLarge : s.buttonTextRegular, { color: fg }]}
        numberOfLines={1}
        maxFontSizeMultiplier={2}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/** One-tap Waze handoff (R5). */
export function WazeButton({
  lat,
  lng,
  place,
  label = "Waze",
  size = "regular",
  style,
}: {
  lat: number;
  lng: number;
  /** Spoken destination, e.g. "the meetup". */
  place: string;
  label?: string;
  size?: "large" | "regular";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Button
      title={label}
      role="tinted"
      size={size}
      icon="directions"
      style={style}
      accessibilityLabel={`Navigate to ${place} in Waze`}
      onPress={() => {
        // Fire-and-forget: if Waze isn't installed the universal link's
        // browser fallback handles it. Never crash on failure.
        Linking.openURL(wazeUrl(lat, lng)).catch(() => {});
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Inset grouped lists
// ---------------------------------------------------------------------------

export type RowPosition = "only" | "first" | "middle" | "last";

export function rowPosition(index: number, count: number): RowPosition {
  if (count === 1) return "only";
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
}

/**
 * An inset grouped section. Children get their position so they can round
 * the outer corners and draw inset separators between rows.
 */
export function Group({
  header,
  footer,
  children,
  style,
}: {
  header?: string;
  footer?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const rows = Children.toArray(children).filter(isValidElement) as ReactElement<{
    position?: RowPosition;
  }>[];
  return (
    <View style={[s.group, style]}>
      {header ? <SectionHeader title={header} /> : null}
      <View>
        {rows.map((row, i) =>
          cloneElement(row, { position: rowPosition(i, rows.length) }),
        )}
      </View>
      {footer ? <SectionFooter>{footer}</SectionFooter> : null}
    </View>
  );
}

export function SectionHeader({
  title,
  count,
  prominent,
}: {
  title: string;
  count?: number;
  /** Title 3 content header (Health/Reminders style) vs. a form header. */
  prominent?: boolean;
}) {
  const s = useStyles();
  return (
    <Text
      style={prominent ? s.headerProminent : s.header}
      accessibilityRole="header"
    >
      {title}
      {count !== undefined ? <Text style={s.headerCount}>{`  ${count}`}</Text> : null}
    </Text>
  );
}

export function SectionFooter({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <Text style={s.footer}>{children}</Text>;
}

/**
 * A list row: optional leading icon/avatar, title and subtitle, then a
 * trailing value, custom accessory and/or disclosure chevron. Pass
 * `children` instead of `title` for fully custom content.
 */
export function ListRow({
  position = "only",
  title,
  subtitle,
  leading,
  value,
  trailing,
  chevron,
  destructive,
  tinted,
  flush,
  onPress,
  disabled,
  children,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole,
  accessibilityState,
}: {
  position?: RowPosition;
  title?: string;
  subtitle?: string;
  leading?: ReactNode;
  value?: string;
  trailing?: ReactNode;
  chevron?: boolean;
  destructive?: boolean;
  /** Title in the app tint (e.g. an "Add" action row). */
  tinted?: boolean;
  /** No padding: content (e.g. a map) runs edge to edge. */
  flush?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  children?: ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "radio" | "summary" | "text";
  accessibilityState?: { selected?: boolean; checked?: boolean };
}) {
  const s = useStyles();
  const c = usePalette();
  const roundTop = position === "only" || position === "first";
  const roundBottom = position === "only" || position === "last";
  const separator = position === "first" || position === "middle";
  const inset = leading ? ROW_INSET + 40 + spacing.m : ROW_INSET;

  const body = (
    <>
      {leading ? <View style={s.rowLeading}>{leading}</View> : null}
      {children ?? (
        <View style={s.rowText}>
          <Text
            style={[
              s.rowTitle,
              destructive && { color: c.destructive },
              tinted && { color: c.tint },
            ]}
          >
            {title}
          </Text>
          {subtitle ? <Text style={s.rowSubtitle}>{subtitle}</Text> : null}
        </View>
      )}
      {value ? (
        <Text style={s.rowValue} numberOfLines={2}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {chevron ? (
        <Icon name="chevron" size={13} weight="semibold" color={c.tertiaryLabel} />
      ) : null}
      {separator ? <View style={[s.separator, { left: inset }]} /> : null}
    </>
  );

  const shape: ViewStyle = {
    ...(flush ? { padding: 0, paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden" } : null),
    borderTopLeftRadius: roundTop ? radius.group : 0,
    borderTopRightRadius: roundTop ? radius.group : 0,
    borderBottomLeftRadius: roundBottom ? radius.group : 0,
    borderBottomRightRadius: roundBottom ? radius.group : 0,
  };

  if (!onPress) {
    return (
      <View
        style={[s.row, shape]}
        accessible={!!accessibilityLabel}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
      >
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole={accessibilityRole ?? "button"}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.row,
        shape,
        pressed && { backgroundColor: c.highlight },
        disabled && { opacity: 0.4 },
      ]}
    >
      {body}
    </Pressable>
  );
}

/** Settings-style text field row: a fixed label, then the field. */
export function TextFieldRow({
  position,
  label,
  leading,
  trailing,
  ref,
  ...input
}: TextInputProps & {
  position?: RowPosition;
  /** Visible label. Omit only for a self-evident single field. */
  label?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  ref?: Ref<TextInput>;
}) {
  const s = useStyles();
  const c = usePalette();
  return (
    <ListRow position={position} leading={leading} trailing={trailing}>
      <View style={s.fieldRow}>
        {label ? (
          <Text style={s.fieldLabel} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label ?? input.placeholder}
          placeholderTextColor={c.placeholder}
          selectionColor={c.tint}
          clearButtonMode="while-editing"
          {...input}
          style={[s.fieldInput, input.style]}
        />
      </View>
    </ListRow>
  );
}

// ---------------------------------------------------------------------------
// Status and feedback
// ---------------------------------------------------------------------------

/** Inline status message in the content (never a modal alert). */
export function InlineBanner({
  icon,
  tone,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  tone: "success" | "warning" | "neutral";
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const s = useStyles();
  const c = usePalette();
  const iconColor =
    tone === "success" ? c.green : tone === "warning" ? c.yellow : c.secondaryLabel;
  return (
    <View style={s.banner} accessibilityRole={tone === "warning" ? "alert" : undefined}>
      <Icon name={icon} size={22} color={iconColor} />
      <View style={s.bannerText}>
        <Text style={s.bannerTitle}>{title}</Text>
        {body ? <Text style={s.bannerBody}>{body}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Button title={actionLabel} role="plain" size="regular" onPress={onAction} />
      ) : null}
    </View>
  );
}

/** Offline / stale-data notice (R6). */
export function OfflineBanner({
  visible,
  lastUpdatedAt,
  now,
  onRetry,
}: {
  visible: boolean;
  lastUpdatedAt: number | null;
  now: number;
  onRetry?: () => void;
}) {
  if (!visible) return null;
  return (
    <InlineBanner
      icon="offline"
      tone="warning"
      title="Offline"
      body={
        (lastUpdatedAt !== null
          ? `Showing info from ${formatAge(lastUpdatedAt, now)} ago. `
          : "Showing the last saved info. ") + "Waze still works."
      }
      actionLabel={onRetry ? "Retry" : undefined}
      onAction={onRetry}
    />
  );
}

export function LiveBadge() {
  const s = useStyles();
  return (
    <View style={s.live} accessible accessibilityLabel="Live">
      <Text style={s.liveText} maxFontSizeMultiplier={1.4}>
        LIVE
      </Text>
    </View>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <View style={s.screen}>{children}</View>;
}

export function Loading({ label }: { label?: string }) {
  const s = useStyles();
  const c = usePalette();
  return (
    <View style={s.loading}>
      <ActivityIndicator color={c.secondaryLabel} />
      {label ? <Text style={s.loadingText}>{label}</Text> : null}
    </View>
  );
}

/** Contacts-style monogram. Decorative: the row names the person. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const s = useStyles();
  return (
    <View
      style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Text style={[s.avatarText, { fontSize: size * 0.4 }]} allowFontScaling={false}>
        {initials(name)}
      </Text>
    </View>
  );
}

/** Empty or unavailable content, like SwiftUI's ContentUnavailableView. */
export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: IconName;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  const s = useStyles();
  const c = usePalette();
  return (
    <View style={s.empty}>
      <Icon name={icon} size={44} color={c.secondaryLabel} />
      <Text style={s.emptyTitle} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={s.emptyBody}>{body}</Text> : null}
      {children ? <View style={s.emptyAction}>{children}</View> : null}
    </View>
  );
}

/** iOS-style segmented control. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string; done?: boolean }[];
  value: K;
  onChange: (key: K) => void;
}) {
  const s = useStyles();
  return (
    <View style={s.segment} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.done ? `${o.label}, set` : o.label}
            onPress={() => onChange(o.key)}
            style={[s.segmentItem, active && s.segmentItemActive]}
          >
            <Text
              style={[s.segmentText, active && s.segmentTextActive]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.6}
            >
              {o.label}
              {o.done ? " ✓" : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The arrival board's signature: one dot per attendee, filled as they
 * arrive — the logo's dot trail, made of the actual group. Filled vs.
 * hollow carries the state, not colour alone. Large groups get a bar.
 */
export function ArrivalDots({ arrived, total }: { arrived: number; total: number }) {
  const s = useStyles();
  if (total > 30) {
    const pct = total > 0 ? (arrived / total) * 100 : 0;
    return (
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${pct}%` }]} />
      </View>
    );
  }
  return (
    <View
      style={s.dots}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[s.dot, i < arrived ? s.dotOn : s.dotOff]} />
      ))}
    </View>
  );
}

/**
 * Confirm an intentional action. iOS uses an action sheet (HIG › Action
 * sheets: "not an alert"), destructive choice first, Cancel last. Android
 * uses its standard dialog.
 */
export function confirmAction({
  title,
  message,
  confirmLabel,
  destructive = false,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          message,
          options: [confirmLabel, "Cancel"],
          destructiveButtonIndex: destructive ? 0 : undefined,
          cancelButtonIndex: 1,
        },
        (index) => resolve(index === 0),
      );
      return;
    }
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: confirmLabel,
          style: destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

// ---------------------------------------------------------------------------

const useStyles = makeStyles((c) => ({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.s,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
  },
  buttonLarge: { minHeight: 52 },
  buttonRegular: { minHeight: TOUCH_MIN, paddingHorizontal: spacing.l },
  buttonFilled: { backgroundColor: c.tint },
  buttonTinted: { backgroundColor: c.fill },
  buttonPlain: { paddingHorizontal: spacing.m },
  buttonTextLarge: { ...type.headline },
  buttonTextRegular: { ...type.subheadline, fontWeight: "600" },
  group: { marginBottom: spacing.xxl - spacing.s },
  header: {
    ...type.footnote,
    color: c.secondaryLabel,
    textTransform: "uppercase",
    marginHorizontal: ROW_INSET,
    marginBottom: 7,
  },
  headerProminent: {
    ...type.title3,
    color: c.label,
    marginHorizontal: spacing.xs,
    marginTop: spacing.m,
    marginBottom: spacing.s,
  },
  headerCount: { color: c.secondaryLabel, fontWeight: "400" },
  footer: {
    ...type.footnote,
    color: c.secondaryLabel,
    marginHorizontal: ROW_INSET,
    marginTop: 7,
  },
  row: {
    minHeight: TOUCH_MIN,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    paddingHorizontal: ROW_INSET,
    paddingVertical: 11,
    backgroundColor: c.surface,
  },
  rowLeading: { width: 40, alignItems: "center" },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.body, color: c.label },
  rowSubtitle: { ...type.subheadline, color: c.secondaryLabel },
  rowValue: {
    ...type.body,
    color: c.secondaryLabel,
    textAlign: "right",
    flexShrink: 1,
  },
  separator: {
    position: "absolute",
    right: 0,
    bottom: 0,
    height: 0.5,
    backgroundColor: c.separator,
  },
  fieldRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.m },
  fieldLabel: { ...type.body, color: c.label, minWidth: 96 },
  fieldInput: { ...type.body, color: c.label, flex: 1, paddingVertical: 0 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    backgroundColor: c.surface,
    borderRadius: radius.group,
    paddingLeft: ROW_INSET,
    paddingRight: spacing.xs,
    paddingVertical: spacing.m,
  },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { ...type.headline, color: c.label },
  bannerBody: { ...type.subheadline, color: c.secondaryLabel },
  live: {
    backgroundColor: c.green,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  liveText: { ...type.caption2, fontWeight: "800", color: "#000000", letterSpacing: 0.5 },
  screen: { flex: 1, backgroundColor: c.background },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.m,
    backgroundColor: c.background,
  },
  loadingText: { ...type.subheadline, color: c.secondaryLabel },
  avatar: {
    backgroundColor: c.monogram,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#FFFFFF", fontWeight: "600" },
  empty: {
    alignItems: "center",
    paddingVertical: spacing.xxl * 2,
    paddingHorizontal: spacing.xxl,
    gap: spacing.s,
  },
  emptyTitle: { ...type.title2, color: c.label, textAlign: "center", marginTop: spacing.s },
  emptyBody: { ...type.subheadline, color: c.secondaryLabel, textAlign: "center" },
  emptyAction: { marginTop: spacing.m },
  segment: {
    flexDirection: "row",
    backgroundColor: c.fill,
    borderRadius: 10,
    padding: 2,
  },
  segmentItem: {
    flex: 1,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    paddingHorizontal: spacing.s,
  },
  segmentItemActive: {
    backgroundColor: c.surface,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: { ...type.footnote, fontWeight: "500", color: c.label },
  segmentTextActive: { fontWeight: "600" },
  dots: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotOn: { backgroundColor: c.green },
  dotOff: { borderWidth: 1.5, borderColor: c.tertiaryLabel },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: c.fill, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: c.green },
}));

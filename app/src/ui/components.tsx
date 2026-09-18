/**
 * Shared UI for the Night Build.
 *
 * Two rules run through everything here:
 * - State never rides on colour alone. "Arrived" is a filled avatar *and* a
 *   tick *and* a green edge, so it survives glare on a windscreen and every
 *   kind of colour blindness.
 * - Border, fill and shadow are spent by role. Only things that genuinely
 *   float (the live dock, the map sheet) get elevation; everything else is
 *   separated by a hairline.
 *
 * Every tappable meets the 44pt minimum target.
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
  type TextStyle,
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

/**
 * Hairline borders. 0.5 reads as a crisp line on every density we ship to,
 * and unlike StyleSheet.hairlineWidth it never rounds down to 0.
 */
const HAIRLINE = 0.5;

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonRole = "filled" | "tinted" | "plain" | "destructive";

/**
 * Use "filled" for the one action a screen exists for, "tinted" for
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
  size?: "large" | "regular" | "small";
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
    role === "filled"
      ? c.onTint
      : role === "destructive"
        ? c.destructive
        : c.tint;
  const inactive = disabled || loading;
  const iconSize = size === "large" ? 18 : 15;
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
        size === "large" && s.buttonLarge,
        size === "regular" && s.buttonRegular,
        size === "small" && s.buttonSmall,
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
        <Icon name={icon} size={iconSize} color={fg} />
      ) : null}
      <Text
        style={[size === "large" ? s.buttonText : s.buttonTextSmall, { color: fg }]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.6}
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
  role = "tinted",
  size = "small",
  style,
}: {
  lat: number;
  lng: number;
  /** Spoken destination, e.g. "the meetup". */
  place: string;
  label?: string;
  role?: ButtonRole;
  size?: "large" | "regular" | "small";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Button
      title={label}
      role={role}
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
// Structure
// ---------------------------------------------------------------------------

export function Screen({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <View style={s.screen}>{children}</View>;
}

/** A plain surface panel. Nothing floats unless it has a reason to. */
export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  return <View style={[s.card, style]}>{children}</View>;
}

/** Uppercase section label. */
export function Eyebrow({
  title,
  count,
  trailing,
  style,
}: {
  title: string;
  count?: number;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  return (
    <View style={[s.eyebrowRow, style]}>
      <Text style={s.eyebrow} accessibilityRole="header">
        {title}
      </Text>
      {count !== undefined ? (
        <Text style={s.eyebrowCount}>{count}</Text>
      ) : null}
      {trailing}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Grouped lists — kept for the settings-shaped surfaces (car picker, garage
// actions). The run screens use cards instead, so hierarchy can do some work.
// ---------------------------------------------------------------------------

export type RowPosition = "only" | "first" | "middle" | "last";

export function rowPosition(index: number, count: number): RowPosition {
  if (count === 1) return "only";
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
}

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
      {header ? <Eyebrow title={header} /> : null}
      <View style={s.groupBody}>
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
}: {
  title: string;
  count?: number;
}) {
  return <Eyebrow title={title} count={count} />;
}

export function SectionFooter({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <Text style={s.footer}>{children}</Text>;
}

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
  tinted?: boolean;
  /** No padding: content runs edge to edge. */
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
  const inset = leading ? ROW_INSET + 38 + spacing.m : ROW_INSET;

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
    ...(flush
      ? { padding: 0, paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden" }
      : null),
    borderTopLeftRadius: roundTop ? radius.card : 0,
    borderTopRightRadius: roundTop ? radius.card : 0,
    borderBottomLeftRadius: roundBottom ? radius.card : 0,
    borderBottomRightRadius: roundBottom ? radius.card : 0,
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

/** Settings-style inline field row, for the grouped surfaces. */
export function TextFieldRow({
  position,
  label,
  leading,
  trailing,
  ref,
  ...input
}: TextInputProps & {
  position?: RowPosition;
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
          <Text style={s.fieldRowLabel} numberOfLines={1}>
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
          style={[s.fieldRowInput, input.style]}
        />
      </View>
    </ListRow>
  );
}

/**
 * Stacked label-over-value field. A create flow wants room to type, not a
 * preferences row with a fixed label column.
 */
export function TextField({
  label,
  mono,
  hero,
  trailing,
  ref,
  containerStyle,
  ...input
}: TextInputProps & {
  label: string;
  /** Codes and numbers get the mono face. */
  mono?: boolean;
  /** The one field a screen exists for. */
  hero?: boolean;
  trailing?: ReactNode;
  ref?: Ref<TextInput>;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const c = usePalette();
  return (
    <View style={[s.field, containerStyle]}>
      <View style={s.fieldMain}>
        <Text style={s.fieldLabel} numberOfLines={1}>
          {label.toUpperCase()}
        </Text>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={c.placeholder}
          selectionColor={c.tint}
          {...input}
          style={[
            s.fieldInput,
            mono && s.fieldInputMono,
            hero && (mono ? s.fieldInputHeroMono : s.fieldInputHero),
            input.style,
          ]}
        />
      </View>
      {trailing}
    </View>
  );
}

/** Read-only tile that opens a picker — date, time, anything modal. */
export function FieldTile({
  label,
  value,
  onPress,
  style,
  accessibilityHint,
}: {
  label: string;
  value: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const s = useStyles();
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        s.field,
        pressed && { backgroundColor: c.highlight },
        style,
      ]}
    >
      <View style={s.fieldMain}>
        <Text style={s.fieldLabel}>{label.toUpperCase()}</Text>
        <Text style={s.fieldValueMono} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Identity: avatars, plates
// ---------------------------------------------------------------------------

export type AvatarState = "default" | "arrived" | "self";

/** Monogram. Decorative: the row around it names the person. */
export function Avatar({
  name,
  size = 38,
  state = "default",
  style,
}: {
  name: string;
  size?: number;
  state?: AvatarState;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  return (
    <View
      style={[
        s.avatar,
        state === "arrived" && s.avatarArrived,
        state === "self" && s.avatarSelf,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Text
        style={[
          s.avatarText,
          state === "arrived" && s.avatarTextArrived,
          state === "self" && s.avatarTextSelf,
          { fontSize: Math.round(size * 0.36) },
        ]}
        allowFontScaling={false}
      >
        {initials(name)}
      </Text>
    </View>
  );
}

/**
 * Overlapping avatars plus a count. A 50-person group wants to see *who* is
 * coming, not just how many.
 */
export function AvatarStack({
  names,
  selfIndex,
  max = 4,
  caption,
}: {
  names: string[];
  /** Index of the current user, drawn in the accent. */
  selfIndex?: number;
  max?: number;
  /** Trailing text, e.g. "+8 going". */
  caption?: string;
}) {
  const s = useStyles();
  const shown = names.slice(0, max);
  const hidden = names.length - shown.length;
  const label = caption ?? (hidden > 0 ? `+${hidden} going` : null);
  return (
    <View style={s.stack} accessible accessibilityLabel={`${names.length} going`}>
      {shown.map((name, i) => (
        <Avatar
          key={`${name}-${i}`}
          name={name}
          size={28}
          state={i === selfIndex ? "self" : "default"}
          style={[s.stackAvatar, i > 0 && s.stackAvatarOverlap]}
        />
      ))}
      {label ? <Text style={s.stackCaption}>{label}</Text> : null}
    </View>
  );
}

/**
 * The car, typeset like a plate: mono, boxed, uppercase. This is the free-text
 * `carName` from the contract — no new field, no migration, just the cheapest
 * way to make the board read as automotive.
 */
export function Plate({
  name,
  self,
  muted,
}: {
  name: string | null;
  /** The current user's own car. */
  self?: boolean;
  /** For people riding along without a car. */
  muted?: boolean;
}) {
  const s = useStyles();
  if (!name) {
    return (
      <View style={[s.plate, s.plateMuted]}>
        <Text style={[s.plateText, s.plateTextMuted]} numberOfLines={1}>
          RIDING ALONG
        </Text>
      </View>
    );
  }
  return (
    <View style={[s.plate, self && s.plateSelf, muted && s.plateMuted]}>
      <Text
        style={[s.plateText, self && s.plateTextSelf]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.4}
      >
        {name.toUpperCase()}
      </Text>
    </View>
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
  const accent =
    tone === "success" ? c.green : tone === "warning" ? c.yellow : c.secondaryLabel;
  return (
    <View
      style={[s.banner, { borderLeftColor: accent }]}
      accessibilityRole={tone === "warning" ? "alert" : undefined}
    >
      <Icon name={icon} size={20} color={accent} />
      <View style={s.bannerText}>
        <Text style={s.bannerTitle}>{title}</Text>
        {body ? <Text style={s.bannerBody}>{body}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Button title={actionLabel} role="plain" size="small" onPress={onAction} />
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

export function LiveBadge({ style }: { style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return (
    <View style={[s.live, style]} accessible accessibilityLabel="Live">
      <View style={s.liveDot} />
      <Text style={s.liveText} maxFontSizeMultiplier={1.3}>
        LIVE
      </Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const s = useStyles();
  const c = usePalette();
  return (
    <View style={s.loading}>
      <ActivityIndicator color={c.tint} />
      {label ? <Text style={s.loadingText}>{label}</Text> : null}
    </View>
  );
}

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
      <Icon name={icon} size={40} color={c.tertiaryLabel} />
      <Text style={s.emptyTitle} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={s.emptyBody}>{body}</Text> : null}
      {children ? <View style={s.emptyAction}>{children}</View> : null}
    </View>
  );
}

export function Segmented<K extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { key: K; label: string; done?: boolean }[];
  value: K;
  onChange: (key: K) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  return (
    <View style={[s.segment, style]} accessibilityRole="tablist">
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
              maxFontSizeMultiplier={1.4}
            >
              {o.label}
              {o.done ? "  ✓" : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The dot trail — the logo motif, and the app's one piece of signature
 * furniture. One dot per person, filled as they arrive: the convoy, strung
 * out along the road. Filled vs. hollow carries the state, not colour, so it
 * reads in sunlight and without colour vision. Large groups get a bar.
 */
export function ArrivalDots({
  arrived,
  total,
  size = 9,
}: {
  arrived: number;
  total: number;
  size?: number;
}) {
  const s = useStyles();
  if (total > 24) {
    const pct = total > 0 ? Math.round((arrived / total) * 100) : 0;
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
        <View
          key={i}
          style={[
            { width: size, height: size, borderRadius: size / 2 },
            i < arrived ? s.dotOn : s.dotOff,
          ]}
        />
      ))}
    </View>
  );
}

/**
 * Confirm an intentional action. iOS uses an action sheet (destructive choice
 * first, Cancel last); Android uses its standard dialog.
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

const uppercase: TextStyle = { textTransform: "uppercase" };

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.background },

  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.s,
    borderRadius: radius.control,
    paddingHorizontal: spacing.xl,
  },
  buttonLarge: { minHeight: 50 },
  buttonRegular: { minHeight: TOUCH_MIN, paddingHorizontal: spacing.l },
  buttonSmall: {
    minHeight: 36,
    paddingHorizontal: spacing.m,
    borderRadius: radius.chip + 5,
    gap: spacing.xs + 2,
  },
  buttonFilled: { backgroundColor: c.tint },
  buttonTinted: { backgroundColor: c.fill },
  buttonPlain: { paddingHorizontal: spacing.s, minHeight: TOUCH_MIN },
  buttonText: { ...type.button, ...uppercase },
  buttonTextSmall: { ...type.buttonSmall, ...uppercase },

  card: {
    backgroundColor: c.surface,
    borderRadius: radius.card,
    borderWidth: HAIRLINE,
    borderColor: c.separator,
  },

  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    marginBottom: spacing.s,
    paddingHorizontal: spacing.xs,
  },
  eyebrow: { ...type.eyebrow, ...uppercase, color: c.tertiaryLabel },
  eyebrowCount: { ...type.monoSmall, color: c.tertiaryLabel, marginLeft: "auto" },

  group: { marginBottom: spacing.xxl - spacing.s },
  groupBody: {
    borderRadius: radius.card,
    borderWidth: HAIRLINE,
    borderColor: c.separator,
    overflow: "hidden",
  },
  footer: {
    ...type.footnote,
    color: c.tertiaryLabel,
    marginHorizontal: spacing.xs,
    marginTop: spacing.s,
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
  rowLeading: { width: 38, alignItems: "center" },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.bodyMedium, color: c.label },
  rowSubtitle: { ...type.footnote, color: c.secondaryLabel },
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
    height: HAIRLINE,
    backgroundColor: c.separator,
  },

  fieldRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.m },
  fieldRowLabel: { ...type.bodyMedium, color: c.label, minWidth: 92 },
  fieldRowInput: { ...type.body, color: c.label, flex: 1, paddingVertical: 0 },

  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    backgroundColor: c.surface,
    borderRadius: radius.control,
    borderWidth: HAIRLINE,
    borderColor: c.separator,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m - 1,
    minHeight: 62,
  },
  fieldMain: { flex: 1, gap: 2 },
  fieldLabel: { ...type.eyebrow, color: c.tertiaryLabel },
  fieldInput: { ...type.bodyMedium, color: c.label, padding: 0 },
  fieldInputMono: { ...type.mono, fontSize: 16, lineHeight: 21, color: c.label },
  fieldInputHero: { ...type.display3, color: c.label },
  fieldInputHeroMono: {
    ...type.monoLarge,
    fontSize: 21,
    lineHeight: 26,
    letterSpacing: 1.2,
    color: c.label,
  },
  fieldValueMono: { ...type.mono, fontSize: 17, lineHeight: 22, color: c.label },

  avatar: {
    backgroundColor: c.monogram,
    borderWidth: HAIRLINE,
    borderColor: c.separator,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarArrived: { backgroundColor: c.green, borderColor: "transparent" },
  avatarSelf: { backgroundColor: c.tint, borderColor: "transparent" },
  avatarText: { fontFamily: type.title.fontFamily, color: c.secondaryLabel },
  avatarTextArrived: { color: c.background },
  avatarTextSelf: { color: c.onTint },

  stack: { flexDirection: "row", alignItems: "center" },
  stackAvatar: { borderWidth: 2, borderColor: c.surface },
  stackAvatarOverlap: { marginLeft: -9 },
  stackCaption: { ...type.monoSmall, color: c.tertiaryLabel, marginLeft: spacing.s },

  plate: {
    alignSelf: "flex-start",
    borderRadius: radius.chip,
    borderWidth: HAIRLINE,
    borderColor: c.separator,
    backgroundColor: c.surfaceRaised,
    paddingHorizontal: 6,
    paddingVertical: 1,
    maxWidth: 190,
  },
  plateSelf: { borderColor: c.tint },
  plateMuted: { backgroundColor: "transparent" },
  plateText: {
    ...type.monoSmall,
    letterSpacing: 1,
    color: c.secondaryLabel,
  },
  plateTextSelf: { color: c.tint },
  plateTextMuted: { color: c.tertiaryLabel },

  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.m,
    backgroundColor: c.surface,
    borderRadius: radius.control,
    borderWidth: HAIRLINE,
    borderColor: c.separator,
    borderLeftWidth: 3,
    paddingLeft: spacing.m,
    paddingRight: spacing.xs,
    paddingVertical: spacing.m,
  },
  bannerText: { flex: 1, gap: 1 },
  bannerTitle: { ...type.calloutSemi, color: c.label },
  bannerBody: { ...type.footnote, color: c.secondaryLabel },

  live: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: c.green,
    borderRadius: radius.chip,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: c.background,
  },
  liveText: {
    ...type.eyebrow,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.5,
    color: c.background,
  },

  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.m,
    backgroundColor: c.background,
  },
  loadingText: { ...type.footnote, color: c.secondaryLabel },

  empty: {
    alignItems: "center",
    paddingVertical: spacing.xxl * 2,
    paddingHorizontal: spacing.xxl,
    gap: spacing.s,
  },
  emptyTitle: {
    ...type.display3,
    ...uppercase,
    color: c.label,
    textAlign: "center",
    marginTop: spacing.m,
  },
  emptyBody: { ...type.callout, color: c.secondaryLabel, textAlign: "center" },
  emptyAction: { marginTop: spacing.l },

  segment: {
    flexDirection: "row",
    backgroundColor: c.fill,
    borderRadius: radius.control - 3,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.control - 5,
    paddingHorizontal: spacing.s,
  },
  segmentItemActive: { backgroundColor: c.surface },
  segmentText: { ...type.calloutSemi, fontSize: 14, color: c.secondaryLabel },
  segmentTextActive: { color: c.label },

  dots: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  dotOn: { backgroundColor: c.green },
  dotOff: { borderWidth: 1.5, borderColor: c.tertiaryLabel },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: c.fill,
    overflow: "hidden",
    flex: 1,
  },
  barFill: { height: "100%", backgroundColor: c.green, borderRadius: 3 },
}));

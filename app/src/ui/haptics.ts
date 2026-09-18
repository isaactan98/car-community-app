/**
 * System haptics, used sparingly and only with their documented meanings
 * (HIG › Playing haptics): success when a task completes, error when it
 * fails, selection when a choice changes. iOS mutes these when the person
 * turns off System Haptics. Failures are ignored — haptics are never the
 * only feedback.
 */
import * as Haptics from "expo-haptics";

const safe = (p: Promise<void>) => void p.catch(() => {});

export const haptic = {
  success: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  selection: () => safe(Haptics.selectionAsync()),
};

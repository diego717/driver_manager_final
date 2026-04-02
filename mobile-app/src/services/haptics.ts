import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

async function safelyRun(task: () => Promise<void>) {
  if (Platform.OS === "web") return;

  try {
    await task();
  } catch {
    // Progressive enhancement only.
  }
}

export async function triggerSuccessHaptic() {
  await safelyRun(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  );
}

export async function triggerWarningHaptic() {
  await safelyRun(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  );
}

export async function triggerSelectionHaptic() {
  await safelyRun(() => Haptics.selectionAsync());
}

export async function triggerLightImpactHaptic() {
  await safelyRun(() =>
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  );
}

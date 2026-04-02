import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReducedMotion() {
  const [reducedMotionEnabled, setReducedMotionEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;

    const syncState = async () => {
      try {
        const enabled =
          typeof AccessibilityInfo.isReduceMotionEnabled === "function"
            ? await AccessibilityInfo.isReduceMotionEnabled()
            : false;
        if (mounted) setReducedMotionEnabled(Boolean(enabled));
      } catch {
        if (mounted) setReducedMotionEnabled(false);
      }
    };

    void syncState();

    const subscription =
      typeof AccessibilityInfo.addEventListener === "function"
        ? AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
            setReducedMotionEnabled(Boolean(enabled));
          })
        : null;

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  return reducedMotionEnabled;
}

import { getAppPalette } from "@/src/theme/design-tokens";

const light = getAppPalette("light");
const dark = getAppPalette("dark");

export default {
  light: {
    text: light.textPrimary,
    background: light.screenBg,
    tint: light.primaryButtonBg,
    tabIconDefault: light.textMuted,
    tabIconSelected: light.primaryButtonBg,
  },
  dark: {
    text: dark.textPrimary,
    background: dark.screenBg,
    tint: dark.primaryButtonBg,
    tabIconDefault: dark.textMuted,
    tabIconSelected: dark.primaryButtonBg,
  },
};

import { useMemo } from "react";
import type { Theme } from "@react-navigation/native";

import { useThemePreference } from "./theme-preference";

export type AppThemeScheme = "light" | "dark";

interface ThemeTokens {
  bgPrimary: string;
  bgSecondary: string;
  bgCard: string;
  bgHover: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  accentPrimary: string;
  accentSecondary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  border: string;
  sidebarActiveBg: string;
  sidebarActiveText: string;
  panelInfo: string;
  panelSuccess: string;
  panelWarning: string;
  panelError: string;
  modalOverlay: string;
  ambientPrimary: string;
  ambientSecondary: string;
  ambientTertiary: string;
  heroBg: string;
  heroBorder: string;
  heroEyebrowBg: string;
  heroEyebrowText: string;
  headerSurface: string;
  tabBarSurface: string;
  shadowColor: string;
}

export interface AppPalette {
  screenBg: string;
  surface: string;
  surfaceAlt: string;
  hoverBg: string;
  border: string;
  accent: string;
  accentSoft: string;
  title: string;
  subtitle: string;
  hint: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  label: string;
  inputBg: string;
  inputBorder: string;
  placeholder: string;
  cardBg: string;
  cardBorder: string;
  cardText: string;
  chipBg: string;
  chipBorder: string;
  chipText: string;
  chipSelectedBg: string;
  chipSelectedBorder: string;
  chipSelectedText: string;
  refreshBg: string;
  refreshText: string;
  buttonBg: string;
  buttonBorder: string;
  buttonText: string;
  backBg: string;
  primaryButtonBg: string;
  primaryButtonText: string;
  secondaryButtonBg: string;
  secondaryButtonText: string;
  secondaryBg: string;
  secondaryText: string;
  warningBg: string;
  warningText: string;
  uploadButtonBg: string;
  uploadButtonText: string;
  feedbackBg: string;
  feedbackBorder: string;
  feedbackText: string;
  error: string;
  errorBg: string;
  errorBorder: string;
  errorText: string;
  successBg: string;
  successBorder: string;
  successText: string;
  infoBg: string;
  infoBorder: string;
  infoText: string;
  cameraBorder: string;
  itemBg: string;
  itemBorder: string;
  loadingSpinner: string;
  processingSpinner: string;
  previewLink: string;
  previewPlaceholder: string;
  optionalCardBg: string;
  optionalCardBorder: string;
  optionalCardTitle: string;
  optionalCardBody: string;
  optionalToggleBg: string;
  optionalToggleBorder: string;
  optionalToggleText: string;
  themeChipBg: string;
  themeChipBorder: string;
  linkBg: string;
  linkBorder: string;
  linkText: string;
  subtleBg: string;
  selectedBg: string;
  selectedText: string;
  severityBg: string;
  severityBorder: string;
  severityLabel: string;
  severityCriteria: string;
  severitySelectedBg: string;
  severitySelectedBorder: string;
  severitySelectedLabel: string;
  severitySelectedCriteria: string;
  overlayBg: string;
  ambientPrimary: string;
  ambientSecondary: string;
  ambientTertiary: string;
  heroBg: string;
  heroBorder: string;
  heroEyebrowBg: string;
  heroEyebrowText: string;
  heroTitle: string;
  heroText: string;
  headerSurface: string;
  tabBarSurface: string;
  navActiveBg: string;
  navActiveText: string;
  shadowColor: string;
}

const TOKENS: Record<AppThemeScheme, ThemeTokens> = {
  light: {
    bgPrimary: "#edf3f9",
    bgSecondary: "#f8fbff",
    bgCard: "#e4eef8",
    bgHover: "#d8e6f2",
    textPrimary: "#101a28",
    textSecondary: "#324860",
    textMuted: "#516c86",
    textInverse: "#f8fbff",
    accentPrimary: "#0ba6a6",
    accentSecondary: "#ff8a00",
    success: "#138a5a",
    warning: "#8f4700",
    error: "#b03030",
    info: "#1d71d8",
    border: "#a6bfd4",
    sidebarActiveBg: "rgba(11, 166, 166, 0.18)",
    sidebarActiveText: "#0a6d6d",
    panelInfo: "rgba(29, 113, 216, 0.16)",
    panelSuccess: "rgba(19, 138, 90, 0.16)",
    panelWarning: "rgba(255, 138, 0, 0.18)",
    panelError: "rgba(203, 63, 63, 0.16)",
    modalOverlay: "rgba(6, 13, 22, 0.58)",
    ambientPrimary: "rgba(11, 166, 166, 0.17)",
    ambientSecondary: "rgba(255, 138, 0, 0.1)",
    ambientTertiary: "rgba(29, 113, 216, 0.09)",
    heroBg: "rgba(248, 251, 255, 0.96)",
    heroBorder: "rgba(11, 166, 166, 0.34)",
    heroEyebrowBg: "rgba(11, 166, 166, 0.12)",
    heroEyebrowText: "#09595a",
    headerSurface: "rgba(244, 249, 255, 0.98)",
    tabBarSurface: "rgba(245, 250, 255, 0.98)",
    shadowColor: "#05101a",
  },
  dark: {
    bgPrimary: "#151626",
    bgSecondary: "#071a2a",
    bgCard: "#0d2234",
    bgHover: "#17344a",
    textPrimary: "#ecf5ff",
    textSecondary: "#b8c8d8",
    textMuted: "#7f95ab",
    textInverse: "#061a16",
    accentPrimary: "#9af2bd",
    accentSecondary: "#6ecaff",
    success: "#9af2bd",
    warning: "#ffc76a",
    error: "#ff9d73",
    info: "#9bc5ff",
    border: "#69cdb3",
    sidebarActiveBg: "rgba(154, 242, 189, 0.2)",
    sidebarActiveText: "#d9fff0",
    panelInfo: "rgba(155, 197, 255, 0.2)",
    panelSuccess: "rgba(154, 242, 189, 0.2)",
    panelWarning: "rgba(255, 199, 106, 0.2)",
    panelError: "rgba(255, 157, 115, 0.2)",
    modalOverlay: "rgba(2, 6, 12, 0.82)",
    ambientPrimary: "rgba(255, 190, 112, 0.08)",
    ambientSecondary: "rgba(154, 242, 189, 0.07)",
    ambientTertiary: "rgba(110, 202, 255, 0.08)",
    heroBg: "rgba(6, 26, 41, 0.9)",
    heroBorder: "rgba(105, 205, 179, 0.82)",
    heroEyebrowBg: "rgba(154, 242, 189, 0.16)",
    heroEyebrowText: "#d9fff0",
    headerSurface: "rgba(5, 18, 30, 0.97)",
    tabBarSurface: "rgba(6, 19, 31, 0.98)",
    shadowColor: "#00070f",
  },
};

function createPalette(tokens: ThemeTokens): AppPalette {
  return {
    screenBg: tokens.bgPrimary,
    surface: tokens.bgSecondary,
    surfaceAlt: tokens.bgCard,
    hoverBg: tokens.bgHover,
    border: tokens.border,
    accent: tokens.accentPrimary,
    accentSoft: tokens.accentSecondary,
    title: tokens.textPrimary,
    subtitle: tokens.textSecondary,
    hint: tokens.textMuted,
    textPrimary: tokens.textPrimary,
    textSecondary: tokens.textSecondary,
    textMuted: tokens.textMuted,
    label: tokens.textPrimary,
    inputBg: tokens.bgSecondary,
    inputBorder: tokens.border,
    placeholder: tokens.textMuted,
    cardBg: tokens.bgSecondary,
    cardBorder: tokens.border,
    cardText: tokens.textPrimary,
    chipBg: tokens.bgCard,
    chipBorder: tokens.border,
    chipText: tokens.textSecondary,
    chipSelectedBg: tokens.accentPrimary,
    chipSelectedBorder: tokens.accentPrimary,
    chipSelectedText: tokens.textInverse,
    refreshBg: tokens.bgSecondary,
    refreshText: tokens.textPrimary,
    buttonBg: tokens.bgSecondary,
    buttonBorder: tokens.border,
    buttonText: tokens.textPrimary,
    backBg: tokens.bgHover,
    primaryButtonBg: tokens.accentPrimary,
    primaryButtonText: tokens.textInverse,
    secondaryButtonBg: tokens.bgCard,
    secondaryButtonText: tokens.textPrimary,
    secondaryBg: tokens.bgCard,
    secondaryText: tokens.textPrimary,
    warningBg: tokens.panelWarning,
    warningText: tokens.warning,
    uploadButtonBg: tokens.accentPrimary,
    uploadButtonText: tokens.textInverse,
    feedbackBg: tokens.panelInfo,
    feedbackBorder: tokens.info,
    feedbackText: tokens.textPrimary,
    error: tokens.error,
    errorBg: tokens.panelError,
    errorBorder: tokens.error,
    errorText: tokens.error,
    successBg: tokens.panelSuccess,
    successBorder: tokens.success,
    successText: tokens.success,
    infoBg: tokens.panelInfo,
    infoBorder: tokens.info,
    infoText: tokens.info,
    cameraBorder: tokens.border,
    itemBg: tokens.bgCard,
    itemBorder: tokens.border,
    loadingSpinner: tokens.accentPrimary,
    processingSpinner: tokens.accentPrimary,
    previewLink: tokens.accentPrimary,
    previewPlaceholder: tokens.bgCard,
    optionalCardBg: tokens.bgSecondary,
    optionalCardBorder: tokens.border,
    optionalCardTitle: tokens.textPrimary,
    optionalCardBody: tokens.textSecondary,
    optionalToggleBg: tokens.bgCard,
    optionalToggleBorder: tokens.border,
    optionalToggleText: tokens.textPrimary,
    themeChipBg: tokens.bgSecondary,
    themeChipBorder: tokens.border,
    linkBg: tokens.bgSecondary,
    linkBorder: tokens.border,
    linkText: tokens.accentPrimary,
    subtleBg: tokens.bgHover,
    selectedBg: tokens.accentPrimary,
    selectedText: tokens.textInverse,
    severityBg: tokens.bgSecondary,
    severityBorder: tokens.border,
    severityLabel: tokens.textPrimary,
    severityCriteria: tokens.textSecondary,
    severitySelectedBg: tokens.sidebarActiveBg,
    severitySelectedBorder: tokens.accentPrimary,
    severitySelectedLabel: tokens.sidebarActiveText,
    severitySelectedCriteria: tokens.textSecondary,
    overlayBg: tokens.modalOverlay,
    ambientPrimary: tokens.ambientPrimary,
    ambientSecondary: tokens.ambientSecondary,
    ambientTertiary: tokens.ambientTertiary,
    heroBg: tokens.heroBg,
    heroBorder: tokens.heroBorder,
    heroEyebrowBg: tokens.heroEyebrowBg,
    heroEyebrowText: tokens.heroEyebrowText,
    heroTitle: tokens.textPrimary,
    heroText: tokens.textSecondary,
    headerSurface: tokens.headerSurface,
    tabBarSurface: tokens.tabBarSurface,
    navActiveBg: tokens.sidebarActiveBg,
    navActiveText: tokens.sidebarActiveText,
    shadowColor: tokens.shadowColor,
  };
}

const PALETTES: Record<AppThemeScheme, AppPalette> = {
  light: createPalette(TOKENS.light),
  dark: createPalette(TOKENS.dark),
};

export function getAppPalette(scheme: AppThemeScheme): AppPalette {
  return PALETTES[scheme];
}

export function useAppPalette(): AppPalette {
  const { resolvedScheme } = useThemePreference();
  return useMemo(() => getAppPalette(resolvedScheme), [resolvedScheme]);
}

export function getExpoColorSet(scheme: AppThemeScheme): {
  text: string;
  background: string;
  tint: string;
  tabIconDefault: string;
  tabIconSelected: string;
} {
  const palette = getAppPalette(scheme);
  return {
    text: palette.textPrimary,
    background: palette.screenBg,
    tint: palette.accent,
    tabIconDefault: palette.textMuted,
    tabIconSelected: palette.accent,
  };
}

export function getNavigationTheme(scheme: AppThemeScheme): Theme {
  const navigation = require("@react-navigation/native") as {
    DarkTheme: Theme;
    DefaultTheme: Theme;
  };
  const baseTheme = scheme === "dark" ? navigation.DarkTheme : navigation.DefaultTheme;
  const palette = getAppPalette(scheme);
  return {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      primary: palette.accent,
      background: palette.screenBg,
      card: palette.headerSurface,
      text: palette.textPrimary,
      border: palette.border,
      notification: palette.error,
    },
  };
}

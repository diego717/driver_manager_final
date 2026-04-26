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
    bgPrimary: "#fbeabe",
    bgSecondary: "#fbf5e6",
    bgCard: "#f5efd8",
    bgHover: "#e8deb9",
    textPrimary: "#201910",
    textSecondary: "#433c31",
    textMuted: "#6b5f4d",
    textInverse: "#201910",
    accentPrimary: "#dd9730",
    accentSecondary: "#c09473",
    success: "#dd9730",
    warning: "#fe8c2c",
    error: "#e6443d",
    info: "#80796d",
    border: "#bd6109",
    sidebarActiveBg: "rgba(221, 151, 48, 0.14)",
    sidebarActiveText: "#5f3000",
    panelInfo: "rgba(128, 121, 109, 0.16)",
    panelSuccess: "rgba(221, 151, 48, 0.16)",
    panelWarning: "rgba(254, 140, 44, 0.18)",
    panelError: "rgba(230, 68, 61, 0.16)",
    modalOverlay: "rgba(9, 14, 22, 0.62)",
    ambientPrimary: "rgba(254, 140, 44, 0.22)",
    ambientSecondary: "rgba(221, 151, 48, 0.18)",
    ambientTertiary: "rgba(192, 148, 115, 0.12)",
    heroBg: "rgba(251, 245, 230, 0.96)",
    heroBorder: "rgba(221, 151, 48, 0.34)",
    heroEyebrowBg: "rgba(221, 151, 48, 0.12)",
    heroEyebrowText: "#5f3000",
    headerSurface: "rgba(251, 245, 230, 0.98)",
    tabBarSurface: "rgba(248, 241, 227, 0.98)",
    shadowColor: "#1b1207",
  },
  dark: {
    bgPrimary: "#110d05",
    bgSecondary: "#18130c",
    bgCard: "#231f17",
    bgHover: "#352f25",
    textPrimary: "#f1eee7",
    textSecondary: "#d6d0c5",
    textMuted: "#b8ad99",
    textInverse: "#22180b",
    accentPrimary: "#ffba4a",
    accentSecondary: "#f5b076",
    success: "#ffba4a",
    warning: "#ffad34",
    error: "#ff8068",
    info: "#bcb7ad",
    border: "#cc780d",
    sidebarActiveBg: "rgba(255, 186, 74, 0.22)",
    sidebarActiveText: "#ffe5ab",
    panelInfo: "rgba(188, 183, 173, 0.2)",
    panelSuccess: "rgba(255, 186, 74, 0.2)",
    panelWarning: "rgba(255, 173, 52, 0.2)",
    panelError: "rgba(255, 128, 104, 0.2)",
    modalOverlay: "rgba(2, 6, 14, 0.84)",
    ambientPrimary: "rgba(255, 173, 52, 0.24)",
    ambientSecondary: "rgba(255, 186, 74, 0.24)",
    ambientTertiary: "rgba(245, 176, 118, 0.22)",
    heroBg: "rgba(24, 19, 12, 0.9)",
    heroBorder: "rgba(255, 186, 74, 0.82)",
    heroEyebrowBg: "rgba(255, 186, 74, 0.16)",
    heroEyebrowText: "#ffe5ab",
    headerSurface: "rgba(17, 13, 5, 0.97)",
    tabBarSurface: "rgba(24, 19, 12, 0.98)",
    shadowColor: "#000000",
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

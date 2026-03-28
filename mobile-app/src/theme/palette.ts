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
    bgPrimary: "#eaf0f2",
    bgSecondary: "#f8fbfc",
    bgCard: "#e3ebee",
    bgHover: "#d6e1e6",
    textPrimary: "#142129",
    textSecondary: "#50626d",
    textMuted: "#72848e",
    textInverse: "#ffffff",
    accentPrimary: "#0d766e",
    accentSecondary: "#5a819d",
    success: "#2f6c50",
    warning: "#8c5a12",
    error: "#9a3530",
    info: "#275d86",
    border: "#c8d4d9",
    sidebarActiveBg: "rgba(13, 118, 110, 0.13)",
    sidebarActiveText: "#0a5d57",
    panelInfo: "rgba(39, 93, 134, 0.12)",
    panelSuccess: "rgba(47, 108, 80, 0.12)",
    panelWarning: "rgba(140, 90, 18, 0.14)",
    panelError: "rgba(154, 53, 48, 0.14)",
    modalOverlay: "rgba(10, 20, 28, 0.44)",
    ambientPrimary: "rgba(13, 118, 110, 0.1)",
    ambientSecondary: "rgba(90, 129, 157, 0.08)",
    ambientTertiary: "rgba(39, 93, 134, 0.06)",
    heroBg: "rgba(248, 251, 252, 0.96)",
    heroBorder: "rgba(13, 118, 110, 0.18)",
    heroEyebrowBg: "rgba(13, 118, 110, 0.08)",
    heroEyebrowText: "#0a5d57",
    headerSurface: "rgba(248, 251, 252, 0.98)",
    tabBarSurface: "rgba(248, 251, 252, 0.96)",
    shadowColor: "#0f1b22",
  },
  dark: {
    bgPrimary: "#11181d",
    bgSecondary: "#172127",
    bgCard: "#23313a",
    bgHover: "#2a3942",
    textPrimary: "#edf4f6",
    textSecondary: "#b1c0c7",
    textMuted: "#8ea0a9",
    textInverse: "#11161c",
    accentPrimary: "#33a39a",
    accentSecondary: "#65a2d1",
    success: "#66b08c",
    warning: "#d29a3d",
    error: "#f1b8b1",
    info: "#65a2d1",
    border: "#32434b",
    sidebarActiveBg: "rgba(51, 163, 154, 0.18)",
    sidebarActiveText: "#97d7d1",
    panelInfo: "rgba(101, 162, 209, 0.16)",
    panelSuccess: "rgba(102, 176, 140, 0.16)",
    panelWarning: "rgba(210, 154, 61, 0.18)",
    panelError: "rgba(221, 116, 107, 0.18)",
    modalOverlay: "rgba(4, 10, 14, 0.72)",
    ambientPrimary: "rgba(51, 163, 154, 0.12)",
    ambientSecondary: "rgba(101, 162, 209, 0.08)",
    ambientTertiary: "rgba(102, 176, 140, 0.06)",
    heroBg: "rgba(23, 33, 39, 0.98)",
    heroBorder: "rgba(51, 163, 154, 0.22)",
    heroEyebrowBg: "rgba(51, 163, 154, 0.14)",
    heroEyebrowText: "#97d7d1",
    headerSurface: "rgba(20, 29, 35, 0.98)",
    tabBarSurface: "rgba(23, 33, 39, 0.98)",
    shadowColor: "#020608",
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
    chipSelectedText: "#ffffff",
    refreshBg: tokens.bgSecondary,
    refreshText: tokens.textPrimary,
    buttonBg: tokens.bgSecondary,
    buttonBorder: tokens.border,
    buttonText: tokens.textPrimary,
    backBg: tokens.bgHover,
    primaryButtonBg: tokens.accentPrimary,
    primaryButtonText: "#ffffff",
    secondaryButtonBg: tokens.bgCard,
    secondaryButtonText: tokens.textPrimary,
    secondaryBg: tokens.bgCard,
    secondaryText: tokens.textPrimary,
    warningBg: tokens.panelWarning,
    warningText: tokens.warning,
    uploadButtonBg: tokens.accentPrimary,
    uploadButtonText: "#ffffff",
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
    selectedText: "#ffffff",
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

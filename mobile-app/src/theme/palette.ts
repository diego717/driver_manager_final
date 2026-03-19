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
    bgPrimary: "#eef4f6",
    bgSecondary: "#fbfdfe",
    bgCard: "#e7eef1",
    bgHover: "#d7e2e7",
    textPrimary: "#17232d",
    textSecondary: "#4a5f70",
    textMuted: "#708292",
    textInverse: "#ffffff",
    accentPrimary: "#0f8b84",
    accentSecondary: "#48b89d",
    success: "#0f9968",
    warning: "#8f570a",
    error: "#b42318",
    info: "#2563eb",
    border: "#c7d6dd",
    sidebarActiveBg: "rgba(15, 139, 132, 0.14)",
    sidebarActiveText: "#0f7f79",
    panelInfo: "rgba(37, 99, 235, 0.12)",
    panelSuccess: "rgba(15, 153, 104, 0.12)",
    panelWarning: "rgba(143, 87, 10, 0.16)",
    panelError: "rgba(180, 35, 24, 0.14)",
    modalOverlay: "rgba(10, 20, 28, 0.44)",
    ambientPrimary: "rgba(15, 139, 132, 0.16)",
    ambientSecondary: "rgba(72, 184, 157, 0.12)",
    ambientTertiary: "rgba(37, 99, 235, 0.08)",
    heroBg: "rgba(251, 253, 254, 0.94)",
    heroBorder: "rgba(15, 139, 132, 0.18)",
    heroEyebrowBg: "rgba(15, 139, 132, 0.1)",
    heroEyebrowText: "#0f7f79",
    headerSurface: "rgba(248, 251, 252, 0.96)",
    tabBarSurface: "rgba(251, 253, 254, 0.94)",
    shadowColor: "#10202d",
  },
  dark: {
    bgPrimary: "#11161c",
    bgSecondary: "#182229",
    bgCard: "#223039",
    bgHover: "#2a3d47",
    textPrimary: "#ecf4f5",
    textSecondary: "#b1c2c8",
    textMuted: "#869aa3",
    textInverse: "#11161c",
    accentPrimary: "#4fd2c2",
    accentSecondary: "#8de0be",
    success: "#10b981",
    warning: "#f7c45b",
    error: "#fca5a5",
    info: "#3b82f6",
    border: "#34515d",
    sidebarActiveBg: "rgba(79, 210, 194, 0.2)",
    sidebarActiveText: "#9af0e0",
    panelInfo: "rgba(59, 130, 246, 0.15)",
    panelSuccess: "rgba(16, 185, 129, 0.15)",
    panelWarning: "rgba(247, 196, 91, 0.18)",
    panelError: "rgba(248, 113, 113, 0.18)",
    modalOverlay: "rgba(4, 10, 14, 0.72)",
    ambientPrimary: "rgba(79, 210, 194, 0.18)",
    ambientSecondary: "rgba(141, 224, 190, 0.12)",
    ambientTertiary: "rgba(59, 130, 246, 0.1)",
    heroBg: "rgba(24, 34, 41, 0.96)",
    heroBorder: "rgba(79, 210, 194, 0.2)",
    heroEyebrowBg: "rgba(79, 210, 194, 0.14)",
    heroEyebrowText: "#9af0e0",
    headerSurface: "rgba(21, 29, 36, 0.98)",
    tabBarSurface: "rgba(24, 34, 41, 0.96)",
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

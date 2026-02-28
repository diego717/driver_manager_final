export type AppScheme = "light" | "dark";

export type AppPalette = {
  screenBg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  label: string;
  inputBg: string;
  inputBorder: string;
  placeholder: string;
  feedbackBg: string;
  feedbackBorder: string;
  feedbackText: string;
  cardBg: string;
  cardBorder: string;
  itemBg: string;
  itemBorder: string;
  chipBg: string;
  chipBorder: string;
  chipText: string;
  chipSelectedBg: string;
  chipSelectedBorder: string;
  chipSelectedText: string;
  buttonBg: string;
  buttonBorder: string;
  buttonText: string;
  backBg: string;
  refreshBg: string;
  refreshText: string;
  secondaryBg: string;
  secondaryText: string;
  primaryButtonBg: string;
  primaryButtonText: string;
  secondaryButtonBg: string;
  secondaryButtonText: string;
  uploadButtonBg: string;
  uploadButtonText: string;
  previewLink: string;
  previewPlaceholder: string;
  subtleBg: string;
  loadingSpinner: string;
  hint: string;
  warning: string;
  success: string;
  severityBg: string;
  severityBorder: string;
  severityLabel: string;
  severityCriteria: string;
  severitySelectedBg: string;
  severitySelectedBorder: string;
  severitySelectedLabel: string;
  severitySelectedCriteria: string;
  optionalCardBg: string;
  optionalCardBorder: string;
  optionalCardTitle: string;
  optionalCardBody: string;
  optionalToggleBg: string;
  optionalToggleBorder: string;
  optionalToggleText: string;
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

const lightPalette: AppPalette = {
  screenBg: "#F8FAFC",
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  textMuted: "#64748B",
  label: "#1E293B",
  inputBg: "#FFFFFF",
  inputBorder: "#CBD5E1",
  placeholder: "#808080",
  feedbackBg: "#F0F9FF",
  feedbackBorder: "#BAE6FD",
  feedbackText: "#0C4A6E",
  cardBg: "#FFFFFF",
  cardBorder: "#CBD5E1",
  itemBg: "#F8FAFC",
  itemBorder: "#E2E8F0",
  chipBg: "#F8FAFC",
  chipBorder: "#CBD5E1",
  chipText: "#334155",
  chipSelectedBg: "#0B7A75",
  chipSelectedBorder: "#0B7A75",
  chipSelectedText: "#FFFFFF",
  buttonBg: "#FFFFFF",
  buttonBorder: "#CBD5E1",
  buttonText: "#0F172A",
  backBg: "#E2E8F0",
  refreshBg: "#FFFFFF",
  refreshText: "#0F172A",
  secondaryBg: "#FFFFFF",
  secondaryText: "#0F172A",
  primaryButtonBg: "#0B7A75",
  primaryButtonText: "#FFFFFF",
  secondaryButtonBg: "#2563EB",
  secondaryButtonText: "#FFFFFF",
  uploadButtonBg: "#0B7A75",
  uploadButtonText: "#FFFFFF",
  previewLink: "#0E7490",
  previewPlaceholder: "#CBD5E1",
  subtleBg: "#E2E8F0",
  loadingSpinner: "#0B7A75",
  hint: "#64748B",
  warning: "#B91C1C",
  success: "#047857",
  severityBg: "#FFFFFF",
  severityBorder: "#CBD5E1",
  severityLabel: "#0F172A",
  severityCriteria: "#475569",
  severitySelectedBg: "#ECFEFF",
  severitySelectedBorder: "#0B7A75",
  severitySelectedLabel: "#0F766E",
  severitySelectedCriteria: "#155E75",
  optionalCardBg: "#F8FAFC",
  optionalCardBorder: "#CBD5E1",
  optionalCardTitle: "#0F172A",
  optionalCardBody: "#475569",
  optionalToggleBg: "#FFFFFF",
  optionalToggleBorder: "#CBD5E1",
  optionalToggleText: "#0F172A",
};

const darkPalette: AppPalette = {
  screenBg: "#020617",
  textPrimary: "#E2E8F0",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  label: "#CBD5E1",
  inputBg: "#111827",
  inputBorder: "#334155",
  placeholder: "#64748B",
  feedbackBg: "#082F49",
  feedbackBorder: "#0369A1",
  feedbackText: "#BAE6FD",
  cardBg: "#0F172A",
  cardBorder: "#334155",
  itemBg: "#111827",
  itemBorder: "#334155",
  chipBg: "#111827",
  chipBorder: "#334155",
  chipText: "#CBD5E1",
  chipSelectedBg: "#0B7A75",
  chipSelectedBorder: "#0B7A75",
  chipSelectedText: "#FFFFFF",
  buttonBg: "#0F172A",
  buttonBorder: "#334155",
  buttonText: "#CBD5E1",
  backBg: "#1E293B",
  refreshBg: "#0F172A",
  refreshText: "#CBD5E1",
  secondaryBg: "#0F172A",
  secondaryText: "#CBD5E1",
  primaryButtonBg: "#0F766E",
  primaryButtonText: "#FFFFFF",
  secondaryButtonBg: "#2563EB",
  secondaryButtonText: "#FFFFFF",
  uploadButtonBg: "#0F766E",
  uploadButtonText: "#FFFFFF",
  previewLink: "#22D3EE",
  previewPlaceholder: "#334155",
  subtleBg: "#1E293B",
  loadingSpinner: "#14B8A6",
  hint: "#94A3B8",
  warning: "#FCA5A5",
  success: "#34D399",
  severityBg: "#0F172A",
  severityBorder: "#334155",
  severityLabel: "#E2E8F0",
  severityCriteria: "#94A3B8",
  severitySelectedBg: "#0C4A4A",
  severitySelectedBorder: "#0EA5A4",
  severitySelectedLabel: "#99F6E4",
  severitySelectedCriteria: "#67E8F9",
  optionalCardBg: "#0F172A",
  optionalCardBorder: "#334155",
  optionalCardTitle: "#E2E8F0",
  optionalCardBody: "#94A3B8",
  optionalToggleBg: "#1E293B",
  optionalToggleBorder: "#334155",
  optionalToggleText: "#CBD5E1",
};

const palettes: Record<AppScheme, AppPalette> = {
  light: lightPalette,
  dark: darkPalette,
};

export function getAppPalette(scheme: AppScheme): AppPalette {
  return palettes[scheme];
}

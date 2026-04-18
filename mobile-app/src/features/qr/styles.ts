import { StyleSheet } from "react-native";

import { radii, spacing } from "@/src/theme/layout";
import { fontFamilies } from "@/src/theme/typography";

import { MIN_TOUCH_TARGET_SIZE } from "./shared";

export const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    padding: spacing.s20,
    alignItems: "center",
    justifyContent: "center",
  },
  authHintText: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  contentContainer: {
    padding: spacing.s20,
    gap: spacing.s12,
    paddingBottom: 40,
  },
  heroBadge: {
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s7,
  },
  heroBadgeText: {
    fontFamily: fontFamilies.bold,
    fontSize: 11.5,
    letterSpacing: 0.3,
  },
  heroMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s8,
  },
  heroMetaChip: {
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s7,
  },
  heroMetaText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 12,
  },
  modeHint: {
    marginTop: -2,
    marginBottom: spacing.s2,
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  formCard: {
    borderWidth: 1,
    borderRadius: radii.r14,
    paddingHorizontal: spacing.s14,
    paddingVertical: spacing.s12,
    gap: spacing.s8,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: fontFamilies.bold,
  },
  typeRow: {
    flexDirection: "row",
    gap: spacing.s8,
  },
  presetRow: {
    flexDirection: "row",
    gap: spacing.s8,
  },
  typeButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radii.r10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  typeButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  presetButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radii.r10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  presetButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  label: {
    fontSize: 13,
    fontFamily: fontFamilies.semibold,
    marginTop: spacing.s6,
  },
  input: {
    borderWidth: 1,
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
  },
  notesInput: {
    minHeight: 84,
  },
  inlineButton: {
    borderRadius: radii.r10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s10,
    marginTop: spacing.s6,
  },
  inlineButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  helperText: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
    marginTop: spacing.s2,
  },
  mainActionRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.s8,
  },
  button: {
    borderRadius: radii.r10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s12,
  },
  mainActionPrimary: {
    flex: 1,
  },
  mainActionSecondary: {
    minWidth: 112,
    borderWidth: 1,
    paddingHorizontal: spacing.s12,
  },
  secondaryButton: {
    borderRadius: radii.r10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s12,
  },
  buttonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
  },
  errorText: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  previewCard: {
    alignItems: "center",
    gap: spacing.s8,
  },
  payloadText: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
    textAlign: "center",
  },
  detailsText: {
    width: "100%",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamilies.regular,
  },
  hiddenLabelRenderer: {
    position: "absolute",
    left: -10000,
    top: -10000,
    opacity: 0,
  },
});

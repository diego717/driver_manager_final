import { StyleSheet } from "react-native";

import { fontFamilies } from "@/src/theme/typography";

import { MIN_TOUCH_TARGET_SIZE } from "./shared";

export const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  authHintText: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  contentContainer: {
    padding: 20,
    gap: 12,
    paddingBottom: 40,
  },
  heroBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  heroBadgeText: {
    fontFamily: fontFamilies.bold,
    fontSize: 11.5,
    letterSpacing: 0.3,
  },
  heroMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  heroMetaChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  heroMetaText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 12,
  },
  modeHint: {
    marginTop: -2,
    marginBottom: 2,
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  formCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: fontFamilies.bold,
  },
  typeRow: {
    flexDirection: "row",
    gap: 8,
  },
  presetRow: {
    flexDirection: "row",
    gap: 8,
  },
  typeButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
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
    borderRadius: 10,
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
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  notesInput: {
    minHeight: 84,
  },
  inlineButton: {
    borderRadius: 10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    marginTop: 6,
  },
  inlineButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  helperText: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
    marginTop: 2,
  },
  mainActionRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },
  button: {
    borderRadius: 10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  mainActionPrimary: {
    flex: 1,
  },
  mainActionSecondary: {
    minWidth: 112,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  secondaryButton: {
    borderRadius: 10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
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
    gap: 8,
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

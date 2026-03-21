import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";
import {
  getIncidentStatusLabel,
  getRecordAttentionStateLabel,
  normalizeIncidentStatus,
  normalizeRecordAttentionState,
} from "@/src/utils/incidents";

type StatusChipKind = "incident" | "attention";

type StatusChipProps = {
  value: unknown;
  kind?: StatusChipKind;
};

export default function StatusChip({ value, kind = "incident" }: StatusChipProps) {
  const palette = useAppPalette();
  const incidentStatus = normalizeIncidentStatus(value);
  const attentionStatus = normalizeRecordAttentionState(value);
  const normalized = kind === "attention" ? attentionStatus : incidentStatus;
  const label =
    kind === "attention" ? getRecordAttentionStateLabel(value) : getIncidentStatusLabel(value);

  let backgroundColor = palette.infoBg;
  let borderColor = palette.infoBorder;
  let color = palette.infoText;

  if (normalized === "critical") {
    backgroundColor = palette.errorBg;
    borderColor = palette.errorBorder;
    color = palette.errorText;
  } else if (normalized === "resolved") {
    backgroundColor = palette.successBg;
    borderColor = palette.successBorder;
    color = palette.successText;
  } else if (normalized === "in_progress") {
    backgroundColor = palette.warningBg;
    borderColor = palette.warningText;
    color = palette.warningText;
  } else if (normalized === "paused") {
    backgroundColor = palette.secondaryButtonBg;
    borderColor = palette.inputBorder;
    color = palette.secondaryButtonText;
  }

  return (
    <View style={[styles.chip, { backgroundColor, borderColor }]}>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    minHeight: 32,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  label: {
    fontFamily: fontFamilies.bold,
    fontSize: 11.5,
    lineHeight: 14,
    letterSpacing: 0.2,
  },
});

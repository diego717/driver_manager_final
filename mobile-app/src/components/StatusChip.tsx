import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text } from "react-native";

import { useReducedMotion } from "@/src/hooks/useReducedMotion";
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
  const reducedMotion = useReducedMotion();
  const incidentStatus = normalizeIncidentStatus(value);
  const attentionStatus = normalizeRecordAttentionState(value);
  const normalized = kind === "attention" ? attentionStatus : incidentStatus;
  const label =
    kind === "attention" ? getRecordAttentionStateLabel(value) : getIncidentStatusLabel(value);
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

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

  useEffect(() => {
    if (reducedMotion) {
      scale.setValue(1);
      opacity.setValue(1);
      return;
    }

    scale.setValue(0.96);
    opacity.setValue(0.72);
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        damping: 14,
        stiffness: 220,
        mass: 0.9,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [label, normalized, opacity, reducedMotion, scale]);

  return (
    <Animated.View
      style={[styles.chip, { backgroundColor, borderColor, opacity, transform: [{ scale }] }]}
    >
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Animated.View>
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

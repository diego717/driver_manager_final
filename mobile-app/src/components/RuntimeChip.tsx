import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { radii, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, typeScale } from "@/src/theme/typography";

type RuntimeChipProps = {
  label: string;
  value: string;
};

export default function RuntimeChip({ label, value }: RuntimeChipProps) {
  const palette = useAppPalette();
  return (
    <View style={[styles.chip, { backgroundColor: palette.itemBg, borderColor: palette.inputBorder }]}>
      <Text style={[styles.label, { color: palette.textMuted }]}>{label}</Text>
      <Text style={[styles.value, { color: palette.textPrimary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: radii.r12,
    borderStyle: "dashed",
    paddingHorizontal: spacing.s12,
    minHeight: 56,
    paddingVertical: spacing.s8,
    justifyContent: "center",
    gap: spacing.s2,
    minWidth: 112,
  },
  label: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMonoTight,
    letterSpacing: 0.75,
    textTransform: "uppercase",
  },
  value: {
    fontFamily: fontFamilies.semibold,
    ...typeScale.bodyCompact,
    fontSize: 14,
  },
});

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

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
    borderRadius: 16,
    paddingHorizontal: 12,
    minHeight: 56,
    paddingVertical: 8,
    justifyContent: "center",
    gap: 2,
    minWidth: 112,
  },
  label: {
    fontFamily: fontFamilies.regular,
    fontSize: 11.5,
    lineHeight: 14,
  },
  value: {
    fontFamily: fontFamilies.bold,
    fontSize: 13,
    lineHeight: 16,
  },
});

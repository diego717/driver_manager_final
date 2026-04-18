import React, { type ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { radii, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

type QuickActionCardProps = {
  title: string;
  body: string;
  actionLabel: string;
  onPress: () => void;
  icon?: ReactNode;
  tone?: "primary" | "secondary";
};

export default function QuickActionCard(props: QuickActionCardProps) {
  const { title, body, actionLabel, onPress, icon, tone = "secondary" } = props;
  const palette = useAppPalette();
  const isPrimary = tone === "primary";

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isPrimary ? palette.heroBg : palette.cardBg,
          borderColor: isPrimary ? palette.heroBorder : palette.cardBorder,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.iconWrap}>{icon}</View>
        <Text style={[styles.title, { color: palette.textPrimary }]}>{title}</Text>
      </View>
      <Text style={[styles.body, { color: palette.textSecondary }]}>{body}</Text>
      <TouchableOpacity
        style={[
          styles.button,
          {
            backgroundColor: isPrimary ? palette.primaryButtonBg : "transparent",
            borderColor: isPrimary ? palette.primaryButtonBg : "transparent",
          },
        ]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
      >
        <Text
          style={[
            styles.buttonText,
            { color: isPrimary ? palette.primaryButtonText : palette.accent },
          ]}
        >
          {isPrimary ? actionLabel : `${actionLabel} →`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: "47%",
    borderWidth: 1,
    borderRadius: radii.r18,
    padding: spacing.s14,
    gap: spacing.s10,
  },
  header: {
    gap: spacing.s8,
  },
  iconWrap: {
    minHeight: 18,
  },
  title: {
    fontFamily: fontFamilies.bold,
    fontSize: 15.5,
    lineHeight: 19,
  },
  body: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    minHeight: sizing.touchTargetMin,
    borderRadius: radii.r14,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 0,
  },
  buttonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 13,
  },
});

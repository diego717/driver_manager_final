import React, { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { radii, shadows, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, typeScale } from "@/src/theme/typography";

type ScreenHeroProps = {
  eyebrow?: string;
  title: string;
  description: string;
  aside?: ReactNode;
  children?: ReactNode;
};

export default function ScreenHero(props: ScreenHeroProps) {
  const { eyebrow, title, description, aside, children } = props;
  const palette = useAppPalette();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: palette.heroBg,
          borderColor: palette.heroBorder,
          shadowColor: palette.shadowColor,
        },
      ]}
    >
      <View
        pointerEvents="none"
        style={[styles.chromeGlow, { backgroundColor: palette.ambientPrimary }]}
      />
      <View
        pointerEvents="none"
        style={[styles.chromeLine, { borderColor: palette.heroBorder }]}
      />
      <View style={styles.topRow}>
        {eyebrow ? (
          <View
            style={[
              styles.eyebrowWrap,
              {
                backgroundColor: palette.heroEyebrowBg,
                borderColor: palette.heroBorder,
              },
            ]}
          >
            <Text style={[styles.eyebrow, { color: palette.heroEyebrowText }]}>{eyebrow}</Text>
          </View>
        ) : (
          <View />
        )}
        {aside}
      </View>

      <Text style={[styles.title, { color: palette.heroTitle }]}>{title}</Text>
      <Text style={[styles.description, { color: palette.heroText }]}>{description}</Text>

      {children ? <View style={styles.footer}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    borderWidth: 1,
    borderRadius: radii.r16,
    paddingHorizontal: spacing.s16,
    paddingVertical: spacing.s16,
    gap: spacing.s10,
    ...shadows.cardMedium,
    overflow: "hidden",
  },
  chromeGlow: {
    position: "absolute",
    width: 260,
    height: 110,
    borderRadius: radii.r20,
    right: -94,
    top: -38,
    opacity: 0.22,
  },
  chromeLine: {
    position: "absolute",
    left: spacing.s14,
    right: spacing.s14,
    top: spacing.s12,
    borderTopWidth: 1,
    borderStyle: "dashed",
    opacity: 0.52,
  },
  topRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s10,
  },
  eyebrowWrap: {
    borderWidth: 1,
    borderRadius: radii.r10,
    borderStyle: "dashed",
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s5,
  },
  eyebrow: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: fontFamilies.display,
    ...typeScale.heroDisplay,
    textTransform: "uppercase",
  },
  description: {
    fontFamily: fontFamilies.regular,
    fontSize: 14,
    lineHeight: 19,
    maxWidth: 520,
  },
  footer: {
    marginTop: spacing.s2,
    gap: spacing.s10,
  },
});

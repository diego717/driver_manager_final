import React, { type ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { useReducedMotion } from "@/src/hooks/useReducedMotion";
import { radii, shadows, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, typeScale } from "@/src/theme/typography";

type SectionCardProps = {
  title: string;
  description?: string;
  aside?: ReactNode;
  children?: ReactNode;
};

export default function SectionCard(props: SectionCardProps) {
  const { title, description, aside, children } = props;
  const palette = useAppPalette();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reducedMotion ? 0 : 10)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, reducedMotion, translateY]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity,
          transform: [{ translateY }],
          backgroundColor: palette.cardBg,
          borderColor: palette.cardBorder,
          shadowColor: palette.shadowColor,
        },
      ]}
    >
      <View pointerEvents="none" style={[styles.accentRail, { backgroundColor: palette.accent }]} />
      <View pointerEvents="none" style={[styles.frameLine, { borderColor: palette.heroBorder }]} />
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: palette.textPrimary }]}>{title}</Text>
          {description ? (
            <Text style={[styles.description, { color: palette.textSecondary }]}>{description}</Text>
          ) : null}
        </View>
        {aside}
      </View>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    borderWidth: 1,
    borderRadius: radii.r14,
    padding: spacing.s16,
    gap: spacing.s12,
    ...shadows.cardMedium,
    overflow: "hidden",
  },
  accentRail: {
    position: "absolute",
    left: 0,
    top: spacing.s16,
    bottom: spacing.s16,
    width: 2,
    opacity: 0.72,
  },
  frameLine: {
    position: "absolute",
    left: spacing.s14,
    right: spacing.s14,
    top: spacing.s10,
    borderTopWidth: 1,
    borderStyle: "dashed",
    opacity: 0.4,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.s12,
  },
  headerText: {
    flex: 1,
    gap: spacing.s4,
  },
  title: {
    fontFamily: fontFamilies.display,
    ...typeScale.sectionDisplay,
    textTransform: "uppercase",
  },
  description: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 18,
  },
});

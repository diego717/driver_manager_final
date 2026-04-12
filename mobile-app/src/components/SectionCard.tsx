import React, { type ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { useReducedMotion } from "@/src/hooks/useReducedMotion";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

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
    borderRadius: 20,
    padding: 17,
    gap: 12,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    overflow: "hidden",
  },
  accentRail: {
    position: "absolute",
    left: 0,
    top: 16,
    bottom: 16,
    width: 2,
    opacity: 0.9,
  },
  frameLine: {
    position: "absolute",
    left: 14,
    right: 14,
    top: 10,
    borderTopWidth: 1,
    opacity: 0.26,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: fontFamilies.display,
    fontSize: 19,
    lineHeight: 22,
    letterSpacing: -0.1,
    textTransform: "uppercase",
  },
  description: {
    fontFamily: fontFamilies.medium,
    fontSize: 13,
    lineHeight: 18,
  },
});

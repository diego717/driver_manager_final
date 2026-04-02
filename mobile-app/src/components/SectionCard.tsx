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
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
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
    fontFamily: fontFamilies.bold,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  description: {
    fontFamily: fontFamilies.regular,
    fontSize: 13.5,
    lineHeight: 19,
  },
});

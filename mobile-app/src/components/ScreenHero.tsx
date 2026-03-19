import React, { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

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
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 10,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  topRow: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  eyebrowWrap: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  eyebrow: {
    fontFamily: fontFamilies.bold,
    fontSize: 11.5,
    lineHeight: 14,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: fontFamilies.bold,
    fontSize: 28,
    lineHeight: 33,
    letterSpacing: -0.5,
  },
  description: {
    fontFamily: fontFamilies.regular,
    fontSize: 14.5,
    lineHeight: 21,
    maxWidth: 520,
  },
  footer: {
    marginTop: 2,
    gap: 10,
  },
});

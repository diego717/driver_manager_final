import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

type AppHeaderTitleProps = {
  title?: string;
};

export default function AppHeaderTitle({ title }: AppHeaderTitleProps) {
  const palette = useAppPalette();
  const safeTitle = String(title || "SiteOps").trim();

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.badge,
          {
            backgroundColor: palette.heroEyebrowBg,
            borderColor: palette.heroBorder,
          },
        ]}
      >
        <Image
          source={require("../../assets/images/Logotipo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <View style={styles.titleGroup}>
        <Text numberOfLines={1} style={[styles.eyebrow, { color: palette.heroEyebrowText }]}>
          Operations
        </Text>
        <Text numberOfLines={1} style={[styles.title, { color: palette.textPrimary }]}>
          {safeTitle}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    maxWidth: 320,
  },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 34,
    height: 34,
  },
  titleGroup: {
    flex: 1,
    gap: 1,
  },
  eyebrow: {
    fontFamily: fontFamilies.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: fontFamilies.bold,
    fontSize: 18,
    lineHeight: 22,
    flexShrink: 1,
  },
});

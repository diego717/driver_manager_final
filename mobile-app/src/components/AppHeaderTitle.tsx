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
      <Image
        source={require("../../assets/images/Logotipo.png")}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text numberOfLines={1} style={[styles.title, { color: palette.textPrimary }]}>
        {safeTitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: 320,
  },
  logo: {
    width: 108,
    height: 36,
  },
  title: {
    fontFamily: fontFamilies.semibold,
    fontSize: 17,
    lineHeight: 22,
    flexShrink: 1,
  },
});

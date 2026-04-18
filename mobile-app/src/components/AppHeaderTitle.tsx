import React from "react";
import { Image, StyleSheet, View } from "react-native";

import { radii, sizing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { useThemePreference } from "@/src/theme/theme-preference";

type AppHeaderTitleProps = {
  title?: string;
};

export default function AppHeaderTitle(_: AppHeaderTitleProps) {
  const palette = useAppPalette();
  const { resolvedScheme } = useThemePreference();
  const isDark = resolvedScheme === "dark";

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? palette.heroBg : palette.heroEyebrowBg,
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
  );
}

const styles = StyleSheet.create({
  container: {
    width: 136,
    height: 40,
    borderWidth: 1,
    borderRadius: radii.r12,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: sizing.headerActionsWidth - 2,
    height: 32,
  },
});

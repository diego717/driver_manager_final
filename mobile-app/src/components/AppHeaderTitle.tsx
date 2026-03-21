import React from "react";
import { Image, StyleSheet, View } from "react-native";

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
          backgroundColor: isDark ? palette.heroBg : "transparent",
          borderColor: isDark ? palette.heroBorder : "transparent",
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
    width: 124,
    height: 42,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 112,
    height: 40,
  },
});

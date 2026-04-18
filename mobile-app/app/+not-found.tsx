import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { radii, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

export default function NotFoundScreen() {
  const palette = useAppPalette();

  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={[styles.container, { backgroundColor: palette.screenBg }]}>
        <Text style={[styles.title, { color: palette.title }]}>Esta pantalla no existe.</Text>
        <Text style={[styles.subtitle, { color: palette.subtitle }]}>
          El enlace puede estar desactualizado o haber cambiado.
        </Text>

        <Link href="/" style={styles.link}>
          <Text
            style={[
              styles.linkText,
              {
                color: palette.linkText,
                backgroundColor: palette.linkBg,
                borderColor: palette.linkBorder,
              },
            ]}
          >
            Ir al inicio
          </Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.s20,
  },
  title: {
    fontSize: 20,
    fontFamily: fontFamilies.bold,
    textAlign: "center",
  },
  subtitle: {
    marginTop: spacing.s8,
    fontSize: 14,
    fontFamily: fontFamilies.regular,
    textAlign: "center",
  },
  link: {
    marginTop: spacing.s18,
  },
  linkText: {
    fontSize: 14,
    fontFamily: fontFamilies.semibold,
    borderWidth: 1,
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s14,
    paddingVertical: spacing.s10,
    overflow: "hidden",
  },
});

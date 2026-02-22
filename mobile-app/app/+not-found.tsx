import { Link, Stack } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useThemePreference } from "@/src/theme/theme-preference";

export default function NotFoundScreen() {
  const { resolvedScheme } = useThemePreference();
  const isDark = resolvedScheme === "dark";
  const palette = useMemo(
    () => ({
      screenBg: isDark ? "#020617" : "#f8fafc",
      title: isDark ? "#e2e8f0" : "#0f172a",
      subtitle: isDark ? "#94a3b8" : "#475569",
      linkText: isDark ? "#7dd3fc" : "#0369a1",
      linkBg: isDark ? "#0f172a" : "#ffffff",
      linkBorder: isDark ? "#334155" : "#bae6fd",
    }),
    [isDark],
  );

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
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    textAlign: "center",
  },
  link: {
    marginTop: 18,
  },
  linkText: {
    fontSize: 14,
    fontWeight: "700",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    overflow: "hidden",
  },
});

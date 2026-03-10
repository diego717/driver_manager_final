import React from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Link, Tabs } from "expo-router";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";

import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import AppHeaderTitle from "@/src/components/AppHeaderTitle";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: string;
}) {
  return <FontAwesome size={24} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  const palette = useAppPalette();
  const logoSource = require("../../assets/images/Logotipo.png");
  const tabBarBottomInset = Platform.OS === "android" ? 14 : 6;
  const tabBarHeight = Platform.OS === "android" ? 70 : 62;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingTop: 6,
          paddingBottom: tabBarBottomInset,
          shadowColor: "#0f1720",
          shadowOpacity: 0.08,
          shadowOffset: { width: 0, height: -3 },
          shadowRadius: 8,
          elevation: 8,
        },
        tabBarItemStyle: {
          minHeight: 44,
          paddingVertical: 4,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamilies.semibold,
          fontSize: 12.5,
        },
        headerStyle: {
          backgroundColor: palette.surface,
          height: 88,
          borderBottomColor: palette.border,
          borderBottomWidth: 1,
        },
        headerTitleAlign: "left",
        headerTitle: () => <AppHeaderTitle title="SiteOps" />,
        headerTitleContainerStyle: {
          left: 12,
          right: 12,
        },
        headerRightContainerStyle: {
          paddingRight: 6,
        },
        headerTitleStyle: {
          color: palette.textPrimary,
          fontFamily: fontFamilies.semibold,
        },
        headerRight: () => (
          <View style={styles.headerActions}>
            <Image source={logoSource} style={styles.headerLogo} resizeMode="contain" />
            <Link href="/modal?focus=login" asChild>
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Abrir acceso y configuracion"
                android_ripple={{ color: palette.hoverBg, borderless: true }}
                style={({ pressed }) => [
                  styles.settingsButton,
                  {
                    borderColor: palette.border,
                    backgroundColor: pressed ? palette.hoverBg : palette.subtleBg,
                    transform: [{ scale: pressed ? 0.95 : 1 }],
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}
              >
                {({ pressed }) => (
                  <FontAwesome
                    name="cog"
                    size={21}
                    color={palette.accent}
                    style={{ opacity: pressed ? 0.66 : 1 }}
                  />
                )}
              </Pressable>
            </Link>
          </View>
        ),
        headerTintColor: palette.textPrimary,
        headerShown: useClientOnlyValue(false, true),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Crear",
          tabBarIcon: ({ color }) => <TabBarIcon name="plus-circle" color={color} />,
        }}
      />
      <Tabs.Screen
        name="two"
        options={{
          title: "Incidencias",
          tabBarIcon: ({ color }) => <TabBarIcon name="list-alt" color={color} />,
        }}
      />
      <Tabs.Screen
        name="assets"
        options={{
          title: "Equipos",
          tabBarIcon: ({ color }) => <TabBarIcon name="hdd-o" color={color} />,
        }}
      />
      <Tabs.Screen
        name="qr"
        options={{
          title: "QR",
          tabBarIcon: ({ color }) => <TabBarIcon name="qrcode" color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    width: 184,
    gap: 10,
  },
  headerLogo: {
    width: 132,
    height: 48,
  },
  settingsButton: {
    width: Platform.select({ ios: 44, default: 44 }),
    height: Platform.select({ ios: 44, default: 44 }),
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
});

import React from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Link, Tabs } from "expo-router";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: string;
}) {
  return <FontAwesome size={28} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const palette = useAppPalette();
  const logoSource = require("../../assets/images/Logotipo.png");

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamilies.medium,
          fontSize: 12,
        },
        headerStyle: {
          backgroundColor: palette.surface,
          height: 88,
        },
        headerTitleAlign: "left",
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
          <View style={styles.headerLogoWrap}>
            <Image source={logoSource} style={styles.headerLogo} resizeMode="contain" />
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
          headerRight: () => (
            <View style={styles.headerActions}>
              <Image source={logoSource} style={styles.headerLogo} resizeMode="contain" />
              <Link href="/modal" asChild>
                <Pressable>
                  {({ pressed }) => (
                    <FontAwesome
                      name="cog"
                      size={25}
                      color={palette.textPrimary}
                      style={{ marginRight: 12, opacity: pressed ? 0.5 : 1 }}
                    />
                  )}
                </Pressable>
              </Link>
            </View>
          ),
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
  headerLogoWrap: {
    marginRight: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  headerLogo: {
    width: 132,
    height: 48,
  },
});

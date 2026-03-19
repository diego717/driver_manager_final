import React from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Link, Tabs } from "expo-router";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  const insets = useSafeAreaInsets();
  const logoSource = require("../../assets/images/Logotipo.png");
  const tabBarBottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 12 : 6);
  const tabBarHeight = 52 + tabBarBottomInset + 8;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarActiveBackgroundColor: palette.navActiveBg,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: palette.tabBarSurface,
          borderTopColor: palette.heroBorder,
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingTop: 8,
          paddingBottom: tabBarBottomInset,
          shadowColor: palette.shadowColor,
          shadowOpacity: 0.12,
          shadowOffset: { width: 0, height: -3 },
          shadowRadius: 14,
          elevation: 12,
        },
        tabBarItemStyle: {
          marginHorizontal: 4,
          marginTop: 4,
          borderRadius: 16,
          minHeight: 44,
          paddingVertical: 4,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamilies.semibold,
          fontSize: 12.5,
        },
        headerStyle: {
          backgroundColor: palette.headerSurface,
          height: 84 + insets.top,
          borderBottomColor: palette.heroBorder,
          borderBottomWidth: 1,
        },
        headerTitleAlign: "left",
        headerTitle: () => <AppHeaderTitle title="SiteOps" />,
        headerTitleContainerStyle: {
          left: 12,
          right: 12,
        },
        headerRightContainerStyle: {
          paddingRight: 6 + Math.max(insets.right, 0),
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
                    borderColor: palette.heroBorder,
                    backgroundColor: pressed ? palette.navActiveBg : palette.heroBg,
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
    width: 168,
    gap: 10,
  },
  headerLogo: {
    width: 108,
    height: 40,
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

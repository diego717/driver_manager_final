import React, { useEffect, useRef } from "react";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Link, Tabs } from "expo-router";
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import AppHeaderTitle from "@/src/components/AppHeaderTitle";
import { useAppPalette } from "@/src/theme/palette";
import { useThemePreference } from "@/src/theme/theme-preference";
import { fontFamilies } from "@/src/theme/typography";

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: string;
}) {
  return <FontAwesome size={24} style={{ marginBottom: -2 }} {...props} />;
}

function ThemeToggleButton() {
  const palette = useAppPalette();
  const { resolvedScheme, setMode } = useThemePreference();
  const spinAnim = useRef(new Animated.Value(resolvedScheme === "dark" ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(spinAnim, {
      toValue: resolvedScheme === "dark" ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [resolvedScheme, spinAnim]);

  const rotate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });
  const scale = spinAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.08, 1],
  });

  return (
    <Pressable
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={resolvedScheme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      accessibilityHint="Alterna entre tema claro y oscuro"
      android_ripple={{ color: palette.hoverBg, borderless: true }}
      onPress={() => {
        void setMode(resolvedScheme === "dark" ? "light" : "dark");
      }}
      style={({ pressed }) => [
        styles.headerButton,
        {
          borderColor: palette.heroBorder,
          backgroundColor: pressed ? palette.navActiveBg : palette.heroBg,
          transform: [{ scale: pressed ? 0.95 : 1 }],
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <Animated.View style={{ transform: [{ rotate }, { scale }] }}>
        <FontAwesome
          name={resolvedScheme === "dark" ? "moon-o" : "sun-o"}
          size={20}
          color={palette.accent}
        />
      </Animated.View>
    </Pressable>
  );
}

function SettingsButton() {
  const palette = useAppPalette();

  return (
    <Link href="/modal?focus=login" asChild>
      <Pressable
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Abrir acceso y configuracion"
        android_ripple={{ color: palette.hoverBg, borderless: true }}
        style={({ pressed }) => [
          styles.headerButton,
          {
            borderColor: palette.heroBorder,
            backgroundColor: pressed ? palette.navActiveBg : palette.heroBg,
            transform: [{ scale: pressed ? 0.95 : 1 }],
            opacity: pressed ? 0.9 : 1,
          },
        ]}
      >
        <FontAwesome
          name="cog"
          size={21}
          color={palette.accent}
        />
      </Pressable>
    </Link>
  );
}

function AppTabBarButton(props: BottomTabBarButtonProps) {
  const palette = useAppPalette();
  const selected = Boolean(props.accessibilityState?.selected);
  const {
    accessibilityState,
    accessibilityLabel,
    accessibilityLargeContentTitle,
    accessibilityShowsLargeContentViewer,
    children,
    delayLongPress,
    disabled,
    hitSlop,
    onLayout,
    onLongPress,
    onPress,
    style,
    testID,
  } = props;

  return (
    <Pressable
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      accessibilityLargeContentTitle={accessibilityLargeContentTitle}
      accessibilityShowsLargeContentViewer={accessibilityShowsLargeContentViewer}
      delayLongPress={delayLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      onLayout={onLayout}
      onLongPress={onLongPress}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.tabButton,
        style,
        {
          backgroundColor: selected ? palette.navActiveBg : "transparent",
          borderColor: selected ? palette.heroBorder : "transparent",
          opacity: pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
      android_ripple={{ color: palette.hoverBg }}
    >
      {children}
    </Pressable>
  );
}

export default function TabLayout() {
  const palette = useAppPalette();
  const insets = useSafeAreaInsets();
  const tabBarBottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 12 : 6);
  const tabBarHeight = 52 + tabBarBottomInset + 8;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarActiveBackgroundColor: "transparent",
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
        tabBarButton: (props) => <AppTabBarButton {...props} />,
        tabBarItemStyle: {
          marginHorizontal: 2,
          marginTop: 2,
          minHeight: 44,
          paddingVertical: 2,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamilies.semibold,
          fontSize: 12.5,
        },
        headerStyle: {
          backgroundColor: palette.headerSurface,
          height: 76 + insets.top,
          borderBottomColor: palette.heroBorder,
          borderBottomWidth: 1,
        },
        headerTitleAlign: "left",
        headerTitle: () => <AppHeaderTitle title="SiteOps" />,
        headerTitleContainerStyle: {
          left: 12,
          right: 72,
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
            <ThemeToggleButton />
            <SettingsButton />
          </View>
        ),
        headerTintColor: palette.textPrimary,
        headerShown: useClientOnlyValue(false, true),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Inicio",
          tabBarIcon: ({ color }) => <TabBarIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: "Casos",
          tabBarIcon: ({ color }) => <TabBarIcon name="briefcase" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "Inventario",
          tabBarIcon: ({ color }) => <TabBarIcon name="search" color={color} />,
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
    width: 112,
    gap: 8,
  },
  headerButton: {
    width: Platform.select({ ios: 44, default: 44 }),
    height: Platform.select({ ios: 44, default: 44 }),
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tabButton: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
  },
});

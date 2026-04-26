import React, { useEffect, useRef } from "react";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Link, Tabs } from "expo-router";
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import AppHeaderTitle from "@/src/components/AppHeaderTitle";
import { triggerSelectionHaptic } from "@/src/services/haptics";
import { radii, shadows, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { useThemePreference } from "@/src/theme/theme-preference";
import { fontFamilies, typeScale } from "@/src/theme/typography";

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: string;
}) {
  return <FontAwesome size={22} style={{ marginBottom: -1 }} {...props} />;
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

  return (
    <Pressable
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={resolvedScheme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      accessibilityHint="Alterna entre tema claro y oscuro"
      android_ripple={{ color: palette.hoverBg, borderless: true }}
      onPress={() => {
        triggerSelectionHaptic();
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
      <Animated.View style={{ transform: [{ rotate }] }}>
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
        onPress={() => {
          triggerSelectionHaptic();
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
        <FontAwesome name="cog" size={21} color={palette.accent} />
      </Pressable>
    </Link>
  );
}

type FieldTabBarButtonProps = BottomTabBarButtonProps & {
  emphasis?: boolean;
};

function FieldTabBarButton(props: FieldTabBarButtonProps) {
  const { emphasis = false, ...buttonProps } = props;
  const palette = useAppPalette();
  const selected = Boolean(buttonProps.accessibilityState?.selected);
  const selectionAnim = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(selectionAnim, {
      toValue: selected ? 1 : 0,
      duration: selected ? 200 : 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [selected, selectionAnim]);

  const markerScale = selectionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });

  return (
    <Pressable
      accessibilityState={buttonProps.accessibilityState}
      accessibilityLabel={buttonProps.accessibilityLabel}
      accessibilityLargeContentTitle={buttonProps.accessibilityLargeContentTitle}
      accessibilityShowsLargeContentViewer={buttonProps.accessibilityShowsLargeContentViewer}
      delayLongPress={buttonProps.delayLongPress}
      disabled={buttonProps.disabled}
      hitSlop={buttonProps.hitSlop}
      onLayout={buttonProps.onLayout}
      onLongPress={buttonProps.onLongPress}
      onPress={(event) => {
        triggerSelectionHaptic();
        buttonProps.onPress?.(event);
      }}
      testID={buttonProps.testID}
      style={({ pressed }) => [
        styles.tabButton,
        emphasis && styles.tabButtonEmphasis,
        buttonProps.style,
        {
          backgroundColor: selected ? palette.heroBg : "transparent",
          borderColor: selected ? palette.heroBorder : "transparent",
          borderStyle: selected ? "solid" : "dashed",
          opacity: pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
      android_ripple={{ color: palette.hoverBg }}
    >
      <View style={styles.tabButtonInner}>{buttonProps.children}</View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.tabActiveMarker,
          {
            backgroundColor: palette.accent,
            opacity: selectionAnim,
            transform: [{ scaleX: markerScale }],
          },
        ]}
      />
    </Pressable>
  );
}

export default function TabLayout() {
  const palette = useAppPalette();
  const insets = useSafeAreaInsets();
  const tabBarBottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 12 : 8);
  const tabBarHeight = sizing.tabBarBaseHeight + tabBarBottomInset;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarActiveBackgroundColor: "transparent",
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: palette.tabBarSurface,
          borderColor: palette.heroBorder,
          borderWidth: 1.2,
          borderTopWidth: 1.2,
          height: tabBarHeight,
          paddingTop: spacing.s8,
          paddingHorizontal: spacing.s8,
          paddingBottom: tabBarBottomInset,
          marginHorizontal: spacing.s4,
          marginBottom: spacing.s2,
          borderRadius: radii.r14,
          shadowColor: palette.shadowColor,
          ...shadows.tabBarRaised,
        },
        tabBarButton: (buttonProps) => <FieldTabBarButton {...buttonProps} />,
        tabBarItemStyle: {
          marginHorizontal: 2,
          minHeight: sizing.touchTargetMin,
          paddingVertical: 2,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamilies.mono,
          ...typeScale.buttonMono,
          letterSpacing: 0.9,
          textTransform: "uppercase",
        },
        headerStyle: {
          backgroundColor: palette.headerSurface,
          height: sizing.appHeaderBaseHeight + insets.top,
          borderBottomColor: palette.heroBorder,
          borderBottomWidth: 1,
        },
        headerTitleAlign: "left",
        headerTitle: () => <AppHeaderTitle title="SiteOps Campo" />,
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
          title: "Mi cola",
          tabBarIcon: ({ color }) => <TabBarIcon name="tasks" color={color} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: "Escanear",
          tabBarIcon: ({ color }) => <TabBarIcon name="qrcode" color={color} />,
          tabBarButton: (buttonProps) => (
            <FieldTabBarButton
              {...buttonProps}
              emphasis
            />
          ),
        }}
      />
      <Tabs.Screen
        name="new"
        options={{
          title: "Nueva",
          tabBarIcon: ({ color }) => <TabBarIcon name="plus-square-o" color={color} />,
        }}
      />

      <Tabs.Screen
        name="work"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          href: null,
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
    width: sizing.headerActionsWidth,
    gap: spacing.s8,
  },
  headerButton: {
    width: sizing.iconButton,
    height: sizing.iconButton,
    borderRadius: radii.r10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tabButton: {
    minHeight: sizing.touchTargetMin,
    borderRadius: radii.r10,
    borderWidth: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
  tabButtonEmphasis: {
    borderRadius: radii.r12,
    minHeight: 62,
    marginTop: -8,
  },
  tabButtonInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  tabActiveMarker: {
    position: "absolute",
    left: "18%",
    right: "18%",
    bottom: 2,
    height: 3,
    borderRadius: radii.full,
  },
});

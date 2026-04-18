import React, { useEffect, useRef, useState } from "react";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Link, Tabs } from "expo-router";
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import { readStoredWebSession } from "@/src/api/webAuth";
import { canViewAssetCatalog } from "@/src/auth/roles";
import AppHeaderTitle from "@/src/components/AppHeaderTitle";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { triggerSelectionHaptic } from "@/src/services/haptics";
import { radii, shadows, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { useThemePreference } from "@/src/theme/theme-preference";
import { fontFamilies, typeScale } from "@/src/theme/typography";

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: string;
}) {
  return <FontAwesome size={21} style={{ marginBottom: -1 }} {...props} />;
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
  const selectionAnim = useRef(new Animated.Value(selected ? 1 : 0)).current;
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
  const markerScale = selectionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 1],
  });
  const itemLift = selectionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -2],
  });

  useEffect(() => {
    Animated.timing(selectionAnim, {
      toValue: selected ? 1 : 0,
      duration: selected ? 220 : 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [selected, selectionAnim]);

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
      onPress={(event) => {
        triggerSelectionHaptic();
        onPress?.(event);
      }}
      testID={testID}
      style={({ pressed }) => [
        styles.tabButton,
        style,
        {
          backgroundColor: selected ? palette.heroBg : "transparent",
          borderColor: selected ? palette.heroBorder : "transparent",
          borderStyle: selected ? "dashed" : "solid",
          opacity: pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
      android_ripple={{ color: palette.hoverBg }}
    >
      <Animated.View
        style={[
          styles.tabButtonInner,
          {
            opacity: selected ? 1 : 0.94,
            transform: [{ translateY: itemLift }],
          },
        ]}
      >
        {children}
      </Animated.View>
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
  const { hasActiveSession } = useSharedWebSessionState();
  const [webSessionRole, setWebSessionRole] = useState<string | null>(null);
  const tabBarBottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 12 : 6);
  const tabBarHeight = sizing.tabBarBaseHeight + tabBarBottomInset;
  const shouldHideInventoryTab =
    hasActiveSession && webSessionRole !== null && !canViewAssetCatalog(webSessionRole);

  useEffect(() => {
    let isMounted = true;
    if (!hasActiveSession) {
      setWebSessionRole(null);
      return () => {
        isMounted = false;
      };
    }

    void readStoredWebSession()
      .then((session) => {
        if (!isMounted) return;
        setWebSessionRole(session.role);
      })
      .catch(() => {
        if (!isMounted) return;
        setWebSessionRole(null);
      });

    return () => {
      isMounted = false;
    };
  }, [hasActiveSession]);

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
        tabBarButton: (props) => <AppTabBarButton {...props} />,
        tabBarItemStyle: {
          marginHorizontal: 3,
          marginTop: 2,
          minHeight: sizing.touchTargetMin,
          paddingVertical: 2,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamilies.mono,
          ...typeScale.buttonMonoTight,
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
        name="map"
        options={{
          title: "Mapa",
          tabBarIcon: ({ color }) => <TabBarIcon name="map-marker" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "Inventario",
          href: shouldHideInventoryTab ? null : undefined,
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
    width: sizing.headerActionsWidth,
    gap: spacing.s8,
  },
  headerButton: {
    width: Platform.select({ ios: sizing.iconButton, default: sizing.iconButton }),
    height: Platform.select({ ios: sizing.iconButton, default: sizing.iconButton }),
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
  tabButtonInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  tabActiveMarker: {
    position: "absolute",
    left: "20%",
    right: "20%",
    bottom: 2,
    height: 3,
    borderRadius: radii.full,
  },
});

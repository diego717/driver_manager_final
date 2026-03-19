import React from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppPalette } from "@/src/theme/palette";

type ScreenScaffoldProps = {
  children: React.ReactNode;
  centered?: boolean;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollViewProps?: Omit<ScrollViewProps, "style" | "contentContainerStyle" | "children">;
};

function AmbientBackdrop() {
  const palette = useAppPalette();

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.orb, styles.orbPrimary, { backgroundColor: palette.ambientPrimary }]} />
      <View style={[styles.orb, styles.orbSecondary, { backgroundColor: palette.ambientSecondary }]} />
      <View style={[styles.orb, styles.orbTertiary, { backgroundColor: palette.ambientTertiary }]} />
    </View>
  );
}

export default function ScreenScaffold(props: ScreenScaffoldProps) {
  const {
    children,
    centered = false,
    scroll = true,
    style,
    contentContainerStyle,
    scrollViewProps,
  } = props;
  const palette = useAppPalette();
  const insets = useSafeAreaInsets();
  const baseContentStyle = [
    styles.contentBase,
    {
      paddingTop: 18 + Math.max(insets.top, 0),
      paddingBottom: 24 + Math.max(insets.bottom, 12),
    },
  ];

  if (!scroll) {
    return (
      <View style={[styles.root, { backgroundColor: palette.screenBg }, style]}>
        <AmbientBackdrop />
        <View
          style={[
            baseContentStyle,
            centered && styles.centeredContent,
            contentContainerStyle,
          ]}
        >
          {children}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.screenBg }, style]}>
      <AmbientBackdrop />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[baseContentStyle, centered && styles.centeredContent, contentContainerStyle]}
        {...scrollViewProps}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  contentBase: {
    paddingHorizontal: 20,
    gap: 14,
  },
  centeredContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  orb: {
    position: "absolute",
    borderRadius: 999,
  },
  orbPrimary: {
    width: 232,
    height: 232,
    top: -96,
    left: -28,
  },
  orbSecondary: {
    width: 184,
    height: 184,
    top: 128,
    right: -76,
  },
  orbTertiary: {
    width: 208,
    height: 208,
    bottom: -84,
    left: 64,
  },
});

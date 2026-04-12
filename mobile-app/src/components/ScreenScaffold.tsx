import React from "react";
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotion } from "@/src/hooks/useReducedMotion";
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
  const reducedMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const drift = React.useRef(new Animated.Value(0)).current;
  const sweep = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (reducedMotion) {
      drift.setValue(0);
      sweep.setValue(0);
      return;
    }

    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 12000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 12000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const sweepLoop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 6200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    driftLoop.start();
    sweepLoop.start();
    return () => {
      driftLoop.stop();
      sweepLoop.stop();
    };
  }, [drift, reducedMotion, sweep]);

  const driftX = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -14],
  });
  const driftY = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 10],
  });
  const beamRotate = drift.interpolate({
    inputRange: [0, 1],
    outputRange: ["-8deg", "-5deg"],
  });
  const beamScale = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });
  const columnShift = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 12],
  });
  const scanlineY = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [86, Math.max(220, height - 140)],
  });
  const scanlineOpacity = sweep.interpolate({
    inputRange: [0, 0.12, 0.72, 1],
    outputRange: [0.06, 0.22, 0.16, 0.06],
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.motionLayer, { transform: [{ translateX: driftX }, { translateY: driftY }] }]}>
        <Animated.View
          style={[
            styles.beam,
            styles.beamPrimary,
            {
              backgroundColor: palette.ambientPrimary,
              transform: [{ rotate: beamRotate }, { scale: beamScale }],
            },
          ]}
        />
        <View style={[styles.beam, styles.beamSecondary, { backgroundColor: palette.ambientSecondary }]} />
        <Animated.View
          style={[
            styles.panelColumn,
            styles.panelColumnPrimary,
            {
              backgroundColor: palette.ambientTertiary,
              transform: [{ translateX: columnShift }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.panelColumn,
            styles.panelColumnSecondary,
            {
              backgroundColor: palette.ambientSecondary,
              transform: [{ translateX: columnShift }],
            },
          ]}
        />
        <View style={[styles.orb, styles.orbPrimary, { backgroundColor: palette.ambientPrimary }]} />
        <View style={[styles.orb, styles.orbSecondary, { backgroundColor: palette.ambientSecondary }]} />
        <View style={[styles.orb, styles.orbTertiary, { backgroundColor: palette.ambientTertiary }]} />
        <View
          style={[
            styles.ring,
            {
              borderColor: palette.accentSoft,
              left: width > 460 ? 130 : 72,
            },
          ]}
        />
      </Animated.View>
      <View style={[styles.frameTop, { borderColor: palette.heroBorder }]} />
      <View style={[styles.frameBottom, { borderColor: palette.heroBorder }]} />
      <View style={[styles.notch, styles.notchLeft, { borderColor: palette.heroBorder }]} />
      <View style={[styles.notch, styles.notchRight, { borderColor: palette.heroBorder }]} />
      <View style={[styles.gridVeil, { borderColor: palette.border }]} />
      <Animated.View
        style={[
          styles.scanline,
          {
            backgroundColor: palette.accent,
            opacity: scanlineOpacity,
            transform: [{ translateY: scanlineY }],
          },
        ]}
      />
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
  motionLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  beam: {
    position: "absolute",
    borderRadius: 999,
    opacity: 0.52,
  },
  beamPrimary: {
    width: 360,
    height: 170,
    top: -112,
    right: -128,
  },
  beamSecondary: {
    width: 310,
    height: 132,
    bottom: 84,
    left: -158,
    transform: [{ rotate: "18deg" }],
  },
  panelColumn: {
    position: "absolute",
    borderRadius: 22,
    opacity: 0.2,
  },
  panelColumnPrimary: {
    right: -28,
    top: 122,
    width: 148,
    height: 280,
  },
  panelColumnSecondary: {
    left: -36,
    top: 196,
    width: 102,
    height: 210,
  },
  orbPrimary: {
    width: 250,
    height: 250,
    top: -112,
    left: -36,
  },
  orbSecondary: {
    width: 212,
    height: 212,
    top: 122,
    right: -88,
  },
  orbTertiary: {
    width: 234,
    height: 234,
    bottom: -102,
    left: 52,
  },
  ring: {
    position: "absolute",
    width: 192,
    height: 192,
    top: 248,
    borderRadius: 999,
    borderWidth: 1.5,
    opacity: 0.26,
  },
  frameTop: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 10,
    borderTopWidth: 1,
    opacity: 0.36,
  },
  frameBottom: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    borderTopWidth: 1,
    opacity: 0.24,
  },
  notch: {
    position: "absolute",
    width: 26,
    height: 10,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    opacity: 0.28,
  },
  notchLeft: {
    left: 12,
    top: 10,
  },
  notchRight: {
    right: 12,
    bottom: 14,
    transform: [{ rotate: "180deg" }],
  },
  gridVeil: {
    ...StyleSheet.absoluteFillObject,
    borderTopWidth: 0.6,
    borderBottomWidth: 0.6,
    opacity: 0.11,
  },
  scanline: {
    position: "absolute",
    left: 16,
    right: 16,
    height: 2,
    borderRadius: 999,
  },
});

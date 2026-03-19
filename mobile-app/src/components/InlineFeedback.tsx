import { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

export type InlineFeedbackTone = "info" | "success" | "warning" | "error";

type InlineFeedbackProps = {
  message: string;
  tone?: InlineFeedbackTone;
  style?: StyleProp<ViewStyle>;
};

export default function InlineFeedback({
  message,
  tone = "info",
  style,
}: InlineFeedbackProps) {
  const palette = useAppPalette();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(4)).current;

  const visualTone = useMemo(() => {
    if (tone === "success") {
      return {
        backgroundColor: palette.successBg,
        borderColor: palette.successBorder,
        textColor: palette.successText,
        icon: "OK",
      };
    }
    if (tone === "warning") {
      return {
        backgroundColor: palette.warningBg,
        borderColor: palette.warningText,
        textColor: palette.warningText,
        icon: "!",
      };
    }
    if (tone === "error") {
      return {
        backgroundColor: palette.errorBg,
        borderColor: palette.errorBorder,
        textColor: palette.errorText,
        icon: "!",
      };
    }
    return {
      backgroundColor: palette.infoBg,
      borderColor: palette.infoBorder,
      textColor: palette.infoText,
      icon: "i",
    };
  }, [palette, tone]);

  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(4);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 170,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 190,
        useNativeDriver: true,
      }),
    ]).start();
  }, [message, tone, opacity, translateY]);

  if (!String(message || "").trim()) return null;

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          opacity,
          transform: [{ translateY }],
          backgroundColor: visualTone.backgroundColor,
          borderColor: visualTone.borderColor,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          {
            borderColor: visualTone.borderColor,
            backgroundColor: palette.heroBg,
          },
        ]}
      >
        <Text style={[styles.iconText, { color: visualTone.textColor }]}>{visualTone.icon}</Text>
      </View>
      <Text style={[styles.messageText, { color: visualTone.textColor }]}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  iconWrap: {
    minWidth: 26,
    height: 26,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    marginTop: 1,
    flexShrink: 0,
  },
  iconText: {
    fontFamily: fontFamilies.bold,
    fontSize: 10.5,
    lineHeight: 12,
    letterSpacing: 0.2,
  },
  messageText: {
    flex: 1,
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
});

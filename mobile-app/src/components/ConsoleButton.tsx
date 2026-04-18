import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  type AccessibilityState,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { radii, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, typeScale } from "@/src/theme/typography";

type ConsoleButtonVariant = "primary" | "secondary" | "ghost" | "warning" | "subtle";
type ConsoleButtonSize = "sm" | "md" | "lg";

type ConsoleButtonProps = {
  label?: string;
  children?: ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  variant?: ConsoleButtonVariant;
  size?: ConsoleButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
};

export default function ConsoleButton(props: ConsoleButtonProps) {
  const {
    label,
    children,
    onPress,
    variant = "secondary",
    size = "md",
    disabled = false,
    loading = false,
    fullWidth = false,
    accessibilityLabel,
    accessibilityState,
    style,
    textStyle,
    testID,
  } = props;
  const palette = useAppPalette();
  const unavailable = disabled || loading;

  const variantStyle = React.useMemo(() => {
    if (variant === "primary") {
      return {
        backgroundColor: palette.primaryButtonBg,
        borderColor: palette.heroBorder,
        borderStyle: "solid" as const,
        textColor: palette.primaryButtonText,
      };
    }
    if (variant === "ghost") {
      return {
        backgroundColor: palette.refreshBg,
        borderColor: palette.inputBorder,
        borderStyle: "dashed" as const,
        textColor: palette.refreshText,
      };
    }
    if (variant === "warning") {
      return {
        backgroundColor: palette.warningBg,
        borderColor: palette.warningText,
        borderStyle: "dashed" as const,
        textColor: palette.warningText,
      };
    }
    if (variant === "subtle") {
      return {
        backgroundColor: palette.secondaryButtonBg,
        borderColor: palette.inputBorder,
        borderStyle: "dashed" as const,
        textColor: palette.secondaryButtonText,
      };
    }
    return {
      backgroundColor: palette.surface,
      borderColor: palette.heroBorder,
      borderStyle: "dashed" as const,
      textColor: palette.accent,
    };
  }, [palette, variant]);

  const sizeStyle = React.useMemo(() => {
    if (size === "lg") {
      return styles.large;
    }
    if (size === "sm") {
      return styles.small;
    }
    return styles.medium;
  }, [size]);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={unavailable}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={accessibilityState}
      style={[
        styles.base,
        sizeStyle,
        {
          backgroundColor: variantStyle.backgroundColor,
          borderColor: variantStyle.borderColor,
          borderStyle: variantStyle.borderStyle,
        },
        fullWidth && styles.fullWidth,
        !unavailable && styles.enabled,
        unavailable && styles.disabled,
        style,
      ]}
      testID={testID}
    >
      {loading ? <ActivityIndicator color={variantStyle.textColor} /> : null}
      {!loading && children ? children : null}
      {!loading && !children && label ? (
        <Text style={[styles.label, { color: variantStyle.textColor }, textStyle]}>{label}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: sizing.touchTargetMin,
    borderWidth: 1,
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.s4,
  },
  small: {
    minHeight: sizing.touchTargetMin,
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s8,
  },
  medium: {
    minHeight: sizing.touchTargetMin,
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
  },
  large: {
    minHeight: 52,
    borderRadius: radii.r12,
    paddingHorizontal: spacing.s14,
    paddingVertical: spacing.s12,
  },
  label: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  fullWidth: {
    alignSelf: "stretch",
  },
  enabled: {
    opacity: 1,
  },
  disabled: {
    opacity: 0.68,
  },
});

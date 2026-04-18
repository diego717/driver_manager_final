import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { extractApiError } from "@/src/api/client";
import { loginWebSession } from "@/src/api/webAuth";
import { refreshSharedWebSessionState } from "@/src/session/web-session-store";
import { getStoredWebAccessUsername } from "@/src/storage/secure";
import { radii, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, inputFontFamily, textInputAccentColor } from "@/src/theme/typography";

type WebInlineLoginCardProps = {
  hint: string;
  onLoginSuccess: () => void | Promise<void>;
  onOpenAdvanced?: () => void;
};

export default function WebInlineLoginCard(props: WebInlineLoginCardProps) {
  const { hint, onLoginSuccess, onOpenAdvanced } = props;
  const palette = useAppPalette();
  const { width } = useWindowDimensions();
  const isCompact = width <= 390;
  const isVeryCompact = width <= 340;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [focusedField, setFocusedField] = useState<"username" | "password" | null>(null);
  const successFeedback = feedback.toLowerCase().includes("sesion iniciada");
  const focusRingColor = palette.navActiveBg;

  useEffect(() => {
    let mounted = true;
    void getStoredWebAccessUsername().then((storedUsername) => {
      if (!mounted || !storedUsername) return;
      setUsername((current) => current.trim() || storedUsername);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const onSignIn = async () => {
    if (submitting) return;
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) {
      setFeedback("Ingresa usuario web.");
      return;
    }
    if (!password.trim()) {
      setFeedback("Ingresa contrasena web.");
      return;
    }

    try {
      setSubmitting(true);
      setFeedback("");
      const login = await loginWebSession(normalizedUsername, password);
      await refreshSharedWebSessionState();
      setPassword("");
      setFeedback(`Sesion iniciada: ${login.user.username}`);
      await onLoginSuccess();
    } catch (error) {
      setFeedback(extractApiError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View
      style={[
        styles.card,
        isCompact && styles.cardCompact,
        {
          backgroundColor: palette.cardBg,
          borderColor: palette.cardBorder,
        },
      ]}
    >
      <View style={[styles.header, isCompact && styles.headerCompact]}>
        <View
          style={[
            styles.brandPill,
            {
              backgroundColor: palette.heroEyebrowBg,
              borderColor: palette.heroBorder,
            },
          ]}
        >
          <Text style={[styles.brand, isCompact && styles.brandCompact, { color: palette.heroEyebrowText }]}>
            SiteOps Mobile
          </Text>
        </View>
        <Text style={[styles.title, isCompact && styles.titleCompact, { color: palette.textPrimary }]}>
          Acceso seguro
        </Text>
        <Text style={[styles.hint, isCompact && styles.hintCompact, { color: palette.textSecondary }]}>
          {hint}
        </Text>
      </View>

      <View style={styles.inputGroup}>
        <Text style={[styles.label, isCompact && styles.labelCompact, { color: palette.textSecondary }]}>
          Usuario
        </Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          autoComplete="username"
          style={[
            styles.input,
            isCompact && styles.inputCompact,
            {
              backgroundColor: palette.inputBg,
              borderColor: focusedField === "username" ? palette.accent : palette.inputBorder,
              color: palette.textPrimary,
              shadowColor: focusRingColor,
              shadowOpacity: focusedField === "username" ? 1 : 0,
              shadowRadius: focusedField === "username" ? 10 : 0,
              shadowOffset: { width: 0, height: 0 },
              elevation: focusedField === "username" ? 1 : 0,
            },
          ]}
          placeholder="nombre_usuario"
          placeholderTextColor={palette.placeholder}
          selectionColor={textInputAccentColor}
          cursorColor={textInputAccentColor}
          accessibilityLabel="Usuario web para iniciar sesion"
          onFocus={() => setFocusedField("username")}
          onBlur={() => setFocusedField((current) => (current === "username" ? null : current))}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={[styles.label, isCompact && styles.labelCompact, { color: palette.textSecondary }]}>
          Contrasena
        </Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          textContentType="password"
          autoComplete="password"
          returnKeyType="go"
          onSubmitEditing={() => {
            void onSignIn();
          }}
          style={[
            styles.input,
            isCompact && styles.inputCompact,
            {
              backgroundColor: palette.inputBg,
              borderColor: focusedField === "password" ? palette.accent : palette.inputBorder,
              color: palette.textPrimary,
              shadowColor: focusRingColor,
              shadowOpacity: focusedField === "password" ? 1 : 0,
              shadowRadius: focusedField === "password" ? 10 : 0,
              shadowOffset: { width: 0, height: 0 },
              elevation: focusedField === "password" ? 1 : 0,
            },
          ]}
          placeholder="********"
          placeholderTextColor={palette.placeholder}
          selectionColor={textInputAccentColor}
          cursorColor={textInputAccentColor}
          accessibilityLabel="Contrasena web para iniciar sesion"
          onFocus={() => setFocusedField("password")}
          onBlur={() => setFocusedField((current) => (current === "password" ? null : current))}
        />
      </View>

      {feedback ? (
        <View
          style={[
            styles.feedbackBox,
            {
              backgroundColor: successFeedback ? palette.successBg : palette.errorBg,
              borderColor: successFeedback ? palette.successBorder : palette.errorBorder,
            },
          ]}
        >
          <Text
            style={[
              styles.feedback,
              isCompact && styles.feedbackCompact,
              { color: successFeedback ? palette.successText : palette.errorText },
            ]}
          >
            {feedback}
          </Text>
        </View>
      ) : null}

      <View style={[styles.actionsRow, isVeryCompact && styles.actionsRowCompact]}>
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            isCompact && styles.buttonCompact,
            {
              backgroundColor: palette.primaryButtonBg,
              transform: [{ translateY: pressed ? 0 : -1 }],
              opacity: submitting ? 0.76 : pressed ? 0.9 : 1,
              shadowColor: focusRingColor,
              shadowOpacity: pressed ? 0.1 : 0.2,
              shadowRadius: pressed ? 6 : 12,
              shadowOffset: { width: 0, height: pressed ? 2 : 6 },
              elevation: pressed ? 2 : 4,
            },
          ]}
          onPress={() => {
            void onSignIn();
          }}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Iniciar sesion web"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? (
            <ActivityIndicator color={palette.primaryButtonText} />
          ) : (
            <Text
              style={[
                styles.primaryButtonText,
                isCompact && styles.buttonTextCompact,
                { color: palette.primaryButtonText },
              ]}
            >
              Iniciar sesion
            </Text>
          )}
        </Pressable>
        {onOpenAdvanced ? (
          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              isCompact && styles.buttonCompact,
              {
                backgroundColor: pressed ? palette.hoverBg : palette.secondaryButtonBg,
                borderColor: pressed ? palette.accent : palette.inputBorder,
                transform: [{ translateY: pressed ? 0 : -1 }],
              },
            ]}
            onPress={onOpenAdvanced}
            accessibilityRole="button"
            accessibilityLabel="Abrir configuracion avanzada"
          >
            <Text
              style={[
                styles.secondaryButtonText,
                isCompact && styles.buttonTextCompact,
                { color: palette.secondaryButtonText },
              ]}
            >
              Configuracion
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: spacing.s18,
    paddingVertical: spacing.s18,
    gap: spacing.s12,
  },
  cardCompact: {
    borderRadius: 20,
    paddingHorizontal: spacing.s14,
    paddingVertical: spacing.s14,
    gap: spacing.s10,
  },
  header: {
    alignItems: "center",
    gap: spacing.s4,
    marginBottom: spacing.s2,
  },
  headerCompact: {
    gap: spacing.s3,
    marginBottom: 0,
  },
  brandPill: {
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s6,
  },
  brand: {
    fontFamily: fontFamilies.bold,
    fontSize: 11.5,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  brandCompact: {
    fontSize: 10.5,
    letterSpacing: 0.55,
  },
  title: {
    fontSize: 32,
    fontFamily: fontFamilies.bold,
    textAlign: "center",
    lineHeight: 36,
  },
  titleCompact: {
    fontSize: 28,
    lineHeight: 32,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18.5,
    fontFamily: fontFamilies.regular,
    textAlign: "center",
  },
  hintCompact: {
    fontSize: 12,
    lineHeight: 16.5,
  },
  inputGroup: {
    gap: spacing.s6,
  },
  label: {
    fontSize: 12.5,
    fontFamily: fontFamilies.semibold,
  },
  labelCompact: {
    fontSize: 12,
  },
  input: {
    minHeight: sizing.touchTargetMin + spacing.s2,
    borderWidth: 1,
    borderRadius: radii.r12,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
    fontSize: 14,
    fontFamily: inputFontFamily,
  },
  inputCompact: {
    minHeight: sizing.touchTargetMin,
    borderRadius: radii.r11,
    paddingHorizontal: spacing.s11,
    paddingVertical: spacing.s9,
    fontSize: 13.5,
  },
  feedbackBox: {
    borderWidth: 1,
    borderRadius: radii.r14,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
  },
  feedback: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamilies.regular,
  },
  feedbackCompact: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.s10,
    marginTop: spacing.s2,
  },
  actionsRowCompact: {
    flexDirection: "column",
    gap: spacing.s8,
  },
  primaryButton: {
    flex: 1,
    borderRadius: radii.r14,
    minHeight: sizing.touchTargetMin + spacing.s4,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s12,
  },
  buttonCompact: {
    minHeight: sizing.touchTargetMin,
    borderRadius: radii.r12,
    paddingVertical: spacing.s10,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14.5,
  },
  buttonTextCompact: {
    fontSize: 13.5,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: radii.r14,
    borderWidth: 1,
    minHeight: sizing.touchTargetMin + spacing.s4,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s12,
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 14,
  },
});

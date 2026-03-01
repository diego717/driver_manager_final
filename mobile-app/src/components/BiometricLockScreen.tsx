import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

interface BiometricLockScreenProps {
  busy: boolean;
  biometricLabel: string;
  errorMessage?: string | null;
  onRetry: () => void;
  onUseFallbackCode: () => void;
}

export default function BiometricLockScreen({
  busy,
  biometricLabel,
  errorMessage,
  onRetry,
  onUseFallbackCode,
}: BiometricLockScreenProps) {
  const palette = useAppPalette();

  return (
    <View style={[styles.overlay, { backgroundColor: palette.overlayBg }]}>
      <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
        <Text style={[styles.title, { color: palette.title }]}>App bloqueada</Text>
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
          Valida tu identidad con {biometricLabel} para continuar.
        </Text>

        {errorMessage ? (
          <Text style={[styles.errorMessage, { color: palette.error }]}>{errorMessage}</Text>
        ) : null}

        <TouchableOpacity
          style={[
            styles.primaryButton,
            { backgroundColor: palette.primaryButtonBg },
            busy && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Reintentar autenticacion con ${biometricLabel}`}
          onPress={onRetry}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={palette.primaryButtonText} />
          ) : (
            <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
              Reintentar
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.secondaryButton,
            { borderColor: palette.border, backgroundColor: palette.surfaceAlt },
            busy && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Usar codigo PIN o patron del dispositivo"
          onPress={onUseFallbackCode}
          disabled={busy}
        >
          <Text style={[styles.secondaryButtonText, { color: palette.textPrimary }]}>
            Usar codigo del dispositivo
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 10,
  },
  title: {
    fontSize: 22,
    fontFamily: fontFamilies.bold,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
    lineHeight: 19,
  },
  errorMessage: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
    lineHeight: 18,
    marginBottom: 4,
  },
  primaryButton: {
    marginTop: 8,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
  },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});

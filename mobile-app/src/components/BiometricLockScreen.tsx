import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { radii, sizing, spacing } from "@/src/theme/layout";
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
  const hasError = Boolean(String(errorMessage || "").trim());
  const title = hasError ? "Desbloqueo pendiente" : "Desbloquear SiteOps";
  const subtitle = hasError
    ? `No pudimos completar la validacion con ${biometricLabel}. Puedes reintentar o usar el codigo del dispositivo.`
    : `Presenta tu ${biometricLabel} para volver al trabajo.`;
  const statusTitle = busy ? "Esperando validacion" : hasError ? "Requiere accion" : "Proteccion activa";
  const statusBody = busy
    ? `Sigue el dialogo del sistema para validar con ${biometricLabel}.`
    : hasError
      ? String(errorMessage || "").trim()
      : "La app protege el acceso cuando vuelves al primer plano.";

  return (
    <View style={[styles.overlay, { backgroundColor: palette.overlayBg }]}>
      <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: hasError ? palette.warningBg : palette.heroEyebrowBg,
              borderColor: hasError ? palette.warningText : palette.heroBorder,
            },
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              { color: hasError ? palette.warningText : palette.heroEyebrowText },
            ]}
          >
            acceso seguro
          </Text>
        </View>

        <Text style={[styles.title, { color: palette.title }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
          {subtitle}
        </Text>

        <View
          style={[
            styles.statusCard,
            {
              backgroundColor: hasError ? palette.warningBg : palette.heroBg,
              borderColor: hasError ? palette.warningText : palette.heroBorder,
            },
          ]}
        >
          <View
            style={[
              styles.statusIcon,
              {
                backgroundColor: hasError ? palette.warningText : palette.primaryButtonBg,
              },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={palette.primaryButtonText} size="small" />
            ) : (
              <Text style={[styles.statusIconText, { color: palette.primaryButtonText }]}>
                {hasError ? "!" : "OK"}
              </Text>
            )}
          </View>
          <View style={styles.statusCopy}>
            <Text
              style={[
                styles.statusTitle,
                { color: hasError ? palette.warningText : palette.textPrimary },
              ]}
            >
              {statusTitle}
            </Text>
            <Text
              style={[
                styles.statusBody,
                { color: hasError ? palette.warningText : palette.textSecondary },
              ]}
            >
              {statusBody}
            </Text>
          </View>
        </View>

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
              Reintentar biometria
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
    paddingHorizontal: spacing.s24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: spacing.s18,
    paddingVertical: spacing.s20,
    gap: spacing.s14,
  },
  badge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s6,
  },
  badgeText: {
    fontSize: 11.5,
    fontFamily: fontFamilies.bold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  title: {
    fontSize: 24,
    fontFamily: fontFamilies.bold,
  },
  subtitle: {
    fontSize: 13.5,
    fontFamily: fontFamilies.regular,
    lineHeight: 20,
  },
  statusCard: {
    borderWidth: 1,
    borderRadius: radii.r18,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s12,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s12,
  },
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  statusIconText: {
    fontFamily: fontFamilies.bold,
    fontSize: 11.5,
    lineHeight: 13,
  },
  statusCopy: {
    flex: 1,
    gap: spacing.s2,
  },
  statusTitle: {
    fontSize: 13.5,
    fontFamily: fontFamilies.bold,
    lineHeight: 18,
  },
  statusBody: {
    fontSize: 12.5,
    fontFamily: fontFamilies.regular,
    lineHeight: 18,
  },
  primaryButton: {
    borderRadius: radii.r14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: sizing.touchTargetMin,
    paddingVertical: spacing.s13,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
  },
  secondaryButton: {
    borderRadius: radii.r14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: sizing.touchTargetMin,
    paddingVertical: spacing.s13,
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});

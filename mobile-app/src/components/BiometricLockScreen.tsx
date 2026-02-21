import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

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
  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.title}>App bloqueada</Text>
        <Text style={styles.subtitle}>
          Valida tu identidad con {biometricLabel} para continuar.
        </Text>

        {errorMessage ? <Text style={styles.errorMessage}>{errorMessage}</Text> : null}

        <TouchableOpacity
          style={[styles.primaryButton, busy && styles.buttonDisabled]}
          onPress={onRetry}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>Reintentar</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryButton, busy && styles.buttonDisabled]}
          onPress={onUseFallbackCode}
          disabled={busy}
        >
          <Text style={styles.secondaryButtonText}>Usar codigo del dispositivo</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    backgroundColor: "rgba(15, 23, 42, 0.94)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#0f172a",
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 10,
  },
  title: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
  },
  subtitle: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 19,
  },
  errorMessage: {
    color: "#fca5a5",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
  primaryButton: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: "#0b7a75",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
  },
  secondaryButtonText: {
    color: "#e2e8f0",
    fontWeight: "700",
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});

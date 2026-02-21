import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

export interface BiometricAvailability {
  isAvailable: boolean;
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedAuthenticationTypes: LocalAuthentication.AuthenticationType[];
  biometricLabel: string;
}

export interface AuthenticateWithBiometricsOptions {
  allowDeviceFallback?: boolean;
  promptMessage?: string;
  cancelLabel?: string;
  fallbackLabel?: string;
}

export interface BiometricAuthResult {
  success: boolean;
  error?: string;
  warning?: string;
}

function resolveBiometricLabel(
  supportedTypes: LocalAuthentication.AuthenticationType[],
): string {
  if (
    supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
  ) {
    return "Face ID";
  }
  if (
    supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
  ) {
    return Platform.OS === "ios" ? "Touch ID" : "huella";
  }
  if (supportedTypes.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    return "iris";
  }
  return "biometria";
}

function mapBiometricError(errorCode?: string): string {
  switch (errorCode) {
    case "user_cancel":
    case "app_cancel":
    case "system_cancel":
      return "Autenticacion cancelada.";
    case "not_enrolled":
      return "No hay biometria registrada en el dispositivo.";
    case "not_available":
      return "Biometria no disponible en este dispositivo.";
    case "lockout":
      return "Biometria bloqueada temporalmente. Usa codigo del dispositivo.";
    case "timeout":
      return "Tiempo de autenticacion agotado.";
    case "user_fallback":
      return "Se solicito usar codigo del dispositivo.";
    default:
      return "No se pudo autenticar. Intenta nuevamente.";
  }
}

export async function getBiometricAvailability(): Promise<BiometricAvailability> {
  if (Platform.OS === "web") {
    return {
      isAvailable: false,
      hasHardware: false,
      isEnrolled: false,
      supportedAuthenticationTypes: [],
      biometricLabel: "biometria",
    };
  }

  try {
    const [hasHardware, isEnrolled, supportedAuthenticationTypes] =
      await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
      ]);

    return {
      isAvailable:
        hasHardware && isEnrolled && supportedAuthenticationTypes.length > 0,
      hasHardware,
      isEnrolled,
      supportedAuthenticationTypes,
      biometricLabel: resolveBiometricLabel(supportedAuthenticationTypes),
    };
  } catch {
    return {
      isAvailable: false,
      hasHardware: false,
      isEnrolled: false,
      supportedAuthenticationTypes: [],
      biometricLabel: "biometria",
    };
  }
}

export async function authenticateWithBiometrics(
  options: AuthenticateWithBiometricsOptions = {},
): Promise<BiometricAuthResult> {
  if (Platform.OS === "web") {
    return {
      success: false,
      error: "Biometria no disponible en web.",
    };
  }

  try {
    const allowDeviceFallback = options.allowDeviceFallback ?? false;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: options.promptMessage ?? "Desbloquea Driver Manager",
      cancelLabel: options.cancelLabel ?? "Cancelar",
      disableDeviceFallback: !allowDeviceFallback,
      fallbackLabel: allowDeviceFallback
        ? options.fallbackLabel ?? "Usar codigo"
        : undefined,
      biometricsSecurityLevel: "strong",
      requireConfirmation: false,
    });

    if (result.success) {
      return {
        success: true,
      };
    }

    return {
      success: false,
      error: mapBiometricError(result.error),
      warning: "warning" in result ? result.warning : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error biometrico inesperado.",
    };
  }
}

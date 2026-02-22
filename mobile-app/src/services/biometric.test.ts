import { beforeEach, describe, expect, it, vi } from "vitest";

const rnState = vi.hoisted(() => ({
  os: "ios",
}));

const localAuthMocks = vi.hoisted(() => ({
  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
  },
  hasHardwareAsync: vi.fn(async () => true),
  isEnrolledAsync: vi.fn(async () => true),
  supportedAuthenticationTypesAsync: vi.fn(async () => [2]),
  authenticateAsync: vi.fn(async () => ({ success: true })),
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return rnState.os;
    },
  },
}));

vi.mock("expo-local-authentication", () => localAuthMocks);

import {
  authenticateWithBiometrics,
  getBiometricAvailability,
} from "./biometric";

describe("biometric service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rnState.os = "ios";
  });

  it("returns unavailable on web", async () => {
    rnState.os = "web";

    const availability = await getBiometricAvailability();
    expect(availability.isAvailable).toBe(false);
    expect(availability.biometricLabel).toBe("biometria");
  });

  it("resolves Face ID label for facial recognition", async () => {
    rnState.os = "ios";
    localAuthMocks.supportedAuthenticationTypesAsync.mockResolvedValueOnce([
      localAuthMocks.AuthenticationType.FACIAL_RECOGNITION,
    ]);

    const availability = await getBiometricAvailability();
    expect(availability.isAvailable).toBe(true);
    expect(availability.biometricLabel).toBe("Face ID");
  });

  it("resolves huella label for fingerprint on android", async () => {
    rnState.os = "android";
    localAuthMocks.supportedAuthenticationTypesAsync.mockResolvedValueOnce([
      localAuthMocks.AuthenticationType.FINGERPRINT,
    ]);

    const availability = await getBiometricAvailability();
    expect(availability.isAvailable).toBe(true);
    expect(availability.biometricLabel).toBe("huella");
  });

  it("maps lockout auth errors to user-facing message", async () => {
    localAuthMocks.authenticateAsync.mockResolvedValueOnce({
      success: false,
      error: "lockout",
    } as any);

    const result = await authenticateWithBiometrics();
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Biometria bloqueada temporalmente. Usa codigo del dispositivo.",
    );
  });

  it("maps user cancel to cancellation message", async () => {
    localAuthMocks.authenticateAsync.mockResolvedValueOnce({
      success: false,
      error: "user_cancel",
    } as any);

    const result = await authenticateWithBiometrics();
    expect(result.success).toBe(false);
    expect(result.error).toBe("Autenticacion cancelada.");
  });
});

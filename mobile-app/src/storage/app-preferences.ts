import * as SecureStore from "expo-secure-store";

const BIOMETRIC_ENABLED_KEY = "dm_pref_biometric_enabled";

function hasWebStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

async function setItem(key: string, value: string): Promise<void> {
  if (hasWebStorage()) {
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (hasWebStorage()) {
    return window.localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await setItem(BIOMETRIC_ENABLED_KEY, enabled ? "1" : "0");
}

export async function getBiometricEnabled(): Promise<boolean> {
  const raw = await getItem(BIOMETRIC_ENABLED_KEY);
  if (raw === null) return true;
  return raw === "1";
}

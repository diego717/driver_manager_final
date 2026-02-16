import * as SecureStore from "expo-secure-store";

const API_TOKEN_KEY = "dm_api_token";
const API_SECRET_KEY = "dm_api_secret";

export async function setStoredApiToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(API_TOKEN_KEY, token);
}

export async function getStoredApiToken(): Promise<string | null> {
  return SecureStore.getItemAsync(API_TOKEN_KEY);
}

export async function setStoredApiSecret(secret: string): Promise<void> {
  await SecureStore.setItemAsync(API_SECRET_KEY, secret);
}

export async function getStoredApiSecret(): Promise<string | null> {
  return SecureStore.getItemAsync(API_SECRET_KEY);
}

export async function clearStoredAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(API_TOKEN_KEY);
  await SecureStore.deleteItemAsync(API_SECRET_KEY);
}

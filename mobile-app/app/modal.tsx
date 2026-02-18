import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { getAuthMaterial } from "@/src/api/auth";
import {
  extractApiError,
  getApiBaseUrl,
  normalizeApiBaseUrl,
} from "@/src/api/client";
import { listInstallations } from "@/src/api/incidents";
import { clearWebSession, loginWebSession, readStoredWebSession } from "@/src/api/webAuth";
import {
  clearStoredApiBaseUrl,
  clearStoredAuth,
  getStoredApiBaseUrl,
  getStoredApiSecret,
  getStoredApiToken,
  setStoredApiBaseUrl,
  setStoredApiSecret,
  setStoredApiToken,
} from "@/src/storage/secure";

export default function ApiSettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [webSigningIn, setWebSigningIn] = useState(false);
  const [webClearing, setWebClearing] = useState(false);

  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [webLoginPassword, setWebLoginPassword] = useState("");
  const [webSessionExpiresAt, setWebSessionExpiresAt] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const [baseUrlFromStorage, setBaseUrlFromStorage] = useState(false);
  const [authFromStorage, setAuthFromStorage] = useState(false);
  const hasWebSession = Boolean(webSessionExpiresAt && Date.parse(webSessionExpiresAt) > Date.now());

  const notify = (title: string, message: string) => {
    setFeedbackMessage(`${title}: ${message}`);
    Alert.alert(title, message);
  };

  const loadConfig = async () => {
    try {
      setLoading(true);
      const envAuth = getAuthMaterial();
      const [storedBaseUrl, storedToken, storedSecret, webSession] = await Promise.all([
        getStoredApiBaseUrl(),
        getStoredApiToken(),
        getStoredApiSecret(),
        readStoredWebSession(),
      ]);

      const hasStoredBaseUrl = Boolean(storedBaseUrl);
      const hasStoredAuth = Boolean(storedToken && storedSecret);

      setApiBaseUrl(storedBaseUrl ?? getApiBaseUrl());
      setApiToken(storedToken ?? envAuth.token);
      setApiSecret(storedSecret ?? envAuth.secret);

      setBaseUrlFromStorage(hasStoredBaseUrl);
      setAuthFromStorage(hasStoredAuth);
      setWebSessionExpiresAt(webSession.expiresAt);
    } catch (error) {
      notify("Error", `No se pudo cargar configuracion: ${extractApiError(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const onSave = async () => {
    const normalizedBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
    if (!normalizedBaseUrl) {
      notify("Dato invalido", "API Base URL es obligatoria.");
      return;
    }

    try {
      setSaving(true);
      await Promise.all([
        setStoredApiBaseUrl(normalizedBaseUrl),
        setStoredApiToken(apiToken),
        setStoredApiSecret(apiSecret),
      ]);

      setApiBaseUrl(normalizedBaseUrl);
      setApiToken(apiToken.trim());
      setApiSecret(apiSecret.trim());
      setBaseUrlFromStorage(true);
      setAuthFromStorage(Boolean(apiToken.trim() && apiSecret.trim()));
      notify("Configuracion guardada", "La app usara estos valores en las requests.");
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const onResetToEnv = async () => {
    try {
      setSaving(true);
      await Promise.all([
        clearStoredApiBaseUrl(),
        clearStoredAuth(),
        clearWebSession(),
      ]);

      const envAuth = getAuthMaterial();
      setApiBaseUrl(getApiBaseUrl());
      setApiToken(envAuth.token);
      setApiSecret(envAuth.secret);
      setBaseUrlFromStorage(false);
      setAuthFromStorage(false);
      setWebSessionExpiresAt(null);
      setWebLoginPassword("");
      notify("Valores restablecidos", "Se volvera a usar la configuracion de .env.");
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const onTestConnection = async () => {
    try {
      setTesting(true);
      const records = await listInstallations();
      notify("Conexion OK", `Instalaciones visibles: ${records.length}`);
    } catch (error) {
      notify("Fallo de conexion", extractApiError(error));
    } finally {
      setTesting(false);
    }
  };

  const onWebSignIn = async () => {
    const password = webLoginPassword.trim();
    if (!password) {
      notify("Dato invalido", "Ingresa WEB_LOGIN_PASSWORD.");
      return;
    }

    try {
      setWebSigningIn(true);
      const login = await loginWebSession(password);
      setWebSessionExpiresAt(login.expires_at);
      setWebLoginPassword("");
      notify("Sesion web iniciada", `Token valido hasta ${login.expires_at}`);
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setWebSigningIn(false);
    }
  };

  const onClearWebSession = async () => {
    try {
      setWebClearing(true);
      await clearWebSession();
      setWebSessionExpiresAt(null);
      notify("Sesion web eliminada", "Se limpio el token web guardado.");
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setWebClearing(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0b7a75" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Configuracion API</Text>
      <Text style={styles.subtitle}>
        Define URL/Auth y sesion web directamente desde la app.
      </Text>

      <Text style={styles.sourceText}>
        Base URL actual: {baseUrlFromStorage ? "SecureStore" : ".env"}
      </Text>
      <Text style={styles.sourceText}>
        Auth actual: {authFromStorage ? "SecureStore" : ".env o modo dev"}
      </Text>
      <Text style={styles.sourceText}>
        Sesion web: {hasWebSession ? `Activa hasta ${webSessionExpiresAt}` : "No activa"}
      </Text>
      {feedbackMessage ? (
        <View style={styles.feedbackBox}>
          <Text style={styles.feedbackText}>{feedbackMessage}</Text>
        </View>
      ) : null}

      <Text style={styles.label}>API Base URL</Text>
      <TextInput
        value={apiBaseUrl}
        onChangeText={setApiBaseUrl}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholder="https://tu-worker.workers.dev"
        placeholderTextColor="#808080"
      />

      <Text style={styles.label}>API Token</Text>
      <TextInput
        value={apiToken}
        onChangeText={setApiToken}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholder="Opcional en modo dev"
        placeholderTextColor="#808080"
      />

      <Text style={styles.label}>API Secret</Text>
      <TextInput
        value={apiSecret}
        onChangeText={setApiSecret}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={styles.input}
        placeholder="Opcional en modo dev"
        placeholderTextColor="#808080"
      />

      <TouchableOpacity
        style={[styles.primaryButton, saving && styles.buttonDisabled]}
        onPress={onSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.primaryButtonText}>Guardar</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryButton, testing && styles.buttonDisabled]}
        onPress={onTestConnection}
        disabled={testing || saving || webSigningIn || webClearing}
      >
        {testing ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.secondaryButtonText}>Probar conexion</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>Acceso Web (Bearer)</Text>
      <TextInput
        value={webLoginPassword}
        onChangeText={setWebLoginPassword}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={styles.input}
        placeholder="WEB_LOGIN_PASSWORD"
        placeholderTextColor="#808080"
      />

      <TouchableOpacity
        style={[styles.secondaryButton, webSigningIn && styles.buttonDisabled]}
        onPress={onWebSignIn}
        disabled={webSigningIn || saving || testing || webClearing}
      >
        {webSigningIn ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.secondaryButtonText}>Iniciar sesion web</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.warningButton, webClearing && styles.buttonDisabled]}
        onPress={onClearWebSession}
        disabled={webClearing || saving || testing || webSigningIn}
      >
        {webClearing ? (
          <ActivityIndicator color="#7f1d1d" />
        ) : (
          <Text style={styles.warningButtonText}>Cerrar sesion web</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.warningButton, saving && styles.buttonDisabled]}
        onPress={onResetToEnv}
        disabled={saving || testing || webSigningIn || webClearing}
      >
        <Text style={styles.warningButtonText}>Restablecer a .env</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    padding: 20,
    gap: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a",
  },
  subtitle: {
    color: "#475569",
    fontSize: 13,
    marginBottom: 8,
  },
  sourceText: {
    color: "#64748b",
    fontSize: 12,
  },
  feedbackBox: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#bae6fd",
    backgroundColor: "#f0f9ff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  feedbackText: {
    color: "#0c4a6e",
    fontSize: 12,
  },
  label: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "600",
    color: "#1e293b",
  },
  sectionLabel: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
  },
  primaryButton: {
    marginTop: 10,
    borderRadius: 10,
    backgroundColor: "#0b7a75",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 15,
  },
  warningButton: {
    borderRadius: 10,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  warningButtonText: {
    color: "#7f1d1d",
    fontWeight: "700",
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});

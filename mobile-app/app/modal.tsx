import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { extractApiError, getApiBaseUrl, normalizeApiBaseUrl } from "@/src/api/client";
import { listInstallations } from "@/src/api/incidents";
import { clearWebSession, loginWebSession, readStoredWebSession } from "@/src/api/webAuth";
import {
  clearStoredApiBaseUrl,
  getStoredApiBaseUrl,
  setStoredApiBaseUrl,
  type ThemeMode,
} from "@/src/storage/secure";
import { useThemePreference } from "@/src/theme/theme-preference";

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function validateApiBaseUrl(value: string): string {
  const normalized = normalizeApiBaseUrl(value);
  if (!normalized) {
    throw new Error("API Base URL es obligatoria.");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("API Base URL no es valida.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("API Base URL debe iniciar con http:// o https://");
  }

  if (parsed.protocol === "http:" && !isLocalHost(parsed.hostname)) {
    throw new Error("Usa https:// para entornos remotos.");
  }

  if (parsed.pathname && parsed.pathname !== "/" && parsed.pathname.toLowerCase() !== "/web") {
    throw new Error("API Base URL debe apuntar al dominio base del Worker (sin paths).");
  }

  return normalizeApiBaseUrl(parsed.toString());
}

function formatDateTime(value: string | null): string {
  if (!value) return "Nunca";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export default function ApiSettingsScreen() {
  const { mode, resolvedScheme, setMode } = useThemePreference();
  const isDark = resolvedScheme === "dark";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [webSigningIn, setWebSigningIn] = useState(false);
  const [webClearing, setWebClearing] = useState(false);
  const [changingTheme, setChangingTheme] = useState(false);

  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [webLoginUsername, setWebLoginUsername] = useState("");
  const [webLoginPassword, setWebLoginPassword] = useState("");
  const [webSessionUsername, setWebSessionUsername] = useState<string | null>(null);
  const [webSessionRole, setWebSessionRole] = useState<string | null>(null);
  const [webSessionExpiresAt, setWebSessionExpiresAt] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const [baseUrlFromStorage, setBaseUrlFromStorage] = useState(false);
  const hasWebSession = useMemo(
    () => Boolean(webSessionExpiresAt && Date.parse(webSessionExpiresAt) > Date.now()),
    [webSessionExpiresAt],
  );
  const palette = {
    screenBg: isDark ? "#020617" : "#f8fafc",
    title: isDark ? "#e2e8f0" : "#0f172a",
    textSecondary: isDark ? "#94a3b8" : "#475569",
    textMuted: isDark ? "#94a3b8" : "#64748b",
    label: isDark ? "#cbd5e1" : "#1e293b",
    inputBg: isDark ? "#111827" : "#ffffff",
    inputBorder: isDark ? "#334155" : "#cbd5e1",
    placeholder: isDark ? "#64748b" : "#808080",
    cardBg: isDark ? "#082f49" : "#f0f9ff",
    cardBorder: isDark ? "#0369a1" : "#bae6fd",
    cardText: isDark ? "#bae6fd" : "#0c4a6e",
    secondaryBg: isDark ? "#0f172a" : "#ffffff",
    secondaryText: isDark ? "#cbd5e1" : "#0f172a",
    themeChipBg: isDark ? "#0f172a" : "#ffffff",
    themeChipBorder: isDark ? "#334155" : "#cbd5e1",
  };

  const notify = (title: string, message: string) => {
    setFeedbackMessage(`${title}: ${message}`);
    Alert.alert(title, message);
  };

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const [storedBaseUrl, webSession] = await Promise.all([
        getStoredApiBaseUrl(),
        readStoredWebSession(),
      ]);

      setApiBaseUrl(storedBaseUrl ?? getApiBaseUrl());
      setBaseUrlFromStorage(Boolean(storedBaseUrl));
      setWebSessionExpiresAt(webSession.expiresAt);
      setWebSessionUsername(webSession.username);
      setWebSessionRole(webSession.role);
    } catch (error) {
      notify("Error", `No se pudo cargar configuracion: ${extractApiError(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadConfig();
    }, [loadConfig]),
  );

  const onSave = async () => {
    try {
      const normalizedBaseUrl = validateApiBaseUrl(apiBaseUrl);
      setSaving(true);
      await setStoredApiBaseUrl(normalizedBaseUrl);

      setApiBaseUrl(normalizedBaseUrl);
      setBaseUrlFromStorage(true);
      notify("Configuracion guardada", "La app usara esta URL en las requests.");
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const performResetToEnv = async () => {
    try {
      setSaving(true);
      await Promise.all([clearStoredApiBaseUrl(), clearWebSession()]);

      setApiBaseUrl(getApiBaseUrl());
      setBaseUrlFromStorage(false);
      setWebSessionExpiresAt(null);
      setWebSessionUsername(null);
      setWebSessionRole(null);
      setWebLoginUsername("");
      setWebLoginPassword("");
      notify("Valores restablecidos", "Se volvera a usar la configuracion de .env.");
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const onResetToEnv = () => {
    Alert.alert(
      "Confirmar restablecer",
      "Esto borra la URL guardada y la sesion web almacenada. ¿Deseas continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Restablecer",
          style: "destructive",
          onPress: () => {
            void performResetToEnv();
          },
        },
      ],
    );
  };

  const onTestConnection = async () => {
    if (!hasWebSession) {
      notify("Falta autenticacion", "Inicia sesion web para probar conexion.");
      return;
    }

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
    const username = webLoginUsername.trim().toLowerCase();
    const password = webLoginPassword;
    if (!username) {
      notify("Dato invalido", "Ingresa usuario web.");
      return;
    }
    if (!password.trim()) {
      notify("Dato invalido", "Ingresa contrasena web.");
      return;
    }

    try {
      setWebSigningIn(true);
      const login = await loginWebSession(username, password);
      setWebSessionExpiresAt(login.expires_at);
      setWebSessionUsername(login.user.username);
      setWebSessionRole(login.user.role);
      setWebLoginPassword("");
      notify(
        "Sesion web iniciada",
        `Usuario ${login.user.username} (${login.user.role}) valido hasta ${login.expires_at}`,
      );
    } catch (error) {
      setWebLoginPassword("");
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
      setWebSessionUsername(null);
      setWebSessionRole(null);
      notify("Sesion web eliminada", "Se limpio el token web guardado.");
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setWebClearing(false);
    }
  };

  const onChangeThemeMode = async (nextMode: ThemeMode) => {
    if (nextMode === mode) return;

    try {
      setChangingTheme(true);
      await setMode(nextMode);
      notify("Tema actualizado", `Modo: ${nextMode}`);
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setChangingTheme(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: palette.screenBg }]}>
        <ActivityIndicator size="large" color="#0b7a75" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: palette.screenBg }]}>
      <Text style={[styles.title, { color: palette.title }]}>Configuracion y acceso</Text>
      <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
        Modo simple: URL del Worker + login web por usuario y contrasena.
      </Text>

      <Text style={[styles.sourceText, { color: palette.textMuted }]}>
        Base URL actual: {baseUrlFromStorage ? "SecureStore" : ".env"}
      </Text>
      <Text style={[styles.sourceText, { color: palette.textMuted }]}>
        Sesion web: {hasWebSession ? `Activa hasta ${webSessionExpiresAt}` : "No activa"}
      </Text>
      <Text style={[styles.sourceText, { color: palette.textMuted }]}>
        Usuario web: {webSessionUsername ? `${webSessionUsername} (${webSessionRole || "n/a"})` : "No autenticado"}
      </Text>
      <Text style={[styles.sourceText, { color: palette.textMuted }]}>
        Tema actual: {mode} ({resolvedScheme})
      </Text>
      {feedbackMessage ? (
        <View style={[styles.feedbackBox, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
          <Text style={[styles.feedbackText, { color: palette.cardText }]}>{feedbackMessage}</Text>
        </View>
      ) : null}

      <Text style={[styles.sectionLabel, { color: palette.title }]}>Apariencia</Text>
      <View style={styles.themeSelectorRow}>
        {(["light", "dark", "system"] as ThemeMode[]).map((themeOption) => {
          const selected = mode === themeOption;
          return (
            <TouchableOpacity
              key={themeOption}
              style={[
                styles.themeChip,
                { backgroundColor: palette.themeChipBg, borderColor: palette.themeChipBorder },
                selected && styles.themeChipSelected,
              ]}
              onPress={() => onChangeThemeMode(themeOption)}
              disabled={changingTheme || loading || saving || testing}
            >
              <Text style={[styles.themeChipText, { color: palette.secondaryText }, selected && styles.themeChipTextSelected]}>
                {themeOption === "light" ? "Claro" : themeOption === "dark" ? "Oscuro" : "Auto"}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, { color: palette.title }]}>Conexion</Text>
      <Text style={[styles.label, { color: palette.label }]}>API Base URL</Text>
      <TextInput
        value={apiBaseUrl}
        onChangeText={setApiBaseUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={Platform.OS === "ios" ? "url" : "default"}
        style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.title }]}
        placeholder="https://tu-worker.workers.dev"
        placeholderTextColor={palette.placeholder}
      />
      <Text style={[styles.hintText, { color: palette.textMuted }]}>
        Usa https:// para remoto. Debe ser el dominio base del Worker, sin paths.
      </Text>

      <TouchableOpacity
        style={[styles.primaryButton, saving && styles.buttonDisabled]}
        onPress={onSave}
        disabled={saving || changingTheme}
      >
        {saving ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.primaryButtonText}>Guardar URL</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.secondaryButton,
          { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder },
          (!hasWebSession || testing) && styles.buttonDisabled,
        ]}
        onPress={onTestConnection}
        disabled={
          !hasWebSession ||
          testing ||
          saving ||
          webSigningIn ||
          webClearing ||
          changingTheme
        }
      >
        {testing ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Probar conexion</Text>
        )}
      </TouchableOpacity>

      <Text style={[styles.sectionLabel, { color: palette.title }]}>Login web</Text>
      <TextInput
        value={webLoginUsername}
        onChangeText={setWebLoginUsername}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.title }]}
        placeholder="Usuario web"
        placeholderTextColor={palette.placeholder}
      />
      <TextInput
        value={webLoginPassword}
        onChangeText={setWebLoginPassword}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.title }]}
        placeholder="Contrasena"
        placeholderTextColor={palette.placeholder}
      />

      <TouchableOpacity
        style={[
          styles.secondaryButton,
          { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder },
          webSigningIn && styles.buttonDisabled,
        ]}
        onPress={onWebSignIn}
        disabled={webSigningIn || saving || testing || webClearing || changingTheme}
      >
        {webSigningIn ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Iniciar sesion</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.warningButton, webClearing && styles.buttonDisabled]}
        onPress={onClearWebSession}
        disabled={webClearing || saving || testing || webSigningIn || changingTheme}
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
        disabled={saving || testing || webSigningIn || webClearing || changingTheme}
      >
        <Text style={styles.warningButtonText}>Restablecer URL a .env</Text>
      </TouchableOpacity>

      <Text style={[styles.hintText, { color: palette.textMuted }]}>
        Si es la primera vez y no tienes usuario web creado, inicializa el primer admin con
        /web/auth/bootstrap desde un cliente seguro (curl/Postman).
      </Text>
      <Text style={[styles.hintText, { color: palette.textMuted }]}>Expira: {formatDateTime(webSessionExpiresAt)}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  container: {
    padding: 20,
    gap: 10,
    backgroundColor: "#f8fafc",
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
  hintText: {
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
  themeSelectorRow: {
    flexDirection: "row",
    gap: 8,
  },
  themeChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 999,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  themeChipSelected: {
    backgroundColor: "#0b7a75",
    borderColor: "#0b7a75",
  },
  themeChipText: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 12,
  },
  themeChipTextSelected: {
    color: "#ffffff",
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

import { useEffect, useState } from "react";
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

import { getAuthMaterial } from "@/src/api/auth";
import {
  extractApiError,
  getApiBaseUrl,
  normalizeApiBaseUrl,
} from "@/src/api/client";
import { listInstallations } from "@/src/api/incidents";
import {
  bootstrapWebUser,
  clearWebSession,
  forceWebUserPassword,
  listWebUsers,
  loginWebSession,
  readStoredWebSession,
  updateWebUser,
  type WebManagedUser,
} from "@/src/api/webAuth";
import {
  clearStoredApiBaseUrl,
  clearStoredAuth,
  getStoredApiBaseUrl,
  getStoredApiSecret,
  getStoredApiToken,
  setStoredApiBaseUrl,
  setStoredApiSecret,
  setStoredApiToken,
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

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "No configurado";
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}****`;
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Nunca";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export default function ApiSettingsScreen() {
  const { mode, resolvedScheme, setMode } = useThemePreference();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [webSigningIn, setWebSigningIn] = useState(false);
  const [webBootstrapping, setWebBootstrapping] = useState(false);
  const [webClearing, setWebClearing] = useState(false);
  const [changingTheme, setChangingTheme] = useState(false);
  const [showSensitiveEditor, setShowSensitiveEditor] = useState(false);

  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [webLoginUsername, setWebLoginUsername] = useState("");
  const [webLoginPassword, setWebLoginPassword] = useState("");
  const [webBootstrapPassword, setWebBootstrapPassword] = useState("");
  const [webSessionUsername, setWebSessionUsername] = useState<string | null>(null);
  const [webSessionRole, setWebSessionRole] = useState<string | null>(null);
  const [webSessionExpiresAt, setWebSessionExpiresAt] = useState<string | null>(null);
  const [webUsers, setWebUsers] = useState<WebManagedUser[]>([]);
  const [loadingWebUsers, setLoadingWebUsers] = useState(false);
  const [updatingWebUserId, setUpdatingWebUserId] = useState<number | null>(null);
  const [forcingPasswordUserId, setForcingPasswordUserId] = useState<number | null>(null);
  const [passwordDraftByUser, setPasswordDraftByUser] = useState<Record<number, string>>({});
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const [baseUrlFromStorage, setBaseUrlFromStorage] = useState(false);
  const [authFromStorage, setAuthFromStorage] = useState(false);
  const hasWebSession = Boolean(webSessionExpiresAt && Date.parse(webSessionExpiresAt) > Date.now());
  const hasHmacAuth = Boolean(apiToken.trim() && apiSecret.trim());
  const accessMode = hasWebSession ? "Web Bearer" : hasHmacAuth ? "HMAC" : "Dev (sin auth)";

  const notify = (title: string, message: string) => {
    setFeedbackMessage(`${title}: ${message}`);
    Alert.alert(title, message);
  };

  const updateUserInState = (updatedUser: WebManagedUser) => {
    setWebUsers((current) =>
      current.map((item) => (item.id === updatedUser.id ? updatedUser : item)),
    );
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
      setWebSessionUsername(webSession.username);
      setWebSessionRole(webSession.role);
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
    try {
      const normalizedBaseUrl = validateApiBaseUrl(apiBaseUrl);
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
      setWebSessionUsername(null);
      setWebSessionRole(null);
      setWebUsers([]);
      setWebLoginUsername("");
      setWebLoginPassword("");
      setWebBootstrapPassword("");
      setPasswordDraftByUser({});
      setShowSensitiveEditor(false);
      notify("Valores restablecidos", "Se volvera a usar la configuracion de .env.");
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const onTestConnection = async () => {
    if (!hasWebSession && !hasHmacAuth) {
      notify(
        "Falta autenticacion",
        "Primero inicia sesion web o configura API Token + API Secret.",
      );
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
    const password = webLoginPassword.trim();
    if (!username) {
      notify("Dato invalido", "Ingresa usuario web.");
      return;
    }
    if (!password) {
      notify("Dato invalido", "Ingresa contraseña web.");
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
      await onLoadWebUsers();
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setWebSigningIn(false);
    }
  };

  const onWebBootstrap = async () => {
    const username = webLoginUsername.trim().toLowerCase();
    const password = webLoginPassword.trim();
    const bootstrapPassword = webBootstrapPassword.trim();

    if (!bootstrapPassword) {
      notify("Dato invalido", "Ingresa bootstrap password.");
      return;
    }
    if (!username) {
      notify("Dato invalido", "Ingresa el usuario inicial.");
      return;
    }
    if (!password) {
      notify("Dato invalido", "Ingresa la contraseña inicial.");
      return;
    }

    try {
      setWebBootstrapping(true);
      const bootstrapped = await bootstrapWebUser({
        bootstrapPassword,
        username,
        password,
        role: "admin",
      });
      setWebSessionExpiresAt(bootstrapped.expires_at);
      setWebSessionUsername(bootstrapped.user.username);
      setWebSessionRole(bootstrapped.user.role);
      setWebBootstrapPassword("");
      setWebLoginPassword("");
      notify(
        "Usuario inicial creado",
        `Sesion de ${bootstrapped.user.username} activa hasta ${bootstrapped.expires_at}`,
      );
      await onLoadWebUsers();
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setWebBootstrapping(false);
    }
  };

  const onClearWebSession = async () => {
    try {
      setWebClearing(true);
      await clearWebSession();
      setWebSessionExpiresAt(null);
      setWebSessionUsername(null);
      setWebSessionRole(null);
      setWebUsers([]);
      setPasswordDraftByUser({});
      notify("Sesion web eliminada", "Se limpio el token web guardado.");
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setWebClearing(false);
    }
  };

  const onLoadWebUsers = async () => {
    try {
      setLoadingWebUsers(true);
      const users = await listWebUsers();
      setWebUsers(users);
      if (!users.length) {
        notify("Sin usuarios", "No hay usuarios web para mostrar.");
      }
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setLoadingWebUsers(false);
    }
  };

  const onToggleUserActive = async (user: WebManagedUser) => {
    try {
      setUpdatingWebUserId(user.id);
      const updated = await updateWebUser({
        userId: user.id,
        isActive: !user.is_active,
      });
      updateUserInState(updated);
      notify(
        "Usuario actualizado",
        `${updated.username}: ${updated.is_active ? "activo" : "inactivo"}.`,
      );
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setUpdatingWebUserId(null);
    }
  };

  const onToggleUserRole = async (user: WebManagedUser) => {
    if (user.role === "super_admin") {
      notify("No permitido", "No se cambia role de super_admin desde esta pantalla.");
      return;
    }

    const nextRole = user.role === "viewer" ? "admin" : "viewer";
    try {
      setUpdatingWebUserId(user.id);
      const updated = await updateWebUser({
        userId: user.id,
        role: nextRole,
      });
      updateUserInState(updated);
      notify("Rol actualizado", `${updated.username}: ahora es ${updated.role}.`);
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setUpdatingWebUserId(null);
    }
  };

  const onForcePasswordChange = async (user: WebManagedUser) => {
    const draft = (passwordDraftByUser[user.id] ?? "").trim();
    if (!draft) {
      notify("Dato invalido", `Ingresa nueva contrasena para ${user.username}.`);
      return;
    }

    try {
      setForcingPasswordUserId(user.id);
      await forceWebUserPassword({
        userId: user.id,
        newPassword: draft,
      });
      setPasswordDraftByUser((current) => ({
        ...current,
        [user.id]: "",
      }));
      notify("Contrasena actualizada", `Se forzo cambio para ${user.username}.`);
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setForcingPasswordUserId(null);
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
      <Text style={styles.sourceText}>
        Usuario web: {webSessionUsername ? `${webSessionUsername} (${webSessionRole || "n/a"})` : "No autenticado"}
      </Text>
      <Text style={styles.sourceText}>Modo de acceso: {accessMode}</Text>
      <Text style={styles.sourceText}>
        Tema actual: {mode} ({resolvedScheme})
      </Text>
      {feedbackMessage ? (
        <View style={styles.feedbackBox}>
          <Text style={styles.feedbackText}>{feedbackMessage}</Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>Apariencia</Text>
      <View style={styles.themeSelectorRow}>
        {(["light", "dark", "system"] as ThemeMode[]).map((themeOption) => {
          const selected = mode === themeOption;
          return (
            <TouchableOpacity
              key={themeOption}
              style={[styles.themeChip, selected && styles.themeChipSelected]}
              onPress={() => onChangeThemeMode(themeOption)}
              disabled={changingTheme || loading || saving || testing}
            >
              <Text style={[styles.themeChipText, selected && styles.themeChipTextSelected]}>
                {themeOption === "light" ? "Claro" : themeOption === "dark" ? "Oscuro" : "Auto"}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>API Base URL</Text>
      <TextInput
        value={apiBaseUrl}
        onChangeText={setApiBaseUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={Platform.OS === "ios" ? "url" : "default"}
        style={styles.input}
        placeholder="https://tu-worker.workers.dev"
        placeholderTextColor="#808080"
      />
      <Text style={styles.hintText}>
        Usa `https://` para remoto. `http://localhost` solo en desarrollo local.
      </Text>

      <Text style={styles.sectionLabel}>Credenciales HMAC</Text>
      <View style={styles.secretSummary}>
        <Text style={styles.secretLine}>Token: {maskSecret(apiToken)}</Text>
        <Text style={styles.secretLine}>Secret: {maskSecret(apiSecret)}</Text>
      </View>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => setShowSensitiveEditor((prev) => !prev)}
        disabled={saving || testing || webSigningIn || webBootstrapping || webClearing || changingTheme}
      >
        <Text style={styles.secondaryButtonText}>
          {showSensitiveEditor ? "Ocultar edicion sensible" : "Editar credenciales HMAC"}
        </Text>
      </TouchableOpacity>

      {showSensitiveEditor ? (
        <>
          <Text style={styles.label}>API Token</Text>
          <TextInput
            value={apiToken}
            onChangeText={setApiToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
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
        </>
      ) : null}

      <TouchableOpacity
        style={[styles.primaryButton, saving && styles.buttonDisabled]}
        onPress={onSave}
        disabled={saving || changingTheme}
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
        disabled={testing || saving || webSigningIn || webBootstrapping || webClearing || changingTheme}
      >
        {testing ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.secondaryButtonText}>Probar conexion</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>Acceso Web (usuario + contrasena)</Text>
      <TextInput
        value={webLoginUsername}
        onChangeText={setWebLoginUsername}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholder="Usuario web (ej: admin_root)"
        placeholderTextColor="#808080"
      />
      <TextInput
        value={webLoginPassword}
        onChangeText={setWebLoginPassword}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={styles.input}
        placeholder="Contrasena del usuario web"
        placeholderTextColor="#808080"
      />
      <TextInput
        value={webBootstrapPassword}
        onChangeText={setWebBootstrapPassword}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={styles.input}
        placeholder="Bootstrap password (solo primera vez)"
        placeholderTextColor="#808080"
      />

      <TouchableOpacity
        style={[styles.secondaryButton, webSigningIn && styles.buttonDisabled]}
        onPress={onWebSignIn}
        disabled={webSigningIn || saving || testing || webBootstrapping || webClearing || changingTheme}
      >
        {webSigningIn ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.secondaryButtonText}>Iniciar sesion web</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryButton, webBootstrapping && styles.buttonDisabled]}
        onPress={onWebBootstrap}
        disabled={webBootstrapping || saving || testing || webSigningIn || webClearing || changingTheme}
      >
        {webBootstrapping ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.secondaryButtonText}>Inicializar primer usuario</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>Gestion de usuarios web</Text>
      <Text style={styles.hintText}>
        Requiere sesion web admin/super_admin para listar, activar/desactivar y cambiar contrasenas.
      </Text>

      <TouchableOpacity
        style={[styles.secondaryButton, loadingWebUsers && styles.buttonDisabled]}
        onPress={onLoadWebUsers}
        disabled={
          loadingWebUsers ||
          saving ||
          testing ||
          webSigningIn ||
          webBootstrapping ||
          webClearing ||
          changingTheme
        }
      >
        {loadingWebUsers ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.secondaryButtonText}>Cargar usuarios web</Text>
        )}
      </TouchableOpacity>

      {webUsers.length === 0 ? (
        <Text style={styles.hintText}>Sin usuarios cargados.</Text>
      ) : (
        <View style={styles.webUsersList}>
          {webUsers.map((user) => {
            const isBusy = updatingWebUserId === user.id || forcingPasswordUserId === user.id;
            const passwordDraft = passwordDraftByUser[user.id] ?? "";
            const canToggleRole = user.role !== "super_admin";
            return (
              <View key={user.id} style={styles.webUserCard}>
                <Text style={styles.webUserTitle}>
                  {user.username} ({user.role}) {user.is_active ? "activo" : "inactivo"}
                </Text>
                <Text style={styles.webUserMeta}>Ultimo login: {formatDateTime(user.last_login_at)}</Text>
                <Text style={styles.webUserMeta}>Actualizado: {formatDateTime(user.updated_at)}</Text>

                <View style={styles.webUserActionsRow}>
                  <TouchableOpacity
                    style={styles.webUserActionButton}
                    onPress={() => onToggleUserActive(user)}
                    disabled={isBusy}
                  >
                    <Text style={styles.webUserActionText}>
                      {user.is_active ? "Desactivar" : "Activar"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.webUserActionButton,
                      !canToggleRole && styles.buttonDisabled,
                    ]}
                    onPress={() => onToggleUserRole(user)}
                    disabled={isBusy || !canToggleRole}
                  >
                    <Text style={styles.webUserActionText}>
                      {user.role === "viewer" ? "Pasar a admin" : "Pasar a viewer"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TextInput
                  value={passwordDraft}
                  onChangeText={(next) =>
                    setPasswordDraftByUser((current) => ({
                      ...current,
                      [user.id]: next,
                    }))
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  style={styles.input}
                  placeholder={`Nueva contrasena para ${user.username}`}
                  placeholderTextColor="#808080"
                />
                <TouchableOpacity
                  style={styles.webUserPasswordButton}
                  onPress={() => onForcePasswordChange(user)}
                  disabled={isBusy}
                >
                  {forcingPasswordUserId === user.id ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.webUserPasswordButtonText}>Forzar contrasena</Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      <TouchableOpacity
        style={[styles.warningButton, webClearing && styles.buttonDisabled]}
        onPress={onClearWebSession}
        disabled={webClearing || saving || testing || webSigningIn || webBootstrapping || changingTheme}
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
        disabled={saving || testing || webSigningIn || webBootstrapping || webClearing || changingTheme}
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
  secretSummary: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  secretLine: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
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
  webUsersList: {
    gap: 10,
  },
  webUserCard: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 8,
  },
  webUserTitle: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 14,
  },
  webUserMeta: {
    color: "#64748b",
    fontSize: 12,
  },
  webUserActionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  webUserActionButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    backgroundColor: "#f8fafc",
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  webUserActionText: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 12,
  },
  webUserPasswordButton: {
    borderRadius: 8,
    backgroundColor: "#0b7a75",
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  webUserPasswordButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 13,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});

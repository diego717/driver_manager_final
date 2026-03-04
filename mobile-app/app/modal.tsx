import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Keyboard,
  type LayoutChangeEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
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
import { useAppPalette } from "@/src/theme/palette";
import { useThemePreference } from "@/src/theme/theme-preference";
import { fontFamilies } from "@/src/theme/typography";

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

function formatRelativeTimeUntil(value: string | null): string {
  if (!value) return "sin vencimiento";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "sin fecha valida";
  const diffMs = parsed - Date.now();
  if (diffMs <= 0) return "expirada";

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `vence en ${minutes} min`;
  return `vence en ${hours}h ${minutes}m`;
}

export default function ApiSettingsScreen() {
  const { mode, resolvedScheme, setMode } = useThemePreference();
  const palette = useAppPalette();
  const scrollViewRef = useRef<ScrollView | null>(null);

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
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [loginSectionY, setLoginSectionY] = useState(0);

  const [baseUrlFromStorage, setBaseUrlFromStorage] = useState(false);
  const hasWebSession = useMemo(
    () => Boolean(webSessionExpiresAt && Date.parse(webSessionExpiresAt) > Date.now()),
    [webSessionExpiresAt],
  );
  const sessionStatusTitle = hasWebSession ? "Conectado" : "Sin sesion activa";
  const sessionStatusSubtitle = hasWebSession
    ? formatRelativeTimeUntil(webSessionExpiresAt)
    : "Inicia sesion para operar con la API";
  const isAutoTheme = mode === "system";
  const isDarkMode = resolvedScheme === "dark";
  const themeSummary = isAutoTheme
    ? `Auto (${resolvedScheme === "dark" ? "oscuro" : "claro"})`
    : resolvedScheme === "dark"
      ? "Oscuro"
      : "Claro";

  const notify = (title: string, message: string, options?: { showAlert?: boolean }) => {
    setFeedbackMessage(`${title}: ${message}`);
    if (options?.showAlert === false) return;
    Alert.alert(title, message);
  };

  useEffect(() => {
    if (!feedbackMessage) return;
    const timer = setTimeout(() => {
      setFeedbackMessage("");
    }, 5000);
    return () => clearTimeout(timer);
  }, [feedbackMessage]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onKeyboardShow = Keyboard.addListener(showEvent, (event) => {
      const nextHeight = event.endCoordinates?.height ?? 0;
      setKeyboardHeight(nextHeight);
    });
    const onKeyboardHide = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      onKeyboardShow.remove();
      onKeyboardHide.remove();
    };
  }, []);

  const focusLoginSection = () => {
    if (!scrollViewRef.current) return;
    const target = Math.max(0, loginSectionY - 24);
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ y: target, animated: true });
    });
  };

  const onLoginSectionLayout = (event: LayoutChangeEvent) => {
    setLoginSectionY(event.nativeEvent.layout.y);
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
      "Esto borra la URL guardada y la sesion web almacenada. Deseas continuar?",
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
      notify("Sesion iniciada", `Usuario ${login.user.username} (${login.user.role})`);
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
      notify("Sesion cerrada", "Se limpio la sesion web almacenada.");
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
      const nextLabel =
        nextMode === "system" ? `Auto (${resolvedScheme})` : nextMode === "dark" ? "Oscuro" : "Claro";
      notify("Tema actualizado", `Modo: ${nextLabel}`, { showAlert: false });
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setChangingTheme(false);
    }
  };

  const onToggleAutoTheme = (enabled: boolean) => {
    if (changingTheme || loading || saving || testing || webSigningIn || webClearing) return;
    if (enabled) {
      void onChangeThemeMode("system");
      return;
    }
    void onChangeThemeMode(isDarkMode ? "dark" : "light");
  };

  const onToggleDarkTheme = (enabled: boolean) => {
    if (changingTheme || loading || saving || testing || webSigningIn || webClearing) return;
    if (isAutoTheme) return;
    void onChangeThemeMode(enabled ? "dark" : "light");
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: palette.screenBg }]}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.keyboardWrapper, { backgroundColor: palette.screenBg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
    >
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[styles.container, { backgroundColor: palette.screenBg }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        contentInset={{ bottom: keyboardHeight }}
        contentOffset={{ x: 0, y: 0 }}
      >
        <Text style={[styles.title, { color: palette.title }]}>Configuracion y acceso</Text>
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
          Configura conexion API, sesion web y apariencia.
        </Text>

        <View style={[styles.summaryCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
          <Text style={[styles.summaryTitle, { color: hasWebSession ? palette.successText : palette.warningText }]}>
            {sessionStatusTitle}
          </Text>
          <Text style={[styles.summaryBody, { color: palette.textSecondary }]}>{sessionStatusSubtitle}</Text>
          <Text style={[styles.summaryMeta, { color: palette.textMuted }]}>
            Usuario:{" "}
            {webSessionUsername ? `${webSessionUsername} (${webSessionRole || "usuario"})` : "no autenticado"}
          </Text>
        </View>

        {feedbackMessage ? (
          <View style={[styles.feedbackBox, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
            <Text style={[styles.feedbackText, { color: palette.cardText }]}>{feedbackMessage}</Text>
          </View>
        ) : null}

        <View style={[styles.themePanel, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.sectionCardTitle, { color: palette.title }]}>Apariencia</Text>
            <Text style={[styles.sectionHint, { color: palette.textMuted }]}>
              Elige entre modo automatico o manual.
            </Text>
          </View>

          <View style={styles.themeRow}>
            <View style={styles.themeRowText}>
              <Text style={[styles.themeRowTitle, { color: palette.title }]}>Automatico</Text>
              <Text style={[styles.themeRowHint, { color: palette.textMuted }]}>Seguir tema del sistema</Text>
            </View>
            <Switch
              value={isAutoTheme}
              onValueChange={onToggleAutoTheme}
              disabled={changingTheme || loading || saving || testing || webSigningIn || webClearing}
              thumbColor={isAutoTheme ? palette.primaryButtonBg : palette.textMuted}
              trackColor={{ false: palette.themeChipBorder, true: palette.chipSelectedBg }}
            />
          </View>

          <View style={styles.themeRow}>
            <View style={styles.themeRowText}>
              <Text style={[styles.themeRowTitle, { color: palette.title }]}>Modo oscuro</Text>
              <Text style={[styles.themeRowHint, { color: palette.textMuted }]}>
                {isAutoTheme ? "Desactiva Automatico para elegir manualmente" : "Alternar claro/oscuro"}
              </Text>
            </View>
            <Switch
              value={isDarkMode}
              onValueChange={onToggleDarkTheme}
              disabled={
                isAutoTheme || changingTheme || loading || saving || testing || webSigningIn || webClearing
              }
              thumbColor={isDarkMode ? palette.primaryButtonBg : palette.textMuted}
              trackColor={{ false: palette.themeChipBorder, true: palette.chipSelectedBg }}
            />
          </View>

          <Text style={[styles.themeCurrentText, { color: palette.textMuted }]}>Tema aplicado: {themeSummary}</Text>
        </View>

        <TouchableOpacity
          style={[styles.detailsToggle, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
          onPress={() => setShowTechnicalDetails((current) => !current)}
          disabled={loading || saving || testing || webSigningIn || webClearing || changingTheme}
        >
          <Text style={[styles.detailsToggleText, { color: palette.secondaryText }]}>
            {showTechnicalDetails ? "Ocultar detalles tecnicos" : "Mostrar detalles tecnicos"}
          </Text>
        </TouchableOpacity>

        {showTechnicalDetails ? (
          <View style={[styles.detailsPanel, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
            <Text style={[styles.sourceText, { color: palette.textMuted }]}>
              Base URL actual: {apiBaseUrl || "(vacia)"} ({baseUrlFromStorage ? "SecureStore" : ".env"})
            </Text>
            <Text style={[styles.sourceText, { color: palette.textMuted }]}>
              Sesion: {hasWebSession ? `activa (${formatDateTime(webSessionExpiresAt)})` : "no activa"}
            </Text>
            <Text style={[styles.sourceText, { color: palette.textMuted }]}>
              Usuario web:{" "}
              {webSessionUsername ? `${webSessionUsername} (${webSessionRole || "n/a"})` : "No autenticado"}
            </Text>
            <Text style={[styles.sourceText, { color: palette.textMuted }]}>
              Tema: {mode} ({resolvedScheme})
            </Text>
          </View>
        ) : null}

        <View style={[styles.sectionCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.sectionCardTitle, { color: palette.title }]}>Conexion API</Text>
            <Text style={[styles.sectionHint, { color: palette.textMuted }]}>
              Usa el dominio base del Worker, sin rutas.
            </Text>
          </View>
          <Text style={[styles.label, { color: palette.label }]}>API Base URL</Text>
          <TextInput
            value={apiBaseUrl}
            onChangeText={setApiBaseUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={Platform.OS === "ios" ? "url" : "default"}
            style={[
              styles.input,
              { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.title },
            ]}
            placeholder="https://tu-worker.workers.dev"
            placeholderTextColor={palette.placeholder}
          />
          <View style={styles.buttonStack}>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                { backgroundColor: palette.primaryButtonBg },
                saving && styles.buttonDisabled,
              ]}
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
              disabled={!hasWebSession || testing || saving || webSigningIn || webClearing || changingTheme}
            >
              {testing ? (
                <ActivityIndicator color={palette.secondaryText} />
              ) : (
                <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Probar conexion</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View
          onLayout={onLoginSectionLayout}
          style={[styles.sectionCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.sectionCardTitle, { color: palette.title }]}>Sesion web</Text>
            <Text style={[styles.sectionHint, { color: palette.textMuted }]}>
              Se usa para operaciones protegidas de la API.
            </Text>
          </View>
          <TextInput
            value={webLoginUsername}
            onChangeText={setWebLoginUsername}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.title },
            ]}
            placeholder="Usuario web"
            placeholderTextColor={palette.placeholder}
            onFocus={focusLoginSection}
          />
          <TextInput
            value={webLoginPassword}
            onChangeText={setWebLoginPassword}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={[
              styles.input,
              { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.title },
            ]}
            placeholder="Contrasena"
            placeholderTextColor={palette.placeholder}
            onFocus={focusLoginSection}
          />

          <View style={styles.buttonStack}>
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
                <ActivityIndicator color={palette.secondaryText} />
              ) : (
                <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Iniciar sesion</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.warningButton,
                { backgroundColor: palette.warningBg },
                webClearing && styles.buttonDisabled,
              ]}
              onPress={onClearWebSession}
              disabled={webClearing || saving || testing || webSigningIn || changingTheme}
            >
              {webClearing ? (
                <ActivityIndicator color={palette.warningText} />
              ) : (
                <Text style={[styles.warningButtonText, { color: palette.warningText }]}>
                  Cerrar sesion web
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
          <Text style={[styles.sectionCardTitle, { color: palette.title }]}>Opciones avanzadas</Text>
          <TouchableOpacity
            style={[
              styles.warningButton,
              { backgroundColor: palette.warningBg },
              saving && styles.buttonDisabled,
            ]}
            onPress={onResetToEnv}
            disabled={saving || testing || webSigningIn || webClearing || changingTheme}
          >
            <Text style={[styles.warningButtonText, { color: palette.warningText }]}>
              Restablecer URL a .env
            </Text>
          </TouchableOpacity>
          <Text style={[styles.hintText, { color: palette.textMuted }]}>
            Si es la primera vez y no tienes usuario web creado, inicializa el primer admin con
            /web/auth/bootstrap desde un cliente seguro (curl/Postman).
          </Text>
        </View>

        <View style={{ height: keyboardHeight > 0 ? keyboardHeight + 24 : 24 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardWrapper: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 25,
    fontFamily: fontFamilies.bold,
    color: "#0f172a",
  },
  subtitle: {
    color: "#475569",
    fontSize: 13,
    fontFamily: fontFamilies.regular,
    marginBottom: 4,
  },
  sourceText: {
    color: "#64748b",
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  summaryTitle: {
    fontSize: 14,
    fontFamily: fontFamilies.bold,
  },
  summaryBody: {
    fontSize: 12,
    fontFamily: fontFamilies.semibold,
  },
  summaryMeta: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  hintText: {
    color: "#64748b",
    fontSize: 12,
    fontFamily: fontFamilies.regular,
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
    fontFamily: fontFamilies.regular,
  },
  label: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: fontFamilies.semibold,
    color: "#1e293b",
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  sectionCardTitle: {
    fontSize: 14,
    fontFamily: fontFamilies.bold,
  },
  sectionHint: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  cardHeader: {
    gap: 2,
    marginBottom: 2,
  },
  themePanel: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
  },
  themeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  themeRowText: {
    flex: 1,
    gap: 2,
  },
  themeRowTitle: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  themeRowHint: {
    fontFamily: fontFamilies.regular,
    fontSize: 12,
  },
  themeCurrentText: {
    fontFamily: fontFamilies.regular,
    fontSize: 12,
  },
  detailsToggle: {
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  detailsToggleText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  detailsPanel: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
  },
  buttonStack: {
    gap: 10,
    marginTop: 4,
  },
  primaryButton: {
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontFamily: fontFamilies.bold,
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
    fontFamily: fontFamilies.bold,
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
    fontFamily: fontFamilies.bold,
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});

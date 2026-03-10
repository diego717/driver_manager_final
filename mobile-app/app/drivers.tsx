import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
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
import * as DocumentPicker from "expo-document-picker";

import { deleteDriver, listDrivers, uploadDriver, type DriverRecord } from "@/src/api/drivers";
import { extractApiError } from "@/src/api/client";
import { clearWebSession, readStoredWebSession } from "@/src/api/webAuth";
import { evaluateWebSession } from "@/src/api/webSession";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { consumeForceLoginOnOpenFlag } from "@/src/security/startup-session-policy";
import InlineFeedback, { type InlineFeedbackTone } from "@/src/components/InlineFeedback";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

const DRIVER_LIST_LIMIT = 80;

type PickedFile = {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
};

type FeedbackState = {
  tone: InlineFeedbackTone;
  message: string;
} | null;

function formatBytes(bytes: number | null | undefined): string {
  const numeric = Number(bytes || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "N/A";
  const mb = numeric / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  const kb = numeric / 1024;
  return `${kb.toFixed(1)} KB`;
}

export default function DriversScreen() {
  const palette = useAppPalette();
  const router = useRouter();

  const [checkingSession, setCheckingSession] = useState(true);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingKey, setDeletingKey] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [brand, setBrand] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);

  const selectedFileLabel = useMemo(() => {
    if (!pickedFile) return "Sin archivo seleccionado";
    const sizeText = formatBytes(pickedFile.size);
    return `${pickedFile.name} (${sizeText})`;
  }, [pickedFile]);

  const pushFeedback = useCallback((message: string, tone: InlineFeedbackTone = "info") => {
    setFeedback({ message, tone });
  }, []);

  const refreshSessionState = useCallback(async (options?: { showLoader?: boolean }) => {
    const showLoader = options?.showLoader === true;
    if (showLoader) setCheckingSession(true);

    try {
      if (consumeForceLoginOnOpenFlag()) {
        await clearWebSession();
      }
      const storedSession = await readStoredWebSession();
      const resolved = evaluateWebSession(storedSession.accessToken, storedSession.expiresAt);
      if (resolved.state === "expired") {
        await clearWebSession();
      }
      const isActive = resolved.state === "active";
      setHasActiveSession(isActive);
      if (!isActive) {
        setDrivers([]);
      }
      return isActive;
    } finally {
      if (showLoader) setCheckingSession(false);
    }
  }, []);

  const loadDrivers = useCallback(async () => {
    if (!(await refreshSessionState())) return;

    try {
      setLoadingDrivers(true);
      const items = await listDrivers({ limit: DRIVER_LIST_LIMIT });
      setDrivers(items);
      if (!items.length) {
        pushFeedback("Aún no hay drivers cargados para este tenant.", "info");
      }
    } catch (error) {
      pushFeedback(`No se pudieron cargar drivers: ${extractApiError(error)}`, "error");
    } finally {
      setLoadingDrivers(false);
    }
  }, [pushFeedback, refreshSessionState]);

  const onPickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: "*/*",
      });
      if (result.canceled || !result.assets?.length) {
        return;
      }
      const asset = result.assets[0];
      setPickedFile({
        uri: asset.uri,
        name: asset.name || `driver_${Date.now()}.bin`,
        mimeType: asset.mimeType || "application/octet-stream",
        size: typeof asset.size === "number" ? asset.size : undefined,
      });
      pushFeedback(`Archivo listo: ${asset.name || "driver.bin"}`, "info");
    } catch (error) {
      pushFeedback(`No se pudo seleccionar archivo: ${extractApiError(error)}`, "warning");
    }
  }, [pushFeedback]);

  const onUpload = useCallback(async () => {
    if (!(await refreshSessionState())) {
      pushFeedback("Sesión requerida. Inicia sesión web en Configuración y acceso.", "warning");
      router.push("/modal?focus=login");
      return;
    }

    if (!pickedFile) {
      pushFeedback("Selecciona un archivo de driver para subir.", "warning");
      return;
    }
    if (!String(brand).trim()) {
      pushFeedback("La marca es obligatoria.", "warning");
      return;
    }
    if (!String(version).trim()) {
      pushFeedback("La versión es obligatoria.", "warning");
      return;
    }

    try {
      setUploading(true);
      const uploaded = await uploadDriver({
        fileUri: pickedFile.uri,
        fileName: pickedFile.name,
        mimeType: pickedFile.mimeType,
        brand: String(brand).trim(),
        version: String(version).trim(),
        description: String(description || "").trim(),
      });
      pushFeedback(`Driver subido: ${uploaded.brand} ${uploaded.version}`, "success");
      setPickedFile(null);
      setDescription("");
      await loadDrivers();
    } catch (error) {
      pushFeedback(`No se pudo subir el driver: ${extractApiError(error)}`, "error");
    } finally {
      setUploading(false);
    }
  }, [brand, description, loadDrivers, pickedFile, pushFeedback, refreshSessionState, router, version]);

  const onDelete = useCallback(async (driver: DriverRecord) => {
    Alert.alert(
      "Eliminar driver",
      `Se eliminara ${driver.brand} ${driver.version}. Continuar?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              setDeletingKey(driver.key);
              await deleteDriver(driver.key);
              await loadDrivers();
              pushFeedback(`Driver eliminado: ${driver.brand} ${driver.version}`, "success");
            } catch (error) {
              pushFeedback(`No se pudo eliminar: ${extractApiError(error)}`, "error");
            } finally {
              setDeletingKey("");
            }
          },
        },
      ],
    );
  }, [loadDrivers, pushFeedback]);

  useEffect(() => {
    void refreshSessionState({ showLoader: true }).then((active) => {
      if (!active) return;
      void loadDrivers();
    });
  }, [loadDrivers, refreshSessionState]);

  useFocusEffect(
    useCallback(() => {
      void loadDrivers();
    }, [loadDrivers]),
  );

  if (checkingSession) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: palette.screenBg }]}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.hintText, { color: palette.textSecondary }]}>Verificando sesión...</Text>
      </View>
    );
  }

  if (!hasActiveSession) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: palette.screenBg }]}>
        <WebInlineLoginCard
          hint="Inicia sesion web para gestionar drivers en R2."
          onLoginSuccess={async () => {
            await loadDrivers();
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { backgroundColor: palette.screenBg }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: palette.textPrimary }]}>Drivers R2</Text>
      <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
        Sube paquetes de drivers al bucket R2 y mantenlos disponibles por marca/versión.
      </Text>
      {feedback ? (
        <InlineFeedback message={feedback.message} tone={feedback.tone} />
      ) : null}

      <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
        <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Subir driver</Text>
        <Text style={[styles.label, { color: palette.label }]}>Marca</Text>
        <TextInput
          value={brand}
          onChangeText={setBrand}
          style={[
            styles.input,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          placeholder="Ej: Zebra"
          placeholderTextColor={palette.placeholder}
        />

        <Text style={[styles.label, { color: palette.label }]}>Versión</Text>
        <TextInput
          value={version}
          onChangeText={setVersion}
          style={[
            styles.input,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          placeholder="Ej: v1.2.3"
          placeholderTextColor={palette.placeholder}
        />

        <Text style={[styles.label, { color: palette.label }]}>Descripción (opcional)</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          style={[
            styles.input,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          placeholder="Notas del paquete"
          placeholderTextColor={palette.placeholder}
        />

        <TouchableOpacity
          style={[styles.secondaryButton, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
          onPress={() => {
            void onPickFile();
          }}
          accessibilityRole="button"
          accessibilityLabel="Seleccionar archivo de driver"
          activeOpacity={0.88}
        >
          <Text style={[styles.secondaryButtonText, { color: palette.refreshText }]}>Seleccionar archivo</Text>
        </TouchableOpacity>

        <Text style={[styles.fileLabel, { color: palette.textMuted }]}>{selectedFileLabel}</Text>

        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: palette.primaryButtonBg },
            (uploading || !pickedFile) && styles.buttonDisabled,
          ]}
          onPress={() => {
            void onUpload();
          }}
          disabled={uploading || !pickedFile}
          accessibilityRole="button"
          accessibilityLabel="Subir driver"
          activeOpacity={0.86}
        >
          {uploading ? (
            <ActivityIndicator color={palette.primaryButtonText} />
          ) : (
            <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>Subir driver</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
        <View style={styles.listHeader}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Drivers disponibles</Text>
          <TouchableOpacity
            style={[styles.secondaryButtonCompact, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
            onPress={() => {
              void loadDrivers();
            }}
            disabled={loadingDrivers}
            accessibilityRole="button"
            accessibilityLabel="Actualizar lista de drivers"
            activeOpacity={0.88}
          >
            {loadingDrivers ? (
              <ActivityIndicator size="small" color={palette.refreshText} />
            ) : (
              <Text style={[styles.secondaryButtonText, { color: palette.refreshText }]}>Actualizar</Text>
            )}
          </TouchableOpacity>
        </View>

        {drivers.length === 0 ? (
          <View
            style={[
              styles.emptyStateWrap,
              {
                borderColor: palette.cardBorder,
                backgroundColor: palette.surfaceAlt,
              },
            ]}
          >
            <Text style={[styles.emptyStateTitle, { color: palette.textPrimary }]}>
              Aún no hay drivers cargados
            </Text>
            <Text style={[styles.hintText, { color: palette.textSecondary }]}>
              Sube el primer paquete para habilitar instalaciones por marca y versión.
            </Text>
            <TouchableOpacity
              style={[styles.secondaryButtonCompact, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
              onPress={() => {
                void loadDrivers();
              }}
              accessibilityRole="button"
              accessibilityLabel="Actualizar lista de drivers vacia"
              activeOpacity={0.88}
            >
              <Text style={[styles.secondaryButtonText, { color: palette.refreshText }]}>Actualizar lista</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.driverList}>
            {drivers.map((driver) => (
              <View
                key={driver.key}
                style={[styles.driverRow, { borderColor: palette.cardBorder, backgroundColor: palette.surface }]}
              >
                <View style={styles.driverInfo}>
                  <Text style={[styles.driverTitle, { color: palette.textPrimary }]}>
                    {driver.brand} - {driver.version}
                  </Text>
                  <Text style={[styles.driverMeta, { color: palette.textSecondary }]}>
                    {driver.filename} • {formatBytes(driver.size_bytes)}
                  </Text>
                  <Text style={[styles.driverMeta, { color: palette.textMuted }]}>
                    {driver.last_modified || driver.uploaded || "-"}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.deleteButton, { backgroundColor: palette.errorBg }]}
                  onPress={() => {
                    void onDelete(driver);
                  }}
                  disabled={deletingKey === driver.key}
                  accessibilityRole="button"
                  accessibilityLabel={`Eliminar driver ${driver.brand} ${driver.version}`}
                  activeOpacity={0.86}
                >
                  {deletingKey === driver.key ? (
                    <ActivityIndicator size="small" color={palette.errorText} />
                  ) : (
                    <Text style={[styles.deleteButtonText, { color: palette.errorText }]}>Eliminar</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 22,
    gap: 14,
    paddingBottom: 44,
  },
  centerContainer: {
    flex: 1,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  authCard: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  authTitle: {
    fontSize: 21,
    fontFamily: fontFamilies.bold,
  },
  title: {
    fontSize: 28,
    fontFamily: fontFamilies.bold,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilies.regular,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: fontFamilies.bold,
  },
  label: {
    fontSize: 13,
    fontFamily: fontFamilies.semibold,
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 44,
  },
  fileLabel: {
    fontSize: 12.5,
    fontFamily: fontFamilies.regular,
    marginTop: 2,
  },
  button: {
    borderRadius: 12,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    marginTop: 6,
  },
  buttonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 16,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 11,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    marginTop: 6,
  },
  secondaryButtonCompact: {
    borderWidth: 1,
    borderRadius: 11,
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13.5,
  },
  hintText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilies.regular,
  },
  emptyStateWrap: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 12,
    gap: 9,
    alignItems: "flex-start",
  },
  emptyStateTitle: {
    fontSize: 14,
    fontFamily: fontFamilies.semibold,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  driverList: {
    gap: 8,
  },
  driverRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  driverInfo: {
    flex: 1,
    gap: 2,
  },
  driverTitle: {
    fontSize: 14,
    fontFamily: fontFamilies.semibold,
  },
  driverMeta: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  deleteButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    minWidth: 82,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButtonText: {
    fontSize: 13,
    fontFamily: fontFamilies.bold,
  },
});

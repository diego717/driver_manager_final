import { useCallback, useEffect, useMemo, useState } from "react";
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
import { consumeForceLoginOnOpenFlag } from "@/src/security/startup-session-policy";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

const DRIVER_LIST_LIMIT = 80;

type PickedFile = {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
};

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
  const [brand, setBrand] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);

  const selectedFileLabel = useMemo(() => {
    if (!pickedFile) return "Sin archivo seleccionado";
    const sizeText = formatBytes(pickedFile.size);
    return `${pickedFile.name} (${sizeText})`;
  }, [pickedFile]);

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
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    } finally {
      setLoadingDrivers(false);
    }
  }, [refreshSessionState]);

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
    } catch (error) {
      Alert.alert("Error", `No se pudo seleccionar archivo: ${extractApiError(error)}`);
    }
  }, []);

  const onUpload = useCallback(async () => {
    if (!(await refreshSessionState())) {
      Alert.alert("Sesion requerida", "Inicia sesion web en Configuracion y acceso.");
      router.push("/modal");
      return;
    }

    if (!pickedFile) {
      Alert.alert("Archivo requerido", "Selecciona un archivo de driver para subir.");
      return;
    }
    if (!String(brand).trim()) {
      Alert.alert("Dato invalido", "La marca es obligatoria.");
      return;
    }
    if (!String(version).trim()) {
      Alert.alert("Dato invalido", "La version es obligatoria.");
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
      Alert.alert("Driver subido", `${uploaded.brand} ${uploaded.version}`);
      setPickedFile(null);
      setDescription("");
      await loadDrivers();
    } catch (error) {
      Alert.alert("No se pudo subir driver", extractApiError(error));
    } finally {
      setUploading(false);
    }
  }, [brand, description, loadDrivers, pickedFile, refreshSessionState, router, version]);

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
            } catch (error) {
              Alert.alert("No se pudo eliminar", extractApiError(error));
            } finally {
              setDeletingKey("");
            }
          },
        },
      ],
    );
  }, [loadDrivers]);

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
        <Text style={[styles.hintText, { color: palette.textSecondary }]}>Verificando sesion...</Text>
      </View>
    );
  }

  if (!hasActiveSession) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: palette.screenBg }]}>
        <View
          style={[
            styles.authCard,
            { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
          ]}
        >
          <Text style={[styles.authTitle, { color: palette.textPrimary }]}>Sesion requerida</Text>
          <Text style={[styles.hintText, { color: palette.textSecondary }]}>
            Inicia sesion web para gestionar drivers en R2.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: palette.primaryButtonBg }]}
            onPress={() => router.push("/modal")}
            accessibilityRole="button"
          >
            <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>
              Ir a configuracion
            </Text>
          </TouchableOpacity>
        </View>
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
        Sube paquetes de drivers al bucket R2 y mantenlos disponibles por marca/version.
      </Text>

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

        <Text style={[styles.label, { color: palette.label }]}>Version</Text>
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

        <Text style={[styles.label, { color: palette.label }]}>Descripcion (opcional)</Text>
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
          >
            {loadingDrivers ? (
              <ActivityIndicator size="small" color={palette.refreshText} />
            ) : (
              <Text style={[styles.secondaryButtonText, { color: palette.refreshText }]}>Actualizar</Text>
            )}
          </TouchableOpacity>
        </View>

        {drivers.length === 0 ? (
          <Text style={[styles.hintText, { color: palette.textMuted }]}>
            No hay drivers cargados para este tenant.
          </Text>
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
                  style={[styles.deleteButton, { backgroundColor: palette.warningBg }]}
                  onPress={() => {
                    void onDelete(driver);
                  }}
                  disabled={deletingKey === driver.key}
                >
                  {deletingKey === driver.key ? (
                    <ActivityIndicator size="small" color={palette.warningText} />
                  ) : (
                    <Text style={[styles.deleteButtonText, { color: palette.warningText }]}>Eliminar</Text>
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
    padding: 20,
    gap: 12,
    paddingBottom: 40,
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
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  authTitle: {
    fontSize: 18,
    fontFamily: fontFamilies.bold,
  },
  title: {
    fontSize: 24,
    fontFamily: fontFamilies.bold,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: fontFamilies.bold,
  },
  label: {
    fontSize: 13,
    fontFamily: fontFamilies.semibold,
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fileLabel: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
    marginTop: 2,
  },
  button: {
    borderRadius: 10,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    marginTop: 4,
  },
  buttonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    marginTop: 4,
  },
  secondaryButtonCompact: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 34,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  hintText: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
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
    borderRadius: 10,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  driverInfo: {
    flex: 1,
    gap: 2,
  },
  driverTitle: {
    fontSize: 13,
    fontFamily: fontFamilies.semibold,
  },
  driverMeta: {
    fontSize: 11,
    fontFamily: fontFamilies.regular,
  },
  deleteButton: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 76,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButtonText: {
    fontSize: 12,
    fontFamily: fontFamilies.bold,
  },
});

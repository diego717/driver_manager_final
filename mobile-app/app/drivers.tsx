import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as WebBrowser from "expo-web-browser";

import {
  deleteDriver,
  listDrivers,
  resolveDriverDownloadUrl,
  uploadDriver,
  type DriverRecord,
} from "@/src/api/drivers";
import { extractApiError } from "@/src/api/client";
import ConsoleButton from "@/src/components/ConsoleButton";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import InlineFeedback, { type InlineFeedbackTone } from "@/src/components/InlineFeedback";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { radii, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, inputFontFamily, typeScale } from "@/src/theme/typography";

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

  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingKey, setDeletingKey] = useState("");
  const [downloadingKey, setDownloadingKey] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [brand, setBrand] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();

  const selectedFileLabel = useMemo(() => {
    if (!pickedFile) return "Sin archivo seleccionado";
    const sizeText = formatBytes(pickedFile.size);
    return `${pickedFile.name} (${sizeText})`;
  }, [pickedFile]);

  const pushFeedback = useCallback((message: string, tone: InlineFeedbackTone = "info") => {
    setFeedback({ message, tone });
  }, []);

  const loadDrivers = useCallback(async () => {
    if (!hasActiveSession) return;

    try {
      setLoadingDrivers(true);
      const items = await listDrivers({ limit: DRIVER_LIST_LIMIT });
      setDrivers(items);
      if (!items.length) {
        pushFeedback("Aun no hay drivers cargados para este tenant.", "info");
      }
    } catch (error) {
      pushFeedback(`No se pudieron cargar drivers: ${extractApiError(error)}`, "error");
    } finally {
      setLoadingDrivers(false);
    }
  }, [hasActiveSession, pushFeedback]);

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
    if (!hasActiveSession) {
      pushFeedback("Sesion requerida. Inicia sesion web en Configuracion y acceso.", "warning");
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
      pushFeedback("La version es obligatoria.", "warning");
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
  }, [brand, description, hasActiveSession, loadDrivers, pickedFile, pushFeedback, router, version]);

  const onDelete = useCallback(
    async (driver: DriverRecord) => {
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
    },
    [loadDrivers, pushFeedback],
  );

  const onDownload = useCallback(
    async (driver: DriverRecord) => {
      try {
        setDownloadingKey(driver.key);
        const targetUrl = await resolveDriverDownloadUrl(driver);
        await WebBrowser.openBrowserAsync(targetUrl);
        pushFeedback(`Abriendo descarga: ${driver.brand} ${driver.version}`, "info");
      } catch (error) {
        pushFeedback(`No se pudo abrir la descarga: ${extractApiError(error)}`, "error");
      } finally {
        setDownloadingKey("");
      }
    },
    [pushFeedback],
  );

  useEffect(() => {
    if (!hasActiveSession) {
      setDrivers([]);
      return;
    }
    void loadDrivers();
  }, [hasActiveSession, loadDrivers]);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession) {
        return;
      }
      void loadDrivers();
    }, [hasActiveSession, loadDrivers]),
  );

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.hintText, { color: palette.textSecondary }]}>Verificando sesion...</Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para gestionar drivers en R2."
          onLoginSuccess={async () => {
            await loadDrivers();
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold
      contentContainerStyle={styles.container}
      scrollViewProps={{ keyboardShouldPersistTaps: "handled" }}
    >
      <ScreenHero
        eyebrow="Repositorio movil"
        title="Drivers R2"
        description="Prepara paquetes listos para campo, con separacion clara entre carga operativa y consulta de versiones."
        aside={
          <View
            style={[
              styles.heroBadge,
              {
                backgroundColor: palette.heroEyebrowBg,
                borderColor: palette.heroBorder,
              },
            ]}
          >
            <Text style={[styles.heroBadgeText, { color: palette.heroEyebrowText }]}>
              {drivers.length} items
            </Text>
          </View>
        }
      />
      {feedback ? <InlineFeedback message={feedback.message} tone={feedback.tone} /> : null}

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

        <ConsoleButton
          variant="ghost"
          style={styles.secondaryButton}
          onPress={() => {
            void onPickFile();
          }}
          accessibilityLabel="Seleccionar archivo de driver"
          label="Seleccionar archivo"
          textStyle={styles.secondaryButtonText}
        />

        <Text style={[styles.fileLabel, { color: palette.textMuted }]}>{selectedFileLabel}</Text>

        <ConsoleButton
          variant="primary"
          style={[styles.button, (uploading || !pickedFile) && styles.buttonDisabled]}
          onPress={() => {
            void onUpload();
          }}
          loading={uploading}
          disabled={!pickedFile}
          accessibilityLabel="Subir driver"
          label="Subir driver"
          textStyle={styles.buttonText}
        />
      </View>

      <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
        <View style={styles.listHeader}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Drivers disponibles</Text>
          <ConsoleButton
            variant="ghost"
            size="sm"
            style={styles.secondaryButtonCompact}
            onPress={() => {
              void loadDrivers();
            }}
            loading={loadingDrivers}
            accessibilityLabel="Actualizar lista de drivers"
            label="Actualizar"
            textStyle={styles.secondaryButtonText}
          />
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
              Aun no hay drivers cargados
            </Text>
            <Text style={[styles.hintText, { color: palette.textSecondary }]}>
              Sube el primer paquete para habilitar instalaciones por marca y version.
            </Text>
            <ConsoleButton
              variant="ghost"
              size="sm"
              style={styles.secondaryButtonCompact}
              onPress={() => {
                void loadDrivers();
              }}
              accessibilityLabel="Actualizar lista de drivers vacia"
              label="Actualizar lista"
              textStyle={styles.secondaryButtonText}
            />
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
                    {driver.filename} - {formatBytes(driver.size_bytes)}
                  </Text>
                  <Text style={[styles.driverMeta, { color: palette.textMuted }]}>
                    {driver.last_modified || driver.uploaded || "-"}
                  </Text>
                </View>

                <View style={styles.driverActions}>
                  <ConsoleButton
                    variant="ghost"
                    size="sm"
                    style={styles.actionButton}
                    onPress={() => {
                      void onDownload(driver);
                    }}
                    loading={downloadingKey === driver.key}
                    accessibilityLabel={`Descargar driver ${driver.brand} ${driver.version}`}
                    label="Descargar"
                    textStyle={styles.actionButtonText}
                  />

                  <ConsoleButton
                    variant="warning"
                    size="sm"
                    style={styles.actionButton}
                    onPress={() => {
                      void onDelete(driver);
                    }}
                    loading={deletingKey === driver.key}
                    accessibilityLabel={`Eliminar driver ${driver.brand} ${driver.version}`}
                    label="Eliminar"
                    textStyle={styles.actionButtonText}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.s22,
    gap: spacing.s14,
  },
  centerContainer: {
    flex: 1,
    padding: spacing.s20,
    alignItems: "center",
    justifyContent: "center",
  },
  heroBadge: {
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s7,
  },
  heroBadgeText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMonoTight,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  card: {
    borderWidth: 1,
    borderRadius: radii.r18,
    padding: spacing.s16,
    gap: spacing.s10,
  },
  sectionTitle: {
    fontFamily: fontFamilies.display,
    ...typeScale.sectionDisplay,
    fontSize: 24,
    lineHeight: 24,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  label: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    marginTop: spacing.s2,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderRadius: radii.r12,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s11,
    minHeight: sizing.touchTargetMin,
    fontFamily: inputFontFamily,
    ...typeScale.body,
  },
  fileLabel: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    marginTop: spacing.s2,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  button: {
    borderRadius: radii.r10,
    minHeight: sizing.touchTargetMin + spacing.s2,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s13,
    marginTop: spacing.s6,
  },
  buttonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  secondaryButton: {
    borderRadius: radii.r10,
    minHeight: sizing.touchTargetMin,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s10,
    marginTop: spacing.s6,
  },
  secondaryButtonCompact: {
    borderRadius: radii.r10,
    minHeight: sizing.touchTargetMin,
    paddingHorizontal: spacing.s12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  hintText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilies.regular,
  },
  emptyStateWrap: {
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: radii.r12,
    padding: spacing.s12,
    gap: spacing.s9,
    alignItems: "flex-start",
  },
  emptyStateTitle: {
    fontFamily: fontFamilies.bold,
    ...typeScale.body,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s8,
  },
  driverList: {
    gap: spacing.s8,
  },
  driverRow: {
    borderWidth: 1,
    borderRadius: radii.r12,
    padding: spacing.s12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s12,
  },
  driverInfo: {
    flex: 1,
    gap: spacing.s2,
  },
  driverActions: {
    gap: spacing.s8,
  },
  driverTitle: {
    fontFamily: fontFamilies.semibold,
    ...typeScale.body,
  },
  driverMeta: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  actionButton: {
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
    minHeight: sizing.touchTargetMin,
    minWidth: 82,
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
});

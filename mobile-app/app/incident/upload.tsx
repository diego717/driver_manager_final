import React, { useEffect, useMemo, useRef, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { extractApiError } from "@/src/api/client";
import {
  type IncidentChecklistAppliedItem,
  type IncidentSeverity,
} from "@/src/types/api";
import {
  persistIncidentEvidenceLocally,
  syncIncidentEvidence,
  type EvidenceCaptureDraft,
} from "@/src/services/incident-evidence";
import { getAppPalette } from "@/src/theme/design-tokens";
import { useThemePreference } from "@/src/theme/theme-preference";

type WizardStepKey = "checklist" | "note" | "photos" | "confirm";
type CaptureStatus = "pending" | "confirming" | "confirmed";

type ChecklistDraftItem = {
  id: string;
  label: string;
  checked: boolean;
};

type EvidenceDraft = {
  id: string;
  uri: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isTemporary: boolean;
  captureStatus: CaptureStatus;
  capturedAtEpochMs?: number;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  captureWarning?: string;
};

const WIZARD_STEPS: Array<{ key: WizardStepKey; title: string }> = [
  { key: "checklist", title: "Checklist" },
  { key: "note", title: "Nota" },
  { key: "photos", title: "Fotos" },
  { key: "confirm", title: "Confirmacion" },
];

const BASE_CHECKLIST: ChecklistDraftItem[] = [
  { id: "driver-state", label: "Driver verificado", checked: false },
  { id: "network", label: "Conectividad validada", checked: false },
  { id: "power", label: "Energia/fuente revisada", checked: false },
  { id: "safety", label: "Condiciones seguras", checked: false },
];

const IMAGE_PICK_QUALITY = 0.82;
const MAX_UPLOAD_PHOTO_BYTES = 5 * 1024 * 1024;
const OPTIMAL_UPLOAD_PHOTO_BYTES = 1 * 1024 * 1024;
const MIN_UPLOAD_PHOTO_BYTES = 1024;
const MAX_IMAGE_DIMENSION = 1920;
const MAX_SIZE_INFLATION_RATIO = 1.25;
const COMPRESS_QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42, 0.34];
const MIN_TOUCH_TARGET_SIZE = 44;

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function toJpegFileName(originalName: string | null | undefined, installationId: string): string {
  const fallback = `incident_${installationId || "0"}_${Date.now()}.jpg`;
  if (!originalName || !originalName.trim()) return fallback;
  const sanitized = originalName.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  const base = sanitized.replace(/\.[a-zA-Z0-9]+$/, "");
  const finalBase = base || `incident_${installationId || "0"}_${Date.now()}`;
  return `${finalBase}.jpg`;
}

async function deleteFileIfExists(uri: string): Promise<void> {
  if (!uri.trim()) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best effort cleanup.
  }
}

async function getFileSizeBytes(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if ("size" in info && typeof info.size === "number" && info.size > 0) {
      return info.size;
    }
  } catch {
    // Continue with web/data-uri fallbacks.
  }

  const dataUriMatch = uri.match(/^data:.*;base64,(.+)$/);
  if (dataUriMatch?.[1]) {
    const base64 = dataUriMatch[1];
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  }

  if (typeof fetch === "function") {
    try {
      const response = await fetch(uri);
      if (!response.ok) return 0;
      const buffer = await response.arrayBuffer();
      return buffer.byteLength;
    } catch {
      return 0;
    }
  }

  return 0;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "N/A";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatCapturedAt(epochMs?: number): string {
  if (!epochMs) return "Sin confirmar";
  return new Date(epochMs).toLocaleString();
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function processAssetForUpload(
  asset: ImagePicker.ImagePickerAsset,
  installationId: string,
  onProgress: (message: string) => void,
): Promise<{
  uri: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isTemporary: boolean;
}> {
  const sourceUri = asset.uri;
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  const generatedUris: string[] = [];

  try {
    let workingUri = sourceUri;
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      onProgress("Redimensionando imagen...");
      const ratio = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
      const targetWidth = Math.max(1, Math.round(width * ratio));
      const targetHeight = Math.max(1, Math.round(height * ratio));
      const resized = await ImageManipulator.manipulateAsync(
        sourceUri,
        [{ resize: { width: targetWidth, height: targetHeight } }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
      );
      if (resized.uri !== sourceUri) generatedUris.push(resized.uri);
      workingUri = resized.uri;
    }

    let bestUri = workingUri;
    let bestSize = await getFileSizeBytes(workingUri);
    const sourceSizeHint =
      typeof asset.fileSize === "number" && asset.fileSize > 0 ? asset.fileSize : null;
    const inflatedComparedToSource =
      sourceSizeHint != null &&
      bestSize > 0 &&
      bestSize > sourceSizeHint * MAX_SIZE_INFLATION_RATIO;

    const targetSizeBytes =
      sourceSizeHint != null
        ? Math.max(
            MIN_UPLOAD_PHOTO_BYTES,
            Math.min(MAX_UPLOAD_PHOTO_BYTES, Math.round(sourceSizeHint * 1.1)),
          )
        : OPTIMAL_UPLOAD_PHOTO_BYTES;

    const needsCompression =
      bestSize <= 0 ||
      bestSize > OPTIMAL_UPLOAD_PHOTO_BYTES ||
      inflatedComparedToSource;
    if (needsCompression) {
      for (const [index, quality] of COMPRESS_QUALITIES.entries()) {
        onProgress(`Comprimiendo (${index + 1}/${COMPRESS_QUALITIES.length})...`);
        const compressed = await ImageManipulator.manipulateAsync(
          workingUri,
          [],
          { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
        );
        if (compressed.uri !== sourceUri) generatedUris.push(compressed.uri);
        const compressedSize = await getFileSizeBytes(compressed.uri);
        if (compressedSize > 0 && (bestSize <= 0 || compressedSize < bestSize)) {
          bestUri = compressed.uri;
          bestSize = compressedSize;
        }
        if (compressedSize >= MIN_UPLOAD_PHOTO_BYTES && compressedSize <= targetSizeBytes) {
          bestUri = compressed.uri;
          bestSize = compressedSize;
          break;
        }
      }
    }

    if (bestSize < MIN_UPLOAD_PHOTO_BYTES) {
      throw new Error("Imagen demasiado pequena o corrupta.");
    }
    if (bestSize > MAX_UPLOAD_PHOTO_BYTES) {
      const sizeMb = (bestSize / (1024 * 1024)).toFixed(1);
      throw new Error(`No se pudo comprimir la imagen a 5MB (actual: ${sizeMb}MB).`);
    }

    const isTemporary = generatedUris.includes(bestUri);
    await Promise.all(
      generatedUris
        .filter((uri) => uri !== bestUri)
        .map((uri) => deleteFileIfExists(uri)),
    );

    return {
      uri: bestUri,
      fileName: toJpegFileName(asset.fileName, installationId),
      contentType: "image/jpeg",
      sizeBytes: bestSize,
      isTemporary,
    };
  } catch (error) {
    await Promise.all(generatedUris.map((uri) => deleteFileIfExists(uri)));
    throw error;
  }
}

async function captureDeviceMetadata(): Promise<{
  capturedAtEpochMs: number;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  warning?: string;
}> {
  const capturedAtEpochMs = Date.now();
  try {
    const locationModule = require("expo-location");
    if (!locationModule) {
      return {
        capturedAtEpochMs,
        warning: "expo-location no disponible. Se guardo solo timestamp.",
      };
    }

    const permission = await locationModule.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      return {
        capturedAtEpochMs,
        warning: "Sin permiso de ubicacion. Se guardo solo timestamp.",
      };
    }

    const position = await locationModule.getCurrentPositionAsync({
      accuracy: locationModule.Accuracy?.Balanced,
    });
    return {
      capturedAtEpochMs,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyM: Number.isFinite(position.coords.accuracy)
        ? position.coords.accuracy
        : null,
    };
  } catch {
    return {
      capturedAtEpochMs,
      warning: "No se pudo obtener geolocalizacion. Se guardo solo timestamp.",
    };
  }
}

function checklistToApplied(items: ChecklistDraftItem[]): IncidentChecklistAppliedItem[] {
  return items
    .filter((item) => item.checked)
    .map((item) => ({
      item_code: item.id,
      label: item.label,
      checked: true,
      note: null,
    }));
}

export default function UploadIncidentEvidenceWizardScreen() {
  const { resolvedScheme } = useThemePreference();
  const router = useRouter();
  const params = useLocalSearchParams<{
    incidentId?: string | string[];
    installationId?: string | string[];
  }>();

  const incidentIdText = useMemo(() => normalizeParam(params.incidentId), [params.incidentId]);
  const initialInstallationId = useMemo(
    () => normalizeParam(params.installationId),
    [params.installationId],
  );

  const [installationId, setInstallationId] = useState(initialInstallationId || "");
  const [stepIndex, setStepIndex] = useState(0);
  const [checklistItems, setChecklistItems] = useState<ChecklistDraftItem[]>(BASE_CHECKLIST);
  const [note, setNote] = useState("");
  const [severity] = useState<IncidentSeverity>("medium");
  const [evidences, setEvidences] = useState<EvidenceDraft[]>([]);
  const [processingImage, setProcessingImage] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const evidencesRef = useRef<EvidenceDraft[]>([]);
  const palette = getAppPalette(resolvedScheme);

  const notify = (title: string, message: string) => {
    const composed = `${title}: ${message}`;
    setFeedbackMessage(composed);
    Alert.alert(title, message);
  };

  useEffect(() => {
    evidencesRef.current = evidences;
  }, [evidences]);

  useEffect(() => {
    return () => {
      const tempUris = evidencesRef.current.filter((item) => item.isTemporary).map((item) => item.uri);
      void Promise.all(tempUris.map((uri) => deleteFileIfExists(uri)));
    };
  }, []);

  const currentStep = WIZARD_STEPS[stepIndex];
  const confirmedEvidenceCount = evidences.filter((item) => item.captureStatus === "confirmed").length;
  const checklistApplied = checklistToApplied(checklistItems);

  const canContinue = useMemo(() => {
    if (currentStep.key === "checklist") {
      return checklistApplied.length > 0;
    }
    if (currentStep.key === "note") {
      return note.trim().length > 0;
    }
    if (currentStep.key === "photos") {
      return evidences.length > 0 && confirmedEvidenceCount === evidences.length;
    }
    return true;
  }, [checklistApplied.length, confirmedEvidenceCount, currentStep.key, evidences.length, note]);

  const onToggleChecklist = (id: string) => {
    setChecklistItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, checked: !item.checked }
          : item,
      ),
    );
  };

  const addEvidenceFromAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    setProcessingImage(true);
    setProcessingMessage("Preparando imagen...");
    try {
      const processed = await processAssetForUpload(asset, installationId, setProcessingMessage);
      const evidence: EvidenceDraft = {
        id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        uri: processed.uri,
        fileName: processed.fileName,
        contentType: processed.contentType,
        sizeBytes: processed.sizeBytes,
        isTemporary: processed.isTemporary,
        captureStatus: "pending",
      };
      setEvidences((prev) => [...prev, evidence]);
    } catch (error) {
      notify("Imagen invalida", extractApiError(error));
    } finally {
      setProcessingImage(false);
      setProcessingMessage("");
    }
  };

  const pickFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      notify("Permiso requerido", "Debes permitir acceso a galeria.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      quality: IMAGE_PICK_QUALITY,
    });
    if (result.canceled || !result.assets?.length) return;
    await addEvidenceFromAsset(result.assets[0]);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      notify("Permiso requerido", "Debes permitir acceso a camara.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: IMAGE_PICK_QUALITY,
    });
    if (result.canceled || !result.assets?.length) return;
    await addEvidenceFromAsset(result.assets[0]);
  };

  const confirmEvidence = async (id: string) => {
    setEvidences((prev) =>
      prev.map((item) => (item.id === id ? { ...item, captureStatus: "confirming" } : item)),
    );
    const metadata = await captureDeviceMetadata();
    setEvidences((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              captureStatus: "confirmed",
              capturedAtEpochMs: metadata.capturedAtEpochMs,
              latitude: metadata.latitude ?? null,
              longitude: metadata.longitude ?? null,
              accuracyM: metadata.accuracyM ?? null,
              captureWarning: metadata.warning,
            }
          : item,
      ),
    );
  };

  const removeEvidence = async (id: string) => {
    const target = evidences.find((item) => item.id === id);
    if (!target) return;
    if (target.isTemporary) await deleteFileIfExists(target.uri);
    setEvidences((prev) => prev.filter((item) => item.id !== id));
  };

  const ensureStepReady = (): boolean => {
    if (canContinue) return true;
    if (currentStep.key === "checklist") {
      notify("Checklist requerido", "Marca al menos un item aplicado.");
      return false;
    }
    if (currentStep.key === "note") {
      notify("Nota requerida", "Debes cargar una nota operativa.");
      return false;
    }
    if (currentStep.key === "photos") {
      notify(
        "Evidencias pendientes",
        "Agrega fotos y confirma la captura de cada evidencia antes de continuar.",
      );
      return false;
    }
    return true;
  };

  const nextStep = () => {
    if (!ensureStepReady()) return;
    setStepIndex((current) => Math.min(WIZARD_STEPS.length - 1, current + 1));
  };

  const previousStep = () => {
    setStepIndex((current) => Math.max(0, current - 1));
  };

  const onConfirmWizard = async () => {
    const parsedInstallationId = Number.parseInt(installationId, 10);
    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) {
      notify("Dato invalido", "installation_id debe ser un numero positivo.");
      return;
    }
    if (!ensureStepReady()) return;

    const confirmedEvidences = evidences.filter((item) => item.captureStatus === "confirmed");
    const evidenceDrafts: EvidenceCaptureDraft[] = confirmedEvidences.map((item) => ({
      uri: item.uri,
      fileName: item.fileName,
      contentType: item.contentType,
      sizeBytes: item.sizeBytes,
      capturedAtEpochMs: item.capturedAtEpochMs || Date.now(),
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      accuracyM: item.accuracyM ?? null,
    }));

    const existingRemoteIncidentId = Number.parseInt(incidentIdText, 10);
    const hasExistingIncident =
      Number.isInteger(existingRemoteIncidentId) && existingRemoteIncidentId > 0;

    try {
      setSaving(true);
      setFeedbackMessage("Guardando evidencia localmente...");
      const localIncident = await withTimeout(
        persistIncidentEvidenceLocally({
          installationId: parsedInstallationId,
          existingRemoteIncidentId: hasExistingIncident ? existingRemoteIncidentId : null,
          reporterUsername: "mobile_user",
          note: note.trim(),
          checklistApplied,
          severity,
          evidences: evidenceDrafts,
        }),
        12000,
        "Timeout al guardar evidencia localmente.",
      );

      try {
        setFeedbackMessage("Sincronizando evidencias con servidor...");
        const syncResult = await withTimeout(
          syncIncidentEvidence(localIncident),
          30000,
          "Timeout sincronizando evidencias. Quedaron guardadas localmente.",
        );
        const tempUrisToCleanup = evidences.filter((item) => item.isTemporary).map((item) => item.uri);
        await Promise.all(tempUrisToCleanup.map((uri) => deleteFileIfExists(uri)));
        setEvidences([]);
        notify(
          "Evidencias sincronizadas",
          `Incidencia #${syncResult.remoteIncidentId}\nFotos subidas: ${syncResult.uploadedCount}`,
        );
        router.replace(
          `/incident/detail?incidentId=${syncResult.remoteIncidentId}&installationId=${parsedInstallationId}` as never,
        );
      } catch (syncError) {
        const fallbackIncidentId = hasExistingIncident ? existingRemoteIncidentId : null;
        notify(
          "Guardado local",
          `Se guardo localmente para sincronizar despues.\n${extractApiError(syncError)}`,
        );
        if (fallbackIncidentId) {
          router.replace(
            `/incident/detail?incidentId=${fallbackIncidentId}&installationId=${parsedInstallationId}` as never,
          );
          return;
        }
        router.back();
      }
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: palette.screenBg }]}>
      <Stack.Screen options={{ title: "Evidencia guiada" }} />

      <Text style={[styles.title, { color: palette.textPrimary }]}>Asistente de evidencia</Text>
      <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
        Paso {stepIndex + 1} de {WIZARD_STEPS.length}: {currentStep.title}
      </Text>
      {feedbackMessage ? (
        <View
          style={[
            styles.feedbackBox,
            { backgroundColor: palette.feedbackBg, borderColor: palette.feedbackBorder },
          ]}
        >
          <Text style={[styles.feedbackText, { color: palette.feedbackText }]}>{feedbackMessage}</Text>
        </View>
      ) : null}
      {incidentIdText ? (
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
          Incidencia objetivo: #{incidentIdText}
        </Text>
      ) : null}

      <Text style={[styles.label, { color: palette.textPrimary }]}>Installation ID</Text>
      <TextInput
        value={installationId}
        onChangeText={setInstallationId}
        keyboardType="numeric"
        style={[
          styles.input,
          {
            backgroundColor: palette.inputBg,
            borderColor: palette.inputBorder,
            color: palette.textPrimary,
          },
        ]}
        placeholder="Ej: 15"
        accessibilityLabel="ID de instalacion para el asistente"
      />

      {currentStep.key === "checklist" ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Checklist aplicado</Text>
          <View style={styles.chipsWrap}>
            {checklistItems.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.checkItem,
                  {
                    backgroundColor: item.checked ? palette.chipSelectedBg : palette.chipBg,
                    borderColor: item.checked ? palette.chipSelectedBorder : palette.chipBorder,
                  },
                ]}
                onPress={() => onToggleChecklist(item.id)}
                accessibilityRole="checkbox"
                accessibilityLabel={`Checklist ${item.label}`}
                accessibilityState={{ checked: item.checked }}
              >
                <Text style={[styles.checkItemText, { color: palette.textPrimary }]}>
                  {item.checked ? "✓ " : ""}{item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.hintText, { color: palette.textMuted }]}>
            Seleccionados: {checklistApplied.length}
          </Text>
        </View>
      ) : null}

      {currentStep.key === "note" ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Nota operativa</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={4}
            style={[
              styles.input,
              styles.noteInput,
              {
                backgroundColor: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.textPrimary,
              },
            ]}
            placeholder="Describe contexto, accion tomada y observaciones"
            accessibilityLabel="Nota de incidencia"
          />
        </View>
      ) : null}

      {currentStep.key === "photos" ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Fotos y captura</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
              onPress={pickFromGallery}
              disabled={processingImage || saving}
              accessibilityRole="button"
              accessibilityLabel="Seleccionar evidencia desde galeria"
              accessibilityState={{ disabled: processingImage || saving, busy: processingImage || saving }}
            >
              <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Galeria</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
              onPress={takePhoto}
              disabled={processingImage || saving}
              accessibilityRole="button"
              accessibilityLabel="Tomar evidencia con camara"
              accessibilityState={{ disabled: processingImage || saving, busy: processingImage || saving }}
            >
              <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Camara</Text>
            </TouchableOpacity>
          </View>

          {processingImage ? (
            <View style={styles.processingRow}>
              <ActivityIndicator color={palette.primaryButtonBg} />
              <Text style={[styles.hintText, { color: palette.hint }]}>{processingMessage}</Text>
            </View>
          ) : null}

          {!evidences.length ? (
            <Text style={[styles.hintText, { color: palette.textMuted }]}>Aun no agregaste fotos.</Text>
          ) : (
            evidences.map((item) => (
              <View
                key={item.id}
                style={[styles.previewCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
              >
                <Image source={{ uri: item.uri }} style={[styles.previewImage, { backgroundColor: palette.subtleBg }]} />
                <Text style={[styles.metaText, { color: palette.textPrimary }]}>{item.fileName}</Text>
                <Text style={[styles.metaText, { color: palette.textSecondary }]}>
                  {formatBytes(item.sizeBytes)} | {formatCapturedAt(item.capturedAtEpochMs)}
                </Text>
                {item.latitude != null && item.longitude != null ? (
                  <Text style={[styles.metaText, { color: palette.textSecondary }]}>
                    Lat {item.latitude.toFixed(5)} / Lon {item.longitude.toFixed(5)}
                    {item.accuracyM != null ? ` (±${Math.round(item.accuracyM)} m)` : ""}
                  </Text>
                ) : null}
                {item.captureWarning ? (
                  <Text style={[styles.metaText, { color: palette.warning }]}>{item.captureWarning}</Text>
                ) : null}

                <View style={styles.row}>
                  <TouchableOpacity
                    style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
                    onPress={() => void removeEvidence(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar evidencia ${item.fileName}`}
                  >
                    <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Quitar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
                    onPress={() => void confirmEvidence(item.id)}
                    disabled={item.captureStatus === "confirming" || item.captureStatus === "confirmed"}
                    accessibilityRole="button"
                    accessibilityLabel={`Confirmar captura de evidencia ${item.fileName}`}
                    accessibilityState={{
                      disabled: item.captureStatus === "confirming" || item.captureStatus === "confirmed",
                      busy: item.captureStatus === "confirming",
                    }}
                  >
                    {item.captureStatus === "confirming" ? (
                      <ActivityIndicator color={palette.secondaryText} />
                    ) : (
                      <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>
                        {item.captureStatus === "confirmed" ? "Confirmada" : "Confirmar"}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}

      {currentStep.key === "confirm" ? (
        <View style={[styles.section, styles.previewCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Resumen</Text>
          <Text style={[styles.metaText, { color: palette.textSecondary }]}>
            Checklist aplicado: {checklistApplied.length} items
          </Text>
          <Text style={[styles.metaText, { color: palette.textSecondary }]}>
            Nota: {note.trim().length} caracteres
          </Text>
          <Text style={[styles.metaText, { color: palette.textSecondary }]}>
            Evidencias confirmadas: {confirmedEvidenceCount}
          </Text>
          <Text style={[styles.metaText, { color: palette.textSecondary }]}>
            Cada evidencia se guarda primero localmente y luego se intenta sincronizar.
          </Text>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: palette.primaryButtonBg },
              saving && styles.primaryButtonDisabled,
            ]}
            onPress={onConfirmWizard}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Confirmar asistente de evidencia"
            accessibilityState={{ disabled: saving, busy: saving }}
          >
            {saving ? (
              <ActivityIndicator color={palette.primaryButtonText} />
            ) : (
              <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
                Confirmar y guardar
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
          onPress={previousStep}
          disabled={stepIndex === 0 || saving}
          accessibilityRole="button"
          accessibilityLabel="Paso anterior del asistente"
          accessibilityState={{ disabled: stepIndex === 0 || saving }}
        >
          <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Anterior</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            { backgroundColor: palette.primaryButtonBg, flex: 1, marginTop: 0 },
            (saving || currentStep.key === "confirm") && styles.primaryButtonDisabled,
          ]}
          onPress={nextStep}
          disabled={saving || currentStep.key === "confirm"}
          accessibilityRole="button"
          accessibilityLabel="Siguiente paso del asistente"
          accessibilityState={{ disabled: saving || currentStep.key === "confirm" }}
        >
          <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>Siguiente</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 13,
  },
  feedbackBox: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  feedbackText: {
    fontSize: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  checkItem: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  checkItemText: {
    fontSize: 12,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  processingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  secondaryButtonText: {
    fontWeight: "700",
  },
  previewCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  previewImage: {
    width: "100%",
    height: 220,
    borderRadius: 8,
  },
  hintText: {
    fontSize: 13,
  },
  metaText: {
    fontSize: 12,
  },
  primaryButton: {
    marginTop: 8,
    borderRadius: 10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    fontWeight: "700",
    fontSize: 15,
  },
});

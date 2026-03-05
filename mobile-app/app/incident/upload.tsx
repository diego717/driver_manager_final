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

import { uploadIncidentPhoto } from "@/src/api/photos";
import { updateIncidentEvidence } from "@/src/api/incidents";
import { extractApiError } from "@/src/api/client";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

type SelectedImage = {
  uri: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isTemporary: boolean;
};

type ConfirmedEvidence = SelectedImage & {
  deviceCapturedAt: string;
};

type FeedbackState = {
  title: string;
  message: string;
  tone: "error" | "success" | "info";
};

type WizardStep = 0 | 1 | 2 | 3;

const IMAGE_PICK_QUALITY = 1;
const MAX_UPLOAD_PHOTO_BYTES = 5 * 1024 * 1024;
const MIN_UPLOAD_PHOTO_BYTES = 1024;
const MAX_IMAGE_DIMENSION = 1920;
const COMPRESS_QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];
const MIN_TOUCH_TARGET_SIZE = 44;

const STEP_TITLES = ["Checklist", "Nota", "Fotos", "Confirmacion"] as const;

const CHECKLIST_ITEMS = [
  "Equipo identificado (QR/serie)",
  "Incidencia reproducida",
  "Evidencia fotografica capturada",
  "Diagnostico inicial registrado",
  "Accion correctiva documentada",
  "Validacion final con usuario/tecnico",
] as const;

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function toJpegFileName(originalName: string | null | undefined, incidentId: string): string {
  const fallback = `incident_${incidentId || "0"}_${Date.now()}.jpg`;
  if (!originalName || !originalName.trim()) return fallback;
  const sanitized = originalName.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  const base = sanitized.replace(/\.[a-zA-Z0-9]+$/, "");
  const finalBase = base || `incident_${incidentId || "0"}_${Date.now()}`;
  return `${finalBase}.jpg`;
}

function uniqueUris(uris: string[]): string[] {
  return Array.from(new Set(uris.filter((uri) => Boolean(uri && uri.trim()))));
}

async function deleteFileIfExists(uri: string): Promise<void> {
  if (!uri.trim()) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Ignore cleanup errors for temporary artifacts.
  }
}

async function getFileSizeBytes(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  return "size" in info && typeof info.size === "number" ? info.size : 0;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "N/A";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function UploadIncidentPhotoScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const params = useLocalSearchParams<{
    incidentId?: string | string[];
    installationId?: string | string[];
  }>();

  const initialIncidentId = useMemo(
    () => normalizeParam(params.incidentId),
    [params.incidentId],
  );
  const installationId = useMemo(
    () => normalizeParam(params.installationId),
    [params.installationId],
  );

  const [step, setStep] = useState<WizardStep>(0);
  const [incidentId, setIncidentId] = useState(initialIncidentId || "");
  const [note, setNote] = useState("");
  const [selectedChecklist, setSelectedChecklist] = useState<Record<string, boolean>>({});
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [confirmedEvidence, setConfirmedEvidence] = useState<ConfirmedEvidence[]>([]);
  const selectedImageRef = useRef<SelectedImage | null>(null);
  const [saving, setSaving] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const checklistCount = useMemo(
    () => Object.values(selectedChecklist).filter(Boolean).length,
    [selectedChecklist],
  );

  const publishFeedback = (
    nextFeedback: FeedbackState,
    options: { showAlert?: boolean } = {},
  ) => {
    setFeedback(nextFeedback);
    if (options.showAlert !== false) {
      Alert.alert(nextFeedback.title, nextFeedback.message);
    }
  };

  useEffect(() => {
    selectedImageRef.current = selectedImage;
  }, [selectedImage]);

  useEffect(() => {
    return () => {
      const current = selectedImageRef.current;
      if (!current?.isTemporary) return;
      void deleteFileIfExists(current.uri);
    };
  }, []);

  const processAssetForUpload = async (
    asset: ImagePicker.ImagePickerAsset,
    onProgress: (message: string) => void,
  ): Promise<SelectedImage> => {
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
        if (resized.uri !== sourceUri) {
          generatedUris.push(resized.uri);
        }
        workingUri = resized.uri;
      }

      let bestUri = workingUri;
      let bestSize = await getFileSizeBytes(workingUri);

      for (const [index, quality] of COMPRESS_QUALITIES.entries()) {
        onProgress(`Intento ${index + 1} de ${COMPRESS_QUALITIES.length}...`);
        const compressed = await ImageManipulator.manipulateAsync(
          workingUri,
          [],
          { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
        );
        if (compressed.uri !== sourceUri) {
          generatedUris.push(compressed.uri);
        }
        const compressedSize = await getFileSizeBytes(compressed.uri);
        if (compressedSize > 0 && (bestSize <= 0 || compressedSize < bestSize)) {
          bestUri = compressed.uri;
          bestSize = compressedSize;
        }
        if (compressedSize >= MIN_UPLOAD_PHOTO_BYTES && compressedSize <= MAX_UPLOAD_PHOTO_BYTES) {
          bestUri = compressed.uri;
          bestSize = compressedSize;
          break;
        }
      }

      if (bestSize < MIN_UPLOAD_PHOTO_BYTES) {
        throw new Error("Imagen demasiado pequena o corrupta.");
      }
      if (bestSize > MAX_UPLOAD_PHOTO_BYTES) {
        const sizeMb = (bestSize / (1024 * 1024)).toFixed(1);
        throw new Error(`No se pudo comprimir la imagen a 5MB (actual: ${sizeMb}MB).`);
      }

      const generated = uniqueUris(generatedUris);
      const isTemporary = generated.includes(bestUri);
      await Promise.all(
        generated
          .filter((uri) => uri !== bestUri)
          .map((uri) => deleteFileIfExists(uri)),
      );

      return {
        uri: bestUri,
        fileName: toJpegFileName(asset.fileName, incidentId),
        contentType: "image/jpeg",
        sizeBytes: bestSize,
        isTemporary,
      };
    } catch (error) {
      await Promise.all(uniqueUris(generatedUris).map((uri) => deleteFileIfExists(uri)));
      throw error;
    }
  };

  const setImageFromAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    setFeedback(null);
    setProcessingImage(true);
    setProcessingMessage("Preparando imagen...");
    try {
      const previousTempUri =
        selectedImageRef.current?.isTemporary ? selectedImageRef.current.uri : null;
      const processed = await processAssetForUpload(asset, setProcessingMessage);
      if (previousTempUri && previousTempUri !== processed.uri) {
        await deleteFileIfExists(previousTempUri);
      }
      setSelectedImage(processed);
    } catch (error) {
      setSelectedImage(null);
      publishFeedback(
        {
          title: "Imagen invalida",
          message: extractApiError(error),
          tone: "error",
        },
      );
    } finally {
      setProcessingImage(false);
      setProcessingMessage("");
    }
  };

  const pickFromGallery = async () => {
    setProcessingImage(true);
    setProcessingMessage("Abriendo galeria...");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      publishFeedback({
        title: "Permiso requerido",
        message: "Debes permitir acceso a galeria.",
        tone: "error",
      });
      setProcessingImage(false);
      setProcessingMessage("");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      quality: IMAGE_PICK_QUALITY,
    });
    if (result.canceled || !result.assets?.length) {
      setProcessingImage(false);
      setProcessingMessage("");
      return;
    }
    await setImageFromAsset(result.assets[0]);
  };

  const takePhoto = async () => {
    setProcessingImage(true);
    setProcessingMessage("Abriendo camara...");
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      publishFeedback({
        title: "Permiso requerido",
        message: "Debes permitir acceso a camara.",
        tone: "error",
      });
      setProcessingImage(false);
      setProcessingMessage("");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: IMAGE_PICK_QUALITY,
    });
    if (result.canceled || !result.assets?.length) {
      setProcessingImage(false);
      setProcessingMessage("");
      return;
    }
    await setImageFromAsset(result.assets[0]);
  };

  const onConfirmSelectedPhoto = async () => {
    if (!selectedImage) {
      publishFeedback({
        title: "Sin foto",
        message: "Primero selecciona una foto desde galeria o camara.",
        tone: "info",
      }, { showAlert: false });
      return;
    }

    setConfirmedEvidence((current) => [
      ...current,
      {
        ...selectedImage,
        deviceCapturedAt: new Date().toISOString(),
      },
    ]);
    setSelectedImage(null);
  };

  const onRemoveSelectedPhoto = async () => {
    if (selectedImage?.isTemporary) {
      await deleteFileIfExists(selectedImage.uri);
    }
    setSelectedImage(null);
  };

  const onRemoveConfirmedPhoto = async (index: number) => {
    setConfirmedEvidence((current) => {
      const target = current[index];
      if (target?.isTemporary) {
        void deleteFileIfExists(target.uri);
      }
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const onSaveAllEvidence = async () => {
    const parsedIncidentId = Number.parseInt(incidentId, 10);
    if (!Number.isInteger(parsedIncidentId) || parsedIncidentId <= 0) {
      publishFeedback({
        title: "Dato invalido",
        message: "incident_id debe ser un numero positivo.",
        tone: "error",
      });
      return;
    }

    if (confirmedEvidence.length === 0) {
      publishFeedback({
        title: "Faltan fotos",
        message: "Confirma al menos una evidencia antes de guardar.",
        tone: "error",
      });
      return;
    }

    setSaving(true);
    setFeedback(null);

    const failed: ConfirmedEvidence[] = [];
    let successCount = 0;
    let metadataSaved = false;
    let metadataError = "";

    try {
      try {
        const appliedChecklistItems = CHECKLIST_ITEMS.filter((label) => Boolean(selectedChecklist[label]));
        await updateIncidentEvidence(parsedIncidentId, {
          checklist_items: appliedChecklistItems,
          evidence_note: note.trim() || null,
        });
        metadataSaved = true;
      } catch (error) {
        metadataError = extractApiError(error);
      }

      for (const evidence of confirmedEvidence) {
        try {
          await uploadIncidentPhoto({
            incidentId: parsedIncidentId,
            fileUri: evidence.uri,
            fileName: evidence.fileName,
            contentType: evidence.contentType,
          });
          successCount += 1;
          if (evidence.isTemporary) {
            await deleteFileIfExists(evidence.uri);
          }
        } catch {
          failed.push(evidence);
        }
      }

      if (failed.length === 0) {
        publishFeedback({
          title: metadataSaved ? "Evidencias guardadas" : "Evidencias parciales",
          message: metadataSaved
            ? `Se subieron ${successCount} fotos y se guardo checklist/nota para la incidencia #${parsedIncidentId}.`
            : `Se subieron ${successCount} fotos, pero no se pudo guardar checklist/nota (${metadataError || "error desconocido"}).`,
          tone: metadataSaved ? "success" : "info",
        });
        setConfirmedEvidence([]);
        setSelectedImage(null);
        router.replace(
          `/incident/detail?incidentId=${parsedIncidentId}&installationId=${installationId}` as never,
        );
        return;
      }

      setConfirmedEvidence(failed);
      publishFeedback({
        title: "Sincronizacion pendiente",
        message: metadataSaved
          ? `Se subieron ${successCount}. Pendientes: ${failed.length}. Checklist/nota guardados. Revisa conexion/permisos y vuelve a intentar confirmar.`
          : `Se subieron ${successCount}. Pendientes: ${failed.length}. Checklist/nota pendientes (${metadataError || "error desconocido"}).`,
        tone: "error",
      });
    } catch (error) {
      publishFeedback({
        title: "Error",
        message: extractApiError(error),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const onBackStep = () => {
    setStep((current) => (current > 0 ? ((current - 1) as WizardStep) : current));
  };

  const onNextStep = () => {
    if (step === 2 && confirmedEvidence.length === 0) {
      publishFeedback({
        title: "Faltan fotos",
        message: "Confirma al menos una foto para continuar.",
        tone: "info",
      });
      return;
    }

    setStep((current) => (current < 3 ? ((current + 1) as WizardStep) : current));
  };

  const toggleChecklist = (label: string) => {
    setSelectedChecklist((current) => ({
      ...current,
      [label]: !current[label],
    }));
  };

  const feedbackColors =
    feedback?.tone === "error"
      ? { backgroundColor: palette.errorBg, borderColor: palette.errorBorder, color: palette.errorText }
      : feedback?.tone === "success"
        ? {
            backgroundColor: palette.successBg,
            borderColor: palette.successBorder,
            color: palette.successText,
          }
        : {
            backgroundColor: palette.infoBg,
            borderColor: palette.infoBorder,
            color: palette.infoText,
          };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: palette.screenBg }]}>
      <Stack.Screen options={{ title: "Evidencia guiada" }} />

      <Text style={[styles.title, { color: palette.textPrimary }]}>Asistente de evidencia</Text>
      <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
        Paso {step + 1} de 4: {STEP_TITLES[step]}
      </Text>

      <Text style={[styles.label, { color: palette.label }]}>Incidencia objetivo</Text>
      <TextInput
        value={incidentId}
        onChangeText={setIncidentId}
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
        placeholderTextColor={palette.placeholder}
        accessibilityLabel="ID de incidencia para subir evidencia"
      />

      {installationId ? (
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>Installation ID: {installationId}</Text>
      ) : null}

      {step === 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Checklist aplicado</Text>
          <Text style={[styles.hintText, { color: palette.hint }]}>Marca las verificaciones realizadas.</Text>
          {CHECKLIST_ITEMS.map((item) => {
            const selected = Boolean(selectedChecklist[item]);
            return (
              <TouchableOpacity
                key={item}
                style={[
                  styles.checkItem,
                  { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder },
                  selected && { backgroundColor: palette.selectedBg, borderColor: palette.selectedBg },
                ]}
                onPress={() => toggleChecklist(item)}
              >
                <Text
                  style={[
                    styles.checkItemText,
                    { color: selected ? palette.selectedText : palette.secondaryText },
                  ]}
                >
                  {selected ? "[x]" : "[ ]"} {item}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {step === 1 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Nota operativa</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            style={[
              styles.input,
              styles.noteInput,
              {
                backgroundColor: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.textPrimary,
              },
            ]}
            multiline
            placeholder="Describe contexto de la evidencia"
            placeholderTextColor={palette.placeholder}
            accessibilityLabel="Nota operativa de la evidencia"
          />
          <Text style={[styles.hintText, { color: palette.hint }]}>Caracteres: {note.trim().length}</Text>
        </View>
      ) : null}

      {step === 2 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Fotos y captura</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[
                styles.secondaryButton,
                { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder },
              ]}
              onPress={pickFromGallery}
              disabled={saving || processingImage}
              accessibilityRole="button"
              accessibilityLabel="Seleccionar foto desde la galeria"
            >
              <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Galeria</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.secondaryButton,
                { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder },
              ]}
              onPress={takePhoto}
              disabled={saving || processingImage}
              accessibilityRole="button"
              accessibilityLabel="Tomar foto con la camara"
            >
              <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Camara</Text>
            </TouchableOpacity>
          </View>

          {processingImage ? (
            <View style={styles.processingRow}>
              <ActivityIndicator color={palette.processingSpinner} />
              <Text style={[styles.hintText, { color: palette.hint }]}>
                {processingMessage || "Comprimiendo imagen..."}
              </Text>
            </View>
          ) : null}

          {selectedImage ? (
            <View style={[styles.previewCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
              <Image source={{ uri: selectedImage.uri }} style={[styles.previewImage, { backgroundColor: palette.subtleBg }]} />
              <Text style={[styles.metaText, { color: palette.label }]}>Archivo: {selectedImage.fileName}</Text>
              <Text style={[styles.metaText, { color: palette.label }]}>Tamano: {formatBytes(selectedImage.sizeBytes)}</Text>
              <Text style={[styles.metaText, { color: palette.label }]}>Estado: Sin confirmar</Text>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
                  onPress={onRemoveSelectedPhoto}
                >
                  <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Quitar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
                  onPress={onConfirmSelectedPhoto}
                >
                  <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>Confirmar</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {confirmedEvidence.length === 0 ? (
            <Text style={[styles.hintText, { color: palette.hint }]}>Aun no agregaste fotos.</Text>
          ) : (
            confirmedEvidence.map((item, index) => (
              <View key={`${item.uri}-${index}`} style={[styles.photoRow, { borderColor: palette.inputBorder }]}>
                <View style={styles.photoRowTextWrap}>
                  <Text style={[styles.metaText, { color: palette.textPrimary }]}>{item.fileName}</Text>
                  <Text style={[styles.metaText, { color: palette.textSecondary }]}>
                    {formatBytes(item.sizeBytes)} | Captured: {formatDateTime(item.deviceCapturedAt)}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => onRemoveConfirmedPhoto(index)}>
                  <Text style={[styles.removeText, { color: palette.errorText }]}>Quitar</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      ) : null}

      {step === 3 ? (
        <View style={[styles.section, styles.summaryCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Resumen</Text>
          <Text style={[styles.metaText, { color: palette.textSecondary }]}>Checklist aplicado: {checklistCount} items</Text>
          <Text style={[styles.metaText, { color: palette.textSecondary }]}>Nota: {note.trim().length} caracteres</Text>
          <Text style={[styles.metaText, { color: palette.textSecondary }]}>Evidencias confirmadas: {confirmedEvidence.length}</Text>
          <Text style={[styles.hintText, { color: palette.hint }]}>Cada evidencia se sube y queda registrada por incidencia.</Text>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: palette.primaryButtonBg },
              saving && styles.primaryButtonDisabled,
            ]}
            onPress={onSaveAllEvidence}
            disabled={saving || processingImage}
            accessibilityRole="button"
            accessibilityLabel="Confirmar y guardar evidencia"
          >
            {saving ? (
              <ActivityIndicator color={palette.primaryButtonText} />
            ) : (
              <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>Confirmar y guardar</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {feedback ? (
        <View
          style={[
            styles.feedbackBox,
            {
              backgroundColor: feedbackColors.backgroundColor,
              borderColor: feedbackColors.borderColor,
            },
          ]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.feedbackTitle, { color: feedbackColors.color }]}>{feedback.title}</Text>
          <Text style={[styles.feedbackMessage, { color: feedbackColors.color }]}>{feedback.message}</Text>
        </View>
      ) : null}

      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
          onPress={onBackStep}
          disabled={step === 0 || saving}
        >
          <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Anterior</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            { backgroundColor: palette.primaryButtonBg },
            (step === 3 || saving) && styles.primaryButtonDisabled,
          ]}
          onPress={onNextStep}
          disabled={step === 3 || saving}
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
    fontFamily: fontFamilies.bold,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: fontFamilies.bold,
  },
  label: {
    fontSize: 13,
    fontFamily: fontFamilies.semibold,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteInput: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  checkItem: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  checkItemText: {
    fontSize: 14,
    fontFamily: fontFamilies.semibold,
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
    fontFamily: fontFamilies.bold,
  },
  primaryButton: {
    flex: 1,
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
    fontFamily: fontFamilies.bold,
    fontSize: 15,
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
    fontFamily: fontFamilies.regular,
  },
  metaText: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  photoRow: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  photoRowTextWrap: {
    flex: 1,
    gap: 2,
  },
  removeText: {
    fontFamily: fontFamilies.bold,
    fontSize: 12,
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  feedbackBox: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  feedbackTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 13,
  },
  feedbackMessage: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
});

import { useEffect, useMemo, useRef, useState } from "react";
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
import { extractApiError } from "@/src/api/client";
import { useThemePreference } from "@/src/theme/theme-preference";

type SelectedImage = {
  uri: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isTemporary: boolean;
};

const IMAGE_PICK_QUALITY = 1;
const MAX_UPLOAD_PHOTO_BYTES = 5 * 1024 * 1024;
const MIN_UPLOAD_PHOTO_BYTES = 1024;
const MAX_IMAGE_DIMENSION = 1920;
const COMPRESS_QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];

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

export default function UploadIncidentPhotoScreen() {
  const { resolvedScheme } = useThemePreference();
  const isDark = resolvedScheme === "dark";
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

  const [incidentId, setIncidentId] = useState(initialIncidentId || "");
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const selectedImageRef = useRef<SelectedImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const palette = useMemo(
    () => ({
      screenBg: isDark ? "#020617" : "#f8fafc",
      textPrimary: isDark ? "#e2e8f0" : "#0f172a",
      textSecondary: isDark ? "#94a3b8" : "#475569",
      label: isDark ? "#cbd5e1" : "#1e293b",
      inputBg: isDark ? "#111827" : "#ffffff",
      inputBorder: isDark ? "#334155" : "#cbd5e1",
      placeholder: isDark ? "#64748b" : "#808080",
      cardBg: isDark ? "#0f172a" : "#ffffff",
      cardBorder: isDark ? "#334155" : "#cbd5e1",
      subtleBg: isDark ? "#1e293b" : "#e2e8f0",
      hint: isDark ? "#94a3b8" : "#64748b",
      secondaryBg: isDark ? "#0f172a" : "#ffffff",
      secondaryText: isDark ? "#cbd5e1" : "#0f172a",
    }),
    [isDark],
  );

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
      Alert.alert("Imagen invalida", extractApiError(error));
    } finally {
      setProcessingImage(false);
      setProcessingMessage("");
    }
  };

  const pickFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso requerido", "Debes permitir acceso a galeria.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      quality: IMAGE_PICK_QUALITY,
    });
    if (result.canceled || !result.assets?.length) return;
    await setImageFromAsset(result.assets[0]);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso requerido", "Debes permitir acceso a camara.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: IMAGE_PICK_QUALITY,
    });
    if (result.canceled || !result.assets?.length) return;
    await setImageFromAsset(result.assets[0]);
  };

  const onUpload = async () => {
    const parsedIncidentId = Number.parseInt(incidentId, 10);
    if (!Number.isInteger(parsedIncidentId) || parsedIncidentId <= 0) {
      Alert.alert("Dato invalido", "incident_id debe ser un numero positivo.");
      return;
    }
    if (!selectedImage?.uri) {
      Alert.alert("Falta imagen", "Selecciona o toma una foto primero.");
      return;
    }
    if (processingImage) {
      Alert.alert("Procesando imagen", "Espera a que termine la compresion.");
      return;
    }

    try {
      setUploading(true);
      const response = await uploadIncidentPhoto({
        incidentId: parsedIncidentId,
        fileUri: selectedImage.uri,
        fileName: selectedImage.fileName,
        contentType: selectedImage.contentType,
      });
      Alert.alert("Foto subida", `Foto ID: ${response.photo.id}`);
      if (selectedImage.isTemporary) {
        await deleteFileIfExists(selectedImage.uri);
      }
      setSelectedImage(null);
      router.replace(
        `/incident/detail?incidentId=${parsedIncidentId}&installationId=${installationId}` as never,
      );
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: palette.screenBg }]}>
      <Stack.Screen options={{ title: "Subir foto" }} />

      <Text style={[styles.title, { color: palette.textPrimary }]}>Subir foto de incidencia</Text>
      {installationId ? (
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>Instalacion #{installationId}</Text>
      ) : null}

      <Text style={[styles.label, { color: palette.label }]}>Incident ID</Text>
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
      />

      <View style={styles.row}>
        <TouchableOpacity
          style={[
            styles.secondaryButton,
            { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder },
          ]}
          onPress={pickFromGallery}
          disabled={uploading || processingImage}
        >
          <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Galeria</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.secondaryButton,
            { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder },
          ]}
          onPress={takePhoto}
          disabled={uploading || processingImage}
        >
          <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Camara</Text>
        </TouchableOpacity>
      </View>

      {processingImage ? (
        <View style={styles.processingRow}>
          <ActivityIndicator color="#0b7a75" />
          <Text style={[styles.hintText, { color: palette.hint }]}>
            {processingMessage || "Comprimiendo imagen para subir..."}
          </Text>
        </View>
      ) : null}

      {selectedImage ? (
        <View style={[styles.previewCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
          <Image source={{ uri: selectedImage.uri }} style={[styles.previewImage, { backgroundColor: palette.subtleBg }]} />
          <Text style={[styles.metaText, { color: palette.label }]}>Archivo: {selectedImage.fileName}</Text>
          <Text style={[styles.metaText, { color: palette.label }]}>Tipo: {selectedImage.contentType}</Text>
          <Text style={[styles.metaText, { color: palette.label }]}>Tamano: {formatBytes(selectedImage.sizeBytes)}</Text>
        </View>
      ) : (
        <Text style={[styles.hintText, { color: palette.hint }]}>Todavia no seleccionaste ninguna foto.</Text>
      )}

      <TouchableOpacity
        style={[styles.primaryButton, uploading && styles.primaryButtonDisabled]}
        onPress={onUpload}
        disabled={uploading || processingImage}
      >
        {uploading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.primaryButtonText}>Subir foto</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 12,
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
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1e293b",
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
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
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: "#0f172a",
    fontWeight: "700",
  },
  previewCard: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 8,
  },
  previewImage: {
    width: "100%",
    height: 260,
    borderRadius: 8,
    backgroundColor: "#e2e8f0",
  },
  hintText: {
    color: "#64748b",
    fontSize: 13,
  },
  metaText: {
    color: "#334155",
    fontSize: 12,
  },
  primaryButton: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: "#0b7a75",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
});

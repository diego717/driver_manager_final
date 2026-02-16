import { useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
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
import { contentTypeFromFileName } from "@/src/utils/validation";

type SelectedImage = {
  uri: string;
  fileName: string;
  contentType: string;
};

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function extensionFromMime(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export default function UploadIncidentPhotoScreen() {
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
  const [uploading, setUploading] = useState(false);

  const setImageFromAsset = (asset: ImagePicker.ImagePickerAsset) => {
    const mime = asset.mimeType && asset.mimeType.startsWith("image/")
      ? asset.mimeType
      : "image/jpeg";
    const ext = extensionFromMime(mime);
    const fallbackName = `incident_${incidentId || "0"}_${Date.now()}.${ext}`;
    const name = asset.fileName || fallbackName;
    const type = asset.mimeType || contentTypeFromFileName(name);

    setSelectedImage({
      uri: asset.uri,
      fileName: name,
      contentType: type,
    });
  };

  const pickFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso requerido", "Debes permitir acceso a galeria.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.length) return;
    setImageFromAsset(result.assets[0]);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso requerido", "Debes permitir acceso a camara.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.length) return;
    setImageFromAsset(result.assets[0]);
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

    try {
      setUploading(true);
      const response = await uploadIncidentPhoto({
        incidentId: parsedIncidentId,
        fileUri: selectedImage.uri,
        fileName: selectedImage.fileName,
        contentType: selectedImage.contentType,
      });
      Alert.alert("Foto subida", `Foto ID: ${response.photo.id}`);
      router.back();
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: "Subir foto" }} />

      <Text style={styles.title}>Subir foto de incidencia</Text>
      {installationId ? (
        <Text style={styles.subtitle}>Instalacion #{installationId}</Text>
      ) : null}

      <Text style={styles.label}>Incident ID</Text>
      <TextInput
        value={incidentId}
        onChangeText={setIncidentId}
        keyboardType="numeric"
        style={styles.input}
        placeholder="Ej: 15"
        placeholderTextColor="#808080"
      />

      <View style={styles.row}>
        <TouchableOpacity style={styles.secondaryButton} onPress={pickFromGallery} disabled={uploading}>
          <Text style={styles.secondaryButtonText}>Galeria</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={takePhoto} disabled={uploading}>
          <Text style={styles.secondaryButtonText}>Camara</Text>
        </TouchableOpacity>
      </View>

      {selectedImage ? (
        <View style={styles.previewCard}>
          <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} />
          <Text style={styles.metaText}>Archivo: {selectedImage.fileName}</Text>
          <Text style={styles.metaText}>Tipo: {selectedImage.contentType}</Text>
        </View>
      ) : (
        <Text style={styles.hintText}>Todavia no seleccionaste ninguna foto.</Text>
      )}

      <TouchableOpacity
        style={[styles.primaryButton, uploading && styles.primaryButtonDisabled]}
        onPress={onUpload}
        disabled={uploading}
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


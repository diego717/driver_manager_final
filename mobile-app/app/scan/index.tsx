import React, { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  listAssets,
  resolveAssetByExternalCode,
  updateAsset,
  type AssetRecord,
  type ResolveAssetPayload,
} from "@/src/api/assets";
import { extractAssetLabelFromImage, lookupCode } from "@/src/api/scan";
import { extractApiError } from "@/src/api/client";
import ConsoleButton from "@/src/components/ConsoleButton";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import { extractAssetLabelOnDevice } from "@/src/services/asset-label-ocr";
import { triggerSuccessHaptic, triggerWarningHaptic } from "@/src/services/haptics";
import {
  normalizeAssetIdentifierForCompare,
  normalizePreviewLabelDraft,
  validatePreviewLabelDraft,
  type PreviewValidationErrors,
} from "@/src/utils/asset-label-preview";
import { parseScannedPayload, type ParsedAssetLabelData } from "@/src/utils/scan";
import { radii, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, inputFontFamily, typeScale } from "@/src/theme/typography";

const ENABLE_REMOTE_OCR_FALLBACK =
  String(process.env.EXPO_PUBLIC_ENABLE_REMOTE_OCR_FALLBACK || "").trim().toLowerCase() === "true";
const OCR_STRICT_REVIEW_ENABLED =
  String(process.env.EXPO_PUBLIC_OCR_STRICT_REVIEW || "true").trim().toLowerCase() !== "false";
const OCR_LOW_CONFIDENCE_THRESHOLD = (() => {
  const parsed = Number.parseFloat(String(process.env.EXPO_PUBLIC_OCR_LOW_CONFIDENCE_THRESHOLD || "0.72"));
  if (!Number.isFinite(parsed)) return 0.72;
  return Math.max(0.4, Math.min(0.95, parsed));
})();
const PREVIEW_FIELDS: Array<keyof ParsedAssetLabelData> = [
  "external_code",
  "brand",
  "model",
  "serial_number",
  "client_name",
  "notes",
];

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizePreviewCompareValue(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeConfidenceValue(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

export default function ScanScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolvingLabel, setResolvingLabel] = useState("Resolviendo codigo...");
  const [manualCode, setManualCode] = useState("");
  const [pendingLabelPreview, setPendingLabelPreview] = useState<ParsedAssetLabelData | null>(null);
  const [pendingLabelOriginal, setPendingLabelOriginal] = useState<ParsedAssetLabelData | null>(null);
  const [pendingLabelErrors, setPendingLabelErrors] = useState<PreviewValidationErrors>({});
  const [pendingLabelConfidence, setPendingLabelConfidence] = useState<number | null>(null);
  const [pendingLabelRequiresReview, setPendingLabelRequiresReview] = useState(false);
  const [pendingLabelReviewConfirmed, setPendingLabelReviewConfirmed] = useState(false);

  const isPreviewFieldEdited = (field: keyof ParsedAssetLabelData): boolean => {
    if (!pendingLabelPreview || !pendingLabelOriginal) return false;
    return normalizePreviewCompareValue(pendingLabelPreview[field])
      !== normalizePreviewCompareValue(pendingLabelOriginal[field]);
  };

  const editedPreviewCount = PREVIEW_FIELDS.reduce((count, field) => (
    isPreviewFieldEdited(field) ? count + 1 : count
  ), 0);
  const hasCriticalManualEdit = isPreviewFieldEdited("external_code") || isPreviewFieldEdited("serial_number");

  const buildAssetPayloadFromLabel = (label: ParsedAssetLabelData): string => {
    const externalCode = String(label.external_code || "").trim();
    const payloadParams = new URLSearchParams();
    payloadParams.set("v", "2");
    if (String(label.brand || "").trim()) payloadParams.set("brand", String(label.brand).trim());
    if (String(label.model || "").trim()) payloadParams.set("model", String(label.model).trim());
    payloadParams.set("serial_number", String(label.serial_number || externalCode).trim());
    if (String(label.client_name || "").trim()) {
      payloadParams.set("client_name", String(label.client_name).trim());
    }
    if (String(label.notes || "").trim()) payloadParams.set("notes", String(label.notes).trim());
    return `dm://asset/${encodeURIComponent(externalCode)}?${payloadParams.toString()}`;
  };

  const clearPendingLabelPreview = () => {
    setPendingLabelPreview(null);
    setPendingLabelOriginal(null);
    setPendingLabelErrors({});
    setPendingLabelConfidence(null);
    setPendingLabelRequiresReview(false);
    setPendingLabelReviewConfirmed(false);
  };

  const onPreviewFieldChange = (field: keyof ParsedAssetLabelData, value: string) => {
    setPendingLabelPreview((previous) => (previous ? { ...previous, [field]: value } : previous));
    setPendingLabelErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
    if (pendingLabelRequiresReview && (field === "external_code" || field === "serial_number")) {
      setPendingLabelReviewConfirmed(true);
    }
  };

  const resolveDuplicateBySerial = async (serialNumber: string): Promise<AssetRecord | null> => {
    const normalizedSerial = normalizeAssetIdentifierForCompare(serialNumber);
    if (!normalizedSerial) return null;

    const candidates = await listAssets({ search: normalizedSerial, limit: 25 });
    const matched = candidates.find((item) => (
      normalizeAssetIdentifierForCompare(String(item.serial_number || "")) === normalizedSerial
    ));
    return matched || null;
  };

  const findDuplicateAssetCandidate = async (draft: ParsedAssetLabelData): Promise<AssetRecord | null> => {
    const byCode = await listAssets({ code: draft.external_code, limit: 1 });
    if (Array.isArray(byCode) && byCode[0]) {
      return byCode[0];
    }
    return resolveDuplicateBySerial(draft.serial_number);
  };

  const onUseExistingDuplicate = (duplicate: AssetRecord, fallbackExternalCode: string) => {
    const targetCode = String(duplicate.external_code || fallbackExternalCode || "").trim();
    if (!targetCode) {
      void triggerWarningHaptic();
      Alert.alert("No se pudo continuar", "El equipo duplicado no tiene codigo externo valido.");
      return;
    }
    clearPendingLabelPreview();
    setLocked(true);
    void resolveAndNavigate(
      `dm://asset/${encodeURIComponent(targetCode)}`,
      "Abriendo equipo existente...",
    );
  };

  const onUpdateExistingDuplicate = async (
    duplicate: AssetRecord,
    draft: ParsedAssetLabelData,
  ) => {
    const duplicateId = parsePositiveInteger(duplicate.id);
    if (!duplicateId) {
      void triggerWarningHaptic();
      Alert.alert("No se pudo actualizar", "El equipo duplicado no tiene id valido.");
      return;
    }

    setLocked(true);
    setResolving(true);
    setResolvingLabel("Actualizando equipo existente...");
    try {
      await updateAsset(duplicateId, {
        brand: draft.brand,
        model: draft.model,
        serial_number: draft.serial_number,
        client_name: draft.client_name,
        notes: draft.notes,
        status: "active",
      });
      const targetCode = String(duplicate.external_code || draft.external_code).trim();
      clearPendingLabelPreview();
      await resolveAndNavigate(
        `dm://asset/${encodeURIComponent(targetCode)}`,
        "Abriendo equipo actualizado...",
      );
    } catch (error) {
      void triggerWarningHaptic();
      Alert.alert("No se pudo actualizar duplicado", extractApiError(error));
      setLocked(false);
      setResolving(false);
      setResolvingLabel("Resolviendo codigo...");
    }
  };

  const navigateToCaseContext = (values: {
    installationId?: number | null;
    assetExternalCode?: string | null;
    assetRecordId?: number | null;
  }) => {
    const params = new URLSearchParams();
    if (values.installationId && values.installationId > 0) {
      params.set("installationId", String(values.installationId));
    }
    if (values.assetExternalCode?.trim()) {
      params.set("assetExternalCode", values.assetExternalCode.trim());
    }
    if (values.assetRecordId && values.assetRecordId > 0) {
      params.set("assetRecordId", String(values.assetRecordId));
    }

    const query = params.toString();
    router.replace((query ? `/case/context?${query}` : "/case/context") as never);
  };

  const resolveAndNavigate = async (rawValue: string, label = "Resolviendo codigo...") => {
    setResolvingLabel(label);
    const parsed = parseScannedPayload(rawValue);
    if (!parsed) {
      void triggerWarningHaptic();
      Alert.alert(
        "Codigo invalido",
        "Formato esperado: dm://installation/{id}, dm://asset/{external_code} o dm://asset/{external_code}?v=2&brand=...",
      );
      setLocked(false);
      return;
    }

    setResolving(true);
    try {
      if (parsed.type === "installation") {
        void triggerSuccessHaptic();
        navigateToCaseContext({ installationId: parsed.installationId });
        return;
      }

      const lookup = await lookupCode(parsed.externalCode, "asset");
      const match = lookup?.match || {};
      const matchedAssetRecordId = parsePositiveInteger(match.asset_record_id);
      const matchedInstallationId = parsePositiveInteger(match.installation_id);
      const matchedExternalCode = String(
        match.external_code ?? match.asset_id ?? parsed.externalCode,
      ).trim();

      if (matchedAssetRecordId) {
        void triggerSuccessHaptic();
        navigateToCaseContext({
          installationId: matchedInstallationId ?? undefined,
          assetExternalCode: matchedExternalCode || parsed.externalCode,
          assetRecordId: matchedAssetRecordId,
        });
        return;
      }

      if (parsed.assetData) {
        const resolvePayload: ResolveAssetPayload = {
          brand: parsed.assetData.brand,
          model: parsed.assetData.model,
          serial_number: parsed.assetData.serial_number,
          client_name: parsed.assetData.client_name,
          notes: parsed.assetData.notes,
          status: "active",
          update_existing: true,
        };
        const resolved = await resolveAssetByExternalCode(
          parsed.assetData.external_code,
          resolvePayload,
        );
        const resolvedAssetId = parsePositiveInteger(resolved?.asset?.id);
        const resolvedExternalCode = String(
          resolved?.asset?.external_code || parsed.assetData.external_code || parsed.externalCode,
        ).trim();

        void triggerSuccessHaptic();
        navigateToCaseContext({
          installationId: matchedInstallationId ?? undefined,
          assetExternalCode: resolvedExternalCode || parsed.externalCode,
          assetRecordId: resolvedAssetId ?? undefined,
        });
        return;
      }

      void triggerSuccessHaptic();
      navigateToCaseContext({
        installationId: matchedInstallationId ?? undefined,
        assetExternalCode: matchedExternalCode || parsed.externalCode,
        assetRecordId: undefined,
      });
    } catch (error) {
      void triggerWarningHaptic();
      Alert.alert("No se pudo resolver", extractApiError(error));
      setLocked(false);
    } finally {
      setResolving(false);
      setResolvingLabel("Resolviendo codigo...");
    }
  };

  const onDetectLabelFromCamera = async () => {
    if (locked || resolving) return;

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      void triggerWarningHaptic();
      Alert.alert("Permiso requerido", "Debes permitir acceso a camara para detectar etiquetas.");
      return;
    }

    const capture = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.35,
      base64: ENABLE_REMOTE_OCR_FALLBACK,
    });
    if (capture.canceled || !capture.assets?.length) {
      return;
    }

    const photo = capture.assets[0];
    const imageUri = String(photo?.uri || "").trim();
    if (!imageUri) {
      void triggerWarningHaptic();
      Alert.alert("Sin imagen", "No se pudo obtener la foto para deteccion.");
      return;
    }

    setLocked(true);
    setResolving(true);
    setResolvingLabel("Detectando etiqueta en el dispositivo...");
    try {
      const localOcr = await extractAssetLabelOnDevice(imageUri);
      let label = localOcr.label;
      let detectedConfidence = normalizeConfidenceValue(localOcr.confidence);

      if (!label && ENABLE_REMOTE_OCR_FALLBACK) {
        const remoteBase64 = String(photo?.base64 || "").trim();
        if (!remoteBase64) {
          throw new Error(
            "No se pudo leer imagen en base64 para fallback remoto. Vuelve a intentar la captura.",
          );
        }
        setResolvingLabel("OCR local sin resultado, probando OCR remoto...");
        const extraction = await extractAssetLabelFromImage({
          imageBase64: remoteBase64,
          mimeType: String(photo?.mimeType || "image/jpeg"),
        });
        label = extraction?.label || null;
        detectedConfidence = normalizeConfidenceValue(extraction?.label?.confidence);
      }

      if (!label) {
        if (!localOcr.supported) {
          throw new Error(
            "OCR local no disponible en este build/dispositivo. Usa un Development Build o activa fallback remoto.",
          );
        }
        throw new Error(
          "No pudimos interpretar la etiqueta. Acerca mas la camara, mejora luz y evita reflejos.",
        );
      }

      const externalCode = String(label?.external_code || "").trim();
      if (!externalCode) {
        throw new Error("No pudimos detectar un codigo de equipo en la etiqueta.");
      }
      setPendingLabelPreview({
        external_code: externalCode,
        brand: String(label.brand || "").trim(),
        model: String(label.model || "").trim(),
        serial_number: String(label.serial_number || externalCode).trim(),
        client_name: String(label.client_name || "").trim(),
        notes: String(label.notes || "").trim(),
      });
      setPendingLabelOriginal({
        external_code: externalCode,
        brand: String(label.brand || "").trim(),
        model: String(label.model || "").trim(),
        serial_number: String(label.serial_number || externalCode).trim(),
        client_name: String(label.client_name || "").trim(),
        notes: String(label.notes || "").trim(),
      });
      setPendingLabelErrors({});
      setPendingLabelConfidence(detectedConfidence);
      const requiresManualReview = OCR_STRICT_REVIEW_ENABLED
        && (detectedConfidence === null || detectedConfidence < OCR_LOW_CONFIDENCE_THRESHOLD);
      setPendingLabelRequiresReview(requiresManualReview);
      setPendingLabelReviewConfirmed(!requiresManualReview);
      setLocked(false);
      setResolving(false);
      setResolvingLabel("Resolviendo codigo...");
    } catch (error) {
      void triggerWarningHaptic();
      Alert.alert("No se pudo detectar etiqueta", extractApiError(error));
      setLocked(false);
      setResolving(false);
      setResolvingLabel("Resolviendo codigo...");
    }
  };

  const onBarcodeScanned = (result: BarcodeScanningResult) => {
    if (locked || resolving || pendingLabelPreview) return;
    setLocked(true);
    void resolveAndNavigate(result.data);
  };

  const onManualSubmit = () => {
    if (!manualCode.trim()) return;
    if (pendingLabelPreview) {
      clearPendingLabelPreview();
    }
    setLocked(true);
    void resolveAndNavigate(manualCode);
  };

  const onConfirmLabelPreview = async () => {
    if (!pendingLabelPreview) return;
    const normalizedDraft = normalizePreviewLabelDraft(pendingLabelPreview);
    setPendingLabelPreview(normalizedDraft);

    const validation = validatePreviewLabelDraft(normalizedDraft);
    if (!validation.isValid) {
      setPendingLabelErrors(validation.errors);
      void triggerWarningHaptic();
      Alert.alert("Faltan datos requeridos", "Revisa Codigo externo y Serie antes de continuar.");
      return;
    }
    setPendingLabelErrors({});

    const hasCriticalReviewAgainstOriginal = pendingLabelOriginal
      ? (
        normalizePreviewCompareValue(normalizedDraft.external_code)
          !== normalizePreviewCompareValue(pendingLabelOriginal.external_code)
        || normalizePreviewCompareValue(normalizedDraft.serial_number)
          !== normalizePreviewCompareValue(pendingLabelOriginal.serial_number)
      )
      : false;
    if (pendingLabelRequiresReview && !pendingLabelReviewConfirmed && !hasCriticalReviewAgainstOriginal) {
      void triggerWarningHaptic();
      Alert.alert(
        "Revision manual obligatoria",
        "La confianza OCR es baja. Marca la revision manual o corrige Codigo/Serie para continuar.",
      );
      return;
    }

    setLocked(true);
    setResolving(true);
    setResolvingLabel("Validando duplicados...");
    try {
      const duplicate = await findDuplicateAssetCandidate(normalizedDraft);
      if (duplicate) {
        setLocked(false);
        setResolving(false);
        setResolvingLabel("Resolviendo codigo...");

        const duplicateCode = String(duplicate.external_code || "").trim();
        const duplicateSerial = String(duplicate.serial_number || "").trim();
        Alert.alert(
          "Equipo existente detectado",
          [
            duplicateCode ? `Codigo: ${duplicateCode}` : "",
            duplicateSerial ? `Serie: ${duplicateSerial}` : "",
            "Que deseas hacer?",
          ].filter(Boolean).join("\n"),
          [
            {
              text: "Usar existente",
              onPress: () => onUseExistingDuplicate(duplicate, normalizedDraft.external_code),
            },
            {
              text: "Actualizar existente",
              onPress: () => {
                void onUpdateExistingDuplicate(duplicate, normalizedDraft);
              },
            },
            {
              text: "Cancelar",
              style: "cancel",
            },
          ],
        );
        return;
      }

      const payload = buildAssetPayloadFromLabel(normalizedDraft);
      clearPendingLabelPreview();
      await resolveAndNavigate(payload, "Resolviendo etiqueta confirmada...");
    } catch (error) {
      void triggerWarningHaptic();
      Alert.alert("No se pudo validar", extractApiError(error));
      setLocked(false);
      setResolving(false);
      setResolvingLabel("Resolviendo codigo...");
    }
  };

  const onCancelLabelPreview = () => {
    clearPendingLabelPreview();
    setLocked(false);
    void triggerWarningHaptic();
  };

  const onTogglePreviewManualReview = () => {
    setPendingLabelReviewConfirmed((previous) => !previous);
  };

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: "Escanear codigo" }} />

      <ScreenHero
        eyebrow="Captura en campo"
        title="Escanear QR o codigo"
        description="El escaneo ya no cae en un formulario largo. Primero resuelve el contexto y despues decide si continuas el caso o cargas una incidencia."
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
              {permission?.granted ? "camara lista" : "permiso pendiente"}
            </Text>
          </View>
        }
      />

      <View style={[styles.cameraFrame, { borderColor: palette.cameraBorder, backgroundColor: palette.cardBg }]}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr", "ean13", "ean8", "code128", "code39"] }}
            onBarcodeScanned={onBarcodeScanned}
          />
        ) : (
          <View style={styles.noCameraContainer}>
            <Text style={[styles.noCameraText, { color: palette.textSecondary }]}>Camara no disponible o sin permisos.</Text>
            <ConsoleButton
              variant="subtle"
              style={styles.secondaryButton}
              onPress={() => {
                void requestPermission();
              }}
              label="Solicitar permiso"
              textStyle={styles.secondaryButtonText}
            />
          </View>
        )}

        {resolving ? (
          <View style={[styles.overlay, { backgroundColor: palette.overlayBg }]}>
            <ActivityIndicator color={palette.primaryButtonText} />
            <Text style={[styles.overlayText, { color: palette.primaryButtonText }]}>{resolvingLabel}</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.manualCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
        {pendingLabelPreview ? (
          <View style={[styles.previewCard, { borderColor: palette.cardBorder, backgroundColor: palette.inputBg }]}>
            <Text style={[styles.previewTitle, { color: palette.textPrimary }]}>Vista previa de etiqueta</Text>
            <Text style={[styles.previewDescription, { color: palette.textSecondary }]}>
              Revisa y confirma antes de crear o actualizar el equipo.
            </Text>
            <View style={styles.previewMetaRow}>
              <View
                style={[
                  styles.previewConfidenceBadge,
                  {
                    backgroundColor: (pendingLabelConfidence !== null && pendingLabelConfidence >= OCR_LOW_CONFIDENCE_THRESHOLD)
                      ? palette.successBg
                      : palette.warningBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.previewConfidenceText,
                    {
                      color: (pendingLabelConfidence !== null && pendingLabelConfidence >= OCR_LOW_CONFIDENCE_THRESHOLD)
                        ? palette.successText
                        : palette.warningText,
                    },
                  ]}
                >
                  {pendingLabelConfidence === null
                    ? "Confianza OCR: sin dato"
                    : `Confianza OCR: ${Math.round(pendingLabelConfidence * 100)}%`}
                </Text>
              </View>
            </View>
            {pendingLabelRequiresReview ? (
              <View
                style={[
                  styles.previewReviewCard,
                  {
                    backgroundColor: palette.warningBg,
                    borderColor: palette.warningText,
                  },
                ]}
              >
                <Text style={[styles.previewReviewTitle, { color: palette.warningText }]}>
                  Revision manual requerida
                </Text>
                <Text style={[styles.previewReviewBody, { color: palette.textSecondary }]}>
                  Confianza OCR menor al umbral ({Math.round(OCR_LOW_CONFIDENCE_THRESHOLD * 100)}%).
                  Revisa Codigo y Serie antes de confirmar.
                </Text>
                <ConsoleButton
                  variant={pendingLabelReviewConfirmed ? "primary" : "ghost"}
                  size="sm"
                  style={styles.previewReviewButton}
                  onPress={onTogglePreviewManualReview}
                  label={pendingLabelReviewConfirmed
                    ? "Revision manual marcada"
                    : "Marcar revision manual"}
                  textStyle={styles.previewReviewButtonText}
                />
              </View>
            ) : null}
            <Text
              style={[
                styles.previewEditSummary,
                { color: editedPreviewCount > 0 ? palette.warningText : palette.textSecondary },
              ]}
            >
              {editedPreviewCount > 0
                ? `${editedPreviewCount} ${editedPreviewCount === 1 ? "campo editado manualmente" : "campos editados manualmente"}`
                : "Sin cambios manuales sobre el OCR detectado."}
            </Text>
            <View style={styles.previewFieldHeader}>
              <Text style={[styles.previewFieldLabel, { color: palette.textSecondary }]}>Codigo externo *</Text>
              {isPreviewFieldEdited("external_code") ? (
                <View style={[styles.previewEditedBadge, { backgroundColor: palette.warningBg }]}>
                  <Text style={[styles.previewEditedBadgeText, { color: palette.warningText }]}>Editado</Text>
                </View>
              ) : null}
            </View>
            <TextInput
              value={pendingLabelPreview.external_code}
              onChangeText={(value) => {
                onPreviewFieldChange("external_code", value);
              }}
              placeholder="EQ-0001"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.input,
                {
                  backgroundColor: palette.cardBg,
                  borderColor: pendingLabelErrors.external_code
                    ? palette.errorBorder
                    : isPreviewFieldEdited("external_code")
                      ? palette.warningText
                      : palette.inputBorder,
                  color: palette.textPrimary,
                },
              ]}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {pendingLabelErrors.external_code ? (
              <Text style={[styles.previewErrorText, { color: palette.errorText }]}>
                {pendingLabelErrors.external_code}
              </Text>
            ) : null}
            <View style={styles.previewFieldHeader}>
              <Text style={[styles.previewFieldLabel, { color: palette.textSecondary }]}>Marca</Text>
              {isPreviewFieldEdited("brand") ? (
                <View style={[styles.previewEditedBadge, { backgroundColor: palette.warningBg }]}>
                  <Text style={[styles.previewEditedBadgeText, { color: palette.warningText }]}>Editado</Text>
                </View>
              ) : null}
            </View>
            <TextInput
              value={pendingLabelPreview.brand}
              onChangeText={(value) => {
                onPreviewFieldChange("brand", value);
              }}
              placeholder="Entrust"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.input,
                {
                  backgroundColor: palette.cardBg,
                  borderColor: isPreviewFieldEdited("brand") ? palette.warningText : palette.inputBorder,
                  color: palette.textPrimary,
                },
              ]}
            />
            <View style={styles.previewFieldHeader}>
              <Text style={[styles.previewFieldLabel, { color: palette.textSecondary }]}>Modelo</Text>
              {isPreviewFieldEdited("model") ? (
                <View style={[styles.previewEditedBadge, { backgroundColor: palette.warningBg }]}>
                  <Text style={[styles.previewEditedBadgeText, { color: palette.warningText }]}>Editado</Text>
                </View>
              ) : null}
            </View>
            <TextInput
              value={pendingLabelPreview.model}
              onChangeText={(value) => {
                onPreviewFieldChange("model", value);
              }}
              placeholder="Sigma SL3"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.input,
                {
                  backgroundColor: palette.cardBg,
                  borderColor: isPreviewFieldEdited("model") ? palette.warningText : palette.inputBorder,
                  color: palette.textPrimary,
                },
              ]}
            />
            <View style={styles.previewFieldHeader}>
              <Text style={[styles.previewFieldLabel, { color: palette.textSecondary }]}>Serie</Text>
              {isPreviewFieldEdited("serial_number") ? (
                <View style={[styles.previewEditedBadge, { backgroundColor: palette.warningBg }]}>
                  <Text style={[styles.previewEditedBadgeText, { color: palette.warningText }]}>Editado</Text>
                </View>
              ) : null}
            </View>
            <TextInput
              value={pendingLabelPreview.serial_number}
              onChangeText={(value) => {
                onPreviewFieldChange("serial_number", value);
              }}
              placeholder="SN-0001"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.input,
                {
                  backgroundColor: palette.cardBg,
                  borderColor: pendingLabelErrors.serial_number
                    ? palette.errorBorder
                    : isPreviewFieldEdited("serial_number")
                      ? palette.warningText
                      : palette.inputBorder,
                  color: palette.textPrimary,
                },
              ]}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {pendingLabelErrors.serial_number ? (
              <Text style={[styles.previewErrorText, { color: palette.errorText }]}>
                {pendingLabelErrors.serial_number}
              </Text>
            ) : null}
            <View style={styles.previewFieldHeader}>
              <Text style={[styles.previewFieldLabel, { color: palette.textSecondary }]}>Cliente</Text>
              {isPreviewFieldEdited("client_name") ? (
                <View style={[styles.previewEditedBadge, { backgroundColor: palette.warningBg }]}>
                  <Text style={[styles.previewEditedBadgeText, { color: palette.warningText }]}>Editado</Text>
                </View>
              ) : null}
            </View>
            <TextInput
              value={pendingLabelPreview.client_name}
              onChangeText={(value) => {
                onPreviewFieldChange("client_name", value);
              }}
              placeholder="Cliente destino"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.input,
                {
                  backgroundColor: palette.cardBg,
                  borderColor: isPreviewFieldEdited("client_name") ? palette.warningText : palette.inputBorder,
                  color: palette.textPrimary,
                },
              ]}
            />
            <View style={styles.previewFieldHeader}>
              <Text style={[styles.previewFieldLabel, { color: palette.textSecondary }]}>Notas</Text>
              {isPreviewFieldEdited("notes") ? (
                <View style={[styles.previewEditedBadge, { backgroundColor: palette.warningBg }]}>
                  <Text style={[styles.previewEditedBadgeText, { color: palette.warningText }]}>Editado</Text>
                </View>
              ) : null}
            </View>
            <TextInput
              value={pendingLabelPreview.notes}
              onChangeText={(value) => {
                onPreviewFieldChange("notes", value);
              }}
              placeholder="Notas detectadas"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.input,
                {
                  backgroundColor: palette.cardBg,
                  borderColor: isPreviewFieldEdited("notes") ? palette.warningText : palette.inputBorder,
                  color: palette.textPrimary,
                },
              ]}
              multiline
            />
            <ConsoleButton
              variant="secondary"
              style={styles.primaryButton}
              disabled={pendingLabelRequiresReview && !pendingLabelReviewConfirmed && !hasCriticalManualEdit}
              loading={resolving}
              onPress={() => {
                void onConfirmLabelPreview();
              }}
              label="Confirmar y continuar"
              textStyle={styles.primaryButtonText}
            />
            <ConsoleButton
              variant="subtle"
              style={styles.secondaryButton}
              disabled={resolving}
              onPress={onCancelLabelPreview}
              label="Cancelar vista previa"
              textStyle={styles.secondaryButtonText}
            />
          </View>
        ) : null}

        <Text style={[styles.label, { color: palette.textPrimary }]}>Fallback manual</Text>
        <TextInput
          value={manualCode}
          onChangeText={setManualCode}
          placeholder="dm://installation/12 o dm://asset/ABC-001?v=2&brand=Entrust"
          placeholderTextColor={palette.placeholder}
          style={[
            styles.input,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <ConsoleButton
          variant="secondary"
          style={styles.primaryButton}
          disabled={resolving}
          onPress={onManualSubmit}
          label="Continuar con codigo"
          textStyle={styles.primaryButtonText}
        />
        <ConsoleButton
          variant="subtle"
          style={styles.secondaryButton}
          disabled={resolving || Boolean(pendingLabelPreview)}
          onPress={() => {
            void onDetectLabelFromCamera();
          }}
          label="Detectar etiqueta por foto"
          textStyle={styles.secondaryButtonText}
        />
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.s16,
    gap: spacing.s12,
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
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  cameraFrame: {
    height: 300,
    borderWidth: 1,
    borderRadius: radii.r22,
    overflow: "hidden",
    position: "relative",
  },
  noCameraContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.s12,
    padding: spacing.s16,
  },
  noCameraText: {
    textAlign: "center",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.s10,
  },
  overlayText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  manualCard: {
    borderWidth: 1,
    borderRadius: radii.r14,
    padding: spacing.s14,
    gap: spacing.s10,
  },
  previewCard: {
    borderWidth: 1,
    borderRadius: radii.r14,
    padding: spacing.s12,
    gap: spacing.s8,
    marginBottom: spacing.s8,
  },
  previewTitle: {
    fontFamily: fontFamilies.display,
    ...typeScale.sectionDisplay,
    fontSize: 24,
    lineHeight: 24,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  previewDescription: {
    ...typeScale.bodyCompact,
    marginBottom: spacing.s4,
  },
  previewMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.s4,
  },
  previewConfidenceBadge: {
    borderRadius: radii.full,
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s5,
  },
  previewConfidenceText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMonoTight,
    textTransform: "uppercase",
  },
  previewReviewCard: {
    borderWidth: 1,
    borderRadius: radii.r12,
    padding: spacing.s10,
    gap: spacing.s6,
    marginBottom: spacing.s4,
  },
  previewReviewTitle: {
    fontFamily: fontFamilies.semibold,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  previewReviewBody: {
    ...typeScale.bodyCompact,
  },
  previewReviewButton: {
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s8,
    alignSelf: "flex-start",
    minHeight: sizing.touchTargetMin,
  },
  previewReviewButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  previewEditSummary: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    marginBottom: spacing.s4,
    textTransform: "uppercase",
  },
  previewFieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  previewFieldLabel: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  previewEditedBadge: {
    borderRadius: radii.full,
    paddingHorizontal: spacing.s8,
    paddingVertical: 3,
  },
  previewEditedBadgeText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMonoTight,
    textTransform: "uppercase",
  },
  previewErrorText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    marginTop: -spacing.s4,
    marginBottom: spacing.s2,
    textTransform: "uppercase",
  },
  label: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderRadius: radii.r14,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
    minHeight: sizing.touchTargetMin,
    fontFamily: inputFontFamily,
    ...typeScale.bodyCompact,
  },
  primaryButton: {
    borderRadius: radii.r10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s12,
    minHeight: sizing.touchTargetMin,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  secondaryButton: {
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s14,
    paddingVertical: spacing.s10,
    minHeight: sizing.touchTargetMin,
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
});

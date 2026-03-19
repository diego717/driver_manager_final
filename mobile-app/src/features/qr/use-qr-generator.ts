import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";

import {
  listAssets,
  resolveAssetByExternalCode,
  type ResolveAssetPayload,
} from "@/src/api/assets";
import { extractApiError } from "@/src/api/client";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { buildQrPayload, normalizeAssetCodeForQr, type QrType } from "@/src/utils/qr";

import {
  buildAssetDetailsText,
  buildAssetFormData,
  buildLabelLines,
  getHelperText,
  getQrModeHint,
  hasPrefillValues,
  mergeSavedAssetValues,
  normalizeAssetFormText,
  normalizeRouteParam,
  QR_LABEL_PRESETS,
  type AssetFormData,
  type QrLabelPreset,
  type QrLabelPresetConfig,
  type QrLabelRenderState,
  type QrPrefillValues,
  type QrRouteParams,
} from "./shared";

type QrExportNode = {
  toDataURL?: (callback: (data: string) => void) => void;
};

export function useQrGenerator() {
  const params = useLocalSearchParams<QrRouteParams>();
  const router = useRouter();
  const lastAppliedPrefillSignatureRef = useRef("");
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();

  const [qrType, setQrType] = useState<QrType>("asset");
  const [installationRawValue, setInstallationRawValue] = useState("");
  const [externalCode, setExternalCode] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [clientName, setClientName] = useState("");
  const [notes, setNotes] = useState("");
  const [payload, setPayload] = useState("");
  const [detailsText, setDetailsText] = useState("");
  const [labelPreset, setLabelPreset] = useState<QrLabelPreset>("medium");
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingAsset, setLoadingAsset] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const [qrLabelRenderState, setQrLabelRenderState] = useState<QrLabelRenderState | null>(null);

  const qrRef = useRef<QrExportNode | null>(null);
  const qrLabelSvgRef = useRef<QrExportNode | null>(null);

  const prefillValues = useMemo<QrPrefillValues>(
    () => ({
      qrType: normalizeRouteParam(params.qrType).toLowerCase(),
      installationId: normalizeRouteParam(params.installationId).trim(),
      externalCode: normalizeRouteParam(params.externalCode).trim(),
      brand: normalizeRouteParam(params.brand).trim(),
      model: normalizeRouteParam(params.model).trim(),
      serialNumber: normalizeRouteParam(params.serialNumber).trim(),
      clientName: normalizeRouteParam(params.clientName).trim(),
      notes: normalizeRouteParam(params.notes).trim(),
      autoGenerate: normalizeRouteParam(params.autoGenerate).trim() === "1",
    }),
    [
      params.autoGenerate,
      params.brand,
      params.clientName,
      params.externalCode,
      params.installationId,
      params.model,
      params.notes,
      params.qrType,
      params.serialNumber,
    ],
  );

  const hasRoutePrefill = useMemo(() => hasPrefillValues(prefillValues), [prefillValues]);
  const helperText = useMemo(() => getHelperText(qrType), [qrType]);
  const qrModeHint = useMemo(() => getQrModeHint(hasRoutePrefill), [hasRoutePrefill]);
  const exportPresetConfig = useMemo<QrLabelPresetConfig>(() => {
    if (qrLabelRenderState?.preset) {
      return QR_LABEL_PRESETS[qrLabelRenderState.preset];
    }
    return QR_LABEL_PRESETS[labelPreset];
  }, [labelPreset, qrLabelRenderState?.preset]);

  const applyAssetToForm = useCallback((asset: AssetFormData) => {
    setExternalCode(asset.external_code);
    setBrand(asset.brand);
    setModel(asset.model);
    setSerialNumber(asset.serial_number);
    setClientName(asset.client_name);
    setNotes(asset.notes);
  }, []);

  useEffect(() => {
    if (!hasPrefillValues(prefillValues)) return;

    const signature = JSON.stringify(prefillValues);
    if (lastAppliedPrefillSignatureRef.current === signature) return;
    lastAppliedPrefillSignatureRef.current = signature;

    const routeQrType: QrType = prefillValues.qrType === "installation" ? "installation" : "asset";
    setQrType(routeQrType);
    setError("");

    if (routeQrType === "installation") {
      setInstallationRawValue(prefillValues.installationId);
      setPayload("");
      setDetailsText("");

      if (!prefillValues.autoGenerate) return;

      try {
        const nextPayload = buildQrPayload("installation", prefillValues.installationId);
        setPayload(nextPayload);
        setDetailsText(`Tipo: Instalacion\nID: ${prefillValues.installationId}`);
      } catch (caughtError) {
        setPayload("");
        setDetailsText("");
        setError(caughtError instanceof Error ? caughtError.message : "No se pudo generar el QR.");
      }
      return;
    }

    const prefilledAsset: AssetFormData = {
      external_code: normalizeAssetCodeForQr(prefillValues.externalCode),
      brand: normalizeAssetFormText(prefillValues.brand, 120),
      model: normalizeAssetFormText(prefillValues.model, 160),
      serial_number: normalizeAssetFormText(prefillValues.serialNumber, 128),
      client_name: normalizeAssetFormText(prefillValues.clientName, 180),
      notes: normalizeAssetFormText(prefillValues.notes, 2000),
    };

    applyAssetToForm(prefilledAsset);
    setPayload("");
    setDetailsText("");

    if (!prefillValues.autoGenerate || !prefilledAsset.external_code) return;

    try {
      const nextPayload = buildQrPayload("asset", prefilledAsset.external_code);
      setPayload(nextPayload);
      setDetailsText(buildAssetDetailsText(prefilledAsset));
    } catch (caughtError) {
      setPayload("");
      setDetailsText("");
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo generar el QR.");
    }
  }, [applyAssetToForm, prefillValues]);

  const resetQrForm = useCallback(() => {
    setQrType("asset");
    setInstallationRawValue("");
    setExternalCode("");
    setBrand("");
    setModel("");
    setSerialNumber("");
    setClientName("");
    setNotes("");
    setPayload("");
    setDetailsText("");
    setError("");
    setQrLabelRenderState(null);
    lastAppliedPrefillSignatureRef.current = "";
    if (hasRoutePrefill) {
      router.replace("/qr");
    }
  }, [hasRoutePrefill, router]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        resetQrForm();
      };
    }, [resetQrForm]),
  );

  const hasDraftData = useMemo(() => {
    return Boolean(
      payload ||
      installationRawValue.trim() ||
      externalCode.trim() ||
      brand.trim() ||
      model.trim() ||
      serialNumber.trim() ||
      clientName.trim() ||
      notes.trim(),
    );
  }, [brand, clientName, externalCode, installationRawValue, model, notes, payload, serialNumber]);

  const onClearForm = useCallback(() => {
    if (!hasDraftData) {
      resetQrForm();
      return;
    }

    Alert.alert(
      "Limpiar formulario",
      "Se borraran los datos cargados y la vista previa QR. Continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Limpiar", style: "destructive", onPress: resetQrForm },
      ],
    );
  }, [hasDraftData, resetQrForm]);

  const onGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      if (qrType === "installation") {
        const nextPayload = buildQrPayload("installation", installationRawValue);
        setPayload(nextPayload);
        setDetailsText(`Tipo: Instalacion\nID: ${installationRawValue.trim()}`);
        setError("");
        return;
      }

      const asset = buildAssetFormData({
        externalCode,
        brand,
        model,
        serialNumber,
        clientName,
        notes,
      });
      const nextPayload = buildQrPayload("asset", asset.external_code);
      applyAssetToForm(asset);
      setPayload(nextPayload);
      setDetailsText(buildAssetDetailsText(asset));
      setError("");
    } catch (caughtError) {
      setPayload("");
      setDetailsText("");
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo generar el QR.");
    } finally {
      setGenerating(false);
    }
  }, [applyAssetToForm, brand, clientName, externalCode, installationRawValue, model, notes, qrType, serialNumber]);

  const onSaveAsset = useCallback(async () => {
    if (qrType !== "asset") {
      setError("Guardar equipo solo aplica para tipo Equipo.");
      return;
    }

    setSaving(true);
    try {
      const asset = buildAssetFormData({
        externalCode,
        brand,
        model,
        serialNumber,
        clientName,
        notes,
      });

      const savePayload: ResolveAssetPayload = {
        brand: asset.brand,
        model: asset.model,
        serial_number: asset.serial_number,
        client_name: asset.client_name,
        notes: asset.notes,
        status: "active",
        update_existing: true,
      };
      const result = await resolveAssetByExternalCode(asset.external_code, savePayload);
      const merged = mergeSavedAssetValues(result?.asset || {}, asset);

      applyAssetToForm(merged);

      const nextPayload = buildQrPayload("asset", merged.external_code);
      setPayload(nextPayload);
      setDetailsText(buildAssetDetailsText(merged));
      setError("");
      Alert.alert("Equipo guardado", `Codigo: ${merged.external_code}`);
    } catch (caughtError) {
      const message = extractApiError(caughtError);
      setError(message);
      Alert.alert("No se pudo guardar equipo", message);
    } finally {
      setSaving(false);
    }
  }, [applyAssetToForm, brand, clientName, externalCode, model, notes, qrType, serialNumber]);

  const onLoadAsset = useCallback(async () => {
    const lookupCode = normalizeAssetCodeForQr(externalCode || serialNumber);
    if (!lookupCode) {
      setError("Ingresa codigo externo o numero de serie para buscar.");
      return;
    }

    setLoadingAsset(true);
    try {
      const assets = await listAssets({ code: lookupCode, limit: 1 });
      const asset = assets[0];
      if (!asset) {
        setError(`No existe equipo con codigo ${lookupCode}.`);
        return;
      }

      const loaded: AssetFormData = {
        external_code: normalizeAssetCodeForQr(String(asset.external_code || lookupCode)),
        brand: normalizeAssetFormText(String(asset.brand || ""), 120),
        model: normalizeAssetFormText(String(asset.model || ""), 160),
        serial_number: normalizeAssetFormText(String(asset.serial_number || ""), 128),
        client_name: normalizeAssetFormText(String(asset.client_name || ""), 180),
        notes: normalizeAssetFormText(String(asset.notes || ""), 2000),
      };

      applyAssetToForm(loaded);

      const nextPayload = buildQrPayload("asset", loaded.external_code);
      setPayload(nextPayload);
      setDetailsText(buildAssetDetailsText(loaded));
      setError("");
      Alert.alert("Equipo cargado", `Codigo: ${loaded.external_code}`);
    } catch (caughtError) {
      const message = extractApiError(caughtError);
      setError(message);
      Alert.alert("No se pudo consultar equipo", message);
    } finally {
      setLoadingAsset(false);
    }
  }, [applyAssetToForm, externalCode, serialNumber]);

  const getQrBase64Png = useCallback(async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const qrNode = qrRef.current;
      if (!qrNode || typeof qrNode.toDataURL !== "function") {
        reject(new Error("No se pudo acceder al QR generado."));
        return;
      }

      try {
        qrNode.toDataURL((data) => {
          if (!data) {
            reject(new Error("No se pudo exportar la imagen QR."));
            return;
          }
          resolve(data);
        });
      } catch (caughtError) {
        reject(caughtError instanceof Error ? caughtError : new Error("No se pudo exportar la imagen QR."));
      }
    });
  }, []);

  const getLabelBase64Png = useCallback(async (qrBase64: string, details: string, preset: QrLabelPreset) => {
    const lines = buildLabelLines(details);
    if (!lines.length) return qrBase64;

    setQrLabelRenderState({ qrBase64, lines, preset });

    await new Promise((resolve) => setTimeout(resolve, 80));

    return new Promise<string>((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 6;

      const capture = () => {
        const node = qrLabelSvgRef.current;
        if (!node || typeof node.toDataURL !== "function") {
          if (attempts < maxAttempts) {
            attempts += 1;
            setTimeout(capture, 80);
            return;
          }
          setQrLabelRenderState(null);
          reject(new Error("No se pudo preparar etiqueta QR para exportar."));
          return;
        }

        try {
          node.toDataURL((base64) => {
            if (base64 && base64.length > 0) {
              setQrLabelRenderState(null);
              resolve(base64);
              return;
            }
            if (attempts < maxAttempts) {
              attempts += 1;
              setTimeout(capture, 80);
              return;
            }
            setQrLabelRenderState(null);
            reject(new Error("No se pudo renderizar etiqueta QR."));
          });
        } catch (caughtError) {
          if (attempts < maxAttempts) {
            attempts += 1;
            setTimeout(capture, 80);
            return;
          }
          setQrLabelRenderState(null);
          reject(caughtError instanceof Error ? caughtError : new Error("No se pudo exportar etiqueta QR."));
        }
      };

      capture();
    });
  }, []);

  const onDownloadQrImage = useCallback(async () => {
    if (!payload) {
      Alert.alert("QR requerido", "Primero genera el QR para poder descargar la imagen.");
      return;
    }

    try {
      setExportingImage(true);
      const qrBase64 = await getQrBase64Png();
      let imageBase64 = qrBase64;
      if (qrType === "asset") {
        try {
          imageBase64 = await getLabelBase64Png(qrBase64, detailsText, labelPreset);
        } catch {
          imageBase64 = qrBase64;
        }
      }

      const fileName = qrType === "installation"
        ? `qr-instalacion-${Date.now()}.png`
        : `qr-equipo-${normalizeAssetCodeForQr(externalCode || serialNumber) || Date.now()}.png`;

      const qrFile = new File(Paths.cache, fileName);
      qrFile.create({ overwrite: true, intermediates: true });
      qrFile.write(imageBase64, { encoding: "base64" });

      const isExpoGo =
        Constants.appOwnership === "expo" || Constants.executionEnvironment === "storeClient";

      if (isExpoGo) {
        const sharingAvailable = await Sharing.isAvailableAsync();
        if (sharingAvailable) {
          await Sharing.shareAsync(qrFile.uri, {
            dialogTitle: "Guardar imagen QR",
            mimeType: "image/png",
          });
          Alert.alert(
            "Compartir imagen",
            "En Expo Go se usa compartir para guardar la imagen. En un build propio podras guardarla directo en galeria.",
          );
          return;
        }
      }

      let canWriteToGallery = false;
      try {
        const permission = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
        canWriteToGallery = Boolean(permission?.granted);
      } catch {
        canWriteToGallery = false;
      }

      if (canWriteToGallery) {
        const createdAsset = await MediaLibrary.createAssetAsync(qrFile.uri);
        try {
          const albumName = "SiteOps";
          const existingAlbum = await MediaLibrary.getAlbumAsync(albumName);
          if (existingAlbum) {
            await MediaLibrary.addAssetsToAlbumAsync([createdAsset], existingAlbum, false);
          } else {
            await MediaLibrary.createAlbumAsync(albumName, createdAsset, false);
          }
        } catch {
          // The QR image is still saved to the gallery even if album assignment fails.
        }
        Alert.alert("Imagen guardada", "El QR se guardo en la galeria del dispositivo.");
        return;
      }

      const sharingAvailable = await Sharing.isAvailableAsync();
      if (sharingAvailable) {
        await Sharing.shareAsync(qrFile.uri, {
          dialogTitle: "Compartir QR",
          mimeType: "image/png",
        });
        return;
      }

      Alert.alert(
        "No se pudo guardar imagen",
        "No hay permiso de galeria ni opcion de compartir disponible en este dispositivo.",
      );
    } catch (caughtError) {
      Alert.alert("No se pudo exportar imagen", extractApiError(caughtError));
    } finally {
      setExportingImage(false);
    }
  }, [
    detailsText,
    externalCode,
    getLabelBase64Png,
    getQrBase64Png,
    labelPreset,
    payload,
    qrType,
    serialNumber,
  ]);

  return {
    checkingSession,
    hasActiveSession,
    qrType,
    setQrType,
    installationRawValue,
    setInstallationRawValue,
    externalCode,
    setExternalCode,
    brand,
    setBrand,
    model,
    setModel,
    serialNumber,
    setSerialNumber,
    clientName,
    setClientName,
    notes,
    setNotes,
    payload,
    detailsText,
    labelPreset,
    setLabelPreset,
    error,
    generating,
    saving,
    loadingAsset,
    exportingImage,
    qrLabelRenderState,
    qrRef,
    qrLabelSvgRef,
    exportPresetConfig,
    helperText,
    hasDraftData,
    hasRoutePrefill,
    qrModeHint,
    onGenerate,
    onSaveAsset,
    onLoadAsset,
    onDownloadQrImage,
    onClearForm,
    router,
  };
}

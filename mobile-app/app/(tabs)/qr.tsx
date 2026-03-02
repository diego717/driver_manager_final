import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import QRCode from "react-native-qrcode-svg";
import Svg, { Image as SvgImage, Rect, Text as SvgText } from "react-native-svg";

import {
  listAssets,
  resolveAssetByExternalCode,
  type ResolveAssetPayload,
} from "@/src/api/assets";
import { extractApiError } from "@/src/api/client";
import { clearWebSession, readStoredWebSession } from "@/src/api/webAuth";
import { evaluateWebSession } from "@/src/api/webSession";
import { consumeForceLoginOnOpenFlag } from "@/src/security/startup-session-policy";
import { buildQrPayload, normalizeAssetCodeForQr, type QrType } from "@/src/utils/qr";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

const MIN_TOUCH_TARGET_SIZE = 44;
const QR_MAX_BRAND_LENGTH = 120;
const QR_MAX_MODEL_LENGTH = 160;
const QR_MAX_SERIAL_LENGTH = 128;
const QR_MAX_CLIENT_LENGTH = 180;
const QR_MAX_NOTES_LENGTH = 2000;
const QR_LABEL_EXPORT_WIDTH = 960;
const QR_LABEL_EXPORT_HEIGHT = 420;
const QR_LABEL_PADDING = 28;
const QR_LABEL_QR_SIZE = 320;
const QR_LABEL_TEXT_GAP = 26;
const QR_LABEL_TITLE_SIZE = 34;
const QR_LABEL_LINE_SIZE = 24;
const QR_LABEL_LINE_HEIGHT = 34;

type AssetFormData = {
  external_code: string;
  brand: string;
  model: string;
  serial_number: string;
  client_name: string;
  notes: string;
};

type QrLabelRenderState = {
  qrBase64: string;
  lines: string[];
};

function normalizeRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function normalizeAssetFormText(value: string, maxLength: number): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function buildAssetFormData(input: {
  externalCode: string;
  brand: string;
  model: string;
  serialNumber: string;
  clientName: string;
  notes: string;
}): AssetFormData {
  const brand = normalizeAssetFormText(input.brand, QR_MAX_BRAND_LENGTH);
  const model = normalizeAssetFormText(input.model, QR_MAX_MODEL_LENGTH);
  const serialNumber = normalizeAssetFormText(input.serialNumber, QR_MAX_SERIAL_LENGTH);
  const clientName = normalizeAssetFormText(input.clientName, QR_MAX_CLIENT_LENGTH);
  const notes = normalizeAssetFormText(input.notes, QR_MAX_NOTES_LENGTH);

  if (!brand && !model) {
    throw new Error("Debes ingresar al menos marca o modelo.");
  }
  if (!serialNumber) {
    throw new Error("El numero de serie es obligatorio.");
  }

  const externalCode = normalizeAssetCodeForQr(input.externalCode) || normalizeAssetCodeForQr(serialNumber);
  if (!externalCode) {
    throw new Error("No se pudo generar un codigo externo de equipo.");
  }

  return {
    external_code: externalCode,
    brand,
    model,
    serial_number: serialNumber,
    client_name: clientName,
    notes,
  };
}

function buildAssetDetailsText(asset: AssetFormData): string {
  return [
    "Tipo: Equipo",
    `Codigo externo: ${asset.external_code}`,
    `Marca: ${asset.brand || "-"}`,
    `Modelo: ${asset.model || "-"}`,
    `Serie: ${asset.serial_number || "-"}`,
    `Cliente: ${asset.client_name || "-"}`,
  ].join("\n");
}

export default function QrGeneratorScreen() {
  const params = useLocalSearchParams<{
    qrType?: string | string[];
    installationId?: string | string[];
    externalCode?: string | string[];
    brand?: string | string[];
    model?: string | string[];
    serialNumber?: string | string[];
    clientName?: string | string[];
    notes?: string | string[];
    autoGenerate?: string | string[];
  }>();
  const router = useRouter();
  const palette = useAppPalette();
  const lastAppliedPrefillSignatureRef = useRef("");
  const [checkingSession, setCheckingSession] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);
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
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingAsset, setLoadingAsset] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const qrRef = useRef<QRCode | null>(null);
  const qrLabelSvgRef = useRef<{
    toDataURL?: (callback: (base64: string) => void) => void;
  } | null>(null);
  const [qrLabelRenderState, setQrLabelRenderState] = useState<QrLabelRenderState | null>(null);

  const helperText = useMemo(() => {
    if (qrType === "installation") {
      return "Formato recomendado: dm://installation/{id}.";
    }
    return "Sin conexion: puedes generar QR local. Con sesion web activa: puedes guardar el equipo en la base.";
  }, [qrType]);

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
      return isActive;
    } finally {
      if (showLoader) setCheckingSession(false);
    }
  }, []);

  const prefillValues = useMemo(
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

  useEffect(() => {
    const hasAnyPrefillValue = Object.values(prefillValues).some((value) => {
      if (typeof value === "boolean") return value;
      return Boolean(value);
    });
    if (!hasAnyPrefillValue) return;

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

    const normalizedExternalCode = normalizeAssetCodeForQr(prefillValues.externalCode);
    const normalizedBrand = normalizeAssetFormText(prefillValues.brand, QR_MAX_BRAND_LENGTH);
    const normalizedModel = normalizeAssetFormText(prefillValues.model, QR_MAX_MODEL_LENGTH);
    const normalizedSerial = normalizeAssetFormText(prefillValues.serialNumber, QR_MAX_SERIAL_LENGTH);
    const normalizedClient = normalizeAssetFormText(prefillValues.clientName, QR_MAX_CLIENT_LENGTH);
    const normalizedNotes = normalizeAssetFormText(prefillValues.notes, QR_MAX_NOTES_LENGTH);

    setExternalCode(normalizedExternalCode);
    setBrand(normalizedBrand);
    setModel(normalizedModel);
    setSerialNumber(normalizedSerial);
    setClientName(normalizedClient);
    setNotes(normalizedNotes);
    setPayload("");
    setDetailsText("");

    if (!prefillValues.autoGenerate || !normalizedExternalCode) return;

    const prefilledAsset: AssetFormData = {
      external_code: normalizedExternalCode,
      brand: normalizedBrand,
      model: normalizedModel,
      serial_number: normalizedSerial,
      client_name: normalizedClient,
      notes: normalizedNotes,
    };

    try {
      const nextPayload = buildQrPayload("asset", prefilledAsset.external_code);
      setPayload(nextPayload);
      setDetailsText(buildAssetDetailsText(prefilledAsset));
    } catch (caughtError) {
      setPayload("");
      setDetailsText("");
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo generar el QR.");
    }
  }, [prefillValues]);

  useEffect(() => {
    void refreshSessionState({ showLoader: true });
  }, [refreshSessionState]);

  useFocusEffect(
    useCallback(() => {
      void refreshSessionState();
    }, [refreshSessionState]),
  );

  const onGenerate = async () => {
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
      setExternalCode(asset.external_code);
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
  };

  const onSaveAsset = async () => {
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
      const saved = result?.asset || {};

      const merged: AssetFormData = {
        external_code: normalizeAssetCodeForQr(String(saved.external_code || asset.external_code)),
        brand: normalizeAssetFormText(String(saved.brand ?? asset.brand), QR_MAX_BRAND_LENGTH),
        model: normalizeAssetFormText(String(saved.model ?? asset.model), QR_MAX_MODEL_LENGTH),
        serial_number: normalizeAssetFormText(
          String(saved.serial_number ?? asset.serial_number),
          QR_MAX_SERIAL_LENGTH,
        ),
        client_name: normalizeAssetFormText(
          String(saved.client_name ?? asset.client_name),
          QR_MAX_CLIENT_LENGTH,
        ),
        notes: normalizeAssetFormText(String(saved.notes ?? asset.notes), QR_MAX_NOTES_LENGTH),
      };

      setExternalCode(merged.external_code);
      setBrand(merged.brand);
      setModel(merged.model);
      setSerialNumber(merged.serial_number);
      setClientName(merged.client_name);
      setNotes(merged.notes);

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
  };

  const onLoadAsset = async () => {
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
        brand: normalizeAssetFormText(String(asset.brand || ""), QR_MAX_BRAND_LENGTH),
        model: normalizeAssetFormText(String(asset.model || ""), QR_MAX_MODEL_LENGTH),
        serial_number: normalizeAssetFormText(String(asset.serial_number || ""), QR_MAX_SERIAL_LENGTH),
        client_name: normalizeAssetFormText(String(asset.client_name || ""), QR_MAX_CLIENT_LENGTH),
        notes: normalizeAssetFormText(String(asset.notes || ""), QR_MAX_NOTES_LENGTH),
      };
      setExternalCode(loaded.external_code);
      setBrand(loaded.brand);
      setModel(loaded.model);
      setSerialNumber(loaded.serial_number);
      setClientName(loaded.client_name);
      setNotes(loaded.notes);

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
  };

  const getQrBase64Png = useCallback(async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const qrNode = qrRef.current as unknown as {
        toDataURL?: (callback: (data: string) => void) => void;
      } | null;
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
      } catch (error) {
        reject(error instanceof Error ? error : new Error("No se pudo exportar la imagen QR."));
      }
    });
  }, []);

  const buildLabelLines = useCallback((details: string): string[] => {
    return String(details || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.toLowerCase().startsWith("tipo:"))
      .slice(0, 8);
  }, []);

  const getLabelBase64Png = useCallback(
    async (qrBase64: string, details: string): Promise<string> => {
      const lines = buildLabelLines(details);
      if (!lines.length) return qrBase64;

      setQrLabelRenderState({ qrBase64, lines });

      // Wait a tick so hidden SVG can mount with latest data before capture.
      await new Promise((resolve) => setTimeout(resolve, 80));

      return new Promise((resolve, reject) => {
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
          } catch (error) {
            if (attempts < maxAttempts) {
              attempts += 1;
              setTimeout(capture, 80);
              return;
            }
            setQrLabelRenderState(null);
            reject(error instanceof Error ? error : new Error("No se pudo exportar etiqueta QR."));
          }
        };

        capture();
      });
    },
    [buildLabelLines],
  );

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
          imageBase64 = await getLabelBase64Png(qrBase64, detailsText);
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

      // Expo Go on Android cannot grant full media-library permissions reliably.
      // In that case we fallback to native share so user can save the PNG manually.
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
          const albumName = "Driver Manager";
          const existingAlbum = await MediaLibrary.getAlbumAsync(albumName);
          if (existingAlbum) {
            await MediaLibrary.addAssetsToAlbumAsync([createdAsset], existingAlbum, false);
          } else {
            await MediaLibrary.createAlbumAsync(albumName, createdAsset, false);
          }
        } catch {
          // Si falla crear/mover album, igualmente queda guardado en galeria.
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
        Alert.alert(
          "Permiso no disponible",
          "No se pudo guardar directo en galeria. Se abrio compartir para que puedas guardarla.",
        );
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
    payload,
    qrType,
    serialNumber,
  ]);

  if (checkingSession) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: palette.screenBg }]}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>
          Verificando sesion web...
        </Text>
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
          <Text style={[styles.authHintText, { color: palette.textSecondary }]}>
            Inicia sesion web para generar y guardar QR de equipos.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: palette.primaryButtonBg }]}
            onPress={() => router.push("/modal")}
            accessibilityRole="button"
            accessibilityLabel="Ir a configuracion y acceso"
          >
            <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>
              Ir a configuracion y acceso
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.screenBg }]}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: palette.textPrimary }]}>Generar QR de equipo</Text>
      <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
        Alta de equipo para etiqueta fisica y asociacion a instalaciones.
      </Text>

      <View style={styles.typeRow}>
        <TouchableOpacity
          style={[
            styles.typeButton,
            {
              backgroundColor: qrType === "asset" ? palette.chipSelectedBg : palette.chipBg,
              borderColor: qrType === "asset" ? palette.chipSelectedBorder : palette.chipBorder,
            },
          ]}
          onPress={() => setQrType("asset")}
          accessibilityRole="button"
          accessibilityState={{ selected: qrType === "asset" }}
        >
          <Text
            style={[
              styles.typeButtonText,
              { color: qrType === "asset" ? palette.chipSelectedText : palette.chipText },
            ]}
          >
            Equipo
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.typeButton,
            {
              backgroundColor: qrType === "installation" ? palette.chipSelectedBg : palette.chipBg,
              borderColor: qrType === "installation" ? palette.chipSelectedBorder : palette.chipBorder,
            },
          ]}
          onPress={() => setQrType("installation")}
          accessibilityRole="button"
          accessibilityState={{ selected: qrType === "installation" }}
        >
          <Text
            style={[
              styles.typeButtonText,
              { color: qrType === "installation" ? palette.chipSelectedText : palette.chipText },
            ]}
          >
            Instalacion
          </Text>
        </TouchableOpacity>
      </View>

      {qrType === "installation" ? (
        <>
          <Text style={[styles.label, { color: palette.label }]}>ID de instalacion</Text>
          <TextInput
            value={installationRawValue}
            onChangeText={setInstallationRawValue}
            keyboardType="numeric"
            style={[
              styles.input,
              {
                backgroundColor: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.textPrimary,
              },
            ]}
            placeholder="Ej: 245"
            placeholderTextColor={palette.placeholder}
          />
        </>
      ) : (
        <>
          <Text style={[styles.label, { color: palette.label }]}>Codigo externo (opcional)</Text>
          <TextInput
            value={externalCode}
            onChangeText={setExternalCode}
            style={[
              styles.input,
              {
                backgroundColor: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.textPrimary,
              },
            ]}
            placeholder="Ej: EQ-SL3-001 (si se deja vacio usa serie)"
            placeholderTextColor={palette.placeholder}
          />

          <TouchableOpacity
            style={[styles.inlineButton, { backgroundColor: palette.secondaryButtonBg }]}
            onPress={() => {
              void onLoadAsset();
            }}
            accessibilityRole="button"
          >
            {loadingAsset ? (
              <ActivityIndicator color={palette.secondaryButtonText} />
            ) : (
              <Text style={[styles.inlineButtonText, { color: palette.secondaryButtonText }]}>
                Cargar equipo existente
              </Text>
            )}
          </TouchableOpacity>

          <Text style={[styles.label, { color: palette.label }]}>Marca</Text>
          <TextInput
            value={brand}
            onChangeText={setBrand}
            style={[
              styles.input,
              {
                backgroundColor: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.textPrimary,
              },
            ]}
            placeholder="Ej: Entrust"
            placeholderTextColor={palette.placeholder}
          />

          <Text style={[styles.label, { color: palette.label }]}>Modelo</Text>
          <TextInput
            value={model}
            onChangeText={setModel}
            style={[
              styles.input,
              {
                backgroundColor: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.textPrimary,
              },
            ]}
            placeholder="Ej: Sigma SL3"
            placeholderTextColor={palette.placeholder}
          />

          <Text style={[styles.label, { color: palette.label }]}>Numero de serie</Text>
          <TextInput
            value={serialNumber}
            onChangeText={setSerialNumber}
            style={[
              styles.input,
              {
                backgroundColor: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.textPrimary,
              },
            ]}
            placeholder="Ej: SN-00112233"
            placeholderTextColor={palette.placeholder}
          />

          <Text style={[styles.label, { color: palette.label }]}>Cliente (opcional)</Text>
          <TextInput
            value={clientName}
            onChangeText={setClientName}
            style={[
              styles.input,
              {
                backgroundColor: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.textPrimary,
              },
            ]}
            placeholder="Ej: Cliente ACME"
            placeholderTextColor={palette.placeholder}
          />

          <Text style={[styles.label, { color: palette.label }]}>Notas (opcional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            style={[
              styles.input,
              styles.notesInput,
              {
                backgroundColor: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.textPrimary,
              },
            ]}
            placeholder="Observaciones del equipo"
            placeholderTextColor={palette.placeholder}
          />
        </>
      )}

      <Text style={[styles.helperText, { color: palette.textMuted }]}>{helperText}</Text>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: palette.primaryButtonBg }]}
        onPress={() => {
          void onGenerate();
        }}
        accessibilityRole="button"
      >
        {generating ? (
          <ActivityIndicator color={palette.primaryButtonText} />
        ) : (
          <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>Generar QR</Text>
        )}
      </TouchableOpacity>

      {qrType === "asset" ? (
        <TouchableOpacity
          style={[styles.secondaryButton, { backgroundColor: palette.secondaryButtonBg }]}
          onPress={() => {
            void onSaveAsset();
          }}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color={palette.secondaryButtonText} />
          ) : (
            <Text style={[styles.buttonText, { color: palette.secondaryButtonText }]}>
              Guardar equipo en base
            </Text>
          )}
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[styles.secondaryButton, { backgroundColor: palette.refreshBg }]}
        onPress={() => {
          void onDownloadQrImage();
        }}
        disabled={exportingImage || !payload}
        accessibilityRole="button"
      >
        {exportingImage ? (
          <ActivityIndicator color={palette.refreshText} />
        ) : (
          <Text style={[styles.buttonText, { color: palette.refreshText }]}>Descargar imagen</Text>
        )}
      </TouchableOpacity>

      {error ? <Text style={[styles.errorText, { color: palette.error }]}>{error}</Text> : null}

      {payload ? (
        <View
          style={[
            styles.previewCard,
            { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
          ]}
        >
          <QRCode
            value={payload}
            size={240}
            getRef={(instance) => {
              qrRef.current = instance;
            }}
          />
          <Text style={[styles.payloadText, { color: palette.textPrimary }]}>{payload}</Text>
          {detailsText ? (
            <Text style={[styles.detailsText, { color: palette.textSecondary }]}>{detailsText}</Text>
          ) : null}
        </View>
      ) : null}

      {qrLabelRenderState ? (
        <View pointerEvents="none" style={styles.hiddenLabelRenderer}>
          <Svg
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ref={(instance) => (qrLabelSvgRef.current = instance as any)}
            width={QR_LABEL_EXPORT_WIDTH}
            height={QR_LABEL_EXPORT_HEIGHT}
            viewBox={`0 0 ${QR_LABEL_EXPORT_WIDTH} ${QR_LABEL_EXPORT_HEIGHT}`}
          >
            <Rect
              x={0}
              y={0}
              width={QR_LABEL_EXPORT_WIDTH}
              height={QR_LABEL_EXPORT_HEIGHT}
              fill="#ffffff"
            />
            <SvgImage
              x={QR_LABEL_PADDING}
              y={(QR_LABEL_EXPORT_HEIGHT - QR_LABEL_QR_SIZE) / 2}
              width={QR_LABEL_QR_SIZE}
              height={QR_LABEL_QR_SIZE}
              href={`data:image/png;base64,${qrLabelRenderState.qrBase64}`}
              preserveAspectRatio="xMidYMid slice"
            />
            <SvgText
              x={QR_LABEL_PADDING + QR_LABEL_QR_SIZE + QR_LABEL_TEXT_GAP}
              y={Math.max(52, (QR_LABEL_EXPORT_HEIGHT - 230) / 2)}
              fontSize={QR_LABEL_TITLE_SIZE}
              fontWeight="700"
              fill="#0f172a"
            >
              Etiqueta QR - Driver Manager
            </SvgText>
            {qrLabelRenderState.lines.map((line, index) => (
              <SvgText
                key={`qr-label-line-${index}`}
                x={QR_LABEL_PADDING + QR_LABEL_QR_SIZE + QR_LABEL_TEXT_GAP}
                y={Math.max(90, (QR_LABEL_EXPORT_HEIGHT - 230) / 2) + (index + 1) * QR_LABEL_LINE_HEIGHT}
                fontSize={QR_LABEL_LINE_SIZE}
                fontWeight="500"
                fill="#1f2937"
              >
                {line}
              </SvgText>
            ))}
          </Svg>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  authHintText: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    gap: 10,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontFamily: fontFamilies.bold,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: fontFamilies.regular,
    marginBottom: 8,
  },
  typeRow: {
    flexDirection: "row",
    gap: 8,
  },
  typeButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  typeButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  label: {
    fontSize: 13,
    fontFamily: fontFamilies.semibold,
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  notesInput: {
    minHeight: 84,
  },
  inlineButton: {
    borderRadius: 10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    marginTop: 6,
  },
  inlineButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  helperText: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  button: {
    marginTop: 6,
    borderRadius: 10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  secondaryButton: {
    marginTop: 4,
    borderRadius: 10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  buttonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
  },
  errorText: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  previewCard: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    gap: 8,
  },
  payloadText: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
    textAlign: "center",
  },
  detailsText: {
    width: "100%",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamilies.regular,
  },
  hiddenLabelRenderer: {
    position: "absolute",
    left: -10000,
    top: -10000,
    opacity: 0,
    width: QR_LABEL_EXPORT_WIDTH,
    height: QR_LABEL_EXPORT_HEIGHT,
  },
});

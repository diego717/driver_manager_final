import React, { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { lookupCode } from "@/src/api/scan";
import { extractApiError } from "@/src/api/client";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import { parseScannedPayload } from "@/src/utils/scan";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

export default function ScanScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [manualCode, setManualCode] = useState("");

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

  const resolveAndNavigate = async (rawValue: string) => {
    const parsed = parseScannedPayload(rawValue);
    if (!parsed) {
      Alert.alert(
        "Codigo invalido",
        "Formato esperado: dm://installation/{id} o dm://asset/{external_code}",
      );
      setLocked(false);
      return;
    }

    setResolving(true);
    try {
      if (parsed.type === "installation") {
        navigateToCaseContext({ installationId: parsed.installationId });
        return;
      }

      const lookup = await lookupCode(parsed.externalCode, "asset");
      navigateToCaseContext({
        installationId: lookup.match.installation_id ?? undefined,
        assetExternalCode:
          lookup.match.external_code ??
          lookup.match.asset_id ??
          parsed.externalCode,
        assetRecordId: lookup.match.asset_record_id ?? undefined,
      });
    } catch (error) {
      Alert.alert("No se pudo resolver", extractApiError(error));
      setLocked(false);
    } finally {
      setResolving(false);
    }
  };

  const onBarcodeScanned = (result: BarcodeScanningResult) => {
    if (locked || resolving) return;
    setLocked(true);
    void resolveAndNavigate(result.data);
  };

  const onManualSubmit = () => {
    setLocked(true);
    void resolveAndNavigate(manualCode);
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
            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg }]}
              onPress={() => {
                void requestPermission();
              }}
            >
              <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Solicitar permiso</Text>
            </TouchableOpacity>
          </View>
        )}

        {resolving ? (
          <View style={styles.overlay}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.overlayText}>Resolviendo codigo...</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.manualCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
        <Text style={[styles.label, { color: palette.textPrimary }]}>Fallback manual</Text>
        <TextInput
          value={manualCode}
          onChangeText={setManualCode}
          placeholder="dm://installation/12 o dm://asset/ABC-001"
          placeholderTextColor={palette.placeholder}
          style={[
            styles.input,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: palette.buttonBg }]}
          disabled={resolving}
          onPress={onManualSubmit}
        >
          <Text style={[styles.primaryButtonText, { color: palette.buttonText }]}>Continuar con codigo</Text>
        </TouchableOpacity>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  heroBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  heroBadgeText: {
    fontFamily: fontFamilies.bold,
    fontSize: 11.5,
    letterSpacing: 0.3,
  },
  cameraFrame: {
    height: 300,
    borderWidth: 1,
    borderRadius: 22,
    overflow: "hidden",
    position: "relative",
  },
  noCameraContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 16,
  },
  noCameraText: {
    textAlign: "center",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.65)",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  overlayText: {
    color: "#fff",
    fontFamily: fontFamilies.semibold,
  },
  manualCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  label: {
    fontFamily: fontFamilies.semibold,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  primaryButton: {
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.bold,
  },
  secondaryButton: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.semibold,
  },
});

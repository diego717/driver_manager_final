import React from "react";
import { ActivityIndicator, Text, View } from "react-native";

import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { useAppPalette } from "@/src/theme/palette";

import {
  QrGeneratorActionsCard,
  QrGeneratorFormCard,
  QrLabelRenderer,
  QrPreviewCard,
} from "./sections";
import { styles } from "./styles";
import { useQrGenerator } from "./use-qr-generator";

export default function QrGeneratorScreen() {
  const palette = useAppPalette();
  const {
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
  } = useQrGenerator();

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>
          Verificando sesion web...
        </Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para generar y guardar QR de equipos."
          onLoginSuccess={async () => {}}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold
      contentContainerStyle={styles.contentContainer}
      scrollViewProps={{ keyboardShouldPersistTaps: "handled" }}
    >
      <ScreenHero
        eyebrow="Etiquetas moviles"
        title="Generar QR"
        description="Prepara etiquetas para equipos o instalaciones con una vista previa clara y acciones rapidas para guardar o exportar."
        aside={(
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
              {qrType === "asset" ? "equipo" : "instalacion"}
            </Text>
          </View>
        )}
      >
        <View style={styles.heroMetaRow}>
          <View
            style={[
              styles.heroMetaChip,
              {
                backgroundColor: palette.heroEyebrowBg,
                borderColor: palette.heroBorder,
              },
            ]}
          >
            <Text style={[styles.heroMetaText, { color: palette.heroEyebrowText }]}>
              {payload ? "vista previa lista" : "sin generar"}
            </Text>
          </View>
        </View>
      </ScreenHero>

      <Text style={[styles.modeHint, { color: palette.textMuted }]}>{qrModeHint}</Text>

      <QrGeneratorFormCard
        palette={palette}
        qrType={qrType}
        setQrType={setQrType}
        installationRawValue={installationRawValue}
        setInstallationRawValue={setInstallationRawValue}
        externalCode={externalCode}
        setExternalCode={setExternalCode}
        brand={brand}
        setBrand={setBrand}
        model={model}
        setModel={setModel}
        serialNumber={serialNumber}
        setSerialNumber={setSerialNumber}
        clientName={clientName}
        setClientName={setClientName}
        notes={notes}
        setNotes={setNotes}
        helperText={helperText}
        loadingAsset={loadingAsset}
        onLoadAsset={onLoadAsset}
      />

      <QrGeneratorActionsCard
        palette={palette}
        qrType={qrType}
        generating={generating}
        saving={saving}
        loadingAsset={loadingAsset}
        exportingImage={exportingImage}
        payload={payload}
        labelPreset={labelPreset}
        setLabelPreset={setLabelPreset}
        hasDraftData={hasDraftData}
        hasRoutePrefill={hasRoutePrefill}
        onGenerate={onGenerate}
        onClearForm={onClearForm}
        onSaveAsset={onSaveAsset}
        onDownloadQrImage={onDownloadQrImage}
      />

      {error ? <Text style={[styles.errorText, { color: palette.error }]}>{error}</Text> : null}

      <QrPreviewCard
        palette={palette}
        payload={payload}
        detailsText={detailsText}
        setQrRef={(instance) => {
          qrRef.current = instance as typeof qrRef.current;
        }}
      />

      <QrLabelRenderer
        qrLabelRenderState={qrLabelRenderState}
        exportPresetConfig={exportPresetConfig}
        setQrLabelSvgRef={(instance) => {
          qrLabelSvgRef.current = instance as typeof qrLabelSvgRef.current;
        }}
      />
    </ScreenScaffold>
  );
}

import React from "react";
import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import Svg, { Image as SvgImage, Rect, Text as SvgText } from "react-native-svg";

import { getAppPalette, type AppPalette } from "@/src/theme/palette";

import { styles } from "./styles";
import type { QrLabelPreset, QrLabelPresetConfig, QrLabelRenderState } from "./shared";

type FormCardProps = {
  palette: AppPalette;
  qrType: "asset" | "installation";
  setQrType: (value: "asset" | "installation") => void;
  installationRawValue: string;
  setInstallationRawValue: (value: string) => void;
  externalCode: string;
  setExternalCode: (value: string) => void;
  brand: string;
  setBrand: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  serialNumber: string;
  setSerialNumber: (value: string) => void;
  clientName: string;
  setClientName: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  helperText: string;
  loadingAsset: boolean;
  onLoadAsset: () => void | Promise<void>;
};

type ActionsCardProps = {
  palette: AppPalette;
  qrType: "asset" | "installation";
  generating: boolean;
  saving: boolean;
  loadingAsset: boolean;
  exportingImage: boolean;
  payload: string;
  labelPreset: QrLabelPreset;
  setLabelPreset: (preset: QrLabelPreset) => void;
  hasDraftData: boolean;
  hasRoutePrefill: boolean;
  onGenerate: () => void | Promise<void>;
  onClearForm: () => void;
  onSaveAsset: () => void | Promise<void>;
  onDownloadQrImage: () => void | Promise<void>;
};

type PreviewCardProps = {
  palette: AppPalette;
  payload: string;
  detailsText: string;
  setQrRef: (instance: unknown) => void;
};

type LabelRendererProps = {
  qrLabelRenderState: QrLabelRenderState | null;
  exportPresetConfig: QrLabelPresetConfig;
  setQrLabelSvgRef: (instance: unknown) => void;
};

const qrLabelPalette = getAppPalette("light");

function ChipButton(props: {
  selected: boolean;
  label: string;
  palette: AppPalette;
  onPress: () => void;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
}) {
  const { selected, label, palette, onPress, style, textStyle } = props;

  return (
    <TouchableOpacity
      style={[
        style,
        {
          backgroundColor: selected ? palette.chipSelectedBg : palette.chipBg,
          borderColor: selected ? palette.chipSelectedBorder : palette.chipBorder,
        },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[textStyle, { color: selected ? palette.chipSelectedText : palette.chipText }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function FormInput(props: {
  palette: AppPalette;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  numberOfLines?: number;
  keyboardType?: TextInputProps["keyboardType"];
  style?: StyleProp<TextStyle>;
}) {
  const { palette, label, style, ...inputProps } = props;

  return (
    <>
      <Text style={[styles.label, { color: palette.label }]}>{label}</Text>
      <TextInput
        {...inputProps}
        textAlignVertical={inputProps.multiline ? "top" : "center"}
        style={[
          styles.input,
          {
            backgroundColor: palette.inputBg,
            borderColor: palette.inputBorder,
            color: palette.textPrimary,
          },
          style,
        ]}
        placeholderTextColor={palette.placeholder}
      />
    </>
  );
}

export function QrGeneratorFormCard(props: FormCardProps) {
  const {
    palette,
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
    helperText,
    loadingAsset,
    onLoadAsset,
  } = props;

  return (
    <View style={[styles.formCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Datos del QR</Text>
      <View style={styles.typeRow}>
        <ChipButton
          selected={qrType === "asset"}
          label="Equipo"
          palette={palette}
          onPress={() => setQrType("asset")}
          style={styles.typeButton}
          textStyle={styles.typeButtonText}
        />
        <ChipButton
          selected={qrType === "installation"}
          label="Instalacion"
          palette={palette}
          onPress={() => setQrType("installation")}
          style={styles.typeButton}
          textStyle={styles.typeButtonText}
        />
      </View>

      {qrType === "installation" ? (
        <FormInput
          palette={palette}
          label="ID de instalacion"
          value={installationRawValue}
          onChangeText={setInstallationRawValue}
          keyboardType="numeric"
          placeholder="Ej: 245"
        />
      ) : (
        <>
          <FormInput
            palette={palette}
            label="Codigo externo (opcional)"
            value={externalCode}
            onChangeText={setExternalCode}
            placeholder="Ej: EQ-SL3-001 (si se deja vacio usa serie)"
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

          <FormInput palette={palette} label="Marca" value={brand} onChangeText={setBrand} placeholder="Ej: Entrust" />
          <FormInput
            palette={palette}
            label="Modelo"
            value={model}
            onChangeText={setModel}
            placeholder="Ej: Sigma SL3"
          />
          <FormInput
            palette={palette}
            label="Numero de serie"
            value={serialNumber}
            onChangeText={setSerialNumber}
            placeholder="Ej: SN-00112233"
          />
          <FormInput
            palette={palette}
            label="Cliente (opcional)"
            value={clientName}
            onChangeText={setClientName}
            placeholder="Ej: Cliente ACME"
          />
          <FormInput
            palette={palette}
            label="Notas (opcional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Observaciones del equipo"
            multiline
            numberOfLines={3}
            style={styles.notesInput}
          />
        </>
      )}

      <Text style={[styles.helperText, { color: palette.textMuted }]}>{helperText}</Text>
    </View>
  );
}

export function QrGeneratorActionsCard(props: ActionsCardProps) {
  const {
    palette,
    qrType,
    generating,
    saving,
    loadingAsset,
    exportingImage,
    payload,
    labelPreset,
    setLabelPreset,
    hasDraftData,
    hasRoutePrefill,
    onGenerate,
    onClearForm,
    onSaveAsset,
    onDownloadQrImage,
  } = props;

  return (
    <View style={[styles.formCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Acciones</Text>
      <View style={styles.mainActionRow}>
        <TouchableOpacity
          style={[styles.button, styles.mainActionPrimary, { backgroundColor: palette.primaryButtonBg }]}
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

        <TouchableOpacity
          style={[
            styles.button,
            styles.mainActionSecondary,
            { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder },
          ]}
          onPress={onClearForm}
          disabled={generating || saving || loadingAsset || exportingImage}
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, { color: palette.secondaryText }]}>
            {hasDraftData || hasRoutePrefill ? "Limpiar" : "Nuevo"}
          </Text>
        </TouchableOpacity>
      </View>

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

      {qrType === "asset" ? (
        <>
          <Text style={[styles.label, { color: palette.label }]}>Formato etiqueta</Text>
          <View style={styles.presetRow}>
            <ChipButton
              selected={labelPreset === "small"}
              label="Pequeno"
              palette={palette}
              onPress={() => setLabelPreset("small")}
              style={styles.presetButton}
              textStyle={styles.presetButtonText}
            />
            <ChipButton
              selected={labelPreset === "medium"}
              label="Mediano"
              palette={palette}
              onPress={() => setLabelPreset("medium")}
              style={styles.presetButton}
              textStyle={styles.presetButtonText}
            />
          </View>
        </>
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
    </View>
  );
}

export function QrPreviewCard(props: PreviewCardProps) {
  const { palette, payload, detailsText, setQrRef } = props;

  if (!payload) return null;

  return (
    <View
      style={[
        styles.formCard,
        styles.previewCard,
        { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Vista previa</Text>
      <QRCode
        value={payload}
        size={240}
        getRef={(instance) => {
          setQrRef(instance);
        }}
      />
      <Text style={[styles.payloadText, { color: palette.textPrimary }]}>{payload}</Text>
      {detailsText ? <Text style={[styles.detailsText, { color: palette.textSecondary }]}>{detailsText}</Text> : null}
    </View>
  );
}

export function QrLabelRenderer(props: LabelRendererProps) {
  const { qrLabelRenderState, exportPresetConfig, setQrLabelSvgRef } = props;

  if (!qrLabelRenderState) return null;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.hiddenLabelRenderer,
        {
          width: exportPresetConfig.width,
          height: exportPresetConfig.height,
        },
      ]}
    >
      <Svg
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={(instance) => setQrLabelSvgRef(instance as any)}
        width={exportPresetConfig.width}
        height={exportPresetConfig.height}
        viewBox={`0 0 ${exportPresetConfig.width} ${exportPresetConfig.height}`}
      >
        <Rect
          x={0}
          y={0}
          width={exportPresetConfig.width}
          height={exportPresetConfig.height}
          fill={qrLabelPalette.primaryButtonText}
        />
        <SvgImage
          x={exportPresetConfig.padding}
          y={(exportPresetConfig.height - exportPresetConfig.qrSize) / 2}
          width={exportPresetConfig.qrSize}
          height={exportPresetConfig.qrSize}
          href={`data:image/png;base64,${qrLabelRenderState.qrBase64}`}
          preserveAspectRatio="xMidYMid slice"
        />
        <SvgText
          x={exportPresetConfig.padding + exportPresetConfig.qrSize + exportPresetConfig.textGap}
          y={Math.max(exportPresetConfig.titleY, (exportPresetConfig.height - 230) / 2)}
          fontSize={exportPresetConfig.titleSize}
          fontWeight="700"
          fill={qrLabelPalette.textPrimary}
        >
          SiteOps
        </SvgText>
        {qrLabelRenderState.lines.map((line, index) => (
          <SvgText
            key={`qr-label-line-${index}`}
            x={exportPresetConfig.padding + exportPresetConfig.qrSize + exportPresetConfig.textGap}
            y={
              Math.max(exportPresetConfig.lineStartY, (exportPresetConfig.height - 230) / 2) +
              (index + 1) * exportPresetConfig.lineHeight
            }
            fontSize={exportPresetConfig.lineSize}
            fontWeight="500"
            fill={qrLabelPalette.textSecondary}
          >
            {line}
          </SvgText>
        ))}
        <Rect
          x={2}
          y={2}
          width={Math.max(0, exportPresetConfig.width - 4)}
          height={Math.max(0, exportPresetConfig.height - 4)}
          fill="none"
          stroke={qrLabelPalette.textPrimary}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
}

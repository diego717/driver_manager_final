import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  PanResponder,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { createInstallationConformity, getInstallationConformity } from "@/src/api/conformities";
import { extractApiError } from "@/src/api/client";
import { getAssetIncidents, type AssetIncidentsResponse } from "@/src/api/assets";
import { listInstallations } from "@/src/api/incidents";
import InlineFeedback from "@/src/components/InlineFeedback";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { captureCurrentGpsSnapshot } from "@/src/services/location";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { getStoredWebAccessUsername } from "@/src/storage/secure";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, inputFontFamily, textInputAccentColor } from "@/src/theme/typography";
import { type GpsCapturePayload, type InstallationConformity, type InstallationRecord } from "@/src/types/api";
import {
  evaluateGeofencePreview,
  formatGeofenceSummary,
  formatGpsStatusLabel,
  formatGpsSummary,
  hasInstallationSiteConfig,
} from "@/src/utils/gps";
import { formatDateTime } from "@/src/utils/incidents";

const MIN_TOUCH_TARGET_SIZE = 44;
const SIGNATURE_CANVAS_HEIGHT = 220;
const SIGNATURE_EXPORT_DELAY_MS = 90;

type SvgExportHandle = {
  toDataURL?: (callback: (data: string) => void) => void;
};

type FeedbackState = {
  tone: "error" | "success" | "info";
  message: string;
} | null;

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function parsePositiveInt(value: string | string[] | undefined): number | null {
  const raw = normalizeParam(value).trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeEmailCandidate(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function validateEmailCandidate(value: string): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildLinePath(x: number, y: number): string {
  return `M ${x.toFixed(1)} ${y.toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)}`;
}

export default function CaseConformityScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const params = useLocalSearchParams<{
    installationId?: string | string[];
    assetRecordId?: string | string[];
  }>();
  const installationId = useMemo(() => parsePositiveInt(params.installationId), [params.installationId]);
  const assetRecordId = useMemo(() => parsePositiveInt(params.assetRecordId), [params.assetRecordId]);
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();

  const signatureSvgRef = useRef<Svg | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [record, setRecord] = useState<InstallationRecord | null>(null);
  const [assetDetail, setAssetDetail] = useState<AssetIncidentsResponse | null>(null);
  const [latestConformity, setLatestConformity] = useState<InstallationConformity | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signedByName, setSignedByName] = useState("");
  const [signedByDocument, setSignedByDocument] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [summaryNote, setSummaryNote] = useState("");
  const [technicianNote, setTechnicianNote] = useState("");
  const [technicianUsername, setTechnicianUsername] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [gpsSnapshot, setGpsSnapshot] = useState<GpsCapturePayload>({
    status: "pending",
    source: "none",
    note: "",
  });
  const [capturingGps, setCapturingGps] = useState(false);
  const [gpsOverrideNote, setGpsOverrideNote] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [isSigning, setIsSigning] = useState(false);

  const clearFeedbackSoon = useCallback(() => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedback(null);
      feedbackTimeoutRef.current = null;
    }, 5000);
  }, []);

  const notify = useCallback((tone: "error" | "success" | "info", message: string) => {
    setFeedback({ tone, message });
    clearFeedbackSoon();
  }, [clearFeedbackSoon]);

  useEffect(() => {
    let mounted = true;
    void getStoredWebAccessUsername().then((stored) => {
      if (!mounted || !stored) return;
      setTechnicianUsername(stored);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  const loadContext = useCallback(async () => {
    if (!hasActiveSession || !installationId) return;

    try {
      setLoading(true);
      const [records, conformity, assetResponse] = await Promise.all([
        listInstallations({ forceRefresh: true }),
        getInstallationConformity(installationId),
        assetRecordId ? getAssetIncidents(assetRecordId) : Promise.resolve(null),
      ]);
      const selectedRecord =
        records.find((item) => item.id === installationId) || {
          id: installationId,
          client_name: "Caso cargado por contexto",
        };
      setRecord(selectedRecord);
      setLatestConformity(conformity);
      setAssetDetail(assetResponse);
      setSummaryNote((current) =>
        current.trim()
          ? current
          : selectedRecord.client_name
            ? `Instalacion validada con ${selectedRecord.client_name}.`
            : `Instalacion #${installationId} validada en sitio.`,
      );
      setTechnicianNote((current) =>
        current.trim()
          ? current
          : "Se entrega constancia operativa con firma y evidencia asociada.",
      );
    } catch (error) {
      notify("error", `No se pudo cargar el cierre: ${extractApiError(error)}`);
    } finally {
      setLoading(false);
    }
  }, [assetRecordId, hasActiveSession, installationId, notify]);

  const captureGps = useCallback(async (options?: { silent?: boolean }) => {
    if (capturingGps) return;
    try {
      setCapturingGps(true);
      const snapshot = await captureCurrentGpsSnapshot();
      setGpsSnapshot(snapshot);
      if (snapshot.status === "captured" && options?.silent !== true) {
        notify("info", "Ubicacion capturada para validar el cierre.");
      }
    } catch (error) {
      setGpsSnapshot({
        status: "unavailable",
        source: "browser",
        note: extractApiError(error),
      });
    } finally {
      setCapturingGps(false);
    }
  }, [capturingGps, notify]);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession || !installationId) return;
      void loadContext();
      void captureGps({ silent: true });
    }, [captureGps, hasActiveSession, installationId, loadContext]),
  );

  const geofencePreview = useMemo(
    () => evaluateGeofencePreview(gpsSnapshot, record),
    [gpsSnapshot, record],
  );
  const hasSiteConfig = useMemo(() => hasInstallationSiteConfig(record), [record]);
  const requiresGpsOverride = gpsSnapshot.status !== "captured";
  const requiresGeofenceOverride = gpsSnapshot.status === "captured" && geofencePreview.result === "outside";
  const showGpsOverrideField = requiresGpsOverride || requiresGeofenceOverride;

  const clearSignature = useCallback(() => {
    setPaths([]);
    setCurrentPath("");
    setHasSignature(false);
  }, []);

  const panResponder = useMemo(() => {
    const appendPoint = (x: number, y: number) => {
      setCurrentPath((existing) => {
        if (!existing) return buildLinePath(x, y);
        return `${existing} L ${x.toFixed(1)} ${y.toFixed(1)}`;
      });
      setHasSignature(true);
    };

    const commitStroke = () => {
      setCurrentPath((existing) => {
        if (existing) {
          setPaths((current) => [...current, existing]);
        }
        return "";
      });
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        setIsSigning(true);
        appendPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
      },
      onPanResponderMove: (event) => {
        appendPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
      },
      onPanResponderRelease: () => {
        setIsSigning(false);
        commitStroke();
      },
      onPanResponderTerminate: () => {
        setIsSigning(false);
        commitStroke();
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, []);

  const exportSignatureDataUrl = useCallback(async (): Promise<string> => {
    await new Promise((resolve) => setTimeout(resolve, SIGNATURE_EXPORT_DELAY_MS));
    return new Promise((resolve, reject) => {
      const node = signatureSvgRef.current as SvgExportHandle | null;
      if (!node || typeof node.toDataURL !== "function") {
        reject(new Error("No se pudo preparar la firma para exportar."));
        return;
      }
      try {
        node.toDataURL((base64) => {
          if (!base64) {
            reject(new Error("No se pudo exportar la firma."));
            return;
          }
          resolve(`data:image/png;base64,${base64}`);
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("No se pudo exportar la firma."));
      }
    });
  }, []);

  const onSubmit = useCallback(async () => {
    if (!installationId || submitting) return;

    const normalizedName = signedByName.trim();
    const normalizedEmail = normalizeEmailCandidate(emailTo);
    if (!normalizedName) {
      notify("error", "El nombre del firmante es obligatorio.");
      return;
    }
    if (!validateEmailCandidate(normalizedEmail)) {
      notify("error", "Ingresa un email valido para generar la conformidad.");
      return;
    }
    if (!hasSignature || (!paths.length && !currentPath)) {
      notify("error", "Falta la firma del cliente o responsable.");
      return;
    }

    let gpsPayload: GpsCapturePayload = gpsSnapshot;
    let geofenceOverrideNote = "";
    const normalizedGpsOverride = gpsOverrideNote.trim();
    if (gpsSnapshot.status !== "captured") {
      if (!normalizedGpsOverride) {
        notify("error", "Si no hay GPS valido, registra un motivo de override antes de generar el PDF.");
        return;
      }
      gpsPayload = {
        status: "override",
        source: "override",
        note: normalizedGpsOverride,
      };
    } else if (geofencePreview.result === "outside") {
      if (!normalizedGpsOverride) {
        notify("error", "La captura GPS quedo fuera del radio. Debes justificar la excepcion.");
        return;
      }
      geofenceOverrideNote = normalizedGpsOverride;
    }

    try {
      setSubmitting(true);
      const signatureDataUrl = await exportSignatureDataUrl();
      const response = await createInstallationConformity(installationId, {
        signed_by_name: normalizedName,
        signed_by_document: signedByDocument.trim(),
        email_to: normalizedEmail,
        signature_data_url: signatureDataUrl,
        summary_note: summaryNote.trim(),
        technician_note: technicianNote.trim(),
        include_all_incident_photos: true,
        send_email: sendEmail,
        gps: gpsPayload,
        geofence_override_note: geofenceOverrideNote,
      });
      setLatestConformity(response.conformity);
      notify(
        "success",
        sendEmail
          ? `Conformidad #${response.conformity.id} generada. Estado de envio: ${response.conformity.status}.`
          : `Conformidad #${response.conformity.id} generada sin enviar email.`,
      );
      clearSignature();
    } catch (error) {
      notify("error", `No se pudo generar la conformidad: ${extractApiError(error)}`);
    } finally {
      setSubmitting(false);
    }
  }, [
    clearSignature,
    currentPath,
    emailTo,
    exportSignatureDataUrl,
    geofencePreview.result,
    gpsOverrideNote,
    gpsSnapshot,
    hasSignature,
    installationId,
    notify,
    paths.length,
    signedByDocument,
    signedByName,
    sendEmail,
    submitting,
    summaryNote,
    technicianNote,
  ]);

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.stateText, { color: palette.textSecondary }]}>
          Preparando cierre de instalacion...
        </Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para generar la conformidad y registrar la firma."
          onLoginSuccess={async () => {
            await loadContext();
            await captureGps({ silent: true });
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  if (!installationId) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <Text style={[styles.stateText, { color: palette.errorText }]}>
          installationId invalido para cerrar la instalacion.
        </Text>
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold
      contentContainerStyle={styles.container}
      scrollViewProps={{ scrollEnabled: !isSigning, keyboardShouldPersistTaps: "handled" }}
    >
      <Stack.Screen options={{ title: "Conformidad" }} />
      <ScreenHero
        eyebrow="Cierre operativo"
        title={`Conformidad del caso #${installationId}`}
        description="Genera la constancia final del trabajo con firma tactil y el PDF asociado al activo y su evidencia."
        aside={
          latestConformity ? (
            <View
              style={[
                styles.heroBadge,
                { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder },
              ]}
            >
              <Text style={[styles.heroBadgeText, { color: palette.heroEyebrowText }]}>
                Ultima #{latestConformity.id}
              </Text>
            </View>
          ) : undefined
        }
      >
        <Text style={[styles.heroSupport, { color: palette.textSecondary }]}>
          {record?.client_name || "Sin cliente"} · {assetDetail?.asset?.external_code || "Sin activo vinculado"} · tecnico {technicianUsername || "web"}
        </Text>
      </ScreenHero>

      {feedback ? <InlineFeedback message={feedback.message} tone={feedback.tone} /> : null}

      <SectionCard
        title="Contexto"
        description="El PDF hereda este caso y todas las evidencias asociadas a la instalacion."
      >
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={palette.loadingSpinner} />
            <Text style={[styles.stateText, { color: palette.textSecondary }]}>
              Cargando datos del caso...
            </Text>
          </View>
        ) : (
          <View style={styles.contextGrid}>
            <View style={[styles.metricCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
              <Text style={[styles.metricLabel, { color: palette.textMuted }]}>Cliente</Text>
              <Text style={[styles.metricValue, { color: palette.textPrimary }]}>
                {record?.client_name || "Sin cliente"}
              </Text>
            </View>
            <View style={[styles.metricCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
              <Text style={[styles.metricLabel, { color: palette.textMuted }]}>Activo</Text>
              <Text style={[styles.metricValue, { color: palette.textPrimary }]}>
                {assetDetail?.asset?.external_code || "Sin vinculo"}
              </Text>
            </View>
          </View>
        )}
      </SectionCard>

      {latestConformity ? (
        <SectionCard
          title="Ultimo cierre"
          description="Referencia rapida del PDF mas reciente registrado para este caso."
        >
          <View style={styles.lastConformityCard}>
            <Text style={[styles.lastConformityTitle, { color: palette.textPrimary }]}>
              #{latestConformity.id} · {latestConformity.status}
            </Text>
            <Text style={[styles.lastConformityMeta, { color: palette.textSecondary }]}>
              Firmado por {latestConformity.signed_by_name} · {formatDateTime(latestConformity.generated_at)}
            </Text>
            <Text style={[styles.lastConformityMeta, { color: palette.textMuted }]}>
              Destino: {latestConformity.email_to} · Fotos: {latestConformity.photo_count}
            </Text>
          </View>
        </SectionCard>
      ) : null}

      <SectionCard
        title="GPS y geofence"
        description="El cierre intenta registrar la ubicacion actual y compararla con el sitio configurado del caso."
        aside={
          <TouchableOpacity
            style={[
              styles.clearButton,
              { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
              capturingGps && styles.disabled,
            ]}
            onPress={() => {
              void captureGps();
            }}
            disabled={capturingGps}
            accessibilityRole="button"
            accessibilityLabel="Recapturar ubicacion actual"
            accessibilityState={{ disabled: capturingGps, busy: capturingGps }}
          >
            {capturingGps ? (
              <ActivityIndicator size="small" color={palette.refreshText} />
            ) : (
              <Text style={[styles.clearButtonText, { color: palette.refreshText }]}>Recapturar</Text>
            )}
          </TouchableOpacity>
        }
      >
        <View
          style={[
            styles.gpsCard,
            {
              backgroundColor:
                gpsSnapshot.status === "captured"
                  ? palette.infoBg
                  : gpsSnapshot.status === "override" || gpsSnapshot.status === "denied"
                    ? palette.warningBg
                    : palette.surfaceAlt,
              borderColor:
                gpsSnapshot.status === "captured"
                  ? palette.infoBorder
                  : gpsSnapshot.status === "override" || gpsSnapshot.status === "denied"
                    ? palette.warningText
                    : palette.border,
            },
          ]}
        >
          <Text style={[styles.gpsTitle, { color: palette.textPrimary }]}>
            {formatGpsStatusLabel(gpsSnapshot.status)}
          </Text>
          <Text style={[styles.gpsBody, { color: palette.textSecondary }]}>
            {formatGpsSummary(gpsSnapshot)}
          </Text>
          <Text
            style={[
              styles.gpsFootnote,
              {
                color:
                  geofencePreview.result === "outside"
                    ? palette.warningText
                    : geofencePreview.result === "inside"
                      ? palette.successText
                      : palette.textMuted,
              },
            ]}
          >
            {formatGeofenceSummary(geofencePreview)}
          </Text>
          {hasSiteConfig ? (
            <Text style={[styles.gpsFootnote, { color: palette.textMuted }]}>
              Sitio: {Number(record?.site_lat).toFixed(5)}, {Number(record?.site_lng).toFixed(5)} · radio{" "}
              {Math.round(Number(record?.site_radius_m) || 0)} m
            </Text>
          ) : null}
        </View>

        {showGpsOverrideField ? (
          <>
            <Text style={[styles.label, { color: palette.label }]}>
              {requiresGeofenceOverride ? "Motivo de excepcion geofence" : "Motivo de override GPS"}
            </Text>
            <TextInput
              value={gpsOverrideNote}
              onChangeText={setGpsOverrideNote}
              multiline
              style={[
                styles.input,
                styles.multilineInput,
                {
                  backgroundColor: palette.inputBg,
                  borderColor: requiresGeofenceOverride ? palette.warningText : palette.inputBorder,
                  color: palette.textPrimary,
                },
              ]}
              placeholder={
                requiresGeofenceOverride
                  ? "Explica por que cierras fuera del radio configurado."
                  : "Explica por que cierras sin una coordenada valida."
              }
              placeholderTextColor={palette.placeholder}
              selectionColor={textInputAccentColor}
              cursorColor={textInputAccentColor}
              accessibilityLabel={
                requiresGeofenceOverride ? "Motivo de excepcion geofence" : "Motivo de override GPS"
              }
            />
            <Text
              style={[
                styles.gpsFootnote,
                { color: requiresGeofenceOverride ? palette.warningText : palette.textMuted },
              ]}
            >
              {requiresGeofenceOverride
                ? "Si la politica hard geofence esta activa, esta justificacion pasa a auditoria."
                : "Solo se usa si el dispositivo no pudo entregar una captura GPS util."}
            </Text>
          </>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Firmante"
        description="Completa los datos minimos para emitir la conformidad."
      >
        <Text style={[styles.label, { color: palette.label }]}>Nombre de quien firma</Text>
        <TextInput
          value={signedByName}
          onChangeText={setSignedByName}
          style={[
            styles.input,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          placeholder="Nombre y apellido"
          placeholderTextColor={palette.placeholder}
          selectionColor={textInputAccentColor}
          cursorColor={textInputAccentColor}
          accessibilityLabel="Nombre del firmante"
        />

        <Text style={[styles.label, { color: palette.label }]}>Documento</Text>
        <TextInput
          value={signedByDocument}
          onChangeText={setSignedByDocument}
          style={[
            styles.input,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          placeholder="CI, DNI o referencia interna"
          placeholderTextColor={palette.placeholder}
          selectionColor={textInputAccentColor}
          cursorColor={textInputAccentColor}
          accessibilityLabel="Documento del firmante"
        />

        <Text style={[styles.label, { color: palette.label }]}>Email destino</Text>
        <TextInput
          value={emailTo}
          onChangeText={setEmailTo}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={[
            styles.input,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          placeholder="cliente@empresa.com"
          placeholderTextColor={palette.placeholder}
          selectionColor={textInputAccentColor}
          cursorColor={textInputAccentColor}
          accessibilityLabel="Email destino de la conformidad"
        />

        <View style={styles.switchRow}>
          <View style={styles.switchLabelWrap}>
            <Text style={[styles.switchTitle, { color: palette.textPrimary }]}>
              Enviar email al generar
            </Text>
            <Text style={[styles.switchDescription, { color: palette.textSecondary }]}>
              Usa Resend desde el Worker y adjunta el PDF al correo del cliente.
            </Text>
          </View>
          <Switch
            value={sendEmail}
            onValueChange={setSendEmail}
            trackColor={{ false: palette.inputBorder, true: palette.primaryButtonBg }}
            thumbColor={palette.surface}
            accessibilityLabel="Enviar email al generar la conformidad"
          />
        </View>
      </SectionCard>

      <SectionCard
        title="Resumen del cierre"
        description="Se incluye en el PDF junto a la evidencia existente del caso."
      >
        <Text style={[styles.label, { color: palette.label }]}>Resumen</Text>
        <TextInput
          value={summaryNote}
          onChangeText={setSummaryNote}
          multiline
          style={[
            styles.input,
            styles.multilineInput,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          placeholder="Instalacion validada en sitio."
          placeholderTextColor={palette.placeholder}
          selectionColor={textInputAccentColor}
          cursorColor={textInputAccentColor}
          accessibilityLabel="Resumen del cierre"
        />

        <Text style={[styles.label, { color: palette.label }]}>Nota tecnica</Text>
        <TextInput
          value={technicianNote}
          onChangeText={setTechnicianNote}
          multiline
          style={[
            styles.input,
            styles.multilineInput,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          placeholder="Detalle tecnico breve para el PDF."
          placeholderTextColor={palette.placeholder}
          selectionColor={textInputAccentColor}
          cursorColor={textInputAccentColor}
          accessibilityLabel="Nota tecnica del cierre"
        />
      </SectionCard>

      <SectionCard
        title="Firma"
        description="Traza la firma directamente en la pantalla. El Worker genera el PDF y, si activaste el switch, lo envia por email."
        aside={
          <TouchableOpacity
            style={[
              styles.clearButton,
              { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
            ]}
            onPress={clearSignature}
            accessibilityRole="button"
            accessibilityLabel="Limpiar firma"
          >
            <Text style={[styles.clearButtonText, { color: palette.refreshText }]}>Limpiar</Text>
          </TouchableOpacity>
        }
      >
        <View
          style={[
            styles.signatureShell,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
          {...panResponder.panHandlers}
        >
          <Svg
            ref={signatureSvgRef}
            width="100%"
            height={SIGNATURE_CANVAS_HEIGHT}
            viewBox={`0 0 320 ${SIGNATURE_CANVAS_HEIGHT}`}
          >
            <Rect x="0" y="0" width="320" height={SIGNATURE_CANVAS_HEIGHT} fill={palette.surface} />
            {paths.map((path, index) => (
              <Path
                key={`${path.slice(0, 24)}-${index}`}
                d={path}
                stroke={palette.accent}
                strokeWidth="3.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
            {currentPath ? (
              <Path
                d={currentPath}
                stroke={palette.accent}
                strokeWidth="3.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ) : null}
          </Svg>
          {!hasSignature ? (
            <View style={styles.signatureHintWrap} pointerEvents="none">
              <Text style={[styles.signatureHint, { color: palette.textMuted }]}>
                Firma aqui con el dedo o stylus.
              </Text>
            </View>
          ) : null}
        </View>
      </SectionCard>

      <View style={styles.actionColumn}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            { backgroundColor: palette.primaryButtonBg },
            submitting && styles.disabled,
          ]}
          onPress={() => {
            void onSubmit();
          }}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Generar conformidad"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? (
            <ActivityIndicator color={palette.primaryButtonText} />
          ) : (
            <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
              Generar PDF de conformidad
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.secondaryButton,
            { backgroundColor: palette.secondaryButtonBg, borderColor: palette.inputBorder },
          ]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver al caso"
        >
          <Text style={[styles.secondaryButtonText, { color: palette.secondaryButtonText }]}>
            Volver al caso
          </Text>
        </TouchableOpacity>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    padding: 22,
    gap: 12,
  },
  stateText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilies.regular,
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
  heroSupport: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilies.regular,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 68,
  },
  contextGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricCard: {
    flexGrow: 1,
    minWidth: 140,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 4,
  },
  metricLabel: {
    fontSize: 11.5,
    lineHeight: 15,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontFamily: fontFamilies.semibold,
  },
  metricValue: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamilies.bold,
  },
  lastConformityCard: {
    gap: 4,
  },
  lastConformityTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontFamily: fontFamilies.bold,
  },
  lastConformityMeta: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilies.regular,
  },
  gpsCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 6,
  },
  gpsTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamilies.bold,
  },
  gpsBody: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilies.regular,
  },
  gpsFootnote: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: fontFamilies.medium,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilies.semibold,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: inputFontFamily,
  },
  multilineInput: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  clearButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  clearButtonText: {
    fontSize: 12.5,
    fontFamily: fontFamilies.semibold,
  },
  signatureShell: {
    position: "relative",
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
    minHeight: SIGNATURE_CANVAS_HEIGHT,
  },
  signatureHintWrap: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  signatureHint: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilies.medium,
  },
  actionColumn: {
    gap: 10,
    paddingBottom: 12,
  },
  switchRow: {
    marginTop: 6,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  switchLabelWrap: {
    flex: 1,
    gap: 3,
  },
  switchTitle: {
    fontSize: 13.5,
    lineHeight: 18,
    fontFamily: fontFamilies.semibold,
  },
  switchDescription: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: fontFamilies.regular,
  },
  primaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    fontSize: 14,
    fontFamily: fontFamilies.bold,
  },
  secondaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontFamily: fontFamilies.bold,
  },
  disabled: {
    opacity: 0.7,
  },
});

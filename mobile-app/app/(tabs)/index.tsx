import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  linkAssetToInstallation,
  resolveAssetByExternalCode,
} from "@/src/api/assets";
import {
  createIncident,
  createInstallationRecord,
  listInstallations,
} from "@/src/api/incidents";
import { extractApiError } from "@/src/api/client";
import { clearWebSession, readStoredWebSession } from "@/src/api/webAuth";
import { evaluateWebSession } from "@/src/api/webSession";
import { consumeForceLoginOnOpenFlag } from "@/src/security/startup-session-policy";
import { getStoredWebAccessUsername } from "@/src/storage/secure";
import InlineFeedback, { type InlineFeedbackTone } from "@/src/components/InlineFeedback";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";
import { type IncidentSeverity, type InstallationRecord } from "@/src/types/api";

const SEVERITY_OPTIONS: Array<{
  value: IncidentSeverity;
  label: string;
  criteria: string;
}> = [
  {
    value: "low",
    label: "Baja",
    criteria: "No bloquea operación y hay workaround.",
  },
  {
    value: "medium",
    label: "Media",
    criteria: "Afecta operación parcial, requiere atención hoy.",
  },
  {
    value: "high",
    label: "Alta",
    criteria: "Bloquea proceso principal o múltiples usuarios.",
  },
  {
    value: "critical",
    label: "Crítica",
    criteria: "Caída total, riesgo de datos o cliente detenido.",
  },
];
const MIN_TOUCH_TARGET_SIZE = 44;

type FeedbackState = {
  tone: InlineFeedbackTone;
  message: string;
} | null;

function normalizeRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function normalizeRecordAttentionState(value: unknown): "clear" | "open" | "in_progress" | "resolved" | "critical" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "open" ||
    normalized === "in_progress" ||
    normalized === "resolved" ||
    normalized === "critical"
  ) {
    return normalized;
  }
  return "clear";
}

function recordAttentionStateLabel(value: unknown): string {
  const normalized = normalizeRecordAttentionState(value);
  if (normalized === "critical") return "Crítica";
  if (normalized === "in_progress") return "En curso";
  if (normalized === "open") return "Abierta";
  if (normalized === "resolved") return "Resuelta";
  return "Sin incidencias";
}

export default function CreateIncidentScreen() {
  const router = useRouter();
  const queryParams = useLocalSearchParams<{
    installationId?: string | string[];
    assetExternalCode?: string | string[];
    assetRecordId?: string | string[];
  }>();
  const palette = useAppPalette();
  const initialInstallationIdFromQr = useMemo(() => {
    const raw = normalizeRouteParam(queryParams.installationId).trim();
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : "";
  }, [queryParams.installationId]);
  const initialAssetExternalCodeFromQr = useMemo(
    () => normalizeRouteParam(queryParams.assetExternalCode).trim(),
    [queryParams.assetExternalCode],
  );
  const initialAssetRecordIdFromQr = useMemo(() => {
    const raw = normalizeRouteParam(queryParams.assetRecordId).trim();
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [queryParams.assetRecordId]);

  const [installationId, setInstallationId] = useState(initialInstallationIdFromQr || "1");
  const [assetExternalCode, setAssetExternalCode] = useState(initialAssetExternalCodeFromQr);
  const [assetRecordId, setAssetRecordId] = useState<number | null>(initialAssetRecordIdFromQr);
  const [reporterUsername, setReporterUsername] = useState("");
  const [note, setNote] = useState("");
  const [timeAdjustment, setTimeAdjustment] = useState("0");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [manualClientName, setManualClientName] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [showManualRecordForm, setShowManualRecordForm] = useState(false);
  const [installations, setInstallations] = useState<InstallationRecord[]>([]);
  const [loadingInstallations, setLoadingInstallations] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [linkingAssetOnly, setLinkingAssetOnly] = useState(false);
  const [creatingManualRecord, setCreatingManualRecord] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackState>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [lastCreatedIncidentId, setLastCreatedIncidentId] = useState<number | null>(null);
  const [lastCreatedInstallationId, setLastCreatedInstallationId] = useState<number | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleInstallations = useMemo(() => installations.slice(0, 30), [installations]);

  const resolveFeedbackTone = (title: string): InlineFeedbackTone => {
    const normalized = String(title || "").trim().toLowerCase();
    if (normalized.includes("error")) return "error";
    if (normalized.includes("invalido")) return "warning";
    if (normalized.includes("sesion")) return "warning";
    if (normalized.includes("creado") || normalized.includes("asociado") || normalized.includes("exito")) {
      return "success";
    }
    return "info";
  };

  const notify = (title: string, message: string) => {
    setFeedbackMessage({
      tone: resolveFeedbackTone(title),
      message: `${title}: ${message}`,
    });
    Alert.alert(title, message);
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedbackMessage(null);
      feedbackTimeoutRef.current = null;
    }, 5000);
  };

  const refreshSessionState = useCallback(async () => {
    setCheckingSession(true);
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
      if (!isActive) {
        setInstallations([]);
        setLastCreatedIncidentId(null);
        setLastCreatedInstallationId(null);
      }
      return isActive;
    } finally {
      setCheckingSession(false);
    }
  }, []);

  const loadInstallations = useCallback(async (options?: { forceRefresh?: boolean }) => {
    const activeSession = await refreshSessionState();
    if (!activeSession) {
      return;
    }
    try {
      setLoadingInstallations(true);
      const records = await listInstallations(options);
      setInstallations(records);
      setInstallationId((current) => {
        const currentId = Number.parseInt(current, 10);
        const exists = records.some((item) => item.id === currentId);
        if (!exists && records.length > 0) {
          return String(records[0].id);
        }
        return current;
      });
    } catch (error) {
      notify("Error", `No se pudo cargar registros: ${extractApiError(error)}`);
    } finally {
      setLoadingInstallations(false);
    }
  }, [refreshSessionState]);

  useFocusEffect(
    useCallback(() => {
      void loadInstallations();
    }, [loadInstallations]),
  );

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (initialInstallationIdFromQr) {
      setInstallationId(initialInstallationIdFromQr);
    }
    if (initialAssetExternalCodeFromQr) {
      setAssetExternalCode(initialAssetExternalCodeFromQr);
    }
    if (initialAssetRecordIdFromQr) {
      setAssetRecordId(initialAssetRecordIdFromQr);
    }
  }, [
    initialAssetExternalCodeFromQr,
    initialAssetRecordIdFromQr,
    initialInstallationIdFromQr,
  ]);

  useEffect(() => {
    let mounted = true;
    void getStoredWebAccessUsername().then((storedUsername) => {
      if (!mounted || !storedUsername) return;
      setReporterUsername((current) => {
        if (current.trim()) {
          return current;
        }
        return storedUsername;
      });
    });
    return () => {
      mounted = false;
    };
  }, []);

  const onCreateManualRecord = async () => {
    if (!(await refreshSessionState())) {
      notify("Sesión requerida", "Inicia sesión web en Configuración y acceso.");
      router.push("/modal");
      return;
    }
    try {
      setCreatingManualRecord(true);
      const response = await createInstallationRecord({
        client_name: manualClientName.trim() || "Sin cliente",
        notes: manualNotes.trim(),
        status: "manual",
        driver_brand: "N/A",
        driver_version: "N/A",
        driver_description: "Registro manual creado desde app móvil",
        os_info: "mobile",
        installation_time_seconds: 0,
      });

      const createdId = response.record?.id;
      if (createdId) {
        setInstallationId(String(createdId));
      }
      notify(
        "Registro creado",
        `ID: ${createdId ?? "N/A"}\nAhora puedes adjuntar incidencia sin registro previo.`,
      );
      setManualClientName("");
      setManualNotes("");
      setShowManualRecordForm(false);
      await loadInstallations({ forceRefresh: true });
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setCreatingManualRecord(false);
    }
  };

  const onSubmit = async () => {
    if (!(await refreshSessionState())) {
      notify("Sesión requerida", "Inicia sesión web en Configuración y acceso.");
      router.push("/modal");
      return;
    }
    const parsedInstallationId = Number.parseInt(installationId, 10);
    const parsedTimeAdjustment = Number.parseInt(timeAdjustment, 10);

    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) {
      notify("Dato inválido", "El ID de registro debe ser un número positivo.");
      return;
    }
    if (
      installations.length > 0 &&
      !installations.some((item) => item.id === parsedInstallationId)
    ) {
      notify(
        "Registro no encontrado",
        "Ese ID de registro no existe en la lista cargada. Refresca o crea un registro manual.",
      );
      return;
    }
    if (!note.trim()) {
      notify("Dato inválido", "La nota es obligatoria.");
      return;
    }
    if (!Number.isInteger(parsedTimeAdjustment)) {
      notify("Dato inválido", "time_adjustment_seconds debe ser entero.");
      return;
    }

    try {
      setSubmitting(true);
      const response = await createIncident(parsedInstallationId, {
        note: note.trim(),
        reporter_username: reporterUsername.trim() || "mobile_user",
        time_adjustment_seconds: parsedTimeAdjustment,
        severity,
        source: "mobile",
        apply_to_installation: false,
      });

      const normalizedAssetCode = assetExternalCode.trim();
      let assetLinkWarning = "";
      if (normalizedAssetCode) {
        try {
          let resolvedAssetId = assetRecordId;
          if (!resolvedAssetId || resolvedAssetId <= 0) {
            const resolved = await resolveAssetByExternalCode(normalizedAssetCode);
            const resolvedId = Number(resolved.asset?.id);
            if (!Number.isInteger(resolvedId) || resolvedId <= 0) {
              throw new Error("No se obtuvo asset_id valido al resolver el equipo.");
            }
            resolvedAssetId = resolvedId;
            setAssetRecordId(resolvedId);
          }

          await linkAssetToInstallation(
            resolvedAssetId,
            parsedInstallationId,
            `Asociado desde mobile para incidencia #${response.incident.id}`,
          );
        } catch (linkError) {
          assetLinkWarning = extractApiError(linkError);
        }
      }

      if (assetLinkWarning) {
        notify(
          "Incidencia creada con advertencia",
          `ID: ${response.incident.id}\nRegistro: ${response.incident.installation_id}\nNo se pudo asociar equipo QR: ${assetLinkWarning}`,
        );
      } else if (normalizedAssetCode) {
        notify(
          "Incidencia creada",
          `ID: ${response.incident.id}\nRegistro: ${response.incident.installation_id}\nEquipo asociado: ${normalizedAssetCode}`,
        );
      } else {
        notify(
          "Incidencia creada",
          `ID: ${response.incident.id}\nRegistro: ${response.incident.installation_id}`,
        );
      }
      setLastCreatedIncidentId(response.incident.id);
      setLastCreatedInstallationId(response.incident.installation_id);
      setNote("");
      setTimeAdjustment("0");
    } catch (error) {
      const message = extractApiError(error);
      if (message.toLowerCase().includes("no encontrada")) {
        await loadInstallations({ forceRefresh: true });
      }
      notify("Error", message);
    } finally {
      setSubmitting(false);
    }
  };

  const onLinkAssetWithoutIncident = async () => {
    if (!(await refreshSessionState())) {
      notify("Sesión requerida", "Inicia sesión web en Configuración y acceso.");
      router.push("/modal");
      return;
    }

    const normalizedAssetCode = assetExternalCode.trim();
    if (!normalizedAssetCode) {
      notify("Dato inválido", "No hay un equipo QR para asociar.");
      return;
    }

    const parsedInstallationId = Number.parseInt(installationId, 10);
    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) {
      notify("Dato inválido", "El ID de registro debe ser un número positivo.");
      return;
    }

    if (
      installations.length > 0 &&
      !installations.some((item) => item.id === parsedInstallationId)
    ) {
      notify(
        "Registro no encontrado",
        "Ese ID de registro no existe en la lista cargada. Refresca la lista.",
      );
      return;
    }

    try {
      setLinkingAssetOnly(true);
      let resolvedAssetId = assetRecordId;
      if (!resolvedAssetId || resolvedAssetId <= 0) {
        const resolved = await resolveAssetByExternalCode(normalizedAssetCode);
        const resolvedId = Number(resolved.asset?.id);
        if (!Number.isInteger(resolvedId) || resolvedId <= 0) {
          throw new Error("No se obtuvo asset_id valido al resolver el equipo.");
        }
        resolvedAssetId = resolvedId;
        setAssetRecordId(resolvedId);
      }

      await linkAssetToInstallation(
        resolvedAssetId,
        parsedInstallationId,
        "Asociado desde mobile sin crear incidencia",
      );

      notify(
        "Equipo asociado",
        `Equipo ${normalizedAssetCode} asociado a instalación #${parsedInstallationId}.`,
      );
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setLinkingAssetOnly(false);
    }
  };

  const renderInstallationChip = useCallback(
    ({ item }: { item: InstallationRecord }) => {
      const selected = String(item.id) === installationId;
      const attentionLabel = recordAttentionStateLabel(item.attention_state);
      return (
        <TouchableOpacity
          style={[
            styles.chip,
            { backgroundColor: palette.chipBg, borderColor: palette.chipBorder },
            selected && {
              backgroundColor: palette.chipSelectedBg,
              borderColor: palette.chipSelectedBorder,
            },
          ]}
          onPress={() => setInstallationId(String(item.id))}
          accessibilityRole="button"
          accessibilityLabel={`Seleccionar registro ${item.id}${item.client_name ? ` de ${item.client_name}` : ""} con estado ${attentionLabel}`}
          accessibilityState={{ selected }}
        >
          <Text
            style={[
              styles.chipText,
              { color: palette.chipText },
              selected && { color: palette.chipSelectedText },
            ]}
          >
            #{item.id} [{attentionLabel}] {item.client_name ? `- ${item.client_name}` : ""}
          </Text>
        </TouchableOpacity>
      );
    },
    [installationId, palette],
  );

  const renderSeverityOption = useCallback(
    ({ item }: { item: (typeof SEVERITY_OPTIONS)[number] }) => {
      const selected = severity === item.value;
      return (
        <TouchableOpacity
          style={[
            styles.severityChip,
            { backgroundColor: palette.severityBg, borderColor: palette.severityBorder },
            selected && {
              backgroundColor: palette.severitySelectedBg,
              borderColor: palette.severitySelectedBorder,
            },
          ]}
          onPress={() => setSeverity(item.value)}
          accessibilityRole="button"
          accessibilityLabel={`Seleccionar severidad ${item.label}`}
          accessibilityState={{ selected }}
        >
          <Text
            style={[
              styles.severityChipLabel,
              { color: palette.severityLabel },
              selected && { color: palette.severitySelectedLabel },
            ]}
          >
            {item.label}
          </Text>
          <Text
            style={[
              styles.severityChipCriteria,
              { color: palette.severityCriteria },
              selected && { color: palette.severitySelectedCriteria },
            ]}
          >
            {item.criteria}
          </Text>
        </TouchableOpacity>
      );
    },
    [palette, severity],
  );

  if (checkingSession) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: palette.screenBg }]}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>
          Verificando sesión web...
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
          <Text style={[styles.authTitle, { color: palette.textPrimary }]}>
            Sesión requerida
          </Text>
          <Text style={[styles.authHintText, { color: palette.textSecondary }]}>
            Inicia sesión web para ver registros e incidencias.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: palette.primaryButtonBg }]}
            onPress={() => router.push("/modal")}
            accessibilityRole="button"
            accessibilityLabel="Ir a Configuración y acceso"
          >
            <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>
              Ir a Configuración y acceso
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: palette.screenBg }]}>
      <Text style={[styles.title, { color: palette.textPrimary }]}>Crear incidencia</Text>
      <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
        Usa esta pantalla para crear incidencias y validar el flujo contra el Worker.
      </Text>
      {feedbackMessage ? (
        <InlineFeedback message={feedbackMessage.message} tone={feedbackMessage.tone} />
      ) : null}

      <View
        style={[
          styles.optionalSectionCard,
          { backgroundColor: palette.optionalCardBg, borderColor: palette.optionalCardBorder },
        ]}
      >
        <Text style={[styles.optionalSectionTitle, { color: palette.optionalCardTitle }]}>
          No tengo registro previo
        </Text>
        <Text style={[styles.optionalSectionDescription, { color: palette.optionalCardBody }]}>
          Crea primero un registro base solo si no aparece tu registro en la lista.
        </Text>
        <TouchableOpacity
          style={[
            styles.optionalSectionToggle,
            {
              backgroundColor: palette.optionalToggleBg,
              borderColor: palette.optionalToggleBorder,
            },
          ]}
          onPress={() => setShowManualRecordForm((current) => !current)}
          disabled={creatingManualRecord}
          accessibilityRole="button"
          accessibilityLabel={
            showManualRecordForm
              ? "Ocultar formulario de registro manual"
              : "Mostrar formulario de registro manual"
          }
          accessibilityState={{
            disabled: creatingManualRecord,
            busy: creatingManualRecord,
            expanded: showManualRecordForm,
          }}
        >
          <Text style={[styles.optionalSectionToggleText, { color: palette.optionalToggleText }]}>
            {showManualRecordForm ? "Ocultar registro manual" : "Crear registro manual"}
          </Text>
        </TouchableOpacity>

        {showManualRecordForm ? (
          <View style={styles.optionalSectionForm}>
            <Text style={[styles.label, { color: palette.label }]}>Cliente (opcional)</Text>
            <TextInput
              value={manualClientName}
              onChangeText={setManualClientName}
              style={[
                styles.input,
                {
                  backgroundColor: palette.inputBg,
                  borderColor: palette.inputBorder,
                  color: palette.textPrimary,
                },
              ]}
              placeholder="Cliente ACME"
              placeholderTextColor={palette.placeholder}
              accessibilityLabel="Nombre del cliente para registro manual"
            />

            <Text style={[styles.label, { color: palette.label }]}>Notas del registro base (opcional)</Text>
            <TextInput
              value={manualNotes}
              onChangeText={setManualNotes}
              style={[
                styles.input,
                styles.manualNoteInput,
                {
                  backgroundColor: palette.inputBg,
                  borderColor: palette.inputBorder,
                  color: palette.textPrimary,
                },
              ]}
              multiline
              placeholder="Contexto inicial del caso"
              placeholderTextColor={palette.placeholder}
              accessibilityLabel="Notas del registro manual"
            />

            <TouchableOpacity
              style={[
                styles.secondaryButton,
                { backgroundColor: palette.secondaryButtonBg },
                creatingManualRecord && styles.buttonDisabled,
              ]}
              onPress={onCreateManualRecord}
              disabled={creatingManualRecord}
              accessibilityRole="button"
              accessibilityLabel="Crear registro manual"
              accessibilityState={{
                disabled: creatingManualRecord,
                busy: creatingManualRecord,
              }}
            >
              {creatingManualRecord ? (
                <ActivityIndicator color={palette.secondaryButtonText} />
              ) : (
                <Text style={[styles.buttonText, { color: palette.secondaryButtonText }]}>
                  Crear registro manual
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={[styles.sectionDivider, { borderColor: palette.inputBorder }]} />

      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>2) Crear incidencia sobre un registro</Text>

      <View style={styles.rowBetween}>
        <Text style={[styles.label, { color: palette.label }]}>Escaneo QR</Text>
        <TouchableOpacity
          style={[
            styles.refreshButton,
            { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
          ]}
          onPress={() => router.push("/scan")}
          accessibilityRole="button"
          accessibilityLabel="Abrir escaner QR"
        >
          <Text style={[styles.refreshButtonText, { color: palette.refreshText }]}>Escanear QR</Text>
        </TouchableOpacity>
      </View>

      {assetExternalCode ? (
        <View
          style={[
            styles.optionalSectionCard,
            { backgroundColor: palette.optionalCardBg, borderColor: palette.optionalCardBorder },
          ]}
        >
          <Text style={[styles.optionalSectionTitle, { color: palette.optionalCardTitle }]}>
            Equipo detectado
          </Text>
          <Text style={[styles.optionalSectionDescription, { color: palette.optionalCardBody }]}>
            Codigo: {assetExternalCode}
          </Text>
          <Text style={[styles.optionalSectionDescription, { color: palette.optionalCardBody }]}>
            Asset ID: {assetRecordId ? `#${assetRecordId}` : "pendiente (se resolvera al guardar)"}
          </Text>
          <Text style={[styles.hint, { color: palette.textMuted }]}>
            Puedes asociarlo ahora o dejar que se asocie automáticamente al crear incidencia.
          </Text>
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { backgroundColor: palette.secondaryButtonBg },
              linkingAssetOnly && styles.buttonDisabled,
            ]}
            onPress={onLinkAssetWithoutIncident}
            disabled={linkingAssetOnly || submitting}
            accessibilityRole="button"
            accessibilityLabel="Asociar equipo sin crear incidencia"
            accessibilityState={{
              disabled: linkingAssetOnly || submitting,
              busy: linkingAssetOnly,
            }}
          >
            {linkingAssetOnly ? (
              <ActivityIndicator color={palette.secondaryButtonText} />
            ) : (
              <Text style={[styles.buttonText, { color: palette.secondaryButtonText }]}>
                Asociar ahora
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.optionalSectionToggle,
              {
                backgroundColor: palette.optionalToggleBg,
                borderColor: palette.optionalToggleBorder,
              },
            ]}
            onPress={() => {
              setAssetExternalCode("");
              setAssetRecordId(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Quitar equipo escaneado"
          >
            <Text style={[styles.optionalSectionToggleText, { color: palette.optionalToggleText }]}>
              Quitar equipo
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.rowBetween}>
        <Text style={[styles.label, { color: palette.label }]}>Registros disponibles</Text>
        <TouchableOpacity
          style={[
            styles.refreshButton,
            { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
          ]}
          onPress={() => {
            void loadInstallations({ forceRefresh: true });
          }}
          disabled={loadingInstallations}
          accessibilityRole="button"
          accessibilityLabel="Refrescar lista de registros"
          accessibilityState={{ disabled: loadingInstallations, busy: loadingInstallations }}
        >
          {loadingInstallations ? (
            <ActivityIndicator size="small" color={palette.refreshText} />
          ) : (
            <Text style={[styles.refreshButtonText, { color: palette.refreshText }]}>Refrescar</Text>
          )}
        </TouchableOpacity>
      </View>
      {installations.length === 0 ? (
        <Text style={[styles.hint, { color: palette.textMuted }]}>No hay registros para seleccionar.</Text>
      ) : (
        <>
          {installations.length > 30 ? (
            <Text style={[styles.hint, { color: palette.textMuted }]}>
              Mostrando 30 de {installations.length}. Usa ID de registro para buscar otros.
            </Text>
          ) : null}
          <FlatList
            testID="installation-options-list"
            data={visibleInstallations}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderInstallationChip}
            horizontal
            initialNumToRender={8}
            windowSize={5}
            removeClippedSubviews
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsWrap}
            scrollEnabled={visibleInstallations.length > 4}
          />
        </>
      )}

      <Text style={[styles.label, { color: palette.label }]}>ID de registro</Text>
      <TextInput
        value={installationId}
        onChangeText={setInstallationId}
        keyboardType="numeric"
        style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary }]}
        placeholder="1"
        placeholderTextColor={palette.placeholder}
        accessibilityLabel="ID de registro para la incidencia"
      />

      <Text style={[styles.label, { color: palette.label }]}>Usuario</Text>
      <TextInput
        value={reporterUsername}
        onChangeText={setReporterUsername}
        style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary }]}
        placeholder="Usuario web"
        placeholderTextColor={palette.placeholder}
        accessibilityLabel="Usuario reportante de la incidencia"
      />

      <Text style={[styles.label, { color: palette.label }]}>Nota</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        style={[
          styles.input,
          styles.noteInput,
          { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
        ]}
        multiline
        placeholder="Describe la incidencia"
        placeholderTextColor={palette.placeholder}
        accessibilityLabel="Nota de la incidencia"
      />

      <FlatList
        testID="severity-options-list"
        data={SEVERITY_OPTIONS}
        keyExtractor={(item) => item.value}
        renderItem={renderSeverityOption}
        initialNumToRender={4}
        windowSize={4}
        removeClippedSubviews
        scrollEnabled={false}
        contentContainerStyle={styles.severityWrap}
        ListHeaderComponent={
          <Text style={[styles.label, { color: palette.label }]}>Urgencia (severidad)</Text>
        }
      />

      <Text style={[styles.label, { color: palette.label }]}>Ajuste de tiempo (segundos)</Text>
      <TextInput
        value={timeAdjustment}
        onChangeText={setTimeAdjustment}
        keyboardType="numeric"
        style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary }]}
        placeholder="0"
        placeholderTextColor={palette.placeholder}
        accessibilityLabel="Ajuste de tiempo en segundos"
      />

      <TouchableOpacity
        style={[
          styles.button,
          { backgroundColor: palette.primaryButtonBg },
          submitting && styles.buttonDisabled,
        ]}
        onPress={onSubmit}
        disabled={submitting}
        accessibilityRole="button"
        accessibilityLabel="Crear incidencia"
        accessibilityState={{ disabled: submitting, busy: submitting }}
      >
        {submitting ? (
          <ActivityIndicator color={palette.primaryButtonText} />
        ) : (
          <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>Crear incidencia</Text>
        )}
      </TouchableOpacity>

      {lastCreatedIncidentId && lastCreatedInstallationId ? (
        <View
          style={[
            styles.optionalSectionCard,
            { backgroundColor: palette.optionalCardBg, borderColor: palette.optionalCardBorder },
          ]}
        >
          <Text style={[styles.optionalSectionTitle, { color: palette.optionalCardTitle }]}>
            Siguiente paso recomendado
          </Text>
          <Text style={[styles.optionalSectionDescription, { color: palette.optionalCardBody }]}>
            Completa la evidencia guiada (checklist, nota, fotos y confirmacion) para la incidencia
            #{lastCreatedIncidentId}.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: palette.primaryButtonBg }]}
            onPress={() =>
              router.push(
                `/incident/upload?incidentId=${lastCreatedIncidentId}&installationId=${lastCreatedInstallationId}` as never,
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Abrir asistente de evidencia para la incidencia creada"
          >
            <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>
              Abrir asistente de evidencia
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
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
  authCard: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  authTitle: {
    fontSize: 21,
    fontFamily: fontFamilies.bold,
  },
  authHintText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilies.regular,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  title: {
    fontSize: 28,
    fontFamily: fontFamilies.bold,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilies.regular,
    marginBottom: 10,
  },
  feedbackBox: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 4,
  },
  feedbackText: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  sectionTitle: {
    marginTop: 12,
    fontSize: 16,
    fontFamily: fontFamilies.bold,
  },
  optionalSectionCard: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  optionalSectionTitle: {
    fontSize: 15,
    fontFamily: fontFamilies.bold,
  },
  optionalSectionDescription: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilies.regular,
  },
  optionalSectionToggle: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  optionalSectionToggleText: {
    fontSize: 14,
    fontFamily: fontFamilies.bold,
  },
  optionalSectionForm: {
    gap: 10,
    marginTop: 2,
  },
  sectionDivider: {
    marginTop: 14,
    borderBottomWidth: 1,
  },
  label: {
    fontSize: 13.5,
    fontFamily: fontFamilies.semibold,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  hint: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginBottom: 6,
  },
  severityWrap: {
    gap: 8,
  },
  severityChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    justifyContent: "center",
    gap: 3,
  },
  severityChipLabel: {
    fontFamily: fontFamilies.bold,
    fontSize: 13,
  },
  severityChipCriteria: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: fontFamilies.regular,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    justifyContent: "center",
  },
  chipText: {
    fontSize: 12.5,
    fontFamily: fontFamilies.semibold,
  },
  refreshButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    justifyContent: "center",
  },
  refreshButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  noteInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  manualNoteInput: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  secondaryButton: {
    marginTop: 8,
    borderRadius: 12,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
  },
  button: {
    marginTop: 12,
    borderRadius: 12,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 16,
  },
});

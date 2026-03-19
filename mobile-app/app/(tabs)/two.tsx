import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { extractApiError } from "@/src/api/client";
import { listIncidentsByInstallation, listInstallations, updateIncidentStatus } from "@/src/api/incidents";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";
import { type Incident, type IncidentStatus, type InstallationRecord } from "@/src/types/api";

const MIN_TOUCH_TARGET_SIZE = 44;

function normalizeRecordAttentionState(value: unknown): "clear" | "open" | "in_progress" | "resolved" | "critical" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "open" || normalized === "in_progress" || normalized === "resolved" || normalized === "critical") {
    return normalized;
  }
  return "clear";
}

function recordAttentionStateLabel(value: unknown): string {
  const normalized = normalizeRecordAttentionState(value);
  if (normalized === "critical") return "Critica";
  if (normalized === "in_progress") return "En curso";
  if (normalized === "open") return "Abierta";
  if (normalized === "resolved") return "Resuelta";
  return "Sin incidencias";
}

function normalizeIncidentStatus(value: string | null | undefined): IncidentStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "in_progress") return "in_progress";
  if (normalized === "resolved") return "resolved";
  return "open";
}

function incidentStatusLabel(value: string | null | undefined): string {
  const status = normalizeIncidentStatus(value);
  if (status === "in_progress") return "En curso";
  if (status === "resolved") return "Resuelta";
  return "Abierta";
}

function severityLabel(value: string | null | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "critical") return "Critica";
  if (normalized === "high") return "Alta";
  if (normalized === "medium") return "Media";
  return "Baja";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function IncidentListScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const [installationId, setInstallationId] = useState("1");
  const [loading, setLoading] = useState(false);
  const [loadingInstallations, setLoadingInstallations] = useState(false);
  const [updatingIncidentId, setUpdatingIncidentId] = useState<number | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [installations, setInstallations] = useState<InstallationRecord[]>([]);
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();

  const loadIncidents = useCallback(async (targetInstallationId: number) => {
    if (!hasActiveSession) return;
    if (!Number.isInteger(targetInstallationId) || targetInstallationId <= 0) {
      Alert.alert("Dato invalido", "El ID de registro debe ser un numero positivo.");
      return;
    }
    try {
      setLoading(true);
      const response = await listIncidentsByInstallation(targetInstallationId);
      setIncidents(response.incidents);
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    } finally {
      setLoading(false);
    }
  }, [hasActiveSession]);

  const loadInstallations = useCallback(async (options?: { forceRefresh?: boolean }) => {
    if (!hasActiveSession) return;
    try {
      setLoadingInstallations(true);
      const records = await listInstallations(options);
      setInstallations(records);
      setInstallationId((current) => {
        const currentId = Number.parseInt(current, 10);
        return records.some((item) => item.id === currentId) || records.length === 0 ? current : String(records[0].id);
      });
    } catch (error) {
      Alert.alert("Error", `No se pudo cargar registros: ${extractApiError(error)}`);
    } finally {
      setLoadingInstallations(false);
    }
  }, [hasActiveSession]);

  const onSelectInstallation = async (id: number) => {
    setInstallationId(String(id));
    await loadIncidents(id);
  };

  const onChangeStatus = useCallback(async (incident: Incident, nextStatus: IncidentStatus) => {
    if (normalizeIncidentStatus(incident.incident_status) === nextStatus) return;
    const runChange = async () => {
      try {
        setUpdatingIncidentId(incident.id);
        await updateIncidentStatus(incident.id, {
          incident_status: nextStatus,
          resolution_note: nextStatus === "resolved"
            ? String(incident.resolution_note || incident.evidence_note || "Resuelta desde Android").trim()
            : "",
          reporter_username: incident.reporter_username || "mobile_user",
        });
        const parsedInstallationId = Number.parseInt(installationId, 10);
        await Promise.all([loadIncidents(parsedInstallationId), loadInstallations({ forceRefresh: true })]);
      } catch (error) {
        Alert.alert("Error", extractApiError(error));
      } finally {
        setUpdatingIncidentId(null);
      }
    };
    if (nextStatus !== "resolved") {
      await runChange();
      return;
    }
    Alert.alert("Resolver incidencia", `Se marcara la incidencia #${incident.id} como resuelta.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Resolver", onPress: () => { void runChange(); } },
    ]);
  }, [installationId, loadIncidents, loadInstallations]);

  useEffect(() => {
    if (!hasActiveSession) {
      setIncidents([]);
      setInstallations([]);
      return;
    }
    void loadInstallations();
  }, [hasActiveSession, loadInstallations]);

  useFocusEffect(useCallback(() => {
    if (!hasActiveSession) return;
    const parsedInstallationId = Number.parseInt(installationId, 10);
    if (Number.isInteger(parsedInstallationId) && parsedInstallationId > 0) {
      void loadIncidents(parsedInstallationId);
    }
  }, [hasActiveSession, installationId, loadIncidents]));

  const activeIncidents = useMemo(
    () => incidents.filter((incident) => normalizeIncidentStatus(incident.incident_status) !== "resolved"),
    [incidents],
  );
  const resolvedIncidents = useMemo(
    () => incidents.filter((incident) => normalizeIncidentStatus(incident.incident_status) === "resolved"),
    [incidents],
  );

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>Verificando sesion web...</Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para ver registros e incidencias."
          onLoginSuccess={async () => {
            await loadInstallations({ forceRefresh: true });
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <ScreenHero
        eyebrow="Android Ops"
        title="Incidencias"
        description="Backlog por registro con mejor contexto visual y acciones rapidas para pasar de abierta a resuelta."
        aside={
          <View style={[styles.heroBadge, { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder }]}>
            <Text style={[styles.heroBadgeText, { color: palette.heroEyebrowText }]}>#{installationId || "--"}</Text>
          </View>
        }
      >
        <View style={styles.heroMetaRow}>
          <View style={[styles.heroMetaChip, { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder }]}>
            <Text style={[styles.heroMetaText, { color: palette.heroEyebrowText }]}>{activeIncidents.length} activas</Text>
          </View>
          <View style={[styles.heroMetaChip, { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder }]}>
            <Text style={[styles.heroMetaText, { color: palette.heroEyebrowText }]}>{resolvedIncidents.length} resueltas</Text>
          </View>
        </View>
      </ScreenHero>

      <View style={styles.topActionsRow}>
        <TouchableOpacity style={[styles.topActionButton, { backgroundColor: palette.primaryButtonBg }]} onPress={() => router.push(`/?installationId=${encodeURIComponent(installationId || "1")}` as never)}>
          <Text style={[styles.topActionText, { color: palette.primaryButtonText }]}>Nueva incidencia</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.topActionButton, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
          onPress={() => { void loadIncidents(Number.parseInt(installationId, 10)); }}
          disabled={loading}
        >
          {loading ? <ActivityIndicator size="small" color={palette.refreshText} /> : <Text style={[styles.topActionText, { color: palette.refreshText }]}>Refrescar</Text>}
        </TouchableOpacity>
      </View>

      <View style={[styles.filterCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
        <View style={styles.rowBetween}>
          <Text style={[styles.label, { color: palette.textSecondary }]}>Registros disponibles</Text>
          <TouchableOpacity
            style={[styles.refreshButton, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
            onPress={() => { void loadInstallations({ forceRefresh: true }); }}
            disabled={loadingInstallations}
          >
            {loadingInstallations ? <ActivityIndicator size="small" color={palette.refreshText} /> : <Text style={[styles.refreshButtonText, { color: palette.refreshText }]}>Actualizar</Text>}
          </TouchableOpacity>
        </View>

        {installations.length === 0 ? (
          <Text style={[styles.emptyText, { color: palette.textMuted }]}>No hay registros para seleccionar.</Text>
        ) : (
          <View style={styles.chipsWrap}>
            {installations.slice(0, 30).map((item) => {
              const selected = String(item.id) === installationId;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.chip,
                    { backgroundColor: palette.chipBg, borderColor: palette.chipBorder },
                    selected && { backgroundColor: palette.chipSelectedBg, borderColor: palette.chipSelectedBorder },
                  ]}
                  onPress={() => { void onSelectInstallation(item.id); }}
                  disabled={loading}
                >
                  <Text style={[styles.chipText, { color: selected ? palette.chipSelectedText : palette.chipText }]}>
                    #{item.id} [{recordAttentionStateLabel(item.attention_state)}]
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <Text style={[styles.label, { color: palette.textSecondary }]}>ID de registro</Text>
        <TextInput
          value={installationId}
          onChangeText={setInstallationId}
          keyboardType="numeric"
          style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary }]}
          placeholder="1"
          placeholderTextColor={palette.placeholder}
        />
      </View>

      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Activas ({activeIncidents.length})</Text>
      {activeIncidents.length === 0 ? (
        <EmptyStateCard title="Sin incidencias activas." body="Este registro no tiene incidencias abiertas o en curso." />
      ) : (
        activeIncidents.map((incident) => {
          const status = normalizeIncidentStatus(incident.incident_status);
          const busy = updatingIncidentId === incident.id;
          return (
            <View key={incident.id} style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
              <View style={styles.cardHeader}>
                <View style={styles.badgesRow}>
                  <View style={[styles.badge, { backgroundColor: palette.infoBg, borderColor: palette.infoBorder }]}>
                    <Text style={[styles.badgeText, { color: palette.infoText }]}>{severityLabel(incident.severity)}</Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: status === "in_progress" ? palette.warningBg : palette.infoBg, borderColor: palette.inputBorder }]}>
                    <Text style={[styles.badgeText, { color: status === "in_progress" ? palette.warningText : palette.infoText }]}>{incidentStatusLabel(status)}</Text>
                  </View>
                </View>
                <Text style={[styles.metaText, { color: palette.textMuted }]}>#{incident.id} · {formatDate(incident.created_at)}</Text>
              </View>

              <Text style={[styles.noteText, { color: palette.textPrimary }]}>{incident.note || "Sin detalle operativo."}</Text>
              <Text style={[styles.supportingText, { color: palette.textSecondary }]}>Usuario: {incident.reporter_username || "-"} · Fotos: {incident.photos?.length ?? 0}</Text>
              {incident.evidence_note?.trim() ? <Text style={[styles.supportingText, { color: palette.textSecondary }]}>Nota operativa: {incident.evidence_note}</Text> : null}
              {incident.checklist_items?.length ? <Text style={[styles.supportingText, { color: palette.textSecondary }]}>Checklist: {incident.checklist_items.slice(0, 3).join(" · ")}</Text> : null}

              <View style={styles.statusRow}>
                {(["open", "in_progress", "resolved"] as IncidentStatus[]).map((nextStatus) => {
                  const selected = status === nextStatus;
                  const primary = nextStatus === "resolved";
                  return (
                    <TouchableOpacity
                      key={`${incident.id}-${nextStatus}`}
                      style={[
                        styles.statusButton,
                        {
                          backgroundColor: selected || primary ? palette.primaryButtonBg : palette.refreshBg,
                          borderColor: primary ? palette.primaryButtonBg : palette.inputBorder,
                        },
                      ]}
                      onPress={() => { void onChangeStatus(incident, nextStatus); }}
                      disabled={busy}
                    >
                      {busy && nextStatus === "resolved" ? (
                        <ActivityIndicator size="small" color={palette.primaryButtonText} />
                      ) : (
                        <Text style={[styles.statusButtonText, { color: selected || primary ? palette.primaryButtonText : palette.refreshText }]}>
                          {nextStatus === "open" ? "Abierta" : nextStatus === "in_progress" ? "En curso" : "Resolver"}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.detailButton, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
                  onPress={() => router.push(`/incident/detail?incidentId=${incident.id}&installationId=${incident.installation_id}` as never)}
                >
                  <Text style={[styles.detailButtonText, { color: palette.refreshText }]}>Ver detalle</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.uploadButton, { backgroundColor: palette.uploadButtonBg }]}
                  onPress={() => router.push(`/incident/upload?incidentId=${incident.id}&installationId=${incident.installation_id}` as never)}
                >
                  <Text style={[styles.uploadButtonText, { color: palette.uploadButtonText }]}>Subir evidencia</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}

      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Resueltas ({resolvedIncidents.length})</Text>
      {resolvedIncidents.length === 0 ? (
        <EmptyStateCard title="Sin historial resuelto." body="Las incidencias cerradas apareceran aqui con su nota final." />
      ) : (
        resolvedIncidents.map((incident) => (
          <View key={incident.id} style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
            <View style={styles.cardHeader}>
              <View style={styles.badgesRow}>
                <View style={[styles.badge, { backgroundColor: palette.successBg, borderColor: palette.successBorder }]}>
                  <Text style={[styles.badgeText, { color: palette.successText }]}>Resuelta</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: palette.infoBg, borderColor: palette.infoBorder }]}>
                  <Text style={[styles.badgeText, { color: palette.infoText }]}>{severityLabel(incident.severity)}</Text>
                </View>
              </View>
              <Text style={[styles.metaText, { color: palette.textMuted }]}>#{incident.id} · {formatDate(incident.resolved_at || incident.status_updated_at || incident.created_at)}</Text>
            </View>
            <Text style={[styles.noteText, { color: palette.textPrimary }]}>{incident.note || "Sin detalle operativo."}</Text>
            <Text style={[styles.supportingText, { color: palette.textSecondary }]}>Resolucion: {incident.resolution_note?.trim() || "Sin nota de resolucion."}</Text>
            <TouchableOpacity
              style={[styles.detailButton, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
              onPress={() => router.push(`/incident/detail?incidentId=${incident.id}&installationId=${incident.installation_id}` as never)}
            >
              <Text style={[styles.detailButtonText, { color: palette.refreshText }]}>Ver detalle</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  centerContainer: { flex: 1, padding: 20, alignItems: "center", justifyContent: "center" },
  container: { padding: 20, gap: 12 },
  authHintText: { fontSize: 13, fontFamily: fontFamilies.regular },
  heroBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  heroBadgeText: { fontFamily: fontFamilies.bold, fontSize: 11.5, letterSpacing: 0.3 },
  heroMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  heroMetaChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  heroMetaText: { fontFamily: fontFamilies.semibold, fontSize: 12 },
  topActionsRow: { flexDirection: "row", gap: 10 },
  topActionButton: { flex: 1, minHeight: MIN_TOUCH_TARGET_SIZE, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  topActionText: { fontFamily: fontFamilies.bold, fontSize: 14 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  label: { fontSize: 13, fontFamily: fontFamilies.semibold },
  filterCard: { borderWidth: 1, borderRadius: 22, padding: 16, gap: 12 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  chipText: { fontSize: 12, fontFamily: fontFamilies.semibold },
  refreshButton: { borderWidth: 1, borderRadius: 12, minHeight: MIN_TOUCH_TARGET_SIZE, paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center" },
  refreshButtonText: { fontFamily: fontFamilies.semibold, fontSize: 12 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  sectionTitle: { fontSize: 16, fontFamily: fontFamilies.bold, marginTop: 2 },
  card: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 9 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  badgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, flex: 1 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { fontSize: 11.5, fontFamily: fontFamilies.bold },
  metaText: { fontSize: 12, fontFamily: fontFamilies.regular, textAlign: "right", flexShrink: 1 },
  noteText: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.semibold },
  supportingText: { fontSize: 12.5, lineHeight: 18, fontFamily: fontFamilies.regular },
  statusRow: { flexDirection: "row", gap: 8 },
  statusButton: { flex: 1, minHeight: MIN_TOUCH_TARGET_SIZE, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, paddingVertical: 8 },
  statusButtonText: { fontSize: 12, fontFamily: fontFamilies.bold },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  detailButton: { alignSelf: "flex-start", borderRadius: 12, borderWidth: 1, minHeight: MIN_TOUCH_TARGET_SIZE, paddingHorizontal: 12, paddingVertical: 10, justifyContent: "center" },
  detailButtonText: { fontFamily: fontFamilies.bold, fontSize: 12.5 },
  uploadButton: { alignSelf: "flex-start", borderRadius: 12, minHeight: MIN_TOUCH_TARGET_SIZE, paddingHorizontal: 12, paddingVertical: 10, justifyContent: "center" },
  uploadButtonText: { fontFamily: fontFamilies.bold, fontSize: 12.5 },
  emptyText: { fontSize: 12.5, fontFamily: fontFamilies.regular },
});

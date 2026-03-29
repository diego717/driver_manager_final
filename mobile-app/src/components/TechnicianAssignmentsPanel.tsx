import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  createTechnicianAssignment,
  deleteTechnicianAssignment,
  getTechnicianAssignmentsByEntity,
  listTechnicians,
} from "@/src/api/technicians";
import { extractApiError } from "@/src/api/client";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";
import { type TechnicianAssignment, type TechnicianRecord } from "@/src/types/api";

const MIN_TOUCH_TARGET_SIZE = 44;
const ROLE_OPTIONS = [
  { value: "owner", label: "Titular" },
  { value: "assistant", label: "Apoyo" },
  { value: "reviewer", label: "Revision" },
] as const;

type AssignmentEntityType = "installation" | "incident" | "asset" | "zone";

export default function TechnicianAssignmentsPanel(props: {
  entityType: AssignmentEntityType;
  entityId: number | string;
  entityLabel?: string;
  canManage: boolean;
  currentLinkedTechnicianId?: number | null;
  emptyText?: string;
  onAssignmentsChanged?: (assignments: TechnicianAssignment[]) => void;
}) {
  const palette = useAppPalette();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [assignments, setAssignments] = useState<TechnicianAssignment[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianRecord[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<number | null>(null);
  const [selectedRole, setSelectedRole] = useState<(typeof ROLE_OPTIONS)[number]["value"]>("owner");
  const [feedback, setFeedback] = useState<string>("");
  const normalizedEntityId = useMemo(() => String(props.entityId).trim(), [props.entityId]);

  const emitAssignments = useCallback((nextAssignments: TechnicianAssignment[]) => {
    props.onAssignmentsChanged?.(nextAssignments);
  }, [props]);

  const loadData = useCallback(async () => {
    if (!normalizedEntityId) {
      setAssignments([]);
      setTechnicians([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [assignmentRows, technicianRows] = await Promise.all([
        getTechnicianAssignmentsByEntity(props.entityType, props.entityId),
        props.canManage ? listTechnicians() : Promise.resolve([]),
      ]);
      setAssignments(assignmentRows.filter((assignment) => !assignment.unassigned_at));
      setTechnicians(technicianRows.filter((technician) => technician?.is_active));
      emitAssignments(assignmentRows.filter((assignment) => !assignment.unassigned_at));
      setFeedback("");
    } catch (error) {
      setFeedback(extractApiError(error));
      setAssignments([]);
      setTechnicians([]);
      emitAssignments([]);
    } finally {
      setLoading(false);
    }
  }, [emitAssignments, normalizedEntityId, props.canManage, props.entityId, props.entityType]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const assignedTechnicianIds = useMemo(
    () => new Set(assignments.map((assignment) => assignment.technician_id)),
    [assignments],
  );
  const availableTechnicians = useMemo(
    () => technicians.filter((technician) => !assignedTechnicianIds.has(technician.id)),
    [assignedTechnicianIds, technicians],
  );

  useEffect(() => {
    if (!availableTechnicians.length) {
      setSelectedTechnicianId(null);
      return;
    }
    setSelectedTechnicianId((current) =>
      current && availableTechnicians.some((technician) => technician.id === current)
        ? current
        : availableTechnicians[0]?.id ?? null,
    );
  }, [availableTechnicians]);

  const onAssign = useCallback(async () => {
    if (!props.canManage || !selectedTechnicianId) return;
    try {
      setSubmitting(true);
      await createTechnicianAssignment(selectedTechnicianId, {
        entityType: props.entityType,
        entityId: props.entityId,
        assignmentRole: selectedRole,
      });
      await loadData();
      setExpanded(false);
      setFeedback("");
    } catch (error) {
      setFeedback(extractApiError(error));
    } finally {
      setSubmitting(false);
    }
  }, [loadData, props.canManage, props.entityId, props.entityType, selectedRole, selectedTechnicianId]);

  const onRemove = useCallback(async (assignmentId: number) => {
    if (!props.canManage) return;
    try {
      setSubmitting(true);
      await deleteTechnicianAssignment(assignmentId);
      await loadData();
      setFeedback("");
    } catch (error) {
      setFeedback(extractApiError(error));
    } finally {
      setSubmitting(false);
    }
  }, [loadData, props.canManage]);

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={palette.loadingSpinner} />
          <Text style={[styles.supportText, { color: palette.textSecondary }]}>
            Cargando asignaciones...
          </Text>
        </View>
      ) : assignments.length ? (
        <View style={styles.list}>
          {assignments.map((assignment) => {
            const isCurrentLinked = Boolean(
              props.currentLinkedTechnicianId &&
              assignment.technician_id === props.currentLinkedTechnicianId,
            );
            return (
              <View
                key={assignment.id}
                style={[
                  styles.assignmentCard,
                  {
                    backgroundColor: isCurrentLinked ? palette.infoBg : palette.surfaceAlt,
                    borderColor: isCurrentLinked ? palette.infoBorder : palette.border,
                  },
                ]}
              >
                <View style={styles.assignmentCopy}>
                  <Text style={[styles.assignmentName, { color: palette.textPrimary }]}>
                    {assignment.technician_display_name || `Tecnico #${assignment.technician_id}`}
                  </Text>
                  <Text style={[styles.assignmentMeta, { color: palette.textSecondary }]}>
                    {assignment.assignment_role} · {assignment.entity_type}
                    {props.entityLabel ? ` · ${props.entityLabel}` : ""}
                  </Text>
                  {assignment.technician_employee_code ? (
                    <Text style={[styles.assignmentMeta, { color: palette.textMuted }]}>
                      {assignment.technician_employee_code}
                    </Text>
                  ) : null}
                </View>
                {props.canManage ? (
                  <TouchableOpacity
                    style={[
                      styles.removeButton,
                      { backgroundColor: palette.warningBg, borderColor: palette.warningText },
                      submitting && styles.disabled,
                    ]}
                    onPress={() => {
                      void onRemove(assignment.id);
                    }}
                    disabled={submitting}
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar tecnico ${assignment.technician_display_name || assignment.technician_id}`}
                  >
                    <Text style={[styles.removeButtonText, { color: palette.warningText }]}>
                      Quitar
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={[styles.supportText, { color: palette.textSecondary }]}>
          {props.emptyText || "Sin tecnicos asignados."}
        </Text>
      )}

      {feedback ? (
        <Text style={[styles.feedbackText, { color: palette.warningText }]}>
          {feedback}
        </Text>
      ) : null}

      {props.canManage ? (
        <View style={styles.manageStack}>
          <TouchableOpacity
            style={[
              styles.manageButton,
              { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
            ]}
            onPress={() => setExpanded((current) => !current)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? "Cerrar asignacion de tecnico" : "Asignar tecnico"}
          >
            <Text style={[styles.manageButtonText, { color: palette.refreshText }]}>
              {expanded ? "Ocultar asignacion" : "Asignar tecnico"}
            </Text>
          </TouchableOpacity>

          {expanded ? (
            <View
              style={[
                styles.editorCard,
                { backgroundColor: palette.surfaceAlt, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.groupLabel, { color: palette.textPrimary }]}>
                Tecnico
              </Text>
              <View style={styles.optionWrap}>
                {availableTechnicians.length ? (
                  availableTechnicians.map((technician) => {
                    const selected = selectedTechnicianId === technician.id;
                    return (
                      <TouchableOpacity
                        key={technician.id}
                        style={[
                          styles.optionChip,
                          {
                            backgroundColor: selected ? palette.primaryButtonBg : palette.surface,
                            borderColor: selected ? palette.primaryButtonBg : palette.inputBorder,
                          },
                        ]}
                        onPress={() => setSelectedTechnicianId(technician.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`Seleccionar tecnico ${technician.display_name}`}
                      >
                        <Text
                          style={[
                            styles.optionChipText,
                            { color: selected ? palette.primaryButtonText : palette.textPrimary },
                          ]}
                        >
                          {technician.display_name}
                          {technician.employee_code ? ` · ${technician.employee_code}` : ""}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                ) : (
                  <Text style={[styles.supportText, { color: palette.textSecondary }]}>
                    No hay tecnicos activos disponibles para agregar.
                  </Text>
                )}
              </View>

              <Text style={[styles.groupLabel, { color: palette.textPrimary }]}>
                Rol
              </Text>
              <View style={styles.optionWrap}>
                {ROLE_OPTIONS.map((role) => {
                  const selected = selectedRole === role.value;
                  return (
                    <TouchableOpacity
                      key={role.value}
                      style={[
                        styles.optionChip,
                        {
                          backgroundColor: selected ? palette.primaryButtonBg : palette.surface,
                          borderColor: selected ? palette.primaryButtonBg : palette.inputBorder,
                        },
                      ]}
                      onPress={() => setSelectedRole(role.value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Seleccionar rol ${role.label}`}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          { color: selected ? palette.primaryButtonText : palette.textPrimary },
                        ]}
                      >
                        {role.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[
                  styles.assignButton,
                  { backgroundColor: palette.primaryButtonBg },
                  (!selectedTechnicianId || submitting) && styles.disabled,
                ]}
                onPress={() => {
                  void onAssign();
                }}
                disabled={!selectedTechnicianId || submitting}
                accessibilityRole="button"
                accessibilityLabel="Confirmar asignacion de tecnico"
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={palette.primaryButtonText} />
                ) : (
                  <Text style={[styles.assignButtonText, { color: palette.primaryButtonText }]}>
                    Guardar asignacion
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
  },
  list: {
    gap: 8,
  },
  assignmentCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  assignmentCopy: {
    flex: 1,
    gap: 3,
  },
  assignmentName: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
  },
  assignmentMeta: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 17,
  },
  supportText: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  feedbackText: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 17,
  },
  removeButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  removeButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 12.5,
  },
  manageStack: {
    gap: 10,
  },
  manageButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  manageButtonText: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  editorCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    gap: 10,
  },
  groupLabel: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13.5,
  },
  optionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
  },
  optionChipText: {
    fontFamily: fontFamilies.bold,
    fontSize: 12.5,
  },
  assignButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  assignButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
  },
  disabled: {
    opacity: 0.72,
  },
});

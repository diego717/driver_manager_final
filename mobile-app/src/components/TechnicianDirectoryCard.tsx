import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  createTechnician,
  listTechnicians,
  updateTechnician,
} from "@/src/api/technicians";
import {
  extractApiError,
} from "@/src/api/client";
import {
  listWebUsers,
  type WebManagedUser,
} from "@/src/api/webAuth";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";
import { type TechnicianRecord } from "@/src/types/api";

interface TechnicianDraft {
  displayName: string;
  employeeCode: string;
  email: string;
  phone: string;
  notes: string;
  webUserId: number | null;
  isActive: boolean;
}

function createEmptyDraft(): TechnicianDraft {
  return {
    displayName: "",
    employeeCode: "",
    email: "",
    phone: "",
    notes: "",
    webUserId: null,
    isActive: true,
  };
}

function toDraft(technician: TechnicianRecord | null): TechnicianDraft {
  if (!technician) return createEmptyDraft();
  return {
    displayName: technician.display_name || "",
    employeeCode: technician.employee_code || "",
    email: technician.email || "",
    phone: technician.phone || "",
    notes: technician.notes || "",
    webUserId: technician.web_user_id ?? null,
    isActive: technician.is_active,
  };
}

function getWebUserLabel(user: WebManagedUser): string {
  const role = String(user.role || "").trim();
  const activeSuffix = user.is_active ? "" : " · inactivo";
  return role ? `${user.username} · ${role}${activeSuffix}` : `${user.username}${activeSuffix}`;
}

export default function TechnicianDirectoryCard(props: {
  enabled: boolean;
}) {
  const palette = useAppPalette();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [technicians, setTechnicians] = useState<TechnicianRecord[]>([]);
  const [webUsers, setWebUsers] = useState<WebManagedUser[]>([]);
  const [editingTechnicianId, setEditingTechnicianId] = useState<number | null>(null);
  const [draft, setDraft] = useState<TechnicianDraft>(createEmptyDraft);

  const loadDirectory = useCallback(async () => {
    if (!props.enabled) {
      setTechnicians([]);
      setWebUsers([]);
      return;
    }

    try {
      setLoading(true);
      const [technicianRows, webUserRows] = await Promise.all([
        listTechnicians({ includeInactive: true }),
        listWebUsers(),
      ]);
      setTechnicians(technicianRows);
      setWebUsers(webUserRows);
    } catch (error) {
      Alert.alert("Tecnicos", extractApiError(error));
      setTechnicians([]);
      setWebUsers([]);
    } finally {
      setLoading(false);
    }
  }, [props.enabled]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const linkedUserMap = useMemo(() => {
    const map = new Map<number, WebManagedUser>();
    webUsers.forEach((user) => {
      if (Number.isInteger(user.id) && user.id > 0) {
        map.set(user.id, user);
      }
    });
    return map;
  }, [webUsers]);

  const availableWebUsers = useMemo(() => {
    const linkedIds = new Set(
      technicians
        .filter((technician) => technician.id !== editingTechnicianId)
        .map((technician) => technician.web_user_id)
        .filter((userId): userId is number => typeof userId === "number" && userId > 0),
    );

    return webUsers.filter((user) => !linkedIds.has(user.id));
  }, [editingTechnicianId, technicians, webUsers]);

  const selectedWebUser = useMemo(
    () => (draft.webUserId ? linkedUserMap.get(draft.webUserId) || null : null),
    [draft.webUserId, linkedUserMap],
  );

  const startCreate = useCallback(() => {
    setEditingTechnicianId(null);
    setDraft(createEmptyDraft());
    setShowUserPicker(false);
    setShowEditor(true);
  }, []);

  const startEdit = useCallback((technician: TechnicianRecord) => {
    setEditingTechnicianId(technician.id);
    setDraft(toDraft(technician));
    setShowUserPicker(false);
    setShowEditor(true);
  }, []);

  const closeEditor = useCallback(() => {
    setShowEditor(false);
    setShowUserPicker(false);
    setEditingTechnicianId(null);
    setDraft(createEmptyDraft());
  }, []);

  const submit = useCallback(async () => {
    if (!draft.displayName.trim()) {
      Alert.alert("Tecnicos", "El nombre visible es obligatorio.");
      return;
    }

    try {
      setSubmitting(true);
      if (editingTechnicianId) {
        await updateTechnician(editingTechnicianId, {
          displayName: draft.displayName,
          employeeCode: draft.employeeCode,
          email: draft.email,
          phone: draft.phone,
          notes: draft.notes,
          webUserId: draft.webUserId,
          isActive: draft.isActive,
        });
      } else {
        await createTechnician({
          displayName: draft.displayName,
          employeeCode: draft.employeeCode,
          email: draft.email,
          phone: draft.phone,
          notes: draft.notes,
          webUserId: draft.webUserId,
        });
      }
      closeEditor();
      await loadDirectory();
    } catch (error) {
      Alert.alert("Tecnicos", extractApiError(error));
    } finally {
      setSubmitting(false);
    }
  }, [closeEditor, draft, editingTechnicianId, loadDirectory]);

  const toggleActive = useCallback(
    async (technician: TechnicianRecord) => {
      try {
        setSubmitting(true);
        await updateTechnician(technician.id, { isActive: !technician.is_active });
        await loadDirectory();
      } catch (error) {
        Alert.alert("Tecnicos", extractApiError(error));
      } finally {
        setSubmitting(false);
      }
    },
    [loadDirectory],
  );

  if (!props.enabled) return null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: palette.title }]}>Staff tecnico</Text>
          <Text style={[styles.description, { color: palette.textMuted }]}>
            Administra tecnicos y vincula su usuario web desde el celular.
          </Text>
        </View>
        {loading ? <ActivityIndicator color={palette.loadingSpinner} /> : null}
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
          onPress={() => void loadDirectory()}
          disabled={loading || submitting}
        >
          <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Actualizar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
          onPress={startCreate}
          disabled={loading || submitting}
        >
          <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>Nuevo tecnico</Text>
        </TouchableOpacity>
      </View>

      {showEditor ? (
        <View style={[styles.editorCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
          <Text style={[styles.editorTitle, { color: palette.title }]}>
            {editingTechnicianId ? `Editar tecnico #${editingTechnicianId}` : "Nuevo tecnico"}
          </Text>

          <TextInput
            value={draft.displayName}
            onChangeText={(value) => setDraft((current) => ({ ...current, displayName: value }))}
            placeholder="Nombre visible"
            placeholderTextColor={palette.placeholder}
            style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.title }]}
          />
          <TextInput
            value={draft.employeeCode}
            onChangeText={(value) => setDraft((current) => ({ ...current, employeeCode: value }))}
            placeholder="Codigo interno"
            placeholderTextColor={palette.placeholder}
            style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.title }]}
          />
          <TextInput
            value={draft.email}
            onChangeText={(value) => setDraft((current) => ({ ...current, email: value }))}
            placeholder="Email"
            placeholderTextColor={palette.placeholder}
            autoCapitalize="none"
            style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.title }]}
          />
          <TextInput
            value={draft.phone}
            onChangeText={(value) => setDraft((current) => ({ ...current, phone: value }))}
            placeholder="Telefono"
            placeholderTextColor={palette.placeholder}
            style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.title }]}
          />
          <TextInput
            value={draft.notes}
            onChangeText={(value) => setDraft((current) => ({ ...current, notes: value }))}
            placeholder="Notas operativas"
            placeholderTextColor={palette.placeholder}
            multiline
            numberOfLines={4}
            style={[
              styles.input,
              styles.notesInput,
              { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.title },
            ]}
          />

          <View style={styles.inlineRow}>
            <View style={styles.inlineCopy}>
              <Text style={[styles.inlineTitle, { color: palette.title }]}>Usuario web vinculado</Text>
              <Text style={[styles.inlineDescription, { color: palette.textMuted }]}>
                {selectedWebUser ? getWebUserLabel(selectedWebUser) : "Sin usuario vinculado"}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
              onPress={() => setShowUserPicker((current) => !current)}
            >
              <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>
                {showUserPicker ? "Ocultar" : "Elegir"}
              </Text>
            </TouchableOpacity>
          </View>

          {showUserPicker ? (
            <ScrollView style={styles.userPicker} nestedScrollEnabled>
              <TouchableOpacity
                style={[
                  styles.userOption,
                  { backgroundColor: draft.webUserId === null ? palette.secondaryBg : palette.cardBg, borderColor: palette.inputBorder },
                ]}
                onPress={() => setDraft((current) => ({ ...current, webUserId: null }))}
              >
                <Text style={[styles.userOptionText, { color: palette.title }]}>Sin usuario vinculado</Text>
              </TouchableOpacity>
              {availableWebUsers.map((user) => {
                const selected = draft.webUserId === user.id;
                return (
                  <TouchableOpacity
                    key={user.id}
                    style={[
                      styles.userOption,
                      { backgroundColor: selected ? palette.secondaryBg : palette.cardBg, borderColor: palette.inputBorder },
                    ]}
                    onPress={() => setDraft((current) => ({ ...current, webUserId: user.id }))}
                  >
                    <Text style={[styles.userOptionText, { color: palette.title }]}>{getWebUserLabel(user)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}

          {editingTechnicianId ? (
            <View style={styles.inlineRow}>
              <View style={styles.inlineCopy}>
                <Text style={[styles.inlineTitle, { color: palette.title }]}>Tecnico activo</Text>
                <Text style={[styles.inlineDescription, { color: palette.textMuted }]}>
                  Desactivalo si no queres asignarlo mas, sin perder historial.
                </Text>
              </View>
              <Switch
                value={draft.isActive}
                onValueChange={(value) => setDraft((current) => ({ ...current, isActive: value }))}
              />
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
              onPress={closeEditor}
              disabled={submitting}
            >
              <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }, submitting && styles.disabled]}
              onPress={() => void submit()}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={palette.primaryButtonText} />
              ) : (
                <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>Guardar</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {technicians.length ? (
        technicians.map((technician) => {
          const linkedUser =
            technician.web_user_id !== null ? linkedUserMap.get(technician.web_user_id) || null : null;
          return (
            <View
              key={technician.id}
              style={[styles.technicianCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}
            >
              <View style={styles.technicianHeader}>
                <View style={styles.headerCopy}>
                  <Text style={[styles.technicianName, { color: palette.title }]}>
                    {technician.display_name || `Tecnico #${technician.id}`}
                  </Text>
                  <Text style={[styles.technicianMeta, { color: palette.textMuted }]}>
                    {technician.employee_code ? `${technician.employee_code} · ` : ""}
                    {linkedUser ? getWebUserLabel(linkedUser) : "Sin usuario vinculado"}
                  </Text>
                </View>
                <Text style={[styles.statusPill, { color: technician.is_active ? palette.successText : palette.warningText }]}>
                  {technician.is_active ? "Activo" : "Inactivo"}
                </Text>
              </View>

              <Text style={[styles.technicianMeta, { color: palette.textSecondary }]}>
                {technician.email || "Sin email"} · {technician.phone || "Sin telefono"}
              </Text>
              <Text style={[styles.technicianMeta, { color: palette.textSecondary }]}>
                {technician.active_assignment_count} asignaciones activas
              </Text>
              {technician.notes ? (
                <Text style={[styles.technicianMeta, { color: palette.textMuted }]}>{technician.notes}</Text>
              ) : null}

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
                  onPress={() => startEdit(technician)}
                  disabled={submitting}
                >
                  <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>Editar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryButton, { backgroundColor: palette.secondaryBg, borderColor: palette.inputBorder }]}
                  onPress={() => void toggleActive(technician)}
                  disabled={submitting}
                >
                  <Text style={[styles.secondaryButtonText, { color: palette.secondaryText }]}>
                    {technician.is_active ? "Desactivar" : "Activar"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      ) : !loading ? (
        <Text style={[styles.emptyText, { color: palette.textMuted }]}>
          Todavia no hay tecnicos cargados para este tenant.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 14,
    fontFamily: fontFamilies.bold,
  },
  description: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  primaryButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 13,
    fontFamily: fontFamilies.bold,
  },
  secondaryButton: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 110,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 13,
    fontFamily: fontFamilies.semibold,
  },
  editorCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  editorTitle: {
    fontSize: 13,
    fontFamily: fontFamilies.bold,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fontFamilies.regular,
  },
  notesInput: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  inlineCopy: {
    flex: 1,
    gap: 4,
  },
  inlineTitle: {
    fontSize: 12.5,
    fontFamily: fontFamilies.semibold,
  },
  inlineDescription: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  userPicker: {
    maxHeight: 220,
  },
  userOption: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  userOptionText: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  technicianCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  technicianHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  technicianName: {
    fontSize: 14,
    fontFamily: fontFamilies.bold,
  },
  technicianMeta: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  statusPill: {
    fontSize: 12,
    fontFamily: fontFamilies.semibold,
  },
  emptyText: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  disabled: {
    opacity: 0.6,
  },
});

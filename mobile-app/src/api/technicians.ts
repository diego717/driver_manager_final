import { getCurrentWebSession, type WebSessionUser } from "./webAuth";
import { assignedIncidentsMapRepository } from "../db/repositories/assigned-incidents-map-repository";
import { technicianAssignmentsCacheRepository } from "../db/repositories/technician-assignments-cache-repository";
import { type AssignedIncidentMapItem, type TechnicianAssignment, type TechnicianRecord } from "../types/api";
import { getStoredLinkedTechnician, setStoredLinkedTechnician } from "../storage/secure";
import { ensurePositiveInt } from "../utils/validation";
import { signedJsonRequest } from "./client";

interface TechniciansListResponse {
  success: boolean;
  technicians: TechnicianRecord[];
}

interface TechnicianMutationResponse {
  success: boolean;
  technician: TechnicianRecord;
}

interface TechnicianAssignmentsResponse {
  success: boolean;
  technician: TechnicianRecord;
  assignments: TechnicianAssignment[];
}

interface EntityAssignmentsResponse {
  success: boolean;
  entity_type: string;
  entity_id: string;
  assignments: TechnicianAssignment[];
}

interface CreateAssignmentResponse {
  success: boolean;
  assignment: TechnicianAssignment;
}

interface AssignedIncidentsMapResponse {
  success: boolean;
  technician: TechnicianRecord | null;
  incidents: AssignedIncidentMapItem[];
}

let lastLinkedTechnicianContextSource: "network" | "cache" = "network";
let lastTechnicianAssignmentsSource: "network" | "cache" = "network";
let lastAssignedIncidentsMapSource: "network" | "cache" = "network";

function normalizeOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function normalizeTechnicianRecord(record: TechnicianRecord): TechnicianRecord {
  return {
    ...record,
    id: Number(record.id),
    web_user_id: normalizePositiveNumber(record.web_user_id),
    tenant_id: normalizeOptionalString(record.tenant_id),
    display_name: normalizeOptionalString(record.display_name),
    email: normalizeOptionalString(record.email),
    phone: normalizeOptionalString(record.phone),
    employee_code: normalizeOptionalString(record.employee_code),
    notes: normalizeOptionalString(record.notes),
    is_active: Boolean(record.is_active),
    created_at: normalizeOptionalString(record.created_at),
    updated_at: normalizeOptionalString(record.updated_at),
    active_assignment_count: Math.max(0, Number(record.active_assignment_count || 0)),
  };
}

function normalizeTechnicianAssignment(assignment: TechnicianAssignment): TechnicianAssignment {
  return {
    ...assignment,
    id: Number(assignment.id),
    technician_id: Number(assignment.technician_id),
    tenant_id: normalizeOptionalString(assignment.tenant_id),
    entity_type: normalizeOptionalString(assignment.entity_type),
    entity_id: normalizeOptionalString(assignment.entity_id),
    assignment_role: normalizeOptionalString(assignment.assignment_role || "owner"),
    assigned_by_user_id: normalizePositiveNumber(assignment.assigned_by_user_id),
    assigned_by_username: normalizeOptionalString(assignment.assigned_by_username),
    assigned_at: normalizeOptionalString(assignment.assigned_at),
    unassigned_at:
      typeof assignment.unassigned_at === "string" && assignment.unassigned_at.trim()
        ? assignment.unassigned_at
        : null,
    metadata_json:
      typeof assignment.metadata_json === "string" && assignment.metadata_json.trim()
        ? assignment.metadata_json
        : null,
    technician_display_name: normalizeOptionalString(assignment.technician_display_name),
    technician_employee_code: normalizeOptionalString(assignment.technician_employee_code),
    technician_is_active:
      assignment.technician_is_active === null || assignment.technician_is_active === undefined
        ? null
        : Boolean(assignment.technician_is_active),
  };
}

function normalizeAssignedIncidentMapItem(item: AssignedIncidentMapItem): AssignedIncidentMapItem {
  const normalizeNullableNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    ...item,
    id: Number(item.id),
    installation_id: Number(item.installation_id),
    asset_id: normalizePositiveNumber(item.asset_id),
    note: normalizeOptionalString(item.note),
    severity: normalizeOptionalString(item.severity || "low").toLowerCase(),
    incident_status: normalizeOptionalString(item.incident_status || "open").toLowerCase(),
    created_at: normalizeOptionalString(item.created_at),
    target_lat: normalizeNullableNumber(item.target_lat),
    target_lng: normalizeNullableNumber(item.target_lng),
    target_label: normalizeOptionalString(item.target_label) || null,
    dispatch_place_name: normalizeOptionalString(item.dispatch_place_name) || null,
    dispatch_address: normalizeOptionalString(item.dispatch_address) || null,
    dispatch_reference: normalizeOptionalString(item.dispatch_reference) || null,
    dispatch_contact_name: normalizeOptionalString(item.dispatch_contact_name) || null,
    dispatch_contact_phone: normalizeOptionalString(item.dispatch_contact_phone) || null,
    dispatch_notes: normalizeOptionalString(item.dispatch_notes) || null,
    installation_client_name: normalizeOptionalString(item.installation_client_name) || null,
    installation_label: normalizeOptionalString(item.installation_label) || null,
    asset_code: normalizeOptionalString(item.asset_code) || null,
    assignment_role: normalizeOptionalString(item.assignment_role || "owner").toLowerCase(),
    assignment_source: normalizeOptionalString(item.assignment_source || "").toLowerCase() || null,
    assigned_at: normalizeOptionalString(item.assigned_at) || null,
  };
}

export async function listTechnicians(options?: {
  includeInactive?: boolean;
}): Promise<TechnicianRecord[]> {
  const query = new URLSearchParams();
  if (options?.includeInactive) {
    query.set("include_inactive", "1");
  }
  const suffix = query.toString();
  const response = await signedJsonRequest<TechniciansListResponse>({
    method: "GET",
    path: suffix ? `/technicians?${suffix}` : "/technicians",
  });
  return Array.isArray(response.technicians)
    ? response.technicians.map(normalizeTechnicianRecord)
    : [];
}

export async function createTechnician(payload: {
  displayName: string;
  employeeCode?: string;
  email?: string;
  phone?: string;
  notes?: string;
  webUserId?: number | null;
}): Promise<TechnicianRecord> {
  const response = await signedJsonRequest<TechnicianMutationResponse>({
    method: "POST",
    path: "/technicians",
    data: {
      display_name: normalizeOptionalString(payload.displayName),
      employee_code: normalizeOptionalString(payload.employeeCode),
      email: normalizeOptionalString(payload.email),
      phone: normalizeOptionalString(payload.phone),
      notes: normalizeOptionalString(payload.notes),
      web_user_id: payload.webUserId ?? null,
    },
  });
  return normalizeTechnicianRecord(response.technician);
}

export async function updateTechnician(
  technicianId: number,
  payload: {
    displayName?: string;
    employeeCode?: string;
    email?: string;
    phone?: string;
    notes?: string;
    webUserId?: number | null;
    isActive?: boolean;
  },
): Promise<TechnicianRecord> {
  ensurePositiveInt(technicianId, "technicianId");

  const data: Record<string, unknown> = {};
  if (payload.displayName !== undefined) data.display_name = normalizeOptionalString(payload.displayName);
  if (payload.employeeCode !== undefined) data.employee_code = normalizeOptionalString(payload.employeeCode);
  if (payload.email !== undefined) data.email = normalizeOptionalString(payload.email);
  if (payload.phone !== undefined) data.phone = normalizeOptionalString(payload.phone);
  if (payload.notes !== undefined) data.notes = normalizeOptionalString(payload.notes);
  if (payload.webUserId !== undefined) data.web_user_id = payload.webUserId;
  if (payload.isActive !== undefined) data.is_active = payload.isActive;

  const response = await signedJsonRequest<TechnicianMutationResponse>({
    method: "PATCH",
    path: `/technicians/${technicianId}`,
    data,
  });
  return normalizeTechnicianRecord(response.technician);
}

export async function getTechnicianAssignments(
  technicianId: number,
  options?: { includeInactive?: boolean },
): Promise<TechnicianAssignment[]> {
  ensurePositiveInt(technicianId, "technicianId");
  const query = new URLSearchParams();
  if (options?.includeInactive) {
    query.set("include_inactive", "1");
  }
  const suffix = query.toString();
  try {
    const response = await signedJsonRequest<TechnicianAssignmentsResponse>({
      method: "GET",
      path: suffix
        ? `/technicians/${technicianId}/assignments?${suffix}`
        : `/technicians/${technicianId}/assignments`,
    });
    const assignments = Array.isArray(response.assignments)
      ? response.assignments.map(normalizeTechnicianAssignment)
      : [];
    await technicianAssignmentsCacheRepository.replaceForTechnician(technicianId, assignments);
    lastTechnicianAssignmentsSource = "network";
    return assignments;
  } catch (error) {
    const cachedAssignments = await technicianAssignmentsCacheRepository.listByTechnicianId(technicianId);
    if (cachedAssignments.length > 0) {
      lastTechnicianAssignmentsSource = "cache";
      return cachedAssignments;
    }
    throw error;
  }
}

export async function getTechnicianAssignmentsByEntity(
  entityType: "installation" | "incident" | "asset" | "zone",
  entityId: number | string,
  options?: { includeInactive?: boolean },
): Promise<TechnicianAssignment[]> {
  const normalizedEntityId =
    entityType === "zone" ? normalizeOptionalString(entityId) : String(entityId);
  if (!normalizedEntityId) {
    throw new Error("entityId requerido.");
  }

  const query = new URLSearchParams({
    entity_type: entityType,
    entity_id: normalizedEntityId,
  });
  if (options?.includeInactive) {
    query.set("include_inactive", "1");
  }

  const response = await signedJsonRequest<EntityAssignmentsResponse>({
    method: "GET",
    path: `/technician-assignments?${query.toString()}`,
  });
  return Array.isArray(response.assignments)
    ? response.assignments.map(normalizeTechnicianAssignment)
    : [];
}

export async function getCurrentLinkedTechnicianContext(): Promise<{
  user: WebSessionUser;
  technician: TechnicianRecord | null;
}> {
  const session = await getCurrentWebSession();
  try {
    const technicians = await listTechnicians({ includeInactive: true });
    const linkedTechnician = technicians.find(
      (technician) =>
        technician.web_user_id !== null &&
        technician.web_user_id === normalizePositiveNumber(session.user.id),
    ) || null;

    await setStoredLinkedTechnician(linkedTechnician
      ? {
          id: linkedTechnician.id,
          tenantId: linkedTechnician.tenant_id,
          webUserId: linkedTechnician.web_user_id,
          displayName: linkedTechnician.display_name,
          employeeCode: linkedTechnician.employee_code || null,
          isActive: linkedTechnician.is_active,
        }
      : null);
    lastLinkedTechnicianContextSource = "network";

    return {
      user: session.user,
      technician: linkedTechnician,
    };
  } catch (error) {
    const cachedTechnician = await getStoredLinkedTechnician();
    if (cachedTechnician?.id) {
      lastLinkedTechnicianContextSource = "cache";
      return {
        user: session.user,
        technician: {
          id: cachedTechnician.id,
          tenant_id: cachedTechnician.tenantId || "",
          web_user_id: cachedTechnician.webUserId,
          display_name: cachedTechnician.displayName || "",
          employee_code: cachedTechnician.employeeCode || "",
          is_active: cachedTechnician.isActive !== false,
        },
      };
    }
    throw error;
  }
}

export async function listAssignedIncidentsMap(): Promise<{
  technician: TechnicianRecord | null;
  incidents: AssignedIncidentMapItem[];
}> {
  try {
    const response = await signedJsonRequest<AssignedIncidentsMapResponse>({
      method: "GET",
      path: "/me/assigned-incidents-map",
    });
    const technician = response.technician ? normalizeTechnicianRecord(response.technician) : null;
    const incidents = Array.isArray(response.incidents)
      ? response.incidents.map(normalizeAssignedIncidentMapItem)
      : [];
    await assignedIncidentsMapRepository.replaceAll(incidents);
    await setStoredLinkedTechnician(
      technician
        ? {
            id: technician.id,
            tenantId: technician.tenant_id,
            webUserId: technician.web_user_id,
            displayName: technician.display_name,
            employeeCode: technician.employee_code || null,
            isActive: technician.is_active,
          }
        : null,
    );
    lastAssignedIncidentsMapSource = "network";
    return {
      technician,
      incidents,
    };
  } catch (error) {
    const cachedIncidents = await assignedIncidentsMapRepository.listAll();
    const cachedTechnician = await getStoredLinkedTechnician();
    if (cachedIncidents.length > 0 || cachedTechnician?.id) {
      lastAssignedIncidentsMapSource = "cache";
      return {
        technician: cachedTechnician?.id
          ? {
              id: cachedTechnician.id,
              tenant_id: cachedTechnician.tenantId || "",
              web_user_id: cachedTechnician.webUserId,
              display_name: cachedTechnician.displayName || "",
              employee_code: cachedTechnician.employeeCode || "",
              is_active: cachedTechnician.isActive !== false,
            }
          : null,
        incidents: cachedIncidents,
      };
    }
    throw error;
  }
}

export function getLastLinkedTechnicianContextSource(): "network" | "cache" {
  return lastLinkedTechnicianContextSource;
}

export function getLastTechnicianAssignmentsSource(): "network" | "cache" {
  return lastTechnicianAssignmentsSource;
}

export function getLastAssignedIncidentsMapSource(): "network" | "cache" {
  return lastAssignedIncidentsMapSource;
}

export async function createTechnicianAssignment(
  technicianId: number,
  payload: {
    entityType: "installation" | "incident" | "asset" | "zone";
    entityId: number | string;
    assignmentRole?: "owner" | "assistant" | "reviewer";
  },
): Promise<TechnicianAssignment> {
  ensurePositiveInt(technicianId, "technicianId");
  const entityId =
    payload.entityType === "zone"
      ? normalizeOptionalString(payload.entityId)
      : String(payload.entityId);
  if (!entityId) {
    throw new Error("entityId requerido.");
  }

  const response = await signedJsonRequest<CreateAssignmentResponse>({
    method: "POST",
    path: `/technicians/${technicianId}/assignments`,
    data: {
      entity_type: payload.entityType,
      entity_id: entityId,
      assignment_role: payload.assignmentRole || "owner",
    },
  });

  return normalizeTechnicianAssignment(response.assignment);
}

export async function deleteTechnicianAssignment(
  assignmentId: number,
): Promise<TechnicianAssignment> {
  ensurePositiveInt(assignmentId, "assignmentId");
  const response = await signedJsonRequest<CreateAssignmentResponse>({
    method: "DELETE",
    path: `/technician-assignments/${assignmentId}`,
  });
  return normalizeTechnicianAssignment(response.assignment);
}

export type WebRole =
  | "admin"
  | "supervisor"
  | "tecnico"
  | "solo_lectura"
  | "super_admin"
  | "platform_owner";

export function normalizeWebRole(role: unknown, fallback: WebRole = "solo_lectura"): WebRole {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (!normalized) return fallback;
  if (normalized === "viewer") return "solo_lectura";
  if (
    normalized === "admin" ||
    normalized === "supervisor" ||
    normalized === "tecnico" ||
    normalized === "solo_lectura" ||
    normalized === "super_admin" ||
    normalized === "platform_owner"
  ) {
    return normalized;
  }
  return fallback;
}

export function canManagePlatform(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return normalized === "platform_owner" || normalized === "super_admin";
}

export function canManageUsers(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return normalized === "admin" || canManagePlatform(normalized);
}

export function canManageTechnicians(role: unknown): boolean {
  return canManageUsers(role);
}

export function canViewTechnicianCatalog(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return (
    normalized === "admin" ||
    normalized === "supervisor" ||
    normalized === "solo_lectura" ||
    canManagePlatform(normalized)
  );
}

export function canAssignTechnicians(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return normalized === "admin" || normalized === "supervisor" || canManagePlatform(normalized);
}

export function canWriteOperationalData(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return (
    normalized === "admin" ||
    normalized === "supervisor" ||
    normalized === "tecnico" ||
    canManagePlatform(normalized)
  );
}

export function canViewTenantIncidentMap(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return (
    normalized === "admin" ||
    normalized === "supervisor" ||
    normalized === "solo_lectura" ||
    canManagePlatform(normalized)
  );
}

export function canReopenIncidents(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return normalized === "admin" || normalized === "supervisor" || canManagePlatform(normalized);
}

export function canViewAssetCatalog(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return (
    normalized === "admin" ||
    normalized === "supervisor" ||
    normalized === "solo_lectura" ||
    canManagePlatform(normalized)
  );
}

export function canViewAssetDetail(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return normalized === "tecnico" || canViewAssetCatalog(normalized);
}

export function canEditAssetCatalog(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return normalized === "admin" || canManagePlatform(normalized);
}

export function canManageAssetLinks(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return normalized === "admin" || normalized === "supervisor" || canManagePlatform(normalized);
}

export function canManageAssetLoans(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return normalized === "admin" || normalized === "supervisor" || canManagePlatform(normalized);
}

export function canManagePublicTracking(role: unknown): boolean {
  const normalized = normalizeWebRole(role);
  return normalized === "admin" || normalized === "supervisor" || canManagePlatform(normalized);
}

export function canDeleteCriticalData(role: unknown): boolean {
  return canManagePlatform(role);
}

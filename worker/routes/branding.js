import {
  HttpError,
  canManageUsers,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
} from "../lib/core.js";

const DEFAULT_PRIMARY_COLOR = "#d97706";
const DEFAULT_SECONDARY_COLOR = "#b45309";
const LOGO_MAX_BYTES = 1024 * 1024;
const ALLOWED_LOGO_CONTENT_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
]);

function normalizeRgbHexColor(value, fallback) {
  const normalized = normalizeOptionalString(value, "").trim();
  if (!normalized) return fallback;
  const hex = normalized.startsWith("#") ? normalized : `#${normalized}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return hex.toLowerCase();
}

function normalizeStatusColors(value) {
  if (!value || typeof value !== "object") return {};
  const next = {};
  const acceptedKeys = ["success", "warning", "error", "info", "critical", "high", "medium", "low"];
  for (const key of acceptedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    next[key] = normalizeRgbHexColor(value[key], "");
    if (!next[key]) {
      delete next[key];
    }
  }
  return next;
}

function normalizeBrandingPayload(payload) {
  const raw = payload && typeof payload === "object" ? payload : {};
  return {
    display_name: normalizeOptionalString(raw.display_name, "").slice(0, 160),
    primary_color: normalizeRgbHexColor(raw.primary_color, DEFAULT_PRIMARY_COLOR),
    secondary_color: normalizeRgbHexColor(raw.secondary_color, DEFAULT_SECONDARY_COLOR),
    status_colors: normalizeStatusColors(raw.status_colors),
  };
}

function parseRawContentType(headerValue) {
  return normalizeOptionalString(headerValue, "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function buildLogoUrl(tenantId, updatedAt = "") {
  const cacheBust = normalizeOptionalString(updatedAt, "");
  const suffix = cacheBust ? `?tenant_id=${encodeURIComponent(tenantId)}&v=${encodeURIComponent(cacheBust)}` : `?tenant_id=${encodeURIComponent(tenantId)}`;
  return `/web/branding/logo${suffix}`;
}

async function loadTenantRow(env, tenantId) {
  const { results } = await env.DB.prepare(`
    SELECT id, name
    FROM tenants
    WHERE id = ?
    LIMIT 1
  `)
    .bind(tenantId)
    .all();
  return results?.[0] || null;
}

async function loadTenantBrandingRow(env, tenantId) {
  const { results } = await env.DB.prepare(`
    SELECT
      tenant_id,
      display_name,
      logo_key,
      primary_color,
      secondary_color,
      status_colors_json,
      updated_at,
      updated_by
    FROM tenant_branding
    WHERE tenant_id = ?
    LIMIT 1
  `)
    .bind(tenantId)
    .all();
  return results?.[0] || null;
}

function serializeTenantBranding(tenantId, tenantName, brandingRow) {
  const statusColorsRaw = normalizeOptionalString(brandingRow?.status_colors_json, "{}");
  let statusColors = {};
  try {
    const parsed = JSON.parse(statusColorsRaw);
    if (parsed && typeof parsed === "object") {
      statusColors = parsed;
    }
  } catch {
    statusColors = {};
  }

  const displayName = normalizeOptionalString(brandingRow?.display_name, "").trim()
    || normalizeOptionalString(tenantName, "").trim()
    || tenantId;
  const updatedAt = normalizeOptionalString(brandingRow?.updated_at, "");
  const logoKey = normalizeOptionalString(brandingRow?.logo_key, "");
  return {
    tenant_id: tenantId,
    display_name: displayName,
    logo_key: logoKey,
    logo_url: logoKey ? buildLogoUrl(tenantId, updatedAt) : "",
    primary_color: normalizeRgbHexColor(brandingRow?.primary_color, DEFAULT_PRIMARY_COLOR),
    secondary_color: normalizeRgbHexColor(brandingRow?.secondary_color, DEFAULT_SECONDARY_COLOR),
    status_colors: statusColors,
    updated_at: updatedAt,
    updated_by: normalizeOptionalString(brandingRow?.updated_by, ""),
  };
}

async function upsertTenantBranding(
  env,
  {
    tenantId,
    displayName,
    logoKey,
    primaryColor,
    secondaryColor,
    statusColorsJson,
    updatedAt,
    updatedBy,
  },
) {
  await env.DB.prepare(`
    INSERT INTO tenant_branding (
      tenant_id,
      display_name,
      logo_key,
      primary_color,
      secondary_color,
      status_colors_json,
      updated_at,
      updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      display_name = excluded.display_name,
      logo_key = excluded.logo_key,
      primary_color = excluded.primary_color,
      secondary_color = excluded.secondary_color,
      status_colors_json = excluded.status_colors_json,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `)
    .bind(
      tenantId,
      displayName,
      logoKey,
      primaryColor,
      secondaryColor,
      statusColorsJson,
      updatedAt,
      updatedBy,
    )
    .run();
}

export function createBrandingRouteHandlers({
  jsonResponse,
  corsHeaders,
  canManageAllTenants,
  assertSameTenantOrSuperAdmin,
  nowIso,
  logAuditEvent,
  getClientIpForRateLimit,
}) {
  async function handleBrandingRoute(
    request,
    env,
    url,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
  ) {
    if (!isWebRoute) {
      return null;
    }

    if (routeParts.length === 1 && routeParts[0] === "branding" && request.method === "GET") {
      const tenantId = normalizeRealtimeTenantId(webSession?.tenant_id);
      const tenantRow = await loadTenantRow(env, tenantId);
      if (!tenantRow) {
        throw new HttpError(404, "Tenant no encontrado.");
      }
      const brandingRow = await loadTenantBrandingRow(env, tenantId);
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        branding: serializeTenantBranding(tenantId, tenantRow.name, brandingRow),
      });
    }

    if (routeParts.length === 2 && routeParts[0] === "branding" && routeParts[1] === "logo" && request.method === "GET") {
      const requestedTenant = normalizeOptionalString(url.searchParams.get("tenant_id"), "");
      const ownTenantId = normalizeRealtimeTenantId(webSession?.tenant_id);
      const tenantId = requestedTenant ? normalizeRealtimeTenantId(requestedTenant) : ownTenantId;

      if (!canManageAllTenants(webSession)) {
        assertSameTenantOrSuperAdmin(webSession, tenantId);
      }

      const brandingRow = await loadTenantBrandingRow(env, tenantId);
      const logoKey = normalizeOptionalString(brandingRow?.logo_key, "");
      if (!logoKey) {
        throw new HttpError(404, "Logo no configurado para este tenant.");
      }

      if (!env.DRIVERS_BUCKET || typeof env.DRIVERS_BUCKET.get !== "function") {
        throw new HttpError(503, "Storage de branding no disponible.");
      }

      const object = await env.DRIVERS_BUCKET.get(logoKey);
      if (!object) {
        throw new HttpError(404, "Logo no encontrado en storage.");
      }

      const headers = new Headers({
        ...corsHeaders(request, env, corsPolicy),
        "Cache-Control": "public, max-age=300",
        "Content-Type": normalizeOptionalString(object?.httpMetadata?.contentType, "application/octet-stream"),
      });
      return new Response(object.body, {
        status: 200,
        headers,
      });
    }

    if (
      routeParts.length === 3 &&
      routeParts[0] === "tenants" &&
      routeParts[2] === "branding" &&
      (request.method === "PATCH" || request.method === "GET")
    ) {
      const tenantId = normalizeRealtimeTenantId(routeParts[1]);
      assertSameTenantOrSuperAdmin(webSession, tenantId);
      if (request.method === "PATCH" && !canManageUsers(webSession?.role)) {
        throw new HttpError(403, "No tienes permisos para editar branding del tenant.");
      }

      const tenantRow = await loadTenantRow(env, tenantId);
      if (!tenantRow) {
        throw new HttpError(404, "Tenant no encontrado.");
      }

      if (request.method === "GET") {
        const brandingRow = await loadTenantBrandingRow(env, tenantId);
        return jsonResponse(request, env, corsPolicy, {
          success: true,
          branding: serializeTenantBranding(tenantId, tenantRow.name, brandingRow),
        });
      }

      const payload = normalizeBrandingPayload(await request.json());
      const currentBranding = await loadTenantBrandingRow(env, tenantId);
      const updatedAt = nowIso();
      const updatedBy = normalizeOptionalString(webSession?.sub, "web");
      const logoKey = normalizeOptionalString(currentBranding?.logo_key, "");
      const displayName = payload.display_name || normalizeOptionalString(currentBranding?.display_name, "");

      await upsertTenantBranding(env, {
        tenantId,
        displayName,
        logoKey,
        primaryColor: payload.primary_color,
        secondaryColor: payload.secondary_color,
        statusColorsJson: JSON.stringify(payload.status_colors || {}),
        updatedAt,
        updatedBy,
      });
      const nextBranding = await loadTenantBrandingRow(env, tenantId);

      await logAuditEvent(env, {
        action: "tenant_branding_updated",
        username: updatedBy,
        success: true,
        tenantId,
        details: {
          tenant_id: tenantId,
          display_name: displayName,
          primary_color: payload.primary_color,
          secondary_color: payload.secondary_color,
        },
        ipAddress: getClientIpForRateLimit(request),
        platform: "web",
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        branding: serializeTenantBranding(tenantId, tenantRow.name, nextBranding),
      });
    }

    if (
      routeParts.length === 4 &&
      routeParts[0] === "tenants" &&
      routeParts[2] === "branding" &&
      routeParts[3] === "logo" &&
      request.method === "POST"
    ) {
      const tenantId = normalizeRealtimeTenantId(routeParts[1]);
      assertSameTenantOrSuperAdmin(webSession, tenantId);
      if (!canManageUsers(webSession?.role)) {
        throw new HttpError(403, "No tienes permisos para actualizar el logo del tenant.");
      }

      if (!env.DRIVERS_BUCKET || typeof env.DRIVERS_BUCKET.put !== "function") {
        throw new HttpError(503, "Storage de branding no disponible.");
      }

      const tenantRow = await loadTenantRow(env, tenantId);
      if (!tenantRow) {
        throw new HttpError(404, "Tenant no encontrado.");
      }

      const contentType = parseRawContentType(request.headers.get("content-type"));
      const extension = ALLOWED_LOGO_CONTENT_TYPES.get(contentType);
      if (!extension) {
        throw new HttpError(400, "Tipo de logo no permitido. Usa PNG, JPG, WEBP o SVG.");
      }

      const body = new Uint8Array(await request.arrayBuffer());
      if (!body.length) {
        throw new HttpError(400, "El logo esta vacio.");
      }
      if (body.byteLength > LOGO_MAX_BYTES) {
        throw new HttpError(413, "El logo supera el maximo permitido (1MB).");
      }

      const updatedAt = nowIso();
      const updatedBy = normalizeOptionalString(webSession?.sub, "web");
      const safeTimestamp = updatedAt.replace(/[^0-9]/g, "");
      const logoKey = `tenants/${tenantId}/branding/logo-${safeTimestamp}.${extension}`;
      await env.DRIVERS_BUCKET.put(logoKey, body, {
        httpMetadata: { contentType },
      });

      const currentBranding = await loadTenantBrandingRow(env, tenantId);
      await upsertTenantBranding(env, {
        tenantId,
        displayName: normalizeOptionalString(currentBranding?.display_name, ""),
        logoKey,
        primaryColor: normalizeRgbHexColor(currentBranding?.primary_color, DEFAULT_PRIMARY_COLOR),
        secondaryColor: normalizeRgbHexColor(currentBranding?.secondary_color, DEFAULT_SECONDARY_COLOR),
        statusColorsJson: normalizeOptionalString(currentBranding?.status_colors_json, "{}"),
        updatedAt,
        updatedBy,
      });
      const nextBranding = await loadTenantBrandingRow(env, tenantId);

      await logAuditEvent(env, {
        action: "tenant_branding_logo_updated",
        username: updatedBy,
        success: true,
        tenantId,
        details: {
          tenant_id: tenantId,
          logo_key: logoKey,
          content_type: contentType,
          size_bytes: body.byteLength,
        },
        ipAddress: getClientIpForRateLimit(request),
        platform: "web",
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        branding: serializeTenantBranding(tenantId, tenantRow.name, nextBranding),
      });
    }

    return null;
  }

  return {
    handleBrandingRoute,
  };
}

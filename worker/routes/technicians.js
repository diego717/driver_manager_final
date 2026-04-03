import { HttpError } from "../lib/core.js";

const TECHNICIAN_ASSIGNMENT_ENTITY_TYPES = new Set(["installation", "incident", "asset", "zone"]);
const TECHNICIAN_ASSIGNMENT_ROLES = new Set(["owner", "assistant", "reviewer"]);

export function createTechniciansRouteHandlers({
  jsonResponse,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  parsePositiveInt,
  readJsonOrThrowBadRequest,
  requireAdminRole,
  assertSameTenantOrSuperAdmin,
  logAuditEvent,
  getClientIpForRateLimit,
  nowIso,
  listDeviceTokensForUserIds,
  sendPushNotification,
}) {
  function parseBooleanQuery(value, fallback = false) {
    const normalized = normalizeOptionalString(value, "").toLowerCase();
    if (!normalized) return fallback;
    return ["1", "true", "yes", "on"].includes(normalized);
  }

  function requireAuthenticatedWebSession(isWebRoute, webSession) {
    if (!isWebRoute) {
      throw new HttpError(405, "Ruta disponible solo en /web.");
    }
    if (!webSession?.sub) {
      throw new HttpError(401, "Sesion web invalida.");
    }
  }

  function requireAssignmentManagerRole(role) {
    const normalizedRole = normalizeOptionalString(role, "").toLowerCase();
    if (!["admin", "super_admin", "supervisor"].includes(normalizedRole)) {
      throw new HttpError(403, "No tienes permisos para gestionar asignaciones de tecnicos.");
    }
  }

  function normalizeTechnicianPayload(body, { allowPartial = false } = {}) {
    const displayName = normalizeOptionalString(body?.display_name, "").slice(0, 160);
    const email = normalizeOptionalString(body?.email, "").slice(0, 180);
    const phone = normalizeOptionalString(body?.phone, "").slice(0, 80);
    const employeeCode = normalizeOptionalString(body?.employee_code, "").slice(0, 80);
    const notes = normalizeOptionalString(body?.notes, "").slice(0, 2000);
    const webUserIdRaw = body?.web_user_id;
    const isActiveRaw = body?.is_active;

    if (!allowPartial && !displayName) {
      throw new HttpError(400, "Campo 'display_name' es obligatorio.");
    }

    let webUserId = undefined;
    if (webUserIdRaw !== undefined) {
      if (webUserIdRaw === null || webUserIdRaw === "") {
        webUserId = null;
      } else {
        webUserId = parsePositiveInt(webUserIdRaw, "web_user_id");
      }
    }

    let isActive = undefined;
    if (isActiveRaw !== undefined) {
      isActive = Boolean(isActiveRaw);
    }

    return {
      displayName,
      email,
      phone,
      employeeCode,
      notes,
      webUserId,
      isActive,
    };
  }

  function normalizeAssignmentPayload(body) {
    const entityType = normalizeOptionalString(body?.entity_type, "").toLowerCase();
    const assignmentRole = normalizeOptionalString(body?.assignment_role, "owner").toLowerCase();
    const metadata =
      body?.metadata_json && typeof body.metadata_json === "object"
        ? JSON.stringify(body.metadata_json)
        : normalizeOptionalString(body?.metadata_json, "");

    if (!TECHNICIAN_ASSIGNMENT_ENTITY_TYPES.has(entityType)) {
      throw new HttpError(400, "Campo 'entity_type' invalido.");
    }
    if (!TECHNICIAN_ASSIGNMENT_ROLES.has(assignmentRole)) {
      throw new HttpError(400, "Campo 'assignment_role' invalido.");
    }

    let entityId = "";
    if (entityType === "zone") {
      entityId = normalizeOptionalString(body?.entity_id, "").slice(0, 120);
      if (!entityId) {
        throw new HttpError(400, "Campo 'entity_id' es obligatorio.");
      }
    } else {
      entityId = String(parsePositiveInt(body?.entity_id, "entity_id"));
    }

    return {
      entityType,
      entityId,
      assignmentRole,
      metadataJson: metadata || null,
    };
  }

  async function loadTechnicianById(env, technicianId, tenantId) {
    const { results } = await env.DB.prepare(`
      SELECT
        id,
        tenant_id,
        web_user_id,
        display_name,
        email,
        phone,
        employee_code,
        notes,
        is_active,
        created_at,
        updated_at
      FROM technicians
      WHERE id = ?
        AND tenant_id = ?
      LIMIT 1
    `)
      .bind(technicianId, tenantId)
      .all();
    return results?.[0] || null;
  }

  async function loadTechnicianByWebUserId(env, webUserId, tenantId) {
    const { results } = await env.DB.prepare(`
      SELECT
        id,
        tenant_id,
        web_user_id,
        display_name,
        email,
        phone,
        employee_code,
        notes,
        is_active,
        created_at,
        updated_at
      FROM technicians
      WHERE web_user_id = ?
        AND tenant_id = ?
      LIMIT 1
    `)
      .bind(webUserId, tenantId)
      .all();
    return results?.[0] || null;
  }

  async function ensureTenantScopedWebUser(env, userId, tenantId) {
    const { results } = await env.DB.prepare(`
      SELECT id, username, tenant_id, is_active
      FROM web_users
      WHERE id = ?
        AND tenant_id = ?
      LIMIT 1
    `)
      .bind(userId, tenantId)
      .all();
    return results?.[0] || null;
  }

  async function ensureAssignableEntityExists(env, tenantId, entityType, entityId) {
    if (entityType === "zone") return true;

    if (entityType === "installation") {
      const { results } = await env.DB.prepare(`
        SELECT id
        FROM installations
        WHERE id = ?
          AND tenant_id = ?
        LIMIT 1
      `)
        .bind(Number(entityId), tenantId)
        .all();
      return Boolean(results?.[0]);
    }

    if (entityType === "incident") {
      const { results } = await env.DB.prepare(`
        SELECT id
        FROM incidents
        WHERE id = ?
          AND tenant_id = ?
          AND deleted_at IS NULL
        LIMIT 1
      `)
        .bind(Number(entityId), tenantId)
        .all();
      return Boolean(results?.[0]);
    }

    if (entityType === "asset") {
      const { results } = await env.DB.prepare(`
        SELECT id
        FROM assets
        WHERE id = ?
          AND tenant_id = ?
        LIMIT 1
      `)
        .bind(Number(entityId), tenantId)
        .all();
      return Boolean(results?.[0]);
    }

    return false;
  }

  async function loadActiveAssignmentForTechnicianEntity(
    env,
    tenantId,
    technicianId,
    entityType,
    entityId,
    assignmentRole,
  ) {
    const { results } = await env.DB.prepare(`
      SELECT
        id,
        tenant_id,
        technician_id,
        entity_type,
        entity_id,
        assignment_role,
        assigned_by_user_id,
        assigned_by_username,
        assigned_at,
        unassigned_at,
        metadata_json
      FROM technician_assignments
      WHERE tenant_id = ?
        AND technician_id = ?
        AND entity_type = ?
        AND entity_id = ?
        AND assignment_role = ?
        AND unassigned_at IS NULL
      ORDER BY assigned_at DESC, id DESC
      LIMIT 1
    `)
      .bind(tenantId, technicianId, entityType, entityId, assignmentRole)
      .all();
    return results?.[0] || null;
  }

  async function loadIncidentAssignmentPushContext(env, tenantId, incidentId) {
    const { results } = await env.DB.prepare(`
      SELECT
        id,
        tenant_id,
        installation_id,
        severity,
        target_lat,
        target_lng,
        target_label,
        dispatch_place_name,
        dispatch_address,
        dispatch_reference
      FROM incidents
      WHERE id = ?
        AND tenant_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `)
      .bind(incidentId, tenantId)
      .all();
    return results?.[0] || null;
  }

  function buildIncidentAssignmentPushPayload({
    assignmentId,
    technicianId,
    assignmentRole,
    incident,
  }) {
    const incidentId = Number.parseInt(String(incident?.id || ""), 10);
    const installationId = Number.parseInt(String(incident?.installation_id || ""), 10);
    if (!Number.isInteger(incidentId) || incidentId <= 0 || !Number.isInteger(installationId) || installationId <= 0) {
      return null;
    }

    const placeName = normalizeOptionalString(incident?.dispatch_place_name, "");
    const address = normalizeOptionalString(incident?.dispatch_address, "");
    const reference = normalizeOptionalString(incident?.dispatch_reference, "");
    const label = normalizeOptionalString(incident?.target_label, "");
    const severity = normalizeOptionalString(incident?.severity, "");
    const targetLat = normalizeOptionalString(incident?.target_lat, "");
    const targetLng = normalizeOptionalString(incident?.target_lng, "");
    const role = normalizeOptionalString(assignmentRole, "owner");

    const contextLabel = placeName || address || label || `instalacion #${installationId}`;

    return {
      title: "Incidencia asignada",
      body: `Te asignaron la incidencia #${incidentId} en ${contextLabel}`,
      data: {
        path: `/incident/detail?incidentId=${incidentId}&installationId=${installationId}`,
        incidentId: String(incidentId),
        incident_id: String(incidentId),
        installationId: String(installationId),
        installation_id: String(installationId),
        technicianId: String(technicianId),
        technician_id: String(technicianId),
        assignmentId: String(assignmentId),
        assignment_id: String(assignmentId),
        assignmentRole: role,
        assignment_role: role,
        severity,
        targetLabel: label,
        target_label: label,
        targetLat,
        target_lat: targetLat,
        targetLng,
        target_lng: targetLng,
        dispatchPlaceName: placeName,
        dispatch_place_name: placeName,
        dispatchAddress: address,
        dispatch_address: address,
        dispatchReference: reference,
        dispatch_reference: reference,
      },
    };
  }

  function serializeTechnician(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      tenant_id: normalizeRealtimeTenantId(row.tenant_id),
      web_user_id: row.web_user_id === null || row.web_user_id === undefined ? null : Number(row.web_user_id),
      display_name: normalizeOptionalString(row.display_name, ""),
      email: normalizeOptionalString(row.email, ""),
      phone: normalizeOptionalString(row.phone, ""),
      employee_code: normalizeOptionalString(row.employee_code, ""),
      notes: normalizeOptionalString(row.notes, ""),
      is_active: Number(row.is_active) === 1,
      created_at: normalizeOptionalString(row.created_at, ""),
      updated_at: normalizeOptionalString(row.updated_at, ""),
      active_assignment_count: Number(row.active_assignment_count || 0),
    };
  }

  function serializeAssignment(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      tenant_id: normalizeRealtimeTenantId(row.tenant_id),
      technician_id: Number(row.technician_id),
      entity_type: normalizeOptionalString(row.entity_type, ""),
      entity_id: normalizeOptionalString(row.entity_id, ""),
      assignment_role: normalizeOptionalString(row.assignment_role, "owner"),
      assigned_by_user_id:
        row.assigned_by_user_id === null || row.assigned_by_user_id === undefined
          ? null
          : Number(row.assigned_by_user_id),
      assigned_by_username: normalizeOptionalString(row.assigned_by_username, ""),
      assigned_at: normalizeOptionalString(row.assigned_at, ""),
      unassigned_at: row.unassigned_at || null,
      metadata_json: row.metadata_json || null,
      technician_display_name: normalizeOptionalString(row.technician_display_name, ""),
      technician_employee_code: normalizeOptionalString(row.technician_employee_code, ""),
      technician_is_active:
        row.technician_is_active === null || row.technician_is_active === undefined
          ? null
          : Number(row.technician_is_active) === 1,
    };
  }

  function getAssignmentSourcePriority(value) {
    const normalized = normalizeOptionalString(value, "").toLowerCase();
    if (normalized === "incident") return 0;
    if (normalized === "installation") return 1;
    if (normalized === "asset") return 2;
    return 99;
  }

  function getAssignmentRolePriority(value) {
    const normalized = normalizeOptionalString(value, "owner").toLowerCase();
    if (normalized === "owner") return 0;
    if (normalized === "assistant") return 1;
    return 2;
  }

  function serializeAssignedIncidentMapRow(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      installation_id: Number(row.installation_id),
      asset_id:
        row.asset_id === null || row.asset_id === undefined
          ? null
          : Number(row.asset_id),
      note: normalizeOptionalString(row.note, ""),
      severity: normalizeOptionalString(row.severity, "low").toLowerCase(),
      incident_status: normalizeOptionalString(row.incident_status, "open").toLowerCase(),
      created_at: normalizeOptionalString(row.created_at, ""),
      target_lat:
        row.target_lat === null || row.target_lat === undefined
          ? null
          : Number(row.target_lat),
      target_lng:
        row.target_lng === null || row.target_lng === undefined
          ? null
          : Number(row.target_lng),
      target_label: normalizeOptionalString(row.target_label, "").trim() || null,
      dispatch_place_name: normalizeOptionalString(row.dispatch_place_name, "").trim() || null,
      dispatch_address: normalizeOptionalString(row.dispatch_address, "").trim() || null,
      dispatch_reference: normalizeOptionalString(row.dispatch_reference, "").trim() || null,
      dispatch_contact_name: normalizeOptionalString(row.dispatch_contact_name, "").trim() || null,
      dispatch_contact_phone: normalizeOptionalString(row.dispatch_contact_phone, "").trim() || null,
      dispatch_notes: normalizeOptionalString(row.dispatch_notes, "").trim() || null,
      installation_client_name:
        normalizeOptionalString(row.installation_client_name, "").trim() || null,
      installation_label:
        normalizeOptionalString(row.installation_label, "").trim() || null,
      asset_code: normalizeOptionalString(row.asset_code, "").trim() || null,
      assignment_role: normalizeOptionalString(row.assignment_role, "owner").toLowerCase(),
      assignment_source: normalizeOptionalString(row.assignment_source, "").toLowerCase() || null,
      assigned_at: normalizeOptionalString(row.assigned_at, "").trim() || null,
    };
  }

  async function loadAssignedIncidentsForTechnicianMap(env, tenantId, technicianId) {
    const { results } = await env.DB.prepare(`
      SELECT
        i.id,
        i.installation_id,
        i.asset_id,
        i.note,
        i.severity,
        i.incident_status,
        i.created_at,
        i.target_lat,
        i.target_lng,
        i.target_label,
        i.dispatch_place_name,
        i.dispatch_address,
        i.dispatch_reference,
        i.dispatch_contact_name,
        i.dispatch_contact_phone,
        i.dispatch_notes,
        inst.client_name AS installation_client_name,
        TRIM(
          COALESCE(inst.client_name, '') ||
          CASE
            WHEN NULLIF(TRIM(inst.driver_description), '') IS NOT NULL
              THEN ' · ' || TRIM(inst.driver_description)
            ELSE ''
          END
        ) AS installation_label,
        COALESCE(
          asset.external_code,
          (
            SELECT linked_asset.external_code
            FROM asset_installation_links links
            INNER JOIN assets linked_asset
              ON linked_asset.id = links.asset_id
             AND linked_asset.tenant_id = links.tenant_id
            WHERE links.installation_id = i.installation_id
              AND links.tenant_id = i.tenant_id
              AND links.unlinked_at IS NULL
            ORDER BY links.linked_at DESC, links.id DESC
            LIMIT 1
          )
        ) AS asset_code,
        ta.assignment_role,
        ta.entity_type AS assignment_source,
        ta.assigned_at
      FROM technician_assignments ta
      INNER JOIN incidents i
        ON (
          (ta.entity_type = 'incident' AND ta.entity_id = CAST(i.id AS TEXT))
          OR (ta.entity_type = 'installation' AND ta.entity_id = CAST(i.installation_id AS TEXT))
          OR (ta.entity_type = 'asset' AND i.asset_id IS NOT NULL AND ta.entity_id = CAST(i.asset_id AS TEXT))
        )
       AND i.tenant_id = ta.tenant_id
       AND i.deleted_at IS NULL
      INNER JOIN installations inst
        ON inst.id = i.installation_id
       AND inst.tenant_id = i.tenant_id
      LEFT JOIN assets asset
        ON asset.id = i.asset_id
       AND asset.tenant_id = i.tenant_id
      WHERE ta.tenant_id = ?
        AND ta.technician_id = ?
        AND ta.unassigned_at IS NULL
        AND ta.entity_type IN ('incident', 'installation', 'asset')
        AND LOWER(COALESCE(i.incident_status, 'open')) != 'resolved'
      ORDER BY
        CASE ta.entity_type
          WHEN 'incident' THEN 0
          WHEN 'installation' THEN 1
          ELSE 2
        END ASC,
        CASE ta.assignment_role
          WHEN 'owner' THEN 0
          WHEN 'assistant' THEN 1
          ELSE 2
        END ASC,
        i.created_at DESC,
        i.id DESC
    `)
      .bind(tenantId, technicianId)
      .all();

    const deduped = new Map();
    for (const row of results || []) {
      const incidentId = Number(row?.id);
      if (!Number.isInteger(incidentId) || incidentId <= 0) continue;
      const current = deduped.get(incidentId);
      if (!current) {
        deduped.set(incidentId, row);
        continue;
      }
      const nextPriority = getAssignmentSourcePriority(row?.assignment_source);
      const currentPriority = getAssignmentSourcePriority(current?.assignment_source);
      if (nextPriority < currentPriority) {
        deduped.set(incidentId, row);
        continue;
      }
      if (
        nextPriority === currentPriority &&
        getAssignmentRolePriority(row?.assignment_role) < getAssignmentRolePriority(current?.assignment_role)
      ) {
        deduped.set(incidentId, row);
      }
    }

    return Array.from(deduped.values()).map(serializeAssignedIncidentMapRow).filter(Boolean);
  }

  async function handleTechniciansRoute(
    request,
    env,
    url,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
  ) {
    if (
      routeParts.length === 2 &&
      routeParts[0] === "me" &&
      routeParts[1] === "assigned-incidents-map" &&
      request.method === "GET"
    ) {
      requireAuthenticatedWebSession(isWebRoute, webSession);
      const sessionTenantId = normalizeRealtimeTenantId(webSession?.tenant_id);
      const sessionUserId =
        Number.isInteger(webSession?.user_id) && Number(webSession.user_id) > 0
          ? Number(webSession.user_id)
          : null;
      if (!sessionUserId) {
        throw new HttpError(401, "Sesion web invalida.");
      }

      const technician = await loadTechnicianByWebUserId(env, sessionUserId, sessionTenantId);
      if (!technician) {
        return jsonResponse(request, env, corsPolicy, {
          success: true,
          technician: null,
          incidents: [],
        });
      }

      const incidents = await loadAssignedIncidentsForTechnicianMap(
        env,
        sessionTenantId,
        Number(technician.id),
      );

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        technician: serializeTechnician(technician),
        incidents,
      });
    }

    if (!routeParts.length || routeParts[0] !== "technicians") {
      return null;
    }

    requireAuthenticatedWebSession(isWebRoute, webSession);
    const sessionTenantId = normalizeRealtimeTenantId(webSession?.tenant_id);

    if (routeParts.length === 1 && request.method === "GET") {
      const includeInactive = parseBooleanQuery(url.searchParams.get("include_inactive"), false);
      const { results } = await env.DB.prepare(`
        SELECT
          t.id,
          t.tenant_id,
          t.web_user_id,
          t.display_name,
          t.email,
          t.phone,
          t.employee_code,
          t.notes,
          t.is_active,
          t.created_at,
          t.updated_at,
          (
            SELECT COUNT(*)
            FROM technician_assignments ta
            WHERE ta.technician_id = t.id
              AND ta.tenant_id = t.tenant_id
              AND ta.unassigned_at IS NULL
          ) AS active_assignment_count
        FROM technicians t
        WHERE t.tenant_id = ?
          AND (? = 1 OR t.is_active = 1)
        ORDER BY LOWER(t.display_name) ASC, t.id ASC
      `)
        .bind(sessionTenantId, includeInactive ? 1 : 0)
        .all();

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        technicians: (results || []).map((row) => serializeTechnician(row)),
      });
    }

    if (routeParts.length === 1 && request.method === "POST") {
      requireAdminRole(webSession?.role);
      const payload = normalizeTechnicianPayload(await readJsonOrThrowBadRequest(request));
      if (payload.webUserId !== undefined && payload.webUserId !== null) {
        const linkedUser = await ensureTenantScopedWebUser(env, payload.webUserId, sessionTenantId);
        if (!linkedUser) {
          throw new HttpError(404, "Usuario web vinculado no encontrado en este tenant.");
        }
      }

      const createdAt = nowIso();
      try {
        const result = await env.DB.prepare(`
          INSERT INTO technicians (
            tenant_id,
            web_user_id,
            display_name,
            email,
            phone,
            employee_code,
            notes,
            is_active,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `)
          .bind(
            sessionTenantId,
            payload.webUserId ?? null,
            payload.displayName,
            payload.email || null,
            payload.phone || null,
            payload.employeeCode || null,
            payload.notes || null,
            createdAt,
            createdAt,
          )
          .run();

        const technicianId = Number(result?.meta?.last_row_id || 0);
        const technician = await loadTechnicianById(env, technicianId, sessionTenantId);

        await logAuditEvent(env, {
          action: "technician_created",
          username: webSession.sub,
          success: true,
          tenantId: sessionTenantId,
          details: {
            technician_id: technicianId,
            display_name: payload.displayName,
            linked_web_user_id: payload.webUserId ?? null,
          },
          ipAddress: getClientIpForRateLimit(request),
          platform: "web",
        });

        return jsonResponse(request, env, corsPolicy, {
          success: true,
          technician: serializeTechnician(technician),
        }, 201);
      } catch (error) {
        const message = normalizeOptionalString(error?.message, "").toLowerCase();
        if (message.includes("unique constraint failed")) {
          throw new HttpError(409, "Ya existe un tecnico con ese codigo o usuario vinculado en este tenant.");
        }
        throw error;
      }
    }

    if (routeParts.length === 2 && request.method === "PATCH") {
      requireAdminRole(webSession?.role);
      const technicianId = parsePositiveInt(routeParts[1], "technician_id");
      const existing = await loadTechnicianById(env, technicianId, sessionTenantId);
      if (!existing) {
        throw new HttpError(404, "Tecnico no encontrado.");
      }
      assertSameTenantOrSuperAdmin(webSession, existing.tenant_id);

      const payload = normalizeTechnicianPayload(await readJsonOrThrowBadRequest(request), {
        allowPartial: true,
      });
      if (
        payload.displayName === "" &&
        payload.email === "" &&
        payload.phone === "" &&
        payload.employeeCode === "" &&
        payload.notes === "" &&
        payload.webUserId === undefined &&
        payload.isActive === undefined
      ) {
        throw new HttpError(400, "Debes enviar al menos un campo editable.");
      }
      if (payload.webUserId !== undefined && payload.webUserId !== null) {
        const linkedUser = await ensureTenantScopedWebUser(env, payload.webUserId, sessionTenantId);
        if (!linkedUser) {
          throw new HttpError(404, "Usuario web vinculado no encontrado en este tenant.");
        }
      }

      const updatedAt = nowIso();
      try {
        await env.DB.prepare(`
          UPDATE technicians
          SET
            web_user_id = ?,
            display_name = ?,
            email = ?,
            phone = ?,
            employee_code = ?,
            notes = ?,
            is_active = ?,
            updated_at = ?
          WHERE id = ?
            AND tenant_id = ?
        `)
          .bind(
            payload.webUserId !== undefined ? payload.webUserId : existing.web_user_id,
            payload.displayName || existing.display_name,
            payload.email !== "" ? payload.email : existing.email,
            payload.phone !== "" ? payload.phone : existing.phone,
            payload.employeeCode !== "" ? payload.employeeCode : existing.employee_code,
            payload.notes !== "" ? payload.notes : existing.notes,
            payload.isActive === undefined ? Number(existing.is_active) : payload.isActive ? 1 : 0,
            updatedAt,
            technicianId,
            sessionTenantId,
          )
          .run();
      } catch (error) {
        const message = normalizeOptionalString(error?.message, "").toLowerCase();
        if (message.includes("unique constraint failed")) {
          throw new HttpError(409, "Ya existe un tecnico con ese codigo o usuario vinculado en este tenant.");
        }
        throw error;
      }

      const updated = await loadTechnicianById(env, technicianId, sessionTenantId);
      await logAuditEvent(env, {
        action: "technician_updated",
        username: webSession.sub,
        success: true,
        tenantId: sessionTenantId,
        details: {
          technician_id: technicianId,
          display_name: updated?.display_name || existing.display_name,
        },
        ipAddress: getClientIpForRateLimit(request),
        platform: "web",
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        technician: serializeTechnician(updated),
      });
    }

    if (routeParts.length === 3 && routeParts[2] === "assignments" && request.method === "GET") {
      const technicianId = parsePositiveInt(routeParts[1], "technician_id");
      const technician = await loadTechnicianById(env, technicianId, sessionTenantId);
      if (!technician) {
        throw new HttpError(404, "Tecnico no encontrado.");
      }

      const activeOnly = !parseBooleanQuery(url.searchParams.get("include_inactive"), false);
      const { results } = await env.DB.prepare(`
        SELECT
          id,
          tenant_id,
          technician_id,
          entity_type,
          entity_id,
          assignment_role,
          assigned_by_user_id,
          assigned_by_username,
          assigned_at,
          unassigned_at,
          metadata_json
        FROM technician_assignments
        WHERE tenant_id = ?
          AND technician_id = ?
          AND (? = 0 OR unassigned_at IS NULL)
        ORDER BY assigned_at DESC, id DESC
      `)
        .bind(sessionTenantId, technicianId, activeOnly ? 1 : 0)
        .all();

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        technician: serializeTechnician(technician),
        assignments: (results || []).map((row) => serializeAssignment(row)),
      });
    }

    if (routeParts.length === 3 && routeParts[2] === "assignments" && request.method === "POST") {
      requireAssignmentManagerRole(webSession?.role);
      const technicianId = parsePositiveInt(routeParts[1], "technician_id");
      const technician = await loadTechnicianById(env, technicianId, sessionTenantId);
      if (!technician) {
        throw new HttpError(404, "Tecnico no encontrado.");
      }
      const payload = normalizeAssignmentPayload(await readJsonOrThrowBadRequest(request));
      const entityExists = await ensureAssignableEntityExists(
        env,
        sessionTenantId,
        payload.entityType,
        payload.entityId,
      );
      if (!entityExists) {
        throw new HttpError(404, "Entidad de asignacion no encontrada en este tenant.");
      }

      const existingAssignment = await loadActiveAssignmentForTechnicianEntity(
        env,
        sessionTenantId,
        technicianId,
        payload.entityType,
        payload.entityId,
        payload.assignmentRole,
      );
      if (existingAssignment) {
        return jsonResponse(request, env, corsPolicy, {
          success: true,
          already_exists: true,
          assignment: serializeAssignment(existingAssignment),
        });
      }

      const assignedAt = nowIso();
      const assignedByUserId =
        Number.isInteger(webSession?.user_id) && Number(webSession.user_id) > 0
          ? Number(webSession.user_id)
          : null;
      const result = await env.DB.prepare(`
        INSERT INTO technician_assignments (
          tenant_id,
          technician_id,
          entity_type,
          entity_id,
          assignment_role,
          assigned_by_user_id,
          assigned_by_username,
          assigned_at,
          metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          sessionTenantId,
          technicianId,
          payload.entityType,
          payload.entityId,
          payload.assignmentRole,
          assignedByUserId,
          webSession.sub,
          assignedAt,
          payload.metadataJson,
        )
        .run();

      const assignmentId = Number(result?.meta?.last_row_id || 0);
      const { results } = await env.DB.prepare(`
        SELECT
          id,
          tenant_id,
          technician_id,
          entity_type,
          entity_id,
          assignment_role,
          assigned_by_user_id,
          assigned_by_username,
          assigned_at,
          unassigned_at,
          metadata_json
        FROM technician_assignments
        WHERE id = ?
          AND tenant_id = ?
        LIMIT 1
      `)
        .bind(assignmentId, sessionTenantId)
        .all();

      await logAuditEvent(env, {
        action: "technician_assignment_created",
        username: webSession.sub,
        success: true,
        tenantId: sessionTenantId,
        details: {
          assignment_id: assignmentId,
          technician_id: technicianId,
          entity_type: payload.entityType,
          entity_id: payload.entityId,
          assignment_role: payload.assignmentRole,
        },
        ipAddress: getClientIpForRateLimit(request),
        platform: "web",
      });

      if (
        payload.entityType === "incident" &&
        technician?.web_user_id !== null &&
        technician?.web_user_id !== undefined
      ) {
        try {
          const incident = await loadIncidentAssignmentPushContext(
            env,
            sessionTenantId,
            Number.parseInt(payload.entityId, 10),
          );
          const notification = buildIncidentAssignmentPushPayload({
            assignmentId,
            technicianId,
            assignmentRole: payload.assignmentRole,
            incident,
          });
          if (notification) {
            const fcmTokens = await listDeviceTokensForUserIds(
              env,
              [Number(technician.web_user_id)],
              sessionTenantId,
            );
            if (fcmTokens.length > 0) {
              await sendPushNotification(env, fcmTokens, notification);
            }
          }
        } catch {
          // Best effort: una falla de push no debe impedir registrar la asignacion.
        }
      }

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        assignment: serializeAssignment(results?.[0] || null),
      }, 201);
    }

    return null;
  }

  async function handleTechnicianAssignmentsRoute(
    request,
    env,
    url,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
  ) {
    if (!routeParts.length || routeParts[0] !== "technician-assignments") {
      return null;
    }

    requireAuthenticatedWebSession(isWebRoute, webSession);
    const sessionTenantId = normalizeRealtimeTenantId(webSession?.tenant_id);

    if (routeParts.length === 1 && request.method === "GET") {
      const entityType = normalizeOptionalString(url.searchParams.get("entity_type"), "").toLowerCase();
      if (!TECHNICIAN_ASSIGNMENT_ENTITY_TYPES.has(entityType)) {
        throw new HttpError(400, "Parametro 'entity_type' invalido.");
      }

      let entityId = "";
      if (entityType === "zone") {
        entityId = normalizeOptionalString(url.searchParams.get("entity_id"), "").slice(0, 120);
        if (!entityId) {
          throw new HttpError(400, "Parametro 'entity_id' es obligatorio.");
        }
      } else {
        entityId = String(parsePositiveInt(url.searchParams.get("entity_id"), "entity_id"));
      }

      const activeOnly = !parseBooleanQuery(url.searchParams.get("include_inactive"), false);
      const { results } = await env.DB.prepare(`
        SELECT
          ta.id,
          ta.tenant_id,
          ta.technician_id,
          ta.entity_type,
          ta.entity_id,
          ta.assignment_role,
          ta.assigned_by_user_id,
          ta.assigned_by_username,
          ta.assigned_at,
          ta.unassigned_at,
          ta.metadata_json,
          t.display_name AS technician_display_name,
          t.employee_code AS technician_employee_code,
          t.is_active AS technician_is_active
        FROM technician_assignments ta
        INNER JOIN technicians t
          ON t.id = ta.technician_id
         AND t.tenant_id = ta.tenant_id
        WHERE ta.tenant_id = ?
          AND ta.entity_type = ?
          AND ta.entity_id = ?
          AND (? = 0 OR ta.unassigned_at IS NULL)
          AND (? = 0 OR t.is_active = 1)
        ORDER BY
          CASE ta.assignment_role
            WHEN 'owner' THEN 0
            WHEN 'assistant' THEN 1
            ELSE 2
          END ASC,
          LOWER(COALESCE(t.display_name, '')) ASC,
          ta.assigned_at DESC,
          ta.id DESC
      `)
        .bind(sessionTenantId, entityType, entityId, activeOnly ? 1 : 0, activeOnly ? 1 : 0)
        .all();

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        entity_type: entityType,
        entity_id: entityId,
        assignments: (results || []).map((row) => serializeAssignment(row)),
      });
    }

    if (routeParts.length !== 2) {
      return null;
    }

    requireAssignmentManagerRole(webSession?.role);

    if (request.method !== "DELETE") {
      return null;
    }

    const assignmentId = parsePositiveInt(routeParts[1], "assignment_id");
    const { results } = await env.DB.prepare(`
      SELECT
        id,
        tenant_id,
        technician_id,
        entity_type,
        entity_id,
        assignment_role,
        assigned_by_user_id,
        assigned_by_username,
        assigned_at,
        unassigned_at,
        metadata_json
      FROM technician_assignments
      WHERE id = ?
        AND tenant_id = ?
      LIMIT 1
    `)
      .bind(assignmentId, sessionTenantId)
      .all();
    const existing = results?.[0] || null;
    if (!existing) {
      throw new HttpError(404, "Asignacion no encontrada.");
    }

    const unassignedAt = nowIso();
    await env.DB.prepare(`
      UPDATE technician_assignments
      SET unassigned_at = ?
      WHERE id = ?
        AND tenant_id = ?
        AND unassigned_at IS NULL
    `)
      .bind(unassignedAt, assignmentId, sessionTenantId)
      .run();

    await logAuditEvent(env, {
      action: "technician_assignment_removed",
      username: webSession.sub,
      success: true,
      tenantId: sessionTenantId,
      details: {
        assignment_id: assignmentId,
        technician_id: Number(existing.technician_id),
        entity_type: existing.entity_type,
        entity_id: existing.entity_id,
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web",
    });

    return jsonResponse(request, env, corsPolicy, {
      success: true,
      assignment: {
        ...serializeAssignment(existing),
        unassigned_at: unassignedAt,
      },
    });
  }

  return {
    handleTechniciansRoute,
    handleTechnicianAssignmentsRoute,
  };
}

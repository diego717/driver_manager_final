import {
  HttpError,
  isMissingIncidentDispatchColumnsError,
  isMissingIncidentReadModelColumnsError,
  isIncidentStatusConstraintError,
  isMissingIncidentSoftDeleteColumnsError,
} from "../lib/core.js";
import { gpsBindValues, normalizeGpsPayload } from "../lib/gps.js";

export function createIncidentsRouteHandlers({
  jsonResponse,
  parsePositiveInt,
  requireWebWriteRole,
  requireSuperAdminRole,
  readJsonOrThrowBadRequest,
  validateIncidentPayload,
  parseOptionalPositiveInt,
  nowIso,
  isMissingIncidentAssetColumnError,
  isMissingIncidentTimingColumnsError,
  normalizeIncidentEvidencePayload,
  normalizeIncidentStatusPayload,
  loadIncidentForTenant,
  loadIncidentTimingFieldsForTenant,
  parseIncidentChecklistItems,
  normalizeOptionalString,
  listDeviceTokensForWebRoles,
  criticalIncidentPushRoles,
  sendPushNotification,
  logAuditEvent,
  getClientIpForRateLimit,
  mapIncidentRow,
  publishRealtimeEvent,
  publishRealtimeStatsUpdate,
  allowedPhotoTypes,
  normalizeContentType,
  validateAndProcessPhoto,
  requireIncidentsBucketOperation,
  loadIncidentByIdForTenant,
  extensionFromType,
  resolveIncidentPhotoMetadata,
  buildIncidentPhotoDescriptor,
  buildIncidentPhotoFileName,
  buildIncidentR2Key,
  sha256Hex,
  loadIncidentPhotoByIdForTenant,
  recoverIncidentPhotosFromStorageForTenant,
  sanitizeFileName,
  corsHeaders,
  syncPublicTrackingSnapshotForInstallation,
}) {
  const ALLOWED_TARGET_SOURCES = new Set([
    "manual_map",
    "reporter_gps",
    "installation_gps",
    "asset_context",
    "mobile_adjustment",
  ]);

  function normalizeDispatchTargetPayload(data) {
    if (!data || typeof data !== "object") {
      throw new HttpError(400, "Payload invalido.");
    }

    const hasField = (field) => Object.prototype.hasOwnProperty.call(data, field);
    const editableFields = [
      "target_lat",
      "target_lng",
      "target_label",
      "target_source",
      "dispatch_required",
      "dispatch_place_name",
      "dispatch_address",
      "dispatch_reference",
      "dispatch_contact_name",
      "dispatch_contact_phone",
      "dispatch_notes",
    ];

    if (!editableFields.some((field) => hasField(field))) {
      throw new HttpError(400, "Debes enviar al menos un campo de destino operativo.");
    }

    const parseOptionalCoordinate = (value, label, min, max) => {
      if (value === undefined) return undefined;
      if (value === null || value === "") return null;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        throw new HttpError(400, `Campo '${label}' invalido.`);
      }
      return parsed;
    };

    const normalizeOptionalTextField = (value, label, maxLength) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const normalized = normalizeOptionalString(value, "").trim();
      if (normalized.length > maxLength) {
        throw new HttpError(400, `Campo '${label}' supera el limite permitido.`);
      }
      return normalized || null;
    };

    const targetLat = parseOptionalCoordinate(data.target_lat, "target_lat", -90, 90);
    const targetLng = parseOptionalCoordinate(data.target_lng, "target_lng", -180, 180);

    if (
      (targetLat !== undefined || targetLng !== undefined) &&
      ((targetLat === null) !== (targetLng === null) ||
        (targetLat !== null && targetLng === null) ||
        (targetLng !== null && targetLat === null))
    ) {
      throw new HttpError(400, "target_lat y target_lng deben enviarse juntos.");
    }

    let targetSource = undefined;
    if (hasField("target_source")) {
      const normalizedSource = normalizeOptionalString(data.target_source, "").toLowerCase();
      if (!normalizedSource) {
        targetSource = null;
      } else if (!ALLOWED_TARGET_SOURCES.has(normalizedSource)) {
        throw new HttpError(400, "Campo 'target_source' invalido.");
      } else {
        targetSource = normalizedSource;
      }
    }

    const parseOptionalBooleanField = (value, label) => {
      if (value === undefined) return undefined;
      if (value === null || value === "") return false;
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0;
      const normalized = normalizeOptionalString(value, "").toLowerCase();
      if (["1", "true", "yes", "on", "required"].includes(normalized)) return true;
      if (["0", "false", "no", "off", "optional", "not_required"].includes(normalized)) return false;
      throw new HttpError(400, `Campo '${label}' invalido.`);
    };

    return {
      targetLat,
      targetLng,
      targetLabel: normalizeOptionalTextField(data.target_label, "target_label", 180),
      targetSource,
      dispatchRequired: parseOptionalBooleanField(data.dispatch_required, "dispatch_required"),
      dispatchPlaceName: normalizeOptionalTextField(
        data.dispatch_place_name,
        "dispatch_place_name",
        180,
      ),
      dispatchAddress: normalizeOptionalTextField(
        data.dispatch_address,
        "dispatch_address",
        255,
      ),
      dispatchReference: normalizeOptionalTextField(
        data.dispatch_reference,
        "dispatch_reference",
        500,
      ),
      dispatchContactName: normalizeOptionalTextField(
        data.dispatch_contact_name,
        "dispatch_contact_name",
        180,
      ),
      dispatchContactPhone: normalizeOptionalTextField(
        data.dispatch_contact_phone,
        "dispatch_contact_phone",
        80,
      ),
      dispatchNotes: normalizeOptionalTextField(data.dispatch_notes, "dispatch_notes", 2000),
    };
  }

  async function handleIncidentMapRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    incidentsTenantId,
  ) {
    if (!(routeParts.length === 2 && routeParts[0] === "incidents" && routeParts[1] === "map")) {
      return null;
    }
    if (request.method !== "GET") {
      return null;
    }

    try {
      const url = new URL(request.url);
      const daysRaw = normalizeOptionalString(url.searchParams.get("days"), "30").toLowerCase();
      const status = normalizeOptionalString(url.searchParams.get("status"), "").toLowerCase();
      const severity = normalizeOptionalString(url.searchParams.get("severity"), "").toLowerCase();
      const parsedLimit = Number.parseInt(
        normalizeOptionalString(url.searchParams.get("limit"), "240"),
        10,
      );
      const limit = Number.isInteger(parsedLimit)
        ? Math.min(500, Math.max(25, parsedLimit))
        : 240;

      const allowedStatuses = new Set(["open", "in_progress", "paused", "resolved"]);
      const allowedSeverities = new Set(["low", "medium", "high", "critical"]);
      if (status && !allowedStatuses.has(status)) {
        throw new HttpError(400, "Filtro de estado invalido.");
      }
      if (severity && !allowedSeverities.has(severity)) {
        throw new HttpError(400, "Filtro de severidad invalido.");
      }

      const parsedDays =
        daysRaw && daysRaw !== "all"
          ? Number.parseInt(daysRaw, 10)
          : null;
      if (daysRaw && daysRaw !== "all" && (!Number.isInteger(parsedDays) || parsedDays <= 0)) {
        throw new HttpError(400, "Filtro de dias invalido.");
      }

      const loadIncidentMapRows = async (includeDispatchTargetColumns = true) => {
        const conditions = [
          "i.tenant_id = ?",
          "i.deleted_at IS NULL",
          includeDispatchTargetColumns
            ? `(
              (i.target_lat IS NOT NULL AND i.target_lng IS NOT NULL)
              OR
              (i.gps_capture_status = ? AND i.gps_lat IS NOT NULL AND i.gps_lng IS NOT NULL)
            )`
            : "(i.gps_capture_status = ? AND i.gps_lat IS NOT NULL AND i.gps_lng IS NOT NULL)",
        ];
        const bindings = [incidentsTenantId, "captured"];

        if (parsedDays !== null) {
          conditions.push(`i.created_at >= datetime('now', ?)`);
          bindings.push(`-${parsedDays} days`);
        }

        if (status) {
          conditions.push("i.incident_status = ?");
          bindings.push(status);
        }
        if (severity) {
          conditions.push("i.severity = ?");
          bindings.push(severity);
        }

        const dispatchTargetColumns = includeDispatchTargetColumns
          ? `
          i.target_lat,
          i.target_lng,
          i.target_label,
          i.target_source,
          i.target_updated_at,
          i.target_updated_by,
          i.dispatch_required,
          i.dispatch_place_name,
          i.dispatch_address,
          i.dispatch_reference,
          i.dispatch_contact_name,
          i.dispatch_contact_phone,
          i.dispatch_notes,`
          : `
          NULL AS target_lat,
          NULL AS target_lng,
          NULL AS target_label,
          NULL AS target_source,
          NULL AS target_updated_at,
          NULL AS target_updated_by,
          1 AS dispatch_required,
          NULL AS dispatch_place_name,
          NULL AS dispatch_address,
          NULL AS dispatch_reference,
          NULL AS dispatch_contact_name,
          NULL AS dispatch_contact_phone,
          NULL AS dispatch_notes,`;

        return env.DB.prepare(`
          SELECT
            i.id,
            i.installation_id,
            i.asset_id,
            i.reporter_username,
            i.note,
            i.time_adjustment_seconds,
            i.estimated_duration_seconds,
            i.severity,
            i.source,
            i.created_at,
            i.incident_status,
            i.status_updated_at,
            i.status_updated_by,
            i.resolved_at,
            i.resolved_by,
            i.resolution_note,
            i.checklist_json,
            i.evidence_note,
            i.work_started_at,
            i.work_ended_at,
            i.actual_duration_seconds,
            i.gps_lat,
            i.gps_lng,
            i.gps_accuracy_m,
            i.gps_captured_at,
            i.gps_capture_source,
            i.gps_capture_status,
            i.gps_capture_note,${dispatchTargetColumns}
            inst.client_name AS installation_client_name,
            inst.driver_brand AS installation_brand,
            inst.driver_version AS installation_version,
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
            COALESCE(
              asset.brand,
              (
                SELECT linked_asset.brand
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
            ) AS asset_brand,
            COALESCE(
              asset.model,
              (
                SELECT linked_asset.model
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
            ) AS asset_model
          FROM incidents i
          INNER JOIN installations inst
            ON inst.id = i.installation_id
           AND inst.tenant_id = i.tenant_id
          LEFT JOIN assets asset
            ON asset.id = i.asset_id
           AND asset.tenant_id = i.tenant_id
          WHERE ${conditions.join("\n            AND ")}
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT ?
        `)
          .bind(...bindings, limit)
          .all();
      };

      let queryResult;
      try {
        queryResult = await loadIncidentMapRows(true);
      } catch (error) {
        if (!isMissingIncidentDispatchColumnsError(error)) {
          throw error;
        }
        queryResult = await loadIncidentMapRows(false);
      }

      const incidents = (queryResult?.results || []).map((incident) => mapIncidentRow(incident, []));
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        incidents,
      });
    } catch (error) {
      if (isMissingIncidentReadModelColumnsError(error)) {
        throw new HttpError(
          500,
          "La tabla incidents no tiene las migraciones de GPS/destino operativo aplicadas. Ejecuta 0017_geolocation_capture.sql, 0023_incident_dispatch_target.sql y 0024_incident_dispatch_required.sql.",
        );
      }
      throw error;
    }
  }

  function resolveIncidentActorUsername(isWebRoute, webSession, data) {
    return normalizeOptionalString(
      isWebRoute ? webSession?.sub : data?.reporter_username || data?.username,
      isWebRoute ? "web" : "api",
    );
  }

  function enforceIncidentPatchAccess(
    request,
    isWebRoute,
    webSession,
    methodNotAllowedMessage,
  ) {
    if (request.method !== "PATCH") {
      throw new HttpError(405, methodNotAllowedMessage);
    }
    if (isWebRoute) {
      requireWebWriteRole(webSession?.role);
    }
  }

  async function loadIncidentPhotosForTenant(env, incidentId, incidentsTenantId) {
    let { results: photos } = await env.DB.prepare(`
      SELECT p.id, p.incident_id, p.r2_key, p.file_name, p.content_type, p.size_bytes, p.sha256, p.created_at
      FROM incident_photos p
      INNER JOIN incidents i ON i.id = p.incident_id
      WHERE p.incident_id = ?
        AND i.tenant_id = ?
        AND i.deleted_at IS NULL
      ORDER BY p.created_at ASC, p.id ASC
    `)
      .bind(incidentId, incidentsTenantId)
      .all();

    if ((!photos || photos.length === 0) && incidentId > 0) {
      const incident = await loadIncidentByIdForTenant(env, incidentId, incidentsTenantId);
      if (incident) {
        const recoveredCount = await recoverIncidentPhotosFromStorageForTenant?.(
          env,
          [incident],
          incidentsTenantId,
        );
        if (Number(recoveredCount) > 0) {
          const recoveredPhotosResult = await env.DB.prepare(`
            SELECT p.id, p.incident_id, p.r2_key, p.file_name, p.content_type, p.size_bytes, p.sha256, p.created_at
            FROM incident_photos p
            INNER JOIN incidents i ON i.id = p.incident_id
            WHERE p.incident_id = ?
              AND i.tenant_id = ?
              AND i.deleted_at IS NULL
            ORDER BY p.created_at ASC, p.id ASC
          `)
            .bind(incidentId, incidentsTenantId)
            .all();
          photos = recoveredPhotosResult?.results || [];
        }
      }
    }

    return photos || [];
  }

  async function handleIncidentDetailRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    incidentsTenantId,
  ) {
    if (!(routeParts.length === 2 && routeParts[0] === "incidents" && request.method === "GET")) {
      return null;
    }

    const incidentId = parsePositiveInt(routeParts[1], "incident_id");
    try {
      const { results } = await env.DB.prepare(`
        SELECT
          id,
          installation_id,
          asset_id,
          reporter_username,
          note,
          time_adjustment_seconds,
          estimated_duration_seconds,
          severity,
          source,
          created_at,
          incident_status,
          status_updated_at,
          status_updated_by,
          resolved_at,
          resolved_by,
          resolution_note,
          checklist_json,
          evidence_note,
          work_started_at,
          work_ended_at,
          actual_duration_seconds,
          gps_lat,
          gps_lng,
          gps_accuracy_m,
          gps_captured_at,
          gps_capture_source,
          gps_capture_status,
          gps_capture_note,
          target_lat,
          target_lng,
          target_label,
          target_source,
          target_updated_at,
          target_updated_by,
          dispatch_required,
          dispatch_place_name,
          dispatch_address,
          dispatch_reference,
          dispatch_contact_name,
          dispatch_contact_phone,
          dispatch_notes,
          deleted_at,
          deleted_by,
          deletion_reason
        FROM incidents
        WHERE id = ?
          AND tenant_id = ?
          AND deleted_at IS NULL
        LIMIT 1
      `)
        .bind(incidentId, incidentsTenantId)
        .all();

      const incident = results?.[0] || null;
      if (!incident) {
        throw new HttpError(404, "Incidencia no encontrada.");
      }

      const photos = await loadIncidentPhotosForTenant(env, incidentId, incidentsTenantId);
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        incident: mapIncidentRow(incident, photos),
      });
    } catch (error) {
      if (isMissingIncidentReadModelColumnsError(error)) {
        throw new HttpError(
          500,
          "La tabla incidents no tiene las migraciones de GPS/destino operativo aplicadas. Ejecuta 0017_geolocation_capture.sql, 0023_incident_dispatch_target.sql y 0024_incident_dispatch_required.sql.",
        );
      }
      throw error;
    }
  }

  async function handleInstallationIncidentsRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    incidentsTenantId,
    realtimeTenantId,
  ) {
    if (
      routeParts.length === 3 &&
      routeParts[0] === "installations" &&
      routeParts[2] === "incidents"
    ) {
      const installationId = parsePositiveInt(routeParts[1], "installation_id");

      if (request.method === "GET") {
        const includeDeletedRaw = normalizeOptionalString(
          new URL(request.url).searchParams.get("include_deleted"),
          "",
        ).toLowerCase();
        const includeDeleted = includeDeletedRaw === "1" || includeDeletedRaw === "true";
        if (includeDeleted) {
          if (!isWebRoute) {
            throw new HttpError(403, "Solo super_admin puede ver incidencias eliminadas.");
          }
          requireSuperAdminRole(webSession?.role);
        }

        try {
          const incidentsQuery = `
            SELECT
              id,
              installation_id,
              asset_id,
              reporter_username,
              note,
              time_adjustment_seconds,
              estimated_duration_seconds,
              severity,
              source,
              created_at,
              incident_status,
              status_updated_at,
              status_updated_by,
              resolved_at,
              resolved_by,
              resolution_note,
              checklist_json,
              evidence_note,
              work_started_at,
              work_ended_at,
              actual_duration_seconds,
              gps_lat,
              gps_lng,
              gps_accuracy_m,
              gps_captured_at,
              gps_capture_source,
              gps_capture_status,
              gps_capture_note,
              target_lat,
              target_lng,
              target_label,
              target_source,
              target_updated_at,
              target_updated_by,
              dispatch_required,
              dispatch_place_name,
              dispatch_address,
              dispatch_reference,
              dispatch_contact_name,
              dispatch_contact_phone,
              dispatch_notes,
              deleted_at,
              deleted_by,
              deletion_reason
            FROM incidents
            WHERE installation_id = ?
              AND tenant_id = ?
              ${includeDeleted ? "" : "AND deleted_at IS NULL"}
            ORDER BY created_at DESC, id DESC
          `;
          const { results: incidents } = await env.DB.prepare(incidentsQuery)
            .bind(installationId, incidentsTenantId)
            .all();

          const photosQuery = `
            SELECT p.id, p.incident_id, p.r2_key, p.file_name, p.content_type, p.size_bytes, p.sha256, p.created_at
            FROM incident_photos p
            INNER JOIN incidents i ON i.id = p.incident_id
            WHERE i.installation_id = ?
              AND i.tenant_id = ?
              ${includeDeleted ? "" : "AND i.deleted_at IS NULL"}
            ORDER BY p.created_at ASC, p.id ASC
          `;
          let { results: photos } = await env.DB.prepare(photosQuery)
            .bind(installationId, incidentsTenantId)
            .all();

          if ((!photos || photos.length === 0) && incidents.length > 0) {
            const recoveredCount = await recoverIncidentPhotosFromStorageForTenant?.(
              env,
              incidents,
              incidentsTenantId,
            );
            if (Number(recoveredCount) > 0) {
              const recoveredPhotosResult = await env.DB.prepare(photosQuery)
                .bind(installationId, incidentsTenantId)
                .all();
              photos = recoveredPhotosResult?.results || [];
            }
          }

          const photosByIncident = {};
          for (const photo of photos) {
            if (!photosByIncident[photo.incident_id]) {
              photosByIncident[photo.incident_id] = [];
            }
            photosByIncident[photo.incident_id].push(photo);
          }

          const enriched = incidents.map((incident) =>
            mapIncidentRow(incident, photosByIncident[incident.id] || []),
          );

          return jsonResponse(request, env, corsPolicy, {
            success: true,
            installation_id: installationId,
            incidents: enriched,
          });
        } catch (error) {
          if (isMissingIncidentReadModelColumnsError(error)) {
            throw new HttpError(
              500,
              "La tabla incidents no tiene las migraciones de GPS/destino operativo aplicadas. Ejecuta 0017_geolocation_capture.sql, 0023_incident_dispatch_target.sql y 0024_incident_dispatch_required.sql.",
            );
          }
          throw error;
        }
      }

      if (request.method === "POST") {
        if (isWebRoute) {
          requireWebWriteRole(webSession?.role);
        }
        const data = await readJsonOrThrowBadRequest(request);
        const payload = validateIncidentPayload(data, {
          defaultSource: isWebRoute ? "web" : "mobile",
          defaultReporterUsername: webSession?.sub || "unknown",
        });
        const gps = normalizeGpsPayload(data?.gps);
        const requestedAssetId = parseOptionalPositiveInt(data?.asset_id, "asset_id");
        const createdAt = nowIso();

        if (requestedAssetId !== null) {
          const { results: assetRows } = await env.DB.prepare(`
            SELECT id
            FROM assets
            WHERE id = ?
              AND tenant_id = ?
            LIMIT 1
          `)
            .bind(requestedAssetId, incidentsTenantId)
            .all();
          if (!assetRows?.[0]) {
            throw new HttpError(404, "Equipo no encontrado.");
          }
        }

        const { results: installationRows } = await env.DB.prepare(`
          SELECT id, notes, installation_time_seconds
          FROM installations
          WHERE id = ?
            AND tenant_id = ?
        `)
          .bind(installationId, incidentsTenantId)
          .all();

        const installation = installationRows?.[0];
        if (!installation) {
          throw new HttpError(404, "Instalación no encontrada.");
        }

        const requestIp = getClientIpForRateLimit(request);

        let persistedAssetId = requestedAssetId;
        let insertResult;
        try {
          insertResult = await env.DB.prepare(`
            INSERT INTO incidents (
              installation_id,
              asset_id,
              tenant_id,
              reporter_username,
              note,
              time_adjustment_seconds,
              estimated_duration_seconds,
              severity,
              source,
              created_at,
              incident_status,
              status_updated_at,
              status_updated_by,
              work_started_at,
              work_ended_at,
              actual_duration_seconds,
              gps_lat,
              gps_lng,
              gps_accuracy_m,
              gps_captured_at,
              gps_capture_source,
              gps_capture_status,
              gps_capture_note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
            .bind(
              installationId,
              requestedAssetId,
              incidentsTenantId,
              payload.reporterUsername,
              payload.note,
              payload.timeAdjustment,
              payload.estimatedDurationSeconds,
              payload.severity,
              payload.source,
              createdAt,
              payload.incidentStatus,
              createdAt,
              payload.reporterUsername,
              null,
              null,
              null,
              ...gpsBindValues(gps),
            )
            .run();
        } catch (error) {
          if (
            !isMissingIncidentAssetColumnError(error) &&
            !isMissingIncidentTimingColumnsError(error)
          ) {
            throw error;
          }
          try {
            insertResult = await env.DB.prepare(`
              INSERT INTO incidents (
                installation_id,
                asset_id,
                tenant_id,
                reporter_username,
                note,
                time_adjustment_seconds,
                severity,
                source,
                created_at,
                incident_status,
                status_updated_at,
                status_updated_by,
                gps_lat,
                gps_lng,
                gps_accuracy_m,
                gps_captured_at,
                gps_capture_source,
                gps_capture_status,
                gps_capture_note
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
              .bind(
                installationId,
                requestedAssetId,
                incidentsTenantId,
                payload.reporterUsername,
                payload.note,
                payload.timeAdjustment,
                payload.severity,
                payload.source,
                createdAt,
                payload.incidentStatus,
                createdAt,
                payload.reporterUsername,
                ...gpsBindValues(gps),
              )
              .run();
          } catch (legacyError) {
            if (!isMissingIncidentAssetColumnError(legacyError)) {
              throw legacyError;
            }
            insertResult = await env.DB.prepare(`
              INSERT INTO incidents (
                installation_id,
                tenant_id,
                reporter_username,
                note,
                time_adjustment_seconds,
                severity,
                source,
                created_at,
                incident_status,
                status_updated_at,
                status_updated_by,
                gps_lat,
                gps_lng,
                gps_accuracy_m,
                gps_captured_at,
                gps_capture_source,
                gps_capture_status,
                gps_capture_note
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
              .bind(
                installationId,
                incidentsTenantId,
                payload.reporterUsername,
                payload.note,
                payload.timeAdjustment,
                payload.severity,
                payload.source,
                createdAt,
                payload.incidentStatus,
                createdAt,
                payload.reporterUsername,
                ...gpsBindValues(gps),
              )
              .run();
            persistedAssetId = null;
          }
        }

        const incidentId = insertResult?.meta?.last_row_id || null;

        if (payload.applyToInstallation) {
          const currentNotes = (installation.notes || "").toString();
          const composedNotes = currentNotes
            ? `${currentNotes}\n[INCIDENT] ${payload.note}`
            : payload.note;
          const currentTime = Number(installation.installation_time_seconds || 0);
          const nextTime = Math.max(0, currentTime + payload.timeAdjustment);

          await env.DB.prepare(`
            UPDATE installations
            SET notes = ?, installation_time_seconds = ?
            WHERE id = ?
              AND tenant_id = ?
          `)
            .bind(composedNotes, nextTime, installationId, incidentsTenantId)
            .run();
        }

        if (payload.severity === "critical") {
          try {
            const fcmTokens = await listDeviceTokensForWebRoles(
              env,
              criticalIncidentPushRoles,
              incidentsTenantId,
            );
            if (fcmTokens.length > 0) {
              await sendPushNotification(env, fcmTokens, {
                title: "Incidencia critica",
                body: `Nueva incidencia critica en instalacion #${installationId}`,
                data: {
                  installation_id: String(installationId),
                  incident_id: String(incidentId || ""),
                  asset_id: persistedAssetId !== null ? String(persistedAssetId) : "",
                  severity: payload.severity,
                  source: payload.source,
                },
              });
            }
          } catch {
            // Best effort: una falla de push no debe impedir registrar la incidencia.
          }
        }

        await logAuditEvent(env, {
          action: "create_incident",
          username: payload.reporterUsername,
          success: true,
          tenantId: incidentsTenantId,
          details: {
            incident_id: incidentId,
            installation_id: installationId,
            asset_id: persistedAssetId,
            estimated_duration_seconds: payload.estimatedDurationSeconds,
            severity: payload.severity,
            source: payload.source,
            note_preview: payload.note.substring(0, 100),
            gps_accuracy_m: gps.gps_accuracy_m,
            tenant_id: incidentsTenantId,
          },
          computerName: "",
          ipAddress: requestIp,
          platform: payload.source,
        });

        const incidentEventPayload = mapIncidentRow({
          id: incidentId,
          installation_id: installationId,
          asset_id: persistedAssetId,
          reporter_username: payload.reporterUsername,
          note: payload.note,
          time_adjustment_seconds: payload.timeAdjustment,
          estimated_duration_seconds: payload.estimatedDurationSeconds,
          severity: payload.severity,
          source: payload.source,
          created_at: createdAt,
          incident_status: payload.incidentStatus,
          status_updated_at: createdAt,
          status_updated_by: payload.reporterUsername,
          resolved_at: null,
          resolved_by: null,
          resolution_note: null,
          checklist_json: null,
          evidence_note: null,
          ...gps,
        });

        await publishRealtimeEvent(env, {
          type: "incident_created",
          incident: incidentEventPayload,
        }, realtimeTenantId);
        await syncPublicTrackingSnapshotForInstallation(env, {
          tenantId: incidentsTenantId,
          installationId,
        });
        if (payload.applyToInstallation) {
          await publishRealtimeEvent(env, {
            type: "installation_updated",
            installation: {
              id: installationId,
              notes: (installation.notes || "").toString()
                ? `${(installation.notes || "").toString()}\n[INCIDENT] ${payload.note}`
                : payload.note,
              installation_time_seconds: Math.max(
                0,
                Number(installation.installation_time_seconds || 0) + payload.timeAdjustment,
              ),
            },
          }, realtimeTenantId);
        }
        await publishRealtimeStatsUpdate(env, realtimeTenantId);

        return jsonResponse(
          request,
          env,
          corsPolicy,
          {
            success: true,
            incident: incidentEventPayload,
          },
          201,
        );
      }
    }

    return null;
  }

  async function handleIncidentEvidenceRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    incidentsTenantId,
    realtimeTenantId,
  ) {
    if (
      routeParts.length === 3 &&
      routeParts[0] === "incidents" &&
      routeParts[2] === "evidence"
    ) {
      enforceIncidentPatchAccess(
        request,
        isWebRoute,
        webSession,
        "Metodo no permitido para actualizar evidencia de incidencia.",
      );

      const incidentId = parsePositiveInt(routeParts[1], "incident_id");
      const data = await readJsonOrThrowBadRequest(request);
      const payload = normalizeIncidentEvidencePayload(data);
      const actorUsername = resolveIncidentActorUsername(isWebRoute, webSession, data);
      const existingIncident = await loadIncidentForTenant(env, {
        incidentId,
        incidentsTenantId,
      });
      if (!existingIncident) {
        throw new HttpError(404, "Incidencia no encontrada.");
      }

      const nextChecklistItems = payload.hasChecklistItems
        ? payload.checklistItems
        : parseIncidentChecklistItems(existingIncident.checklist_json);
      const nextEvidenceNote = payload.hasEvidenceNote
        ? payload.evidenceNote
        : (normalizeOptionalString(existingIncident.evidence_note, "").trim() || null);

      await env.DB.prepare(`
        UPDATE incidents
        SET
          checklist_json = ?,
          evidence_note = ?
        WHERE id = ?
          AND tenant_id = ?
      `)
        .bind(
          JSON.stringify(nextChecklistItems || []),
          nextEvidenceNote,
          incidentId,
          incidentsTenantId,
        )
        .run();

      const incidentEventPayload = mapIncidentRow({
        ...existingIncident,
        checklist_json: JSON.stringify(nextChecklistItems || []),
        evidence_note: nextEvidenceNote,
      });

      await logAuditEvent(env, {
        action: "update_incident_evidence",
        username: actorUsername,
        success: true,
        tenantId: incidentsTenantId,
        details: {
          incident_id: incidentId,
          installation_id: existingIncident.installation_id,
          checklist_items_count: (nextChecklistItems || []).length,
          has_evidence_note: Boolean(nextEvidenceNote),
        },
        ipAddress: getClientIpForRateLimit(request),
        platform: isWebRoute ? "web" : "api",
      });

      await publishRealtimeEvent(env, {
        type: "incident_evidence_updated",
        incident: incidentEventPayload,
      }, realtimeTenantId);
      await syncPublicTrackingSnapshotForInstallation(env, {
        tenantId: incidentsTenantId,
        installationId: existingIncident.installation_id,
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        incident: incidentEventPayload,
      });
    }

    return null;
  }

  async function handleIncidentDispatchTargetRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    incidentsTenantId,
    realtimeTenantId,
  ) {
    if (
      !(
        routeParts.length === 3 &&
        routeParts[0] === "incidents" &&
        routeParts[2] === "dispatch-target"
      )
    ) {
      return null;
    }

    if (request.method !== "PATCH") {
      return null;
    }
    if (!isWebRoute) {
      throw new HttpError(405, "Ruta disponible solo en /web.");
    }
    requireWebWriteRole(webSession?.role);

    const incidentId = parsePositiveInt(routeParts[1], "incident_id");
    const payload = normalizeDispatchTargetPayload(await readJsonOrThrowBadRequest(request));
    const existingIncident = await loadIncidentForTenant(env, {
      incidentId,
      incidentsTenantId,
    });
    if (!existingIncident) {
      throw new HttpError(404, "Incidencia no encontrada.");
    }

    const updatedAt = nowIso();
    const updatedBy = normalizeOptionalString(webSession?.sub, "web");
    const nextIncident = {
      ...existingIncident,
      dispatch_required:
        payload.dispatchRequired !== undefined
          ? payload.dispatchRequired
          : existingIncident.dispatch_required === null || existingIncident.dispatch_required === undefined
            ? true
            : Number(existingIncident.dispatch_required) !== 0,
      target_lat: payload.targetLat !== undefined ? payload.targetLat : existingIncident.target_lat ?? null,
      target_lng: payload.targetLng !== undefined ? payload.targetLng : existingIncident.target_lng ?? null,
      target_label:
        payload.targetLabel !== undefined ? payload.targetLabel : existingIncident.target_label ?? null,
      target_source:
        payload.targetSource !== undefined
          ? payload.targetSource
          : existingIncident.target_source ?? null,
      dispatch_place_name:
        payload.dispatchPlaceName !== undefined
          ? payload.dispatchPlaceName
          : existingIncident.dispatch_place_name ?? null,
      dispatch_address:
        payload.dispatchAddress !== undefined
          ? payload.dispatchAddress
          : existingIncident.dispatch_address ?? null,
      dispatch_reference:
        payload.dispatchReference !== undefined
          ? payload.dispatchReference
          : existingIncident.dispatch_reference ?? null,
      dispatch_contact_name:
        payload.dispatchContactName !== undefined
          ? payload.dispatchContactName
          : existingIncident.dispatch_contact_name ?? null,
      dispatch_contact_phone:
        payload.dispatchContactPhone !== undefined
          ? payload.dispatchContactPhone
          : existingIncident.dispatch_contact_phone ?? null,
      dispatch_notes:
        payload.dispatchNotes !== undefined
          ? payload.dispatchNotes
          : existingIncident.dispatch_notes ?? null,
      target_updated_at: updatedAt,
      target_updated_by: updatedBy,
    };

    if (nextIncident.dispatch_required === false) {
      nextIncident.target_lat = null;
      nextIncident.target_lng = null;
      nextIncident.target_label = null;
      nextIncident.target_source = null;
      nextIncident.dispatch_place_name = null;
      nextIncident.dispatch_address = null;
      nextIncident.dispatch_reference = null;
      nextIncident.dispatch_contact_name = null;
      nextIncident.dispatch_contact_phone = null;
      nextIncident.dispatch_notes = null;
    }

    if ((nextIncident.target_lat === null) !== (nextIncident.target_lng === null)) {
      throw new HttpError(400, "target_lat y target_lng deben quedar definidos juntos o ambos vacios.");
    }

    try {
      await env.DB.prepare(`
        UPDATE incidents
        SET
          target_lat = ?,
          target_lng = ?,
          target_label = ?,
          target_source = ?,
          target_updated_at = ?,
          target_updated_by = ?,
          dispatch_required = ?,
          dispatch_place_name = ?,
          dispatch_address = ?,
          dispatch_reference = ?,
          dispatch_contact_name = ?,
          dispatch_contact_phone = ?,
          dispatch_notes = ?
        WHERE id = ?
          AND tenant_id = ?
      `)
        .bind(
          nextIncident.target_lat,
          nextIncident.target_lng,
          nextIncident.target_label,
          nextIncident.target_source,
          nextIncident.target_updated_at,
          nextIncident.target_updated_by,
          nextIncident.dispatch_required ? 1 : 0,
          nextIncident.dispatch_place_name,
          nextIncident.dispatch_address,
          nextIncident.dispatch_reference,
          nextIncident.dispatch_contact_name,
          nextIncident.dispatch_contact_phone,
          nextIncident.dispatch_notes,
          incidentId,
          incidentsTenantId,
        )
        .run();
    } catch (error) {
      if (isMissingIncidentReadModelColumnsError(error)) {
        throw new HttpError(
          500,
          "La tabla incidents no tiene las migraciones de destino operativo aplicadas. Ejecuta 0023_incident_dispatch_target.sql y 0024_incident_dispatch_required.sql.",
        );
      }
      throw error;
    }

    const incidentEventPayload = mapIncidentRow(nextIncident);

    await logAuditEvent(env, {
      action: "update_incident_dispatch_target",
      username: updatedBy,
      success: true,
      tenantId: incidentsTenantId,
        details: {
          incident_id: incidentId,
          installation_id: existingIncident.installation_id,
          dispatch_required: nextIncident.dispatch_required !== false,
          has_target_coordinates:
            nextIncident.target_lat !== null &&
            nextIncident.target_lat !== undefined &&
            nextIncident.target_lng !== null &&
            nextIncident.target_lng !== undefined &&
            Number.isFinite(Number(nextIncident.target_lat)) &&
            Number.isFinite(Number(nextIncident.target_lng)),
        has_dispatch_address: Boolean(nextIncident.dispatch_address),
        has_dispatch_reference: Boolean(nextIncident.dispatch_reference),
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web",
    });

    await publishRealtimeEvent(env, {
      type: "incident_dispatch_target_updated",
      incident: incidentEventPayload,
    }, realtimeTenantId);
    await syncPublicTrackingSnapshotForInstallation(env, {
      tenantId: incidentsTenantId,
      installationId: existingIncident.installation_id,
    });

    return jsonResponse(request, env, corsPolicy, {
      success: true,
      incident: incidentEventPayload,
    });
  }

  async function handleIncidentStatusRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    incidentsTenantId,
    realtimeTenantId,
  ) {
    if (
      (
        routeParts.length === 3 &&
        routeParts[0] === "incidents" &&
        routeParts[2] === "status"
      ) ||
      (
        routeParts.length === 5 &&
        routeParts[0] === "installations" &&
        routeParts[2] === "incidents" &&
        routeParts[4] === "status"
      )
    ) {
      enforceIncidentPatchAccess(
        request,
        isWebRoute,
        webSession,
        "Metodo no permitido para actualizacion de estado de incidencia.",
      );

      const incidentId = parsePositiveInt(
        routeParts.length === 3 ? routeParts[1] : routeParts[3],
        "incident_id",
      );
      const installationIdFromPath =
        routeParts.length === 5 ? parsePositiveInt(routeParts[1], "installation_id") : null;
      const data = await readJsonOrThrowBadRequest(request);
      const payload = normalizeIncidentStatusPayload(data);
      const statusUpdatedAt = nowIso();
      const actorUsername = resolveIncidentActorUsername(isWebRoute, webSession, data);
      const existingIncident = await loadIncidentForTenant(env, {
        incidentId,
        incidentsTenantId,
        installationId: installationIdFromPath,
      });
      if (!existingIncident) {
        throw new HttpError(404, "Incidencia no encontrada.");
      }

      const timingFields = await loadIncidentTimingFieldsForTenant(
        env,
        incidentId,
        incidentsTenantId,
      );
      const previousStatus = normalizeOptionalString(existingIncident.incident_status, "open")
        .toLowerCase();
      const parseIsoMillis = (value) => {
        let text = String(value || "").trim();
        if (text && !text.endsWith("Z") && !text.includes("+") && !text.includes("-")) {
          if (text.length === 19) text += "Z";
        }
        text = text.replace(" ", "T");
        const parsed = Date.parse(text);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const computeElapsedSeconds = (startIso, endIso) => {
        const startMs = parseIsoMillis(startIso);
        const endMs = parseIsoMillis(endIso);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
          return null;
        }
        return Math.floor((endMs - startMs) / 1000);
      };
      let workStartedAt =
        normalizeOptionalString(timingFields.work_started_at, "").trim() || null;
      let workEndedAt =
        normalizeOptionalString(timingFields.work_ended_at, "").trim() || null;
      let actualDurationSeconds = Number.parseInt(
        String(timingFields.actual_duration_seconds ?? ""),
        10,
      );
      if (!Number.isInteger(actualDurationSeconds) || actualDurationSeconds < 0) {
        actualDurationSeconds = null;
      }
      const accumulatedDurationSeconds = actualDurationSeconds ?? 0;
      if (!workStartedAt && previousStatus === "in_progress") {
        workStartedAt = normalizeOptionalString(existingIncident.status_updated_at, "").trim() || null;
      }

      if (payload.incidentStatus === "open") {
        workStartedAt = null;
        workEndedAt = null;
        actualDurationSeconds = null;
      } else if (payload.incidentStatus === "in_progress") {
        if (previousStatus === "paused") {
          workStartedAt = statusUpdatedAt;
          workEndedAt = null;
          actualDurationSeconds = accumulatedDurationSeconds;
        } else {
          if (!workStartedAt || previousStatus !== "in_progress") {
            workStartedAt = statusUpdatedAt;
          }
          workEndedAt = null;
          actualDurationSeconds = null;
        }
      } else if (payload.incidentStatus === "paused") {
        const segmentStartIso =
          workStartedAt ||
          normalizeOptionalString(existingIncident.status_updated_at, "").trim() ||
          normalizeOptionalString(existingIncident.created_at, "").trim() ||
          statusUpdatedAt;
        const segmentElapsedSeconds = previousStatus === "in_progress"
          ? computeElapsedSeconds(segmentStartIso, statusUpdatedAt)
          : 0;
        actualDurationSeconds = Math.max(
          0,
          accumulatedDurationSeconds + (Number.isInteger(segmentElapsedSeconds) ? segmentElapsedSeconds : 0),
        );
        workStartedAt = null;
        workEndedAt = statusUpdatedAt;
      } else if (payload.incidentStatus === "resolved") {
        if (previousStatus === "paused") {
          actualDurationSeconds = accumulatedDurationSeconds;
          workStartedAt = null;
          workEndedAt = statusUpdatedAt;
        } else {
          if (!workStartedAt) {
            workStartedAt = normalizeOptionalString(existingIncident.created_at, "").trim() || statusUpdatedAt;
          }
          workEndedAt = statusUpdatedAt;
          const segmentElapsedSeconds = computeElapsedSeconds(workStartedAt, workEndedAt);
          if (Number.isInteger(segmentElapsedSeconds)) {
            actualDurationSeconds = accumulatedDurationSeconds + segmentElapsedSeconds;
          } else if (accumulatedDurationSeconds > 0) {
            actualDurationSeconds = accumulatedDurationSeconds;
          } else {
            actualDurationSeconds = null;
          }
        }
      }

      const resolvedAt = payload.incidentStatus === "resolved" ? statusUpdatedAt : null;
      const resolvedBy = payload.incidentStatus === "resolved" ? actorUsername : null;
      const resolutionNote = payload.resolutionNote;

      try {
        await env.DB.prepare(`
          UPDATE incidents
          SET
            incident_status = ?,
            status_updated_at = ?,
            status_updated_by = ?,
            resolved_at = ?,
            resolved_by = ?,
            resolution_note = ?,
            work_started_at = ?,
            work_ended_at = ?,
            actual_duration_seconds = ?
          WHERE id = ?
            AND tenant_id = ?
        `)
          .bind(
            payload.incidentStatus,
            statusUpdatedAt,
            actorUsername,
            resolvedAt,
            resolvedBy,
            resolutionNote,
            workStartedAt,
            workEndedAt,
            actualDurationSeconds,
            incidentId,
            incidentsTenantId,
          )
          .run();
      } catch (error) {
        if (isIncidentStatusConstraintError(error)) {
          throw new HttpError(
            409,
            "La base no soporta el estado 'paused' todavia. Aplica las migraciones pendientes y reintenta.",
          );
        }
        if (!isMissingIncidentTimingColumnsError(error)) {
          throw error;
        }
        await env.DB.prepare(`
          UPDATE incidents
          SET
            incident_status = ?,
            status_updated_at = ?,
            status_updated_by = ?,
            resolved_at = ?,
            resolved_by = ?,
            resolution_note = ?
          WHERE id = ?
            AND tenant_id = ?
        `)
          .bind(
            payload.incidentStatus,
            statusUpdatedAt,
            actorUsername,
            resolvedAt,
            resolvedBy,
            resolutionNote,
            incidentId,
            incidentsTenantId,
          )
          .run();
      }

      const incidentEventPayload = mapIncidentRow({
        ...existingIncident,
        incident_status: payload.incidentStatus,
        status_updated_at: statusUpdatedAt,
        status_updated_by: actorUsername,
        resolved_at: resolvedAt,
        resolved_by: resolvedBy,
        resolution_note: resolutionNote,
        work_started_at: workStartedAt,
        work_ended_at: workEndedAt,
        actual_duration_seconds: actualDurationSeconds,
      });
      incidentEventPayload.incident_status = payload.incidentStatus;

      await logAuditEvent(env, {
        action: "update_incident_status",
        username: actorUsername,
        success: true,
        tenantId: incidentsTenantId,
        details: {
          incident_id: incidentId,
          installation_id: existingIncident.installation_id,
          previous_status: existingIncident.incident_status || "open",
          new_status: payload.incidentStatus,
          has_resolution_note: Boolean(resolutionNote),
          actual_duration_seconds: actualDurationSeconds,
        },
        ipAddress: getClientIpForRateLimit(request),
        platform: isWebRoute ? "web" : "api",
      });

      await publishRealtimeEvent(env, {
        type: "incident_status_updated",
        incident: incidentEventPayload,
      }, realtimeTenantId);
      await syncPublicTrackingSnapshotForInstallation(env, {
        tenantId: incidentsTenantId,
        installationId: existingIncident.installation_id,
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        incident: incidentEventPayload,
      });
    }

    return null;
  }

  async function handleIncidentPhotosRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    incidentsTenantId,
  ) {
    if (
      routeParts.length === 3 &&
      routeParts[0] === "incidents" &&
      routeParts[2] === "photos" &&
      request.method === "POST"
    ) {
      if (isWebRoute) {
        requireWebWriteRole(webSession?.role);
      }
      const incidentId = parsePositiveInt(routeParts[1], "incident_id");
      const declaredContentType = normalizeContentType(request.headers.get("content-type"));

      if (!allowedPhotoTypes.has(declaredContentType)) {
        throw new HttpError(400, "Tipo de imagen no permitido.");
      }

      const bodyBuffer = await request.arrayBuffer();
      const { sizeBytes, contentType } = validateAndProcessPhoto(bodyBuffer, declaredContentType);

      const incidentsBucket = requireIncidentsBucketOperation(env, "put");
      const incident = await loadIncidentByIdForTenant(env, incidentId, incidentsTenantId);
      if (!incident) {
        throw new HttpError(404, "Incidencia no encontrada.");
      }

      const extension = extensionFromType(contentType);
      const metadata = await resolveIncidentPhotoMetadata(
        env,
        request,
        incident,
        incidentsTenantId,
      );
      const descriptor = buildIncidentPhotoDescriptor({
        installationId: incident.installation_id,
        incidentId,
        clientName: metadata.clientName,
        assetCode: metadata.assetCode,
      });
      const fileName = buildIncidentPhotoFileName({
        installationId: incident.installation_id,
        incidentId,
        clientName: metadata.clientName,
        assetCode: metadata.assetCode,
        extension,
      });
      const r2Key = buildIncidentR2Key(
        incident.installation_id,
        incidentId,
        extension,
        descriptor,
      );
      const sha256 = await sha256Hex(bodyBuffer);
      const providedBodyHash = normalizeOptionalString(request.headers.get("X-Body-SHA256"), "").toLowerCase();
      if (providedBodyHash) {
        if (!/^[a-f0-9]{64}$/i.test(providedBodyHash)) {
          throw new HttpError(400, "Header X-Body-SHA256 inválido.");
        }
        if (providedBodyHash !== sha256) {
          throw new HttpError(
            isWebRoute ? 400 : 401,
            isWebRoute
              ? "El hash del body no coincide con la imagen enviada."
              : "Integridad inválida: X-Body-SHA256 no coincide con el body.",
          );
        }
      }
      const createdAt = nowIso();

      await incidentsBucket.put(r2Key, bodyBuffer, {
        httpMetadata: { contentType },
      });

      const insertResult = await env.DB.prepare(`
        INSERT INTO incident_photos (incident_id, tenant_id, r2_key, file_name, content_type, size_bytes, sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(incidentId, incidentsTenantId, r2Key, fileName, contentType, sizeBytes, sha256, createdAt)
        .run();

      return jsonResponse(
        request,
        env,
        corsPolicy,
        {
          success: true,
          photo: {
            id: insertResult?.meta?.last_row_id || null,
            incident_id: incidentId,
            r2_key: r2Key,
            file_name: fileName,
            content_type: contentType,
            size_bytes: sizeBytes,
            sha256,
            created_at: createdAt,
          },
        },
        201,
      );
    }

    if (routeParts.length === 2 && routeParts[0] === "photos" && request.method === "GET") {
      const photoId = parsePositiveInt(routeParts[1], "photo_id");

      const incidentsBucket = requireIncidentsBucketOperation(env, "get");
      const photo = await loadIncidentPhotoByIdForTenant(env, photoId, incidentsTenantId);
      if (!photo) {
        throw new HttpError(404, "Foto no encontrada.");
      }

      const object = await incidentsBucket.get(photo.r2_key);
      if (!object || !object.body) {
        throw new HttpError(404, "Archivo de foto no encontrado en almacenamiento.");
      }

      const safeName = sanitizeFileName(photo.file_name, `photo_${photoId}`);

      return new Response(object.body, {
        status: 200,
        headers: {
          ...corsHeaders(request, env, corsPolicy),
          "Content-Type":
            photo.content_type || object.httpMetadata?.contentType || "application/octet-stream",
          "Content-Disposition": `inline; filename=\"${safeName}\"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    return null;
  }

  async function handleIncidentDeleteRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
    incidentsTenantId,
    realtimeTenantId,
  ) {
    if (request.method !== "DELETE") {
      return null;
    }

    const isDeleteByIncidentIdRoute =
      routeParts.length === 2 && routeParts[0] === "incidents";
    const isDeleteByInstallationIncidentRoute =
      routeParts.length === 4 &&
      routeParts[0] === "installations" &&
      routeParts[2] === "incidents";

    if (!isDeleteByIncidentIdRoute && !isDeleteByInstallationIncidentRoute) {
      return null;
    }

    if (!isWebRoute) {
      throw new HttpError(405, "Metodo no permitido para eliminar incidencias.");
    }

    requireSuperAdminRole(webSession?.role);

    const incidentId = parsePositiveInt(
      isDeleteByInstallationIncidentRoute ? routeParts[3] : routeParts[1],
      "incident_id",
    );
    const installationIdFromPath = isDeleteByInstallationIncidentRoute
      ? parsePositiveInt(routeParts[1], "installation_id")
      : null;

    const deletedAt = nowIso();
    const deletedBy = normalizeOptionalString(webSession?.sub, "web");
    let existingIncident = null;
    let updateResult = null;
    try {
      existingIncident = await loadIncidentForTenant(env, {
        incidentId,
        incidentsTenantId,
        installationId: installationIdFromPath,
      });

      updateResult = await env.DB.prepare(`
        UPDATE incidents
        SET
          deleted_at = ?,
          deleted_by = ?,
          deletion_reason = ?,
          status_updated_at = ?,
          status_updated_by = ?
        WHERE id = ?
          AND tenant_id = ?
          AND deleted_at IS NULL
      `)
        .bind(
          deletedAt,
          deletedBy,
          "soft_delete_super_admin",
          deletedAt,
          deletedBy,
          incidentId,
          incidentsTenantId,
        )
        .run();
    } catch (error) {
      if (isMissingIncidentSoftDeleteColumnsError(error)) {
        throw new HttpError(
          409,
          "La base no soporta soft delete de incidencias todavia. Aplica la migracion 0015_incident_soft_delete.sql y reintenta.",
        );
      }
      throw error;
    }

    const updatedRows = Number(updateResult?.meta?.changes) || 0;
    if (updatedRows <= 0) {
      throw new HttpError(404, "Incidencia no encontrada o ya eliminada.");
    }

    await logAuditEvent(env, {
      action: "soft_delete_incident",
      username: deletedBy,
      success: true,
      tenantId: incidentsTenantId,
      details: {
        incident_id: incidentId,
        installation_id: existingIncident?.installation_id || installationIdFromPath,
        previous_status: existingIncident?.incident_status || "open",
        tenant_id: incidentsTenantId,
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web",
    });

    await publishRealtimeEvent(env, {
      type: "incident_deleted",
      incident: {
        id: incidentId,
        installation_id: existingIncident?.installation_id || installationIdFromPath,
        deleted_at: deletedAt,
      },
    }, realtimeTenantId);
    await syncPublicTrackingSnapshotForInstallation(env, {
      tenantId: incidentsTenantId,
      installationId: existingIncident?.installation_id || installationIdFromPath,
    });
    await publishRealtimeStatsUpdate(env, realtimeTenantId);

    return jsonResponse(request, env, corsPolicy, {
      success: true,
      incident_id: incidentId,
      deleted_at: deletedAt,
    });
  }

  return {
    handleIncidentMapRoute,
    handleIncidentDetailRoute,
    handleIncidentDispatchTargetRoute,
    handleIncidentDeleteRoute,
    handleInstallationIncidentsRoute,
    handleIncidentEvidenceRoute,
    handleIncidentStatusRoute,
    handleIncidentPhotosRoute,
  };
}

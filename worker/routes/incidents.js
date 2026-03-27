import {
  HttpError,
  isMissingIncidentGeofenceOverrideColumnsError,
  isMissingIncidentReadModelColumnsError,
  isIncidentStatusConstraintError,
  isMissingIncidentSoftDeleteColumnsError,
} from "../lib/core.js";
import { gpsBindValues, normalizeGpsPayload } from "../lib/gps.js";
import {
  buildDefaultGeofenceSnapshot,
  GEOFENCE_FLOW_INCIDENTS,
  resolveHardGeofenceOverride,
} from "../lib/geofence.js";

export function createIncidentsRouteHandlers({
  jsonResponse,
  parsePositiveInt,
  requireWebWriteRole,
  requireAdminRole,
  requireSuperAdminRole,
  readJsonOrThrowBadRequest,
  validateIncidentPayload,
  parseOptionalPositiveInt,
  nowIso,
  isMissingIncidentAssetColumnError,
  isMissingIncidentTimingColumnsError,
  normalizeIncidentEvidencePayload,
  normalizeIncidentStatusPayload,
  evaluateGeofence,
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
      requireAdminRole(webSession?.role);
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
              geofence_distance_m,
              geofence_radius_m,
              geofence_result,
              geofence_checked_at,
              geofence_override_note,
              geofence_override_by,
              geofence_override_at,
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
              "La tabla incidents no tiene las migraciones GPS/geofence aplicadas. Ejecuta 0017_geolocation_capture.sql, 0018_geofencing_soft.sql y 0019_geofence_hard_overrides.sql.",
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
          SELECT id, notes, installation_time_seconds, site_lat, site_lng, site_radius_m
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

        const geofence = evaluateGeofence({
          gps,
          installation,
          checkedAt: createdAt,
        });
        const requestIp = getClientIpForRateLimit(request);
        const geofenceOverride = resolveHardGeofenceOverride({
          env,
          tenantId: incidentsTenantId,
          flow: GEOFENCE_FLOW_INCIDENTS,
          geofence,
          overrideNote: data?.geofence_override_note,
          actorUsername: payload.reporterUsername,
          appliedAt: createdAt,
        });

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
              geofence_distance_m,
              geofence_radius_m,
              geofence_result,
              geofence_checked_at,
              geofence_override_note,
              geofence_override_by,
              geofence_override_at,
              gps_lat,
              gps_lng,
              gps_accuracy_m,
              gps_captured_at,
              gps_capture_source,
              gps_capture_status,
              gps_capture_note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
              geofence.geofence_distance_m,
              geofence.geofence_radius_m,
              geofence.geofence_result,
              geofence.geofence_checked_at,
              geofenceOverride.override_note,
              geofenceOverride.override_by,
              geofenceOverride.override_at,
              ...gpsBindValues(gps),
            )
            .run();
        } catch (error) {
          if (
            !isMissingIncidentAssetColumnError(error) &&
            !isMissingIncidentTimingColumnsError(error) &&
            !isMissingIncidentGeofenceOverrideColumnsError(error)
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
                geofence_distance_m,
                geofence_radius_m,
                geofence_result,
                geofence_checked_at,
                geofence_override_note,
                geofence_override_by,
                geofence_override_at,
                gps_lat,
                gps_lng,
                gps_accuracy_m,
                gps_captured_at,
                gps_capture_source,
                gps_capture_status,
                gps_capture_note
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                geofence.geofence_distance_m,
                geofence.geofence_radius_m,
                geofence.geofence_result,
                geofence.geofence_checked_at,
                geofenceOverride.override_note,
                geofenceOverride.override_by,
                geofenceOverride.override_at,
                ...gpsBindValues(gps),
              )
              .run();
          } catch (legacyError) {
            if (
              !isMissingIncidentAssetColumnError(legacyError) &&
              !isMissingIncidentGeofenceOverrideColumnsError(legacyError)
            ) {
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
                geofence_distance_m,
                geofence_radius_m,
                geofence_result,
                geofence_checked_at,
                geofence_override_note,
                geofence_override_by,
                geofence_override_at,
                gps_lat,
                gps_lng,
                gps_accuracy_m,
                gps_captured_at,
                gps_capture_source,
                gps_capture_status,
                gps_capture_note
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                geofence.geofence_distance_m,
                geofence.geofence_radius_m,
                geofence.geofence_result,
                geofence.geofence_checked_at,
                geofenceOverride.override_note,
                geofenceOverride.override_by,
                geofenceOverride.override_at,
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
            geofence_result: geofence.geofence_result,
            geofence_distance_m: geofence.geofence_distance_m,
            geofence_radius_m: geofence.geofence_radius_m,
            geofence_override_note: geofenceOverride.override_note,
            geofence_override_by: geofenceOverride.override_by,
            geofence_override_at: geofenceOverride.override_at,
            gps_accuracy_m: gps.gps_accuracy_m,
            tenant_id: incidentsTenantId,
          },
          computerName: "",
          ipAddress: requestIp,
          platform: payload.source,
        });

        if (geofence.geofence_result === "outside") {
          await logAuditEvent(env, {
            action: "incident_geofence_warning",
            username: payload.reporterUsername,
            success: true,
            tenantId: incidentsTenantId,
            details: {
              incident_id: incidentId,
              installation_id: installationId,
              geofence_result: geofence.geofence_result,
              geofence_distance_m: geofence.geofence_distance_m,
              geofence_radius_m: geofence.geofence_radius_m,
              gps_accuracy_m: gps.gps_accuracy_m,
              tenant_id: incidentsTenantId,
            },
            computerName: "",
            ipAddress: requestIp,
            platform: payload.source,
          });
        }

        if (geofenceOverride.override_applied) {
          await logAuditEvent(env, {
            action: "override_incident_geofence",
            username: payload.reporterUsername,
            success: true,
            tenantId: incidentsTenantId,
            details: {
              incident_id: incidentId,
              installation_id: installationId,
              asset_id: persistedAssetId,
              geofence_distance_m: geofence.geofence_distance_m,
              geofence_radius_m: geofence.geofence_radius_m,
              gps_accuracy_m: gps.gps_accuracy_m,
              reason: geofenceOverride.override_note,
              override_by: geofenceOverride.override_by,
              override_at: geofenceOverride.override_at,
              tenant_id: incidentsTenantId,
            },
            computerName: "",
            ipAddress: requestIp,
            platform: payload.source,
          });
        }

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
          ...buildDefaultGeofenceSnapshot(),
          ...geofence,
          geofence_override_note: geofenceOverride.override_note,
          geofence_override_by: geofenceOverride.override_by,
          geofence_override_at: geofenceOverride.override_at,
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
    handleIncidentDeleteRoute,
    handleInstallationIncidentsRoute,
    handleIncidentEvidenceRoute,
    handleIncidentStatusRoute,
    handleIncidentPhotosRoute,
  };
}

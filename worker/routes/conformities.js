import { HttpError } from "../lib/core.js";

const CONFORMITY_CREATE_MAX_JSON_BYTES = 512 * 1024;

export function createConformitiesRouteHandlers({
  buildGpsMapsUrl,
  buildGpsMetadataSnapshot,
  jsonResponse,
  corsHeaders,
  parsePositiveInt,
  normalizeOptionalString,
  normalizeGpsPayload,
  normalizeRealtimeTenantId,
  requireWebWriteRole,
  readJsonOrThrowBadRequest,
  logAuditEvent,
  getClientIpForRateLimit,
  nowIso,
  loadInstallationConformityContext,
  loadLatestInstallationConformity,
  loadInstallationConformityPdfById,
  persistInstallationConformity,
  storeSignatureAsset,
  generateConformityPdf,
  storeConformityPdf,
  sendConformityEmail,
  syncPublicTrackingSnapshotForInstallation,
}) {
  function buildPdfDownloadPath(installationId, conformityId) {
    return `/web/installations/${installationId}/conformity/pdf?conformity_id=${conformityId}`;
  }

  function normalizeCreatePayload(body) {
    const signedByName = normalizeOptionalString(body?.signed_by_name, "").trim();
    const signedByDocument = normalizeOptionalString(body?.signed_by_document, "").trim();
    const emailTo = normalizeOptionalString(body?.email_to, "").trim();
    const signatureDataUrl = normalizeOptionalString(body?.signature_data_url, "").trim();
    const summaryNote = normalizeOptionalString(body?.summary_note, "").trim();
    const technicianName = normalizeOptionalString(body?.technician_name, "").trim();
    const technicianNote = normalizeOptionalString(body?.technician_note, "").trim();
    const requestedPhotoIds = Array.isArray(body?.photo_ids) ? body.photo_ids : [];
    const photoIds = [...new Set(
      requestedPhotoIds
        .map((value) => Number.parseInt(String(value), 10))
        .filter((value) => Number.isInteger(value) && value > 0),
    )];
    const includeAllIncidentPhotos = body?.include_all_incident_photos === true || photoIds.length === 0;
    const sendEmail = body?.send_email === true;
    const gps = normalizeGpsPayload(body?.gps, { allowOverride: true });

    if (!signedByName) {
      throw new HttpError(400, "Campo 'signed_by_name' es obligatorio.");
    }
    if (!emailTo) {
      throw new HttpError(400, "Campo 'email_to' es obligatorio.");
    }
    if (!signatureDataUrl) {
      throw new HttpError(400, "Campo 'signature_data_url' es obligatorio.");
    }
    if (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(signatureDataUrl)) {
      throw new HttpError(400, "Campo 'signature_data_url' invalido. Debe ser PNG base64.");
    }

    return {
      signedByName,
      signedByDocument,
      emailTo,
      signatureDataUrl,
      summaryNote,
      technicianName,
      technicianNote,
      includeAllIncidentPhotos,
      photoIds,
      sendEmail,
      gps,
    };
  }

  async function handleInstallationConformityRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
  ) {
    const isConformityRoute =
      routeParts.length === 3 &&
      routeParts[0] === "installations" &&
      routeParts[2] === "conformity";

    const isConformityPdfRoute =
      routeParts.length === 4 &&
      routeParts[0] === "installations" &&
      routeParts[2] === "conformity" &&
      routeParts[3] === "pdf";

    if (!isConformityRoute && !isConformityPdfRoute) {
      return null;
    }

    if (!isWebRoute) {
      throw new HttpError(405, "Ruta disponible solo en /web.");
    }

    const tenantId = normalizeRealtimeTenantId(webSession?.tenant_id);
    const installationId = parsePositiveInt(routeParts[1], "installation_id");

    if (request.method === "GET" && isConformityRoute) {
      const conformity = await loadLatestInstallationConformity(env, installationId, tenantId);
      if (conformity) {
        conformity.pdf_download_path = buildPdfDownloadPath(installationId, conformity.id);
      }
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        conformity,
      });
    }

    if (request.method === "GET" && isConformityPdfRoute) {
      const url = new URL(request.url);
      const conformityId = parsePositiveInt(
        url.searchParams.get("conformity_id"),
        "conformity_id",
      );
      const pdfAsset = await loadInstallationConformityPdfById(
        env,
        installationId,
        conformityId,
        tenantId,
      );
      if (!pdfAsset?.object?.body) {
        throw new HttpError(404, "PDF de conformidad no encontrado.");
      }

      return new Response(pdfAsset.object.body, {
        status: 200,
        headers: {
          ...corsHeaders(request, env, corsPolicy),
          "Content-Type":
            pdfAsset.object.httpMetadata?.contentType || "application/pdf",
          "Content-Disposition": `inline; filename="conformidad_instalacion_${installationId}_${conformityId}.pdf"`,
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }

    if (request.method === "POST" && isConformityRoute) {
      requireWebWriteRole(webSession?.role);

      const payload = normalizeCreatePayload(
        await readJsonOrThrowBadRequest(request, "Payload invalido.", {
          maxBytes: CONFORMITY_CREATE_MAX_JSON_BYTES,
        }),
      );
      const actorUsername = normalizeOptionalString(webSession?.sub, "web");
      const resolvedTechnicianName =
        normalizeOptionalString(payload.technicianName, "") || actorUsername;
      const actorUserId =
        Number.isInteger(webSession?.user_id) && Number(webSession.user_id) > 0
          ? Number(webSession.user_id)
          : null;
      const signedAt = nowIso();
      const generatedAt = nowIso();
      const requestIp = getClientIpForRateLimit(request);

      const context = await loadInstallationConformityContext(env, {
        installationId,
        tenantId,
        includeAllIncidentPhotos: payload.includeAllIncidentPhotos,
        photoIds: payload.photoIds,
      });
      if (!context?.installation) {
        throw new HttpError(404, "Instalacion no encontrada.");
      }

      const signatureAsset = await storeSignatureAsset(env, {
        tenantId,
        installationId,
        signatureDataUrl: payload.signatureDataUrl,
        signedAt,
      });
      const pdfBytes = await generateConformityPdf({
        env,
        context,
        gps: payload.gps,
        signedAt,
        generatedAt,
        signedByName: payload.signedByName,
        signedByDocument: payload.signedByDocument,
        summaryNote: payload.summaryNote,
        technicianName: resolvedTechnicianName,
        technicianNote: payload.technicianNote,
        generatedByUsername: actorUsername,
        signatureR2Key: signatureAsset.r2Key,
        signatureBytes: signatureAsset.bytes,
      });
      const pdfAsset = await storeConformityPdf(env, {
        tenantId,
        installationId,
        pdfBytes,
        generatedAt,
      });

      let emailResult = { delivered: false, skipped: !payload.sendEmail, error: null };
      let status = "generated";
      if (payload.sendEmail) {
        try {
          emailResult = await sendConformityEmail(env, {
            to: payload.emailTo,
            installationId,
            pdfBytes,
            signedByName: payload.signedByName,
            clientName: context.installation?.client_name,
            assetClientName: context.asset?.client_name,
            assetLabel:
              context.asset?.external_code ||
              context.asset?.serial_number ||
              context.asset?.model ||
              "",
            technicianName: resolvedTechnicianName,
            generatedAt,
            summaryNote: payload.summaryNote,
            incidentCount: context.incidents.length,
            photoCount: context.photos.length,
          });
        } catch (error) {
          emailResult = {
            delivered: false,
            skipped: false,
            error: normalizeOptionalString(error?.message, "email_send_failed"),
          };
        }
        status = emailResult?.delivered ? "emailed" : "email_failed";
      }

      const gpsMetadata = buildGpsMetadataSnapshot(payload.gps);
      const mapsUrl = buildGpsMapsUrl(payload.gps);
      const conformity = await persistInstallationConformity(env, {
        installationId,
        tenantId,
        signedByName: payload.signedByName,
        signedByDocument: payload.signedByDocument,
        emailTo: payload.emailTo,
        summaryNote: payload.summaryNote,
        technicianNote: payload.technicianNote,
        signatureR2Key: signatureAsset.r2Key,
        pdfR2Key: pdfAsset.r2Key,
        signedAt,
        generatedAt,
        generatedByUserId: actorUserId,
        generatedByUsername: actorUsername,
        sessionVersion: webSession?.session_version,
        requestIp,
        platform: "web",
        status,
        photoCount: context.photos.length,
        metadataJson: JSON.stringify({
          asset_id: context.asset?.id ?? null,
          incident_ids: context.incidents.map((item) => item.id),
          photo_ids: context.photos.map((item) => item.id),
          include_all_incident_photos: payload.includeAllIncidentPhotos,
          email_requested: payload.sendEmail,
          email_result: emailResult,
          technician_name: resolvedTechnicianName,
          gps: {
            ...gpsMetadata,
            maps_url: mapsUrl || "",
          },
        }),
      });

      await logAuditEvent(env, {
        action: "generate_installation_conformity",
        username: actorUsername,
        success: true,
        tenantId,
        details: {
          conformity_id: conformity?.id,
          installation_id: installationId,
          photo_count: context.photos.length,
          email_to: payload.emailTo,
          email_requested: payload.sendEmail,
          email_result: emailResult,
          technician_name: resolvedTechnicianName,
          gps_capture_status: gpsMetadata.status,
          gps_capture_source: gpsMetadata.source,
          gps_maps_url: mapsUrl || "",
          gps_override_note: gpsMetadata.status === "override"
            ? gpsMetadata.note
            : "",
          gps_accuracy_m: gpsMetadata.accuracy_m,
          tenant_id: tenantId,
        },
        ipAddress: requestIp,
        platform: "web",
      });

      if (gpsMetadata.status === "override") {
        await logAuditEvent(env, {
          action: "override_installation_conformity_gps",
          username: actorUsername,
          success: true,
          tenantId,
          details: {
            conformity_id: conformity?.id,
            installation_id: installationId,
            reason: gpsMetadata.note,
            source: gpsMetadata.source,
            status: gpsMetadata.status,
            email_to: payload.emailTo,
          },
          ipAddress: requestIp,
          platform: "web",
        });
      }

      await syncPublicTrackingSnapshotForInstallation(env, {
        tenantId,
        installationId,
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        conformity: {
          ...conformity,
          pdf_download_path: conformity
            ? buildPdfDownloadPath(installationId, conformity.id)
            : undefined,
        },
      }, 201);
    }

    throw new HttpError(405, "Metodo no permitido para conformidad de instalacion.");
  }

  return {
    handleInstallationConformityRoute,
  };
}

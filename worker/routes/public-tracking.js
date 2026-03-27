export function createPublicTrackingRouteHandlers({
  jsonResponse,
  textResponse,
  requireAdminRole,
  parsePositiveInt,
  getClientIpForRateLimit,
  issuePublicTrackingLink,
  revokePublicTrackingLink,
  getActivePublicTrackingLink,
  resolvePublicTrackingRequest,
  renderPublicTrackingHtml,
  publicTrackingHeaders,
  logAuditEvent,
  resolvePublicTrackingOrigin,
}) {
  async function handlePublicTrackingWebRoute(
    request,
    env,
    url,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
  ) {
    if (
      !isWebRoute ||
      routeParts.length !== 3 ||
      routeParts[0] !== "installations" ||
      routeParts[2] !== "public-tracking-link"
    ) {
      return null;
    }

    requireAdminRole(webSession?.role);
    const installationId = parsePositiveInt(routeParts[1], "installation_id");
    const tenantId = webSession?.tenant_id;
    const requestIp = getClientIpForRateLimit(request);
    const publicTrackingOrigin = resolvePublicTrackingOrigin(env, url.origin);

    if (request.method === "GET") {
      const activeLink = await getActivePublicTrackingLink(env, {
        tenantId,
        installationId,
      });
      const payload = activeLink && activeLink.status === "active"
        ? {
            active: true,
            status: activeLink.status,
            token_id: activeLink.jti,
            short_code: activeLink.short_code || null,
            installation_id: activeLink.installation_id,
            issued_at: activeLink.issued_at,
            expires_at: activeLink.expires_at,
            revoked_at: activeLink.revoked_at,
            tracking_url: `${publicTrackingOrigin}/track/${encodeURIComponent(activeLink.short_code || activeLink.token || "")}`,
            long_tracking_url: `${publicTrackingOrigin}/track/${encodeURIComponent(activeLink.token || "")}`,
            snapshot: activeLink.snapshot || null,
          }
        : {
            active: false,
            status: activeLink?.status || "missing",
            tracking_url: null,
            long_tracking_url: null,
            short_code: null,
            snapshot: activeLink?.snapshot || null,
          };
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        link: payload,
      });
    }

    if (request.method === "POST") {
      const issuedLink = await issuePublicTrackingLink(env, {
        tenantId,
        installationId,
        origin: publicTrackingOrigin,
      });

      await logAuditEvent(env, {
        action: issuedLink.regenerated
          ? "public_tracking_link_regenerated"
          : "public_tracking_link_created",
        username: webSession?.sub || "web_user",
        success: true,
        tenantId,
        details: {
          installation_id: installationId,
          jti: issuedLink.entry.jti,
          short_code: issuedLink.entry.short_code || null,
          expires_at: issuedLink.entry.expires_at,
          tracking_url: issuedLink.url,
          long_tracking_url: issuedLink.longUrl,
          tenant_id: tenantId,
        },
        ipAddress: requestIp,
        platform: "web",
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        link: {
          active: true,
          status: issuedLink.entry.status,
          token_id: issuedLink.entry.jti,
          short_code: issuedLink.entry.short_code || null,
          installation_id: issuedLink.entry.installation_id,
          issued_at: issuedLink.entry.issued_at,
          expires_at: issuedLink.entry.expires_at,
          revoked_at: null,
          tracking_url: issuedLink.url,
          long_tracking_url: issuedLink.longUrl,
          snapshot: issuedLink.entry.snapshot || null,
        },
      }, 201);
    }

    if (request.method === "DELETE") {
      const revokedEntry = await revokePublicTrackingLink(env, {
        tenantId,
        installationId,
      });

      await logAuditEvent(env, {
        action: "public_tracking_link_revoked",
        username: webSession?.sub || "web_user",
        success: true,
        tenantId,
        details: {
          installation_id: installationId,
          jti: revokedEntry?.jti || null,
          short_code: revokedEntry?.short_code || null,
          revoked_at: revokedEntry?.revoked_at || null,
          tenant_id: tenantId,
        },
        ipAddress: requestIp,
        platform: "web",
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        revoked: Boolean(revokedEntry),
      });
    }

    return textResponse(request, env, corsPolicy, "Ruta no encontrada.", 404);
  }

  async function handlePublicTrackingPublicRoute(
    request,
    env,
    corsPolicy,
    routeParts,
  ) {
    if (!Array.isArray(routeParts) || routeParts[0] !== "track" || routeParts.length < 2) {
      return null;
    }

    const token = decodeURIComponent(String(routeParts[1] || ""));
    if (!token) {
      return textResponse(request, env, corsPolicy, "Ruta no encontrada.", 404);
    }

    if (routeParts.length === 2 && request.method === "GET") {
      try {
        await resolvePublicTrackingRequest(env, token);
        return new Response(renderPublicTrackingHtml({ token }), {
          status: 200,
          headers: {
            ...publicTrackingHeaders(),
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      } catch {
        return new Response(
          `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Enlace no disponible</title></head><body><main><h1>Este enlace ya no esta disponible</h1><p>Solicita un nuevo enlace al equipo de soporte.</p></main></body></html>`,
          {
            status: 410,
            headers: {
              ...publicTrackingHeaders(),
              "Content-Type": "text/html; charset=utf-8",
            },
          },
        );
      }
    }

    if (
      routeParts.length === 3 &&
      routeParts[2] === "state" &&
      request.method === "GET"
    ) {
      const trackingRequest = await resolvePublicTrackingRequest(env, token);
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        tracking: trackingRequest.entry.snapshot || null,
      });
    }

    return textResponse(request, env, corsPolicy, "Ruta no encontrada.", 404);
  }

  return {
    handlePublicTrackingPublicRoute,
    handlePublicTrackingWebRoute,
  };
}

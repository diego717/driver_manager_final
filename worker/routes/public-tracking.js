export function createPublicTrackingRouteHandlers({
  HttpError,
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
  const PUBLIC_TRACKING_SSE_POLL_INTERVAL_MS = 10000;
  const PUBLIC_TRACKING_SSE_KEEP_ALIVE_MS = 30000;
  const PUBLIC_TRACKING_VIEW_RATE_LIMIT_MAX_ATTEMPTS = 60;
  const PUBLIC_TRACKING_VIEW_RATE_LIMIT_WINDOW_SECONDS = 5 * 60;
  const PUBLIC_TRACKING_STATE_RATE_LIMIT_MAX_ATTEMPTS = 30;
  const PUBLIC_TRACKING_STATE_RATE_LIMIT_WINDOW_SECONDS = 5 * 60;
  const PUBLIC_TRACKING_EVENTS_RATE_LIMIT_MAX_ATTEMPTS = 6;
  const PUBLIC_TRACKING_EVENTS_RATE_LIMIT_WINDOW_SECONDS = 5 * 60;
  const encoder = new TextEncoder();

  function getPublicTrackingRateLimitStore(env) {
    const kv = env?.RATE_LIMIT_KV;
    if (!kv) return null;
    if (
      typeof kv.get !== "function" ||
      typeof kv.put !== "function" ||
      typeof kv.delete !== "function"
    ) {
      return null;
    }
    return kv;
  }

  function normalizeRateLimitCounter(value) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return 0;
    }
    return parsed;
  }

  function buildPublicTrackingRateLimitKey({ ipAddress, bucket }) {
    return `public_tracking_rate:${String(bucket || "view")}:${String(ipAddress || "unknown").trim() || "unknown"}`;
  }

  async function enforcePublicTrackingRateLimit(env, ipAddress, bucket = "view") {
    const store = getPublicTrackingRateLimitStore(env);
    if (!store) {
      throw new HttpError(
        503,
        "Seguridad publica no configurada: falta RATE_LIMIT_KV para proteger seguimiento publico.",
      );
    }

    const normalizedBucket = bucket === "events"
      ? "events"
      : bucket === "state"
        ? "state"
        : "view";
    const maxAttempts = normalizedBucket === "events"
      ? PUBLIC_TRACKING_EVENTS_RATE_LIMIT_MAX_ATTEMPTS
      : normalizedBucket === "state"
        ? PUBLIC_TRACKING_STATE_RATE_LIMIT_MAX_ATTEMPTS
        : PUBLIC_TRACKING_VIEW_RATE_LIMIT_MAX_ATTEMPTS;
    const windowSeconds = normalizedBucket === "events"
      ? PUBLIC_TRACKING_EVENTS_RATE_LIMIT_WINDOW_SECONDS
      : normalizedBucket === "state"
        ? PUBLIC_TRACKING_STATE_RATE_LIMIT_WINDOW_SECONDS
        : PUBLIC_TRACKING_VIEW_RATE_LIMIT_WINDOW_SECONDS;
    const key = buildPublicTrackingRateLimitKey({ ipAddress, bucket: normalizedBucket });
    const currentAttempts = normalizeRateLimitCounter(await store.get(key));

    if (currentAttempts >= maxAttempts) {
      const error = new HttpError(429, "Demasiadas solicitudes publicas. Intenta nuevamente en unos minutos.");
      error.retryAfterSeconds = windowSeconds;
      throw error;
    }

    await store.put(key, String(currentAttempts + 1), {
      expirationTtl: windowSeconds,
    });
  }

  function encodeSseData(payload) {
    return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  }

  function encodeSseComment(comment) {
    return encoder.encode(`:${String(comment || "ping")}\n\n`);
  }

  function normalizeSnapshotSignature(snapshot) {
    try {
      return JSON.stringify(snapshot || null);
    } catch {
      return "null";
    }
  }

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
            snapshot: activeLink.snapshot || null,
          }
        : {
            active: false,
            status: activeLink?.status || "missing",
            tracking_url: null,
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
    const requestIp = getClientIpForRateLimit(request);
    if (!token) {
      return textResponse(request, env, corsPolicy, "Ruta no encontrada.", 404);
    }

    if (routeParts.length === 2 && request.method === "GET") {
      await enforcePublicTrackingRateLimit(env, requestIp, "view");
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
          renderPublicTrackingHtml({
            token,
            documentTitle: "Enlace no disponible",
            eyebrow: "Acceso de seguimiento",
            connectionLabel: "Sin enlace",
            connectionState: "offline",
            title: "Este enlace ya no esta disponible",
            intro: "Este acceso ya no puede usarse para consultar el estado del servicio.",
            message: "Si necesitas volver a entrar, solicita un nuevo enlace al equipo de soporte.",
            messageTone: "error",
            summaryHidden: false,
            summaryTone: "error",
            summaryBadge: "No disponible",
            summaryText: "Por seguridad, este enlace dejo de estar activo y ya no muestra actualizaciones.",
            metaItems: ["Estado actual: acceso cerrado"],
            timelineEmptyText: "Este enlace ya no tiene eventos disponibles.",
            refreshHidden: true,
            includeClientScript: false,
          }),
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
      await enforcePublicTrackingRateLimit(env, requestIp, "state");
      const trackingRequest = await resolvePublicTrackingRequest(env, token);
      if (!trackingRequest.entry?.snapshot || typeof trackingRequest.entry.snapshot !== "object") {
        return jsonResponse(request, env, corsPolicy, {
          success: false,
          error: {
            code: "SNAPSHOT_UNAVAILABLE",
            message: "El seguimiento publico no esta disponible temporalmente.",
          },
        }, 503);
      }
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        tracking: trackingRequest.entry.snapshot || null,
      });
    }

    if (
      routeParts.length === 3 &&
      routeParts[2] === "events" &&
      request.method === "GET"
    ) {
      await enforcePublicTrackingRateLimit(env, requestIp, "events");
      const trackingRequest = await resolvePublicTrackingRequest(env, token);
      if (!trackingRequest.entry?.snapshot || typeof trackingRequest.entry.snapshot !== "object") {
        return new Response("snapshot_unavailable", {
          status: 503,
          headers: {
            ...publicTrackingHeaders(),
            "Content-Type": "text/plain; charset=utf-8",
            "Retry-After": "15",
          },
        });
      }

      let closed = false;
      let pollTimer = null;
      let keepAliveTimer = null;
      let lastSnapshotSignature = normalizeSnapshotSignature(trackingRequest.entry.snapshot);

      const stream = new ReadableStream({
        start(controller) {
          const closeStream = () => {
            if (closed) return;
            closed = true;
            if (pollTimer) clearInterval(pollTimer);
            if (keepAliveTimer) clearInterval(keepAliveTimer);
            try {
              controller.close();
            } catch {}
          };

          const sendPayload = (payload) => {
            if (closed) return;
            controller.enqueue(encodeSseData(payload));
          };

          const sendComment = (comment) => {
            if (closed) return;
            controller.enqueue(encodeSseComment(comment));
          };

          const pollSnapshot = async () => {
            if (closed) return;
            try {
              const nextRequest = await resolvePublicTrackingRequest(env, token);
              const nextSnapshot = nextRequest.entry?.snapshot || null;
              if (!nextSnapshot || typeof nextSnapshot !== "object") {
                sendPayload({
                  type: "snapshot_unavailable",
                  message: "El seguimiento publico no esta disponible temporalmente.",
                });
                closeStream();
                return;
              }

              const nextSignature = normalizeSnapshotSignature(nextSnapshot);
              if (nextSignature !== lastSnapshotSignature) {
                lastSnapshotSignature = nextSignature;
                sendPayload({
                  type: "tracking_updated",
                  tracking: nextSnapshot,
                });
              }
            } catch (error) {
              const status = Number(error?.status || 0);
              sendPayload({
                type: status === 410 ? "tracking_revoked" : "tracking_expired",
                message: String(error?.message || "Este enlace ya no esta disponible."),
              });
              closeStream();
            }
          };

          sendPayload({
            type: "connected",
            tracking: trackingRequest.entry.snapshot,
          });

          pollTimer = setInterval(() => {
            pollSnapshot().catch(() => {
              closeStream();
            });
          }, PUBLIC_TRACKING_SSE_POLL_INTERVAL_MS);

          keepAliveTimer = setInterval(() => {
            sendComment("ping");
          }, PUBLIC_TRACKING_SSE_KEEP_ALIVE_MS);
        },
        cancel() {
          closed = true;
          if (pollTimer) clearInterval(pollTimer);
          if (keepAliveTimer) clearInterval(keepAliveTimer);
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          ...publicTrackingHeaders(),
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-store",
          Connection: "keep-alive",
        },
      });
    }

    return textResponse(request, env, corsPolicy, "Ruta no encontrada.", 404);
  }

  return {
    handlePublicTrackingPublicRoute,
    handlePublicTrackingWebRoute,
  };
}

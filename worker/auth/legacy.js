export function createLegacyAuthHelpers({
  HttpError,
  LEGACY_API_TENANT_ENV_NAME,
  AUTH_WINDOW_SECONDS,
  AUTH_NONCE_PATTERN,
  AUTH_NONCE_MAX_LENGTH,
  MAX_AUTH_INMEM_BODY_HASH_BYTES,
  EMPTY_BODY_SHA256_HEX,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  nowUnixSeconds,
  timingSafeEqual,
  sha256Hex,
  hmacSha256Hex,
  consumeAuthReplayNonce,
}) {
  function resolveConfiguredLegacyTenantId(env) {
    const configuredTenantId = normalizeOptionalString(
      env?.[LEGACY_API_TENANT_ENV_NAME] ?? env?.API_TENANT_ID,
      "",
    );
    if (!configuredTenantId) {
      throw new HttpError(
        503,
        `API legacy deshabilitada: define ${LEGACY_API_TENANT_ENV_NAME} para fijar el tenant permitido.`,
      );
    }
    return normalizeRealtimeTenantId(configuredTenantId);
  }

  function enforceLegacyTenantBinding(request, configuredTenantId) {
    const requestedTenantId = normalizeOptionalString(request?.headers?.get("X-Tenant-Id"), "");
    if (!requestedTenantId) return;

    const normalizedRequestedTenantId = normalizeRealtimeTenantId(requestedTenantId);
    if (normalizedRequestedTenantId !== configuredTenantId) {
      throw new HttpError(
        403,
        "El tenant solicitado no coincide con el tenant permitido para credenciales legacy.",
      );
    }
  }

  async function verifyAuth(request, env, url) {
    const clientPlatform = (request.headers.get("X-Client-Platform") || "").toLowerCase();
    if (clientPlatform === "mobile") {
      throw new HttpError(
        410,
        "Autenticacion HMAC deshabilitada para clientes moviles. Usa /web/* con Bearer de sesion corta.",
      );
    }

    const configuredTenantId = resolveConfiguredLegacyTenantId(env);
    enforceLegacyTenantBinding(request, configuredTenantId);

    const expectedToken = env.DRIVER_MANAGER_API_TOKEN || env.API_TOKEN;
    const expectedSecret = env.DRIVER_MANAGER_API_SECRET || env.API_SECRET;

    if (!expectedToken || !expectedSecret) {
      throw new HttpError(
        503,
        "API no configurada correctamente. Define DRIVER_MANAGER_API_TOKEN y DRIVER_MANAGER_API_SECRET.",
      );
    }

    const token = request.headers.get("X-API-Token");
    const timestampRaw = request.headers.get("X-Request-Timestamp");
    const signature = request.headers.get("X-Request-Signature");
    const nonce = normalizeOptionalString(request.headers.get("X-Request-Nonce"), "");
    const providedBodyHash = normalizeOptionalString(request.headers.get("X-Body-SHA256"), "");

    if (!token || !timestampRaw || !signature || !nonce) {
      throw new HttpError(401, "Faltan headers de autenticacion.");
    }

    if (!timingSafeEqual(token, expectedToken)) {
      throw new HttpError(401, "Token invalido.");
    }

    const timestamp = Number.parseInt(timestampRaw, 10);
    if (!Number.isInteger(timestamp)) {
      throw new HttpError(401, "Timestamp invalido.");
    }

    const drift = Math.abs(nowUnixSeconds() - timestamp);
    if (drift > AUTH_WINDOW_SECONDS) {
      throw new HttpError(401, "Timestamp fuera de ventana permitida.");
    }
    if (!AUTH_NONCE_PATTERN.test(nonce) || nonce.length > AUTH_NONCE_MAX_LENGTH) {
      throw new HttpError(401, "Nonce invalido.");
    }
    const method = request.method.toUpperCase();
    const isPhotoUploadRoute =
      method === "POST" && /^\/incidents\/\d+\/photos$/i.test(url.pathname);

    let bodyHash = EMPTY_BODY_SHA256_HEX;
    if (providedBodyHash) {
      if (!/^[a-f0-9]{64}$/i.test(providedBodyHash)) {
        throw new HttpError(401, "Header X-Body-SHA256 invalido.");
      }
      bodyHash = providedBodyHash.toLowerCase();
    } else if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      if (isPhotoUploadRoute) {
        throw new HttpError(
          401,
          "Falta header X-Body-SHA256 para upload binario. Actualiza el cliente.",
        );
      }

      const contentLengthRaw = normalizeOptionalString(request.headers.get("content-length"), "");
      const parsedContentLength = Number.parseInt(contentLengthRaw, 10);
      const contentLength = Number.isFinite(parsedContentLength) && parsedContentLength >= 0
        ? parsedContentLength
        : null;

      if (contentLength !== null && contentLength > MAX_AUTH_INMEM_BODY_HASH_BYTES) {
        throw new HttpError(
          401,
          "Body demasiado grande para autenticacion legacy sin X-Body-SHA256.",
        );
      }

      const bodyBytes = await request.clone().arrayBuffer();
      if (bodyBytes.byteLength > MAX_AUTH_INMEM_BODY_HASH_BYTES) {
        throw new HttpError(
          401,
          "Body demasiado grande para autenticacion legacy sin X-Body-SHA256.",
        );
      }

      bodyHash = (await sha256Hex(bodyBytes)) || EMPTY_BODY_SHA256_HEX;
    }

    const canonical = `${request.method.toUpperCase()}|${url.pathname}|${timestamp}|${bodyHash}|${nonce}`;
    const expectedSignature = await hmacSha256Hex(expectedSecret, canonical);

    if (!timingSafeEqual(signature.toLowerCase(), expectedSignature.toLowerCase())) {
      throw new HttpError(401, "Firma invalida.");
    }

    await consumeAuthReplayNonce(env, {
      token,
      timestamp,
      nonce,
    });

    return configuredTenantId;
  }

  return {
    verifyAuth,
  };
}

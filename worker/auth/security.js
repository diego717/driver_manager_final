export function createAuthSecurityHelpers({
  HttpError,
  DEFAULT_REALTIME_TENANT_ID,
  WEB_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  WEB_LOGIN_RATE_LIMIT_LOCKOUT_SECONDS,
  WEB_PASSWORD_VERIFY_RATE_LIMIT_MAX_ATTEMPTS,
  WEB_PASSWORD_VERIFY_RATE_LIMIT_LOCKOUT_SECONDS,
  WEB_AUTH_ALLOW_INSECURE_FALLBACK_ENV,
  AUTH_NONCE_TTL_SECONDS,
  AUTH_NONCE_PATTERN,
  AUTH_NONCE_MAX_LENGTH,
  MAX_AUTH_INMEM_NONCE_TRACKED,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  normalizeWebUsername,
  nowUnixSeconds,
  sha256Hex,
  sanitizeStorageSegment,
  logAuditEvent,
}) {
  let warnedInsecureWebAuthFallback = false;
  const authNonceMemoryStore = new Map();

  function normalizeRateLimitCounter(value) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return 0;
    }
    return parsed;
  }

  function getRateLimitKv(env) {
    const kv = env.RATE_LIMIT_KV;
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

  function parseBooleanEnvFlag(value, fallback = false) {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const normalized = normalizeOptionalString(value, "").toLowerCase();
    if (!normalized) return fallback;
    if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
    return fallback;
  }

  function shouldAllowInsecureWebAuthFallback(env) {
    return parseBooleanEnvFlag(env?.[WEB_AUTH_ALLOW_INSECURE_FALLBACK_ENV], false);
  }

  function warnInsecureWebAuthFallback(capability) {
    if (warnedInsecureWebAuthFallback) return;
    warnedInsecureWebAuthFallback = true;
    console.warn(
      `[web-auth][security] ${capability} sin store persistente. ` +
      `Permitido solo por ${WEB_AUTH_ALLOW_INSECURE_FALLBACK_ENV}=true.`,
    );
  }

  function requireRateLimitStoreForWebAuth(env, capability = "rate limiting") {
    const kv = getRateLimitKv(env);
    if (kv) return kv;
    if (shouldAllowInsecureWebAuthFallback(env)) {
      warnInsecureWebAuthFallback(capability);
      return null;
    }
    throw new HttpError(
      503,
      `Seguridad web no configurada: falta RATE_LIMIT_KV para ${capability}.`,
    );
  }

  function getClientIpForRateLimit(request) {
    const cfIp = normalizeOptionalString(request.headers.get("CF-Connecting-IP"), "");
    if (cfIp) return cfIp;

    const forwardedFor = normalizeOptionalString(request.headers.get("X-Forwarded-For"), "");
    if (forwardedFor) {
      const first = forwardedFor.split(",", 1)[0]?.trim();
      if (first) return first;
    }

    return "unknown";
  }

  function buildWebLoginRateLimitKey(identifier) {
    return `web_login_attempts:${identifier}`;
  }

  function buildWebLoginRateLimitIdentifier(request, username) {
    return `${getClientIpForRateLimit(request)}:${normalizeWebUsername(username)}`;
  }

  function buildWebBootstrapRateLimitIdentifier(request) {
    return `${getClientIpForRateLimit(request)}:bootstrap`;
  }

  function buildWebPasswordVerifyRateLimitKey(identifier) {
    return `web_password_verify_attempts:${identifier}`;
  }

  function buildWebPasswordVerifyRateLimitIdentifier(request, session) {
    const userId = Number.parseInt(String(session?.user_id ?? ""), 10);
    const identityPart = Number.isInteger(userId) && userId > 0
      ? String(userId)
      : normalizeWebUsername(session?.sub || "unknown");
    return `${getClientIpForRateLimit(request)}:${identityPart}`;
  }

  function buildWebAuthFailureAuditDetails(error) {
    return {
      reason: normalizeOptionalString(error?.message, "Error de autenticacion"),
      status_code: Number.isInteger(Number(error?.status)) ? Number(error.status) : 0,
    };
  }

  async function logWebAuditEvent(
    env,
    request,
    {
      action,
      username,
      success = true,
      tenantId = DEFAULT_REALTIME_TENANT_ID,
      details = {},
    },
  ) {
    await logAuditEvent(env, {
      action: normalizeOptionalString(action, "web_event"),
      username: normalizeOptionalString(username, "unknown"),
      success: Boolean(success),
      tenantId: normalizeRealtimeTenantId(tenantId),
      details: details && typeof details === "object" ? details : {},
      ipAddress: getClientIpForRateLimit(request),
      platform: "web",
    });
  }

  function cleanupExpiredAuthNoncesInMemory(nowSeconds) {
    if (authNonceMemoryStore.size === 0) return;
    for (const [key, expiresAt] of authNonceMemoryStore.entries()) {
      if (!Number.isInteger(expiresAt) || expiresAt <= nowSeconds) {
        authNonceMemoryStore.delete(key);
      }
    }
  }

  async function buildAuthReplayNonceStorageKey(token, timestamp, nonce) {
    const tokenDigest = await sha256Hex(new TextEncoder().encode(String(token || "")));
    const tokenPart = tokenDigest
      ? tokenDigest.slice(0, 32)
      : sanitizeStorageSegment(String(token || ""), "token", 32);
    return `auth_nonce:${tokenPart}:${timestamp}:${nonce}`;
  }

  async function consumeAuthReplayNonce(env, { token, timestamp, nonce }) {
    const nonceValue = normalizeOptionalString(nonce, "");
    if (!AUTH_NONCE_PATTERN.test(nonceValue) || nonceValue.length > AUTH_NONCE_MAX_LENGTH) {
      throw new HttpError(401, "Nonce invalido.");
    }

    const key = await buildAuthReplayNonceStorageKey(token, timestamp, nonceValue);
    const kv = getRateLimitKv(env);
    if (kv) {
      const existing = await kv.get(key);
      if (existing) {
        throw new HttpError(401, "Nonce ya utilizado.");
      }
      await kv.put(key, "1", { expirationTtl: AUTH_NONCE_TTL_SECONDS });
      return;
    }

    const nowSeconds = nowUnixSeconds();
    cleanupExpiredAuthNoncesInMemory(nowSeconds);
    const existingExpiry = authNonceMemoryStore.get(key);
    if (Number.isInteger(existingExpiry) && existingExpiry > nowSeconds) {
      throw new HttpError(401, "Nonce ya utilizado.");
    }
    if (authNonceMemoryStore.size >= MAX_AUTH_INMEM_NONCE_TRACKED) {
      cleanupExpiredAuthNoncesInMemory(nowSeconds);
      if (authNonceMemoryStore.size >= MAX_AUTH_INMEM_NONCE_TRACKED) {
        const oldest = authNonceMemoryStore.keys().next();
        if (!oldest.done) {
          authNonceMemoryStore.delete(oldest.value);
        }
      }
    }
    authNonceMemoryStore.set(key, nowSeconds + AUTH_NONCE_TTL_SECONDS);
  }

  async function checkWebLoginRateLimit(env, identifier) {
    const kv = requireRateLimitStoreForWebAuth(env, "rate limiting de login");
    if (!kv) return;

    const key = buildWebLoginRateLimitKey(identifier);
    const attempts = normalizeRateLimitCounter(await kv.get(key));
    if (attempts >= WEB_LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
      throw new HttpError(429, "Demasiados intentos fallidos. Intenta en 15 minutos.");
    }
  }

  async function recordFailedWebLoginAttempt(env, identifier) {
    const kv = requireRateLimitStoreForWebAuth(env, "registro de intentos de login");
    if (!kv) return;

    const key = buildWebLoginRateLimitKey(identifier);
    const currentAttempts = normalizeRateLimitCounter(await kv.get(key));
    await kv.put(key, String(currentAttempts + 1), {
      expirationTtl: WEB_LOGIN_RATE_LIMIT_LOCKOUT_SECONDS,
    });
  }

  async function clearWebLoginRateLimit(env, identifier) {
    const kv = requireRateLimitStoreForWebAuth(env, "limpieza de rate limiting de login");
    if (!kv) return;

    const key = buildWebLoginRateLimitKey(identifier);
    await kv.delete(key);
  }

  async function checkWebPasswordVerifyRateLimit(env, identifier) {
    const kv = requireRateLimitStoreForWebAuth(env, "rate limiting de verificacion de contrasena");
    if (!kv) return;

    const key = buildWebPasswordVerifyRateLimitKey(identifier);
    const attempts = normalizeRateLimitCounter(await kv.get(key));
    if (attempts >= WEB_PASSWORD_VERIFY_RATE_LIMIT_MAX_ATTEMPTS) {
      throw new HttpError(429, "Demasiados intentos fallidos. Intenta nuevamente en unos minutos.");
    }
  }

  async function recordFailedWebPasswordVerifyAttempt(env, identifier) {
    const kv = requireRateLimitStoreForWebAuth(env, "registro de intentos de verificacion");
    if (!kv) return;

    const key = buildWebPasswordVerifyRateLimitKey(identifier);
    const currentAttempts = normalizeRateLimitCounter(await kv.get(key));
    await kv.put(key, String(currentAttempts + 1), {
      expirationTtl: WEB_PASSWORD_VERIFY_RATE_LIMIT_LOCKOUT_SECONDS,
    });
  }

  async function clearWebPasswordVerifyRateLimit(env, identifier) {
    const kv = requireRateLimitStoreForWebAuth(env, "limpieza de rate limiting de verificacion");
    if (!kv) return;

    const key = buildWebPasswordVerifyRateLimitKey(identifier);
    await kv.delete(key);
  }

  return {
    getClientIpForRateLimit,
    buildWebLoginRateLimitIdentifier,
    buildWebBootstrapRateLimitIdentifier,
    buildWebPasswordVerifyRateLimitIdentifier,
    buildWebAuthFailureAuditDetails,
    logWebAuditEvent,
    consumeAuthReplayNonce,
    checkWebLoginRateLimit,
    recordFailedWebLoginAttempt,
    clearWebLoginRateLimit,
    checkWebPasswordVerifyRateLimit,
    recordFailedWebPasswordVerifyAttempt,
    clearWebPasswordVerifyRateLimit,
  };
}

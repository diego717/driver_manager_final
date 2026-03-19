export function createWebSessionHelpers({
  HttpError,
  DEFAULT_REALTIME_TENANT_ID,
  WEB_DEFAULT_ROLE,
  WEB_BEARER_TOKEN_TYPE,
  WEB_ACCESS_TTL_SECONDS,
  WEB_SESSION_COOKIE_NAME,
  WEB_SESSION_STORE_TTL_SECONDS,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  nowUnixSeconds,
  normalizeWebUsername,
  hmacSha256Hex,
  timingSafeEqual,
  base64UrlEncodeUtf8,
  base64UrlDecodeUtf8,
  serializeWebUser,
  getWebUserById,
  getWebUserByUsername,
  ensureDbBinding,
  normalizeActiveFlag,
}) {
  function getBearerToken(request) {
    const authorization = request.headers.get("Authorization") || "";
    const [scheme, token] = authorization.trim().split(/\s+/, 2);
    if (!scheme || !token) return "";
    if (scheme.toLowerCase() !== "bearer") return "";
    return token;
  }

  function parseCookies(request) {
    const cookieHeader = request.headers.get("Cookie") || "";
    if (!cookieHeader) return {};

    return cookieHeader.split(";").reduce((acc, pair) => {
      const [rawName, ...rawValue] = pair.split("=");
      const name = normalizeOptionalString(rawName, "");
      if (!name) return acc;
      try {
        acc[name] = decodeURIComponent(rawValue.join("=") || "");
      } catch {
        // Ignore malformed cookie pairs instead of failing the full request.
      }
      return acc;
    }, {});
  }

  function getWebSessionTokenFromRequest(request) {
    const bearer = getBearerToken(request);
    if (bearer) return bearer;

    const cookies = parseCookies(request);
    return normalizeOptionalString(cookies[WEB_SESSION_COOKIE_NAME], "");
  }

  function buildWebSessionCookie(token, maxAgeSeconds = WEB_ACCESS_TTL_SECONDS) {
    return `${WEB_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
  }

  function buildWebSessionCookieClearHeader() {
    return `${WEB_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
  }

  function getWebSessionStore(env) {
    if (env.WEB_SESSION_KV && typeof env.WEB_SESSION_KV.get === "function") {
      return env.WEB_SESSION_KV;
    }
    return null;
  }

  function requireWebSessionStoreForWebAuth(env, capability = "validar sesiones") {
    const store = getWebSessionStore(env);
    if (store) return store;
    throw new HttpError(
      503,
      `Seguridad web no configurada: falta WEB_SESSION_KV para ${capability}.`,
    );
  }

  function buildWebSessionVersionKey(userId) {
    return `web_session_active:${userId}`;
  }

  async function rotateWebSessionVersion(env, userId) {
    const store = requireWebSessionStoreForWebAuth(env, "rotar sesiones web");
    const nextVersion = nowUnixSeconds();
    if (!Number.isInteger(userId) || userId <= 0) {
      return nextVersion;
    }

    await store.put(buildWebSessionVersionKey(userId), String(nextVersion), {
      expirationTtl: WEB_SESSION_STORE_TTL_SECONDS,
    });
    return nextVersion;
  }

  async function invalidateWebSessionVersion(env, userId) {
    const store = requireWebSessionStoreForWebAuth(env, "invalidar sesiones web");
    if (!Number.isInteger(userId) || userId <= 0) return;

    await store.delete(buildWebSessionVersionKey(userId));
  }

  async function resolveActiveWebSessionVersion(env, userId) {
    const store = requireWebSessionStoreForWebAuth(env, "resolver sesiones web");
    if (!Number.isInteger(userId) || userId <= 0) return null;

    const raw = await store.get(buildWebSessionVersionKey(userId));
    const parsed = Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
  }

  function ensureWebSessionSecret(env) {
    if (!env.WEB_SESSION_SECRET) {
      throw new HttpError(500, "Autenticacion web no configurada. Define WEB_SESSION_SECRET.");
    }
  }

  function buildWebSessionAuthPayload(token, rawUser, extra = {}) {
    return {
      success: true,
      authenticated: true,
      access_token: token.token,
      token_type: WEB_BEARER_TOKEN_TYPE,
      expires_in: token.expires_in,
      expires_at: token.expires_at,
      user: serializeWebUser(rawUser),
      ...extra,
    };
  }

  function buildWebSessionStatusPayload(session, rawUser) {
    const expiresAt = new Date(Number(session.exp) * 1000).toISOString();
    return {
      success: true,
      authenticated: true,
      token_type: WEB_BEARER_TOKEN_TYPE,
      expires_in: Math.max(0, Number(session.exp) - nowUnixSeconds()),
      expires_at: expiresAt,
      user: serializeWebUser(rawUser),
    };
  }

  async function buildWebAccessToken(env, sessionUser = {}) {
    ensureWebSessionSecret(env);

    const iat = nowUnixSeconds();
    const exp = iat + WEB_ACCESS_TTL_SECONDS;
    const sub = normalizeWebUsername(sessionUser.username || "web-user") || "web-user";
    const role = normalizeOptionalString(sessionUser.role, WEB_DEFAULT_ROLE) || WEB_DEFAULT_ROLE;
    const payload = {
      scope: "web",
      sub,
      role,
      iat,
      exp,
    };

    if (Number.isInteger(sessionUser.user_id) && sessionUser.user_id > 0) {
      payload.user_id = sessionUser.user_id;
    }
    if (Number.isInteger(sessionUser.session_version) && sessionUser.session_version > 0) {
      payload.sv = sessionUser.session_version;
    }
    if (normalizeOptionalString(sessionUser.tenant_id, "")) {
      payload.tenant_id = normalizeRealtimeTenantId(sessionUser.tenant_id);
    }

    const encodedPayload = base64UrlEncodeUtf8(JSON.stringify(payload));
    const signature = await hmacSha256Hex(env.WEB_SESSION_SECRET, encodedPayload);

    return {
      token: `${encodedPayload}.${signature}`,
      expires_in: WEB_ACCESS_TTL_SECONDS,
      expires_at: new Date(exp * 1000).toISOString(),
      sub,
      role,
      tenant_id: payload.tenant_id || DEFAULT_REALTIME_TENANT_ID,
    };
  }

  async function verifyWebAccessToken(request, env) {
    ensureWebSessionSecret(env);

    const token = getWebSessionTokenFromRequest(request);
    if (!token) {
      throw new HttpError(401, "Falta token Bearer o cookie de sesion web.");
    }

    const [encodedPayload, signature] = token.split(".", 2);
    if (!encodedPayload || !signature) {
      throw new HttpError(401, "Token web invalido.");
    }

    const expectedSignature = await hmacSha256Hex(env.WEB_SESSION_SECRET, encodedPayload);
    if (!timingSafeEqual(signature.toLowerCase(), expectedSignature.toLowerCase())) {
      throw new HttpError(401, "Token web invalido.");
    }

    let payload = null;
    try {
      payload = JSON.parse(base64UrlDecodeUtf8(encodedPayload));
    } catch {
      throw new HttpError(401, "Token web invalido.");
    }

    if (!payload || payload.scope !== "web") {
      throw new HttpError(401, "Token web invalido.");
    }

    const exp = Number(payload.exp);
    if (!Number.isInteger(exp) || exp <= nowUnixSeconds()) {
      throw new HttpError(401, "Sesion web expirada.");
    }

    const userId = Number.isInteger(payload.user_id) ? payload.user_id : null;
    const tokenSessionVersion = Number(payload.sv || 0);
    const sessionStore = requireWebSessionStoreForWebAuth(env, "validar sesiones web");
    if (
      sessionStore &&
      userId &&
      Number.isInteger(tokenSessionVersion) &&
      tokenSessionVersion > 0
    ) {
      const activeSessionVersion = await resolveActiveWebSessionVersion(env, userId);
      if (!activeSessionVersion || activeSessionVersion !== tokenSessionVersion) {
        throw new HttpError(401, "Sesion web invalida o cerrada.");
      }
    }

    return {
      scope: "web",
      sub: normalizeWebUsername(payload.sub || payload.username || "web-user") || "web-user",
      role: normalizeOptionalString(payload.role, WEB_DEFAULT_ROLE) || WEB_DEFAULT_ROLE,
      tenant_id: normalizeRealtimeTenantId(payload.tenant_id),
      user_id: userId,
      session_version: Number.isInteger(tokenSessionVersion) ? tokenSessionVersion : null,
      iat: Number(payload.iat || 0),
      exp,
    };
  }

  async function resolveCurrentWebSessionUser(env, session) {
    ensureDbBinding(env);

    let user = null;
    if (Number.isInteger(session.user_id) && session.user_id > 0) {
      user = await getWebUserById(env, session.user_id);
    }
    if (!user) {
      user = await getWebUserByUsername(env, session.sub);
    }
    if (!user) {
      throw new HttpError(401, "Sesion web invalida o usuario no encontrado.");
    }
    if (!normalizeActiveFlag(user.is_active, 1)) {
      throw new HttpError(403, "Usuario web inactivo.");
    }
    return user;
  }

  return {
    ensureWebSessionSecret,
    buildWebSessionCookie,
    buildWebSessionCookieClearHeader,
    rotateWebSessionVersion,
    invalidateWebSessionVersion,
    buildWebSessionAuthPayload,
    buildWebSessionStatusPayload,
    buildWebAccessToken,
    verifyWebAccessToken,
    resolveCurrentWebSessionUser,
  };
}

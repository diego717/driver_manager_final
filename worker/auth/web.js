export function createWebAuthRouteHandlers({
  HttpError,
  DEFAULT_REALTIME_TENANT_ID,
  WEB_DEFAULT_ROLE,
  MAX_WEB_AUTH_DEFAULT_BODY_BYTES,
  MAX_WEB_AUTH_IMPORT_BODY_BYTES,
  jsonResponse,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  parsePageLimit,
  parseUsernameIdCursor,
  readJsonOrThrowBadRequest,
  ensureWebSessionSecret,
  normalizeWebUsername,
  validateWebUsername,
  buildWebLoginRateLimitIdentifier,
  buildWebBootstrapRateLimitIdentifier,
  ensureDbBinding,
  checkWebLoginRateLimit,
  authenticateWebUserByCredentials,
  recordFailedWebLoginAttempt,
  logWebAuditEvent,
  buildWebAuthFailureAuditDetails,
  clearWebLoginRateLimit,
  rotateWebSessionVersion,
  buildWebAccessToken,
  buildWebSessionAuthPayload,
  buildWebSessionCookie,
  verifyWebAccessToken,
  buildWebPasswordVerifyRateLimitIdentifier,
  checkWebPasswordVerifyRateLimit,
  verifyCurrentWebUserPassword,
  recordFailedWebPasswordVerifyAttempt,
  clearWebPasswordVerifyRateLimit,
  countWebUsers,
  timingSafeEqual,
  validateWebPassword,
  normalizeWebRole,
  createWebUser,
  canManageAllTenants,
  listWebUsers,
  requireAdminRole,
  assertSameTenantOrSuperAdmin,
  getWebUserById,
  parsePositiveInt,
  parseBooleanOrNull,
  normalizeActiveFlag,
  updateWebUserRoleAndStatus,
  invalidateWebSessionVersion,
  serializeWebUser,
  forceResetWebUserPassword,
  normalizeImportedWebUser,
  upsertWebUserFromImport,
  buildWebSessionCookieClearHeader,
  resolveCurrentWebSessionUser,
  buildWebSessionStatusPayload,
}) {
  function readWebAuthRequestBody(request, maxBytes = MAX_WEB_AUTH_DEFAULT_BODY_BYTES) {
    return readJsonOrThrowBadRequest(request, "Payload invalido.", {
      maxBytes,
    });
  }

  function requireWebAuthStringField(body, fieldName) {
    const value = normalizeOptionalString(body?.[fieldName], "");
    if (!value) {
      throw new HttpError(400, `Campo '${fieldName}' es obligatorio.`);
    }
    return value;
  }

  function sanitizeWebAuthFailure(error, fallbackMessage = "Credenciales web invalidas.") {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      return new HttpError(401, fallbackMessage);
    }
    return error;
  }

  async function handleWebAuthLoginRoute(request, env, corsPolicy) {
    ensureWebSessionSecret(env);

    const body = await readWebAuthRequestBody(request);
    const providedPassword = requireWebAuthStringField(body, "password");

    const providedUsername = normalizeWebUsername(body?.username);
    if (!providedUsername) {
      throw new HttpError(400, "Campo 'username' es obligatorio.");
    }

    const username = validateWebUsername(providedUsername);
    const rateLimitIdentifier = buildWebLoginRateLimitIdentifier(request, username);

    ensureDbBinding(env);
    await checkWebLoginRateLimit(env, rateLimitIdentifier);

    let user = null;
    try {
      user = await authenticateWebUserByCredentials(env, {
        username,
        password: providedPassword,
      });
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        await recordFailedWebLoginAttempt(env, rateLimitIdentifier);

        await logWebAuditEvent(env, request, {
          action: "web_login_failed",
          username,
          success: false,
          tenantId: DEFAULT_REALTIME_TENANT_ID,
          details: buildWebAuthFailureAuditDetails(error),
        });
      }
      throw sanitizeWebAuthFailure(error, "Credenciales web invalidas.");
    }

    await clearWebLoginRateLimit(env, rateLimitIdentifier);

    await logWebAuditEvent(env, request, {
      action: "web_login_success",
      username: user.username,
      tenantId: user.tenant_id,
      details: {
        role: user.role,
        user_id: Number(user.id),
      },
    });

    const sessionVersion = await rotateWebSessionVersion(env, Number(user.id));
    const token = await buildWebAccessToken(env, {
      username: user.username,
      role: user.role,
      user_id: Number(user.id),
      session_version: sessionVersion,
      tenant_id: user.tenant_id,
    });

    const authPayload = buildWebSessionAuthPayload(token, user);

    const response = jsonResponse(
      request,
      env,
      corsPolicy,
      authPayload,
      200,
    );
    response.headers.append("Set-Cookie", buildWebSessionCookie(token.token, token.expires_in));
    return response;
  }

  async function handleWebAuthVerifyPasswordRoute(request, env, corsPolicy) {
    ensureDbBinding(env);
    const session = await verifyWebAccessToken(request, env);
    const rateLimitIdentifier = buildWebPasswordVerifyRateLimitIdentifier(request, session);
    await checkWebPasswordVerifyRateLimit(env, rateLimitIdentifier);

    const body = await readWebAuthRequestBody(request);
    const providedPassword = requireWebAuthStringField(body, "password");

    try {
      const user = await verifyCurrentWebUserPassword(env, session, providedPassword);
      await clearWebPasswordVerifyRateLimit(env, rateLimitIdentifier);

      await logWebAuditEvent(env, request, {
        action: "web_password_verified",
        username: session.sub,
        tenantId: user.tenant_id,
        details: {
          user_id: Number(user.id),
          role: user.role,
        },
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        verified: true,
      });
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        await recordFailedWebPasswordVerifyAttempt(env, rateLimitIdentifier);
        await logWebAuditEvent(env, request, {
          action: "web_password_verify_failed",
          username: session.sub || "unknown",
          success: false,
          tenantId: session.tenant_id,
          details: buildWebAuthFailureAuditDetails(error),
        });
      }
      throw sanitizeWebAuthFailure(error, "No se pudo validar la contrasena.");
    }
  }

  async function handleWebAuthBootstrapRoute(request, env, corsPolicy) {
    ensureDbBinding(env);

    if (!env.WEB_LOGIN_PASSWORD) {
      throw new HttpError(
        500,
        "Bootstrap no configurado. Define WEB_LOGIN_PASSWORD para inicializar el primer usuario web.",
      );
    }

    const rateLimitIdentifier = buildWebBootstrapRateLimitIdentifier(request);
    await checkWebLoginRateLimit(env, rateLimitIdentifier);

    const userCount = await countWebUsers(env);
    if (userCount > 0) {
      throw new HttpError(409, "Bootstrap ya ejecutado. La tabla web_users ya tiene usuarios.");
    }

    const body = await readWebAuthRequestBody(request);
    const bootstrapPassword = requireWebAuthStringField(body, "bootstrap_password");
    if (!timingSafeEqual(bootstrapPassword, String(env.WEB_LOGIN_PASSWORD))) {
      await recordFailedWebLoginAttempt(env, rateLimitIdentifier);
      throw new HttpError(401, "Bootstrap password invalido.");
    }

    const username = validateWebUsername(body?.username);
    const password = validateWebPassword(body?.password);
    const role = normalizeWebRole(body?.role || WEB_DEFAULT_ROLE);
    const tenantId = normalizeRealtimeTenantId(body?.tenant_id);
    const createdUser = await createWebUser(env, { username, password, role, tenantId });
    await clearWebLoginRateLimit(env, rateLimitIdentifier);

    const sessionVersion = await rotateWebSessionVersion(env, Number(createdUser.id));
    const token = await buildWebAccessToken(env, {
      username: createdUser.username,
      role: createdUser.role,
      user_id: Number(createdUser.id),
      session_version: sessionVersion,
      tenant_id: createdUser.tenant_id,
    });

    const bootstrapPayload = buildWebSessionAuthPayload(token, createdUser, {
      bootstrapped: true,
    });

    const response = jsonResponse(
      request,
      env,
      corsPolicy,
      bootstrapPayload,
      201,
    );
    response.headers.append("Set-Cookie", buildWebSessionCookie(token.token, token.expires_in));
    return response;
  }

  async function handleWebAuthUsersListRoute(request, env, corsPolicy) {
    ensureDbBinding(env);

    const session = await verifyWebAccessToken(request, env);
    requireAdminRole(session.role);
    const searchParams = new URL(request.url).searchParams;

    const requestTenantFilter = normalizeOptionalString(
      searchParams.get("tenant_id"),
      "",
    );
    const limit = parsePageLimit(searchParams, { fallback: 100, max: 500 });
    const cursor = parseUsernameIdCursor(searchParams.get("cursor"));
    const usersPage = await listWebUsers(env, {
      tenantId: canManageAllTenants(session.role)
        ? requestTenantFilter || null
        : normalizeRealtimeTenantId(session.tenant_id),
      limit,
      cursor,
    });
    return jsonResponse(
      request,
      env,
      corsPolicy,
      {
        success: true,
        users: usersPage.users,
        pagination: {
          limit,
          has_more: usersPage.hasMore,
          next_cursor: usersPage.nextCursor,
        },
      },
      200,
    );
  }

  async function handleWebAuthUsersCreateRoute(request, env, corsPolicy) {
    ensureDbBinding(env);

    const session = await verifyWebAccessToken(request, env);
    requireAdminRole(session.role);

    const body = await readWebAuthRequestBody(request);

    const username = validateWebUsername(body?.username);
    const password = validateWebPassword(body?.password);
    const role = normalizeWebRole(body?.role || "viewer");
    if (role === "super_admin" && normalizeOptionalString(session.role, "") !== "super_admin") {
      throw new HttpError(403, "Solo super_admin puede crear usuarios super_admin.");
    }
    const sessionTenantId = normalizeRealtimeTenantId(session.tenant_id);
    const requestedTenantId = normalizeOptionalString(body?.tenant_id, "");
    const targetTenantId = requestedTenantId
      ? normalizeRealtimeTenantId(requestedTenantId)
      : sessionTenantId;
    assertSameTenantOrSuperAdmin(session, targetTenantId);

    const createdUser = await createWebUser(env, {
      username,
      password,
      role,
      tenantId: targetTenantId,
    });

    await logWebAuditEvent(env, request, {
      action: "web_user_created",
      username: session.sub,
      tenantId: createdUser.tenant_id,
      details: {
        created_user: createdUser.username,
        created_user_id: createdUser.id,
        created_role: createdUser.role,
        performed_by: session.sub,
        performed_by_role: session.role,
      },
    });

    return jsonResponse(
      request,
      env,
      corsPolicy,
      {
        success: true,
        user: {
          id: createdUser.id,
          username: createdUser.username,
          role: createdUser.role,
          tenant_id: createdUser.tenant_id,
        },
      },
      201,
    );
  }

  async function handleWebAuthUsersPatchRoute(request, env, pathParts, corsPolicy) {
    ensureDbBinding(env);

    const session = await verifyWebAccessToken(request, env);
    requireAdminRole(session.role);

    const userId = parsePositiveInt(pathParts[2], "user_id");
    const existingUser = await getWebUserById(env, userId);
    if (!existingUser) {
      throw new HttpError(404, "Usuario web no encontrado.");
    }
    assertSameTenantOrSuperAdmin(session, existingUser.tenant_id);

    const body = await readWebAuthRequestBody(request);

    const requestedRole = body?.role === undefined ? null : normalizeWebRole(body.role);
    const requestedActive = parseBooleanOrNull(body?.is_active);
    if (requestedRole === null && requestedActive === null) {
      throw new HttpError(400, "Debes enviar al menos uno de: role, is_active.");
    }

    const nextRole = requestedRole === null ? existingUser.role : requestedRole;
    const nextIsActive =
      requestedActive === null ? normalizeActiveFlag(existingUser.is_active, 1) : requestedActive ? 1 : 0;
    if (nextRole === "super_admin" && normalizeOptionalString(session.role, "") !== "super_admin") {
      throw new HttpError(403, "Solo super_admin puede asignar rol super_admin.");
    }
    const roleChanged = normalizeOptionalString(existingUser.role, WEB_DEFAULT_ROLE) !== nextRole;
    const activeChanged = normalizeActiveFlag(existingUser.is_active, 1) !== nextIsActive;

    if (session.user_id && Number(session.user_id) === userId && nextIsActive === 0) {
      throw new HttpError(400, "No puedes desactivar tu propio usuario.");
    }
    if (
      session.user_id &&
      Number(session.user_id) === userId &&
      !["admin", "super_admin"].includes(nextRole)
    ) {
      throw new HttpError(400, "No puedes quitarte permisos de administrador.");
    }

    await updateWebUserRoleAndStatus(env, {
      userId,
      role: nextRole,
      isActive: nextIsActive,
    });
    if (roleChanged || activeChanged) {
      await invalidateWebSessionVersion(env, userId);
    }

    await logWebAuditEvent(env, request, {
      action: "web_user_updated",
      username: session.sub,
      tenantId: existingUser.tenant_id,
      details: {
        updated_user_id: userId,
        updated_user: existingUser.username,
        old_role: existingUser.role,
        new_role: nextRole,
        old_active: Boolean(existingUser.is_active),
        new_active: Boolean(nextIsActive),
        performed_by: session.sub,
        performed_by_role: session.role,
      },
    });

    const updatedUser = await getWebUserById(env, userId);
    return jsonResponse(
      request,
      env,
      corsPolicy,
      {
        success: true,
        user: serializeWebUser(updatedUser),
      },
      200,
    );
  }

  async function handleWebAuthUsersForcePasswordRoute(request, env, pathParts, corsPolicy) {
    ensureDbBinding(env);

    const session = await verifyWebAccessToken(request, env);
    requireAdminRole(session.role);

    const userId = parsePositiveInt(pathParts[2], "user_id");
    const existingUser = await getWebUserById(env, userId);
    if (!existingUser) {
      throw new HttpError(404, "Usuario web no encontrado.");
    }
    assertSameTenantOrSuperAdmin(session, existingUser.tenant_id);

    const body = await readWebAuthRequestBody(request, MAX_WEB_AUTH_IMPORT_BODY_BYTES);

    const newPassword = validateWebPassword(body?.new_password, "new_password");
    await forceResetWebUserPassword(env, { userId, newPassword });
    await invalidateWebSessionVersion(env, userId);

    await logWebAuditEvent(env, request, {
      action: "web_password_reset",
      username: session.sub,
      tenantId: existingUser.tenant_id,
      details: {
        target_user_id: userId,
        target_user: existingUser.username,
        performed_by: session.sub,
        performed_by_role: session.role,
      },
    });

    const updatedUser = await getWebUserById(env, userId);
    return jsonResponse(
      request,
      env,
      corsPolicy,
      {
        success: true,
        user: serializeWebUser(updatedUser),
      },
      200,
    );
  }

  async function handleWebAuthImportUsersRoute(request, env, corsPolicy) {
    ensureDbBinding(env);

    const session = await verifyWebAccessToken(request, env);
    if (!["admin", "super_admin"].includes(session.role)) {
      throw new HttpError(403, "No tienes permisos para importar usuarios web.");
    }

    const body = await readWebAuthRequestBody(request, MAX_WEB_AUTH_IMPORT_BODY_BYTES);

    const users = Array.isArray(body?.users) ? body.users : [];
    if (!users.length) {
      throw new HttpError(400, "Debes enviar al menos un usuario en 'users'.");
    }
    if (users.length > 1000) {
      throw new HttpError(400, "El lote supera el maximo permitido (1000 usuarios).");
    }

    let created = 0;
    let updated = 0;
    const sessionTenantId = normalizeRealtimeTenantId(session.tenant_id);
    const processedUsers = [];
    for (const rawUser of users) {
      const imported = normalizeImportedWebUser(rawUser);
      const targetTenantId = imported.tenantId || sessionTenantId;
      assertSameTenantOrSuperAdmin(session, targetTenantId);
      imported.tenantId = normalizeRealtimeTenantId(targetTenantId);
      const result = await upsertWebUserFromImport(env, imported);
      if (result === "created") created += 1;
      if (result === "updated") updated += 1;
      processedUsers.push({
        username: imported.username,
        role: imported.role,
        tenant_id: imported.tenantId,
        is_active: imported.isActive,
        password_hash_type: imported.passwordHashType,
      });
    }

    await logWebAuditEvent(env, request, {
      action: "web_users_imported",
      username: session.sub,
      tenantId: sessionTenantId,
      details: {
        total_imported: processedUsers.length,
        created,
        updated,
        performed_by: session.sub,
        performed_by_role: session.role,
      },
    });

    return jsonResponse(
      request,
      env,
      corsPolicy,
      {
        success: true,
        imported: processedUsers.length,
        created,
        updated,
        users: processedUsers,
      },
      200,
    );
  }

  async function handleWebAuthLogoutRoute(request, env, corsPolicy) {
    const payload = await verifyWebAccessToken(request, env);
    if (payload.user_id) {
      await invalidateWebSessionVersion(env, Number(payload.user_id));
    }

    const response = jsonResponse(request, env, corsPolicy, {
      success: true,
      authenticated: false,
      logged_out: true,
    });
    response.headers.append("Set-Cookie", buildWebSessionCookieClearHeader());
    return response;
  }

  async function handleWebAuthMeRoute(request, env, corsPolicy) {
    const session = await verifyWebAccessToken(request, env);
    const user = await resolveCurrentWebSessionUser(env, session);
    return jsonResponse(
      request,
      env,
      corsPolicy,
      buildWebSessionStatusPayload(session, user),
    );
  }

  async function handleWebAuthRoute(request, env, pathParts, corsPolicy) {
    if (pathParts.length < 2 || pathParts[0] !== "auth") {
      return null;
    }

    if (pathParts[1] === "login" && request.method === "POST") {
      return handleWebAuthLoginRoute(request, env, corsPolicy);
    }

    if (pathParts[1] === "verify-password" && request.method === "POST") {
      return handleWebAuthVerifyPasswordRoute(request, env, corsPolicy);
    }

    if (pathParts[1] === "bootstrap" && request.method === "POST") {
      return handleWebAuthBootstrapRoute(request, env, corsPolicy);
    }

    if (pathParts[1] === "users" && pathParts.length === 2 && request.method === "GET") {
      return handleWebAuthUsersListRoute(request, env, corsPolicy);
    }

    if (pathParts[1] === "users" && pathParts.length === 2 && request.method === "POST") {
      return handleWebAuthUsersCreateRoute(request, env, corsPolicy);
    }

    if (pathParts[1] === "users" && pathParts.length === 3 && request.method === "PATCH") {
      return handleWebAuthUsersPatchRoute(request, env, pathParts, corsPolicy);
    }

    if (
      pathParts[1] === "users" &&
      pathParts.length === 4 &&
      pathParts[3] === "force-password" &&
      request.method === "POST"
    ) {
      return handleWebAuthUsersForcePasswordRoute(request, env, pathParts, corsPolicy);
    }

    if (pathParts[1] === "import-users" && request.method === "POST") {
      return handleWebAuthImportUsersRoute(request, env, corsPolicy);
    }

    if (pathParts[1] === "logout" && request.method === "POST") {
      return handleWebAuthLogoutRoute(request, env, corsPolicy);
    }

    if (pathParts[1] === "me" && request.method === "GET") {
      return handleWebAuthMeRoute(request, env, corsPolicy);
    }

    return null;
  }

  return {
    handleWebAuthLoginRoute,
    handleWebAuthVerifyPasswordRoute,
    handleWebAuthBootstrapRoute,
    handleWebAuthUsersListRoute,
    handleWebAuthUsersCreateRoute,
    handleWebAuthUsersPatchRoute,
    handleWebAuthUsersForcePasswordRoute,
    handleWebAuthImportUsersRoute,
    handleWebAuthLogoutRoute,
    handleWebAuthMeRoute,
    handleWebAuthRoute,
  };
}

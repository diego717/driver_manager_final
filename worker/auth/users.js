import bcrypt from "bcryptjs";

export function createWebUserAuthHelpers({
  HttpError,
  WEB_USERNAME_PATTERN,
  WEB_PASSWORD_MIN_LENGTH,
  WEB_PASSWORD_SPECIAL_CHARS,
  WEB_PASSWORD_PBKDF2_ITERATIONS,
  WEB_PASSWORD_KEY_LENGTH_BYTES,
  WEB_DEFAULT_ROLE,
  WEB_HASH_TYPE_PBKDF2,
  WEB_HASH_TYPE_BCRYPT,
  WEB_HASH_TYPE_LEGACY_PBKDF2,
  WEB_ALLOWED_HASH_TYPES,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  normalizeWebUsername,
  nowIso,
  timingSafeEqual,
  buildUsernameIdCursor,
  bytesToBase64Url,
  base64UrlToBytes,
}) {
  function ensureWebUsersTableAvailable(error) {
    const message = normalizeOptionalString(error?.message, "").toLowerCase();
    if (
      (message.includes("no such table") && message.includes("web_users")) ||
      (message.includes("no such column") && message.includes("password_hash_type")) ||
      (message.includes("no such column") && message.includes("tenant_id"))
    ) {
      throw new HttpError(
        500,
        "Falta esquema de usuarios web en D1. Ejecuta las migraciones (npm run d1:migrate o d1:migrate:remote).",
      );
    }
    throw error;
  }

  function containsAnyChar(input, allowedChars) {
    for (let i = 0; i < input.length; i += 1) {
      if (allowedChars.includes(input[i])) return true;
    }
    return false;
  }

  function bytesToHex(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function isLikelyLegacyPbkdf2Hex(hash) {
    return /^[a-f0-9]{128,}$/i.test(normalizeOptionalString(hash, ""));
  }

  function detectWebPasswordHashType(storedHashRaw) {
    const storedHash = normalizeOptionalString(storedHashRaw, "");
    if (!storedHash) return WEB_HASH_TYPE_PBKDF2;
    if (storedHash.startsWith(`${WEB_HASH_TYPE_PBKDF2}$`)) return WEB_HASH_TYPE_PBKDF2;
    if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
      return WEB_HASH_TYPE_BCRYPT;
    }
    if (isLikelyLegacyPbkdf2Hex(storedHash)) return WEB_HASH_TYPE_LEGACY_PBKDF2;
    return WEB_HASH_TYPE_PBKDF2;
  }

  function normalizeWebHashType(input, storedHashRaw = "") {
    const requested = normalizeOptionalString(input, "").toLowerCase();
    if (WEB_ALLOWED_HASH_TYPES.has(requested)) return requested;
    return detectWebPasswordHashType(storedHashRaw);
  }

  function validateWebUsername(usernameRaw) {
    const username = normalizeWebUsername(usernameRaw);
    if (!WEB_USERNAME_PATTERN.test(username)) {
      throw new HttpError(
        400,
        "Username invalido. Usa 3-64 caracteres: letras, numeros, punto, guion o guion bajo.",
      );
    }
    return username;
  }

  function validateWebPassword(passwordRaw, fieldName = "password") {
    const password = normalizeOptionalString(passwordRaw, "");
    const errors = [];

    if (password.length < WEB_PASSWORD_MIN_LENGTH) {
      errors.push(`Debe tener al menos ${WEB_PASSWORD_MIN_LENGTH} caracteres.`);
    }
    if (!/[A-Z]/.test(password)) {
      errors.push("Debe contener al menos una letra mayuscula.");
    }
    if (!/[a-z]/.test(password)) {
      errors.push("Debe contener al menos una letra minuscula.");
    }
    if (!/\d/.test(password)) {
      errors.push("Debe contener al menos un numero.");
    }
    if (!containsAnyChar(password, WEB_PASSWORD_SPECIAL_CHARS)) {
      errors.push("Debe contener al menos un caracter especial.");
    }

    if (errors.length > 0) {
      throw new HttpError(400, `Campo '${fieldName}' invalido. ${errors.join(" ")}`);
    }

    return password;
  }

  function parseWebPasswordHash(storedHash) {
    const [algorithm, iterationsRaw, saltEncoded, keyEncoded] = normalizeOptionalString(
      storedHash,
      "",
    ).split("$", 4);

    const iterations = Number.parseInt(iterationsRaw, 10);
    if (
      algorithm !== WEB_HASH_TYPE_PBKDF2 ||
      !Number.isInteger(iterations) ||
      iterations < 10000 ||
      !saltEncoded ||
      !keyEncoded
    ) {
      return null;
    }

    try {
      return {
        iterations,
        saltBytes: base64UrlToBytes(saltEncoded),
        keyEncoded,
      };
    } catch {
      return null;
    }
  }

  async function deriveWebPasswordKey(
    password,
    saltBytes,
    iterations,
    keyLengthBytes = WEB_PASSWORD_KEY_LENGTH_BYTES,
  ) {
    if (!globalThis.crypto?.subtle) {
      throw new HttpError(500, "No hay soporte crypto para autenticacion web.");
    }

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: saltBytes,
        iterations,
      },
      keyMaterial,
      keyLengthBytes * 8,
    );
    return new Uint8Array(bits);
  }

  async function hashWebPassword(password) {
    if (!globalThis.crypto?.getRandomValues) {
      throw new HttpError(500, "No hay soporte crypto para autenticacion web.");
    }

    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const derivedBytes = await deriveWebPasswordKey(
      password,
      saltBytes,
      WEB_PASSWORD_PBKDF2_ITERATIONS,
    );
    return `${WEB_HASH_TYPE_PBKDF2}$${WEB_PASSWORD_PBKDF2_ITERATIONS}$${bytesToBase64Url(saltBytes)}$${bytesToBase64Url(derivedBytes)}`;
  }

  async function verifyLegacyPbkdf2HexPassword(password, storedHashRaw) {
    const storedHash = normalizeOptionalString(storedHashRaw, "").toLowerCase();
    if (!isLikelyLegacyPbkdf2Hex(storedHash) || storedHash.length < 128) return false;

    const saltText = storedHash.slice(0, 64);
    const expectedKeyHex = storedHash.slice(64);
    const keyLengthBytes = Math.max(1, Math.floor(expectedKeyHex.length / 2));
    const derivedBytes = await deriveWebPasswordKey(
      password,
      new TextEncoder().encode(saltText),
      100000,
      keyLengthBytes,
    );
    const candidateHex = bytesToHex(derivedBytes);
    return timingSafeEqual(candidateHex, expectedKeyHex);
  }

  async function verifyBcryptPassword(password, storedHashRaw) {
    const storedHash = normalizeOptionalString(storedHashRaw, "");
    if (!storedHash) return false;
    try {
      return await bcrypt.compare(password, storedHash);
    } catch {
      return false;
    }
  }

  async function verifyWebPassword(password, storedHash, hashTypeRaw = "") {
    const hashType = normalizeWebHashType(hashTypeRaw, storedHash);
    if (hashType === WEB_HASH_TYPE_BCRYPT) {
      return verifyBcryptPassword(password, storedHash);
    }
    if (hashType === WEB_HASH_TYPE_LEGACY_PBKDF2) {
      return verifyLegacyPbkdf2HexPassword(password, storedHash);
    }

    const parsed = parseWebPasswordHash(storedHash);
    if (!parsed) return false;

    const derivedBytes = await deriveWebPasswordKey(password, parsed.saltBytes, parsed.iterations);
    const candidateKey = bytesToBase64Url(derivedBytes);
    return timingSafeEqual(candidateKey, parsed.keyEncoded);
  }

  function normalizeWebRole(roleRaw) {
    const role = normalizeOptionalString(roleRaw, WEB_DEFAULT_ROLE).toLowerCase();
    if (!["admin", "viewer", "super_admin", "platform_owner"].includes(role)) {
      throw new HttpError(400, "Rol web invalido.");
    }
    return role;
  }

  function normalizeActiveFlag(value, fallback = 1) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "boolean") return value ? 1 : 0;
    const normalized = normalizeOptionalString(value, "").toLowerCase();
    if (["1", "true", "yes", "active"].includes(normalized)) return 1;
    if (["0", "false", "no", "inactive"].includes(normalized)) return 0;
    return fallback;
  }

  async function countWebUsers(env) {
    try {
      const { results } = await env.DB.prepare("SELECT COUNT(*) AS total FROM web_users").all();
      return Number(results?.[0]?.total || 0);
    } catch (error) {
      ensureWebUsersTableAvailable(error);
    }
  }

  async function getWebUserByUsername(env, username) {
    try {
      const { results } = await env.DB.prepare(`
        SELECT id, username, password_hash, password_hash_type, role, is_active, created_at, updated_at, last_login_at, tenant_id
        FROM web_users
        WHERE username = ?
        LIMIT 1
      `)
        .bind(username)
        .all();
      return results?.[0] || null;
    } catch (error) {
      ensureWebUsersTableAvailable(error);
    }
  }

  async function getWebUserById(env, userId) {
    try {
      const { results } = await env.DB.prepare(`
        SELECT id, username, password_hash, password_hash_type, role, is_active, created_at, updated_at, last_login_at, tenant_id
        FROM web_users
        WHERE id = ?
        LIMIT 1
      `)
        .bind(userId)
        .all();
      return results?.[0] || null;
    } catch (error) {
      ensureWebUsersTableAvailable(error);
    }
  }

  function serializeWebUser(rawUser) {
    if (!rawUser) return null;
    const normalizedId = Number(rawUser.id);
    return {
      id: Number.isFinite(normalizedId) ? normalizedId : null,
      username: normalizeWebUsername(rawUser.username || rawUser.sub || "web-user") || "web-user",
      role: normalizeWebRole(rawUser.role || WEB_DEFAULT_ROLE),
      tenant_id: normalizeRealtimeTenantId(rawUser.tenant_id),
      is_active: normalizeActiveFlag(rawUser.is_active, 1) === 1,
      created_at: normalizeOptionalString(rawUser.created_at, ""),
      updated_at: normalizeOptionalString(rawUser.updated_at, ""),
      last_login_at: rawUser.last_login_at || null,
    };
  }

  async function listWebUsers(env, options = {}) {
    const tenantId = normalizeOptionalString(options?.tenantId, "");
    const limit = Number.isInteger(options?.limit) ? options.limit : 100;
    const cursor = options?.cursor || null;
    const pageSize = limit + 1;
    try {
      let query = `
        SELECT id, username, role, is_active, created_at, updated_at, last_login_at, tenant_id
        FROM web_users
      `;
      const bindings = [];

      if (tenantId) {
        query += " WHERE tenant_id = ?";
        bindings.push(normalizeRealtimeTenantId(tenantId));
      }

      if (cursor) {
        query += tenantId ? " AND " : " WHERE ";
        query += "(username > ? OR (username = ? AND id > ?))";
        bindings.push(cursor.username, cursor.username, cursor.id);
      }

      query += `
        ORDER BY username ASC, id ASC
        LIMIT ?
      `;
      bindings.push(pageSize);

      const queryResult = await env.DB.prepare(query).bind(...bindings).all();
      const rows = queryResult.results || [];
      const hasMore = rows.length > limit;
      const users = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? buildUsernameIdCursor(users[users.length - 1].username, users[users.length - 1].id)
        : null;

      return {
        users: users.map((row) => serializeWebUser(row)),
        hasMore,
        nextCursor,
      };
    } catch (error) {
      ensureWebUsersTableAvailable(error);
    }
  }

  async function createWebUser(env, { username, password, role, tenantId }) {
    const createdAt = nowIso();
    const passwordHash = await hashWebPassword(password);
    const passwordHashType = WEB_HASH_TYPE_PBKDF2;
    const normalizedTenantId = normalizeRealtimeTenantId(tenantId);

    try {
      const existing = await getWebUserByUsername(env, username);
      if (existing) {
        throw new HttpError(409, "El usuario web ya existe.");
      }

      const insertResult = await env.DB.prepare(`
        INSERT INTO web_users (username, password_hash, password_hash_type, role, tenant_id, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `)
        .bind(username, passwordHash, passwordHashType, role, normalizedTenantId, createdAt, createdAt)
        .run();

      return {
        id: Number(insertResult?.meta?.last_row_id || 0),
        username,
        password_hash_type: passwordHashType,
        role,
        tenant_id: normalizedTenantId,
        is_active: 1,
        created_at: createdAt,
        updated_at: createdAt,
        last_login_at: null,
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      ensureWebUsersTableAvailable(error);
    }
  }

  function normalizeImportedWebUser(rawUser) {
    if (!rawUser || typeof rawUser !== "object") {
      throw new HttpError(400, "Usuario importado invalido.");
    }

    const username = validateWebUsername(rawUser.username);
    const passwordHash = normalizeOptionalString(rawUser.password_hash, "");
    if (!passwordHash) {
      throw new HttpError(400, `Usuario '${username}' sin password_hash.`);
    }

    const passwordHashType = normalizeWebHashType(rawUser.password_hash_type, passwordHash);
    if (!WEB_ALLOWED_HASH_TYPES.has(passwordHashType)) {
      throw new HttpError(400, `Tipo de hash invalido para '${username}'.`);
    }

    return {
      username,
      passwordHash,
      passwordHashType,
      role: normalizeWebRole(rawUser.role || WEB_DEFAULT_ROLE),
      isActive: normalizeActiveFlag(rawUser.is_active, 1),
      tenantId: normalizeRealtimeTenantId(rawUser.tenant_id),
    };
  }

  async function upsertWebUserFromImport(env, importedUser, invalidateWebSessionVersion = null) {
    const existing = await getWebUserByUsername(env, importedUser.username);
    const now = nowIso();

    if (existing) {
      await env.DB.prepare(`
        UPDATE web_users
        SET password_hash = ?, password_hash_type = ?, role = ?, tenant_id = ?, is_active = ?, updated_at = ?
        WHERE id = ?
      `)
        .bind(
          importedUser.passwordHash,
          importedUser.passwordHashType,
          importedUser.role,
          importedUser.tenantId,
          importedUser.isActive,
          now,
          Number(existing.id),
        )
        .run();
      if (typeof invalidateWebSessionVersion === "function") {
        await invalidateWebSessionVersion(env, Number(existing.id));
      }

      return "updated";
    }

    await env.DB.prepare(`
      INSERT INTO web_users (username, password_hash, password_hash_type, role, tenant_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        importedUser.username,
        importedUser.passwordHash,
        importedUser.passwordHashType,
        importedUser.role,
        importedUser.tenantId,
        importedUser.isActive,
        now,
        now,
      )
      .run();
    return "created";
  }

  async function touchWebUserLastLogin(env, userId) {
    const now = nowIso();
    try {
      await env.DB.prepare(`
        UPDATE web_users
        SET last_login_at = ?, updated_at = ?
        WHERE id = ?
      `)
        .bind(now, now, userId)
        .run();
    } catch (error) {
      ensureWebUsersTableAvailable(error);
    }
  }

  async function migrateWebUserPasswordHashToPbkdf2(env, { userId, password }) {
    const now = nowIso();
    const passwordHash = await hashWebPassword(password);
    try {
      await env.DB.prepare(`
        UPDATE web_users
        SET password_hash = ?, password_hash_type = ?, updated_at = ?
        WHERE id = ?
      `)
        .bind(passwordHash, WEB_HASH_TYPE_PBKDF2, now, userId)
        .run();
    } catch (error) {
      ensureWebUsersTableAvailable(error);
    }
  }

  async function updateWebUserRoleAndStatus(env, { userId, role, isActive }) {
    const now = nowIso();
    try {
      await env.DB.prepare(`
        UPDATE web_users
        SET role = ?, is_active = ?, updated_at = ?
        WHERE id = ?
      `)
        .bind(role, isActive, now, userId)
        .run();
    } catch (error) {
      ensureWebUsersTableAvailable(error);
    }
  }

  async function forceResetWebUserPassword(env, { userId, newPassword }) {
    const now = nowIso();
    const passwordHash = await hashWebPassword(newPassword);
    const passwordHashType = WEB_HASH_TYPE_PBKDF2;

    try {
      await env.DB.prepare(`
        UPDATE web_users
        SET password_hash = ?, password_hash_type = ?, updated_at = ?
        WHERE id = ?
      `)
        .bind(passwordHash, passwordHashType, now, userId)
        .run();
    } catch (error) {
      ensureWebUsersTableAvailable(error);
    }
  }

  async function deleteWebUser(env, { userId }) {
    try {
      await env.DB.prepare(`
        DELETE FROM web_users
        WHERE id = ?
      `)
        .bind(userId)
        .run();
    } catch (error) {
      ensureWebUsersTableAvailable(error);
    }
  }

  async function authenticateWebUserByCredentials(env, { username, password }) {
    const user = await getWebUserByUsername(env, username);
    if (!user) {
      throw new HttpError(401, "Credenciales web invalidas.");
    }
    if (!user.is_active) {
      throw new HttpError(403, "Usuario web inactivo.");
    }

    const hashType = normalizeWebHashType(user.password_hash_type, user.password_hash);
    const validPassword = await verifyWebPassword(
      password,
      user.password_hash,
      hashType,
    );
    if (!validPassword) {
      throw new HttpError(401, "Credenciales web invalidas.");
    }

    if (hashType === WEB_HASH_TYPE_BCRYPT) {
      await migrateWebUserPasswordHashToPbkdf2(env, {
        userId: Number(user.id),
        password,
      });
      user.password_hash_type = WEB_HASH_TYPE_PBKDF2;
    }

    await touchWebUserLastLogin(env, Number(user.id));
    return user;
  }

  async function verifyCurrentWebUserPassword(env, session, password) {
    if (!session) {
      throw new HttpError(401, "Sesion web invalida.");
    }

    const sessionUserId = Number.parseInt(String(session.user_id ?? ""), 10);
    const userBySessionId =
      Number.isInteger(sessionUserId) && sessionUserId > 0
        ? await getWebUserById(env, sessionUserId)
        : null;
    const user = userBySessionId || (await getWebUserByUsername(env, session.sub));

    if (!user) {
      throw new HttpError(401, "Sesion web invalida.");
    }
    if (!user.is_active) {
      throw new HttpError(403, "Usuario web inactivo.");
    }

    const userTenantId = normalizeRealtimeTenantId(user.tenant_id);
    const sessionTenantId = normalizeRealtimeTenantId(session.tenant_id);
    if (userTenantId !== sessionTenantId) {
      throw new HttpError(401, "Sesion web invalida.");
    }

    const hashType = normalizeWebHashType(user.password_hash_type, user.password_hash);
    const validPassword = await verifyWebPassword(password, user.password_hash, hashType);
    if (!validPassword) {
      throw new HttpError(401, "Contrasena incorrecta.");
    }

    if (hashType === WEB_HASH_TYPE_BCRYPT) {
      await migrateWebUserPasswordHashToPbkdf2(env, {
        userId: Number(user.id),
        password,
      });
      user.password_hash_type = WEB_HASH_TYPE_PBKDF2;
    }

    return user;
  }

  return {
    ensureWebUsersTableAvailable,
    validateWebUsername,
    validateWebPassword,
    normalizeWebRole,
    countWebUsers,
    getWebUserByUsername,
    getWebUserById,
    serializeWebUser,
    listWebUsers,
    createWebUser,
    normalizeActiveFlag,
    normalizeImportedWebUser,
    upsertWebUserFromImport,
    updateWebUserRoleAndStatus,
    forceResetWebUserPassword,
    deleteWebUser,
    authenticateWebUserByCredentials,
    verifyCurrentWebUserPassword,
  };
}

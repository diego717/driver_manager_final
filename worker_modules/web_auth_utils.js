import bcrypt from "bcryptjs";

import {
  HttpError,
  normalizeOptionalString,
  normalizeWebUsername,
  containsAnyChar,
} from "./core.js";
import {
  bytesToBase64Url,
  base64UrlToBytes,
  bytesToHex,
  timingSafeEqual,
} from "./crypto.js";

export function createWebAuthUtils(config) {
  const {
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
    TENANT_ALLOWED_ROLES,
    TENANT_ROLE_SOLO_LECTURA,
    TENANT_ROLE_ADMIN,
  } = config;

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
    if (!["admin", "viewer", "super_admin"].includes(role)) {
      throw new HttpError(400, "Rol web invalido.");
    }
    return role;
  }

  function normalizeTenantRole(roleRaw, fallback = TENANT_ROLE_SOLO_LECTURA) {
    const role = normalizeOptionalString(roleRaw, fallback).toLowerCase();
    if (!TENANT_ALLOWED_ROLES.has(role)) {
      throw new HttpError(400, "Rol tenant invalido.");
    }
    return role;
  }

  function mapWebRoleToTenantRole(webRoleRaw) {
    const webRole = normalizeWebRole(webRoleRaw || WEB_DEFAULT_ROLE);
    if (webRole === "viewer") return TENANT_ROLE_SOLO_LECTURA;
    return TENANT_ROLE_ADMIN;
  }

  function requireTenantRole(
    actualRoleRaw,
    allowedRoles = [],
    message = "No tienes permisos para esta operacion en el tenant.",
  ) {
    const actualRole = normalizeOptionalString(actualRoleRaw, "").toLowerCase();
    const normalizedAllowed = (allowedRoles || [])
      .map((role) => normalizeOptionalString(role, "").toLowerCase())
      .filter((role) => role);
    if (!normalizedAllowed.includes(actualRole)) {
      throw new HttpError(403, message);
    }
  }

  function parseBooleanOrNull(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const normalized = normalizeOptionalString(value, "").toLowerCase();
    if (!normalized) return null;
    if (["1", "true", "yes", "active", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "inactive", "off"].includes(normalized)) return false;
    return null;
  }

  function requireAdminRole(role) {
    if (!["admin", "super_admin"].includes(normalizeOptionalString(role, "").toLowerCase())) {
      throw new HttpError(403, "No tienes permisos para administrar usuarios web.");
    }
  }

  function normalizeActiveFlag(value, fallback = 1) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "boolean") return value ? 1 : 0;
    const normalized = normalizeOptionalString(value, "").toLowerCase();
    if (["1", "true", "yes", "active"].includes(normalized)) return 1;
    if (["0", "false", "no", "inactive"].includes(normalized)) return 0;
    return fallback;
  }

  return {
    isLikelyLegacyPbkdf2Hex,
    detectWebPasswordHashType,
    normalizeWebHashType,
    validateWebUsername,
    validateWebPassword,
    parseWebPasswordHash,
    deriveWebPasswordKey,
    hashWebPassword,
    verifyLegacyPbkdf2HexPassword,
    verifyBcryptPassword,
    verifyWebPassword,
    normalizeWebRole,
    normalizeTenantRole,
    mapWebRoleToTenantRole,
    requireTenantRole,
    parseBooleanOrNull,
    requireAdminRole,
    normalizeActiveFlag,
  };
}

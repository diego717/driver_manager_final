import {
  HttpError,
  nowIso,
  normalizeOptionalString,
  normalizeWebUsername,
  normalizeRateLimitCounter,
  normalizeNonNegativeInteger,
} from "./core.js";

export function createOperationalUtils(config) {
  const {
    MIN_PHOTO_BYTES,
    MAX_PHOTO_BYTES,
    ALLOWED_PHOTO_TYPES,
    WEB_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    WEB_LOGIN_RATE_LIMIT_LOCKOUT_SECONDS,
  } = config;

  function parsePositiveInt(value, label) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new HttpError(400, `${label} invÃ¡lido.`);
    }
    return parsed;
  }

  function normalizeContentType(headerValue) {
    if (!headerValue) return "";
    return headerValue.split(";")[0].trim().toLowerCase();
  }

  function sanitizeFileName(input, fallbackBase) {
    const candidate = (input || `${fallbackBase}.jpg`).trim();
    const normalized = candidate.replace(/[^a-zA-Z0-9._-]/g, "_");
    return normalized || `${fallbackBase}.jpg`;
  }

  function extensionFromType(contentType) {
    if (contentType === "image/png") return "png";
    if (contentType === "image/webp") return "webp";
    return "jpg";
  }

  function detectPhotoContentTypeFromMagicBytes(bodyBuffer) {
    const bytes = new Uint8Array(bodyBuffer);
    if (bytes.length < 12) return "";

    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isPng =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;
    const isWebp =
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;

    if (isJpeg) return "image/jpeg";
    if (isPng) return "image/png";
    if (isWebp) return "image/webp";
    return "";
  }

  function validateAndProcessPhoto(bodyBuffer, declaredContentType) {
    const sizeBytes = bodyBuffer.byteLength;
    if (!sizeBytes) {
      throw new HttpError(400, "La imagen esta vacia.");
    }
    if (sizeBytes < MIN_PHOTO_BYTES) {
      throw new HttpError(400, "Imagen demasiado pequena o corrupta.");
    }
    if (sizeBytes > MAX_PHOTO_BYTES) {
      throw new HttpError(
        413,
        `Imagen demasiado grande (${(sizeBytes / (1024 * 1024)).toFixed(1)}MB). Maximo: 5MB.`,
      );
    }

    const detectedContentType = detectPhotoContentTypeFromMagicBytes(bodyBuffer);
    if (!detectedContentType) {
      throw new HttpError(400, "El archivo no es una imagen valida.");
    }

    if (!ALLOWED_PHOTO_TYPES.has(detectedContentType)) {
      throw new HttpError(400, "Tipo de imagen no permitido.");
    }

    if (declaredContentType && declaredContentType !== detectedContentType) {
      throw new HttpError(400, "El Content-Type no coincide con el archivo de imagen.");
    }

    return {
      sizeBytes,
      contentType: detectedContentType,
    };
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

  async function checkWebLoginRateLimit(env, identifier) {
    const kv = getRateLimitKv(env);
    if (!kv) return;

    const key = buildWebLoginRateLimitKey(identifier);
    const attempts = normalizeRateLimitCounter(await kv.get(key));
    if (attempts >= WEB_LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
      throw new HttpError(429, "Demasiados intentos fallidos. Intenta en 15 minutos.");
    }
  }

  async function recordFailedWebLoginAttempt(env, identifier) {
    const kv = getRateLimitKv(env);
    if (!kv) return;

    const key = buildWebLoginRateLimitKey(identifier);
    const currentAttempts = normalizeRateLimitCounter(await kv.get(key));
    await kv.put(key, String(currentAttempts + 1), {
      expirationTtl: WEB_LOGIN_RATE_LIMIT_LOCKOUT_SECONDS,
    });
  }

  async function clearWebLoginRateLimit(env, identifier) {
    const kv = getRateLimitKv(env);
    if (!kv) return;

    const key = buildWebLoginRateLimitKey(identifier);
    await kv.delete(key);
  }

  function normalizeInstallationPayload(data, defaultStatus = "unknown") {
    const source = data && typeof data === "object" ? data : {};

    return {
      timestamp: normalizeOptionalString(source.timestamp, nowIso()),
      driver_brand: normalizeOptionalString(source.driver_brand || source.brand, ""),
      driver_version: normalizeOptionalString(source.driver_version || source.version, ""),
      status: normalizeOptionalString(source.status, defaultStatus) || defaultStatus,
      client_name: normalizeOptionalString(source.client_name || source.client, ""),
      driver_description: normalizeOptionalString(
        source.driver_description || source.description,
        "",
      ),
      installation_time_seconds: normalizeNonNegativeInteger(
        source.installation_time_seconds ?? source.installation_time ?? source.time_seconds,
        0,
      ),
      os_info: normalizeOptionalString(source.os_info, ""),
      notes: normalizeOptionalString(source.notes || source.error_message, ""),
    };
  }

  function parseDateOrNull(value) {
    if (!value) return null;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      throw new HttpError(400, "Fecha invalida en filtros.");
    }
    return parsed;
  }

  function parseOptionalPositiveInt(value, label) {
    if (value === null || value === undefined || value === "") return null;
    return parsePositiveInt(value, label);
  }

  function applyInstallationFilters(installations, searchParams) {
    const clientName = normalizeOptionalString(searchParams.get("client_name"), "").toLowerCase();
    const brand = normalizeOptionalString(searchParams.get("brand"), "").toLowerCase();
    const status = normalizeOptionalString(searchParams.get("status"), "").toLowerCase();
    const startDate = parseDateOrNull(searchParams.get("start_date"));
    const endDate = parseDateOrNull(searchParams.get("end_date"));
    const limit = parseOptionalPositiveInt(searchParams.get("limit"), "limit");

    const filtered = (installations || []).filter((row) => {
      if (clientName) {
        const currentClient = normalizeOptionalString(row.client_name, "").toLowerCase();
        if (!currentClient.includes(clientName)) return false;
      }

      if (brand) {
        const currentBrand = normalizeOptionalString(row.driver_brand, "").toLowerCase();
        if (currentBrand !== brand) return false;
      }

      if (status) {
        const currentStatus = normalizeOptionalString(row.status, "").toLowerCase();
        if (currentStatus !== status) return false;
      }

      if (startDate || endDate) {
        const rawTimestamp = normalizeOptionalString(row.timestamp, "");
        const rowDate = rawTimestamp ? new Date(rawTimestamp) : null;
        if (!rowDate || Number.isNaN(rowDate.getTime())) return false;

        if (startDate && rowDate < startDate) return false;
        // Rango semiclosed [start_date, end_date)
        if (endDate && rowDate >= endDate) return false;
      }

      return true;
    });

    if (limit) {
      return filtered.slice(0, limit);
    }

    return filtered;
  }

  function computeStatistics(installations) {
    const rows = installations || [];
    const total = rows.length;

    let success = 0;
    let failed = 0;
    let totalSeconds = 0;
    let timedRows = 0;
    const uniqueClients = new Set();
    const topDrivers = {};
    const byBrand = {};

    for (const row of rows) {
      const rowStatus = normalizeOptionalString(row.status, "").toLowerCase();
      if (rowStatus === "success") success += 1;
      if (rowStatus === "failed") failed += 1;

      const seconds = Number(row.installation_time_seconds);
      if (Number.isFinite(seconds) && seconds >= 0) {
        totalSeconds += seconds;
        timedRows += 1;
      }

      const client = normalizeOptionalString(row.client_name, "");
      if (client) uniqueClients.add(client);

      const brand = normalizeOptionalString(row.driver_brand, "");
      const version = normalizeOptionalString(row.driver_version, "");

      if (brand) {
        byBrand[brand] = (byBrand[brand] || 0) + 1;
      }

      const driverKey = `${brand} ${version}`.trim();
      if (driverKey) {
        topDrivers[driverKey] = (topDrivers[driverKey] || 0) + 1;
      }
    }

    return {
      total_installations: total,
      successful_installations: success,
      failed_installations: failed,
      success_rate: total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0,
      average_time_minutes: timedRows > 0 ? Number(((totalSeconds / timedRows) / 60).toFixed(2)) : 0,
      unique_clients: uniqueClients.size,
      top_drivers: topDrivers,
      by_brand: byBrand,
    };
  }

  function normalizeNotificationData(rawData) {
    if (!rawData || typeof rawData !== "object") {
      return {};
    }

    const normalized = {};
    for (const [key, value] of Object.entries(rawData)) {
      const normalizedKey = normalizeOptionalString(key, "");
      if (!normalizedKey) continue;
      if (value === null || value === undefined) continue;
      normalized[normalizedKey] = String(value);
    }
    return normalized;
  }

  return {
    parsePositiveInt,
    normalizeContentType,
    sanitizeFileName,
    extensionFromType,
    detectPhotoContentTypeFromMagicBytes,
    validateAndProcessPhoto,
    getRateLimitKv,
    getClientIpForRateLimit,
    buildWebLoginRateLimitKey,
    buildWebLoginRateLimitIdentifier,
    checkWebLoginRateLimit,
    recordFailedWebLoginAttempt,
    clearWebLoginRateLimit,
    normalizeInstallationPayload,
    parseDateOrNull,
    parseOptionalPositiveInt,
    applyInstallationFilters,
    computeStatistics,
    normalizeNotificationData,
  };
}

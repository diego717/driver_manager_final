import {
  HttpError,
  normalizeOptionalString,
  parseOptionalPositiveInt,
} from "./core.js";

function encodeCursorPart(value) {
  return encodeURIComponent(String(value ?? ""));
}

function decodeCursorPart(value) {
  return decodeURIComponent(value);
}

export function parsePageLimit(searchParams, options = {}) {
  const fallback = Number.isInteger(options.fallback) ? options.fallback : 100;
  const max = Number.isInteger(options.max) ? options.max : 500;
  const requested = parseOptionalPositiveInt(searchParams.get("limit"), "limit");
  if (requested === null) return fallback;
  return Math.min(requested, max);
}

export function buildTimestampIdCursor(timestamp, id) {
  return `${encodeCursorPart(timestamp)}|${encodeCursorPart(id)}`;
}

export function parseTimestampIdCursor(rawCursor) {
  const cursor = normalizeOptionalString(rawCursor, "");
  if (!cursor) return null;

  const parts = cursor.split("|");
  if (parts.length !== 2) {
    throw new HttpError(400, "Cursor invalido.");
  }

  let timestamp = "";
  let idText = "";
  try {
    timestamp = decodeCursorPart(parts[0]);
    idText = decodeCursorPart(parts[1]);
  } catch {
    throw new HttpError(400, "Cursor invalido.");
  }

  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new HttpError(400, "Cursor invalido.");
  }

  const id = Number.parseInt(idText, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "Cursor invalido.");
  }

  return { timestamp, id };
}

export function buildUsernameIdCursor(username, id) {
  return `${encodeCursorPart(username)}|${encodeCursorPart(id)}`;
}

export function parseUsernameIdCursor(rawCursor) {
  const cursor = normalizeOptionalString(rawCursor, "");
  if (!cursor) return null;

  const parts = cursor.split("|");
  if (parts.length !== 2) {
    throw new HttpError(400, "Cursor invalido.");
  }

  let username = "";
  let idText = "";
  try {
    username = decodeCursorPart(parts[0]);
    idText = decodeCursorPart(parts[1]);
  } catch {
    throw new HttpError(400, "Cursor invalido.");
  }

  if (!username) {
    throw new HttpError(400, "Cursor invalido.");
  }

  const id = Number.parseInt(idText, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "Cursor invalido.");
  }

  return { username, id };
}

export function appendPaginationHeader(response, nextCursor) {
  if (!response || !nextCursor) return response;
  response.headers.set("X-Next-Cursor", nextCursor);

  const expose = response.headers.get("Access-Control-Expose-Headers");
  if (!expose) {
    response.headers.set("Access-Control-Expose-Headers", "X-Next-Cursor");
    return response;
  }

  const normalized = expose.toLowerCase();
  if (!normalized.split(",").map((item) => item.trim()).includes("x-next-cursor")) {
    response.headers.set("Access-Control-Expose-Headers", `${expose}, X-Next-Cursor`);
  }
  return response;
}

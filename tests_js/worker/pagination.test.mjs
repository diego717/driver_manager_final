import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPaginationHeader,
  buildTimestampIdCursor,
  buildUsernameIdCursor,
  parsePageLimit,
  parseTimestampIdCursor,
  parseUsernameIdCursor,
} from "../../worker/lib/pagination.js";

test("pagination helpers clamp limits and preserve configured fallback", () => {
  const withoutLimit = parsePageLimit(new URLSearchParams(), { fallback: 50, max: 200 });
  const aboveMax = parsePageLimit(new URLSearchParams("limit=900"), { fallback: 50, max: 200 });

  assert.equal(withoutLimit, 50);
  assert.equal(aboveMax, 200);
});

test("pagination helpers round-trip timestamp cursors", () => {
  const cursor = buildTimestampIdCursor("2026-03-18T12:00:00.000Z", 77);

  assert.deepEqual(parseTimestampIdCursor(cursor), {
    timestamp: "2026-03-18T12:00:00.000Z",
    id: 77,
  });
  assert.throws(() => parseTimestampIdCursor("broken-cursor"), /Cursor invalido/i);
});

test("pagination helpers round-trip username cursors", () => {
  const cursor = buildUsernameIdCursor("admin.root", 9);

  assert.deepEqual(parseUsernameIdCursor(cursor), {
    username: "admin.root",
    id: 9,
  });
  assert.throws(() => parseUsernameIdCursor("admin.root|0"), /Cursor invalido/i);
});

test("pagination helpers expose the next cursor header only once", () => {
  const response = new Response("ok", {
    headers: {
      "Access-Control-Expose-Headers": "Content-Length",
    },
  });

  appendPaginationHeader(response, "cursor-123");
  appendPaginationHeader(response, "cursor-123");

  assert.equal(response.headers.get("X-Next-Cursor"), "cursor-123");
  assert.equal(
    response.headers.get("Access-Control-Expose-Headers"),
    "Content-Length, X-Next-Cursor",
  );
});

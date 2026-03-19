import { HttpError, normalizeOptionalString } from "../lib/core.js";

export function createLookupRouteHandlers({
  jsonResponse,
  isMissingAssetsTableError,
}) {
  async function handleLookupRoute(request, env, url, corsPolicy, routeParts, lookupTenantId) {
    if (routeParts.length !== 1 || routeParts[0] !== "lookup" || request.method !== "GET") {
      return null;
    }

    const requestedType = normalizeOptionalString(url.searchParams.get("type"), "").toLowerCase();
    const code = normalizeOptionalString(url.searchParams.get("code"), "").trim();

    if (!code) {
      throw new HttpError(400, "Parametro 'code' es obligatorio.");
    }

    if (requestedType && requestedType !== "installation" && requestedType !== "asset") {
      throw new HttpError(400, "Parametro 'type' invalido. Usa installation o asset.");
    }

    const normalizedCode = code.toLowerCase();

    if (requestedType === "installation") {
      const asNumber = Number.parseInt(code, 10);
      if (!Number.isInteger(asNumber) || asNumber <= 0) {
        throw new HttpError(400, "Codigo de instalacion invalido.");
      }

      const { results } = await env.DB.prepare(`
        SELECT id, timestamp, status, client_name, driver_brand, driver_version
        FROM installations
        WHERE id = ?
          AND tenant_id = ?
        LIMIT 1
      `)
        .bind(asNumber, lookupTenantId)
        .all();

      if (!results?.[0]) {
        throw new HttpError(404, "Instalacion no encontrada.");
      }

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        match: {
          type: "installation",
          installation_id: results[0].id,
        },
      });
    }

    let matchedAsset = null;
    try {
      const numericAssetId = Number.parseInt(code, 10);
      const resolvedNumericAssetId =
        Number.isInteger(numericAssetId) && numericAssetId > 0 ? numericAssetId : null;
      const { results: assetMatches } = await env.DB.prepare(`
        SELECT
          a.id,
          a.external_code,
          (
            SELECT l.installation_id
            FROM asset_installation_links l
            WHERE l.asset_id = a.id
              AND l.tenant_id = a.tenant_id
              AND l.unlinked_at IS NULL
            ORDER BY l.linked_at DESC, l.id DESC
            LIMIT 1
          ) AS installation_id
        FROM assets a
        WHERE a.tenant_id = ?
          AND (
            LOWER(a.external_code) = ?
            OR a.external_code = ?
            OR (? IS NOT NULL AND a.id = ?)
          )
        ORDER BY a.id DESC
        LIMIT 1
      `)
        .bind(
          lookupTenantId,
          normalizedCode,
          code,
          resolvedNumericAssetId,
          resolvedNumericAssetId,
        )
        .all();
      matchedAsset = assetMatches?.[0] || null;
    } catch (error) {
      if (!isMissingAssetsTableError(error)) {
        throw error;
      }
    }

    if (matchedAsset) {
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        match: {
          type: "asset",
          asset_record_id: Number(matchedAsset.id),
          asset_id: normalizeOptionalString(matchedAsset.external_code, code),
          external_code: normalizeOptionalString(matchedAsset.external_code, code),
          installation_id: matchedAsset.installation_id ? Number(matchedAsset.installation_id) : null,
        },
      });
    }

    const wildcard = `%${code}%`;
    const { results: installationMatches } = await env.DB.prepare(`
      SELECT id
      FROM installations
      WHERE tenant_id = ?
        AND (
          LOWER(client_name) = ?
          OR LOWER(driver_description) = ?
          OR LOWER(notes) = ?
          OR client_name LIKE ?
          OR driver_description LIKE ?
          OR notes LIKE ?
        )
      ORDER BY id DESC
      LIMIT 1
    `)
      .bind(
        lookupTenantId,
        normalizedCode,
        normalizedCode,
        normalizedCode,
        wildcard,
        wildcard,
        wildcard,
      )
      .all();

    const installationId = installationMatches?.[0]?.id || null;

    return jsonResponse(request, env, corsPolicy, {
      success: true,
      match: {
        type: "asset",
        asset_id: code,
        external_code: code,
        installation_id: installationId,
      },
    });
  }

  return {
    handleLookupRoute,
  };
}

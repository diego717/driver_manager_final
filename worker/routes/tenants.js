import { HttpError } from "../lib/core.js";

const TENANT_STATUS_VALUES = new Set(["active", "suspended"]);

export function createTenantsRouteHandlers({
  jsonResponse,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  readJsonOrThrowBadRequest,
  canManageAllTenants,
  logAuditEvent,
  getClientIpForRateLimit,
  nowIso,
}) {
  const tenantTableColumnCache = new Map();
  const tableForeignKeyCache = new Map();
  const tableCreateSqlCache = new Map();

  function requireAuthenticatedWebSession(isWebRoute, webSession) {
    if (!isWebRoute) {
      throw new HttpError(405, "Ruta disponible solo en /web.");
    }
    if (!webSession?.sub) {
      throw new HttpError(401, "Sesion web invalida.");
    }
  }

  function normalizeTenantSlug(value, fieldName = "slug") {
    const normalized = normalizeOptionalString(value, "")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!normalized || normalized.length < 2 || normalized.length > 64) {
      throw new HttpError(400, `Campo '${fieldName}' invalido.`);
    }
    return normalized;
  }

  function normalizeTenantPayload(body, { allowPartial = false } = {}) {
    const name = normalizeOptionalString(body?.name, "").slice(0, 160);
    const slugInput = normalizeOptionalString(body?.slug, "");
    const planCode = normalizeOptionalString(body?.plan_code, "starter").slice(0, 80);
    const statusRaw = normalizeOptionalString(body?.status, "active").toLowerCase();

    if (!allowPartial && !name) {
      throw new HttpError(400, "Campo 'name' es obligatorio.");
    }

    const payload = {};
    if (!allowPartial || name) payload.name = name;
    if (!allowPartial || slugInput) payload.slug = normalizeTenantSlug(slugInput || name, "slug");
    if (!allowPartial || planCode) payload.planCode = planCode || "starter";
    if (!allowPartial || statusRaw) {
      if (!TENANT_STATUS_VALUES.has(statusRaw)) {
        throw new HttpError(400, "Campo 'status' invalido.");
      }
      payload.status = statusRaw;
    }
    return payload;
  }

  function serializeTenant(row) {
    if (!row) return null;
    const adminUsernames = normalizeOptionalString(row.admin_usernames, "");
    return {
      id: normalizeRealtimeTenantId(row.id),
      name: normalizeOptionalString(row.name, ""),
      slug: normalizeOptionalString(row.slug, ""),
      status: normalizeOptionalString(row.status, "active"),
      plan_code: normalizeOptionalString(row.plan_code, "starter"),
      created_at: normalizeOptionalString(row.created_at, ""),
      updated_at: normalizeOptionalString(row.updated_at, ""),
      metrics: {
        users_count: Number(row.users_count || 0),
        technicians_count: Number(row.technicians_count || 0),
        installations_count: Number(row.installations_count || 0),
        active_incidents_count: Number(row.active_incidents_count || 0),
      },
      admin_usernames: adminUsernames
        ? adminUsernames.split("|").map((item) => item.trim()).filter(Boolean)
        : [],
    };
  }

  async function tableExists(env, tableName) {
    const { results } = await env.DB.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
      LIMIT 1
    `)
      .bind(tableName)
      .all();
    return Boolean(results?.[0]?.name);
  }

  async function tableColumnExists(env, tableName, columnName) {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${tableName})`).all();
    return (results || []).some((row) => normalizeOptionalString(row?.name, "") === columnName);
  }

  async function getTableCreateSql(env, tableName) {
    if (tableCreateSqlCache.has(tableName)) {
      return tableCreateSqlCache.get(tableName);
    }

    const { results } = await env.DB.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
      LIMIT 1
    `)
      .bind(tableName)
      .all();
    const sql = normalizeOptionalString(results?.[0]?.sql, "");
    tableCreateSqlCache.set(tableName, sql);
    return sql;
  }

  function splitSqlDefinitionList(definitionSql) {
    const source = String(definitionSql || "");
    const chunks = [];
    let current = "";
    let depth = 0;

    for (const char of source) {
      if (char === "(") depth += 1;
      if (char === ")") depth = Math.max(0, depth - 1);
      if (char === "," && depth === 0) {
        if (current.trim()) chunks.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  function extractColumnNameFromDefinition(definition) {
    const normalized = normalizeOptionalString(definition, "");
    if (!normalized) return "";
    if (/^(constraint|primary\s+key|foreign\s+key|unique|check)\b/i.test(normalized)) {
      return "";
    }

    const quotedMatch = normalized.match(/^(["`[])(.+?)(["`\]])\s+/);
    if (quotedMatch?.[2]) {
      return quotedMatch[2].trim();
    }
    const bareMatch = normalized.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/);
    return normalizeOptionalString(bareMatch?.[1], "");
  }

  async function getTableMetadataFromCreateSql(env, tableName) {
    const createSql = await getTableCreateSql(env, tableName);
    if (!createSql) {
      return {
        columns: new Set(),
        foreignKeys: [],
      };
    }

    const openParenIndex = createSql.indexOf("(");
    const closeParenIndex = createSql.lastIndexOf(")");
    if (openParenIndex < 0 || closeParenIndex <= openParenIndex) {
      return {
        columns: new Set(),
        foreignKeys: [],
      };
    }

    const innerSql = createSql.slice(openParenIndex + 1, closeParenIndex);
    const definitions = splitSqlDefinitionList(innerSql);
    const columns = new Set();
    const foreignKeys = [];

    for (const definition of definitions) {
      const columnName = extractColumnNameFromDefinition(definition);
      if (columnName) {
        columns.add(columnName);
      }

      const referencedTable = definition.match(/\bREFERENCES\s+["`[]?([a-zA-Z0-9_]+)["`\]]?/i)?.[1];
      if (referencedTable) {
        foreignKeys.push(referencedTable);
      }
    }

    return {
      columns,
      foreignKeys,
    };
  }

  async function getTableColumns(env, tableName) {
    if (tenantTableColumnCache.has(tableName)) {
      return tenantTableColumnCache.get(tableName);
    }

    let columns;
    try {
      const { results } = await env.DB.prepare(`PRAGMA table_info(${tableName})`).all();
      columns = new Set(
        (results || [])
          .map((row) => normalizeOptionalString(row?.name, "").trim())
          .filter(Boolean),
      );
    } catch (_error) {
      columns = (await getTableMetadataFromCreateSql(env, tableName)).columns;
    }
    tenantTableColumnCache.set(tableName, columns);
    return columns;
  }

  async function getTableForeignKeys(env, tableName) {
    if (tableForeignKeyCache.has(tableName)) {
      return tableForeignKeyCache.get(tableName);
    }

    let foreignKeys;
    try {
      const { results } = await env.DB.prepare(`PRAGMA foreign_key_list(${tableName})`).all();
      foreignKeys = (results || [])
        .map((row) => normalizeOptionalString(row?.table, "").trim())
        .filter(Boolean);
    } catch (_error) {
      foreignKeys = (await getTableMetadataFromCreateSql(env, tableName)).foreignKeys;
    }
    tableForeignKeyCache.set(tableName, foreignKeys);
    return foreignKeys;
  }

  async function listUserTables(env) {
    const { results } = await env.DB.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC
    `).all();
    return (results || [])
      .map((row) => normalizeOptionalString(row?.name, "").trim())
      .filter(Boolean);
  }

  async function orderTenantScopedTablesForDelete(env, tableNames) {
    const scopedNames = [...new Set((tableNames || []).filter(Boolean))];
    if (scopedNames.length <= 1) {
      return scopedNames;
    }

    const scopedSet = new Set(scopedNames);
    const dependencyMap = new Map();
    const reverseDependencyMap = new Map();
    const indegreeMap = new Map();

    for (const tableName of scopedNames) {
      dependencyMap.set(tableName, new Set());
      reverseDependencyMap.set(tableName, new Set());
      indegreeMap.set(tableName, 0);
    }

    for (const tableName of scopedNames) {
      const foreignKeys = await getTableForeignKeys(env, tableName);
      for (const referencedTable of foreignKeys) {
        if (!scopedSet.has(referencedTable)) continue;
        dependencyMap.get(tableName).add(referencedTable);
        reverseDependencyMap.get(referencedTable).add(tableName);
      }
    }

    for (const tableName of scopedNames) {
      indegreeMap.set(tableName, dependencyMap.get(tableName).size);
    }

    const ready = scopedNames
      .filter((tableName) => indegreeMap.get(tableName) === 0)
      .sort((left, right) => left.localeCompare(right));
    const ordered = [];

    while (ready.length) {
      const current = ready.shift();
      ordered.push(current);
      for (const dependentTable of reverseDependencyMap.get(current) || []) {
        const nextIndegree = Number(indegreeMap.get(dependentTable) || 0) - 1;
        indegreeMap.set(dependentTable, nextIndegree);
        if (nextIndegree === 0) {
          ready.push(dependentTable);
          ready.sort((left, right) => left.localeCompare(right));
        }
      }
    }

    if (ordered.length !== scopedNames.length) {
      return scopedNames.sort((left, right) => left.localeCompare(right));
    }

    return ordered.reverse();
  }

  async function getTenantTableColumns(env) {
    return getTableColumns(env, "tenants");
  }

  function buildTenantSelectSql(columns, { whereClause = "", orderClause = "", limitClause = "" } = {}) {
    const selectedColumns = [
      "t.id",
      "t.name",
      columns.has("slug") ? "t.slug" : "t.id AS slug",
      columns.has("status") ? "t.status" : "'active' AS status",
      columns.has("plan_code") ? "t.plan_code" : "'starter' AS plan_code",
      columns.has("created_at") ? "t.created_at" : "'' AS created_at",
      columns.has("updated_at") ? "t.updated_at" : "'' AS updated_at",
    ];

    return `
      SELECT
        ${selectedColumns.join(",\n        ")}
      FROM tenants t
      ${whereClause}
      ${orderClause}
      ${limitClause}
    `;
  }

  async function loadTenantMetrics(env, tenantId) {
    const [hasWebUsers, hasTechnicians, hasInstallations, hasIncidents] = await Promise.all([
      tableExists(env, "web_users"),
      tableExists(env, "technicians"),
      tableExists(env, "installations"),
      tableExists(env, "incidents"),
    ]);
    const [incidentsHasDeletedAt, incidentsHasIncidentStatus] = hasIncidents
      ? await Promise.all([
          tableColumnExists(env, "incidents", "deleted_at"),
          tableColumnExists(env, "incidents", "incident_status"),
        ])
      : [false, false];

    const [
      usersCount,
      techniciansCount,
      installationsCount,
      activeIncidentsCount,
    ] = await Promise.all([
      hasWebUsers
        ? env.DB.prepare(`SELECT COUNT(*) AS total FROM web_users WHERE tenant_id = ?`).bind(tenantId).all()
        : { results: [{ total: 0 }] },
      hasTechnicians
        ? env.DB.prepare(`SELECT COUNT(*) AS total FROM technicians WHERE tenant_id = ?`).bind(tenantId).all()
        : { results: [{ total: 0 }] },
      hasInstallations
        ? env.DB.prepare(`SELECT COUNT(*) AS total FROM installations WHERE tenant_id = ?`).bind(tenantId).all()
        : { results: [{ total: 0 }] },
      hasIncidents
        ? env.DB.prepare(`
            SELECT COUNT(*) AS total
            FROM incidents
            WHERE tenant_id = ?
              ${incidentsHasDeletedAt ? "AND deleted_at IS NULL" : ""}
              ${incidentsHasIncidentStatus ? "AND LOWER(COALESCE(incident_status, 'open')) <> 'resolved'" : ""}
          `)
            .bind(tenantId)
            .all()
        : { results: [{ total: 0 }] },
    ]);

    return {
      users_count: Number(usersCount?.results?.[0]?.total || 0),
      technicians_count: Number(techniciansCount?.results?.[0]?.total || 0),
      installations_count: Number(installationsCount?.results?.[0]?.total || 0),
      active_incidents_count: Number(activeIncidentsCount?.results?.[0]?.total || 0),
    };
  }

  async function loadTenantAdminUsernames(env, tenantId) {
    if (!(await tableExists(env, "web_users"))) {
      return [];
    }

    const { results } = await env.DB.prepare(`
      SELECT username
      FROM web_users
      WHERE tenant_id = ?
        AND LOWER(COALESCE(role, 'viewer')) IN ('admin', 'super_admin', 'platform_owner')
      ORDER BY LOWER(username) ASC, id ASC
      LIMIT 5
    `)
      .bind(tenantId)
      .all();

    return (results || [])
      .map((row) => normalizeOptionalString(row.username, "").trim())
      .filter(Boolean);
  }

  async function hydrateTenantRow(env, baseRow) {
    if (!baseRow) return null;
    const tenantId = normalizeRealtimeTenantId(baseRow.id);
    const [metrics, adminUsernames] = await Promise.all([
      loadTenantMetrics(env, tenantId),
      loadTenantAdminUsernames(env, tenantId),
    ]);

    return {
      ...baseRow,
      users_count: metrics.users_count,
      technicians_count: metrics.technicians_count,
      installations_count: metrics.installations_count,
      active_incidents_count: metrics.active_incidents_count,
      admin_usernames: adminUsernames.join("|"),
    };
  }

  async function loadTenantSummaryRow(env, tenantId) {
    const columns = await getTenantTableColumns(env);
    const { results } = await env.DB.prepare(buildTenantSelectSql(columns, {
      whereClause: "WHERE t.id = ?",
      limitClause: "LIMIT 1",
    }))
      .bind(tenantId)
      .all();
    return hydrateTenantRow(env, results?.[0] || null);
  }

  async function loadTenantAdmins(env, tenantId) {
    if (!(await tableExists(env, "web_users"))) {
      return [];
    }
    const columns = await getTableColumns(env, "web_users");
    const tenantFilter = columns.has("tenant_id") ? "tenant_id = ?" : "1 = 1";
    const tenantBindArgs = columns.has("tenant_id") ? [tenantId] : [];
    const roleExpr = columns.has("role") ? "role" : "'admin'";
    const isActiveExpr = columns.has("is_active") ? "is_active" : "1 AS is_active";
    const lastLoginExpr = columns.has("last_login_at") ? "last_login_at" : "NULL AS last_login_at";
    const tenantIdExpr = columns.has("tenant_id") ? "tenant_id" : sqlStringLiteral(tenantId) + " AS tenant_id";

    const { results } = await env.DB.prepare(`
      SELECT
        id,
        username,
        ${roleExpr} AS role,
        ${isActiveExpr},
        ${lastLoginExpr},
        ${tenantIdExpr}
      FROM web_users
      WHERE ${tenantFilter}
        AND LOWER(COALESCE(${columns.has("role") ? "role" : "'admin'"}, 'viewer')) IN ('admin', 'super_admin', 'platform_owner')
      ORDER BY LOWER(username) ASC, id ASC
    `)
      .bind(...tenantBindArgs)
      .all();
    return (results || []).map((row) => ({
      id: Number(row.id),
      username: normalizeOptionalString(row.username, ""),
      role: normalizeOptionalString(row.role, "viewer"),
      is_active: Number(row.is_active ?? 1) === 1,
      last_login_at: row.last_login_at || null,
      tenant_id: normalizeRealtimeTenantId(row.tenant_id),
    }));
  }

  function sqlStringLiteral(value) {
    return `'${String(value ?? "").replace(/'/g, "''")}'`;
  }

  async function loadTenantLatestUsage(env, tenantId) {
    if (!(await tableExists(env, "tenant_usage_snapshots"))) {
      return null;
    }
    const columns = await getTableColumns(env, "tenant_usage_snapshots");
    const recordedAtExpr = columns.has("recorded_at") ? "recorded_at" : "NULL AS recorded_at";
    const orderParts = [
      columns.has("usage_month") ? "usage_month DESC" : null,
      columns.has("recorded_at") ? "recorded_at DESC" : null,
      columns.has("id") ? "id DESC" : null,
    ].filter(Boolean);

    const { results } = await env.DB.prepare(`
      SELECT
        ${columns.has("usage_month") ? "usage_month" : "'' AS usage_month"},
        ${columns.has("users_count") ? "users_count" : "0 AS users_count"},
        ${columns.has("storage_bytes") ? "storage_bytes" : "0 AS storage_bytes"},
        ${columns.has("incidents_count") ? "incidents_count" : "0 AS incidents_count"},
        ${recordedAtExpr}
      FROM tenant_usage_snapshots
      WHERE tenant_id = ?
      ${orderParts.length ? `ORDER BY ${orderParts.join(", ")}` : ""}
      LIMIT 1
    `)
      .bind(tenantId)
      .all();
    const row = results?.[0] || null;
    if (!row) return null;
    return {
      usage_month: normalizeOptionalString(row.usage_month, ""),
      users_count: Number(row.users_count || 0),
      storage_bytes: Number(row.storage_bytes || 0),
      incidents_count: Number(row.incidents_count || 0),
      recorded_at: normalizeOptionalString(row.recorded_at, ""),
    };
  }

  async function loadTenantDetailSupport(env, tenantId) {
    const [adminsResult, latestUsageResult] = await Promise.allSettled([
      loadTenantAdmins(env, tenantId),
      loadTenantLatestUsage(env, tenantId),
    ]);

    return {
      admins: adminsResult.status === "fulfilled" ? adminsResult.value : [],
      latestUsage: latestUsageResult.status === "fulfilled" ? latestUsageResult.value : null,
    };
  }

  async function deleteTenantScopedRows(env, tenantId) {
    const summary = await summarizeTenantScopedRows(env, tenantId);
    const tableNames = await orderTenantScopedTablesForDelete(env, Object.keys(summary.deletedCounts));

    for (const tableName of tableNames) {
      await env.DB.prepare(`
        DELETE FROM ${tableName}
        WHERE tenant_id = ?
      `)
        .bind(tenantId)
        .run();
    }

    return summary.deletedCounts;
  }

  async function summarizeTenantScopedRows(env, tenantId) {
    const tableNames = await listUserTables(env);
    const deletedCounts = {};
    let totalRows = 0;

    for (const tableName of tableNames) {
      if (tableName === "tenants") continue;
      const columns = await getTableColumns(env, tableName);
      if (!columns.has("tenant_id")) continue;

      const countResult = await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM ${tableName}
        WHERE tenant_id = ?
      `)
        .bind(tenantId)
        .all();
      const count = Number(countResult?.results?.[0]?.total || 0);
      if (count <= 0) continue;
      deletedCounts[tableName] = count;
      totalRows += count;
    }

    return {
      deletedCounts,
      totalRows,
    };
  }

  async function handleTenantsRoute(request, env, _url, corsPolicy, routeParts, isWebRoute, webSession) {
    if (!routeParts.length || routeParts[0] !== "tenants") {
      return null;
    }

    requireAuthenticatedWebSession(isWebRoute, webSession);
    if (!canManageAllTenants(webSession)) {
      throw new HttpError(403, "Solo el super_admin de plataforma puede administrar tenants.");
    }

    if (routeParts.length === 1 && request.method === "GET") {
      const tenantColumns = await getTenantTableColumns(env);
      const { results } = await env.DB.prepare(buildTenantSelectSql(tenantColumns, {
        orderClause: "ORDER BY LOWER(COALESCE(t.name, t.id)) ASC, t.id ASC",
      })).all();

      const hydratedTenants = await Promise.all(
        (results || []).map((row) => hydrateTenantRow(env, row)),
      );

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        tenants: hydratedTenants.map((row) => serializeTenant(row)),
      });
    }

    if (routeParts.length === 1 && request.method === "POST") {
      const payload = normalizeTenantPayload(await readJsonOrThrowBadRequest(request));
      const tenantId = payload.slug;
      const timestamp = nowIso();
      const tenantColumns = await getTenantTableColumns(env);
      const insertColumns = ["id", "name"];
      const insertValues = [tenantId, payload.name];

      if (tenantColumns.has("slug")) {
        insertColumns.push("slug");
        insertValues.push(payload.slug);
      }
      if (tenantColumns.has("status")) {
        insertColumns.push("status");
        insertValues.push(payload.status);
      }
      if (tenantColumns.has("plan_code")) {
        insertColumns.push("plan_code");
        insertValues.push(payload.planCode);
      }
      if (tenantColumns.has("created_at")) {
        insertColumns.push("created_at");
        insertValues.push(timestamp);
      }
      if (tenantColumns.has("updated_at")) {
        insertColumns.push("updated_at");
        insertValues.push(timestamp);
      }

      try {
        await env.DB.prepare(`
          INSERT INTO tenants (
            ${insertColumns.join(",\n            ")}
          )
          VALUES (${insertColumns.map(() => "?").join(", ")})
        `)
          .bind(...insertValues)
          .run();
      } catch (error) {
        const message = normalizeOptionalString(error?.message, "").toLowerCase();
        if (message.includes("unique constraint failed")) {
          throw new HttpError(409, "Ya existe un tenant con ese identificador o slug.");
        }
        throw error;
      }

      const tenant = serializeTenant(await loadTenantSummaryRow(env, tenantId));
      await logAuditEvent(env, {
        action: "tenant_created",
        username: webSession.sub,
        success: true,
        tenantId,
        details: {
          tenant_id: tenantId,
          tenant_name: payload.name,
          plan_code: payload.planCode,
          status: payload.status,
        },
        ipAddress: getClientIpForRateLimit(request),
        platform: "web",
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        tenant,
      }, 201);
    }

    if (routeParts.length === 2 && request.method === "GET") {
      const tenantId = normalizeTenantSlug(routeParts[1], "tenant_id");
      const tenantRow = await loadTenantSummaryRow(env, tenantId);
      if (!tenantRow) {
        throw new HttpError(404, "Tenant no encontrado.");
      }

      const { admins, latestUsage } = await loadTenantDetailSupport(env, tenantId);

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        tenant: serializeTenant(tenantRow),
        admins,
        latest_usage: latestUsage,
      });
    }

    if (routeParts.length === 3 && routeParts[2] === "delete-impact" && request.method === "GET") {
      const tenantId = normalizeTenantSlug(routeParts[1], "tenant_id");
      if (tenantId === "default") {
        throw new HttpError(400, "No puedes eliminar el tenant default.");
      }

      const existing = await loadTenantSummaryRow(env, tenantId);
      if (!existing) {
        throw new HttpError(404, "Tenant no encontrado.");
      }

      const impact = await summarizeTenantScopedRows(env, tenantId);
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        tenant: serializeTenant(existing),
        impact: {
          deleted_tables: impact.deletedCounts,
          total_rows: impact.totalRows,
        },
      });
    }

    if (routeParts.length === 2 && request.method === "PATCH") {
      const tenantId = normalizeTenantSlug(routeParts[1], "tenant_id");
      const existing = await loadTenantSummaryRow(env, tenantId);
      if (!existing) {
        throw new HttpError(404, "Tenant no encontrado.");
      }

      const payload = normalizeTenantPayload(await readJsonOrThrowBadRequest(request), {
        allowPartial: true,
      });
      if (!payload.name && !payload.slug && !payload.status && !payload.planCode) {
        throw new HttpError(400, "Debes enviar al menos un campo editable.");
      }

      const nextSlug = payload.slug || existing.slug;
      const nextName = payload.name || existing.name;
      const nextStatus = payload.status || existing.status;
      const nextPlanCode = payload.planCode || existing.plan_code;
      const updatedAt = nowIso();
      const tenantColumns = await getTenantTableColumns(env);
      const updateFragments = ["name = ?"];
      const updateValues = [nextName];

      if (tenantColumns.has("slug")) {
        updateFragments.push("slug = ?");
        updateValues.push(nextSlug);
      }
      if (tenantColumns.has("status")) {
        updateFragments.push("status = ?");
        updateValues.push(nextStatus);
      }
      if (tenantColumns.has("plan_code")) {
        updateFragments.push("plan_code = ?");
        updateValues.push(nextPlanCode);
      }
      if (tenantColumns.has("updated_at")) {
        updateFragments.push("updated_at = ?");
        updateValues.push(updatedAt);
      }
      updateValues.push(tenantId);

      try {
        await env.DB.prepare(`
          UPDATE tenants
          SET
            ${updateFragments.join(",\n            ")}
          WHERE id = ?
        `)
          .bind(...updateValues)
          .run();
      } catch (error) {
        const message = normalizeOptionalString(error?.message, "").toLowerCase();
        if (message.includes("unique constraint failed")) {
          throw new HttpError(409, "Ya existe un tenant con ese slug.");
        }
        throw error;
      }

      const tenant = serializeTenant(await loadTenantSummaryRow(env, tenantId));
      await logAuditEvent(env, {
        action: "tenant_updated",
        username: webSession.sub,
        success: true,
        tenantId,
        details: {
          tenant_id: tenantId,
          name: tenant?.name || nextName,
          slug: tenant?.slug || nextSlug,
          status: tenant?.status || nextStatus,
          plan_code: tenant?.plan_code || nextPlanCode,
        },
        ipAddress: getClientIpForRateLimit(request),
        platform: "web",
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        tenant,
      });
    }

    if (routeParts.length === 2 && request.method === "DELETE") {
      const tenantId = normalizeTenantSlug(routeParts[1], "tenant_id");
      if (tenantId === "default") {
        throw new HttpError(400, "No puedes eliminar el tenant default.");
      }

      const existing = await loadTenantSummaryRow(env, tenantId);
      if (!existing) {
        throw new HttpError(404, "Tenant no encontrado.");
      }

      const deletedCounts = await deleteTenantScopedRows(env, tenantId);
      await env.DB.prepare(`
        DELETE FROM tenants
        WHERE id = ?
      `)
        .bind(tenantId)
        .run();

      await logAuditEvent(env, {
        action: "tenant_deleted",
        username: webSession.sub,
        success: true,
        tenantId,
        details: {
          tenant_id: tenantId,
          tenant_name: existing.name,
          deleted_tables: deletedCounts,
        },
        ipAddress: getClientIpForRateLimit(request),
        platform: "web",
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        deleted: true,
        tenant_id: tenantId,
        deleted_tables: deletedCounts,
      });
    }

    return null;
  }

  return {
    handleTenantsRoute,
  };
}

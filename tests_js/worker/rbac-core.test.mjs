import assert from "node:assert/strict";
import test from "node:test";

import {
  canEditAssetCatalog,
  canManageAssetLinks,
  canManageAssetLoans,
  canReopenIncidents,
  canViewAssetCatalog,
  canViewAssetDetail,
  canViewTechnicianCatalog,
  canViewTenantIncidentMap,
} from "../../worker/lib/core.js";

test("RBAC helpers reflect the documented technician restrictions", () => {
  assert.equal(canViewTechnicianCatalog("admin"), true);
  assert.equal(canViewTechnicianCatalog("supervisor"), true);
  assert.equal(canViewTechnicianCatalog("solo_lectura"), true);
  assert.equal(canViewTechnicianCatalog("tecnico"), false);

  assert.equal(canViewTenantIncidentMap("admin"), true);
  assert.equal(canViewTenantIncidentMap("supervisor"), true);
  assert.equal(canViewTenantIncidentMap("solo_lectura"), true);
  assert.equal(canViewTenantIncidentMap("tecnico"), false);

  assert.equal(canReopenIncidents("admin"), true);
  assert.equal(canReopenIncidents("supervisor"), true);
  assert.equal(canReopenIncidents("tecnico"), false);
});

test("RBAC helpers split asset catalog, scoped detail and operational controls", () => {
  assert.equal(canViewAssetCatalog("admin"), true);
  assert.equal(canViewAssetCatalog("supervisor"), true);
  assert.equal(canViewAssetCatalog("solo_lectura"), true);
  assert.equal(canViewAssetCatalog("tecnico"), false);

  assert.equal(canViewAssetDetail("tecnico"), true);
  assert.equal(canEditAssetCatalog("admin"), true);
  assert.equal(canEditAssetCatalog("supervisor"), false);
  assert.equal(canManageAssetLinks("supervisor"), true);
  assert.equal(canManageAssetLoans("supervisor"), true);
  assert.equal(canManageAssetLoans("tecnico"), false);
});

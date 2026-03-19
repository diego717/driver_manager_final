import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIncidentPhotoDescriptor,
  buildIncidentPhotoFileName,
  loadIncidentForTenant,
  requireIncidentsBucketOperation,
  validateAndProcessPhoto,
} from "../../worker/services/incidents.js";

test("incident service builds sanitized photo descriptors and file names", () => {
  const descriptor = buildIncidentPhotoDescriptor({
    installationId: 12,
    incidentId: 34,
    clientName: "Clïente Norte",
    assetCode: " Eq/01 ",
  });
  const fileName = buildIncidentPhotoFileName({
    installationId: 12,
    incidentId: 34,
    clientName: "Clïente Norte",
    assetCode: " Eq/01 ",
    extension: "jpg",
  });

  assert.equal(descriptor, "inst-12_inc-34_cliente-cliente-norte_equipo-eq-01");
  assert.equal(fileName, "inst-12_inc-34_cliente-cliente-norte_equipo-eq-01.jpg");
});

test("incident service validates image payloads against size and content type", () => {
  const bytes = new Uint8Array(1024);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;

  const result = validateAndProcessPhoto(bytes.buffer, "image/jpeg");

  assert.deepEqual(result, {
    sizeBytes: 1024,
    contentType: "image/jpeg",
  });
  assert.throws(
    () => validateAndProcessPhoto(bytes.buffer, "image/png"),
    /Content-Type no coincide/i,
  );
});

test("incident service loads incidents scoped by tenant and installation", async () => {
  const db = {
    prepare(sql) {
      assert.match(sql, /AND i\.installation_id = \?/);
      return {
        bind(...args) {
          assert.deepEqual(args, [77, "tenant-a", "tenant-a", 55]);
          return this;
        },
        async all() {
          return {
            results: [{ id: 77, installation_id: 55 }],
          };
        },
      };
    },
  };

  const incident = await loadIncidentForTenant(
    { DB: db },
    {
      incidentId: 77,
      incidentsTenantId: "tenant-a",
      installationId: 55,
    },
  );

  assert.deepEqual(incident, { id: 77, installation_id: 55 });
});

test("incident service requires a configured R2 bucket operation", () => {
  const bucket = {
    async get() {
      return null;
    },
  };

  assert.equal(
    requireIncidentsBucketOperation({ INCIDENTS_BUCKET: bucket }, "get"),
    bucket,
  );
  assert.throws(
    () => requireIncidentsBucketOperation({}, "get"),
    /INCIDENTS_BUCKET/i,
  );
});

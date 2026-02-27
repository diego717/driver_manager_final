import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const openApiPath = path.join(process.cwd(), "docs", "incidents-v1.openapi.yaml");

function loadSpec() {
  const raw = fs.readFileSync(openApiPath, "utf8");
  return YAML.parse(raw);
}

function getParameterNames(operation) {
  return new Set((operation?.parameters || []).map((parameter) => parameter.name));
}

test("OpenAPI file is valid YAML with expected metadata", () => {
  const spec = loadSpec();

  assert.equal(spec.openapi, "3.0.3");
  assert.equal(spec.info?.title, "Driver Manager Incidents API (v1)");
  assert.equal(spec.info?.version, "1.0.0");
  assert.equal(typeof spec.paths, "object");
});

test("OpenAPI declares API token security scheme and global security requirement", () => {
  const spec = loadSpec();
  const apiTokenScheme = spec.components?.securitySchemes?.ApiToken;

  assert.equal(apiTokenScheme?.type, "apiKey");
  assert.equal(apiTokenScheme?.in, "header");
  assert.equal(apiTokenScheme?.name, "X-API-Token");
  assert.equal(Array.isArray(spec.security), true);
  assert.ok(spec.security.some((entry) => Object.prototype.hasOwnProperty.call(entry, "ApiToken")));
});

test("OpenAPI incidents route defines GET/POST contract and signed headers", () => {
  const spec = loadSpec();
  const pathItem = spec.paths?.["/installations/{installationId}/incidents"];

  assert.ok(pathItem);
  assert.ok(pathItem.get);
  assert.ok(pathItem.post);

  const getParameters = getParameterNames(pathItem.get);
  assert.ok(getParameters.has("installationId"));
  assert.ok(getParameters.has("X-Request-Timestamp"));
  assert.ok(getParameters.has("X-Request-Signature"));
  assert.equal(pathItem.get.responses?.["200"]?.description, "OK");

  const postParameters = getParameterNames(pathItem.post);
  assert.ok(postParameters.has("installationId"));
  assert.ok(postParameters.has("X-Request-Timestamp"));
  assert.ok(postParameters.has("X-Request-Signature"));
  assert.equal(pathItem.post.responses?.["201"]?.description, "Created");

  const schema = pathItem.post.requestBody?.content?.["application/json"]?.schema;
  assert.ok(schema);
  assert.ok(Array.isArray(schema.required));
  assert.ok(schema.required.includes("note"));
  assert.deepEqual(schema.properties?.severity?.enum, ["low", "medium", "high", "critical"]);
  assert.deepEqual(schema.properties?.source?.enum, ["desktop", "mobile", "web"]);
});

test("OpenAPI photo upload route defines binary image media types and signed headers", () => {
  const spec = loadSpec();
  const pathItem = spec.paths?.["/incidents/{incidentId}/photos"];

  assert.ok(pathItem);
  assert.ok(pathItem.post);

  const postParameters = getParameterNames(pathItem.post);
  assert.ok(postParameters.has("incidentId"));
  assert.ok(postParameters.has("X-Request-Timestamp"));
  assert.ok(postParameters.has("X-Request-Signature"));
  assert.ok(postParameters.has("X-File-Name"));
  assert.equal(pathItem.post.responses?.["201"]?.description, "Created");

  const content = pathItem.post.requestBody?.content || {};
  assert.ok(content["image/jpeg"]);
  assert.ok(content["image/png"]);
  assert.ok(content["image/webp"]);
});

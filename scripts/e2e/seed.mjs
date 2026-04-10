import { DEFAULT_E2E_BASE_URL, seedE2eScenario } from "./siteops-e2e.mjs";

function readCliArg(flagName) {
  const index = process.argv.findIndex((arg) => arg === flagName);
  if (index === -1) return "";
  return String(process.argv[index + 1] || "").trim();
}

const baseUrl = readCliArg("--base-url") || process.env.SITEOPS_E2E_BASE_URL || DEFAULT_E2E_BASE_URL;
const state = await seedE2eScenario({ baseUrl, logger: console });

console.log("[e2e] scenario ready");
console.log(JSON.stringify({
  base_url: state.base_url,
  tenant_id: state.tenant_id,
  platform_owner: state.users.platform_owner.username,
  admin: state.users.admin.username,
  technician: state.users.technician.username,
  installation_id: state.installation?.id || null,
  incident_id: state.incident?.id || null,
  assignment_id: state.assignment?.id || null,
}, null, 2));

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const e2eStatePath = path.join(repoRoot, ".wrangler", "state", "e2e");

await fs.rm(e2eStatePath, { recursive: true, force: true });
console.log(`[e2e] isolated local state reset: ${e2eStatePath}`);

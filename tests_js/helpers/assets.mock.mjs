import fs from "node:fs";
import path from "node:path";

const DEFAULT_PUBLIC_DIR = path.join(process.cwd(), "public");

function contentTypeForAsset(assetPath) {
  if (assetPath.endsWith(".html")) return "text/html; charset=utf-8";
  if (assetPath.endsWith(".css")) return "text/css; charset=utf-8";
  if (assetPath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (assetPath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function safeResolveAssetPath(publicDir, pathname) {
  const sanitizedPath = pathname.replace(/^\/+/, "");
  const resolved = path.resolve(publicDir, sanitizedPath);
  const normalizedPublic = path.resolve(publicDir) + path.sep;
  if (!resolved.startsWith(normalizedPublic) && resolved !== path.resolve(publicDir)) {
    return null;
  }
  return resolved;
}

export function createDashboardAssetsBinding({ publicDir = DEFAULT_PUBLIC_DIR } = {}) {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      let pathname = url.pathname;

      if (pathname === "/web/dashboard" || pathname === "/dashboard") {
        pathname = "/dashboard.html";
      }

      const assetPath = safeResolveAssetPath(publicDir, pathname);
      if (!assetPath) {
        return new Response("Not found", { status: 404 });
      }
      if (!fs.existsSync(assetPath) || fs.statSync(assetPath).isDirectory()) {
        return new Response("Not found", { status: 404 });
      }

      const body = fs.readFileSync(assetPath);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": contentTypeForAsset(pathname),
        },
      });
    },
  };
}

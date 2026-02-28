import fs from "node:fs";
import path from "node:path";

function contentTypeFor(pathname) {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

export function createAssetsBinding({ publicDir = path.join(process.cwd(), "public") } = {}) {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      let pathname = url.pathname;

      if (pathname === "/web/dashboard" || pathname === "/dashboard") {
        pathname = "/dashboard.html";
      }

      const resolved = path.resolve(publicDir, `.${pathname}`);
      const root = path.resolve(publicDir);
      if (!resolved.startsWith(root)) {
        return new Response("Not found", { status: 404 });
      }
      if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
        return new Response("Not found", { status: 404 });
      }

      const body = fs.readFileSync(resolved);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": contentTypeFor(pathname),
        },
      });
    },
  };
}

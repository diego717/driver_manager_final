#!/usr/bin/env python3
"""
Compat wrapper para embeber dashboard en worker.js.
Mantiene la funcionalidad historica pero con reemplazo seguro del bloque.
"""

from __future__ import annotations

import re
import sys


def read_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_file(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def escape_js_template(content: str) -> str:
    return content.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


def build_dashboard_html() -> str:
    html = read_file("dashboard.html")
    css = read_file("dashboard.css")
    js = read_file("dashboard.js")
    return (
        html.replace('<link rel="stylesheet" href="/dashboard.css">', f"<style>\n{css}\n</style>")
        .replace('<script src="/dashboard.js"></script>', f"<script>\n{js}\n</script>")
    )


def build_dashboard_route_block(escaped_html: str) -> str:
    return f'''
      // Dashboard route - serve embedded single-file dashboard
      if (routeParts.length === 1 && routeParts[0] === "dashboard" && request.method === "GET") {{
        try {{
          await verifyWebAccessToken(request, env);
        }} catch {{
          // Allow access to login page even without token - JS will handle auth
        }}
        
        const html = `{escaped_html}`;
        
        return new Response(html, {{
          status: 200,
          headers: {{
            ...corsHeaders(),
            "Content-Type": "text/html",
          }},
        }});
      }}

      if (routeParts.length === 1 && routeParts[0] === "dashboard.css" && request.method === "GET") {{
        return new Response("Asset inline en /dashboard. Este endpoint no se usa.", {{
          status: 404,
          headers: {{
            ...corsHeaders(),
            "Content-Type": "text/css",
            "Cache-Control": "no-store",
          }},
        }});
      }}

      if (routeParts.length === 1 && routeParts[0] === "dashboard.js" && request.method === "GET") {{
        return new Response("Asset inline en /dashboard. Este endpoint no se usa.", {{
          status: 404,
          headers: {{
            ...corsHeaders(),
            "Content-Type": "application/javascript",
            "Cache-Control": "no-store",
          }},
        }});
      }}

'''


def replace_dashboard_block(worker_content: str, dashboard_block: str) -> tuple[str, bool]:
    patterns = [
        re.compile(
            r"(?ms)^ {6}// Dashboard route - serve embedded single-file dashboard.*?(?=^ {6}// PWA manifest\.json)"
        ),
        re.compile(
            r"(?ms)^ {6}// Dashboard route - serve embedded single-file dashboard.*?(?=^ {6}if \(isWebRoute\) \{)"
        ),
    ]
    for pattern in patterns:
        if pattern.search(worker_content):
            return pattern.sub(lambda _m: dashboard_block, worker_content), True
    return worker_content, False


def main() -> int:
    worker = read_file("worker.js")
    html = build_dashboard_html()
    block = build_dashboard_route_block(escape_js_template(html))
    new_worker, replaced = replace_dashboard_block(worker, block)

    if not replaced:
        print("ERROR: No se encontro el bloque del dashboard en worker.js")
        return 1

    write_file("worker.js", new_worker)
    print("OK: Dashboard embebido actualizado en worker.js")
    print(f"    Tamano HTML: {len(html)} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

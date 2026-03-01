#!/usr/bin/env python3
"""
Build script para embeber el dashboard en worker.js.
Combina dashboard.css y dashboard.js en un solo HTML embebido.
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
    # Escape for JS template literal in worker.js
    return content.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


def build_dashboard_html() -> str:
    css = read_file("dashboard.css")
    js = read_file("dashboard.js")
    html_template = read_file("dashboard.html")

    return (
        html_template.replace(
            '<link rel="stylesheet" href="/dashboard.css">',
            f"<style>\n{css}\n</style>",
        ).replace(
            '<script src="/dashboard.js"></script>',
            f"<script>\n{js}\n</script>",
        )
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
    # Preferred: replace only the embedded dashboard routes block, preserving PWA/SSE routes.
    patterns = [
        re.compile(
            r"(?ms)^ {6}// Dashboard route - serve embedded single-file dashboard.*?(?=^ {6}// PWA manifest\.json)"
        ),
        # Fallback for older worker variants without the PWA section in-between.
        re.compile(
            r"(?ms)^ {6}// Dashboard route - serve embedded single-file dashboard.*?(?=^ {6}if \(isWebRoute\) \{)"
        ),
    ]

    for pattern in patterns:
        if pattern.search(worker_content):
            return pattern.sub(lambda _m: dashboard_block, worker_content), True
    return worker_content, False


def update_worker() -> bool:
    dashboard_html = build_dashboard_html()
    worker_content = read_file("worker.js")
    escaped_html = escape_js_template(dashboard_html)
    dashboard_block = build_dashboard_route_block(escaped_html)

    new_content, replaced = replace_dashboard_block(worker_content, dashboard_block)
    if not replaced:
        print("ERROR: No se encontro el bloque del dashboard en worker.js")
        return False

    write_file("worker.js", new_content)
    print("OK: Dashboard embebido actualizado en worker.js")
    print(f"    Tamano HTML: {len(dashboard_html)} bytes")
    return True


if __name__ == "__main__":
    # Avoid unicode console issues on Windows by keeping output ASCII-only.
    raise SystemExit(0 if update_worker() else 1)

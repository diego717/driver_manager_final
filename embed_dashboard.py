#!/usr/bin/env python3
import re

# Leer el archivo worker.js
with open('worker.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Leer los archivos del dashboard
with open('dashboard.html', 'r', encoding='utf-8') as f:
    html = f.read()
with open('dashboard.css', 'r', encoding='utf-8') as f:
    css = f.read()
with open('dashboard.js', 'r', encoding='utf-8') as f:
    js = f.read()

# Insertar CSS y JS en el HTML
full_html = html.replace(
    '<link rel="stylesheet" href="/dashboard.css">',
    f'<style>\n{css}\n</style>'
).replace(
    '<script src="/dashboard.js"></script>',
    f'<script>\n{js}\n</script>'
)

# Escapar para JavaScript template literal
escaped = full_html.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')

# Crear el código de la ruta del dashboard
dashboard_route = f'''
      // Dashboard route - serve embedded single-file dashboard
      if (routeParts.length === 1 && routeParts[0] === "dashboard" && request.method === "GET") {{
        try {{
          await verifyWebAccessToken(request, env);
        }} catch {{
          // Allow access to login page even without token - JS will handle auth
        }}
        
        const html = `{escaped}`;
        
        return new Response(html, {{
          status: 200,
          headers: {{
            ...corsHeaders(),
            "Content-Type": "text/html",
          }},
        }});
      }}

      if (routeParts.length === 1 && routeParts[0] === "dashboard.css" && request.method === "GET") {{
        return new Response("", {{
          status: 200,
          headers: {{
            ...corsHeaders(),
            "Content-Type": "text/css",
          }},
        }});
      }}

      if (routeParts.length === 1 && routeParts[0] === "dashboard.js" && request.method === "GET") {{
        return new Response("", {{
          status: 200,
          headers: {{
            ...corsHeaders(),
            "Content-Type": "application/javascript",
          }},
        }});
      }}

'''

# Buscar el patrón y reemplazar
old_text = '''      if (routeParts.length === 1 && routeParts[0] === "health" && request.method === "GET") {
        return jsonResponse({ ok: true, now: nowIso() });
      }

      if (isWebRoute) {'''

new_text = '''      if (routeParts.length === 1 && routeParts[0] === "health" && request.method === "GET") {
        return jsonResponse({ ok: true, now: nowIso() });
      }

''' + dashboard_route + '''
      if (isWebRoute) {'''

if old_text in content:
    new_content = content.replace(old_text, new_text)
    with open('worker.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("✅ Dashboard embebido exitosamente en worker.js")
    print(f"   Tamaño HTML: {len(full_html)} bytes")
else:
    print("❌ No se encontró la sección del dashboard en worker.js")
    # Intentar encontrar texto similar
    if 'routeParts[0] === "health"' in content:
        print("   Se encontró 'routeParts[0] === \"health\"' pero el contexto no coincide exactamente")

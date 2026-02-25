#!/usr/bin/env python3
"""
Build script para embeber el dashboard en worker.js
Combina dashboard.css y dashboard.js en un solo archivo HTML embebido
"""

import re

def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def escape_js_string(content):
    """Escapa contenido para usarlo en una string JavaScript"""
    # Escapa backslashes primero
    content = content.replace('\\', '\\\\')
    # Escapa comillas simples (usaremos template literals)
    content = content.replace('`', '\\`')
    # Escapa ${ para evitar interpolación
    content = content.replace('${', '\\${')
    return content

def build_dashboard_html():
    css = read_file('dashboard.css')
    js = read_file('dashboard.js')
    html_template = read_file('dashboard.html')
    
    # Inserta CSS y JS en el HTML
    html = html_template.replace(
        '<link rel="stylesheet" href="/dashboard.css">',
        f'<style>\n{css}\n</style>'
    ).replace(
        '<script src="/dashboard.js"></script>',
        f'<script>\n{js}\n</script>'
    )
    
    return html

def update_worker():
    dashboard_html = build_dashboard_html()
    
    # Lee el worker actual
    worker_content = read_file('worker.js')
    
    # Escapa el HTML para JavaScript template literal
    escaped_html = escape_js_string(dashboard_html)
    
    # Crea el código para servir el dashboard
    dashboard_route_code = f'''
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

      if (isWebRoute) {{'''
    
    # Busca y reemplaza la sección del dashboard en el worker
    # Patrón para encontrar la sección del dashboard actual
    pattern = r'''
      // Dashboard routes.*?if \(isWebRoute\) \{'''
    
    if re.search(pattern, worker_content, re.DOTALL):
        new_content = re.sub(pattern, dashboard_route_code, worker_content, flags=re.DOTALL)
        
        with open('worker.js', 'w', encoding='utf-8') as f:
            f.write(new_content)
        
        print("✅ Dashboard embebido exitosamente en worker.js")
        print(f"   Tamaño HTML: {len(dashboard_html)} bytes")
        return True
    else:
        print("❌ No se encontró la sección del dashboard en worker.js")
        return False

if __name__ == '__main__':
    update_worker()

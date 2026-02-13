export default {
  async fetch(request, env) {
    // Definir los encabezados CORS para permitir solicitudes desde cualquier origen
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', // Añadido DELETE
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Responder a las solicitudes OPTIONS (pre-vuelo de CORS)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const params = url.searchParams;
    const pathParts = url.pathname.split('/').filter(part => part !== "");

    try {
      if (!env.DB) {
        throw new Error("La base de datos (D1) no está vinculada a este Worker.");
      }

      // --- RUTA: /installations ---
      if (pathParts.length === 1 && pathParts[0] === 'installations') {
        
        // MÉTODO GET: Listar todos los registros
        if (request.method === 'GET') {
          const { results } = await env.DB.prepare(
            "SELECT * FROM installations ORDER BY timestamp DESC"
          ).all();
          
          return new Response(JSON.stringify(results), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // MÉTODO POST: Crear un nuevo registro de instalación
        if (request.method === 'POST') {
          const data = await request.json();
          await env.DB.prepare(`
            INSERT INTO installations (timestamp, driver_brand, driver_version, status, client_name, driver_description, installation_time_seconds, os_info, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            data.timestamp || new Date().toISOString(),
            data.driver_brand || '',
            data.driver_version || '',
            data.status || 'unknown',
            data.client_name || '',
            data.driver_description || '',
            data.installation_time_seconds || 0,
            data.os_info || '',
            data.notes || ''
          ).run();
          
          return new Response(JSON.stringify({ success: true }), { 
            status: 201, headers: corsHeaders 
          });
        }
      }

      // --- RUTA: /installations/:id (Para PUT y DELETE) ---
      if (pathParts.length === 2 && pathParts[0] === 'installations') {
        const recordId = pathParts[1];

        // MÉTODO PUT: Actualizar un registro existente
        if (request.method === 'PUT') {
          const data = await request.json();
          await env.DB.prepare(`
            UPDATE installations 
            SET notes = ?, installation_time_seconds = ?
            WHERE id = ?
          `).bind(
            data.notes ?? null,
            data.installation_time_seconds ?? null,
            recordId
          ).run();

          return new Response(JSON.stringify({ success: true, updated: recordId }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // MÉTODO DELETE: Eliminar un registro
        if (request.method === 'DELETE') {
          if (!recordId) {
            return new Response('Error: El ID del registro es obligatorio.', { status: 400 });
          }
          
          await env.DB.prepare('DELETE FROM installations WHERE id = ?').bind(recordId).run();
          
          return new Response(JSON.stringify({ message: `Registro ${recordId} eliminado.` }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          });
        }
      }

      // --- RUTA: /statistics (Para reportes) ---
      if (url.pathname === '/statistics') {
        // ... (la lógica de estadísticas se mantiene igual)
        const { results: byBrand } = await env.DB.prepare(
          "SELECT driver_brand, COUNT(*) as count FROM installations GROUP BY driver_brand"
        ).all();

        const brandStats = {};
        byBrand.forEach(row => {
          if (row.driver_brand) brandStats[row.driver_brand] = row.count;
        });

        // ... más lógica de estadísticas ...

        return new Response(JSON.stringify({ by_brand: brandStats }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      return new Response("Ruta no encontrada.", { status: 404 });

    } catch (e) {
      // Manejo de errores centralizado
      return new Response(JSON.stringify({ error: e.message }), { 
        status: 500,
        headers: corsHeaders
      });
    }
  }
};
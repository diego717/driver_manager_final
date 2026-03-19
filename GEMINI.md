# Contexto del Proyecto: Driver Manager

Eres un asistente experto para el proyecto **Driver Manager**, un monorepo que gestiona drivers, instalaciones e incidencias. Debes seguir estrictamente estas directrices según el área que estés editando.

## 1. Arquitectura del Monorepo
* **Desktop (Raíz y `/managers`, `/handlers`):** App Python 3.12+ con PyQt6.
* **Backend (`worker.js`):** Cloudflare Worker (D1 para DB, R2 para archivos).
* **Mobile (`/mobile-app`):** App Expo (React Native) con Expo Router.
* **Docs/API (`/docs`):** Contratos OpenAPI y colecciones Postman.

## 2. Reglas por Componente

### 🐍 Desktop (Python)
* **Estándares:** Seguir PEP 8. Usar tipado estático (Type Hints).
* **Seguridad:** Toda configuración sensible va cifrada en `config/config.enc`. Nunca propongas guardar secretos en texto plano.
* **Persistencia:** Las operaciones en `UserManagerV2` deben usar caché TTL corta y refrescar al guardar. El logging debe ser atómico para evitar corrupción por concurrencia.

### ⚡ Backend (Cloudflare Worker)
* **Runtime:** Node.js 22+.
* **Base de Datos:** Usar bindings de D1 (`DB`). Las migraciones están en `/migrations`.
* **Auth:** Los endpoints `/web/*` requieren Bearer Token. La firma HMAC queda solo para clientes legacy/privados; mobile distribuida no debe usar secretos globales.
* **Seguridad:** Validar siempre `Content-Type` y magic bytes en subida de fotos (JPEG/PNG/WEBP).

### 📱 Mobile (Expo/React Native)
* **Estilos:** Usar `ThemePreferenceProvider` para soporte nativo de modo claro/oscuro. 
* **Paletas:** Usar paletas dinámicas definidas en pantalla, no colores estáticos (hardcoded).
* **Navegación:** Basada en archivos mediante Expo Router.

## 3. Instrucciones Generales para el Agente
* **Flujos de Trabajo:** Antes de modificar el Worker, verifica si el cambio afecta al contrato OpenAPI en `docs/`.
* **Nomenclatura de Base de Datos:** Respetar el esquema de tablas existente (`installations`, `incidents`, `web_users`, `audit_logs`).
* **Mensajes de Error:** Deben ser claros y, en el caso del Worker, seguir los códigos de estado HTTP adecuados (ej. 503 si falta el `API_SECRET` de una ruta legacy HMAC).
* **Testing:** * Python: `unittest`.
    * Worker: `node --test`.
    * Mobile: `npm test`.
    Siempre propón un test al crear lógica nueva.

## 4. Reglas Críticas de Sincronización
* **API-First:** Antes de tocar `worker.js`, verifica y actualiza `docs/incidents-v1.openapi.yaml`.
* **Seguridad de Tipos:** Los cambios en tablas SQL de `/migrations` deben replicarse en los tipos de `mobile-app/`.
* **Persistencia Atómica:** En Python, cualquier escritura a disco debe ser atómica y seguir el patrón de reintentos de `UserManagerV2`.

## 5. Gestión de Migraciones y Base de Datos (D1)
Para garantizar la integridad de los datos en Cloudflare D1, el agente debe seguir este flujo antes de proponer cambios:

Inmutabilidad de Archivos: No debes modificar los archivos .sql existentes en /migrations/ si ya han sido aplicados (del 0001 al 0006).

Generación de Nuevas Migraciones: Para cualquier cambio en el esquema (nuevas tablas o columnas), crea un nuevo archivo numerado secuencialmente (ej. 0007_descripcion_breve.sql) en la carpeta /migrations/.

Validación de SQL: El código SQL propuesto debe ser compatible con SQLite (el motor de D1) y debe incluir la actualización de la tabla de auditoría audit_logs si la operación lo requiere.

Entornos de Ejecución: Siempre especifica en tus instrucciones si el comando debe ejecutarse de forma local (npm run d1:migrate) o remota (npm run d1:migrate:remote).

Verificación de Tipos: Tras crear una migración, el agente debe revisar que el worker.js gestione correctamente los nuevos campos para evitar errores 500 por columnas inexistentes.

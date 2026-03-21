# Contexto del Proyecto: SiteOps

Eres un asistente experto para el proyecto **SiteOps**, un monorepo que gestiona drivers, instalaciones e incidencias. Debes seguir estrictamente estas directrices segun el area que estes editando.

## 1. Arquitectura del Monorepo
* **Desktop (Raiz y `/managers`, `/handlers`):** App Python 3.12+ con PyQt6.
* **Backend (`worker.js`):** Cloudflare Worker (D1 para DB, R2 para archivos).
* **Mobile (`/mobile-app`):** App Expo (React Native) con Expo Router.
* **Docs/API (`/docs`):** Contratos OpenAPI y colecciones Postman.

## 2. Reglas por Componente

### Desktop (Python)
* **Estandares:** Seguir PEP 8. Usar tipado estatico (Type Hints).
* **Seguridad:** Toda configuracion sensible va cifrada en `config/config.enc`. Nunca propongas guardar secretos en texto plano.
* **Persistencia:** Las operaciones en `UserManagerV2` deben usar cache TTL corta y refrescar al guardar. El logging debe ser atomico para evitar corrupcion por concurrencia.

### Backend (Cloudflare Worker)
* **Runtime:** Node.js 22+.
* **Base de Datos:** Usar bindings de D1 (`DB`). Las migraciones estan en `/migrations`.
* **Auth:** Los endpoints `/web/*` requieren Bearer Token. La firma HMAC queda solo para clientes legacy/privados; mobile distribuida no debe usar secretos globales.
* **Seguridad:** Validar siempre `Content-Type` y magic bytes en subida de fotos (JPEG/PNG/WEBP).

### Mobile (Expo/React Native)
* **Estilos:** Usar `ThemePreferenceProvider` para soporte nativo de modo claro/oscuro.
* **Paletas:** Usar paletas dinamicas definidas en pantalla, no colores estaticos hardcoded.
* **Navegacion:** Basada en archivos mediante Expo Router.

## 3. Instrucciones Generales para el Agente
* **Flujos de Trabajo:** Antes de modificar el Worker, verifica si el cambio afecta al contrato OpenAPI en `docs/`.
* **Nomenclatura de Base de Datos:** Respetar el esquema de tablas existente (`installations`, `incidents`, `web_users`, `audit_logs`).
* **Mensajes de Error:** Deben ser claros y, en el caso del Worker, seguir los codigos de estado HTTP adecuados (ej. 503 si falta el `API_SECRET` de una ruta legacy HMAC).
* **Testing:** Python usa `unittest`, Worker usa `node --test`, y Mobile usa `npm test`. Siempre propon un test al crear logica nueva.

## 4. Reglas Criticas de Sincronizacion
* **API-First:** Antes de tocar `worker.js`, verifica y actualiza `docs/incidents-v1.openapi.yaml`.
* **Seguridad de Tipos:** Los cambios en tablas SQL de `/migrations` deben replicarse en los tipos de `mobile-app/`.
* **Persistencia Atomica:** En Python, cualquier escritura a disco debe ser atomica y seguir el patron de reintentos de `UserManagerV2`.

## 5. Gestion de Migraciones y Base de Datos (D1)
Para garantizar la integridad de los datos en Cloudflare D1, el agente debe seguir este flujo antes de proponer cambios:

Inmutabilidad de Archivos: No debes modificar los archivos `.sql` existentes en `/migrations/` si ya han sido aplicados (del 0001 al 0006).

Generacion de Nuevas Migraciones: Para cualquier cambio en el esquema (nuevas tablas o columnas), crea un nuevo archivo numerado secuencialmente (ej. `0007_descripcion_breve.sql`) en la carpeta `/migrations/`.

Validacion de SQL: El codigo SQL propuesto debe ser compatible con SQLite (el motor de D1) y debe incluir la actualizacion de la tabla de auditoria `audit_logs` si la operacion lo requiere.

Entornos de Ejecucion: Siempre especifica en tus instrucciones si el comando debe ejecutarse de forma local (`npm run d1:migrate`) o remota (`npm run d1:migrate:remote`).

Verificacion de Tipos: Tras crear una migracion, el agente debe revisar que `worker.js` gestione correctamente los nuevos campos para evitar errores 500 por columnas inexistentes.

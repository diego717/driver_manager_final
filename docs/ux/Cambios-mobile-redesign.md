Perfecto, con ese contexto tengo todo lo que necesito. El stack es sólido y ya tenés Expo + React Native + TypeScript en marcha, así que la decisión de plataforma ya está tomada en la práctica. Acá va mi recomendación:

---

## Plan de transición Web → Mobile para técnico en campo

### 1. No repliques el dashboard, rediseñá el flujo

El dashboard web está pensado para un operador en escritorio con visión completa del sistema. El técnico en campo necesita lo opuesto: **pantallas de una sola acción**, sin distracciones, con interacción posible con guante puesto o sol directo.

El modelo mental correcto es **"¿qué hace el técnico en los próximos 30 segundos?"**, no "¿qué información necesita ver?".

---

### 2. Las tres pantallas que importan realmente

Mirando tu código, las funciones críticas para campo son muy concretas:

**Pantalla 1 — Mi cola** (equivalente a `dashboardMyCases`)
Un listado compacto de incidencias asignadas, ordenado por severidad. Sin filtros complejos, sin KPIs. Solo el caso, el estado, y un botón de acción primaria enorme. Toca para abrir, desliza para cambiar estado.

**Pantalla 2 — Detalle de caso / acción rápida**
Muestra nota, severidad, destino operativo y el conjunto de botones de estado (`open → in_progress → paused → resolved`). Los mismos estados que manejás en `appendIncidentStatusActions`, pero con botones de mínimo 64px de alto. La foto y la firma de conformidad viven acá como acciones secundarias dentro de un sheet inferior, no en un modal separado.

**Pantalla 3 — Escáner QR → contexto inmediato**
El técnico llega a un equipo, escanea, y ve en menos de 2 segundos: cliente, última incidencia activa, y el botón "Crear incidencia". Ya tenés `dashboardScan` y toda la lógica de `buildQrPayload` / `dm://asset/` funcionando. En mobile esto es la entrada principal, no una función secundaria.

---

### 3. Decisión de plataforma: quedáte con Expo

Dado que ya tenés Expo + WatermelonDB, la recomendación es clara: **no hagas PWA para esto**. Las razones técnicas son concretas:

La cámara para QR en PWA tiene restricciones en iOS que no tiene una app nativa. El GPS en background (para captura de ubicación al crear incidencia, que ya implementás en `dashboardGeolocation`) necesita permisos nativos. La firma de conformidad con canvas touch funciona mucho mejor con `react-native-signature-canvas` que con el canvas HTML que tenés hoy. Y WatermelonDB ya te da sincronización offline-first que la PWA no puede igualar.

---

### 4. Cómo reutilizar lo que ya tenés

Tu API en Cloudflare Workers ya tiene todos los endpoints necesarios. El trabajo mobile es principalmente de UI, no de backend. Los endpoints que el técnico usa en campo son un subconjunto muy pequeño:

`GET /api/incidents/my-cases` para la cola personal, `PATCH /api/incidents/:id/status` para cambiar estado, `POST /api/incidents/:installationId` para crear, `POST /api/incidents/:id/photos` para fotos, `POST /api/installations/:id/conformity` para la firma final, y `GET /api/assets/resolve` para el QR.

Todo lo demás, tenants, drivers, audit, mapa global, es irrelevante para el técnico en campo y no necesita estar en la app mobile.

---

### 5. El sistema de diseño: mismos tokens, diferente densidad

Tenés un sistema de diseño muy trabajado en tu CSS con variables `oklch` bien definidas. La transición a React Native se hace mapeando los tokens directamente:

```typescript
// tokens.ts — mismos valores que dashboard.css
export const colors = {
  accentPrimary: 'oklch(0.74 0.18 140)',
  warning: 'oklch(0.72 0.18 44)',
  error: 'oklch(0.62 0.2 27)',
  bgCard: 'oklch(0.95 0.03 95)',
  textPrimary: 'oklch(0.22 0.03 250)',
  textSecondary: 'oklch(0.42 0.03 252)',
} as const

// Los touch targets mínimos para campo
export const spacing = {
  touchTarget: 64,     // vs 44px en web
  touchTargetMin: 56,
  statusBtn: 72,       // botones de estado de incidencia
} as const
```

El dark mode que ya tenés en web se hereda directamente usando `useColorScheme` de React Native con los mismos valores.

---

### 6. Un patrón de navegación concreto

```
Tab 1: Mi cola     → lista de casos asignados
Tab 2: Escanear    → cámara QR como pantalla, no como modal
Tab 3: Nueva       → form rápido de incidencia (3 campos máximo)
```

Sin sidebar. Sin nav overflow. La firma de conformidad y las fotos son acciones dentro del caso, accesibles con un bottom sheet deslizable, no navegación separada.

---

### 7. Lo que no debés portar a mobile

El mapa de incidencias, el panel de tenants, la gestión de drivers, las vistas de auditoría, la configuración de técnicos, y los gráficos de tendencia son herramientas de back-office. Portarlos aumenta la complejidad sin valor para el técnico. La app mobile debe sentirse como una herramienta de campo, no como el dashboard reducido.

---

### Orden de implementación sugerido

Primero construís la cola de casos con cambio de estado deslizable, que es lo que el técnico usa 20 veces por día. Segundo, el escáner QR con resolución de equipo e incidencia activa, porque es la entrada más frecuente en terreno. Tercero, la creación rápida de incidencia desde el escáner. Cuarto, captura de fotos y firma de conformidad. Todo lo demás es fase dos.

Con WatermelonDB ya en tu stack, cada uno de esos pasos tiene sincronización offline incluida sin trabajo adicional, lo cual es crítico cuando el técnico está en un sótano o en una zona con mala señal.
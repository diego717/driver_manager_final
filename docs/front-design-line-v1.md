# Front Design Line v1 (Mobile + Web)

Objetivo: mantener una identidad visual única entre app móvil y dashboard web, adaptando layout e interacción a cada plataforma.

## 1) Principios
- Misma semántica visual en todas las plataformas: un estado `warning` siempre usa el mismo color/jerarquía.
- Adaptación de forma, no de identidad: en mobile hay menos densidad y más guía; en web, más densidad y velocidad operativa.
- Tokens primero: nada de colores/espaciados hardcodeados por pantalla.

## 2) Tokens Base (fuente de verdad)

### Color tokens (Light)
- `bg.app`: `#F8FAFC`
- `bg.surface`: `#FFFFFF`
- `bg.surfaceAlt`: `#EEF2F7`
- `text.primary`: `#0F172A`
- `text.secondary`: `#475569`
- `text.muted`: `#64748B`
- `border.default`: `#CBD5E1`
- `accent.primary`: `#0B7A75`
- `accent.primaryStrong`: `#0F766E`
- `accent.link`: `#0E7490`
- `status.success`: `#047857`
- `status.warning`: `#B45309`
- `status.error`: `#B91C1C`
- `status.info`: `#0369A1`

### Color tokens (Dark)
- `bg.app`: `#020617`
- `bg.surface`: `#0F172A`
- `bg.surfaceAlt`: `#111827`
- `text.primary`: `#E2E8F0`
- `text.secondary`: `#94A3B8`
- `text.muted`: `#64748B`
- `border.default`: `#334155`
- `accent.primary`: `#14B8A6`
- `accent.primaryStrong`: `#0F766E`
- `accent.link`: `#22D3EE`
- `status.success`: `#34D399`
- `status.warning`: `#F59E0B`
- `status.error`: `#FCA5A5`
- `status.info`: `#38BDF8`

## 3) Tipografía
- Familia base web: `Inter, system-ui, sans-serif`.
- Familia base mobile: sistema por defecto (hasta decidir carga global de fuente custom).
- Escala recomendada:
  - `display`: 28/34 semibold
  - `title`: 24/30 bold
  - `section`: 16/22 semibold
  - `body`: 14/20 regular
  - `caption`: 12/16 regular

## 4) Espaciado, radios, elevación
- Escala spacing: `4, 8, 12, 16, 20, 24, 32`.
- Radios: `8` (controles), `10` (inputs/botones), `12` (cards), `16` (contenedores mayores).
- Sombra:
  - `shadow.sm`: uso en cards básicas
  - `shadow.md`: solo en hover desktop o modales
- Touch targets mínimos: `44px` alto/ancho.

## 5) Componentes canónicos
- `AppCard`
  - `bg.surface`, `border.default`, radio `12`, padding `12`.
- `PrimaryButton`
  - Fondo `accent.primaryStrong`, texto blanco, altura mínima `44`.
  - Disabled: opacidad `0.6-0.7`.
- `SecondaryButton`
  - Fondo `bg.surface`, borde `border.default`, texto `text.primary`.
- `AppInput`
  - Fondo `bg.surface`, borde `border.default`, foco con `accent.primary`.
- `StatusBadge`
  - Variantes: `success/warning/error/info/muted`.
  - Misma semántica y texto en mobile y web.

## 6) Estados UX obligatorios (todas las pantallas críticas)
- `loading`: indicador + texto corto.
- `empty`: explicación + acción sugerida.
- `error`: mensaje claro + acción de reintento.
- `offline/pending_sync`: estado visible y persistente hasta sincronizar.
- `success`: confirmación breve, sin bloquear flujo.

## 7) Adaptación por plataforma

### Mobile (Expo)
- 1 columna, cards apiladas, CTA principal abajo.
- Flujos guiados por pasos para tareas críticas (ej. incidencias).
- Priorización: claridad + confirmaciones explícitas.

### Web Dashboard
- Mayor densidad, filtros rápidos, acciones en línea.
- Hover y atajos solo como complemento (nunca requisito).
- Priorización: velocidad operativa + visión global.

## 8) Mapa de implementación en este repo
- Tokens mobile base:
  - [Colors.ts](/h:/dev/driver_manager/mobile-app/constants/Colors.ts)
  - [theme-preference.tsx](/h:/dev/driver_manager/mobile-app/src/theme/theme-preference.tsx)
- Pantallas móviles críticas:
  - [upload.tsx](/h:/dev/driver_manager/mobile-app/app/incident/upload.tsx)
  - [detail.tsx](/h:/dev/driver_manager/mobile-app/app/incident/detail.tsx)
  - [two.tsx](/h:/dev/driver_manager/mobile-app/app/(tabs)/two.tsx)
- Dashboard web:
  - [dashboard.css](/h:/dev/driver_manager/dashboard.css)
  - [dashboard.js](/h:/dev/driver_manager/dashboard.js)

## 9) Regla de gobernanza
- Si un color/tamaño no está en este documento, no se usa directamente.
- Primero se agrega token aquí, luego se aplica en código.
- Esta guía es la referencia v1 hasta publicar v2.

## 10) Implementación actual (v1 aplicada)
- Token source mobile:
  - [design-tokens.ts](/h:/dev/driver_manager/mobile-app/src/theme/design-tokens.ts)
  - [Colors.ts](/h:/dev/driver_manager/mobile-app/constants/Colors.ts)
- Pantallas mobile ya conectadas a tokens:
  - [upload.tsx](/h:/dev/driver_manager/mobile-app/app/incident/upload.tsx)
  - [detail.tsx](/h:/dev/driver_manager/mobile-app/app/incident/detail.tsx)
  - [index.tsx](/h:/dev/driver_manager/mobile-app/app/(tabs)/index.tsx)
  - [two.tsx](/h:/dev/driver_manager/mobile-app/app/(tabs)/two.tsx)
- Web dashboard con variables semánticas:
  - [dashboard.css](/h:/dev/driver_manager/dashboard.css)

### Cómo cambiar el look rápidamente
1. Cambia valores en `design-tokens.ts` (light/dark).
2. Ajusta alias semánticos en `dashboard.css` (`--color-*`).
3. Revisa pantallas críticas (`upload`, `detail`, `index`, `two`).

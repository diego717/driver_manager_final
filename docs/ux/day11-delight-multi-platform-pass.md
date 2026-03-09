# Día 11 - Pase visual `bolder` (Windows + Android + Web)

Fecha: 2026-03-08  
Owner: UX multiplataforma

## Objetivo
Elevar presencia visual y claridad de lectura sin perder consistencia entre plataformas ni accesibilidad.

## 1) Elementos visuales débiles detectados
- Jerarquía tipográfica corta entre título, subtítulo y texto auxiliar.
- Botones secundarios compitiendo con CTA principales.
- Separación de secciones insuficiente en algunos módulos.
- Contraste bajo en bordes y textos secundarios.

## 2) Componentes compartidos y específicos
### Compartidos
- Sistema de color base (fondo, superficie, borde, acento, estados).
- Jerarquía de acciones (`primary`, `secondary`, `danger`, `warning`, `info`).
- Ritmo de espaciado y targets táctiles/clickables de al menos 44 px.

### Específicos por plataforma
- Web: paneles, tablas, filtros y CTA del dashboard (`dashboard.css`, `public/dashboard.css`).
- Android: tabs, tarjetas de formularios y botones táctiles (`mobile-app/src/theme/palette.ts`, `mobile-app/app/(tabs)/_layout.tsx`, `mobile-app/app/drivers.tsx`, `mobile-app/app/(tabs)/index.tsx`).
- Windows: tema Qt y jerarquía de botones por clase (`ui/theme_manager.py`, `ui/ui_components.py`).

## 3) Cambios implementados
### Web
- Títulos y encabezados reforzados (más peso, tamaño y separación).
- Secciones activas con borde, fondo y sombra para lectura por bloques.
- CTA principal más evidente (peso, altura mínima, elevación y hover más claro).
- Botón secundario neutralizado para reducir competencia visual.
- Mejor contraste en filtros, tablas y encabezados de tabla.

### Android
- Tokens de tema con más contraste (texto secundario, bordes y acento).
- CTA primario más dominante; secundarios más neutros para jerarquía limpia.
- Navegación de tabs y header con estructura más marcada.
- Tipografía y espaciado reforzados en `Drivers` y `Crear incidencia` para escaneo más rápido.

### Windows
- Paleta con bordes y textos secundarios más legibles.
- Tabs con estado seleccionado más claro y contrastado.
- Botón base más neutro + clase `primary` para destacar acciones críticas.
- Clases de botones de estado (`success/warning/danger/info`) con borde y contraste más definidos.
- CTA explícitos marcados como `primary` en componentes clave (`instalar`, `subir`, `crear registro manual`, `iniciar sesión`).

## 4) Accesibilidad y consistencia
- Se mantuvo contraste alto en texto principal y controles interactivos.
- Se respetó jerarquía visual consistente entre plataformas, adaptada al patrón nativo de cada una.
- No se agregaron animaciones decorativas innecesarias.

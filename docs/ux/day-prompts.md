# Prompts por Día (Refactor UX/UI)

## Día 1 — Accesibilidad base (Web)
```text
[$harden] [$adapt]

Implementa el Día 1: accesibilidad base en Web para modales y teclado.

Objetivo:
- cerrar brechas de accesibilidad en modales y navegación por teclado.

Archivos foco:
- dashboard.html
- dashboard.js
- dashboard.css
- tests_js/dashboard.accessibility.test.mjs

Tareas:
1. Agregar role="dialog", aria-modal, aria-labelledby/aria-describedby en todos los modales.
2. Unificar focus trap para loginModal, qrModal, qrPasswordModal, actionModal y photoModal.
3. Asegurar cierre con Escape y restauración correcta del foco al trigger.
4. Dar soporte keyboard a filas clickeables de tablas (Enter/Space o botón interno accesible).
5. Agregar/ajustar tests de accesibilidad para cubrir estos casos.

Entrega:
- cambios implementados en código
- resumen breve de cambios
- resultado de tests ejecutados
```

## Día 2 — Contraste AA y touch targets
```text
[$normalize] [$adapt]

Implementa el Día 2: contraste AA y touch targets mínimos.

Objetivo:
- mejorar legibilidad y precisión táctil en Web, Android y Windows.

Archivos foco:
- dashboard.css
- mobile-app/src/theme/palette.ts
- ui/theme_manager.py
- mobile-app/app/(tabs)/_layout.tsx
- mobile-app/app/drivers.tsx
- mobile-app/tests/app/(tabs)/index.accessibility.test.tsx

Tareas:
1. Llevar botones/controles críticos a mínimo 44x44.
2. Corregir colores warning/error para cumplir contraste AA en texto UI.
3. Mantener consistencia visual entre light/dark.
4. Ajustar tests existentes y agregar los que falten para target size y contraste esperado.

Entrega:
- cambios implementados
- lista de tokens ajustados
- resultado de tests
```

## Día 3 — Copy UX y codificación de texto
```text
[$clarify] [$harden]

Implementa el Día 3: saneo de copy UX + codificación (acentos e iconos rotos).

Objetivo:
- eliminar textos corruptos y unificar microcopy en español claro.

Archivos foco:
- dashboard.js
- dashboard.html
- mobile-app/app/(tabs)/index.tsx
- mobile-app/app/(tabs)/assets.tsx
- mobile-app/app/drivers.tsx
- ui/ui_components.py

Tareas:
1. Corregir mojibake y caracteres rotos (Ã, Â, �, YY, Y", etc.).
2. Unificar terminología: sesión, instalación, configuración, versión, auditoría, acción.
3. Revisar mensajes de error/éxito para que sean claros y accionables.
4. Mantener consistencia entre plataformas sin romper comportamiento nativo.
5. Agregar una verificación automatizada básica para detectar texto roto en archivos clave.

Entrega:
- cambios implementados
- tabla breve “antes/después” de copy crítico
- resultado de validaciones/tests
```

## Día 4 — Consistencia de theming y estilos
```text
[$normalize] [$extract] [$polish]

Implementa el Día 4: consistencia de theming y eliminación de estilos hardcodeados.

Objetivo:
- centralizar estilo en tokens/clases y reducir inconsistencias en Desktop + Web.

Archivos foco:
- ui/ui_components.py
- ui/dialogs/master_password_dialog.py
- ui/dialogs/user_management_ui.py
- ui/dialogs/qr_generator_dialog.py
- ui/theme_manager.py
- scripts/sync-dashboard-assets.mjs
- public/dashboard-build.json

Tareas:
1. Reemplazar setStyleSheet hardcodeado por clases y ThemeManager cuando aplique.
2. Alinear estados visuales (primary/secondary/warning/error/success) entre componentes.
3. Verificar sincronización root/public de assets web y evitar drift.
4. Documentar reglas mínimas de diseño/tokens en docs/ux.

Entrega:
- cambios implementados
- lista de hardcode removidos
- estado de sincronización root/public
```

## Día 5 — QA final y release prep
```text
[$audit] [$polish]

Implementa el Día 5: QA final y preparación de release.

Objetivo:
- cerrar release con criterios de calidad medibles.

Tareas:
1. Ejecutar y reportar:
   - pytest -q
   - npm run test:web
   - npm --prefix mobile-app test
2. Auditar regresiones UX en:
   - jerarquía visual
   - accesibilidad (focus, teclado, labels, reduced motion)
   - estados (loading/error/empty/success)
3. Actualizar documento de QA/release con:
   - checklist final
   - riesgos residuales
   - follow-ups post release

Archivos foco:
- docs/ux/day10-qa-release-prep.md
- tests_js/dashboard.accessibility.test.mjs
- mobile-app/tests/app/(tabs)/index.accessibility.test.tsx

Entrega:
- resumen de auditoría final priorizada
- estado pass/fail por suite
- release notes UX breve
```

## Día 12 — Prototipo en Stitch (antes de implementar)
```text
[$frontend-design] [$adapt] [$normalize]

Genera en Stitch una propuesta de rediseño del dashboard operativo de SiteOps.

Objetivo:
- validar UX/UI antes de tocar código
- priorizar operación del turno y acciones inmediatas
- simplificar visualización y navegación

Contexto:
- mantener consistencia con el sistema visual actual
- accesibilidad AA en contraste de warning/error
- targets mínimos de 44x44

Requerimientos:
1. Sidebar agrupada por intención:
   - Operación: Hoy, Registros, Incidencias
   - Activos: Equipos, Drivers
   - Control: Auditoría, Configuración
2. Header compacto con estado de sincronización y acciones rápidas.
3. Reemplazar dashboard actual por:
   - 4 KPIs operativos:
     - incidencias críticas abiertas
     - registros en curso
     - registros fuera de SLA
     - última sincronización
   - 1 único visual principal:
     - tendencia de registros (barras) + línea objetivo/SLA
     - toggle 24h/7d
   - 1 bloque “Atención ahora” con top 5 casos accionables
4. Variante mobile:
   - bottom nav: Hoy, Registros, Incidencias, Más
   - layout de una columna sin perder funcionalidades clave

Entrega:
- propuesta desktop + mobile
- breve rationale de jerarquía visual
- lista de decisiones para implementar luego en:
  - dashboard.html
  - dashboard.css
  - dashboard.js
```

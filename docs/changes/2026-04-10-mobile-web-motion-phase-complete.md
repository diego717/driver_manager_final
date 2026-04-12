# 2026-04-10 - mobile/web motion y claridad operativa (fase completa)

## Resumen

- se completa una segunda capa de motion para mobile y dashboard web con foco en navegacion y feedback util
- se unifica haptics en tabs mobile y se extiende a acciones frecuentes de `work`, `explore` y `map`
- se ajusta microcopy de CTA para reducir ambiguedad durante operacion en campo
- se aplica una pasada visual mas audaz en dashboard dark mode con mayor contraste, acentos mas vivos y micro-interacciones mas expresivas
- se refuerza el sistema de color en mobile para tema claro y oscuro con mayor contraste y una identidad visual mas marcada
- se agrega una nueva pestaÃ±a web `Visual Lab` para previsualizar una direccion visual mas distintiva antes de llevarla a mobile
- se evoluciona `Visual Lab` hacia una variante neon-editorial experimental (tipografia display, paleta vibrante y composicion asimetrica)
- se corrige mojibake en web mediante normalizacion automatica de texto y atributos visibles

## Areas tocadas

- dashboard web
- assets publicados de dashboard
- mobile app

## Contexto

La base de micro-interacciones ya existia, pero habia huecos entre pantallas y acciones clave. Esta pasada completa busca consistencia de feedback, mejor lectura de cambios de contexto y copy mas accionable sin romper el tono tecnico-operativo.

## Cambios clave

- Dashboard web
  - `dashboard.html` suma la pestaÃ±a y seccion `Visual Lab` (desktop + panel de mas en mobile) para inspeccionar una propuesta mas jugada en web.
  - `dashboard.js` integra `visualLab` en titulos/subtitulos, bindings, estado de overflow mobile y CTA primario (`Alternar tema`).
  - `dashboard.css` agrega un lenguaje visual propio para `Visual Lab` (paleta color-first, layout asimetrico, fonts de alto contraste y motion de showcase), respetando `prefers-reduced-motion`.
  - `dashboard-navigation.js` ahora emite hooks de inicio/fin de transicion entre secciones y aplica salida real (`is-transitioning-out`) antes del cambio.
  - `dashboard.js` agrega estado visual de transicion de navegacion y animacion breve del bloque de titulo/subtitulo al cambiar seccion.
  - `dashboard.css` agrega:
    - barra de progreso visual corta durante cambio de seccion
    - animacion de salida para seccion activa
    - fade/slide sutil para `page heading`
    - reajuste de tokens en tema oscuro para aumentar contraste y presencia de acentos
    - atmosfera de fondo dark con animacion sutil y mayor profundidad visual
    - hover/active mas marcados en nav lateral, cards y botones primarios
    - cobertura de `prefers-reduced-motion` para los nuevos efectos
- Mobile app
  - tabs (`_layout.tsx`, `index.tsx`) pasan a usar el servicio comun `src/services/haptics.ts` para mantener un unico criterio de feedback tactil.
  - `src/theme/palette.ts` actualiza tokens de `light` y `dark` para:
    - aumentar contraste entre superficies y texto
    - acentuar jerarquia visual con acentos mas vivos
    - mejorar legibilidad de estados (info/success/warning/error)
    - mantener consistencia de `hero`, `header` y `tabBar` en ambos temas
  - `work.tsx` agrega animacion de entrada de pantalla, haptics en acciones de prioridad/seguimiento/tracking y copy mas explicito en CTA de refresco y detalle.
  - `explore.tsx` agrega animacion de entrada, haptics en busqueda/seleccion/acciones primarias y copy de CTA mas claro (`Actualizar lista`, `Vincular a caso`).
  - `MapTabScreen.native.tsx` agrega:
    - animacion de entrada
    - haptics en filtros, seleccion de pin/tarjeta y acciones principales
    - auto-scroll del rail horizontal al incidente seleccionado
    - micro-animacion de foco al cambiar incidencia seleccionada
    - copy mas claro en acciones (`Actualizar mapa`, `Abrir en Maps`)
  - `MapTabScreen.web.tsx` alinea copy de acciones con mobile (`Actualizar lista`, `Abrir en Maps`).

## Impacto

- mejor continuidad perceptiva al navegar entre secciones del dashboard
- feedback tactil consistente en flujos operativos frecuentes mobile
- menor duda en acciones por etiquetas mas especificas
- modo oscuro con lectura mas fuerte y personalidad visual mas distintiva sin perder operatividad
- tema claro mobile con mas caracter visual y mejor separacion de capas
- sin degradar accesibilidad de motion gracias a `prefers-reduced-motion`

## Referencias

- `dashboard-navigation.js`
- `dashboard.js`
- `dashboard.css`
- `dashboard.html`
- `public/dashboard-navigation.js`
- `public/dashboard.js`
- `public/dashboard.css`
- `public/dashboard.html`
- `mobile-app/app/(tabs)/_layout.tsx`
- `mobile-app/app/(tabs)/index.tsx`
- `mobile-app/app/(tabs)/work.tsx`
- `mobile-app/app/(tabs)/explore.tsx`
- `mobile-app/src/theme/palette.ts`
- `mobile-app/src/screens/MapTabScreen.native.tsx`
- `mobile-app/src/screens/MapTabScreen.web.tsx`

## Validacion

- `node --check dashboard-navigation.js`
- `node --check dashboard.js`
- `cd mobile-app && npx tsc --noEmit`
- `npm run dashboard:sync-assets`


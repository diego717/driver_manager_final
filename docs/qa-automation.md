# QA automation

Base automatizada para SiteOps con estado aislado, seed programatico y cobertura inicial web/mobile.

## Objetivo

- no reutilizar la D1 local de desarrollo
- no depender de usuarios o datos creados a mano
- dejar una base expandible para RBAC, `Mis casos`, `Mapa` y smoke operativo

## Web con Playwright

Prerequisitos de una sola vez:

```powershell
npm ci
npm run playwright:install
```

Ejecucion:

```powershell
npm run test:e2e:web
```

Que hace la suite:

- resetea `.wrangler/state/e2e`
- aplica migraciones sobre una D1 local aislada
- levanta `wrangler dev` en `http://127.0.0.1:8787`
- bootstrapea usuarios E2E y crea fixture de tecnico, caso, incidencia y asignacion
- corre smoke de login/RBAC en dashboard

Artefactos:

- seed: `reports/e2e/seed-state.json`
- Playwright HTML report: `reports/playwright/html/index.html`

## Mobile Android con Maestro

El flujo nativo usa el mismo worker aislado y el mismo seed E2E. La app debe compilarse en modo debug apuntando al worker local del emulador.

### Instalar Maestro en local

Windows con helper del repo:

```powershell
.\scripts\e2e\install-maestro.ps1
```

Ese script usa el instalador oficial de Maestro si `bash` esta disponible. Si no lo esta, te deja el mensaje de fallback para la instalacion manual.

Referencia oficial:

- instalacion CLI: `curl -fsSL "https://get.maestro.mobile.dev" | bash`
- prerequisito: Java 17+

### Runner de una sola orden

Desde la raiz del repo:

```powershell
npm run test:e2e:android
```

Tambien puedes correr un solo smoke:

```powershell
npm run test:e2e:android:work
npm run test:e2e:android:map
```

Ese runner hace esto:

- valida `adb` y `maestro`
- verifica que haya emulador/dispositivo Android conectado
- levanta el worker E2E aislado
- siembra usuarios y datos de prueba
- arranca Metro en `localhost:8081`
- ejecuta `adb reverse` para `8787` y `8081`
- instala `debug` con `gradlew installDebug`
- dispara el flow Maestro elegido

## GitHub Actions

Se agrego un workflow dedicado en [e2e.yml](/g:/dev/driver_manager/.github/workflows/e2e.yml).

Que corre:

- `Web E2E`: levanta el worker aislado y ejecuta `npm run test:e2e:web`
- `Android Smoke`: instala Maestro CLI, levanta un emulador Android en Ubuntu con KVM y ejecuta `npm run test:e2e:android:work`

Artefactos CI:

- reporte HTML de Playwright
- seed E2E usado en la corrida

Si ya tienes la app instalada y quieres ahorrar tiempo:

```powershell
node .\scripts\e2e\run-android-smoke.mjs --flow all --skip-install
```

### 1. Levantar worker aislado

```powershell
npm run dev:e2e
```

### 2. Sembrar fixture

En otra terminal:

```powershell
node .\scripts\e2e\seed.mjs --base-url http://127.0.0.1:8787
```

### 3. Correr la app Android contra el worker local

En `mobile-app/`:

```powershell
$env:EXPO_PUBLIC_API_BASE_URL="http://10.0.2.2:8787"
$env:EXPO_PUBLIC_ALLOW_HTTP_API_BASE_URL="true"
npm run android
```

Notas:

- `10.0.2.2` es el loopback del host visto desde el emulador Android.
- si la app ya estaba instalada con otra base URL, reinstalala para regenerar el bundle debug con estas variables.

### 4. Ejecutar Maestro

Con emulador, `adb` y `maestro` instalados:

```powershell
Set-Location mobile-app
npm run test:e2e:android
```

O por flujo:

```powershell
npm run test:e2e:android:work
npm run test:e2e:android:map
```

## Datos E2E estables

Usuarios creados por el seed:

- `e2e-root` (`platform_owner`)
- `e2e-admin` (`admin`)
- `e2e-supervisor` (`supervisor`)
- `e2e-tech` (`tecnico`)
- `e2e-reader` (`solo_lectura`)

Fixture operativo:

- tecnico vinculado: `Tecnico E2E Campo`
- cliente/caso: `Cliente E2E Smoke`
- incidencia asignada: `E2E smoke incident assigned to technician queue.`

## Siguiente paso recomendado

Expandir la suite sobre esta base:

- Playwright: flujos de `Mis casos`, `Mapa`, tenants y auditoria por rol
- Maestro: detalle de incidencia, cambio de estado, evidencia y offline/online

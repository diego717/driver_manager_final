# Day 1 Flow Map

Date: 2026-03-08  
Method: static code walkthrough of active entry points and handlers.

## Navigation Map
- Web app shell:
  - Sidebar sections in `dashboard.html` (`dashboard`, `installations`, `assets`, `drivers`, `incidents`, `audit`)
  - Section activation and loaders in `dashboard.js` (`activateSection`, `runSectionLoaders`)
- Desktop shell:
  - Main tabs in `ui/main_window.py` (`Drivers`, `History`, `Incidents`, `Admin`)
  - Signal wiring in `MainWindow._setup_connections`

## Critical Flows

### 1) Login / Logout

Web:
- Entry points:
  - Login submit listener in `dashboard.js:3835`
  - Logout click listener in `dashboard.js:3861`
- Happy path:
  1. User submits username/password from `#loginForm`.
  2. `api.login` resolves token and user.
  3. UI applies user, hides modal, loads dashboard, enables SSE.
  4. Logout clears session and reopens login modal.
- Friction:
  - Inline login error is generic only (`Credenciales invalidas`).

Desktop:
- Entry points:
  - `show_login_dialog` in `ui/main_window.py:2083`
  - `on_admin_logout` in `ui/main_window.py:2336`
- Happy path:
  1. Open login from Admin tab button.
  2. Resolve auth mode and user manager, run login dialog.
  3. Apply role-based visibility and tab access.
  4. Refresh protected data and audit list.
- Friction:
  - Login flow contains many role-conditional visibility toggles in one method.

### 2) Create Manual Record

Web:
- Entry points:
  - Dynamic button injection in `dashboard.js:1707-1711`
  - Flow function `createManualRecordFromWeb` in `dashboard.js:614`
- Happy path:
  1. Click `Nuevo registro manual`.
  2. Complete 5 sequential prompts (client, brand, version, status, notes).
  3. Submit to `api.createRecord`.
  4. Reload installations and optionally pivot to incidents view.
- Friction:
  - 5 sequential `prompt()` calls increase interruption and input error risk.

Desktop:
- Entry point:
  - `create_manual_history_record` in `ui/main_window.py:1468`
- Happy path:
  1. Admin opens manual record action from History tab.
  2. Complete 5 sequential `QInputDialog` steps.
  3. Submit via `history.create_manual_record`.
  4. Refresh list and optionally log access.
- Friction:
  - Same dialog chaining pattern as web; high modal churn.

### 3) Create Incident

Web:
- Entry points:
  - `createIncidentFromWeb` in `dashboard.js:658`
  - Triggered from incident action buttons (`dashboard.js:2749`, `dashboard.js:2372`)
- Happy path:
  1. Start from selected installation/asset context.
  2. Enter note via prompt.
  3. Enter severity and time adjustment via prompts.
  4. Confirm apply-to-installation.
  5. Submit via `api.createIncident`.
- Friction:
  - Prompt + confirm chain (4 modal interrupts) with weak in-context validation.

Desktop:
- Entry points:
  - `create_incident_from_incidents_view` in `ui/main_window.py:1251`
  - `create_incident_for_record` in `ui/main_window.py:1586`
- Happy path:
  1. Select installation in incidents panel.
  2. Enter note, severity, time adjustment, and apply flag via `QInputDialog`.
  3. Submit via `history.create_incident`.
  4. Refresh history and incidents panel.
- Friction:
  - Multi-step dialog chain is not form-based and is easy to cancel midway.

### 4) Link Asset To Installation

Web:
- Entry points:
  - Dynamic button injection in `dashboard.js:1729-1733`
  - `associateAssetFromWeb` in `dashboard.js:711`
- Happy path:
  1. Enter asset code via prompt.
  2. Enter target installation id via prompt.
  3. Enter optional note via prompt.
  4. Resolve asset then link via API.
- Friction:
  - Prompt-driven id entry has high invalid input risk.

Desktop:
- Entry point:
  - `show_asset_link_dialog` in `ui/main_window.py:2372`
- Happy path:
  1. Enter asset code.
  2. Enter destination installation id.
  3. Enter optional note.
  4. Call `history.associate_asset_with_installation`.
- Friction:
  - Also dialog-chained; no consolidated summary before submit.

### 5) Upload Incident Photo

Web:
- Entry point:
  - `selectAndUploadIncidentPhoto` in `dashboard.js:795`
- Happy path:
  1. Trigger from incident card action.
  2. Hidden file picker opens.
  3. Select file.
  4. Upload and refresh incident view.
- Friction:
  - Entry action is clear, but failure recovery depends on toasts only.

Desktop:
- Entry points:
  - `upload_photo_for_selected_incident` in `ui/main_window.py:1270`
  - `_upload_photo_for_incident` in `ui/main_window.py:1767`
- Happy path:
  1. Select incident in list.
  2. Open file picker.
  3. Upload and confirm with success dialog.
- Friction:
  - Strong dependency on prior list selection context.

### 6) Upload Driver

Web:
- Entry point:
  - `uploadDriverFromWeb` in `dashboard.js:2193`
  - Wired from `driverUploadBtn` listener in `dashboard.js:3943`
- Happy path:
  1. Fill brand/version/description.
  2. Pick file.
  3. Submit upload.
  4. Reset fields and reload driver table.
- Friction:
  - Validation is field-level but no persistent inline state for multi-error cases.

Desktop:
- Entry points:
  - `select_driver_file` in `ui/main_window.py:1926`
  - `upload_driver` in `ui/main_window.py:1941`
- Happy path:
  1. Select local file.
  2. Fill brand/version/description.
  3. Start upload via download manager.
- Friction:
  - Action wiring depends on button text matching in `_setup_connections`.

## Cross-Cutting Friction Notes
- Web still uses native browser prompt/confirm in critical operations (`dashboard.js`).
- Desktop uses many sequential `QInputDialog` interactions for transactional workflows.
- Desktop has fragile signal wiring by button label text in `MainWindow._setup_connections`.
- Critical actions are distributed across multiple contexts, increasing cognitive overhead.


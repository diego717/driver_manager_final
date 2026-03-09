// API base URL:
// - By default uses same-origin (recommended and safest).
// - Optional override via window.__DM_API_BASE__ or localStorage.dm_api_base_url.
// - Cross-origin overrides are blocked unless explicitly enabled for debug.
const API_BASE = (() => {
    const normalizeBase = (value) => {
        if (!value || typeof value !== 'string') return '';
        const trimmed = value.trim();
        if (!trimmed) return '';
        return trimmed.replace(/\/+$/, '');
    };

    const isLoopbackHost = (hostname) => {
        const normalized = String(hostname || '').toLowerCase();
        return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
    };

    const allowRemoteOverride = (() => {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const flag = String(params.get('dm_allow_remote_api') || '').toLowerCase();
            if (flag === '1' || flag === 'true' || flag === 'yes') {
                return true;
            }
        } catch {
            // Ignore malformed query string and keep secure default.
        }
        return window.__DM_ALLOW_REMOTE_API_BASE__ === true;
    })();

    const normalizeAndValidateApiBase = (rawValue, sourceLabel) => {
        const candidate = normalizeBase(rawValue);
        if (!candidate) return '';

        let parsed;
        try {
            parsed = new URL(candidate, window.location.origin);
        } catch {
            console.warn(`[security] Ignoring invalid API base override from ${sourceLabel}.`);
            return '';
        }

        const isHttps = parsed.protocol === 'https:';
        const isLoopback = isLoopbackHost(parsed.hostname);
        if (!isHttps && !isLoopback) {
            console.warn(`[security] Ignoring insecure API base override from ${sourceLabel}.`);
            return '';
        }

        const overrideOrigin = parsed.origin;
        const isSameOrigin = overrideOrigin === window.location.origin;
        if (!isSameOrigin && !allowRemoteOverride) {
            console.warn(
                `[security] Ignoring cross-origin API override from ${sourceLabel}. ` +
                'Use ?dm_allow_remote_api=1 only in controlled debug sessions.',
            );
            return '';
        }

        return normalizeBase(overrideOrigin);
    };

    const globalOverride = normalizeAndValidateApiBase(window.__DM_API_BASE__, 'window.__DM_API_BASE__');
    if (globalOverride) return globalOverride;

    try {
        const storedRawValue = window.localStorage.getItem('dm_api_base_url');
        const storedOverride = normalizeAndValidateApiBase(storedRawValue, 'localStorage.dm_api_base_url');
        if (storedOverride) {
            return storedOverride;
        }
        if (storedRawValue) {
            // Prevent persisting poisoned/invalid values.
            window.localStorage.removeItem('dm_api_base_url');
        }
    } catch {
        // localStorage unavailable (privacy mode/policies). Use same-origin.
    }

    return '';
})();

let currentUser = null;
let webAccessToken = '';
let charts = {};
let searchDebounceTimer = null;
let currentInstallationsData = [];
let currentSelectedInstallationId = null;
let currentAssetsData = [];
let currentSelectedAssetId = null;
let currentDriversData = [];
let selectedDriverFile = null;

// WebSocket/SSE State
let eventSource = null;
let sseReconnectTimer = null;
let sseReconnectAttempts = 0;
let sseLastConnectAttemptAt = 0;
let connectionStatusLastRendered = { status: '', at: 0 };
let connectionStatusMobileBindingsReady = false;
let connectionStatusLastScrollY = 0;
let connectionStatusForceVisibleUntil = 0;
let connectionStatusScrollHideTimer = null;
const MAX_SSE_RECONNECT_ATTEMPTS = 6;
const SSE_RECONNECT_BASE_DELAY = 2500;
const SSE_RECONNECT_MAX_DELAY = 30000;
const SSE_MIN_CONNECT_GAP_MS = 1200;
const CONNECTION_STATUS_DEDUP_MS = 700;
const SSE_ACTIVE_SECTIONS = new Set(['dashboard', 'installations', 'assets', 'drivers', 'incidents']);
const FORCE_LOGIN_ON_OPEN = true;
const QR_MAX_ASSET_CODE_LENGTH = 128;
const QR_MAX_BRAND_LENGTH = 120;
const QR_MAX_MODEL_LENGTH = 160;
const QR_MAX_SERIAL_LENGTH = 128;
const QR_MAX_CLIENT_LENGTH = 180;
const QR_MAX_NOTES_LENGTH = 2000;
const QR_PREVIEW_SIZE_PX = 320;
const QR_LABEL_PRESETS = {
    small: {
        key: 'small',
        width: 760,
        height: 340,
        padding: 18,
        qrSize: 260,
        textGap: 18,
        titleSize: 22,
        bodySize: 16,
        lineHeight: 24,
        titleLineHeight: 30,
    },
    medium: {
        key: 'medium',
        width: 960,
        height: 420,
        padding: 24,
        qrSize: 320,
        textGap: 24,
        titleSize: 28,
        bodySize: 20,
        lineHeight: 30,
        titleLineHeight: 38,
    },
};

let currentQrPayload = '';
let currentQrImageUrl = '';
let currentQrLabelInfo = null;
let currentQrLabelPreset = 'medium';
let qrModalReadOnly = false;
let qrModalEditUnlocked = false;
let qrModalEditUnlockUntil = 0;
let qrPasswordModalBusy = false;
let loginModalLastFocusedElement = null;
const QR_EDIT_UNLOCK_TTL_MS = 10 * 60 * 1000;
const KPI_NUMBER_ANIMATION_MS = 620;
const SECTION_TRANSITION_OUT_MS = 150;
const TOAST_DURATION_MS = 3100;
const SECTION_TITLES = {
    dashboard: 'Dashboard',
    installations: 'Registros',
    assets: 'Equipos',
    drivers: 'Drivers',
    incidents: 'Incidencias',
    audit: 'Auditoría',
};
const SECTION_SUBTITLES = {
    dashboard: 'Panorama general en tiempo real',
    installations: 'Seguimiento fino de registros operativos',
    assets: 'Inventario vivo con trazabilidad',
    drivers: 'Versionado centralizado de controladores',
    incidents: 'Atención de eventos con prioridad visible',
    audit: 'Trazas críticas y cumplimiento',
};
const TOAST_TYPE_ICONS = {
    success: '✓',
    error: '!',
    warning: '!',
    info: 'i',
};
const ACTIVE_KPI_ANIMATIONS = new WeakMap();
let sectionTransitionVersion = 0;

function renderContextualEmptyState(container, options = {}) {
    if (!container) return;
    const title = String(options.title || 'Sin resultados').trim() || 'Sin resultados';
    const description = String(options.description || '').trim();
    const actionLabel = String(options.actionLabel || '').trim();
    const actionHandler = typeof options.onAction === 'function' ? options.onAction : null;
    const tone = String(options.tone || 'neutral').trim().toLowerCase();
    const toneClass = ['neutral', 'warning', 'success', 'info'].includes(tone) ? tone : 'neutral';

    const wrapper = document.createElement('div');
    wrapper.className = `empty-state empty-state-${toneClass}`;

    const titleNode = document.createElement('p');
    titleNode.className = 'empty-state-title';
    titleNode.textContent = title;
    wrapper.appendChild(titleNode);

    if (description) {
        const descriptionNode = document.createElement('p');
        descriptionNode.className = 'empty-state-description';
        descriptionNode.textContent = description;
        wrapper.appendChild(descriptionNode);
    }

    if (actionLabel && actionHandler) {
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'btn-secondary empty-state-action';
        actionBtn.textContent = actionLabel;
        actionBtn.addEventListener('click', () => {
            void actionHandler();
        });
        wrapper.appendChild(actionBtn);
    }

    container.appendChild(wrapper);
}


// Chart.js default configuration
function isChartAvailable() {
    return typeof Chart !== 'undefined' && Chart && Chart.defaults;
}

function applyChartDefaults(theme = 'light') {
    if (!isChartAvailable()) return;
    if (theme === 'dark') {
        Chart.defaults.color = '#8b93a5';
        Chart.defaults.borderColor = '#2e3240';
    } else {
        Chart.defaults.color = '#5f6b7a';
        Chart.defaults.borderColor = '#dce1e8';
    }
    Chart.defaults.font.family = "'Source Sans 3', 'Segoe UI', sans-serif";
}

applyChartDefaults('light');

const apiFactory = window.DashboardApi && typeof window.DashboardApi.createClient === 'function'
    ? window.DashboardApi.createClient
    : null;

if (!apiFactory) {
    throw new Error('No se pudo inicializar DashboardApi. Verifica la carga de /dashboard-api.js');
}

const api = apiFactory({
    apiBase: API_BASE,
    getAccessToken: () => webAccessToken,
    setAccessToken: (value) => {
        webAccessToken = String(value || '');
    },
    onUnauthorized: () => {
        currentUser = null;
        webAccessToken = '';
        closeSSE();
        resetProtectedViews();
        showLogin();
    },
});

function showLogin() {
    loginModalLastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    resetProtectedViews();
    syncRoleBasedNavigationAccess();
    document.getElementById('loginModal').classList.add('active');
    document.body.classList.add('modal-open');
    focusLoginModalEntryField();
}

function hideLogin() {
    document.getElementById('loginModal').classList.remove('active');
    document.body.classList.remove('modal-open');
    document.getElementById('loginError').textContent = '';
    if (loginModalLastFocusedElement && document.contains(loginModalLastFocusedElement)) {
        loginModalLastFocusedElement.focus();
    }
    loginModalLastFocusedElement = null;
}

function isLoginModalActive() {
    return document.getElementById('loginModal')?.classList.contains('active') === true;
}

function getLoginModalFocusableElements() {
    const modal = document.getElementById('loginModal');
    if (!modal) return [];
    const selectors = [
        'button:not([disabled])',
        'input:not([type="hidden"]):not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[href]',
        '[tabindex]:not([tabindex="-1"])',
    ];
    return Array.from(modal.querySelectorAll(selectors.join(','))).filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        return !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true';
    });
}

function focusLoginModalEntryField() {
    const usernameField = document.getElementById('loginUsername');
    if (usernameField instanceof HTMLElement) {
        usernameField.focus();
        return;
    }
    const focusables = getLoginModalFocusableElements();
    if (focusables.length > 0) {
        focusables[0].focus();
    }
}

function handleLoginModalKeydown(event) {
    if (!isLoginModalActive()) return false;

    if (event.key === 'Escape') {
        event.preventDefault();
        hideLogin();
        return true;
    }

    if (event.key !== 'Tab') return false;

    const focusables = getLoginModalFocusableElements();
    if (focusables.length === 0) return false;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return true;
    }

    if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
        return true;
    }

    return false;
}

function resetProtectedViews() {
    const ids = [
        'recentInstallations',
        'installationsTable',
        'assetsTable',
        'assetDetail',
        'incidentsList',
        'auditLogs',
        'resultsCount',
        'assetsResultsCount',
    ];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '<p class="loading">Inicia sesión para ver información.</p>';
    });
    currentInstallationsData = [];
    currentSelectedInstallationId = null;
    currentAssetsData = [];
    currentSelectedAssetId = null;
    syncRoleBasedNavigationAccess();
}

function hasActiveSession() {
    return Boolean(currentUser && currentUser.username);
}

function requireActiveSession() {
    if (hasActiveSession()) return true;
    showLogin();
    return false;
}

function canCurrentUserAccessAudit() {
    const role = String(currentUser?.role || '').toLowerCase();
    return role === 'admin' || role === 'super_admin';
}

function syncRoleBasedNavigationAccess() {
    const auditLink = document.querySelector('.nav-links a[data-section="audit"]');
    if (!auditLink) return;
    const shouldShowAudit = canCurrentUserAccessAudit();
    const parent = auditLink.closest('li');
    if (parent) {
        parent.classList.toggle('is-hidden', !shouldShowAudit);
    }
}

function applyAuthenticatedUser(user) {
    currentUser = user;
    document.getElementById('username').textContent = user.username || 'Usuario';
    document.getElementById('userRole').textContent = user.role || 'admin';
    const initial = (user.username || 'U').charAt(0).toUpperCase();
    const avatarEl = document.getElementById('userInitial');
    if (avatarEl) avatarEl.textContent = initial;
    syncRoleBasedNavigationAccess();
}

function normalizeSeverity(input) {
    const valid = ['low', 'medium', 'high', 'critical'];
    const value = String(input || '').trim().toLowerCase();
    return valid.includes(value) ? value : 'medium';
}

function parseStrictInteger(rawValue) {
    const normalized = String(rawValue ?? '').trim();
    if (!normalized || !/^-?\d+$/.test(normalized)) return null;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isInteger(parsed) ? parsed : null;
}

let actionModalSubmitHandler = null;
let actionModalSubmitBusy = false;
let actionModalLastFocusedElement = null;
let actionModalEventsBound = false;

function setActionModalError(message = '') {
    const errorEl = document.getElementById('actionModalError');
    if (!errorEl) return;
    errorEl.textContent = String(message || '');
}

function setActionModalBusy(isBusy) {
    actionModalSubmitBusy = Boolean(isBusy);
    const submitBtn = document.getElementById('actionModalSubmitBtn');
    const cancelBtn = document.getElementById('actionModalCancelBtn');
    if (submitBtn) {
        const defaultLabel = submitBtn.dataset.defaultLabel || 'Guardar';
        submitBtn.disabled = actionModalSubmitBusy;
        submitBtn.textContent = actionModalSubmitBusy ? 'Procesando...' : defaultLabel;
    }
    if (cancelBtn) {
        cancelBtn.disabled = actionModalSubmitBusy;
    }
}

function closeActionModal(force = false) {
    if (actionModalSubmitBusy && !force) return;
    const modal = document.getElementById('actionModal');
    if (!modal) return;
    modal.classList.remove('active');
    document.body.classList.remove('modal-open');
    setActionModalError('');
    actionModalSubmitHandler = null;
    if (actionModalLastFocusedElement && document.contains(actionModalLastFocusedElement)) {
        actionModalLastFocusedElement.focus();
    }
    actionModalLastFocusedElement = null;
}

function openActionModal(config = {}) {
    const modal = document.getElementById('actionModal');
    const titleEl = document.getElementById('actionModalTitle');
    const subtitleEl = document.getElementById('actionModalSubtitle');
    const fieldsEl = document.getElementById('actionModalFields');
    const submitBtn = document.getElementById('actionModalSubmitBtn');
    if (!modal || !titleEl || !subtitleEl || !fieldsEl || !submitBtn) return false;

    titleEl.textContent = String(config.title || 'Acción');

    const subtitle = String(config.subtitle || '').trim();
    subtitleEl.textContent = subtitle;
    subtitleEl.classList.toggle('is-hidden', subtitle.length === 0);

    fieldsEl.innerHTML = String(config.fieldsHtml || '');

    const submitLabel = String(config.submitLabel || 'Guardar');
    submitBtn.dataset.defaultLabel = submitLabel;
    submitBtn.textContent = submitLabel;

    setActionModalError('');
    setActionModalBusy(false);
    actionModalSubmitHandler = typeof config.onSubmit === 'function' ? config.onSubmit : null;
    actionModalLastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    modal.classList.add('active');
    document.body.classList.add('modal-open');

    const preferredFocusId = String(config.focusId || '').trim();
    requestAnimationFrame(() => {
        const preferredElement = preferredFocusId
            ? document.getElementById(preferredFocusId)
            : null;
        if (preferredElement instanceof HTMLElement) {
            preferredElement.focus();
            return;
        }
        const fallback = modal.querySelector(
            'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])',
        );
        if (fallback instanceof HTMLElement) {
            fallback.focus();
        }
    });

    return true;
}

function openActionConfirmModal(config = {}) {
    const confirmCheckboxId = 'actionModalConfirmCheckbox';
    const title = String(config.title || 'Confirmar acción').trim() || 'Confirmar acción';
    const subtitle = String(config.subtitle || '').trim();
    const submitLabel = String(config.submitLabel || 'Confirmar').trim() || 'Confirmar';
    const acknowledgementText = String(config.acknowledgementText || 'Confirmo esta acción.').trim()
        || 'Confirmo esta acción.';
    const missingConfirmationMessage = String(
        config.missingConfirmationMessage || 'Debes confirmar la acción para continuar.',
    ).trim() || 'Debes confirmar la acción para continuar.';
    const focusId = String(config.focusId || confirmCheckboxId).trim() || confirmCheckboxId;
    const onSubmit = typeof config.onSubmit === 'function' ? config.onSubmit : async () => {};

    return openActionModal({
        title,
        subtitle,
        submitLabel,
        focusId,
        fieldsHtml: `
            <label class="action-checkbox" for="${confirmCheckboxId}">
                <input type="checkbox" id="${confirmCheckboxId}">
                <span>${escapeHtml(acknowledgementText)}</span>
            </label>
        `,
        onSubmit: async () => {
            const confirmed = document.getElementById(confirmCheckboxId)?.checked === true;
            if (!confirmed) {
                setActionModalError(missingConfirmationMessage);
                return;
            }
            await onSubmit();
        },
    });
}

function bindActionModalEvents() {
    if (actionModalEventsBound) return;

    document.querySelector('#actionModal .close')?.addEventListener('click', () => {
        closeActionModal();
    });

    document.getElementById('actionModalCancelBtn')?.addEventListener('click', () => {
        closeActionModal();
    });

    document.getElementById('actionModal')?.addEventListener('click', (event) => {
        if (event.target !== event.currentTarget) return;
        closeActionModal();
    });

    document.getElementById('actionModalForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (actionModalSubmitBusy) return;
        if (typeof actionModalSubmitHandler !== 'function') return;

        setActionModalError('');
        try {
            setActionModalBusy(true);
            await actionModalSubmitHandler();
        } catch (error) {
            setActionModalError(error?.message || 'No se pudo completar la acción.');
        } finally {
            setActionModalBusy(false);
        }
    });

    actionModalEventsBound = true;
}

function createManualRecordFromWeb() {
    if (!requireActiveSession()) return;

    const defaultClient = String(currentUser?.username || '').trim();
    openActionModal({
        title: 'Nuevo registro manual',
        subtitle: 'Crea un registro sin depender de una instalación previa.',
        submitLabel: 'Crear registro',
        focusId: 'actionRecordClient',
        fieldsHtml: `
            <div class="action-modal-grid">
                <div class="input-group">
                    <label for="actionRecordClient">Cliente (opcional)</label>
                    <input type="text" id="actionRecordClient" value="${escapeHtml(defaultClient)}" autocomplete="off">
                </div>
                <div class="input-group">
                    <label for="actionRecordStatus">Estado</label>
                    <select id="actionRecordStatus">
                        <option value="manual" selected>manual</option>
                        <option value="success">success</option>
                        <option value="failed">failed</option>
                        <option value="unknown">unknown</option>
                    </select>
                </div>
                <div class="input-group">
                    <label for="actionRecordBrand">Marca/Equipo (opcional)</label>
                    <input type="text" id="actionRecordBrand" value="N/A" autocomplete="off">
                </div>
                <div class="input-group">
                    <label for="actionRecordVersion">Versión/Referencia (opcional)</label>
                    <input type="text" id="actionRecordVersion" value="N/A" autocomplete="off">
                </div>
                <div class="input-group full-width">
                    <label for="actionRecordNotes">Notas (opcional)</label>
                    <textarea id="actionRecordNotes" rows="4"></textarea>
                </div>
            </div>
        `,
        onSubmit: async () => {
            const status = String(document.getElementById('actionRecordStatus')?.value || 'manual')
                .trim()
                .toLowerCase();
            const validStatus = ['manual', 'success', 'failed', 'unknown'];
            if (!validStatus.includes(status)) {
                setActionModalError('Selecciona un estado valido.');
                return;
            }

            const clientName = String(document.getElementById('actionRecordClient')?.value || '').trim();
            const brand = String(document.getElementById('actionRecordBrand')?.value || '').trim();
            const version = String(document.getElementById('actionRecordVersion')?.value || '').trim();
            const notes = String(document.getElementById('actionRecordNotes')?.value || '').trim();

            const result = await api.createRecord({
                client_name: clientName || 'Sin cliente',
                driver_brand: brand || 'N/A',
                driver_version: version || 'N/A',
                status,
                notes,
                driver_description: 'Registro manual desde dashboard web',
                os_info: 'web',
                installation_time_seconds: 0,
            });

            closeActionModal(true);
            const recordId = Number(result?.record?.id);
            showNotification(
                Number.isInteger(recordId) && recordId > 0
                    ? `Registro manual creado (#${recordId})`
                    : 'Registro manual creado.',
                'success',
            );
            await loadInstallations();

            if (Number.isInteger(recordId) && recordId > 0) {
                currentSelectedInstallationId = recordId;
                await showIncidentsForInstallation(recordId);
            }
        },
    });
}

function openIncidentModal(options = {}) {
    const parsedInstallationId = parseStrictInteger(options.installationId);
    const defaultInstallationId = Number.isInteger(parsedInstallationId) && parsedInstallationId > 0
        ? String(parsedInstallationId)
        : '';
    const defaultNote = String(options.note || '').trim();
    const defaultSeverity = normalizeSeverity(options.severity || 'medium');
    const parsedAdjustment = parseStrictInteger(options.timeAdjustment);
    const defaultAdjustment = Number.isInteger(parsedAdjustment) ? String(parsedAdjustment) : '0';
    const defaultApply = options.applyToInstallation === true;
    const numericAssetId = parseStrictInteger(options.assetId);
    const activeInstallationId = parseStrictInteger(options.activeInstallationId);

    const title = Number.isInteger(numericAssetId) && numericAssetId > 0
        ? `Nueva incidencia para equipo #${numericAssetId}`
        : 'Nueva incidencia';

    const subtitle = Number.isInteger(numericAssetId) && numericAssetId > 0
        ? 'Confirma el registro destino y los detalles de la incidencia.'
        : 'Completa el detalle, severidad y ajuste de tiempo.';

    openActionModal({
        title,
        subtitle,
        submitLabel: 'Crear incidencia',
        focusId: 'actionIncidentNote',
        fieldsHtml: `
            <div class="action-modal-grid">
                <div class="input-group">
                    <label for="actionIncidentInstallationId">ID de registro</label>
                    <input type="text" id="actionIncidentInstallationId" value="${escapeHtml(defaultInstallationId)}" autocomplete="off" placeholder="Ej: 245">
                </div>
                <div class="input-group">
                    <label for="actionIncidentSeverity">Severidad</label>
                    <select id="actionIncidentSeverity">
                        <option value="low" ${defaultSeverity === 'low' ? 'selected' : ''}>low</option>
                        <option value="medium" ${defaultSeverity === 'medium' ? 'selected' : ''}>medium</option>
                        <option value="high" ${defaultSeverity === 'high' ? 'selected' : ''}>high</option>
                        <option value="critical" ${defaultSeverity === 'critical' ? 'selected' : ''}>critical</option>
                    </select>
                </div>
                <div class="input-group">
                    <label for="actionIncidentAdjustment">Ajuste de tiempo (segundos)</label>
                    <input type="text" id="actionIncidentAdjustment" value="${escapeHtml(defaultAdjustment)}" autocomplete="off" placeholder="Ej: -90, 0, 120">
                </div>
                <div class="input-group full-width">
                    <label for="actionIncidentNote">Detalle de la incidencia</label>
                    <textarea id="actionIncidentNote" rows="4" placeholder="Describe el problema y el contexto">${escapeHtml(defaultNote)}</textarea>
                </div>
            </div>
            <label class="action-checkbox" for="actionIncidentApplyToRecord">
                <input type="checkbox" id="actionIncidentApplyToRecord" ${defaultApply ? 'checked' : ''}>
                <span>Aplicar nota y ajuste al registro de instalación.</span>
            </label>
        `,
        onSubmit: async () => {
            const targetInstallationId = parseStrictInteger(
                document.getElementById('actionIncidentInstallationId')?.value,
            );
            if (!Number.isInteger(targetInstallationId) || targetInstallationId <= 0) {
                setActionModalError('El ID de registro debe ser un entero positivo.');
                return;
            }

            const note = String(document.getElementById('actionIncidentNote')?.value || '').trim();
            if (!note) {
                setActionModalError('La incidencia requiere una nota.');
                return;
            }

            const timeAdjustment = parseStrictInteger(
                document.getElementById('actionIncidentAdjustment')?.value,
            );
            if (!Number.isInteger(timeAdjustment)) {
                setActionModalError('El ajuste de tiempo debe ser un número entero.');
                return;
            }

            const severity = normalizeSeverity(
                document.getElementById('actionIncidentSeverity')?.value || 'medium',
            );
            const applyToInstallation = document.getElementById('actionIncidentApplyToRecord')?.checked === true;

            if (Number.isInteger(numericAssetId) && numericAssetId > 0) {
                if (
                    !Number.isInteger(activeInstallationId)
                    || activeInstallationId <= 0
                    || activeInstallationId !== targetInstallationId
                ) {
                    await api.linkAssetToInstallation(numericAssetId, {
                        installation_id: targetInstallationId,
                        notes: 'Vinculo creado desde modulo Equipos',
                    });
                }
            }

            const result = await api.createIncident(targetInstallationId, {
                note,
                reporter_username: currentUser?.username || 'web_user',
                time_adjustment_seconds: timeAdjustment,
                severity,
                source: 'web',
                apply_to_installation: applyToInstallation,
            });

            closeActionModal(true);
            const incidentId = Number(result?.incident?.id);
            showNotification(
                Number.isInteger(incidentId) && incidentId > 0
                    ? `Incidencia creada (#${incidentId}) en registro #${targetInstallationId}`
                    : `Incidencia creada en registro #${targetInstallationId}`,
                'success',
            );

            if (Number.isInteger(numericAssetId) && numericAssetId > 0) {
                await loadAssetDetail(numericAssetId, { keepSelection: true });
            } else {
                await showIncidentsForInstallation(targetInstallationId);
            }
            await loadInstallations();
        },
    });
}

function createIncidentFromWeb(installationId, options = {}) {
    if (!requireActiveSession()) return;
    const targetId = parseStrictInteger(installationId);
    const numericAssetId = parseStrictInteger(options.assetId);

    if (
        (!Number.isInteger(targetId) || targetId <= 0)
        && (!Number.isInteger(numericAssetId) || numericAssetId <= 0)
    ) {
        showNotification('installation_id invalido para crear incidencia.', 'error');
        return;
    }

    openIncidentModal({
        installationId: Number.isInteger(targetId) && targetId > 0 ? targetId : '',
        assetId: numericAssetId,
        activeInstallationId: parseStrictInteger(options.activeInstallationId),
    });
}

function openAssetLinkModal(options = {}) {
    const knownAssetId = parseStrictInteger(options.assetId);
    const parsedInstallationId = parseStrictInteger(options.installationId);
    const defaultInstallationId = Number.isInteger(parsedInstallationId) && parsedInstallationId > 0
        ? String(parsedInstallationId)
        : '';
    const defaultCode = String(options.externalCode || '').trim();
    const defaultNotes = String(options.notes || '').trim();

    const needsExternalCode = !Number.isInteger(knownAssetId) || knownAssetId <= 0;
    const title = needsExternalCode ? 'Asociar equipo a registro' : `Vincular equipo #${knownAssetId}`;
    const subtitle = needsExternalCode
        ? 'Ingresa el código del equipo y el registro destino.'
        : 'Asocia el equipo seleccionado a un registro destino.';

    const codeField = needsExternalCode
        ? `
            <div class="input-group">
                <label for="actionAssetCode">Código externo del equipo (QR/serie)</label>
                <input type="text" id="actionAssetCode" value="${escapeHtml(defaultCode)}" autocomplete="off">
            </div>
        `
        : '';

    openActionModal({
        title,
        subtitle,
        submitLabel: 'Asociar equipo',
        focusId: needsExternalCode ? 'actionAssetCode' : 'actionAssetInstallationId',
        fieldsHtml: `
            <div class="action-modal-grid">
                ${codeField}
                <div class="input-group ${needsExternalCode ? '' : 'full-width'}">
                    <label for="actionAssetInstallationId">ID de registro destino</label>
                    <input type="text" id="actionAssetInstallationId" value="${escapeHtml(defaultInstallationId)}" autocomplete="off" placeholder="Ej: 245">
                </div>
                <div class="input-group full-width">
                    <label for="actionAssetNotes">Nota de asociacion (opcional)</label>
                    <textarea id="actionAssetNotes" rows="3">${escapeHtml(defaultNotes)}</textarea>
                </div>
            </div>
        `,
        onSubmit: async () => {
            const installationId = parseStrictInteger(
                document.getElementById('actionAssetInstallationId')?.value,
            );
            if (!Number.isInteger(installationId) || installationId <= 0) {
                setActionModalError('El ID de registro debe ser un entero positivo.');
                return;
            }

            const notes = String(document.getElementById('actionAssetNotes')?.value || '').trim();

            let resolvedAssetId = knownAssetId;
            let resolvedCode = '';
            if (!Number.isInteger(resolvedAssetId) || resolvedAssetId <= 0) {
                const externalCode = String(document.getElementById('actionAssetCode')?.value || '').trim();
                if (!externalCode) {
                    setActionModalError('Debes ingresar un código de equipo válido.');
                    return;
                }
                const resolved = await api.resolveAsset({
                    external_code: externalCode,
                });
                resolvedAssetId = parseStrictInteger(resolved?.asset?.id);
                resolvedCode = String(resolved?.asset?.external_code || externalCode).trim();
                if (!Number.isInteger(resolvedAssetId) || resolvedAssetId <= 0) {
                    setActionModalError('No se pudo resolver el ID del equipo.');
                    return;
                }
            }

            await api.linkAssetToInstallation(resolvedAssetId, {
                installation_id: installationId,
                notes,
            });

            closeActionModal(true);
            showNotification(
                resolvedCode
                    ? `Equipo ${resolvedCode} asociado a registro #${installationId}.`
                    : `Equipo asociado a registro #${installationId}.`,
                'success',
            );

            if (Number.isInteger(knownAssetId) && knownAssetId > 0) {
                await loadAssetDetail(knownAssetId, { keepSelection: true });
                return;
            }
            currentSelectedInstallationId = installationId;
            await loadInstallations();
            await showIncidentsForInstallation(installationId);
        },
    });
}

function associateAssetFromWeb() {
    if (!requireActiveSession()) return;
    openAssetLinkModal({
        installationId: currentSelectedInstallationId ? String(currentSelectedInstallationId) : '',
    });
}
async function openAssetLookupFromWeb() {
    if (!requireActiveSession()) return;
    openActionModal({
        title: 'Buscar equipo',
        subtitle: 'Ingresa el código externo para abrir el detalle en modo lectura.',
        submitLabel: 'Buscar',
        focusId: 'actionLookupAssetCode',
        fieldsHtml: `
            <div class="input-group">
                <label for="actionLookupAssetCode">Código externo del equipo</label>
                <input type="text" id="actionLookupAssetCode" autocomplete="off" placeholder="Ej: EQ-SL3-001">
            </div>
        `,
        onSubmit: async () => {
            const code = normalizeAssetCodeForQr(
                document.getElementById('actionLookupAssetCode')?.value || '',
            );
            if (!code) {
                setActionModalError('Debes ingresar un código de equipo válido.');
                return;
            }

            const response = await api.getAssets({
                code,
                limit: 1,
            });
            const asset = Array.isArray(response?.items) ? response.items[0] : null;
            if (!asset) {
                setActionModalError(`No existe equipo con código ${code}.`);
                return;
            }

            closeActionModal(true);
            showQrModal({ type: 'asset', asset, readOnly: true });
            generateQrPreview({
                assetData: {
                    external_code: normalizeAssetCodeForQr(asset.external_code || code),
                    brand: normalizeAssetFormText(asset.brand, QR_MAX_BRAND_LENGTH),
                    model: normalizeAssetFormText(asset.model, QR_MAX_MODEL_LENGTH),
                    serial_number: normalizeAssetFormText(asset.serial_number, QR_MAX_SERIAL_LENGTH),
                    client_name: normalizeAssetFormText(asset.client_name, QR_MAX_CLIENT_LENGTH),
                    notes: normalizeAssetFormText(asset.notes, QR_MAX_NOTES_LENGTH),
                },
            });
            showNotification(`Equipo cargado: ${asset.external_code || code}`, 'success');
        },
    });
}

async function selectAndUploadIncidentPhoto(incidentId, installationId) {
    const targetIncidentId = Number.parseInt(String(incidentId), 10);
    if (!Number.isInteger(targetIncidentId) || targetIncidentId <= 0) {
        showNotification('incident_id invalido para subir foto.', 'error');
        return;
    }

    const picker = document.createElement('input');
    picker.className = 'hidden-file-picker';
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
    document.body.appendChild(picker);

    picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        picker.remove();
        if (!file) return;

        try {
            await api.uploadIncidentPhoto(targetIncidentId, file);
            showNotification(`Foto subida a incidencia #${targetIncidentId}`, 'success');
            await showIncidentsForInstallation(installationId);
        } catch (err) {
            showNotification(`No se pudo subir foto: ${err.message || err}`, 'error');
        }
    }, { once: true });

    picker.click();
}

function updateStats(stats) {
    animateNumber('totalInstallations', stats.total_installations || 0);
    animateNumber('successRate', (stats.success_rate || 0) + '%');
    animateNumber('avgTime', (stats.average_time_minutes || 0) + ' min');
    animateNumber('uniqueClients', stats.unique_clients || 0);
}

function prefersReducedMotion() {
    return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
    );
}

function countFractionDigits(value) {
    const normalized = String(value);
    const fraction = normalized.split('.')[1];
    if (!fraction) return 0;
    return Math.min(2, fraction.length);
}

function parseMetricDescriptor(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return {
            isNumeric: true,
            prefix: '',
            suffix: '',
            target: value,
            decimals: countFractionDigits(value),
            fallbackText: String(value),
        };
    }

    const textValue = String(value ?? '').trim();
    if (!textValue) {
        return { isNumeric: false, fallbackText: '' };
    }

    const metricMatch = textValue.match(/^([^\d-]*)(-?\d+(?:[.,]\d+)?)(.*)$/u);
    if (!metricMatch) {
        return { isNumeric: false, fallbackText: textValue };
    }

    const numericToken = metricMatch[2];
    const target = Number.parseFloat(numericToken.replace(',', '.'));
    if (!Number.isFinite(target)) {
        return { isNumeric: false, fallbackText: textValue };
    }

    const decimalToken = numericToken.split(/[.,]/)[1] || '';
    return {
        isNumeric: true,
        prefix: metricMatch[1],
        suffix: metricMatch[3],
        target,
        decimals: Math.min(2, decimalToken.length),
        fallbackText: textValue,
    };
}

function formatMetricNumber(value, decimals) {
    return value.toLocaleString('es-ES', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

function setMetricDisplay(element, descriptor, numericValue) {
    const formattedNumber = formatMetricNumber(numericValue, descriptor.decimals);
    element.textContent = `${descriptor.prefix}${formattedNumber}${descriptor.suffix}`;
}

function cancelMetricAnimation(element) {
    const activeAnimation = ACTIVE_KPI_ANIMATIONS.get(element);
    if (typeof activeAnimation === 'number') {
        cancelAnimationFrame(activeAnimation);
    }
    ACTIVE_KPI_ANIMATIONS.delete(element);
}

function animateNumber(elementId, value) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const descriptor = parseMetricDescriptor(value);
    element.classList.remove('number-animate');
    void element.offsetWidth;
    element.classList.add('number-animate');

    if (!descriptor.isNumeric) {
        cancelMetricAnimation(element);
        element.textContent = descriptor.fallbackText;
        delete element.dataset.metricNumericValue;
        return;
    }

    const target = descriptor.target;
    const previousValue = Number.parseFloat(element.dataset.metricNumericValue || '');
    const startValue = Number.isFinite(previousValue) ? previousValue : 0;

    cancelMetricAnimation(element);

    if (prefersReducedMotion() || Math.abs(target - startValue) < 0.01) {
        setMetricDisplay(element, descriptor, target);
        element.dataset.metricNumericValue = String(target);
        return;
    }

    const animationStart = performance.now();
    const tick = (now) => {
        const elapsed = now - animationStart;
        const progress = Math.min(1, elapsed / KPI_NUMBER_ANIMATION_MS);
        const easedProgress = 1 - Math.pow(1 - progress, 4);
        const currentValue = startValue + (target - startValue) * easedProgress;

        setMetricDisplay(element, descriptor, currentValue);

        if (progress < 1) {
            const rafId = requestAnimationFrame(tick);
            ACTIVE_KPI_ANIMATIONS.set(element, rafId);
            return;
        }

        setMetricDisplay(element, descriptor, target);
        element.dataset.metricNumericValue = String(target);
        ACTIVE_KPI_ANIMATIONS.delete(element);
    };

    const initialRafId = requestAnimationFrame(tick);
    ACTIVE_KPI_ANIMATIONS.set(element, initialRafId);
}

// Chart rendering functions
function renderSuccessChart(stats) {
    if (!isChartAvailable()) return;
    const ctx = document.getElementById('successChart').getContext('2d');
    
    if (charts.success) {
        charts.success.destroy();
    }
    
    const success = stats.successful_installations || 0;
    const failed = stats.failed_installations || 0;
    const total = stats.total_installations || 1;
    const other = total - success - failed;
    
    charts.success = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['?xito', 'Fallido', 'Otro'],
            datasets: [{
                data: [success, failed, Math.max(0, other)],
                backgroundColor: [
                    'rgba(16, 185, 129, 0.8)',
                    'rgba(239, 68, 68, 0.8)',
                    'rgba(148, 163, 184, 0.3)'
                ],
                borderColor: [
                    'rgba(16, 185, 129, 1)',
                    'rgba(239, 68, 68, 1)',
                    'rgba(148, 163, 184, 0.5)'
                ],
                borderWidth: 2,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

function renderBrandChart(stats) {
    if (!isChartAvailable()) return;
    const ctx = document.getElementById('brandChart').getContext('2d');
    
    if (charts.brand) {
        charts.brand.destroy();
    }
    
    const brands = Object.entries(stats.by_brand || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);
    
    if (brands.length === 0) {
        brands.push(['Sin datos', 1]);
    }
    
    const colors = [
        'rgba(6, 182, 212, 0.8)',
        'rgba(139, 92, 246, 0.8)',
        'rgba(16, 185, 129, 0.8)',
        'rgba(245, 158, 11, 0.8)',
        'rgba(239, 68, 68, 0.8)',
        'rgba(59, 130, 246, 0.8)'
    ];
    
    charts.brand = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: brands.map(b => b[0]),
            datasets: [{
                label: 'Registros',
                data: brands.map(b => b[1]),
                backgroundColor: colors,
                borderColor: colors.map(c => c.replace('0.8', '1')),
                borderWidth: 2,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(71, 85, 105, 0.3)'
                    },
                    ticks: {
                        precision: 0
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

async function renderTrendChart() {
    if (!isChartAvailable()) return;
    const ctx = document.getElementById('trendChart').getContext('2d');
    
    if (charts.trend) {
        charts.trend.destroy();
    }
    
    try {
        const trendResponse = await api.getTrendData();
        const trendPoints = Array.isArray(trendResponse?.points) ? trendResponse.points : [];

        const labels = [];
        const data = [];

        if (trendPoints.length > 0) {
            for (const point of trendPoints) {
                const rawDate = typeof point?.date === 'string' ? point.date : '';
                const date = rawDate ? new Date(rawDate + 'T00:00:00Z') : null;
                labels.push(
                    date && !Number.isNaN(date.getTime())
                        ? date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })
                        : rawDate || 'N/A'
                );
                data.push(Number(point?.total_installations) || 0);
            }
        } else {
            const today = new Date();
            for (let i = 6; i >= 0; i--) {
                const date = new Date(today);
                date.setDate(date.getDate() - i);
                labels.push(date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }));
                data.push(0);
            }
        }
        
        charts.trend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Registros',
                    data: data,
                    borderColor: 'rgba(6, 182, 212, 1)',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: 'rgba(6, 182, 212, 1)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(71, 85, 105, 0.3)'
                        },
                        ticks: {
                            precision: 0
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    } catch (err) {
        console.error('Error rendering trend chart:', err);
    }
}

async function loadDashboard() {
    if (!requireActiveSession()) return;
    try {
        const stats = await api.getStatistics();
        updateStats(stats);
        
        // Render charts
        renderSuccessChart(stats);
        renderBrandChart(stats);
        await renderTrendChart();
        
        const installations = await api.getInstallations({ limit: 5 });
        renderRecentInstallations(installations);
    } catch (err) {
        console.error('Error cargando dashboard:', err);
    }
}

function renderRecentInstallations(installations) {
    const container = document.getElementById('recentInstallations');
    container.replaceChildren();

    if (!installations || !installations.length) {
        renderContextualEmptyState(container, {
            title: 'Aún no hay registros recientes',
            description: 'Cuando se genere actividad operativa, aparecerá aquí.',
            actionLabel: currentUser && currentUser.role !== 'viewer' ? 'Crear registro manual' : '',
            onAction: () => createManualRecordFromWeb(),
            tone: 'info',
        });
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['ID', 'Cliente', 'Marca', 'Estado', 'Atención', 'Fecha'].forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');

    installations.forEach(inst => {
        const statusClass = inst.status || 'unknown';
        const statusIcon = inst.status === 'success' ? 'OK' : inst.status === 'failed' ? 'X' : '?';

        const row = document.createElement('tr');

        const idCell = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = `#${inst.id ?? 'N/A'}`;
        idCell.appendChild(strong);

        const clientCell = document.createElement('td');
        clientCell.textContent = inst.client_name || 'N/A';

        const brandCell = document.createElement('td');
        brandCell.textContent = inst.driver_brand || 'N/A';

        const statusCell = document.createElement('td');
        const statusBadge = document.createElement('span');
        statusBadge.className = `badge ${statusClass}`;
        statusBadge.textContent = `${statusIcon} ${inst.status || 'unknown'}`;
        statusCell.appendChild(statusBadge);

        const attentionCell = document.createElement('td');
        const attentionBadge = document.createElement('span');
        const attentionMeta = buildRecordAttentionBadge(inst);
        attentionBadge.className = `badge ${attentionMeta.stateClass}`;
        attentionBadge.textContent = attentionMeta.text;
        attentionCell.appendChild(attentionBadge);

        const dateCell = document.createElement('td');
        dateCell.textContent = new Date(inst.timestamp).toLocaleString('es-ES');

        row.append(idCell, clientCell, brandCell, statusCell, attentionCell, dateCell);
        tbody.appendChild(row);
    });

    table.append(thead, tbody);
    container.appendChild(table);
}

// Advanced Filters Functions
function getActiveFilters() {
    const filters = {};
    
    const searchValue = document.getElementById('searchInput')?.value?.trim();
    const brandValue = document.getElementById('brandFilter')?.value;
    const statusValue = document.getElementById('statusFilter')?.value;
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    
    if (searchValue) filters.search = searchValue;
    if (brandValue) filters.brand = brandValue;
    if (statusValue) filters.status = statusValue;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    
    return filters;
}

function updateFilterChips() {
    const chipsContainer = document.getElementById('filterChips');
    const clearBtn = document.getElementById('clearFilters');
    const filters = getActiveFilters();
    
    chipsContainer.replaceChildren();
    let hasFilters = Object.keys(filters).length > 0;
    
    clearBtn?.classList.toggle('is-hidden', !hasFilters);
    
    const appendChip = (label, value, filterType) => {
        const chip = document.createElement('span');
        chip.className = 'filter-chip';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'chip-label';
        labelSpan.textContent = label;

        const valueSpan = document.createElement('span');
        valueSpan.className = 'chip-value';
        valueSpan.textContent = value;

        const removeSpan = document.createElement('span');
        removeSpan.className = 'chip-remove';
        removeSpan.dataset.filter = filterType;
        removeSpan.textContent = '-';

        chip.append(labelSpan, valueSpan, removeSpan);
        chipsContainer.appendChild(chip);
    };

    if (filters.search) {
        appendChip('Buscar:', `"${filters.search}"`, 'search');
    }

    if (filters.brand) {
        appendChip('Marca:', filters.brand, 'brand');
    }

    if (filters.status) {
        const statusLabel = filters.status === 'success' ? '? ?xito' :
                           filters.status === 'failed' ? '? Fallido' : '? Desconocido';
        appendChip('Estado:', statusLabel, 'status');
    }

    if (filters.startDate || filters.endDate) {
        const dateLabel = filters.startDate && filters.endDate ? 
            `${filters.startDate} - ${filters.endDate}` :
            filters.startDate ? `Desde: ${filters.startDate}` : `Hasta: ${filters.endDate}`;
        appendChip('Fecha:', dateLabel, 'date');
    }
    
    // Add click handlers to remove buttons
    chipsContainer.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filterType = e.target.dataset.filter;
            removeFilter(filterType);
        });
    });
}

function removeFilter(filterType) {
    switch (filterType) {
        case 'search':
            document.getElementById('searchInput').value = '';
            break;
        case 'brand':
            document.getElementById('brandFilter').value = '';
            break;
        case 'status':
            document.getElementById('statusFilter').value = '';
            break;
        case 'date':
            document.getElementById('startDate').value = '';
            document.getElementById('endDate').value = '';
            break;
    }
    
    updateFilterChips();
    
    // Apply filters immediately when removing
    debouncedSearch();
}

function clearAllFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('brandFilter').value = '';
    document.getElementById('statusFilter').value = '';
    document.getElementById('startDate').value = '';
    document.getElementById('endDate').value = '';
    
    updateFilterChips();
    debouncedSearch();
}

function toDurationSeconds(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
}

function formatDuration(value) {
    const totalSeconds = toDurationSeconds(value);
    if (totalSeconds <= 0) return '0s';

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (seconds || !parts.length) parts.push(`${seconds}s`);
    return parts.join(' ');
}

function normalizeRecordAttentionState(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'critical' || normalized === 'in_progress' || normalized === 'open' || normalized === 'resolved') {
        return normalized;
    }
    return 'clear';
}

function recordAttentionStateLabel(value) {
    const normalized = normalizeRecordAttentionState(value);
    if (normalized === 'critical') return 'Crítica';
    if (normalized === 'in_progress') return 'En curso';
    if (normalized === 'open') return 'Abierta';
    if (normalized === 'resolved') return 'Resuelta';
    return 'Sin incidencias';
}

function recordAttentionStateIcon(value) {
    const normalized = normalizeRecordAttentionState(value);
    if (normalized === 'critical') return 'Ys';
    if (normalized === 'in_progress') return 'YY';
    if (normalized === 'open') return 'YY';
    if (normalized === 'resolved') return 'OK';
    return 'YY';
}

function buildRecordAttentionBadge(record) {
    const state = normalizeRecordAttentionState(record?.attention_state);
    const activeCount = Number(record?.incident_active_count || 0);
    const resolvedCount = Number(record?.incident_resolved_count || 0);
    let countLabel = '';
    if (state === 'resolved' && resolvedCount > 0) {
        countLabel = ` (${resolvedCount})`;
    } else if (activeCount > 0) {
        countLabel = ` (${activeCount})`;
    }
    return {
        stateClass: `attention-${state}`,
        text: `${recordAttentionStateIcon(state)} ${recordAttentionStateLabel(state)}${countLabel}`,
    };
}

// Export Functions
function sanitizeSpreadsheetCell(value) {
    const normalized = String(value ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
    if (/^[\t\n\r ]*[=+\-@]/.test(normalized)) {
        return `'${normalized}`;
    }
    return normalized;
}

function toCsvCell(value) {
    const safe = sanitizeSpreadsheetCell(value);
    return `"${safe.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toExcelCell(value) {
    return escapeHtml(sanitizeSpreadsheetCell(value)).replace(/\n/g, '<br>');
}

function extractInstallationRecordNote(rawNotes) {
    const text = String(rawNotes || '').trim();
    if (!text) return '';
    const marker = '\n[INCIDENT]';
    const markerIndex = text.indexOf(marker);
    return markerIndex >= 0 ? text.slice(0, markerIndex).trim() : text;
}

function formatInstallationRecordNotePreview(rawNotes, maxLength = 80) {
    const note = extractInstallationRecordNote(rawNotes);
    if (!note) return '-';
    if (note.length <= maxLength) return note;
    return `${note.slice(0, maxLength)}...`;
}

function exportToCSV(data, filename = 'registros.csv') {
    if (!data || !data.length) {
        showNotification('No hay datos para exportar', 'error');
        return;
    }

    const headers = ['ID', 'Cliente', 'Marca', 'Atención', 'Tiempo', 'Notas', 'Fecha'];

    const rows = data.map(inst => [
        inst.id,
        inst.client_name || 'N/A',
        inst.driver_brand || 'N/A',
        buildRecordAttentionBadge(inst).text,
        formatDuration(inst.installation_time_seconds || 0),
        extractInstallationRecordNote(inst.notes),
        inst.timestamp
    ]);

    const csvContent = [
        headers.map(toCsvCell).join(','),
        ...rows.map(row => row.map(toCsvCell).join(','))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.className = 'download-link-hidden';
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showNotification(`Exportado: ${filename}`, 'success');
}

function exportToExcel(data, filename = 'registros.xls') {
    if (!data || !data.length) {
        showNotification('No hay datos para exportar', 'error');
        return;
    }

    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
    html += '<head><meta charset="UTF-8"><style>th { background-color: #06b6d4; color: white; font-weight: bold; }</style></head>';
    html += '<body><table border="1">';

    html += '<tr>';
    ['ID', 'Cliente', 'Marca', 'Atención', 'Tiempo', 'Notas', 'Fecha'].forEach(header => {
        html += `<th>${escapeHtml(header)}</th>`;
    });
    html += '</tr>';

    data.forEach(inst => {
        html += '<tr>';
        html += `<td>${toExcelCell(inst.id)}</td>`;
        html += `<td>${toExcelCell(inst.client_name || 'N/A')}</td>`;
        html += `<td>${toExcelCell(inst.driver_brand || 'N/A')}</td>`;
        html += `<td>${toExcelCell(buildRecordAttentionBadge(inst).text)}</td>`;
        html += `<td>${toExcelCell(formatDuration(inst.installation_time_seconds || 0))}</td>`;
        html += `<td>${toExcelCell(extractInstallationRecordNote(inst.notes).substring(0, 120))}</td>`;
        html += `<td>${toExcelCell(inst.timestamp)}</td>`;
        html += '</tr>';
    });

    html += '</table></body></html>';

    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const link = document.createElement('a');
    link.className = 'download-link-hidden';
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showNotification(`Exportado: ${filename}`, 'success');
}

function setupExportButtons() {
    const exportBtn = document.getElementById('exportBtn');
    if (!exportBtn) return;
    if (exportBtn.closest('.export-dropdown')) return;

    const exportDropdown = document.createElement('div');
    exportDropdown.className = 'export-dropdown';
    exportDropdown.innerHTML = `
        <button id="exportBtn" class="btn-secondary export-toggle" type="button" aria-expanded="false">
            <span class="material-symbols-outlined icon-inline-sm">download</span> Exportar
        </button>
        <div class="export-menu" role="menu" aria-label="Opciones de exportacion">
            <button class="export-option" type="button" data-format="csv" role="menuitem">Exportar CSV</button>
            <button class="export-option" type="button" data-format="excel" role="menuitem">Exportar Excel</button>
        </div>
    `;

    exportBtn.replaceWith(exportDropdown);

    const btn = exportDropdown.querySelector('#exportBtn');
    const menu = exportDropdown.querySelector('.export-menu');

    const closeMenu = () => {
        exportDropdown.classList.remove('is-open');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    };

    btn?.addEventListener('click', (event) => {
        event.stopPropagation();
        const nextOpen = !exportDropdown.classList.contains('is-open');
        document.querySelectorAll('.export-dropdown.is-open').forEach((node) => {
            node.classList.remove('is-open');
            node.querySelector('.export-toggle')?.setAttribute('aria-expanded', 'false');
        });
        exportDropdown.classList.toggle('is-open', nextOpen);
        btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    });

    document.addEventListener('click', (event) => {
        if (exportDropdown.contains(event.target)) return;
        closeMenu();
    });

    menu?.addEventListener('click', (event) => {
        const option = event.target.closest('.export-option');
        if (!option) return;

        const format = option.dataset.format;
        if (format === 'csv') {
            exportToCSV(currentInstallationsData);
        } else if (format === 'excel') {
            exportToExcel(currentInstallationsData);
        }
        closeMenu();
    });
}


function debouncedSearch() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.classList.add('loading');
    }
    
    // Clear previous timer
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
    }
    
    // Set new timer - 300ms delay for real-time search
    searchDebounceTimer = setTimeout(() => {
        loadInstallations();
        if (searchInput) {
            searchInput.classList.remove('loading');
        }
    }, 300);
}

function setupAdvancedFilters() {
    // Real-time search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            updateFilterChips();
            debouncedSearch();
        });
        
        // Enter key triggers immediate search
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (searchDebounceTimer) {
                    clearTimeout(searchDebounceTimer);
                }
                loadInstallations();
            }
        });
    }
    
    // Filter change handlers
    const brandFilter = document.getElementById('brandFilter');
    const statusFilter = document.getElementById('statusFilter');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    
    if (brandFilter) {
        brandFilter.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }
    
    if (startDate) {
        startDate.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }
    
    if (endDate) {
        endDate.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }
    
    // Clear filters button
    const clearBtn = document.getElementById('clearFilters');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearAllFilters);
    }

    const actionsContainer = document.querySelector('.filter-actions');
    if (actionsContainer && !document.getElementById('createManualRecordBtn')) {
        const createRecordBtn = document.createElement('button');
        createRecordBtn.id = 'createManualRecordBtn';
        createRecordBtn.className = 'btn-secondary';
        createRecordBtn.textContent = 'Y" Nuevo registro manual';
        createRecordBtn.addEventListener('click', () => {
            void createManualRecordFromWeb();
        });
        actionsContainer.insertBefore(createRecordBtn, document.getElementById('applyFilters'));
    }
    if (actionsContainer && !document.getElementById('openQrGeneratorBtn')) {
        const qrButton = document.createElement('button');
        qrButton.id = 'openQrGeneratorBtn';
        qrButton.type = 'button';
        qrButton.className = 'btn-secondary';
        qrButton.textContent = 'QR equipo';
        qrButton.addEventListener('click', () => {
            showQrModal({ type: 'asset', value: '' });
        });
        actionsContainer.insertBefore(qrButton, document.getElementById('applyFilters'));
    }
    if (actionsContainer && !document.getElementById('associateAssetBtn')) {
        const associateButton = document.createElement('button');
        associateButton.id = 'associateAssetBtn';
        associateButton.type = 'button';
        associateButton.className = 'btn-secondary';
        associateButton.textContent = 'Asociar equipo';
        associateButton.addEventListener('click', () => {
            void associateAssetFromWeb();
        });
        actionsContainer.insertBefore(associateButton, document.getElementById('applyFilters'));
    }
    if (actionsContainer && !document.getElementById('lookupAssetBtn')) {
        const lookupButton = document.createElement('button');
        lookupButton.id = 'lookupAssetBtn';
        lookupButton.type = 'button';
        lookupButton.className = 'btn-secondary';
        lookupButton.textContent = 'Buscar equipo';
        lookupButton.addEventListener('click', () => {
            void openAssetLookupFromWeb();
        });
        actionsContainer.insertBefore(lookupButton, document.getElementById('applyFilters'));
    }
    
    // Keyboard shortcut: Ctrl+K to focus search
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
        }
    });
}

async function loadInstallations() {
    if (!requireActiveSession()) return;
    const container = document.getElementById('installationsTable');
    const resultsCount = document.getElementById('resultsCount');
    container.innerHTML = '<p class="loading">Cargando...</p>';
    
    if (resultsCount) {
        resultsCount.innerHTML = '<span class="loading">Buscando...</span>';
    }
    
    try {
        const filters = getActiveFilters();
        
        const params = {
            client_name: filters.search || '', // Use search for client_name
            brand: filters.brand || '',
            status: filters.status || '',
            start_date: filters.startDate || '',
            end_date: filters.endDate || '',
            limit: 50
        };
        
        const installations = await api.getInstallations(params);
        currentInstallationsData = installations || [];
        renderInstallationsTable(installations);
        
        // Update results count
        if (resultsCount) {
            const count = installations?.length || 0;
            resultsCount.innerHTML = `Mostrando <span class="count">${count}</span> resultado${count !== 1 ? 's' : ''}`;
        }
        
        // Update filter chips (in case they were cleared externally)
        updateFilterChips();
    } catch (err) {
        container.replaceChildren();
        renderContextualEmptyState(container, {
            title: 'No se pudieron cargar los registros',
            description: 'Verifica tu conexión y vuelve a intentar.',
            actionLabel: 'Reintentar',
            onAction: () => loadInstallations(),
            tone: 'warning',
        });
        if (resultsCount) {
            resultsCount.textContent = 'Error al cargar';
        }
    }
}


function renderInstallationsTable(installations) {
    const container = document.getElementById('installationsTable');
    container.replaceChildren();

    if (!installations || !installations.length) {
        renderContextualEmptyState(container, {
            title: 'No encontramos registros con esos filtros',
            description: 'Puedes limpiar filtros o crear un registro manual.',
            actionLabel: 'Limpiar filtros',
            onAction: () => {
                clearAllFilters();
                void loadInstallations();
            },
            tone: 'neutral',
        });
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['ID', 'Cliente', 'Marca', 'Atención', 'Tiempo', 'Notas', 'Fecha', 'QR'].forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');

    installations.forEach(inst => {
        const row = document.createElement('tr');
        row.dataset.id = String(inst.id ?? '');

        const idCell = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = `#${inst.id ?? 'N/A'}`;
        idCell.appendChild(strong);

        const clientCell = document.createElement('td');
        clientCell.textContent = inst.client_name || 'N/A';

        const brandCell = document.createElement('td');
        brandCell.textContent = inst.driver_brand || 'N/A';

        const attentionCell = document.createElement('td');
        const attentionBadge = document.createElement('span');
        const attentionMeta = buildRecordAttentionBadge(inst);
        attentionBadge.className = `badge ${attentionMeta.stateClass}`;
        attentionBadge.textContent = attentionMeta.text;
        attentionCell.appendChild(attentionBadge);

        const timeCell = document.createElement('td');
        timeCell.textContent = formatDuration(inst.installation_time_seconds ?? 0);

        const notesCell = document.createElement('td');
        notesCell.textContent = formatInstallationRecordNotePreview(inst.notes);

        const dateCell = document.createElement('td');
        dateCell.textContent = new Date(inst.timestamp).toLocaleString('es-ES');

        const qrCell = document.createElement('td');
        const qrButton = document.createElement('button');
        qrButton.type = 'button';
        qrButton.className = 'btn-secondary table-action-btn';
        qrButton.textContent = 'QR';
        qrButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            showQrModal({ type: 'installation', value: String(inst.id ?? '') });
        });
        qrCell.appendChild(qrButton);

        row.append(idCell, clientCell, brandCell, attentionCell, timeCell, notesCell, dateCell, qrCell);
        tbody.appendChild(row);
    });

    table.append(thead, tbody);
    container.appendChild(table);

    container.querySelectorAll('tr[data-id]').forEach(row => {
        row.addEventListener('click', () => {
            const id = row.dataset.id;
            showIncidentsForInstallation(id);
        });
    });
}

async function showIncidentsForInstallation(installationId) {
    if (!requireActiveSession()) return;
    currentSelectedInstallationId = Number.parseInt(String(installationId), 10);
    const container = document.getElementById('incidentsList');
    document.querySelector('[data-section="incidents"]').click();
    container.innerHTML = '<p class="loading">Cargando incidencias...</p>';
    
    try {
        const data = await api.getIncidents(installationId);
        renderIncidents(data.incidents || [], installationId);
    } catch (err) {
        container.innerHTML = '<p class="error">Error cargando incidencias</p>';
    }
}

function normalizeAssetStatusLabel(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (!normalized) return 'active';
    return normalized;
}

function getSeverityIcon(severity) {
    if (severity === 'critical') return 'Y"';
    if (severity === 'high') return 'YY';
    if (severity === 'medium') return 'YY';
    return 'Y"';
}

function normalizeIncidentStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'in_progress') return 'in_progress';
    if (normalized === 'resolved') return 'resolved';
    return 'open';
}

function incidentStatusLabel(value) {
    const normalized = normalizeIncidentStatus(value);
    if (normalized === 'resolved') return 'Resuelta';
    if (normalized === 'in_progress') return 'En curso';
    return 'Abierta';
}

function incidentStatusIcon(value) {
    const normalized = normalizeIncidentStatus(value);
    if (normalized === 'resolved') return 'OK';
    if (normalized === 'in_progress') return 'YY';
    return 'YY';
}

function buildIncidentStatusText(incident) {
    const status = normalizeIncidentStatus(incident?.incident_status);
    let text = `${incidentStatusIcon(status)} ${incidentStatusLabel(status)}`;
    if (status === 'resolved' && incident?.resolved_at) {
        text += ` · ${new Date(incident.resolved_at).toLocaleString('es-ES')}`;
    } else if (incident?.status_updated_at) {
        text += ` · ${new Date(incident.status_updated_at).toLocaleString('es-ES')}`;
    }
    return text;
}

function normalizeIncidentChecklistItems(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter((item) => item.length > 0);
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((item) => String(item || '').trim())
                    .filter((item) => item.length > 0);
            }
        } catch {
            return [];
        }
    }
    return [];
}

function buildIncidentChecklistText(checklistItemsValue) {
    const checklistItems = normalizeIncidentChecklistItems(checklistItemsValue);
    return checklistItems.length ? `Checklist: ${checklistItems.join(' · ')}` : 'Checklist: -';
}

function buildIncidentEvidenceText(evidenceNoteValue) {
    const evidenceNote = String(evidenceNoteValue || '').trim();
    return evidenceNote ? `Nota operativa: ${evidenceNote}` : 'Nota operativa: -';
}

function buildIncidentResolutionText(resolutionNoteValue) {
    const resolutionNote = String(resolutionNoteValue || '').trim();
    return resolutionNote ? `Resolución: ${resolutionNote}` : 'Resolución: -';
}

function createIncidentMetaLine(text) {
    const meta = document.createElement('small');
    meta.className = 'asset-muted incident-meta-line';
    meta.textContent = text;
    return meta;
}

function appendIncidentMetaLines(parent, incident) {
    parent.append(
        createIncidentMetaLine(`Estado: ${buildIncidentStatusText(incident)}`),
        createIncidentMetaLine(`Ajuste tiempo: ${formatDuration(incident.time_adjustment_seconds ?? 0)}`),
        createIncidentMetaLine(buildIncidentChecklistText(incident.checklist_items)),
        createIncidentMetaLine(buildIncidentEvidenceText(incident.evidence_note)),
        createIncidentMetaLine(buildIncidentResolutionText(incident.resolution_note)),
    );
}

function buildIncidentStatusUpdateOptions(incident, options = {}) {
    const updateOptions = {};
    const installationCandidate = options.installationId ?? incident?.installation_id;
    const parsedInstallationId = parseStrictInteger(installationCandidate);
    if (Number.isInteger(parsedInstallationId) && parsedInstallationId > 0) {
        updateOptions.installationId = parsedInstallationId;
    }

    const parsedAssetId = parseStrictInteger(options.assetId);
    if (Number.isInteger(parsedAssetId) && parsedAssetId > 0) {
        updateOptions.assetId = parsedAssetId;
    }
    return updateOptions;
}

function appendIncidentStatusActions(parent, incident, options = {}) {
    const statusActions = document.createElement('div');
    statusActions.className = 'incident-actions';
    const incidentStatus = normalizeIncidentStatus(incident.incident_status);
    const canUpdateIncident = canCurrentUserEditAssets();
    const updateOptions = buildIncidentStatusUpdateOptions(incident, options);

    const makeStatusBtn = (label, statusValue) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-secondary';
        button.textContent = label;
        button.disabled = !canUpdateIncident || incidentStatus === statusValue;
        if (!canUpdateIncident) {
            button.title = 'Solo admin/super_admin puede cambiar estado de incidencias';
        }
        button.addEventListener('click', () => {
            void updateIncidentStatusFromWeb(incident, statusValue, updateOptions);
        });
        return button;
    };

    statusActions.append(
        makeStatusBtn('Abrir', 'open'),
        makeStatusBtn('En curso', 'in_progress'),
        makeStatusBtn('Resolver', 'resolved'),
    );
    parent.appendChild(statusActions);
}

function appendIncidentUploadPhotoAction(parent, incident, installationId, options = {}) {
    const uploadPhotoBtn = document.createElement('button');
    uploadPhotoBtn.className = 'btn-secondary';
    uploadPhotoBtn.textContent = String(options.label || 'Subir foto');
    uploadPhotoBtn.classList.add('incident-upload-btn');
    uploadPhotoBtn.addEventListener('click', () => {
        void selectAndUploadIncidentPhoto(incident.id, installationId);
    });
    parent.appendChild(uploadPhotoBtn);
}

async function appendIncidentPhotosGrid(parent, photos, options = {}) {
    if (!Array.isArray(photos) || photos.length === 0) return;
    const photosGrid = document.createElement('div');
    photosGrid.className = 'photos-grid';

    for (const photo of photos) {
        const photoId = parseStrictInteger(photo?.id);
        if (!Number.isInteger(photoId) || photoId <= 0) continue;
        const photoUrl = await loadPhotoWithAuth(photoId);
        if (!photoUrl) continue;

        const image = document.createElement('img');
        image.src = photoUrl;
        image.className = 'photo-thumb';
        image.alt = 'Foto de incidencia';
        if (options.attachPhotoIdDataset === true) {
            image.dataset.photoId = String(photoId);
        }
        image.addEventListener('click', () => viewPhoto(photoId));
        photosGrid.appendChild(image);
    }

    if (photosGrid.childElementCount > 0) {
        parent.appendChild(photosGrid);
    }
}

async function updateIncidentStatusFromWeb(incident, targetStatus, options = {}) {
    if (!requireActiveSession()) return;
    const incidentId = Number.parseInt(String(incident?.id), 10);
    if (!Number.isInteger(incidentId) || incidentId <= 0) {
        showNotification('Incidencia invalida para actualizar estado.', 'error');
        return;
    }

    const normalizedStatus = normalizeIncidentStatus(targetStatus);
    const applyStatusUpdate = async (resolutionNote = '') => {
        try {
            await api.updateIncidentStatus(incidentId, {
                incident_status: normalizedStatus,
                resolution_note: resolutionNote,
                reporter_username: currentUser?.username || 'web_user',
            });
            showNotification(
                `Incidencia #${incidentId} actualizada a "${incidentStatusLabel(normalizedStatus)}".`,
                'success',
            );

            if (Number.isInteger(options.installationId) && options.installationId > 0) {
                await showIncidentsForInstallation(options.installationId);
                return;
            }
            if (Number.isInteger(options.assetId) && options.assetId > 0) {
                await loadAssetDetail(options.assetId, { keepSelection: true });
                return;
            }
            if (currentSelectedInstallationId) {
                await showIncidentsForInstallation(currentSelectedInstallationId);
            }
        } catch (err) {
            showNotification(`No se pudo actualizar estado: ${err.message || err}`, 'error');
        }
    };

    if (normalizedStatus === 'resolved') {
        const defaultNote = String(incident?.resolution_note || '').trim();
        openActionModal({
            title: `Resolver incidencia #${incidentId}`,
            subtitle: 'Agrega una nota de resolución opcional antes de cerrar la incidencia.',
            submitLabel: 'Resolver incidencia',
            focusId: 'actionIncidentResolutionNote',
            fieldsHtml: `
                <div class="input-group">
                    <label for="actionIncidentResolutionNote">Nota de resolución (opcional)</label>
                    <textarea id="actionIncidentResolutionNote" rows="4" placeholder="Resumen de la solucion aplicada">${escapeHtml(defaultNote)}</textarea>
                </div>
            `,
            onSubmit: async () => {
                const resolutionNote = String(
                    document.getElementById('actionIncidentResolutionNote')?.value || '',
                ).trim();
                await applyStatusUpdate(resolutionNote);
                closeActionModal(true);
            },
        });
        return;
    }

    await applyStatusUpdate('');
}

async function loadAssets() {
    if (!requireActiveSession()) return;
    const tableContainer = document.getElementById('assetsTable');
    const resultsCount = document.getElementById('assetsResultsCount');
    const searchInput = document.getElementById('assetsSearchInput');
    if (!tableContainer) return;

    tableContainer.innerHTML = '<p class="loading">Cargando equipos...</p>';
    if (resultsCount) {
        resultsCount.innerHTML = '<span class="loading">Buscando...</span>';
    }

    try {
        const search = String(searchInput?.value || '').trim();
        const params = { limit: 200 };
        if (search) {
            params.search = search;
        }

        const response = await api.getAssets(params);
        const assets = Array.isArray(response?.items) ? response.items : [];
        currentAssetsData = assets;
        renderAssetsTable(assets);

        if (resultsCount) {
            const count = assets.length;
            resultsCount.innerHTML = `Mostrando <span class="count">${count}</span> equipo${count !== 1 ? 's' : ''}`;
        }

        if (currentSelectedAssetId) {
            const selectedAsset = assets.find((item) => Number(item.id) === Number(currentSelectedAssetId));
            if (selectedAsset) {
                await loadAssetDetail(selectedAsset.id, { keepSelection: true });
            }
        }
    } catch (err) {
        tableContainer.innerHTML = '<p class="error">Error cargando equipos</p>';
        if (resultsCount) {
            resultsCount.textContent = 'Error al cargar';
        }
    }
}

function formatDriverSize(bytes, sizeMb) {
    const numericBytes = Number(bytes);
    if (Number.isFinite(numericBytes) && numericBytes > 0) {
        if (numericBytes >= 1024 * 1024) {
            return `${(numericBytes / (1024 * 1024)).toFixed(2)} MB`;
        }
        return `${(numericBytes / 1024).toFixed(1)} KB`;
    }
    const numericMb = Number(sizeMb);
    if (Number.isFinite(numericMb) && numericMb > 0) {
        return `${numericMb.toFixed(2)} MB`;
    }
    return 'N/A';
}

function updateDriverSelectedFileLabel() {
    const label = document.getElementById('driversSelectedFileLabel');
    if (!label) return;
    if (!selectedDriverFile) {
        label.textContent = 'Sin archivo seleccionado';
        return;
    }
    label.textContent = `${selectedDriverFile.name} (${formatDriverSize(selectedDriverFile.size, null)})`;
}

async function loadDrivers() {
    if (!requireActiveSession()) return;
    const tableContainer = document.getElementById('driversTable');
    const resultsCount = document.getElementById('driversResultsCount');
    if (!tableContainer) return;

    tableContainer.innerHTML = '<p class="loading">Cargando drivers...</p>';
    if (resultsCount) {
        resultsCount.innerHTML = '<span class="loading">Buscando...</span>';
    }

    try {
        const response = await api.getDrivers({ limit: 200 });
        const items = Array.isArray(response?.items) ? response.items : [];
        currentDriversData = items;
        renderDriversTable(items);

        if (resultsCount) {
            const count = items.length;
            resultsCount.innerHTML = `Mostrando <span class="count">${count}</span> driver${count !== 1 ? 's' : ''}`;
        }
    } catch (err) {
        tableContainer.replaceChildren();
        renderContextualEmptyState(tableContainer, {
            title: 'No se pudieron cargar los drivers',
            description: 'Intenta nuevamente en unos segundos.',
            actionLabel: 'Reintentar',
            onAction: () => loadDrivers(),
            tone: 'warning',
        });
        if (resultsCount) {
            resultsCount.textContent = 'Error al cargar';
        }
    }
}

function renderDriversTable(drivers) {
    const container = document.getElementById('driversTable');
    if (!container) return;
    container.replaceChildren();

    if (!drivers || !drivers.length) {
        renderContextualEmptyState(container, {
            title: 'Todavía no hay drivers cargados',
            description: 'Sube el primer paquete para habilitar instalaciónes por marca y versión.',
            actionLabel: 'Subir primer driver',
            onAction: () => document.getElementById('driverPickFileBtn')?.click(),
            tone: 'info',
        });
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Marca', 'Versión', 'Archivo', 'Tamaño', 'Subido', 'Acciónes'].forEach((label) => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');
    for (const driver of drivers) {
        const row = document.createElement('tr');

        const brandCell = document.createElement('td');
        brandCell.textContent = driver.brand || '-';

        const versionCell = document.createElement('td');
        versionCell.textContent = driver.version || '-';

        const fileCell = document.createElement('td');
        fileCell.textContent = driver.filename || '-';

        const sizeCell = document.createElement('td');
        sizeCell.textContent = formatDriverSize(driver.size_bytes, driver.size_mb);

        const uploadedCell = document.createElement('td');
        uploadedCell.textContent = driver.last_modified
            ? String(driver.last_modified)
            : (driver.uploaded ? new Date(driver.uploaded).toLocaleString('es-ES') : '-');

        const actionsCell = document.createElement('td');
        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'btn-secondary table-action-btn';
        downloadBtn.textContent = 'Descargar';
        downloadBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const key = String(driver.key || '').trim();
            if (!key) return;
            window.open(`/web/drivers/download?key=${encodeURIComponent(key)}`, '_blank', 'noopener');
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn-secondary table-action-btn';
        deleteBtn.textContent = 'Eliminar';
        deleteBtn.classList.add('spaced-action-btn');
        deleteBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const key = String(driver.key || '').trim();
            if (!key) return;
            const driverLabel = String(`${driver.brand || ''} ${driver.version || ''}`).trim() || 'sin nombre';
            openActionConfirmModal({
                title: 'Eliminar driver',
                subtitle: `Confirma la eliminación de ${driverLabel}. Esta acción no se puede deshacer.`,
                submitLabel: 'Eliminar driver',
                acknowledgementText: 'Entiendo que este driver sera eliminado permanentemente.',
                missingConfirmationMessage: 'Debes confirmar la eliminación para continuar.',
                onSubmit: async () => {
                    await api.deleteDriver(key);
                    closeActionModal(true);
                    showNotification('Driver eliminado', 'success');
                    await loadDrivers();
                },
            });
        });

        actionsCell.append(downloadBtn, deleteBtn);

        row.append(brandCell, versionCell, fileCell, sizeCell, uploadedCell, actionsCell);
        tbody.appendChild(row);
    }

    table.append(thead, tbody);
    container.appendChild(table);
}

async function uploadDriverFromWeb() {
    if (!requireActiveSession()) return;
    const brandInput = document.getElementById('driverBrandInput');
    const versionInput = document.getElementById('driverVersionInput');
    const descriptionInput = document.getElementById('driverDescriptionInput');
    const uploadBtn = document.getElementById('driverUploadBtn');
    const brand = String(brandInput?.value || '').trim();
    const version = String(versionInput?.value || '').trim();
    const description = String(descriptionInput?.value || '').trim();

    if (!brand) {
        showNotification('La marca es obligatoria.', 'error');
        return;
    }
    if (!version) {
        showNotification('La versión es obligatoria.', 'error');
        return;
    }
    if (!selectedDriverFile) {
        showNotification('Selecciona un archivo para subir.', 'error');
        return;
    }

    const previousText = uploadBtn?.textContent || '';
    if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Subiendo...';
    }

    try {
        await api.uploadDriver(selectedDriverFile, {
            brand,
            version,
            description
        });
        showNotification(`Driver ${brand} ${version} subido correctamente.`, 'success');
        selectedDriverFile = null;
        if (descriptionInput) descriptionInput.value = '';
        if (versionInput) versionInput.value = '';
        if (brandInput) brandInput.value = '';
        updateDriverSelectedFileLabel();
        await loadDrivers();
    } catch (err) {
        showNotification(`No se pudo subir driver: ${err.message || err}`, 'error');
    } finally {
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.textContent = previousText || 'Subir driver';
        }
    }
}

function renderAssetsTable(assets) {
    const container = document.getElementById('assetsTable');
    if (!container) return;
    container.replaceChildren();

    if (!assets || !assets.length) {
        renderContextualEmptyState(container, {
            title: 'No hay equipos registrados',
            description: 'Crea un equipo con QR para asociarlo a registros o incidencias.',
            actionLabel: 'Nuevo equipo + QR',
            onAction: () => document.getElementById('assetsCreateQrBtn')?.click(),
            tone: 'info',
        });
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['ID', 'Código', 'Marca', 'Modelo', 'Serie', 'Cliente', 'Estado', 'Actualizado', 'Acciónes'].forEach((label) => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');
    for (const asset of assets) {
        const row = document.createElement('tr');
        row.dataset.assetId = String(asset.id || '');

        const idCell = document.createElement('td');
        idCell.textContent = `#${asset.id ?? 'N/A'}`;

        const codeCell = document.createElement('td');
        codeCell.textContent = asset.external_code || '-';

        const brandCell = document.createElement('td');
        brandCell.textContent = asset.brand || '-';

        const modelCell = document.createElement('td');
        modelCell.textContent = asset.model || '-';

        const serialCell = document.createElement('td');
        serialCell.textContent = asset.serial_number || '-';

        const clientCell = document.createElement('td');
        clientCell.textContent = asset.client_name || '-';

        const statusCell = document.createElement('td');
        const statusBadge = document.createElement('span');
        statusBadge.className = 'badge unknown';
        statusBadge.textContent = normalizeAssetStatusLabel(asset.status);
        statusCell.appendChild(statusBadge);

        const updatedCell = document.createElement('td');
        updatedCell.textContent = asset.updated_at
            ? new Date(asset.updated_at).toLocaleString('es-ES')
            : '-';

        const actionsCell = document.createElement('td');
        const detailBtn = document.createElement('button');
        detailBtn.type = 'button';
        detailBtn.className = 'btn-secondary table-action-btn';
        detailBtn.textContent = 'Detalle';
        detailBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void loadAssetDetail(asset.id);
        });

        const incidentBtn = document.createElement('button');
        incidentBtn.type = 'button';
        incidentBtn.className = 'btn-secondary table-action-btn';
        incidentBtn.textContent = 'Incidencia';
        incidentBtn.classList.add('spaced-action-btn');
        incidentBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void createIncidentForAsset(asset.id);
        });

        actionsCell.append(detailBtn, incidentBtn);
        row.append(
            idCell,
            codeCell,
            brandCell,
            modelCell,
            serialCell,
            clientCell,
            statusCell,
            updatedCell,
            actionsCell,
        );
        row.addEventListener('click', () => {
            void loadAssetDetail(asset.id);
        });
        tbody.appendChild(row);
    }

    table.append(thead, tbody);
    container.appendChild(table);
}

async function createIncidentForAsset(assetId) {
    if (!requireActiveSession()) return;
    const numericAssetId = Number.parseInt(String(assetId), 10);
    if (!Number.isInteger(numericAssetId) || numericAssetId <= 0) {
        showNotification('asset_id invalido.', 'error');
        return;
    }

    try {
        const detail = await api.getAssetIncidents(numericAssetId, { limit: 1 });
        const activeInstallationId = Number(detail?.active_link?.installation_id);
        createIncidentFromWeb(activeInstallationId, {
            assetId: numericAssetId,
            activeInstallationId,
        });
    } catch (err) {
        showNotification(`No se pudo crear incidencia del equipo: ${err.message || err}`, 'error');
    }
}

async function linkAssetFromDetail(assetId) {
    if (!requireActiveSession()) return;
    const numericAssetId = Number.parseInt(String(assetId), 10);
    if (!Number.isInteger(numericAssetId) || numericAssetId <= 0) {
        showNotification('asset_id invalido.', 'error');
        return;
    }
    openAssetLinkModal({
        assetId: numericAssetId,
        notes: 'Vinculo manual desde detalle de equipo',
    });
}

async function loadAssetDetail(assetId, options = {}) {
    if (!requireActiveSession()) return;
    const numericAssetId = Number.parseInt(String(assetId), 10);
    if (!Number.isInteger(numericAssetId) || numericAssetId <= 0) {
        return;
    }
    currentSelectedAssetId = numericAssetId;

    const detailContainer = document.getElementById('assetDetail');
    if (detailContainer && !options.keepSelection) {
        detailContainer.innerHTML = '<p class="loading">Cargando detalle del equipo...</p>';
    }

    try {
        const data = await api.getAssetIncidents(numericAssetId, { limit: 150 });
        await renderAssetDetail(data);
    } catch (err) {
        if (detailContainer) {
            detailContainer.innerHTML = `<p class="error">${escapeHtml(err.message || String(err))}</p>`;
        }
    }
}

async function renderAssetDetail(data) {
    const container = document.getElementById('assetDetail');
    if (!container) return;
    container.replaceChildren();

    const asset = data?.asset;
    if (!asset) {
        const message = document.createElement('p');
        message.className = 'loading';
        message.textContent = 'No hay detalle disponible para este equipo.';
        container.appendChild(message);
        return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'asset-detail-toolbar';

    const createIncidentBtn = document.createElement('button');
    createIncidentBtn.type = 'button';
    createIncidentBtn.className = 'btn-primary';
    createIncidentBtn.textContent = 'Crear incidencia';
    createIncidentBtn.addEventListener('click', () => {
        void createIncidentForAsset(asset.id);
    });

    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'btn-secondary';
    linkBtn.textContent = 'Vincular instalación';
    linkBtn.addEventListener('click', () => {
        void linkAssetFromDetail(asset.id);
    });

    const qrBtn = document.createElement('button');
    qrBtn.type = 'button';
    qrBtn.className = 'btn-secondary';
    qrBtn.textContent = 'Ver QR';
    qrBtn.addEventListener('click', () => {
        showQrModal({ type: 'asset', asset, readOnly: true });
        generateQrPreview({
            assetData: {
                external_code: normalizeAssetCodeForQr(asset.external_code || ''),
                brand: normalizeAssetFormText(asset.brand, QR_MAX_BRAND_LENGTH),
                model: normalizeAssetFormText(asset.model, QR_MAX_MODEL_LENGTH),
                serial_number: normalizeAssetFormText(asset.serial_number, QR_MAX_SERIAL_LENGTH),
                client_name: normalizeAssetFormText(asset.client_name, QR_MAX_CLIENT_LENGTH),
                notes: normalizeAssetFormText(asset.notes, QR_MAX_NOTES_LENGTH),
            },
        });
    });

    toolbar.append(createIncidentBtn, linkBtn, qrBtn);
    container.appendChild(toolbar);

    const metaGrid = document.createElement('div');
    metaGrid.className = 'asset-meta-grid';
    const metaEntries = [
        ['ID', `#${asset.id || '-'}`],
        ['Código', asset.external_code || '-'],
        ['Marca', asset.brand || '-'],
        ['Modelo', asset.model || '-'],
        ['Serie', asset.serial_number || '-'],
        ['Cliente', asset.client_name || '-'],
        ['Estado', normalizeAssetStatusLabel(asset.status)],
        ['Actualizado', asset.updated_at ? new Date(asset.updated_at).toLocaleString('es-ES') : '-'],
    ];
    for (const [label, value] of metaEntries) {
        const item = document.createElement('div');
        item.className = 'asset-meta-item';
        const title = document.createElement('small');
        title.textContent = label;
        const content = document.createElement('strong');
        content.textContent = value;
        item.append(title, content);
        metaGrid.appendChild(item);
    }
    container.appendChild(metaGrid);

    const activeLink = data?.active_link;
    const activeInfo = document.createElement('p');
    activeInfo.className = 'asset-muted';
    if (activeLink?.installation_id) {
        activeInfo.textContent =
            `Instalación activa: #${activeLink.installation_id}` +
            (activeLink.installation_client_name ? ` (${activeLink.installation_client_name})` : '');
    } else {
        activeInfo.textContent = 'Sin instalación activa vinculada.';
    }
    container.appendChild(activeInfo);

    const linksTitle = document.createElement('h4');
    linksTitle.textContent = 'Historial de asociaciones';
    container.appendChild(linksTitle);

    const linksList = document.createElement('div');
    linksList.className = 'asset-links-list';
    const links = Array.isArray(data?.links) ? data.links : [];
    if (links.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'asset-muted';
        empty.textContent = 'Este equipo todavia no tiene asociaciones registradas.';
        linksList.appendChild(empty);
    } else {
        for (const link of links) {
            const pill = document.createElement('div');
            pill.className = 'asset-link-item';
            const state = link.unlinked_at ? 'historial' : 'activa';
            const text =
                `Instalación #${link.installation_id} (${state})` +
                (link.installation_client_name ? ` - ${link.installation_client_name}` : '') +
                (link.linked_at ? ` - vinculada: ${new Date(link.linked_at).toLocaleString('es-ES')}` : '');
            pill.textContent = text;
            linksList.appendChild(pill);
        }
    }
    container.appendChild(linksList);

    const incidentsTitle = document.createElement('h4');
    incidentsTitle.textContent = 'Incidencias del equipo';
    container.appendChild(incidentsTitle);

    const incidents = Array.isArray(data?.incidents) ? data.incidents : [];
    if (incidents.length === 0) {
        const emptyIncident = document.createElement('p');
        emptyIncident.className = 'asset-muted';
        emptyIncident.textContent = 'No hay incidencias registradas para este equipo.';
        container.appendChild(emptyIncident);
        return;
    }

    const incidentsWrap = document.createElement('div');
    incidentsWrap.className = 'incidents-grid';
    for (const incident of incidents) {
        const card = document.createElement('div');
        card.className = 'incident-card';

        const header = document.createElement('div');
        header.className = 'incident-header';

        const left = document.createElement('div');
        const badge = document.createElement('span');
        badge.className = `badge ${incident.severity || 'low'}`;
        badge.textContent = `${getSeverityIcon(incident.severity)} ${incident.severity || 'low'}`;
        const meta = document.createElement('small');
        meta.textContent = `inst #${incident.installation_id} · ${incident.reporter_username || 'desconocido'}`;
        left.append(badge, document.createTextNode(' '), meta);

        const created = document.createElement('small');
        created.textContent = `Y. ${new Date(incident.created_at).toLocaleString('es-ES')}`;
        header.append(left, created);

        const note = document.createElement('p');
        note.className = 'incident-note-text';
        note.textContent = incident.note || '';

        const sub = document.createElement('small');
        sub.className = 'asset-muted';
        sub.textContent =
            `Cliente: ${incident.installation_client_name || '-'} · ` +
            `${incident.installation_brand || '-'} ${incident.installation_version || ''}`.trim();

        card.append(header, note);
        appendIncidentMetaLines(card, incident);
        card.appendChild(sub);
        appendIncidentStatusActions(card, incident, {
            assetId: Number.parseInt(String(asset.id), 10),
            installationId: Number.parseInt(String(incident.installation_id), 10),
        });
        appendIncidentUploadPhotoAction(card, incident, incident.installation_id);
        await appendIncidentPhotosGrid(card, incident.photos);

        incidentsWrap.appendChild(card);
    }
    container.appendChild(incidentsWrap);
}

async function loadPhotoWithAuth(photoId) {
    try {
        const authHeaders = webAccessToken
            ? { Authorization: 'Bearer ' + webAccessToken }
            : {};
        const response = await fetch(API_BASE + '/web/photos/' + photoId, {
            headers: authHeaders,
            credentials: 'include'
        });
        if (response.status === 401) {
            currentUser = null;
            webAccessToken = '';
            closeSSE();
            showLogin();
            throw new Error('No autorizado');
        }
        if (!response.ok) throw new Error('Failed to load photo (HTTP ' + response.status + ')');
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (err) {
        console.error('Error loading photo:', err);
        return '';
    }
}

async function renderIncidents(incidents, installationId) {
    const container = document.getElementById('incidentsList');
    container.replaceChildren();

    const header = document.createElement('div');
    header.className = 'incidents-header';
    header.classList.add('incidents-header');

    const heading = document.createElement('h3');
    heading.textContent = `s️ Incidencias de Registro #${installationId}`;

    const backButton = document.createElement('button');
    backButton.className = 'btn-secondary';
    backButton.textContent = '? Volver';
    backButton.addEventListener('click', () => {
        document.querySelector('[data-section="installations"]')?.click();
    });

    const createIncidentBtn = document.createElement('button');
    createIncidentBtn.className = 'btn-primary';
    createIncidentBtn.textContent = 's️ Crear incidencia';
    createIncidentBtn.addEventListener('click', () => {
        void createIncidentFromWeb(installationId);
    });

    const actions = document.createElement('div');
    actions.className = 'incidents-header-actions';
    actions.append(createIncidentBtn, backButton);

    header.append(heading, actions);
    container.appendChild(header);

    if (!incidents || !incidents.length) {
        renderContextualEmptyState(container, {
            title: 'Sin incidencias para este registro',
            description: 'Si detectas un problema, crea la primera incidencia desde aquí.',
            actionLabel: 'Crear incidencia',
            onAction: () => createIncidentBtn.click(),
            tone: 'neutral',
        });
        return;
    }

    for (const inc of incidents) {
        const severityIcon = getSeverityIcon(inc.severity);

        const incidentCard = document.createElement('div');
        incidentCard.className = 'incident-card';

        const incidentHeader = document.createElement('div');
        incidentHeader.className = 'incident-header';

        const leftMeta = document.createElement('div');
        const severityBadge = document.createElement('span');
        severityBadge.className = `badge ${inc.severity || 'low'}`;
        severityBadge.textContent = `${severityIcon} ${inc.severity || 'low'}`;
        const reporter = document.createElement('small');
        reporter.textContent = 'por ';
        const reporterStrong = document.createElement('strong');
        reporterStrong.textContent = inc.reporter_username || 'desconocido';
        reporter.appendChild(reporterStrong);
        leftMeta.append(severityBadge, document.createTextNode(' '), reporter);

        const createdAt = document.createElement('small');
        createdAt.textContent = `Y. ${new Date(inc.created_at).toLocaleString('es-ES')}`;

        incidentHeader.append(leftMeta, createdAt);

        const note = document.createElement('p');
        note.className = 'incident-note-text';
        note.textContent = inc.note || '';

        incidentCard.append(incidentHeader, note);
        appendIncidentMetaLines(incidentCard, inc);
        appendIncidentStatusActions(incidentCard, inc, {
            installationId: Number.parseInt(String(installationId), 10),
        });
        appendIncidentUploadPhotoAction(incidentCard, inc, installationId, { label: 'Y" Subir foto' });
        await appendIncidentPhotosGrid(incidentCard, inc.photos, { attachPhotoIdDataset: true });

        container.appendChild(incidentCard);
    }
}

async function viewPhoto(photoId) {
    const modal = document.getElementById('photoModal');
    const img = document.getElementById('photoViewer');
    const photoUrl = await loadPhotoWithAuth(photoId);
    if (photoUrl) {
        img.src = photoUrl;
        modal.classList.add('active');
    }
}

function normalizeAssetCodeForQr(rawValue) {
    return String(rawValue || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, QR_MAX_ASSET_CODE_LENGTH);
}

function normalizeAssetFormText(rawValue, maxLength) {
    return String(rawValue || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, maxLength);
}

function canCurrentUserEditAssets() {
    const role = String(currentUser?.role || '').toLowerCase();
    return role === 'admin' || role === 'super_admin';
}

function isQrEditSessionActive() {
    return Number.isFinite(qrModalEditUnlockUntil) && qrModalEditUnlockUntil > Date.now();
}

function getQrEditSessionRemainingMs() {
    return Math.max(0, qrModalEditUnlockUntil - Date.now());
}

function setQrAssetInputsDisabled(disabled) {
    const inputIds = [
        'qrAssetCodeInput',
        'qrAssetBrandInput',
        'qrAssetModelInput',
        'qrAssetSerialInput',
        'qrAssetClientInput',
        'qrAssetNotesInput',
    ];
    inputIds.forEach((id) => {
        const element = document.getElementById(id);
        if (element) {
            element.disabled = Boolean(disabled);
            element.toggleAttribute('readonly', Boolean(disabled));
        }
    });
}

function applyQrModalAccessState() {
    const selectedType = document.querySelector('input[name="qrType"]:checked')?.value || 'asset';
    const saveBtn = document.getElementById('qrSaveAssetBtn');
    const enableEditBtn = document.getElementById('qrEnableEditBtn');
    const qrTypeRadios = document.querySelectorAll('input[name="qrType"]');
    const isAssetType = selectedType === 'asset';
    const hasTimedUnlock = isQrEditSessionActive();
    if (qrModalReadOnly) {
        qrModalEditUnlocked = hasTimedUnlock;
    } else if (canCurrentUserEditAssets()) {
        qrModalEditUnlocked = true;
    } else {
        qrModalEditUnlocked = false;
    }
    const isReadOnlyAssetView = qrModalReadOnly && isAssetType && !qrModalEditUnlocked;
    const canEdit = canCurrentUserEditAssets();

    qrTypeRadios.forEach((radio) => {
        radio.disabled = Boolean(qrModalReadOnly);
    });

    setQrAssetInputsDisabled(isReadOnlyAssetView);

    if (saveBtn) {
        const shouldShowSave = isAssetType && (!qrModalReadOnly || qrModalEditUnlocked);
        saveBtn.classList.toggle('is-hidden', !shouldShowSave);
        saveBtn.disabled = !shouldShowSave;
    }

    if (enableEditBtn) {
        const shouldShowEnableEdit = isReadOnlyAssetView && canEdit;
        enableEditBtn.classList.toggle('is-hidden', !shouldShowEnableEdit);
        enableEditBtn.disabled = !shouldShowEnableEdit;
    }

    const helper = document.getElementById('qrAssetHelper');
    if (helper) {
        if (isReadOnlyAssetView && canEdit) {
            helper.textContent = 'Modo solo lectura. Para editar, usa "Habilitar edición" y confirma tu contraseña.';
        } else if (isReadOnlyAssetView && !canEdit) {
            helper.textContent = 'Modo solo lectura. Solo admin/super_admin pueden editar este equipo.';
        } else if (qrModalReadOnly && qrModalEditUnlocked && hasTimedUnlock) {
            const minutesLeft = Math.max(1, Math.ceil(getQrEditSessionRemainingMs() / 60000));
            helper.textContent = `Edicion habilitada temporalmente (${minutesLeft} min restantes).`;
        } else {
            helper.textContent = 'Requisitos: marca o modelo, y número de serie. El código externo se genera automáticamente desde serie si queda vacío.';
        }
    }
}

async function verifyCurrentUserPassword(password) {
    const candidate = String(password || '');
    if (!candidate.trim()) {
        throw new Error('Debes ingresar tu contraseña.');
    }

    await api.request('/web/auth/verify-password', {
        method: 'POST',
        body: JSON.stringify({
            password: candidate
        })
    });
}

function setQrPasswordModalError(message = '') {
    const errorEl = document.getElementById('qrPasswordError');
    if (!errorEl) return;
    errorEl.textContent = message || '';
}

function setQrPasswordModalBusy(isBusy) {
    qrPasswordModalBusy = Boolean(isBusy);
    const confirmBtn = document.getElementById('qrPasswordConfirmBtn');
    const cancelBtn = document.getElementById('qrPasswordCancelBtn');
    const input = document.getElementById('qrPasswordInput');
    if (confirmBtn) confirmBtn.disabled = qrPasswordModalBusy;
    if (cancelBtn) cancelBtn.disabled = qrPasswordModalBusy;
    if (input) input.disabled = qrPasswordModalBusy;
}

function openQrPasswordModal() {
    const modal = document.getElementById('qrPasswordModal');
    const input = document.getElementById('qrPasswordInput');
    if (!modal || !input) return;
    setQrPasswordModalBusy(false);
    setQrPasswordModalError('');
    input.value = '';
    modal.classList.add('active');
    setTimeout(() => {
        input.focus();
        input.select();
    }, 0);
}

function closeQrPasswordModal() {
    const modal = document.getElementById('qrPasswordModal');
    if (!modal) return;
    modal.classList.remove('active');
    setQrPasswordModalBusy(false);
    setQrPasswordModalError('');
}

async function confirmQrEditUnlockFromModal() {
    if (qrPasswordModalBusy) return;
    const input = document.getElementById('qrPasswordInput');
    const password = String(input?.value || '');
    try {
        setQrPasswordModalBusy(true);
        await verifyCurrentUserPassword(password);
        qrModalEditUnlocked = true;
        qrModalEditUnlockUntil = Date.now() + QR_EDIT_UNLOCK_TTL_MS;
        applyQrModalAccessState();
        closeQrPasswordModal();
        setQrError('');
        showNotification('Edicion habilitada por 10 minutos.', 'success');
    } catch (error) {
        setQrPasswordModalBusy(false);
        setQrPasswordModalError(error?.message || 'No se pudo validar la contraseña.');
    }
}

function readAssetFormData() {
    const codeInput = document.getElementById('qrAssetCodeInput');
    const brandInput = document.getElementById('qrAssetBrandInput');
    const modelInput = document.getElementById('qrAssetModelInput');
    const serialInput = document.getElementById('qrAssetSerialInput');
    const clientInput = document.getElementById('qrAssetClientInput');
    const notesInput = document.getElementById('qrAssetNotesInput');
    if (!codeInput || !brandInput || !modelInput || !serialInput || !clientInput || !notesInput) {
        throw new Error('Formulario QR incompleto. Recarga la página.');
    }

    const brand = normalizeAssetFormText(brandInput.value, QR_MAX_BRAND_LENGTH);
    const model = normalizeAssetFormText(modelInput.value, QR_MAX_MODEL_LENGTH);
    const serialNumber = normalizeAssetFormText(serialInput.value, QR_MAX_SERIAL_LENGTH);
    const clientName = normalizeAssetFormText(clientInput.value, QR_MAX_CLIENT_LENGTH);
    const notes = normalizeAssetFormText(notesInput.value, QR_MAX_NOTES_LENGTH);

    if (!brand && !model) {
        throw new Error('Debes ingresar al menos marca o modelo.');
    }
    if (!serialNumber) {
        throw new Error('El número de serie es obligatorio para la etiqueta.');
    }

    const explicitCode = normalizeAssetCodeForQr(codeInput.value);
    const fallbackCode = normalizeAssetCodeForQr(serialNumber);
    const externalCode = explicitCode || fallbackCode;
    if (!externalCode) {
        throw new Error('No se pudo construir un código externo de equipo.');
    }

    return {
        external_code: externalCode,
        brand,
        model,
        serial_number: serialNumber,
        client_name: clientName,
        notes,
    };
}

function setQrError(message = '') {
    const errorEl = document.getElementById('qrError');
    if (!errorEl) return;
    errorEl.textContent = message || '';
}

function applyQrTypeMeta() {
    const selectedType = document.querySelector('input[name="qrType"]:checked')?.value || 'asset';
    const installationFields = document.getElementById('qrInstallationFields');
    const assetFields = document.getElementById('qrAssetFields');
    const presetContainer = document.getElementById('qrLabelPresetContainer');
    if (selectedType === 'installation') {
        installationFields?.classList.remove('is-hidden');
        assetFields?.classList.add('is-hidden');
        presetContainer?.classList.add('is-hidden');
    } else {
        installationFields?.classList.add('is-hidden');
        assetFields?.classList.remove('is-hidden');
        presetContainer?.classList.remove('is-hidden');
    }
    const helperText = document.getElementById('qrHelperText');
    if (helperText) {
        helperText.textContent = 'Formato recomendado para mobile: dm://installation/{id}.';
    }
    applyQrModalAccessState();
}

function resetQrPreview() {
    currentQrPayload = '';
    currentQrImageUrl = '';
    currentQrLabelInfo = null;
    const preview = document.getElementById('qrPreview');
    const previewImage = document.getElementById('qrPreviewImage');
    const payloadText = document.getElementById('qrPayloadText');
    const detailsText = document.getElementById('qrDetailsText');
    const copyBtn = document.getElementById('qrCopyBtn');
    const downloadBtn = document.getElementById('qrDownloadBtn');
    const printBtn = document.getElementById('qrPrintBtn');

    if (preview) preview.classList.add('is-hidden');
    if (previewImage) previewImage.removeAttribute('src');
    if (payloadText) payloadText.textContent = '';
    if (detailsText) detailsText.textContent = '';
    if (copyBtn) copyBtn.disabled = true;
    if (downloadBtn) downloadBtn.disabled = true;
    if (printBtn) printBtn.disabled = true;
}

function getQrLabelPresetConfig() {
    const select = document.getElementById('qrLabelPresetSelect');
    const selected = String(select?.value || currentQrLabelPreset || 'medium').toLowerCase();
    currentQrLabelPreset = Object.prototype.hasOwnProperty.call(QR_LABEL_PRESETS, selected)
        ? selected
        : 'medium';
    return QR_LABEL_PRESETS[currentQrLabelPreset];
}

function buildQrPayload(qrType, rawValue, assetData = null) {
    if (qrType === 'installation') {
        const installationId = Number.parseInt(String(rawValue || '').trim(), 10);
        if (!Number.isInteger(installationId) || installationId <= 0) {
            throw new Error('El ID de registro debe ser un entero positivo.');
        }
        return `dm://installation/${encodeURIComponent(String(installationId))}`;
    }

    const assetCode = normalizeAssetCodeForQr(assetData?.external_code || rawValue);
    if (!assetCode) {
        throw new Error('El código de equipo es obligatorio.');
    }
    return `dm://asset/${encodeURIComponent(assetCode)}`;
}

function buildQrImageUrl(payload) {
    const qrGenerator = window.DMQR;
    if (!qrGenerator || typeof qrGenerator.createPngDataUrl !== 'function') {
        throw new Error('Generador QR no disponible. Recarga la página e intenta de nuevo.');
    }

    return qrGenerator.createPngDataUrl(payload, {
        sizePx: QR_PREVIEW_SIZE_PX,
        marginModules: 2,
        ecc: 'M'
    });
}

function sanitizeFileNamePart(value, fallback = 'codigo') {
    const normalized = String(value || '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 64);
    return normalized || fallback;
}

function buildQrDownloadFileName(qrType, rawValue, assetData = null) {
    if (qrType === 'installation') {
        const numeric = Number.parseInt(String(rawValue || '').trim(), 10);
        const suffix = Number.isInteger(numeric) && numeric > 0 ? String(numeric) : 'id';
        return `qr-installacion-${suffix}.png`;
    }
    const code = assetData?.external_code || rawValue;
    return `qr-equipo-${sanitizeFileNamePart(code, 'asset')}.png`;
}

function showQrModal(options = {}) {
    const modal = document.getElementById('qrModal');
    const valueInput = document.getElementById('qrValueInput');
    const codeInput = document.getElementById('qrAssetCodeInput');
    const brandInput = document.getElementById('qrAssetBrandInput');
    const modelInput = document.getElementById('qrAssetModelInput');
    const serialInput = document.getElementById('qrAssetSerialInput');
    const clientInput = document.getElementById('qrAssetClientInput');
    const notesInput = document.getElementById('qrAssetNotesInput');
    const presetSelect = document.getElementById('qrLabelPresetSelect');
    const type = options.type === 'installation' ? 'installation' : 'asset';
    const value = String(options.value || '');
    const asset = options.asset && typeof options.asset === 'object' ? options.asset : {};
    qrModalReadOnly = Boolean(options.readOnly);
    qrModalEditUnlocked = false;
    const radio = document.querySelector(`input[name="qrType"][value="${type}"]`);
    if (!modal || !valueInput || !radio) return;

    radio.checked = true;
    valueInput.value = value;
    if (codeInput) codeInput.value = normalizeAssetCodeForQr(asset.external_code || value);
    if (brandInput) brandInput.value = normalizeAssetFormText(asset.brand, QR_MAX_BRAND_LENGTH);
    if (modelInput) modelInput.value = normalizeAssetFormText(asset.model, QR_MAX_MODEL_LENGTH);
    if (serialInput) serialInput.value = normalizeAssetFormText(asset.serial_number, QR_MAX_SERIAL_LENGTH);
    if (clientInput) clientInput.value = normalizeAssetFormText(asset.client_name, QR_MAX_CLIENT_LENGTH);
    if (notesInput) notesInput.value = normalizeAssetFormText(asset.notes, QR_MAX_NOTES_LENGTH);
    if (presetSelect) {
        presetSelect.value = currentQrLabelPreset;
    }
    applyQrTypeMeta();
    applyQrModalAccessState();
    resetQrPreview();
    setQrError('');
    modal.classList.add('active');
    if (type === 'installation') {
        valueInput.focus();
        valueInput.select();
    } else {
        const serial = document.getElementById('qrAssetSerialInput');
        if (serial) {
            serial.focus();
            serial.select();
        }
    }
}

function closeQrModal() {
    const modal = document.getElementById('qrModal');
    if (!modal) return;
    modal.classList.remove('active');
    closeQrPasswordModal();
    qrModalReadOnly = false;
    qrModalEditUnlocked = false;
    setQrError('');
    resetQrPreview();
}

function formatQrDetailsText(qrType, rawValue, assetData = null) {
    if (qrType === 'installation') {
        return `Tipo: Instalación\nID: ${String(rawValue || '').trim()}`;
    }
    const details = assetData || {};
    return [
        'Tipo: Equipo',
        `Código externo: ${details.external_code || '-'}`,
        `Marca: ${details.brand || '-'}`,
        `Modelo: ${details.model || '-'}`,
        `Serie: ${details.serial_number || '-'}`,
        `Cliente: ${details.client_name || '-'}`,
    ].join('\n');
}

function buildQrPreviewInput() {
    const selectedType = document.querySelector('input[name="qrType"]:checked')?.value || 'asset';
    const valueInput = document.getElementById('qrValueInput');
    if (!valueInput) {
        throw new Error('No se encontro el input QR principal.');
    }
    if (selectedType === 'installation') {
        return {
            type: 'installation',
            rawValue: valueInput.value,
            assetData: null,
        };
    }
    const assetData = readAssetFormData();
    return {
        type: 'asset',
        rawValue: assetData.external_code,
        assetData,
    };
}

function generateQrPreview(options = {}) {
    const selectedType = document.querySelector('input[name="qrType"]:checked')?.value || 'asset';
    const valueInput = document.getElementById('qrValueInput');
    const preview = document.getElementById('qrPreview');
    const previewImage = document.getElementById('qrPreviewImage');
    const payloadText = document.getElementById('qrPayloadText');
    const detailsText = document.getElementById('qrDetailsText');
    const copyBtn = document.getElementById('qrCopyBtn');
    const downloadBtn = document.getElementById('qrDownloadBtn');
    const printBtn = document.getElementById('qrPrintBtn');
    if (!valueInput || !preview || !previewImage || !payloadText || !detailsText || !copyBtn || !downloadBtn || !printBtn) return;

    try {
        let rawValue = valueInput.value;
        let assetData = null;
        if (options.assetData) {
            assetData = options.assetData;
            rawValue = options.assetData.external_code || rawValue;
            const codeInput = document.getElementById('qrAssetCodeInput');
            if (codeInput) {
                codeInput.value = normalizeAssetCodeForQr(rawValue);
            }
        } else {
            const input = buildQrPreviewInput();
            rawValue = input.rawValue;
            assetData = input.assetData;
        }

        const payload = buildQrPayload(selectedType, rawValue, assetData);
        const imageUrl = buildQrImageUrl(payload);
        const details = formatQrDetailsText(selectedType, rawValue, assetData);
        currentQrPayload = payload;
        currentQrImageUrl = imageUrl;
        currentQrLabelInfo = {
            type: selectedType,
            rawValue,
            assetData,
            details,
            labelPreset: getQrLabelPresetConfig().key,
        };

        previewImage.src = imageUrl;
        previewImage.alt = `QR ${selectedType}`;
        payloadText.textContent = payload;
        detailsText.textContent = details;
        preview.classList.remove('is-hidden');
        copyBtn.disabled = false;
        downloadBtn.disabled = false;
        printBtn.disabled = false;
        downloadBtn.dataset.filename = buildQrDownloadFileName(selectedType, rawValue, assetData);
        setQrError('');
    } catch (error) {
        resetQrPreview();
        setQrError(error?.message || 'No se pudo generar el QR.');
    }
}

async function saveAssetFromQrModal(options = {}) {
    if (!requireActiveSession()) return;
    if (qrModalReadOnly && !qrModalEditUnlocked) {
        setQrError('Modo solo lectura. Habilita edición y confirma tu contraseña para guardar cambios.');
        return;
    }
    const generateAfterSave = Boolean(options.generateAfterSave);
    try {
        const assetData = readAssetFormData();
        const result = await api.resolveAsset({
            ...assetData,
            update_existing: true,
            status: 'active',
        });
        const savedAsset = result?.asset || {};
        const mergedAsset = {
            ...assetData,
            external_code: normalizeAssetCodeForQr(savedAsset.external_code || assetData.external_code),
            brand: normalizeAssetFormText(savedAsset.brand ?? assetData.brand, QR_MAX_BRAND_LENGTH),
            model: normalizeAssetFormText(savedAsset.model ?? assetData.model, QR_MAX_MODEL_LENGTH),
            serial_number: normalizeAssetFormText(savedAsset.serial_number ?? assetData.serial_number, QR_MAX_SERIAL_LENGTH),
            client_name: normalizeAssetFormText(savedAsset.client_name ?? assetData.client_name, QR_MAX_CLIENT_LENGTH),
            notes: normalizeAssetFormText(savedAsset.notes ?? assetData.notes, QR_MAX_NOTES_LENGTH),
        };

        const codeInput = document.getElementById('qrAssetCodeInput');
        const brandInput = document.getElementById('qrAssetBrandInput');
        const modelInput = document.getElementById('qrAssetModelInput');
        const serialInput = document.getElementById('qrAssetSerialInput');
        const clientInput = document.getElementById('qrAssetClientInput');
        const notesInput = document.getElementById('qrAssetNotesInput');
        if (codeInput) codeInput.value = mergedAsset.external_code;
        if (brandInput) brandInput.value = mergedAsset.brand;
        if (modelInput) modelInput.value = mergedAsset.model;
        if (serialInput) serialInput.value = mergedAsset.serial_number;
        if (clientInput) clientInput.value = mergedAsset.client_name;
        if (notesInput) notesInput.value = mergedAsset.notes;

        showNotification(`Equipo guardado: ${mergedAsset.external_code}`, 'success');
        setQrError('');
        if (getActiveSectionName() === 'assets') {
            void loadAssets();
        }
        if (generateAfterSave) {
            generateQrPreview({ assetData: mergedAsset });
        }
    } catch (error) {
        setQrError(error?.message || 'No se pudo guardar el equipo.');
        showNotification(`No se pudo guardar equipo: ${error?.message || error}`, 'error');
    }
}

async function copyQrPayloadToClipboard() {
    if (!currentQrPayload) return;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(currentQrPayload);
        } else {
            const area = document.createElement('textarea');
            area.value = currentQrPayload;
            area.setAttribute('readonly', 'readonly');
            area.className = 'offscreen-copy-area';
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
        }
        showNotification('Payload QR copiado al portapapeles.', 'success');
    } catch (error) {
        showNotification('No se pudo copiar el payload QR.', 'error');
    }
}

function dataUrlToPngDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth || image.width || QR_PREVIEW_SIZE_PX;
                canvas.height = image.naturalHeight || image.height || QR_PREVIEW_SIZE_PX;
                const context = canvas.getContext('2d');
                if (!context) {
                    reject(new Error('No se pudo inicializar canvas.'));
                    return;
                }
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            } catch (error) {
                reject(error);
            }
        };
        image.onerror = () => reject(new Error('No se pudo convertir QR a PNG.'));
        image.src = dataUrl;
    });
}

function buildPrintableLabelDataUrl(imageDataUrl, details, presetKey = 'medium') {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            try {
                const preset = QR_LABEL_PRESETS[presetKey] || QR_LABEL_PRESETS.medium;
                const qrNaturalWidth = image.naturalWidth || image.width || QR_PREVIEW_SIZE_PX;
                const qrNaturalHeight = image.naturalHeight || image.height || QR_PREVIEW_SIZE_PX;
                const qrSize = Math.max(180, Math.floor(preset.qrSize));
                const detailsLines = String(details || '')
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line && !line.toLowerCase().startsWith('tipo:'))
                    .slice(0, 8);

                const outerPadding = Math.max(12, preset.padding);
                const innerGap = Math.max(10, preset.textGap);
                const lineHeight = Math.max(18, preset.lineHeight);
                const titleLineHeight = Math.max(22, preset.titleLineHeight);
                const canvasWidth = Math.max(640, preset.width);
                const canvasHeight = Math.max(280, preset.height);
                const canvas = document.createElement('canvas');
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('No se pudo inicializar canvas para etiqueta.'));
                    return;
                }

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const qrX = outerPadding;
                const qrY = Math.floor((canvasHeight - qrSize) / 2);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(image, 0, 0, qrNaturalWidth, qrNaturalHeight, qrX, qrY, qrSize, qrSize);
                ctx.imageSmoothingEnabled = true;

                const infoX = qrX + qrSize + innerGap;
                const infoWidth = canvasWidth - infoX - outerPadding;
                const textBlockHeight = titleLineHeight + lineHeight * detailsLines.length;
                const textStartY = Math.floor((canvasHeight - textBlockHeight) / 2);
                let y = textStartY + Math.max(16, preset.titleSize);
                ctx.fillStyle = '#0f172a';
                ctx.font = `700 ${Math.max(16, preset.titleSize)}px Inter, Arial, sans-serif`;
                ctx.fillText('SiteOps', infoX, y, infoWidth);

                y += titleLineHeight;
                ctx.fillStyle = '#1f2937';
                ctx.font = `500 ${Math.max(12, preset.bodySize)}px Inter, Arial, sans-serif`;
                for (const line of detailsLines) {
                    ctx.fillText(line, infoX, y, infoWidth);
                    y += lineHeight;
                }

                ctx.strokeStyle = '#222222';
                ctx.lineWidth = 2;
                ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

                resolve(canvas.toDataURL('image/png'));
            } catch (error) {
                reject(error);
            }
        };
        image.onerror = () => reject(new Error('No se pudo renderizar la etiqueta.'));
        image.src = imageDataUrl;
    });
}

async function downloadQrImage() {
    if (!currentQrImageUrl) return;
    const downloadBtn = document.getElementById('qrDownloadBtn');
    const fileName = downloadBtn?.dataset?.filename || 'qr-equipo.png';
    let downloadUrl = currentQrImageUrl;

    if (currentQrImageUrl.startsWith('data:image/gif')) {
        try {
            downloadUrl = await dataUrlToPngDataUrl(currentQrImageUrl);
        } catch (_error) {
            downloadUrl = currentQrImageUrl;
        }
    }

    if (currentQrLabelInfo && currentQrLabelInfo.type === 'asset') {
        try {
            const labelPreset = currentQrLabelInfo.labelPreset || getQrLabelPresetConfig().key;
            downloadUrl = await buildPrintableLabelDataUrl(
                downloadUrl,
                currentQrLabelInfo.details || '',
                labelPreset
            );
        } catch (_error) {
            // fallback: mantener download de QR simple si falla composición de etiqueta
        }
    }

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

async function printQrLabel() {
    if (!currentQrPayload || !currentQrImageUrl) return;
    const details = currentQrLabelInfo?.details || formatQrDetailsText('asset', '');
    let printableImageUrl = currentQrImageUrl;

    if (currentQrLabelInfo?.type === 'asset') {
        try {
            const labelPreset = currentQrLabelInfo.labelPreset || getQrLabelPresetConfig().key;
            printableImageUrl = await buildPrintableLabelDataUrl(currentQrImageUrl, details, labelPreset);
        } catch (_error) {
            printableImageUrl = currentQrImageUrl;
        }
    }

    const printableImage = escapeHtml(printableImageUrl);
    const printHtml = `
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Etiqueta QR</title>
  <style>
    html, body { margin: 0; padding: 0; background: #ffffff; }
    .page { padding: 18px; display: flex; justify-content: center; }
    .label { max-width: 840px; width: 100%; }
    .img { display: block; width: 100%; height: auto; }
    @media print {
      @page { size: auto; margin: 8mm; }
      .page { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="label">
      <img class="img" src="${printableImage}" alt="Etiqueta QR">
    </div>
  </div>
</body>
</html>`;

    try {
        const printFrame = document.createElement('iframe');
        printFrame.setAttribute('aria-hidden', 'true');
        printFrame.className = 'print-frame-hidden';
        printFrame.srcdoc = printHtml;

        const cleanup = () => {
            if (printFrame.parentNode) {
                printFrame.parentNode.removeChild(printFrame);
            }
        };

        printFrame.onload = () => {
            try {
                const frameWindow = printFrame.contentWindow;
                if (!frameWindow) {
                    cleanup();
                    showNotification('No se pudo preparar la impresion.', 'error');
                    return;
                }
                frameWindow.focus();
                frameWindow.print();
                setTimeout(cleanup, 1200);
            } catch (_error) {
                cleanup();
                showNotification('No se pudo abrir la impresion.', 'error');
            }
        };

        document.body.appendChild(printFrame);
    } catch (_error) {
        showNotification('No se pudo abrir la impresion.', 'error');
    }
}

async function loadAuditLogs() {
    if (!requireActiveSession()) return;
    const container = document.getElementById('auditLogs');
    container.innerHTML = '<p class="loading">Cargando logs...</p>';
    
    try {
        const logs = await api.getAuditLogs();
        renderAuditLogs(logs);
    } catch (err) {
        container.replaceChildren();
        renderContextualEmptyState(container, {
            title: 'No se pudieron cargar los logs',
            description: 'Reintenta para validar el estado de auditoría.',
            actionLabel: 'Reintentar',
            onAction: () => loadAuditLogs(),
            tone: 'warning',
        });
    }
}

function renderAuditLogs(logs) {
    const container = document.getElementById('auditLogs');
    const actionFilter = document.getElementById('auditActionFilter')?.value;
    container.replaceChildren();
    
    if (!logs || !logs.length) {
        renderContextualEmptyState(container, {
            title: 'Aún no hay logs de auditoría',
            description: 'Cuando se registren eventos de acceso u operaciones, aparecerán aquí.',
            actionLabel: 'Actualizar',
            onAction: () => loadAuditLogs(),
            tone: 'neutral',
        });
        return;
    }
    
    let filteredLogs = logs;
    if (actionFilter) {
        filteredLogs = logs.filter(log => log.action === actionFilter);
    }
    
    if (filteredLogs.length === 0) {
        renderContextualEmptyState(container, {
            title: 'No hay eventos para ese filtro',
            description: 'Prueba otro tipo de acción o limpia el filtro actual.',
            actionLabel: 'Quitar filtro',
            onAction: () => {
                const actionFilterSelect = document.getElementById('auditActionFilter');
                if (actionFilterSelect) {
                    actionFilterSelect.value = '';
                }
                renderAuditLogs(logs);
            },
            tone: 'neutral',
        });
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Fecha', 'Acción', 'Usuario', 'Estado', 'Detalles'].forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');

    filteredLogs.forEach(log => {
        const successIcon = log.success ? 'OK' : 'X';
        const successClass = log.success ? 'success' : 'failed';
        
        let details = '-';
        if (log.details) {
            try {
                const parsed = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                details = Object.entries(parsed)
                    .map(([k, v]) => `${k}: ${v}`)
                    .slice(0, 2)
                    .join(', ');
                if (details.length > 50) details = details.substring(0, 50) + '...';
            } catch {
                details = String(log.details).substring(0, 50);
            }
        }
        
        const row = document.createElement('tr');

        const dateCell = document.createElement('td');
        dateCell.textContent = new Date(log.timestamp).toLocaleString('es-ES');

        const actionCell = document.createElement('td');
        const actionCode = document.createElement('code');
        actionCode.className = 'audit-action-code';
        actionCode.textContent = log.action || '-';
        actionCell.appendChild(actionCode);

        const userCell = document.createElement('td');
        const userStrong = document.createElement('strong');
        userStrong.textContent = log.username || '-';
        userCell.appendChild(userStrong);

        const statusCell = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = `badge ${successClass}`;
        badge.textContent = successIcon;
        statusCell.appendChild(badge);

        const detailsCell = document.createElement('td');
        detailsCell.className = 'audit-details-cell';
        detailsCell.textContent = details;

        row.append(dateCell, actionCell, userCell, statusCell, detailsCell);
        tbody.appendChild(row);
    });

    table.append(thead, tbody);
    container.appendChild(table);
}

function getCurrentShiftLabel(now = new Date()) {
    const hour = now.getHours();
    if (hour >= 6 && hour < 12) return 'Turno manana';
    if (hour >= 12 && hour < 18) return 'Turno tarde';
    return 'Turno noche';
}

function updatePageSubtitleForSection(section) {
    const subtitleEl = document.getElementById('pageSubtitle');
    if (!subtitleEl) return;
    const normalizedSection = SECTION_SUBTITLES[section] ? section : 'dashboard';
    const subtitle = SECTION_SUBTITLES[normalizedSection];
    subtitleEl.textContent = `${subtitle} · ${getCurrentShiftLabel()}`;
}

function buildOpsPulseText(status, section) {
    const sectionLabel = (SECTION_TITLES[section] || SECTION_TITLES.dashboard).toLowerCase();
    const normalizedStatus = ['connected', 'disconnected', 'reconnecting', 'paused', 'failed'].includes(status)
        ? status
        : 'paused';

    if (normalizedStatus === 'connected') return `${sectionLabel} en vivo`;
    if (normalizedStatus === 'reconnecting') return `Reconectando ${sectionLabel}`;
    if (normalizedStatus === 'disconnected') return 'Conexión interrumpida';
    if (normalizedStatus === 'failed') return 'Sin enlace en tiempo real';
    return 'Sincronizacion en pausa';
}

function syncHeaderDelight(section, explicitStatus = null) {
    const normalizedSection = SECTION_TITLES[section] ? section : 'dashboard';
    document.body.dataset.activeSection = normalizedSection;
    updatePageSubtitleForSection(normalizedSection);

    const pulse = document.getElementById('opsPulse');
    const pulseText = document.getElementById('opsPulseText');
    if (!pulse || !pulseText) return;

    const fallbackStatus = connectionStatusLastRendered?.status || 'paused';
    const status = explicitStatus ?? fallbackStatus;
    pulse.dataset.state = status;
    pulseText.textContent = buildOpsPulseText(status, normalizedSection);
}

function updatePageTitleForSection(section) {
    const pageTitle = document.getElementById('pageTitle');
    if (!pageTitle) return;
    const normalizedSection = SECTION_TITLES[section] ? section : 'dashboard';
    pageTitle.textContent = SECTION_TITLES[normalizedSection];
    syncHeaderDelight(normalizedSection);
}

function runSectionLoaders(section) {
    if (section === 'installations') loadInstallations();
    if (section === 'assets') loadAssets();
    if (section === 'drivers') loadDrivers();
    if (section === 'audit') loadAuditLogs();
}

async function activateSection(section) {
    const nextSection = document.getElementById(section + 'Section');
    if (!nextSection) return;

    const currentSection = document.querySelector('.section.active');
    const transitionId = ++sectionTransitionVersion;

    if (!currentSection || currentSection === nextSection || prefersReducedMotion()) {
        document.querySelectorAll('.section').forEach((sectionNode) => {
            sectionNode.classList.remove('active', 'is-transitioning-out');
        });
        nextSection.classList.add('active');
        updatePageTitleForSection(section);
        runSectionLoaders(section);
        syncSSEForCurrentContext();
        return;
    }

    currentSection.classList.add('is-transitioning-out');
    currentSection.classList.remove('active');

    await new Promise((resolve) => {
        setTimeout(resolve, SECTION_TRANSITION_OUT_MS);
    });

    if (transitionId !== sectionTransitionVersion) {
        return;
    }

    currentSection.classList.remove('is-transitioning-out');
    document.querySelectorAll('.section').forEach((sectionNode) => {
        if (sectionNode !== nextSection) {
            sectionNode.classList.remove('active', 'is-transitioning-out');
        }
    });
    nextSection.classList.add('active');
    updatePageTitleForSection(section);
    runSectionLoaders(section);
    syncSSEForCurrentContext();
}

// Event Listeners
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const result = await api.login(username, password);
        if (typeof result?.access_token === 'string' && result.access_token.trim()) {
            webAccessToken = result.access_token.trim();
        } else {
            webAccessToken = '';
        }
        applyAuthenticatedUser(result.user);
        
        hideLogin();
        loadDashboard();
        syncSSEForCurrentContext(true);
        
        // Show success notification
        showNotification('Bienvenido, ' + result.user.username + '!', 'success');
    } catch (err) {
        document.getElementById('loginError').textContent = 'Credenciales inválidas';
        document.getElementById('loginPassword').value = '';
    }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        await api.logout();
    } catch (err) {
        console.error('Error during logout:', err);
    }
    currentUser = null;
    webAccessToken = '';
    closeSSE();
    resetProtectedViews();
    showLogin();
    showNotification('Sesión cerrada', 'info');
});

document.getElementById('refreshBtn').addEventListener('click', () => {
    if (!requireActiveSession()) return;
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('btn-spin-once');
    setTimeout(() => {
        btn.classList.remove('btn-spin-once');
    }, 520);
    
    loadDashboard();
    showNotification('Dashboard actualizado', 'info');
});

document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        if (!requireActiveSession()) return;
        const section = link.dataset.section;
        if (!section) return;
        if (section === 'audit' && !canCurrentUserAccessAudit()) {
            showNotification('No tienes permisos para acceder a Auditoria.', 'error');
            return;
        }
        
        document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        
        void activateSection(section);
    });
});

document.getElementById('applyFilters').addEventListener('click', () => {
    if (!requireActiveSession()) return;
    updateFilterChips();
    loadInstallations();
});

document.getElementById('assetsSearchBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    void loadAssets();
});

document.getElementById('assetsRefreshBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    void loadAssets();
});

document.getElementById('assetsCreateQrBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    showQrModal({ type: 'asset', value: '' });
});

document.getElementById('driversRefreshBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    void loadDrivers();
});

document.getElementById('driverPickFileBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    document.getElementById('driverFileInput')?.click();
});

document.getElementById('driverFileInput')?.addEventListener('change', (event) => {
    const input = event.target;
    const nextFile = input?.files?.[0] || null;
    selectedDriverFile = nextFile;
    updateDriverSelectedFileLabel();
});

document.getElementById('driverUploadBtn')?.addEventListener('click', () => {
    void uploadDriverFromWeb();
});
updateDriverSelectedFileLabel();

document.getElementById('assetsSearchInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        if (!requireActiveSession()) return;
        void loadAssets();
    }
});


document.getElementById('refreshAudit').addEventListener('click', () => {
    if (!requireActiveSession()) return;
    loadAuditLogs();
});

document.getElementById('auditActionFilter').addEventListener('change', () => {
    if (!requireActiveSession()) return;
    loadAuditLogs();
});

document.querySelector('#photoModal .close').addEventListener('click', () => {
    document.getElementById('photoModal').classList.remove('active');
});

// Close modal on outside click
document.getElementById('photoModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        document.getElementById('photoModal').classList.remove('active');
    }
});

document.querySelectorAll('input[name="qrType"]').forEach((radio) => {
    radio.addEventListener('change', () => {
        applyQrTypeMeta();
        resetQrPreview();
        setQrError('');
    });
});

document.getElementById('qrGenerateBtn').addEventListener('click', () => {
    generateQrPreview();
});

document.getElementById('qrSaveAssetBtn').addEventListener('click', () => {
    const selectedType = document.querySelector('input[name="qrType"]:checked')?.value || 'asset';
    if (selectedType !== 'asset') {
        setQrError('Guardar equipo solo aplica para tipo Equipo.');
        return;
    }
    void saveAssetFromQrModal({ generateAfterSave: true });
});

document.getElementById('qrEnableEditBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    if (!canCurrentUserEditAssets()) {
        setQrError('No tienes permisos para editar equipos.');
        return;
    }
    if (isQrEditSessionActive() && qrModalEditUnlocked) {
        applyQrModalAccessState();
        setQrError('');
        showNotification('La edición ya está habilitada temporalmente.', 'info');
        return;
    }
    openQrPasswordModal();
});

document.getElementById('qrValueInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        generateQrPreview();
    }
});

document.getElementById('qrCopyBtn').addEventListener('click', () => {
    void copyQrPayloadToClipboard();
});

document.getElementById('qrDownloadBtn').addEventListener('click', () => {
    void downloadQrImage();
});

document.getElementById('qrPrintBtn').addEventListener('click', () => {
    void printQrLabel();
});

document.getElementById('qrLabelPresetSelect')?.addEventListener('change', () => {
    const preset = getQrLabelPresetConfig().key;
    if (currentQrLabelInfo && currentQrLabelInfo.type === 'asset') {
        currentQrLabelInfo.labelPreset = preset;
    }
});

document.querySelector('#qrModal .close').addEventListener('click', () => {
    closeQrModal();
});

document.getElementById('qrModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        closeQrModal();
    }
});

document.querySelector('#qrPasswordModal .close')?.addEventListener('click', () => {
    closeQrPasswordModal();
});

document.getElementById('qrPasswordCancelBtn')?.addEventListener('click', () => {
    closeQrPasswordModal();
});

document.getElementById('qrPasswordConfirmBtn')?.addEventListener('click', () => {
    void confirmQrEditUnlockFromModal();
});

document.getElementById('qrPasswordInput')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void confirmQrEditUnlockFromModal();
});

document.getElementById('qrPasswordModal')?.addEventListener('click', (event) => {
    if (event.target !== event.currentTarget) return;
    if (qrPasswordModalBusy) return;
    closeQrPasswordModal();
});

bindActionModalEvents();

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (handleLoginModalKeydown(e)) {
        return;
    }

    if (e.key === 'Escape') {
        document.getElementById('photoModal').classList.remove('active');
        closeQrPasswordModal();
        closeQrModal();
        closeActionModal();
    }
    const normalizedKey = String(e.key || '').toLowerCase();
    if (e.altKey && !e.ctrlKey && !e.metaKey && normalizedKey === 'r') {
        e.preventDefault();
        void loadDashboard();
    }
});

// Notification system
function showNotification(message, type = 'info') {
    const normalizedType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
    const stackId = 'toastStack';
    let stack = document.getElementById(stackId);
    if (!stack) {
        stack = document.createElement('div');
        stack.id = stackId;
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
    }

    const notification = document.createElement('div');
    notification.className = `toast-notification toast-${normalizedType}`;

    const body = document.createElement('div');
    body.className = 'toast-body';

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = TOAST_TYPE_ICONS[normalizedType] || TOAST_TYPE_ICONS.info;

    const messageNode = document.createElement('div');
    messageNode.className = 'toast-message';
    messageNode.textContent = String(message || '');

    body.append(icon, messageNode);

    const progress = document.createElement('div');
    progress.className = 'toast-progress';

    notification.append(body, progress);
    stack.appendChild(notification);

    if (stack.childElementCount > 4) {
        const oldest = stack.firstElementChild;
        oldest?.remove();
    }

    setTimeout(() => {
        notification.classList.add('is-leaving');
        setTimeout(() => notification.remove(), 320);
    }, TOAST_DURATION_MS);
}

// WebSocket/SSE Functions
function getActiveSectionName() {
    const activeSection = document.querySelector('.section.active');
    if (!activeSection?.id) return '';
    return activeSection.id.replace(/Section$/, '');
}

function canUseRealtimeNow() {
    if (!currentUser) return false;
    if (document.visibilityState !== 'visible') return false;
    const activeSection = getActiveSectionName();
    return SSE_ACTIVE_SECTIONS.has(activeSection);
}

function scheduleSSEReconnect(preferredDelayMs = null) {
    if (!canUseRealtimeNow()) {
        return;
    }

    if (sseReconnectAttempts >= MAX_SSE_RECONNECT_ATTEMPTS) {
        console.error('[SSE] Max reconnection attempts reached');
        updateConnectionStatus('failed');
        showNotification('Conexión en tiempo real perdida. Recarga la página para reconectar.', 'error');
        return;
    }

    sseReconnectAttempts++;
    const exponentialDelay = Math.min(
        SSE_RECONNECT_MAX_DELAY,
        SSE_RECONNECT_BASE_DELAY * Math.pow(2, sseReconnectAttempts - 1)
    );
    const normalizedPreferredDelay = Number.isFinite(preferredDelayMs) && preferredDelayMs > 0
        ? Math.min(preferredDelayMs, SSE_RECONNECT_MAX_DELAY)
        : exponentialDelay;
    const jitterMs = Math.floor(Math.random() * 600);
    const delayMs = Math.max(SSE_RECONNECT_BASE_DELAY, normalizedPreferredDelay) + jitterMs;

    console.log(
        `[SSE] Reconnecting in ${delayMs}ms... Attempt ${sseReconnectAttempts}/${MAX_SSE_RECONNECT_ATTEMPTS}`
    );
    updateConnectionStatus('reconnecting');

    if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
    sseReconnectTimer = setTimeout(() => {
        initSSE();
    }, delayMs);
}

function syncSSEForCurrentContext(forceReconnect = false) {
    if (!canUseRealtimeNow()) {
        closeSSE();
        updateConnectionStatus('paused');
        return;
    }

    if (forceReconnect || !eventSource) {
        initSSE();
    }
}

function initSSE() {
    if (!canUseRealtimeNow()) {
        closeSSE();
        return;
    }

    const now = Date.now();
    if (now - sseLastConnectAttemptAt < SSE_MIN_CONNECT_GAP_MS) {
        scheduleSSEReconnect(SSE_MIN_CONNECT_GAP_MS);
        return;
    }
    sseLastConnectAttemptAt = now;

    if (sseReconnectTimer) {
        clearTimeout(sseReconnectTimer);
        sseReconnectTimer = null;
    }
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    try {
        const sseUrl = `${API_BASE}/web/events`;
        eventSource = new EventSource(sseUrl, { withCredentials: true });

        eventSource.onopen = () => {
            console.log('[SSE] Connection established');
            sseReconnectAttempts = 0;
            updateConnectionStatus('connected');
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleSSEMessage(data);
            } catch (err) {
                console.error('[SSE] Error parsing message:', err);
            }
        };

        eventSource.onerror = (err) => {
            console.error('[SSE] Connection error:', err);
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }

            if (!canUseRealtimeNow()) {
                updateConnectionStatus('paused');
                return;
            }

            updateConnectionStatus('disconnected');
            scheduleSSEReconnect();
        };
    } catch (err) {
        console.error('[SSE] Error initializing:', err);
        scheduleSSEReconnect();
    }
}

function handleSSEMessage(data) {
    switch (data.type) {
        case 'connected':
            console.log('[SSE]', data.message);
            showNotification('Conectado en tiempo real', 'success');
            break;

        case 'installation_created':
            handleRealtimeInstallation(data.installation);
            break;

        case 'installation_updated':
            handleRealtimeInstallationUpdate(data.installation);
            break;

        case 'installation_deleted':
            handleRealtimeInstallationDeleted(data.installation);
            break;

        case 'incident_created':
            handleRealtimeIncident(data.incident);
            break;

        case 'incident_status_updated':
            handleRealtimeIncidentStatusUpdate(data.incident);
            break;

        case 'stats_update':
            handleRealtimeStatsUpdate(data.statistics);
            break;

        case 'reconnect':
            console.log('[SSE] Server requested reconnect');
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
            scheduleSSEReconnect(Number(data?.reconnect_after_ms) || 1000);
            break;

        case 'ping':
            break;

        default:
            console.log('[SSE] Unknown message type:', data.type);
    }
}

function handleRealtimeInstallation(installation) {
    // Add to current data if on installations page
    if (currentInstallationsData && document.getElementById('installationsSection')?.classList.contains('active')) {
        currentInstallationsData.unshift(installation);
        renderInstallationsTable(currentInstallationsData.slice(0, 50));
        
        // Update results count
        const resultsCount = document.getElementById('resultsCount');
        if (resultsCount) {
            const count = currentInstallationsData.length;
            resultsCount.innerHTML = `Mostrando <span class="count">${Math.min(count, 50)}</span> de <span class="count">${count}</span> resultado${count !== 1 ? 's' : ''}`;
        }
    }
    
    // Show notification
    const statusIcon = installation.status === 'success' ? 'OK' : installation.status === 'failed' ? 'X' : 'DEV';
    showNotification(`${statusIcon} Nuevo registro: ${installation.client_name || 'Sin cliente'}`, 'info');
    
    // Refresh dashboard stats if on dashboard
    if (document.getElementById('dashboardSection')?.classList.contains('active')) {
        setTimeout(() => {
            loadDashboard();
        }, 1000);
    }
}

function handleRealtimeInstallationUpdate(installation) {
    // Update in current data if present
    if (currentInstallationsData) {
        const index = currentInstallationsData.findIndex(i => i.id === installation.id);
        if (index !== -1) {
            currentInstallationsData[index] = installation;
            if (document.getElementById('installationsSection')?.classList.contains('active')) {
                renderInstallationsTable(currentInstallationsData);
            }
        }
    }
}

function handleRealtimeInstallationDeleted(installation) {
    if (!installation || !installation.id) return;
    if (currentInstallationsData) {
        currentInstallationsData = currentInstallationsData.filter((i) => i.id !== installation.id);
        if (document.getElementById('installationsSection')?.classList.contains('active')) {
            renderInstallationsTable(currentInstallationsData);
        }
    }
    showNotification(`Registro #${installation.id} eliminado`, 'info');
}

function handleRealtimeIncident(incident) {
    const severityIcon = incident.severity === 'critical' ? 'CRIT' : incident.severity === 'high' ? 'ALTA' : 'WARN';
    showNotification(`${severityIcon} Nueva incidencia en registro #${incident.installation_id}`, 'warning');
}

function handleRealtimeIncidentStatusUpdate(incident) {
    if (!incident || !incident.id) return;
    showNotification(
        `Incidencia #${incident.id} ahora est? "${incidentStatusLabel(incident.incident_status)}".`,
        'info',
    );

    const activeIncidentsSection = document.getElementById('incidentsSection')?.classList.contains('active');
    const activeAssetsSection = document.getElementById('assetsSection')?.classList.contains('active');

    if (activeIncidentsSection && currentSelectedInstallationId) {
        void showIncidentsForInstallation(currentSelectedInstallationId);
    }
    if (activeAssetsSection && currentSelectedAssetId) {
        void loadAssetDetail(currentSelectedAssetId, { keepSelection: true });
    }
}

function handleRealtimeStatsUpdate(stats) {
    if (document.getElementById('dashboardSection')?.classList.contains('active')) {
        updateStats(stats);
        // Refresh charts with animation
        renderSuccessChart(stats);
        renderBrandChart(stats);
    }
}

function isMobileDashboardViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function applyConnectionStatusVisualState(indicator) {
    if (!indicator) return;
    const hiddenByScroll = indicator.dataset.hiddenByScroll === '1';
    const dimmed = indicator.dataset.dimmed === '1';
    const canReconnect = indicator.dataset.canReconnect === '1';

    indicator.classList.toggle('is-hidden-by-scroll', hiddenByScroll);
    indicator.classList.toggle('is-dimmed', !hiddenByScroll && dimmed);
    indicator.classList.toggle('is-reconnectable', !hiddenByScroll && canReconnect);
}

function ensureConnectionStatusMobileBindings() {
    if (connectionStatusMobileBindingsReady) return;
    connectionStatusMobileBindingsReady = true;
    connectionStatusLastScrollY = window.scrollY || 0;

    window.addEventListener('scroll', () => {
        const indicator = document.getElementById('connectionStatus');
        if (!indicator || !isMobileDashboardViewport()) return;

        const now = Date.now();
        if (now < connectionStatusForceVisibleUntil) return;

        const currentScrollY = window.scrollY || 0;
        const deltaY = currentScrollY - connectionStatusLastScrollY;
        connectionStatusLastScrollY = currentScrollY;
        if (Math.abs(deltaY) < 12) return;

        const shouldHide = deltaY > 0 && currentScrollY > 24;
        indicator.dataset.hiddenByScroll = shouldHide ? '1' : '0';
        applyConnectionStatusVisualState(indicator);
    }, { passive: true });

    window.addEventListener('resize', () => {
        const indicator = document.getElementById('connectionStatus');
        if (!indicator) return;
        if (!isMobileDashboardViewport()) {
            indicator.dataset.hiddenByScroll = '0';
            applyConnectionStatusVisualState(indicator);
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        const indicator = document.getElementById('connectionStatus');
        if (!indicator) return;
        indicator.dataset.hiddenByScroll = '0';
        applyConnectionStatusVisualState(indicator);
    });
}

function updateConnectionStatus(status) {
    const now = Date.now();
    if (
        connectionStatusLastRendered.status === status &&
        (now - connectionStatusLastRendered.at) < CONNECTION_STATUS_DEDUP_MS
    ) {
        return;
    }

    connectionStatusLastRendered = { status, at: now };

    const normalizedStatus = ['connected', 'disconnected', 'reconnecting', 'paused', 'failed'].includes(status)
        ? status
        : 'disconnected';

    const existingIndicator = document.getElementById('connectionStatus');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    syncHeaderDelight(getActiveSectionName() || 'dashboard', normalizedStatus);
}
function closeSSE() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    if (sseReconnectTimer) {
        clearTimeout(sseReconnectTimer);
        sseReconnectTimer = null;
    }
    if (connectionStatusScrollHideTimer) {
        clearTimeout(connectionStatusScrollHideTimer);
        connectionStatusScrollHideTimer = null;
    }
    connectionStatusLastRendered = { status: '', at: 0 };
    connectionStatusForceVisibleUntil = 0;
    const indicator = document.getElementById('connectionStatus');
    if (indicator) {
        indicator.remove();
    }
}

// Initialize
async function init() {
    try {
        if (FORCE_LOGIN_ON_OPEN) {
            try {
                await api.logout();
            } catch (_err) {
                // Ignorar si no había sesión activa.
            }
            currentUser = null;
            webAccessToken = '';
            closeSSE();
            resetProtectedViews();
            showLogin();
        } else {
            const me = await api.getMe();
            applyAuthenticatedUser(me);
            hideLogin();
            loadDashboard();
            syncSSEForCurrentContext(true);
        }
    } catch (err) {
        console.error('Error validating session:', err);
        currentUser = null;
        closeSSE();
        resetProtectedViews();
        showLogin();
    }
    
    // Setup advanced filters
    setupAdvancedFilters();
    
    // Setup export buttons
    setupExportButtons();
    
    // Setup theme toggle
    setupThemeToggle();
    syncHeaderDelight(getActiveSectionName() || 'dashboard', 'paused');
    
    // Handle page visibility changes to suspend/reconnect SSE.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log('[SSE] Page visible, reconnecting...');
            syncSSEForCurrentContext(true);
            return;
        }
        closeSSE();
        updateConnectionStatus('paused');
    });
    
    // Close SSE on page unload
    window.addEventListener('beforeunload', closeSSE);
}


// Theme Management Functions
function getCurrentTheme() {
    // Check localStorage first, then system preference, default to light
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        return savedTheme;
    }
    
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    
    return 'light';
}

function setTheme(theme) {
    const html = document.documentElement;
    
    if (theme === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else {
        html.removeAttribute('data-theme');
    }
    
    // Save to localStorage
    localStorage.setItem('theme', theme);
    
    // Update Chart.js colors if charts exist
    updateChartTheme(theme);
}

function toggleTheme() {
    const currentTheme = getCurrentTheme();
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    
    // Show notification
    const themeLabel = newTheme === 'light' ? 'claro' : 'oscuro';
    showNotification(`Tema ${themeLabel} activado`, 'info');
}

function updateChartTheme(theme) {
    if (!isChartAvailable()) return;
    applyChartDefaults(theme);
    
    // Update existing charts if they exist
    Object.values(charts).forEach(chart => {
        if (chart) {
            chart.update();
        }
    });
}

function setupThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        // Set initial theme
        const currentTheme = getCurrentTheme();
        setTheme(currentTheme);
        
        // Add click handler
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    // Listen for system theme changes
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
        mediaQuery.addEventListener('change', (e) => {
            // Only auto-switch if user hasn't manually set a preference
            if (!localStorage.getItem('theme')) {
                setTheme(e.matches ? 'light' : 'dark');
            }
        });
    }
}

init();


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
const installationCacheById = new Map();
let currentSelectedInstallationId = null;
let currentAssetsData = [];
let currentSelectedAssetId = null;
let currentDriversData = [];
let currentTechniciansData = [];
let currentWebUsersData = [];
let currentTenantsData = [];
let currentSelectedTenantId = null;
let currentTenantDetail = null;
let currentTenantUsersData = [];
const technicianAssignmentsByTechnicianId = new Map();
const technicianAssignmentsByEntityKey = new Map();
const expandedTechnicianAssignmentPanels = new Set();
let selectedDriverFile = null;
let currentTrendRangeDays = 7;
let dashboardLoadPromise = null;
let dashboardRefreshRetryTimer = null;
let dashboardLoadingRequests = 0;
const LAZY_ASSET_PATHS = {
    chart: '/chart.umd.js',
    jsqr: '/jsqr.js',
    xlsx: '/xlsx.bundle.js',
};
const lazyAssetPromises = new Map();
const lazyAssetWarnings = new Set();
const TREND_RANGE_ALLOWED_DAYS = new Set([1, 7]);
let lastCriticalIncidentsCount = null;
let incidentRuntimeTickerId = null;

// WebSocket/SSE State
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

function normalizeInstallationCacheId(rawId) {
    const parsedId = Number.parseInt(String(rawId), 10);
    return Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null;
}

function upsertInstallationCacheEntries(items) {
    if (!Array.isArray(items)) return;
    items.forEach((item) => {
        const installationId = normalizeInstallationCacheId(item?.id);
        if (!Number.isInteger(installationId)) {
            return;
        }
        const existingItem = installationCacheById.get(installationId) || {};
        installationCacheById.set(installationId, {
            ...existingItem,
            ...item,
        });
    });
}

function getInstallationFromCache(installationId) {
    const normalizedId = normalizeInstallationCacheId(installationId);
    if (!Number.isInteger(normalizedId)) {
        return null;
    }
    return installationCacheById.get(normalizedId) || null;
}

function clearInstallationCache() {
    installationCacheById.clear();
}

function setDashboardLoadingState(isLoading) {
    dashboardLoadingRequests = isLoading
        ? dashboardLoadingRequests + 1
        : Math.max(0, dashboardLoadingRequests - 1);

    const isBusy = dashboardLoadingRequests > 0;
    const section = document.getElementById('dashboardSection');
    if (section) {
        section.dataset.loading = isBusy ? 'true' : 'false';
        section.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    }

    const opsPulse = document.getElementById('opsPulse');
    if (opsPulse && isBusy) {
        opsPulse.dataset.state = 'reconnecting';
    }

    const opsPulseText = document.getElementById('opsPulseText');
    if (opsPulseText && isBusy) {
        opsPulseText.textContent = 'Sincronizando dashboard';
    }

    const recentInstallations = document.getElementById('recentInstallations');
    if (
        isBusy
        && recentInstallations
        && !recentInstallations.querySelector('table')
        && !recentInstallations.querySelector('.loading')
        && !recentInstallations.querySelector('.table-skeleton')
    ) {
        recentInstallations.innerHTML = `
            <div class="table-skeleton" aria-hidden="true">
                <div class="table-skeleton-head">
                    <span class="table-skeleton-cell table-skeleton-cell-id"></span>
                    <span class="table-skeleton-cell"></span>
                    <span class="table-skeleton-cell"></span>
                    <span class="table-skeleton-cell table-skeleton-cell-badge"></span>
                    <span class="table-skeleton-cell table-skeleton-cell-date"></span>
                </div>
                <div class="table-skeleton-row">
                    <span class="table-skeleton-cell table-skeleton-cell-id"></span>
                    <span class="table-skeleton-cell"></span>
                    <span class="table-skeleton-cell"></span>
                    <span class="table-skeleton-cell table-skeleton-cell-badge"></span>
                    <span class="table-skeleton-cell table-skeleton-cell-date"></span>
                </div>
                <div class="table-skeleton-row">
                    <span class="table-skeleton-cell table-skeleton-cell-id"></span>
                    <span class="table-skeleton-cell"></span>
                    <span class="table-skeleton-cell"></span>
                    <span class="table-skeleton-cell table-skeleton-cell-badge"></span>
                    <span class="table-skeleton-cell table-skeleton-cell-date"></span>
                </div>
                <div class="table-skeleton-row">
                    <span class="table-skeleton-cell table-skeleton-cell-id"></span>
                    <span class="table-skeleton-cell"></span>
                    <span class="table-skeleton-cell"></span>
                    <span class="table-skeleton-cell table-skeleton-cell-badge"></span>
                    <span class="table-skeleton-cell table-skeleton-cell-date"></span>
                </div>
                <p class="table-skeleton-caption">Sincronizando panel operativo...</p>
            </div>
        `;
    }
}
const QR_PREVIEW_SIZE_PX = 320;
const INCIDENT_CHECKLIST_PRESETS = [
    'Equipo identificado (QR/serie)',
    'Incidencia reproducida',
    'Evidencia fotografica capturada',
    'Diagnostico inicial registrado',
    'Accion correctiva documentada',
    'Validacion final con usuario/tecnico',
];
const INCIDENT_ESTIMATED_DURATION_MAX_SECONDS = 7 * 24 * 60 * 60;
const INCIDENT_ESTIMATED_DURATION_PRESETS = [
    { seconds: 0, label: 'Sin impacto (0 min)' },
    { seconds: 5 * 60, label: '5 min' },
    { seconds: 15 * 60, label: '15 min' },
    { seconds: 30 * 60, label: '30 min' },
    { seconds: 60 * 60, label: '1 h' },
    { seconds: 2 * 60 * 60, label: '2 h' },
    { seconds: 4 * 60 * 60, label: '4 h' },
];
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
const QR_EDIT_UNLOCK_TTL_MS = 10 * 60 * 1000;
const KPI_NUMBER_ANIMATION_MS = 620;
const SECTION_TRANSITION_OUT_MS = 150;
const TOAST_DURATION_MS = 3100;
const MODAL_FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[href]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');
const SECTION_TITLES = {
    dashboard: 'Centro del turno',
    installations: 'Registros',
    assets: 'Equipos',
    drivers: 'Drivers',
    incidents: 'Incidencias',
    tenants: 'Tenants',
    audit: 'Auditoría',
    settings: 'Configuración',
};
const SECTION_SUBTITLES = {
    dashboard: 'Prioriza incidencias, registros activos y desvio de SLA',
    installations: 'Historial técnico para consultar contexto y registros',
    assets: 'Equipos con acceso directo a incidencias y contexto',
    drivers: 'Versionado centralizado de controladores',
    incidents: 'Atiende eventos sin perder el contexto operativo',
    tenants: 'Administra empresas, admins y estado de plataforma',
    audit: 'Trazas críticas y cumplimiento',
    settings: 'Preferencias operativas y atajos de gestión',
};
const TECHNICIAN_ENTITY_LABELS = Object.freeze({
    installation: 'Registro',
    incident: 'Incidencia',
    asset: 'Equipo',
    zone: 'Zona',
});
const TECHNICIAN_ASSIGNMENT_ROLE_LABELS = Object.freeze({
    owner: 'Responsable',
    assistant: 'Apoyo',
    reviewer: 'Revisión',
});
const SECTION_REQUIRED_BINDINGS = Object.freeze({
    dashboard: [
        'kpiCriticalIncidentsValue',
        'kpiCriticalMeta',
        'kpiInProgressIncidentsValue',
        'kpiInProgressMeta',
        'kpiOutsideSlaIncidentsValue',
        'kpiSlaMeta',
        'kpiLastSyncTimeValue',
        'kpiSyncMeta',
        'trendChart',
        'recentInstallations',
        'attentionPanel',
    ],
    installations: [
        'searchInput',
        'brandFilter',
        'startDate',
        'endDate',
        'applyFilters',
        'resultsCount',
        'installationsTable',
    ],
    incidents: [
        'incidentMapCanvas',
        'incidentMapDetail',
        'incidentsList',
    ],
    assets: [
        'assetsSearchInput',
        'assetsSearchBtn',
        'assetsRefreshBtn',
        'assetsCreateQrBtn',
        'assetsResultsCount',
        'assetsTable',
        'assetDetail',
    ],
    drivers: [
        'driverBrandInput',
        'driverVersionInput',
        'driverDescriptionInput',
        'driverFileInput',
        'driverUploadBtn',
        'driversRefreshBtn',
        'driversResultsCount',
        'driversTable',
    ],
    audit: [
        'auditActionFilter',
        'refreshAudit',
        'auditLogs',
    ],
    tenants: [
        'tenantsList',
        'tenantDetail',
        'tenantsRefreshBtn',
        'tenantsCreateBtn',
    ],
    settings: [
        'settingsUsername',
        'settingsRole',
        'settingsSyncStatus',
        'settingsOpenAuditBtn',
        'settingsLogoutBtn',
    ],
});
const MOBILE_NAV_OVERFLOW_SECTIONS = new Set(['drivers', 'tenants', 'audit', 'settings']);
const HEADER_PRIMARY_ACTIONS = {
    dashboard: { icon: 'add_circle', label: 'Nuevo registro', action: 'createRecord' },
    installations: { icon: 'add_circle', label: 'Nuevo registro', action: 'createRecord' },
    assets: { icon: 'qr_code_2', label: 'Nuevo equipo + QR', action: 'createAsset' },
    drivers: { icon: 'cloud_upload', label: 'Subir driver', action: 'pickDriverFile' },
    incidents: { icon: 'warning', label: 'Nueva incidencia', action: 'createIncident' },
    tenants: { icon: 'add_business', label: 'Nuevo tenant', action: 'createTenant', hidden: true },
    audit: { icon: 'refresh', label: 'Actualizar auditoría', action: 'refreshAudit' },
    settings: { icon: 'description', label: 'Abrir auditoría', action: 'openAudit' },
};
const TOAST_TYPE_ICONS = {
    success: '✓',
    error: '!',
    warning: '!',
    info: 'i',
};
const ACTIVE_KPI_ANIMATIONS = new WeakMap();
const REPORTED_SECTION_BINDING_WARNINGS = new Set();
const NOTIFIED_SECTION_BINDING_ERRORS = new Set();
let dashboardModals = null;
let dashboardIncidents = null;
let dashboardAssets = null;
let dashboardDrivers = null;
let dashboardAudit = null;
let dashboardOverview = null;
let dashboardRealtime = null;
let dashboardScan = null;
let dashboardGeolocation = null;

function openAccessibleModal(modalId, options = {}) {
    return dashboardModals.openAccessibleModal(modalId, options);
}

function closeAccessibleModal(modalId, options = {}) {
    return dashboardModals.closeAccessibleModal(modalId, options);
}

function handleModalKeyboardInteraction(event) {
    return dashboardModals.handleModalKeyboardInteraction(event);
}

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


function normalizeAssetPath(src) {
    try {
        return new URL(String(src || ''), window.location.origin).pathname;
    } catch {
        return String(src || '').trim();
    }
}

function findExistingLazyScript(src) {
    const normalizedSrc = String(src || '').trim();
    if (!normalizedSrc) return null;

    const exactMatch = document.querySelector(`script[src="${normalizedSrc}"]`);
    if (exactMatch) return exactMatch;

    const expectedPath = normalizeAssetPath(normalizedSrc);
    return Array.from(document.scripts).find((script) => normalizeAssetPath(script.src) === expectedPath) || null;
}

function waitForExistingScript(script, normalizedSrc) {
    if (!script) {
        return Promise.reject(new Error(`No se encontró el script ${normalizedSrc}.`));
    }

    if (script.dataset.loadState === 'loaded') {
        return Promise.resolve(script);
    }

    if (script.dataset.loadState === 'failed') {
        return Promise.reject(new Error(`El script ${normalizedSrc} quedó en estado fallido.`));
    }

    return new Promise((resolve, reject) => {
        const handleLoad = () => {
            script.dataset.loadState = 'loaded';
            cleanup();
            resolve(script);
        };
        const handleError = () => {
            script.dataset.loadState = 'failed';
            cleanup();
            reject(new Error(`No se pudo cargar ${normalizedSrc}.`));
        };
        const cleanup = () => {
            script.removeEventListener('load', handleLoad);
            script.removeEventListener('error', handleError);
        };

        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });
    });

}

function loadLazyScript(src) {
    const normalizedSrc = String(src || '').trim();
    if (!normalizedSrc) {
        return Promise.reject(new Error('No se pudo resolver el script diferido.'));
    }
    if (lazyAssetPromises.has(normalizedSrc)) {
        return lazyAssetPromises.get(normalizedSrc);
    }

    const loadPromise = new Promise((resolve, reject) => {
        const existingScript = findExistingLazyScript(normalizedSrc);
        if (existingScript) {
            waitForExistingScript(existingScript, normalizedSrc).then(resolve).catch(reject);
            return;
        }

        const script = document.createElement('script');
        script.src = normalizedSrc;
        script.defer = true;
        script.dataset.loadState = 'pending';
        script.onload = () => {
            script.dataset.loadState = 'loaded';
            resolve(script);
        };
        script.onerror = () => {
            script.dataset.loadState = 'failed';
            lazyAssetPromises.delete(normalizedSrc);
            reject(new Error(`No se pudo cargar ${normalizedSrc}.`));
        };
        document.head.appendChild(script);
    });

    lazyAssetPromises.set(normalizedSrc, loadPromise);
    return loadPromise;
}

function readThemeToken(name, fallbackValue) {
    try {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallbackValue;
    } catch {
        return fallbackValue;
    }
}

async function ensureChartLibrary() {
    if (isChartAvailable()) {
        lazyAssetWarnings.delete(LAZY_ASSET_PATHS.chart);
        return true;
    }
    try {
        await loadLazyScript(LAZY_ASSET_PATHS.chart);
        if (!isChartAvailable()) {
            await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
        }
        if (!isChartAvailable()) {
            throw new Error('Chart.js terminó de cargar, pero no expuso la API global esperada.');
        }
        applyChartDefaults(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
        lazyAssetWarnings.delete(LAZY_ASSET_PATHS.chart);
        return true;
    } catch (error) {
        if (isChartAvailable()) {
            applyChartDefaults(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
            lazyAssetWarnings.delete(LAZY_ASSET_PATHS.chart);
            return true;
        }
        console.error('No se pudo cargar Chart.js:', error);
        if (!lazyAssetWarnings.has(LAZY_ASSET_PATHS.chart)) {
            lazyAssetWarnings.add(LAZY_ASSET_PATHS.chart);
            showNotification('No pudimos cargar los gráficos del dashboard.', 'warning');
        }
        return false;
    }
}

async function ensureJsQrLibrary() {
    if (typeof window.jsQR === 'function') {
        return true;
    }
    try {
        await loadLazyScript(LAZY_ASSET_PATHS.jsqr);
        return typeof window.jsQR === 'function';
    } catch (error) {
        console.error('No se pudo cargar jsQR:', error);
        showNotification('No pudimos activar el escaneo QR compatible en este navegador.', 'warning');
        return false;
    }
}

async function ensureXlsxLibrary() {
    if (window.XLSX?.utils?.book_new && typeof window.XLSX.writeFile === 'function') {
        return true;
    }
    try {
        await loadLazyScript(LAZY_ASSET_PATHS.xlsx);
        return window.XLSX?.utils?.book_new && typeof window.XLSX.writeFile === 'function';
    } catch (error) {
        console.error('No se pudo cargar XLSX:', error);
        showNotification('No pudimos activar la exportacion Excel en este momento.', 'warning');
        return false;
    }
}

// Chart.js default configuration
function isChartAvailable() {
    return typeof Chart !== 'undefined' && Chart && Chart.defaults;
}

function applyChartDefaults(theme = 'light') {
    if (!isChartAvailable()) return;
    Chart.defaults.color = readThemeToken('--text-secondary', theme === 'dark' ? '#8b93a5' : '#5f6b7a');
    Chart.defaults.borderColor = readThemeToken('--border', theme === 'dark' ? '#2e3240' : '#dce1e8');
    Chart.defaults.font = {
        ...(Chart.defaults.font || {}),
        family: "'Source Sans 3', 'Segoe UI', sans-serif",
    };

    const defaultPlugins = Chart.defaults.plugins || {};
    Chart.defaults.plugins = defaultPlugins;
    defaultPlugins.title = {
        ...(defaultPlugins.title || {}),
        font: {
            ...((defaultPlugins.title && defaultPlugins.title.font) || {}),
            family: "'IBM Plex Sans Condensed', 'Source Sans 3', sans-serif",
        },
    };
    defaultPlugins.legend = {
        ...(defaultPlugins.legend || {}),
        labels: {
            ...((defaultPlugins.legend && defaultPlugins.legend.labels) || {}),
            font: {
                ...((defaultPlugins.legend && defaultPlugins.legend.labels && defaultPlugins.legend.labels.font) || {}),
                family: "'IBM Plex Mono', 'Source Sans 3', monospace",
            },
        },
    };
}

if (isChartAvailable()) {
    applyChartDefaults('light');
}

const apiFactory = window.DashboardApi && typeof window.DashboardApi.createClient === 'function'
    ? window.DashboardApi.createClient
    : null;

if (!apiFactory) {
    throw new Error('No se pudo inicializar DashboardApi. Verifica la carga de /dashboard-api.js');
}

let dashboardAuth = null;

const api = apiFactory({
    apiBase: API_BASE,
    getAccessToken: () => webAccessToken,
    setAccessToken: (value) => {
        webAccessToken = String(value || '');
    },
    onUnauthorized: () => {
        if (dashboardAuth) {
            dashboardAuth.handleUnauthorized();
            return;
        }
        currentUser = null;
        webAccessToken = '';
        closeSSE();
        resetProtectedViews();
        showLogin();
    },
});

dashboardGeolocation = typeof window.createDashboardGeolocation === 'function'
    ? window.createDashboardGeolocation()
    : null;

dashboardModals = window.createDashboardModals({
    api,
    escapeHtml,
    getCurrentQrLabelPreset: () => currentQrLabelPreset,
    getCurrentUser: () => currentUser,
    getQrModalEditUnlockUntil: () => qrModalEditUnlockUntil,
    getQrModalEditUnlocked: () => qrModalEditUnlocked,
    getQrModalReadOnly: () => qrModalReadOnly,
    hideLogin: () => hideLogin(),
    loadPhotoWithAuth,
    modalFocusableSelector: MODAL_FOCUSABLE_SELECTOR,
    normalizeAssetCodeForQr,
    normalizeAssetFormText,
    qrEditUnlockTtlMs: QR_EDIT_UNLOCK_TTL_MS,
    qrMaxBrandLength: QR_MAX_BRAND_LENGTH,
    qrMaxClientLength: QR_MAX_CLIENT_LENGTH,
    qrMaxModelLength: QR_MAX_MODEL_LENGTH,
    qrMaxNotesLength: QR_MAX_NOTES_LENGTH,
    qrMaxSerialLength: QR_MAX_SERIAL_LENGTH,
    resetQrState: () => {
        currentQrPayload = '';
        currentQrImageUrl = '';
        currentQrLabelInfo = null;
    },
    setQrModalEditUnlockUntil: (value) => {
        qrModalEditUnlockUntil = Number(value || 0);
    },
    setQrModalEditUnlocked: (value) => {
        qrModalEditUnlocked = Boolean(value);
    },
    setQrModalReadOnly: (value) => {
        qrModalReadOnly = Boolean(value);
    },
    showNotification,
});

dashboardIncidents = window.createDashboardIncidents({
    api,
    bindIncidentEstimatedDurationFields,
    canCurrentUserEditAssets,
    canCurrentUserManageTechnicianAssignments,
    closeActionModal,
    createMaterialIconNode,
    escapeHtml,
    formatDurationToHHMM,
    formatDuration,
    geolocation: dashboardGeolocation,
    getActiveSectionName,
    getAvailableTechnicians: () => currentTechniciansData.filter((item) => item && item.is_active),
    getCurrentLinkedTechnician: () => currentTechniciansData.find((item) =>
        item && Number(item.web_user_id) === Number(currentUser?.id)) || null,
    getTechnicianAssignmentsForEntity: (...args) => loadTechnicianAssignmentsForEntity(...args),
    getInstallationById: getInstallationFromCache,
    getCurrentSelectedAssetId: () => currentSelectedAssetId,
    getCurrentSelectedInstallationId: () => currentSelectedInstallationId,
    getCurrentUser: () => currentUser,
    incidentChecklistPresets: INCIDENT_CHECKLIST_PRESETS,
    incidentEstimatedDurationMaxSeconds: INCIDENT_ESTIMATED_DURATION_MAX_SECONDS,
    incidentEstimatedDurationPresets: INCIDENT_ESTIMATED_DURATION_PRESETS,
    incidentStatusLabel,
    isSectionActive: (section) => document.getElementById(section + 'Section')?.classList.contains('active') === true,
    loadAssetDetail,
    loadInstallations,
    loadPhotoWithAuth,
    normalizeIncidentChecklistItems,
    normalizeIncidentStatus,
    normalizeSeverity,
    openActionConfirmModal,
    openActionModal,
    openEntityTechnicianAssignmentModal,
    parseStrictInteger,
    readIncidentEstimatedDurationFromModal,
    recordAttentionStateIconName,
    renderContextualEmptyState,
    renderEntityTechnicianAssignmentsPanel,
    requireActiveSession,
    resolveIncidentEstimatedDurationSeconds,
    resolveIncidentRealDurationSeconds,
    resolveIncidentRuntimeStartMs,
    ensureIncidentRuntimeTicker,
    navigateToSectionByKey,
    setActionModalError,
    setCurrentSelectedInstallationId: (value) => {
        currentSelectedInstallationId = value;
    },
    setElementTextWithMaterialIcon,
    showNotification,
    viewPhoto,
});

dashboardAssets = window.createDashboardAssets({
    api,
    appendIncidentCard: (...args) => dashboardIncidents.appendIncidentCard(...args),
    canCurrentUserEditAssets,
    canCurrentUserManageTechnicianAssignments,
    closeActionModal,
    createIncidentForAsset: (...args) => dashboardIncidents.createIncidentForAsset(...args),
    deriveAssetAttentionMetaFromIncidents: (...args) => dashboardIncidents.deriveAssetAttentionMetaFromIncidents(...args),
    escapeHtml,
    getCurrentSelectedAssetId: () => currentSelectedAssetId,
    makeTableRowKeyboardAccessible,
    normalizeAssetStatusLabel,
    normalizeIncidentStatus,
    openActionConfirmModal,
    openActionModal,
    openAssetLinkModal,
    openEntityTechnicianAssignmentModal,
    parseStrictInteger,
    renderContextualEmptyState,
    renderEntityTechnicianAssignmentsPanel,
    requireActiveSession,
    setCurrentAssetsData: (value) => {
        currentAssetsData = Array.isArray(value) ? value : [];
    },
    setCurrentSelectedAssetId: (value) => {
        currentSelectedAssetId = Number.isInteger(value) && value > 0 ? value : null;
    },
    setElementTextWithMaterialIcon,
    showAssetQrModal: (asset) => {
        showQrModal({ type: 'asset', asset, readOnly: true });
        generateQrPreview({
            assetData: {
                external_code: normalizeAssetCodeForQr(asset?.external_code || ''),
                brand: normalizeAssetFormText(asset?.brand, QR_MAX_BRAND_LENGTH),
                model: normalizeAssetFormText(asset?.model, QR_MAX_MODEL_LENGTH),
                serial_number: normalizeAssetFormText(asset?.serial_number, QR_MAX_SERIAL_LENGTH),
                client_name: normalizeAssetFormText(asset?.client_name, QR_MAX_CLIENT_LENGTH),
                notes: normalizeAssetFormText(asset?.notes, QR_MAX_NOTES_LENGTH),
            },
        });
    },
    showNotification,
    sortAssetIncidentsByPriority: (...args) => dashboardIncidents.sortAssetIncidentsByPriority(...args),
});

dashboardScan = window.createDashboardScan({
    api,
    ensureJsQrAvailability: ensureJsQrLibrary,
    requireActiveSession,
    showNotification,
    openInstallation: async (installationId) => {
        await dashboardNavigation.activateSection('incidents');
        await showIncidentsForInstallation(installationId);
    },
    openAsset: async (assetId) => {
        await dashboardNavigation.activateSection('assets');
        await loadAssetDetail(assetId, { keepSelection: true });
    },
});

dashboardDrivers = window.createDashboardDrivers({
    api,
    closeActionModal,
    getSelectedDriverFile: () => selectedDriverFile,
    openActionConfirmModal,
    renderContextualEmptyState,
    requireActiveSession,
    setCurrentDriversData: (value) => {
        currentDriversData = Array.isArray(value) ? value : [];
    },
    setSelectedDriverFile: (value) => {
        selectedDriverFile = value || null;
    },
    showNotification,
});

dashboardAudit = window.createDashboardAudit({
    api,
    renderContextualEmptyState,
    requireActiveSession,
});

dashboardOverview = window.createDashboardOverview({
    activeKpiAnimations: ACTIVE_KPI_ANIMATIONS,
    allowedTrendRangeDays: TREND_RANGE_ALLOWED_DAYS,
    api,
    cacheInstallations: upsertInstallationCacheEntries,
    createManualRecord: () => createManualRecordFromWeb(),
    ensureChartsReady: ensureChartLibrary,
    getCharts: () => charts,
    getConnectionStatus,
      getCurrentTrendRangeDays: () => currentTrendRangeDays,
      getCurrentUser: () => currentUser,
      getLastCriticalIncidentsCount: () => lastCriticalIncidentsCount,
      getTechnicianLoadSummary,
      isChartAvailable,
    kpiNumberAnimationMs: KPI_NUMBER_ANIMATION_MS,
    navigateToSectionByKey,
    readThemeToken,
    renderContextualEmptyState,
    requireActiveSession,
    setCurrentTrendRangeDays: (value) => {
        currentTrendRangeDays = Number.isInteger(value) ? value : currentTrendRangeDays;
    },
    setDashboardLoadingState,
    setElementTextWithMaterialIcon,
    setLastCriticalIncidentsCount: (value) => {
        lastCriticalIncidentsCount = Number.isInteger(value) ? value : null;
    },
    setNotificationBadgeCount,
    validateSectionBindings,
});

dashboardRealtime = window.createDashboardRealtime({
    activeSections: SSE_ACTIVE_SECTIONS,
    apiBase: API_BASE,
    baseReconnectDelayMs: SSE_RECONNECT_BASE_DELAY,
    connectionStatusDedupMs: CONNECTION_STATUS_DEDUP_MS,
    getActiveSectionName,
    getCurrentInstallationsData: () => currentInstallationsData,
    getCurrentTrendRangeDays: () => currentTrendRangeDays,
    getCurrentUser: () => currentUser,
    handleRealtimeIncident: (incident) => dashboardIncidents.handleRealtimeIncident(incident),
    handleRealtimeIncidentStatusUpdate: (incident) => dashboardIncidents.handleRealtimeIncidentStatusUpdate(incident),
    isSectionActive: (section) => document.getElementById(section + 'Section')?.classList.contains('active') === true,
    loadDashboard,
    maxReconnectAttempts: MAX_SSE_RECONNECT_ATTEMPTS,
    maxReconnectDelayMs: SSE_RECONNECT_MAX_DELAY,
    minConnectGapMs: SSE_MIN_CONNECT_GAP_MS,
    normalizeRecordAttentionState,
    renderBrandChart,
    renderInstallationsTable,
    renderSuccessChart,
    renderTrendChart,
    setCurrentInstallationsData: (value) => {
        currentInstallationsData = Array.isArray(value) ? value : [];
        upsertInstallationCacheEntries(currentInstallationsData);
    },
    showNotification,
    syncHeaderDelight,
    updateStats,
});

dashboardAuth = window.createDashboardAuth({
    api,
    clearSessionState: () => {
        currentUser = null;
        webAccessToken = '';
    },
    clearWebAccessToken: () => {
        webAccessToken = '';
    },
    closeAccessibleModal,
    closeHeaderOverflowMenu,
    closeMobileNavPanel,
    closeSSE,
    getActiveSectionName,
    getConnectionStatus,
    getCurrentUser: () => currentUser,
    loadDashboard,
    openAccessibleModal,
    resetDataViews: () => {
        currentInstallationsData = [];
        clearInstallationCache();
        currentSelectedInstallationId = null;
        currentAssetsData = [];
        currentSelectedAssetId = null;
        resetTechniciansState();
    },
    setCurrentUser: (user) => {
        currentUser = user;
    },
    setNotificationBadgeCount,
    showNotification,
    syncHeaderPrimaryAction,
    syncMobileNavMoreState,
    syncSSEForCurrentContext,
});

function showLogin() {
    return dashboardAuth.showLogin();
}

function hideLogin() {
    return dashboardAuth.hideLogin();
}

function resetProtectedViews() {
    return dashboardAuth.resetProtectedViews();
}

function hasActiveSession() {
    return dashboardAuth.hasActiveSession();
}

function requireActiveSession() {
    return dashboardAuth.requireActiveSession();
}

function canCurrentUserAccessAudit() {
    return dashboardAuth.canCurrentUserAccessAudit();
}

function syncRoleBasedNavigationAccess() {
    return dashboardAuth.syncRoleBasedNavigationAccess();
}

function syncMobileNavContext() {
    return dashboardAuth.syncMobileNavContext();
}

function syncMobileNavMoreState(section) {
    const moreBtn = document.getElementById('mobileNavMoreBtn');
    if (!moreBtn) return;
    const normalizedSection = SECTION_TITLES[section] ? section : 'dashboard';
    moreBtn.classList.toggle('active', MOBILE_NAV_OVERFLOW_SECTIONS.has(normalizedSection));
}

function closeMobileNavPanel(options = {}) {
    const shouldRestoreFocus = options.restoreFocus === true;
    const panel = document.getElementById('mobileNavPanel');
    const toggleBtn = document.getElementById('mobileNavMoreBtn');
    if (!panel || !toggleBtn) return false;
    const wasOpen = panel.classList.contains('is-open');
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    toggleBtn.setAttribute('aria-expanded', 'false');
    if (wasOpen && shouldRestoreFocus) {
        toggleBtn.focus();
    }
    return wasOpen;
}

function setupMobileNavPanel() {
    const panel = document.getElementById('mobileNavPanel');
    const toggleBtn = document.getElementById('mobileNavMoreBtn');
    const closeBtn = document.getElementById('mobileNavCloseBtn');
    if (!panel || !toggleBtn) return;

    const setOpen = (isOpen) => {
        panel.classList.toggle('is-open', isOpen);
        panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (isOpen) {
            toggleBtn.classList.add('active');
            return;
        }
        syncMobileNavMoreState(getActiveSectionName() || 'dashboard');
    };

    const handleToggle = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(!panel.classList.contains('is-open'));
    };

    toggleBtn.addEventListener('click', handleToggle);
    toggleBtn.addEventListener('touchend', handleToggle, { passive: false });

    closeBtn?.addEventListener('click', () => {
        closeMobileNavPanel({ restoreFocus: true });
    });

    panel.querySelectorAll('[data-mobile-section]').forEach((button) => {
        button.addEventListener('click', () => {
            if (!requireActiveSession()) return;
            const section = String(button.dataset.mobileSection || '').trim();
            if (!section) return;
            if (section === 'audit' && !canCurrentUserAccessAudit()) {
                showNotification('No tienes permisos para acceder a Auditoría.', 'error');
                return;
            }
            closeMobileNavPanel();
            navigateToSectionByKey(section);
        });
    });

    document.addEventListener('click', (event) => {
        if (!panel.classList.contains('is-open')) return;
        if (panel.contains(event.target) || toggleBtn.contains(event.target)) return;
        closeMobileNavPanel();
    });

}

function setNotificationBadgeCount(count) {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    const normalizedCount = Number.parseInt(String(count ?? 0), 10);
    const safeCount = Number.isInteger(normalizedCount) && normalizedCount > 0 ? normalizedCount : 0;
    badge.classList.toggle('is-hidden', safeCount <= 0);
    badge.textContent = safeCount > 99 ? '99+' : String(safeCount);
    badge.setAttribute(
        'aria-label',
        safeCount > 0 ? `${safeCount} alertas pendientes` : 'Sin alertas pendientes',
    );
}

function updateSettingsSyncLabel(status = 'paused') {
    return dashboardAuth.updateSettingsSyncLabel(status);
}

function updateSettingsSummary() {
    const result = dashboardAuth.updateSettingsSummary();
    renderTechniciansSection();
    renderTenantsSection();
    return result;
}

function applyAuthenticatedUser(user) {
    const result = dashboardAuth.applyAuthenticatedUser(user);
    renderTechniciansSection();
    renderTenantsSection();
    return result;
}

function canCurrentUserManageTenants() {
    const role = String(currentUser?.role || '').trim().toLowerCase();
    const tenantId = String(currentUser?.tenant_id || '').trim().toLowerCase();
    return (role === 'super_admin' || role === 'platform_owner') && tenantId === 'default';
}

function canCurrentUserAssignPlatformSuperAdmin() {
    return canCurrentUserManageTenants();
}

function canCurrentUserManageTechnicians() {
    const role = String(currentUser?.role || '').trim().toLowerCase();
    return role === 'admin' || role === 'super_admin' || role === 'platform_owner';
}

function canCurrentUserManageTechnicianAssignments() {
    const role = String(currentUser?.role || '').trim().toLowerCase();
    return role === 'admin' || role === 'super_admin' || role === 'platform_owner' || role === 'supervisor';
}

function resetTechniciansState() {
    currentTechniciansData = [];
    currentWebUsersData = [];
    technicianAssignmentsByTechnicianId.clear();
    technicianAssignmentsByEntityKey.clear();
    expandedTechnicianAssignmentPanels.clear();
    renderTechniciansSection();
    dashboardOverview?.renderTechnicianLoadAttention?.();
}

function resetTenantsState() {
    currentTenantsData = [];
    currentSelectedTenantId = null;
    currentTenantDetail = null;
    currentTenantUsersData = [];
    renderTenantsSection();
}

function setTenantSummaryValue(id, value) {
    const node = document.getElementById(id);
    if (node) {
        node.textContent = String(value ?? '-');
    }
}

function formatBytes(bytes) {
    const normalized = Number(bytes);
    if (!Number.isFinite(normalized) || normalized <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = normalized;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDateTime(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return 'sin dato';

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        return normalized;
    }

    return new Intl.DateTimeFormat('es-UY', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(parsed);
}

function normalizeMojibakeText(value) {
    const normalized = String(value ?? '');
    return normalized
        .replaceAll('ÃƒÂ³', 'ó')
        .replaceAll('ÃƒÂ©', 'é')
        .replaceAll('ÃƒÂ¡', 'á')
        .replaceAll('ÃƒÂº', 'ú')
        .replaceAll('ÃƒÂ±', 'ñ')
        .replaceAll('Ã‚Â·', '·')
        .replaceAll('Â·', '·')
        .replaceAll('sesiÃ', 'sesi')
        .replaceAll('administraciÃ', 'administraci')
        .replaceAll('secciÃ', 'secci')
        .replaceAll('todavÃ', 'todaví')
        .replaceAll('TÃ', 'Té')
        .replaceAll('Uso mÃ', 'Uso má');
}

function repairTenantSectionMojibake(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
        root.textContent = normalizeMojibakeText(root.textContent);
        return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    Array.from(root.childNodes || []).forEach((node) => repairTenantSectionMojibake(node));
}

function getTenantUserRoleOptions() {
    const options = [
        ['admin', 'Admin'],
        ['viewer', 'Solo lectura'],
    ];
    if (canCurrentUserAssignPlatformSuperAdmin()) {
        options.push(['platform_owner', 'Platform owner']);
    }
    return options;
}

function buildTenantUserFields(user = null, tenantId = '') {
    const fragment = document.createDocumentFragment();
    const grid = document.createElement('div');
    grid.className = 'action-modal-grid';

    if (!user) {
        const tenantInput = document.createElement('input');
        tenantInput.type = 'text';
        tenantInput.id = 'actionTenantUserTenantId';
        tenantInput.value = tenantId;
        tenantInput.readOnly = true;
        grid.append(createModalInputGroup('Tenant', tenantInput, { htmlFor: tenantInput.id }));

        const usernameInput = document.createElement('input');
        usernameInput.type = 'text';
        usernameInput.id = 'actionTenantUserUsername';
        usernameInput.placeholder = 'Ej: admin_cliente';
        usernameInput.autocomplete = 'off';
        grid.append(createModalInputGroup('Usuario', usernameInput, { htmlFor: usernameInput.id }));

        const passwordInput = document.createElement('input');
        passwordInput.type = 'password';
        passwordInput.id = 'actionTenantUserPassword';
        passwordInput.placeholder = 'ClaveFuerte#2026';
        passwordInput.autocomplete = 'new-password';
        grid.append(createModalInputGroup('Contraseña', passwordInput, { htmlFor: passwordInput.id }));
    }

    const roleSelect = document.createElement('select');
    roleSelect.id = 'actionTenantUserRole';
    const normalizedTenantId = String(tenantId || user?.tenant_id || '').trim().toLowerCase();
    getTenantUserRoleOptions()
        .filter(([value]) => value !== 'platform_owner' || normalizedTenantId === 'default')
        .forEach(([value, label]) => {
        const selected = value === (user?.role || 'viewer');
        roleSelect.appendChild(new Option(label, value, selected, selected));
        });
    grid.append(createModalInputGroup('Rol', roleSelect, { htmlFor: roleSelect.id }));

    const activeSelect = document.createElement('select');
    activeSelect.id = 'actionTenantUserIsActive';
    const isActive = user ? user.is_active === true : true;
    activeSelect.appendChild(new Option('Activo', '1', isActive, isActive));
    activeSelect.appendChild(new Option('Inactivo', '0', !isActive, !isActive));
    grid.append(createModalInputGroup('Estado', activeSelect, { htmlFor: activeSelect.id }));

    fragment.append(grid);
    return fragment;
}

async function loadTenantUsers(tenantId, options = {}) {
    const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
    if (!normalizedTenantId || !hasActiveSession() || !canCurrentUserManageTenants()) {
        currentTenantUsersData = [];
        return [];
    }

    const silent = options?.silent === true;
    try {
        const users = [];
        let nextCursor = null;

        do {
            const response = await api.getWebUsers({
                tenant_id: normalizedTenantId,
                limit: 500,
                cursor: nextCursor || undefined,
            });
            const pageUsers = Array.isArray(response?.users) ? response.users : [];
            users.push(...pageUsers);
            nextCursor = response?.pagination?.has_more ? response?.pagination?.next_cursor || null : null;
        } while (nextCursor);

        currentTenantUsersData = users;
        return currentTenantUsersData;
    } catch (error) {
        currentTenantUsersData = [];
        if (!silent) {
            showNotification(`No se pudo cargar usuarios del tenant: ${error?.message || error}`, 'error');
        }
        return [];
    }
}

function openTenantUserCreateModal() {
    const tenantId = String(currentSelectedTenantId || currentTenantDetail?.tenant?.id || '').trim().toLowerCase();
    if (!tenantId) {
        showNotification('Primero selecciona un tenant.', 'warning');
        return;
    }

    openActionModal({
        title: `Nuevo usuario para ${tenantId}`,
        subtitle: 'El usuario quedará creado directamente dentro del tenant seleccionado.',
        submitLabel: 'Crear usuario',
        focusId: 'actionTenantUserUsername',
        fields: buildTenantUserFields(null, tenantId),
        onSubmit: async () => {
            const username = String(document.getElementById('actionTenantUserUsername')?.value || '').trim();
            const password = String(document.getElementById('actionTenantUserPassword')?.value || '').trim();
            const role = String(document.getElementById('actionTenantUserRole')?.value || 'viewer').trim().toLowerCase();
            const isActive = String(document.getElementById('actionTenantUserIsActive')?.value || '1').trim() === '1';

            if (!username) {
                setActionModalError('Debes indicar el nombre de usuario.');
                return;
            }
            if (!password) {
                setActionModalError('Debes indicar una contraseña inicial.');
                return;
            }

            await api.createWebUser({
                username,
                password,
                role,
                tenant_id: tenantId,
                is_active: isActive,
            });

            closeActionModal(true);
            showNotification(`Usuario ${username} creado en ${tenantId}.`, 'success');
            await Promise.all([
                loadTenantsSection({ silent: true }),
                selectTenantDetail(tenantId, { silent: true }),
            ]);
        },
    });
}

function openTenantUserEditModal(user) {
    const tenantId = String(currentSelectedTenantId || currentTenantDetail?.tenant?.id || '').trim().toLowerCase();
    const userId = Number(user?.id);
    if (!tenantId || !Number.isInteger(userId) || userId <= 0) {
        showNotification('No pudimos identificar el usuario a actualizar.', 'error');
        return;
    }

    openActionModal({
        title: `Editar ${user?.username || `usuario #${userId}`}`,
        subtitle: 'Ajusta el rol y el estado de acceso dentro de este tenant.',
        submitLabel: 'Guardar cambios',
        focusId: 'actionTenantUserRole',
        fields: buildTenantUserFields(user, tenantId),
        onSubmit: async () => {
            const role = String(document.getElementById('actionTenantUserRole')?.value || user?.role || 'viewer').trim().toLowerCase();
            const isActive = String(document.getElementById('actionTenantUserIsActive')?.value || (user?.is_active ? '1' : '0')).trim() === '1';

            await api.updateWebUser(userId, {
                role,
                is_active: isActive,
            });

            closeActionModal(true);
            showNotification(`Usuario ${user?.username || `#${userId}`} actualizado.`, 'success');
            await Promise.all([
                loadTenantsSection({ silent: true }),
                selectTenantDetail(tenantId, { silent: true }),
            ]);
        },
    });
}

function createDeleteImpactSummaryNode(title, rows = [], footnote = '') {
    const wrapper = document.createElement('div');
    wrapper.className = 'action-impact-summary';

    if (title) {
        const heading = document.createElement('p');
        heading.className = 'action-impact-summary-title';
        heading.textContent = title;
        wrapper.appendChild(heading);
    }

    const list = document.createElement('div');
    list.className = 'action-impact-summary-list';
    rows.forEach((row) => {
        if (!row || !row.label) return;
        const item = document.createElement('div');
        item.className = 'action-impact-summary-item';
        const label = document.createElement('span');
        label.className = 'action-impact-summary-label';
        label.textContent = row.label;
        const value = document.createElement('strong');
        value.className = 'action-impact-summary-value';
        value.textContent = String(row.value ?? 0);
        item.append(label, value);
        list.appendChild(item);
    });
    wrapper.appendChild(list);

    if (footnote) {
        const note = document.createElement('p');
        note.className = 'action-impact-summary-note';
        note.textContent = footnote;
        wrapper.appendChild(note);
    }

    return wrapper;
}

async function confirmDeleteTenantUser(user) {
    const tenantId = String(currentSelectedTenantId || currentTenantDetail?.tenant?.id || '').trim().toLowerCase();
    const userId = Number(user?.id);
    if (!tenantId || !Number.isInteger(userId) || userId <= 0) {
        showNotification('No pudimos identificar el usuario a eliminar.', 'error');
        return;
    }

    let impact;
    try {
        impact = await api.getWebUserDeleteImpact(userId);
    } catch (error) {
        showNotification(error?.message || 'No pudimos calcular el impacto del borrado del usuario.', 'error');
        return;
    }

    openActionConfirmModal({
        title: `Eliminar ${user?.username || `usuario #${userId}`}`,
        subtitle: 'Esta accion elimina el usuario web, invalida sus sesiones y desvincula su tecnico asociado si existe.',
        fields: createDeleteImpactSummaryNode(
            'Impacto previsto',
            [
                { label: 'Sesiones a invalidar', value: impact?.impact?.sessions_invalidated ?? 1 },
                { label: 'Vinculos con tecnico a desvincular', value: impact?.impact?.technician_links_to_clear ?? 0 },
                { label: 'Tokens de dispositivo a revocar', value: impact?.impact?.device_tokens_to_revoke ?? 0 },
            ],
            'El usuario se elimina de forma definitiva y la accion queda registrada en auditoria.',
        ),
        submitLabel: 'Eliminar usuario',
        acknowledgementText: `Confirmo eliminar a ${user?.username || `usuario #${userId}`}.`,
        missingConfirmationMessage: 'Debes confirmar la eliminacion del usuario.',
        onSubmit: async () => {
            await api.deleteWebUser(userId);
            closeActionModal(true);
            showNotification(`Usuario ${user?.username || `#${userId}`} eliminado.`, 'success');
            await Promise.all([
                loadTenantsSection({ silent: true }),
                selectTenantDetail(tenantId, { silent: true }),
                loadTechniciansSection({ silent: true, refreshAssignments: true }),
            ]);
        },
    });
}

async function confirmDeleteTenant(tenant = null) {
    const targetTenant = tenant || currentTenantDetail?.tenant || null;
    const tenantId = String(targetTenant?.id || '').trim().toLowerCase();
    if (!tenantId) {
        showNotification('Selecciona un tenant primero.', 'warning');
        return;
    }

    let impact;
    try {
        impact = await api.getTenantDeleteImpact(tenantId);
    } catch (error) {
        showNotification(error?.message || 'No pudimos calcular el impacto del borrado del tenant.', 'error');
        return;
    }

    const deletedTables = impact?.impact?.deleted_tables || {};
    const totalRows = Number(impact?.impact?.total_rows || 0);
    const knownRows = Number(deletedTables.web_users || 0)
        + Number(deletedTables.technicians || 0)
        + Number(deletedTables.installations || 0)
        + Number(deletedTables.incidents || 0);

    openActionConfirmModal({
        title: `Eliminar tenant ${targetTenant?.name || tenantId}`,
        subtitle: 'Se eliminaran el tenant y todos sus datos asociados por tenant_id. Esta accion no se puede deshacer.',
        fields: createDeleteImpactSummaryNode(
            'Impacto previsto',
            [
                { label: 'Usuarios web', value: deletedTables.web_users ?? 0 },
                { label: 'Tecnicos', value: deletedTables.technicians ?? 0 },
                { label: 'Instalaciones', value: deletedTables.installations ?? 0 },
                { label: 'Incidencias', value: deletedTables.incidents ?? 0 },
                { label: 'Otros registros tenant-scoped', value: Math.max(0, totalRows - knownRows) },
                { label: 'Total estimado de filas', value: totalRows },
            ],
            'Se eliminara el tenant y todos los datos asociados por tenant_id. La accion queda registrada en auditoria.',
        ),
        submitLabel: 'Eliminar tenant',
        acknowledgementText: `Confirmo eliminar el tenant ${targetTenant?.name || tenantId}.`,
        missingConfirmationMessage: 'Debes confirmar la eliminacion del tenant.',
        onSubmit: async () => {
            await api.deleteTenant(tenantId);
            closeActionModal(true);
            showNotification(`Tenant ${targetTenant?.name || tenantId} eliminado.`, 'success');
            if (String(currentSelectedTenantId || '') === tenantId) {
                currentSelectedTenantId = null;
                currentTenantDetail = null;
                currentTenantUsersData = [];
            }
            await loadTenantsSection({ silent: true });
            renderTenantDetail();
        },
    });
}

function renderTenantDetail() {
    const detailEl = document.getElementById('tenantDetail');
    const editBtn = document.getElementById('tenantsEditBtn');
    const deleteBtn = document.getElementById('tenantsDeleteBtn');
    if (!detailEl || !editBtn || !deleteBtn) return;

    if (!hasActiveSession()) {
        detailEl.innerHTML = '<p class="settings-empty-state">Inicia sesiÃ³n para ver detalle de tenants.</p>';
        editBtn.disabled = true;
        deleteBtn.disabled = true;
        return;
    }

    if (!canCurrentUserManageTenants()) {
        detailEl.innerHTML = '<p class="settings-empty-state">Solo super admin puede gestionar tenants.</p>';
        editBtn.disabled = true;
        deleteBtn.disabled = true;
        return;
    }

    const tenant = currentTenantDetail?.tenant || null;
    if (!tenant) {
        detailEl.innerHTML = '<p class="settings-empty-state">Selecciona un tenant para ver su detalle.</p>';
        editBtn.disabled = true;
        deleteBtn.disabled = true;
        return;
    }

    editBtn.disabled = false;
    deleteBtn.disabled = String(tenant.id || '').trim().toLowerCase() === 'default';
    const latestUsage = currentTenantDetail?.latest_usage || null;
    const admins = Array.isArray(currentTenantDetail?.admins) ? currentTenantDetail.admins : [];
    const tenantUsers = Array.isArray(currentTenantUsersData) ? currentTenantUsersData : [];

    detailEl.replaceChildren();

    const metaGrid = document.createElement('div');
    metaGrid.className = 'asset-meta-grid';
    [
        ['Identificador', tenant.id || '-'],
        ['Slug', tenant.slug || '-'],
        ['Plan', tenant.plan_code || '-'],
        ['Estado', tenant.status || '-'],
        ['Usuarios', tenant.metrics?.users_count ?? 0],
        ['TÃ©cnicos', tenant.metrics?.technicians_count ?? 0],
        ['Registros', tenant.metrics?.installations_count ?? 0],
        ['Incidencias activas', tenant.metrics?.active_incidents_count ?? 0],
    ].forEach(([label, value]) => {
        const item = document.createElement('div');
        item.className = 'asset-meta-item';
        const small = document.createElement('small');
        small.textContent = label;
        const strong = document.createElement('strong');
        strong.textContent = String(value);
        item.append(small, strong);
        metaGrid.append(item);
    });
    detailEl.append(metaGrid);

    const adminsTitle = document.createElement('p');
    adminsTitle.className = 'settings-actions-note';
    adminsTitle.textContent = admins.length
        ? `Admins del tenant (${admins.length})`
        : 'Este tenant todavÃ­a no tiene admins dedicados.';
    detailEl.append(adminsTitle);

    if (admins.length) {
        const adminsList = document.createElement('div');
        adminsList.className = 'settings-assignment-list';
        admins.forEach((admin) => {
            const card = document.createElement('article');
            card.className = 'settings-assignment-card';
            const top = document.createElement('div');
            top.className = 'settings-assignment-top';
            const title = document.createElement('strong');
            title.className = 'settings-assignment-title';
            title.textContent = admin.username || `Usuario #${admin.id}`;
            const meta = document.createElement('small');
            meta.className = 'settings-assignment-meta';
            meta.textContent = [
                admin.role || 'admin',
                admin.is_active ? 'activo' : 'inactivo',
                admin.last_login_at ? `ultimo login ${formatDateTime(admin.last_login_at)}` : 'sin login',
            ].join(' Â· ');
            top.append(title, meta);
            card.append(top);
            adminsList.append(card);
        });
        detailEl.append(adminsList);
    }

    if (latestUsage) {
        const usageNote = document.createElement('p');
        usageNote.className = 'settings-actions-note';
        usageNote.textContent =
            `Uso mÃ¡s reciente (${latestUsage.usage_month}): ${latestUsage.users_count} usuarios, ` +
            `${latestUsage.incidents_count} incidencias, ${formatBytes(latestUsage.storage_bytes)}.`;
        detailEl.append(usageNote);
    }

    const usersSection = document.createElement('section');
    usersSection.className = 'settings-inline-panel';

    const usersHead = document.createElement('div');
    usersHead.className = 'settings-panel-head';

    const usersHeadingWrap = document.createElement('div');
    const usersHeading = document.createElement('h4');
    usersHeading.textContent = 'Usuarios web';
    const usersCopy = document.createElement('p');
    usersCopy.className = 'settings-panel-copy';
    usersCopy.textContent = 'Crea usuarios ya vinculados al tenant y ajusta rol o estado sin salir de esta vista.';
    usersHeadingWrap.append(usersHeading, usersCopy);

    const usersActions = document.createElement('div');
    usersActions.className = 'incident-actions settings-actions';
    const createUserBtn = document.createElement('button');
    createUserBtn.type = 'button';
    createUserBtn.className = 'btn-primary';
    createUserBtn.textContent = 'Crear usuario';
    createUserBtn.addEventListener('click', () => {
        openTenantUserCreateModal();
    });
    usersActions.append(createUserBtn);
    usersHead.append(usersHeadingWrap, usersActions);
    usersSection.append(usersHead);

    const usersSummary = document.createElement('p');
    usersSummary.className = 'settings-actions-note';
    usersSummary.textContent = tenantUsers.length
        ? `${tenantUsers.length} usuario(s) cargados en este tenant.`
        : 'Este tenant todavia no tiene usuarios web cargados.';
    usersSection.append(usersSummary);

    if (tenantUsers.length) {
        const usersList = document.createElement('div');
        usersList.className = 'settings-assignment-list';
        tenantUsers
            .slice()
            .sort((left, right) => String(left?.username || '').localeCompare(String(right?.username || ''), 'es'))
            .forEach((user) => {
                const card = document.createElement('article');
                card.className = 'settings-assignment-card';

                const top = document.createElement('div');
                top.className = 'settings-assignment-top';

                const copyWrap = document.createElement('div');
                copyWrap.className = 'settings-assignment-copy';
                const title = document.createElement('strong');
                title.className = 'settings-assignment-title';
                title.textContent = user.username || `Usuario #${user.id}`;
                const meta = document.createElement('small');
                meta.className = 'settings-assignment-meta';
                meta.textContent = [
                    user.role || 'viewer',
                    user.is_active ? 'activo' : 'inactivo',
                    user.last_login_at ? `ultimo login ${formatDateTime(user.last_login_at)}` : 'sin login',
                ].join(' Â· ');
                copyWrap.append(title, meta);

                const actions = document.createElement('div');
                actions.className = 'settings-technician-actions';
                const editUserBtn = document.createElement('button');
                editUserBtn.type = 'button';
                editUserBtn.className = 'btn-secondary';
                editUserBtn.textContent = 'Editar acceso';
                editUserBtn.addEventListener('click', () => {
                    openTenantUserEditModal(user);
                });
                const deleteUserBtn = document.createElement('button');
                deleteUserBtn.type = 'button';
                deleteUserBtn.className = 'btn-secondary';
                deleteUserBtn.textContent = 'Eliminar';
                deleteUserBtn.addEventListener('click', () => {
                    confirmDeleteTenantUser(user);
                });
                actions.append(editUserBtn, deleteUserBtn);

                top.append(copyWrap, actions);
                card.append(top);
                usersList.append(card);
            });
        usersSection.append(usersList);
    }

    detailEl.append(usersSection);
    repairTenantSectionMojibake(detailEl);
}

function renderTenantsSection() {
    const listEl = document.getElementById('tenantsList');
    const copyEl = document.getElementById('tenantsPermissionCopy');
    const createBtn = document.getElementById('tenantsCreateBtn');
    const navLink = document.getElementById('navTenantsLink')?.closest('li');
    const mobileBtn = document.getElementById('mobileNavTenantsBtn');
    const sectionEl = document.getElementById('tenantsSection');
    if (!listEl || !copyEl || !createBtn || !sectionEl) return;

    const canManage = canCurrentUserManageTenants();
    if (navLink) {
        navLink.hidden = !canManage;
    }
    if (mobileBtn) {
        mobileBtn.hidden = !canManage;
    }
    sectionEl.hidden = !canManage;

    if (!hasActiveSession()) {
        setTenantSummaryValue('tenantsTotal', '-');
        setTenantSummaryValue('tenantsActive', '-');
        setTenantSummaryValue('tenantsSuspended', '-');
        setTenantSummaryValue('tenantsUsers', '-');
        copyEl.textContent = 'Inicia sesiÃ³n como super admin para ver la administraciÃ³n de tenants.';
        listEl.innerHTML = '<p class="settings-empty-state">Inicia sesiÃ³n para ver tenants.</p>';
        createBtn.disabled = true;
        renderTenantDetail();
        return;
    }

    if (!canManage) {
        setTenantSummaryValue('tenantsTotal', '-');
        setTenantSummaryValue('tenantsActive', '-');
        setTenantSummaryValue('tenantsSuspended', '-');
        setTenantSummaryValue('tenantsUsers', '-');
        copyEl.textContent = 'Esta secciÃ³n queda reservada para super admin.';
        listEl.innerHTML = '<p class="settings-empty-state">Solo super admin puede administrar tenants.</p>';
        createBtn.disabled = true;
        renderTenantDetail();
        return;
    }

    createBtn.disabled = false;
    copyEl.textContent = 'Administra empresas, planes, estado operativo y admins iniciales desde una sola consola.';

    const tenants = Array.isArray(currentTenantsData) ? currentTenantsData : [];
    setTenantSummaryValue('tenantsTotal', tenants.length);
    setTenantSummaryValue('tenantsActive', tenants.filter((tenant) => tenant?.status === 'active').length);
    setTenantSummaryValue('tenantsSuspended', tenants.filter((tenant) => tenant?.status === 'suspended').length);
    setTenantSummaryValue(
        'tenantsUsers',
        tenants.reduce((sum, tenant) => sum + (Number(tenant?.metrics?.users_count || 0) || 0), 0),
    );

    if (!tenants.length) {
        listEl.innerHTML = '<p class="settings-empty-state">TodavÃ­a no hay tenants cargados.</p>';
        renderTenantDetail();
        return;
    }

    listEl.replaceChildren();
    tenants.forEach((tenant) => {
        const card = document.createElement('article');
        card.className = 'settings-technician-card';
        if (String(currentSelectedTenantId || '') === String(tenant.id || '')) {
            card.classList.add('is-selected');
        }

        const head = document.createElement('div');
        head.className = 'settings-technician-head';
        const titleWrap = document.createElement('div');
        titleWrap.className = 'settings-technician-title';
        const title = document.createElement('h4');
        title.textContent = tenant.name || tenant.id || 'Tenant';
        const subtitle = document.createElement('p');
        subtitle.className = 'settings-technician-subtitle';
        subtitle.textContent = [
            tenant.id || '-',
            tenant.plan_code || 'starter',
            Array.isArray(tenant.admin_usernames) && tenant.admin_usernames.length
                ? tenant.admin_usernames.join(', ')
                : 'Sin admins visibles',
        ].join(' Â· ');
        titleWrap.append(title, subtitle);

        const chips = document.createElement('div');
        chips.className = 'settings-technician-chips';
        const statusChip = document.createElement('span');
        statusChip.className = `settings-chip${tenant.status === 'active' ? '' : ' is-muted'}`;
        statusChip.textContent = tenant.status === 'active' ? 'Activo' : 'Suspendido';
        chips.append(statusChip);
        head.append(titleWrap, chips);
        card.append(head);

        const meta = document.createElement('div');
        meta.className = 'asset-meta-grid';
        [
            ['Usuarios', tenant.metrics?.users_count ?? 0],
            ['TÃ©cnicos', tenant.metrics?.technicians_count ?? 0],
            ['Registros', tenant.metrics?.installations_count ?? 0],
            ['Incidencias activas', tenant.metrics?.active_incidents_count ?? 0],
        ].forEach(([label, value]) => {
            const item = document.createElement('div');
            item.className = 'asset-meta-item';
            const small = document.createElement('small');
            small.textContent = label;
            const strong = document.createElement('strong');
            strong.textContent = String(value);
            item.append(small, strong);
            meta.append(item);
        });
        card.append(meta);

        const actions = document.createElement('div');
        actions.className = 'settings-technician-actions';
        const detailBtn = document.createElement('button');
        detailBtn.type = 'button';
        detailBtn.className = 'btn-secondary';
        detailBtn.textContent = 'Ver detalle';
        detailBtn.addEventListener('click', () => {
            void selectTenantDetail(tenant.id);
        });
        actions.append(detailBtn);
        card.append(actions);

        listEl.append(card);
    });

    repairTenantSectionMojibake(listEl);
    renderTenantDetail();
}

function buildTechnicianAssignmentEntityKey(entityType, entityId) {
    const normalizedType = String(entityType || '').trim().toLowerCase();
    const normalizedId = String(entityId || '').trim();
    if (!normalizedType || !normalizedId) return '';
    return `${normalizedType}:${normalizedId}`;
}

function updateTechniciansPermissionCopy() {
    const copyEl = document.getElementById('settingsTechniciansPermissions');
    const createBtn = document.getElementById('settingsCreateTechnicianBtn');
    if (!copyEl || !createBtn) return;

    if (!hasActiveSession()) {
        copyEl.textContent = 'Inicia sesión para gestionar el staff técnico del tenant activo.';
        createBtn.disabled = true;
        return;
    }

    if (canCurrentUserManageTechnicians()) {
        copyEl.textContent = 'Puedes crear, editar, activar o desactivar técnicos. Las asignaciones quedan auditadas por tenant.';
        createBtn.disabled = false;
        return;
    }

    if (canCurrentUserManageTechnicianAssignments()) {
        copyEl.textContent = 'Puedes consultar técnicos y gestionar sus asignaciones operativas, pero no crear ni editar su ficha.';
        createBtn.disabled = true;
        return;
    }

    copyEl.textContent = 'Tienes acceso de consulta sobre el staff técnico del tenant.';
    createBtn.disabled = true;
}

function setTechnicianSummaryValue(id, value) {
    const node = document.getElementById(id);
    if (node) {
        node.textContent = String(value ?? '-');
    }
}

function renderTechniciansSection() {
    const listEl = document.getElementById('settingsTechniciansList');
    if (!listEl) return;

    updateTechniciansPermissionCopy();

    if (!hasActiveSession()) {
        setTechnicianSummaryValue('settingsTechniciansTotal', '-');
        setTechnicianSummaryValue('settingsTechniciansActive', '-');
        setTechnicianSummaryValue('settingsTechniciansLinked', '-');
        setTechnicianSummaryValue('settingsTechniciansAssignments', '-');
        listEl.innerHTML = '<p class="loading">Inicia sesión para ver técnicos.</p>';
        return;
    }

    const technicians = Array.isArray(currentTechniciansData) ? currentTechniciansData : [];
    const activeCount = technicians.filter((item) => item && item.is_active).length;
    const linkedCount = technicians.filter((item) => Number.isInteger(parseStrictInteger(item?.web_user_id))).length;
    const assignmentsCount = technicians.reduce((sum, item) => sum + (Number(item?.active_assignment_count || 0) || 0), 0);

    setTechnicianSummaryValue('settingsTechniciansTotal', technicians.length);
    setTechnicianSummaryValue('settingsTechniciansActive', activeCount);
    setTechnicianSummaryValue('settingsTechniciansLinked', linkedCount);
    setTechnicianSummaryValue('settingsTechniciansAssignments', assignmentsCount);

    if (!technicians.length) {
        listEl.innerHTML = '<p class="settings-empty-state">Todavía no hay técnicos cargados para este tenant.</p>';
        return;
    }

    listEl.replaceChildren();

    technicians.forEach((technician) => {
        const card = document.createElement('article');
        card.className = 'settings-technician-card';

        const head = document.createElement('div');
        head.className = 'settings-technician-head';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'settings-technician-title';
        const title = document.createElement('h4');
        title.textContent = technician.display_name || `Técnico #${technician.id}`;
        const subtitle = document.createElement('p');
        subtitle.className = 'settings-technician-subtitle';
        const subtitleParts = [
            technician.employee_code ? `Código ${technician.employee_code}` : 'Sin código interno',
            getTechnicianLinkedWebUserLabel(technician),
        ];
        subtitle.textContent = subtitleParts.join(' · ');
        titleWrap.append(title, subtitle);

        const chips = document.createElement('div');
        chips.className = 'settings-technician-chips';

        const statusChip = document.createElement('span');
        statusChip.className = `settings-chip${technician.is_active ? '' : ' is-muted'}`;
        statusChip.textContent = technician.is_active ? 'Activo' : 'Inactivo';
        chips.append(statusChip);

        if (technician.active_assignment_count > 0) {
            const assignmentChip = document.createElement('span');
            assignmentChip.className = 'settings-chip';
            assignmentChip.textContent = `${technician.active_assignment_count} asignación${technician.active_assignment_count === 1 ? '' : 'es'}`;
            chips.append(assignmentChip);
        }

        head.append(titleWrap, chips);

        const meta = document.createElement('div');
        meta.className = 'asset-meta-grid';
        const fields = [
            ['Email', technician.email || 'No informado'],
            ['Teléfono', technician.phone || 'No informado'],
            ['Notas', technician.notes || 'Sin notas operativas'],
        ];
        fields.forEach(([label, value]) => {
            const item = document.createElement('div');
            item.className = 'asset-meta-item';
            const small = document.createElement('small');
            small.textContent = label;
            const strong = document.createElement('strong');
            strong.textContent = value;
            item.append(small, strong);
            meta.append(item);
        });

        const actions = document.createElement('div');
        actions.className = 'settings-technician-actions';

        const assignmentsToggleBtn = document.createElement('button');
        assignmentsToggleBtn.type = 'button';
        assignmentsToggleBtn.className = 'btn-secondary';
        assignmentsToggleBtn.textContent = expandedTechnicianAssignmentPanels.has(technician.id)
            ? 'Ocultar asignaciones'
            : 'Ver asignaciones';
        assignmentsToggleBtn.addEventListener('click', () => {
            if (expandedTechnicianAssignmentPanels.has(technician.id)) {
                expandedTechnicianAssignmentPanels.delete(technician.id);
                renderTechniciansSection();
                return;
            }
            expandedTechnicianAssignmentPanels.add(technician.id);
            void loadTechnicianAssignments(technician.id, { force: false, silent: true });
        });
        actions.append(assignmentsToggleBtn);

        if (canCurrentUserManageTechnicianAssignments()) {
            const assignBtn = document.createElement('button');
            assignBtn.type = 'button';
            assignBtn.className = 'btn-secondary';
            assignBtn.textContent = 'Asignar';
            assignBtn.addEventListener('click', () => {
                openTechnicianAssignmentModal(technician);
            });
            actions.append(assignBtn);
        }

        if (canCurrentUserManageTechnicians()) {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'btn-secondary';
            editBtn.textContent = 'Editar';
            editBtn.addEventListener('click', () => {
                openTechnicianEditorModal(technician);
            });
            actions.append(editBtn);

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = technician.is_active ? 'btn-secondary' : 'btn-primary';
            toggleBtn.textContent = technician.is_active ? 'Desactivar' : 'Activar';
            toggleBtn.addEventListener('click', async () => {
                try {
                    await api.updateTechnician(technician.id, {
                        is_active: !technician.is_active,
                    });
                    showNotification(
                        technician.is_active
                            ? `Técnico ${technician.display_name} desactivado.`
                            : `Técnico ${technician.display_name} reactivado.`,
                        technician.is_active ? 'info' : 'success',
                    );
                    await loadTechniciansSection({ silent: true });
                } catch (error) {
                    showNotification(`No se pudo actualizar el técnico: ${error?.message || error}`, 'error');
                }
            });
            actions.append(toggleBtn);
        }

        card.append(head, meta, actions);

        if (expandedTechnicianAssignmentPanels.has(technician.id)) {
            const assignmentsWrap = document.createElement('div');
            assignmentsWrap.className = 'settings-technician-assignments';
            const cachedAssignments = technicianAssignmentsByTechnicianId.get(technician.id);

            if (cachedAssignments === 'loading') {
                const loading = document.createElement('p');
                loading.className = 'loading';
                loading.textContent = 'Cargando asignaciones...';
                assignmentsWrap.append(loading);
            } else {
                const items = Array.isArray(cachedAssignments) ? cachedAssignments : [];
                if (!items.length) {
                    const empty = document.createElement('p');
                    empty.className = 'settings-empty-state';
                    empty.textContent = 'Sin asignaciones activas para este técnico.';
                    assignmentsWrap.append(empty);
                } else {
                    const list = document.createElement('div');
                    list.className = 'settings-assignment-list';
                    items.forEach((assignment) => {
                        const assignmentCard = document.createElement('div');
                        assignmentCard.className = 'settings-assignment-card';

                        const top = document.createElement('div');
                        top.className = 'settings-assignment-top';
                        const textWrap = document.createElement('div');
                        const assignmentTitle = document.createElement('p');
                        assignmentTitle.className = 'settings-assignment-title';
                        const entityLabel = TECHNICIAN_ENTITY_LABELS[assignment.entity_type] || assignment.entity_type;
                        assignmentTitle.textContent = `${entityLabel} ${assignment.entity_id}`;
                        const assignmentMeta = document.createElement('p');
                        assignmentMeta.className = 'settings-assignment-meta';
                        const roleLabel = TECHNICIAN_ASSIGNMENT_ROLE_LABELS[assignment.assignment_role] || assignment.assignment_role;
                        assignmentMeta.textContent = `${roleLabel} · asignado por ${assignment.assigned_by_username || 'sistema'}`;
                        textWrap.append(assignmentTitle, assignmentMeta);
                        top.append(textWrap);

                        if (canCurrentUserManageTechnicianAssignments()) {
                            const removeBtn = document.createElement('button');
                            removeBtn.type = 'button';
                            removeBtn.className = 'btn-secondary';
                            removeBtn.textContent = 'Quitar';
                            removeBtn.addEventListener('click', async () => {
                                const confirmed = window.confirm(`¿Quitar la asignación ${entityLabel} ${assignment.entity_id}?`);
                                if (!confirmed) return;
                                try {
                                    await api.deleteTechnicianAssignment(assignment.id);
                                    showNotification('Asignación removida.', 'success');
                                    await loadTechnicianAssignments(technician.id, { force: true, silent: true });
                                } catch (error) {
                                    showNotification(`No se pudo quitar la asignación: ${error?.message || error}`, 'error');
                                }
                            });
                            top.append(removeBtn);
                        }

                        assignmentCard.append(top);
                        list.append(assignmentCard);
                    });
                    assignmentsWrap.append(list);
                }
            }

            card.append(assignmentsWrap);
        }

        listEl.append(card);
    });
}

async function loadTechnicianAssignments(technicianId, options = {}) {
    const force = options?.force === true;
    const silent = options?.silent === true;
    if (!Number.isInteger(parseStrictInteger(technicianId))) return [];

    if (!force && Array.isArray(technicianAssignmentsByTechnicianId.get(technicianId))) {
        renderTechniciansSection();
        return technicianAssignmentsByTechnicianId.get(technicianId) || [];
    }

    technicianAssignmentsByTechnicianId.set(technicianId, 'loading');
    renderTechniciansSection();

    try {
        const result = await api.getTechnicianAssignments(technicianId, {
            includeInactive: false,
        });
        const assignments = Array.isArray(result?.assignments) ? result.assignments : [];
        technicianAssignmentsByTechnicianId.set(technicianId, assignments);
        renderTechniciansSection();
        return assignments;
    } catch (error) {
        technicianAssignmentsByTechnicianId.delete(technicianId);
        renderTechniciansSection();
        if (!silent) {
            showNotification(`No se pudieron cargar las asignaciones: ${error?.message || error}`, 'error');
        }
        return [];
    }
}

async function loadTechnicianAssignmentsForEntity(entityType, entityId, options = {}) {
    const key = buildTechnicianAssignmentEntityKey(entityType, entityId);
    if (!key) {
        return [];
    }

    const force = options?.force === true;
    const silent = options?.silent === true;
    const cached = technicianAssignmentsByEntityKey.get(key);
    if (!force) {
        if (Array.isArray(cached)) {
            return cached;
        }
        if (cached && typeof cached.then === 'function') {
            return cached;
        }
    }

    const includeInactive = options?.includeInactive === true;
    const pendingRequest = api.getTechnicianAssignmentsByEntity(entityType, entityId, {
        includeInactive,
    }).then((result) => {
        const assignments = Array.isArray(result?.assignments) ? result.assignments : [];
        technicianAssignmentsByEntityKey.set(key, assignments);
        return assignments;
    }).catch((error) => {
        technicianAssignmentsByEntityKey.delete(key);
        if (!silent) {
            showNotification(`No se pudieron cargar las asignaciones operativas: ${error?.message || error}`, 'error');
        }
        return [];
    });

    technicianAssignmentsByEntityKey.set(key, pendingRequest);
    return pendingRequest;
}

function getTechnicianLoadSummary() {
    const technicians = Array.isArray(currentTechniciansData) ? currentTechniciansData : [];
    const activeTechnicians = technicians.filter((item) => item && item.is_active);
    const rankedItems = [...activeTechnicians]
        .sort((left, right) => {
            const byAssignments = Number(right?.active_assignment_count || 0) - Number(left?.active_assignment_count || 0);
            if (byAssignments !== 0) return byAssignments;
            return String(left?.display_name || '').localeCompare(String(right?.display_name || ''), 'es');
        })
        .slice(0, 4)
        .map((item) => ({
            id: Number(item.id),
            display_name: String(item.display_name || '').trim() || `Técnico #${item.id}`,
            employee_code: String(item.employee_code || '').trim(),
            active_assignment_count: Math.max(0, Number(item.active_assignment_count) || 0),
            linked_web_user: Number.isInteger(parseStrictInteger(item?.web_user_id)),
        }));

    return {
        total: technicians.length,
        active: activeTechnicians.length,
        linked: activeTechnicians.filter((item) => Number.isInteger(parseStrictInteger(item?.web_user_id))).length,
        items: rankedItems,
    };
}

function getWebUserMap() {
    const map = new Map();
    (Array.isArray(currentWebUsersData) ? currentWebUsersData : []).forEach((user) => {
        const userId = Number(user?.id);
        if (Number.isInteger(userId) && userId > 0) {
            map.set(userId, user);
        }
    });
    return map;
}

function getTechnicianLinkedWebUserLabel(technician) {
    const webUserId = Number(technician?.web_user_id);
    if (!Number.isInteger(webUserId) || webUserId <= 0) {
        return 'Sin usuario vinculado';
    }

    const linkedUser = getWebUserMap().get(webUserId);
    if (!linkedUser) {
        return `Usuario #${webUserId}`;
    }

    const username = String(linkedUser.username || '').trim() || `Usuario #${webUserId}`;
    const role = String(linkedUser.role || '').trim();
    const activeSuffix = linkedUser.is_active === false ? ' · inactivo' : '';
    return role ? `${username} · ${role}${activeSuffix}` : `${username}${activeSuffix}`;
}

function getSelectableWebUsersForTechnician(technician = null) {
    const currentTechnicianId = Number(technician?.id);
    const linkedUserIds = new Set(
        (Array.isArray(currentTechniciansData) ? currentTechniciansData : [])
            .filter((item) => Number(item?.id) !== currentTechnicianId)
            .map((item) => Number(item?.web_user_id))
            .filter((userId) => Number.isInteger(userId) && userId > 0),
    );

    return (Array.isArray(currentWebUsersData) ? currentWebUsersData : [])
        .filter((user) => {
            const userId = Number(user?.id);
            return Number.isInteger(userId) && userId > 0 && !linkedUserIds.has(userId);
        })
        .sort((left, right) => String(left?.username || '').localeCompare(String(right?.username || ''), 'es'));
}

async function loadWebUsersForTechnicians(options = {}) {
    if (!hasActiveSession() || !canCurrentUserManageTechnicians()) {
        currentWebUsersData = [];
        return [];
    }

    const silent = options?.silent === true;
    try {
        const users = [];
        let nextCursor = null;

        do {
            const response = await api.getWebUsers({
                limit: 500,
                cursor: nextCursor || undefined,
            });
            const pageUsers = Array.isArray(response?.users) ? response.users : [];
            users.push(...pageUsers);
            nextCursor = response?.pagination?.has_more ? response?.pagination?.next_cursor || null : null;
        } while (nextCursor);

        currentWebUsersData = users;
        return currentWebUsersData;
    } catch (error) {
        currentWebUsersData = [];
        if (!silent) {
            showNotification(`No se pudo cargar la lista de usuarios web: ${error?.message || error}`, 'error');
        }
        return [];
    }
}

async function loadTechniciansSection(options = {}) {
    if (!hasActiveSession()) {
        resetTechniciansState();
        return [];
    }

    const silent = options?.silent === true;
    const refreshAssignments = options?.refreshAssignments === true;
    const expandedIds = Array.from(expandedTechnicianAssignmentPanels);

    try {
        const [result] = await Promise.all([
            api.getTechnicians({
                includeInactive: canCurrentUserManageTechnicians(),
            }),
            loadWebUsersForTechnicians({ silent: true }),
        ]);
        currentTechniciansData = Array.isArray(result?.technicians) ? result.technicians : [];
        renderTechniciansSection();
        dashboardOverview?.renderTechnicianLoadAttention?.();

        if (refreshAssignments && expandedIds.length) {
            await Promise.all(expandedIds.map((technicianId) =>
                loadTechnicianAssignments(technicianId, { force: true, silent: true })));
        }
        return currentTechniciansData;
    } catch (error) {
        currentTechniciansData = [];
        renderTechniciansSection();
        dashboardOverview?.renderTechnicianLoadAttention?.();
        if (!silent) {
            showNotification(`No se pudo cargar la gestión de técnicos: ${error?.message || error}`, 'error');
        }
        return [];
    }
}

async function selectTenantDetail(tenantId, options = {}) {
    if (!hasActiveSession() || !canCurrentUserManageTenants()) {
        currentSelectedTenantId = null;
        currentTenantDetail = null;
        currentTenantUsersData = [];
        renderTenantsSection();
        return null;
    }

    const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
    if (!normalizedTenantId) return null;

    try {
        const [response] = await Promise.all([
            api.getTenant(normalizedTenantId),
            loadTenantUsers(normalizedTenantId, { silent: options?.silent === true }),
        ]);
        currentSelectedTenantId = normalizedTenantId;
        currentTenantDetail = response || null;
        renderTenantsSection();
        return currentTenantDetail;
    } catch (error) {
        if (options?.silent !== true) {
            showNotification(`No se pudo cargar el detalle del tenant: ${error?.message || error}`, 'error');
        }
        currentTenantDetail = null;
        currentTenantUsersData = [];
        renderTenantsSection();
        return null;
    }
}

async function loadTenantsSection(options = {}) {
    if (!hasActiveSession() || !canCurrentUserManageTenants()) {
        resetTenantsState();
        return [];
    }

    const silent = options?.silent === true;
    try {
        const response = await api.getTenants();
        currentTenantsData = Array.isArray(response?.tenants) ? response.tenants : [];

        if (!currentTenantsData.length) {
            currentSelectedTenantId = null;
            currentTenantDetail = null;
            renderTenantsSection();
            return [];
        }

        const nextTenantId = currentTenantsData.some((tenant) => String(tenant?.id) === String(currentSelectedTenantId))
            ? currentSelectedTenantId
            : String(currentTenantsData[0]?.id || '').trim();

        renderTenantsSection();
        if (nextTenantId) {
            await selectTenantDetail(nextTenantId, { silent: true });
        }
        return currentTenantsData;
    } catch (error) {
        currentTenantsData = [];
        currentSelectedTenantId = null;
        currentTenantDetail = null;
        renderTenantsSection();
        if (!silent) {
            showNotification(`No se pudo cargar tenants: ${error?.message || error}`, 'error');
        }
        return [];
    }
}

function buildTenantModalFields(tenant = null) {
    const fragment = document.createDocumentFragment();
    const grid = document.createElement('div');
    grid.className = 'action-modal-grid';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = 'actionTenantName';
    nameInput.value = String(tenant?.name || '');
    nameInput.placeholder = 'Ej: Acme Uruguay';
    grid.append(createModalInputGroup('Nombre', nameInput, { htmlFor: nameInput.id }));

    const slugInput = document.createElement('input');
    slugInput.type = 'text';
    slugInput.id = 'actionTenantSlug';
    slugInput.value = String(tenant?.slug || tenant?.id || '');
    slugInput.placeholder = 'Ej: acme-uy';
    grid.append(createModalInputGroup('Slug / identificador', slugInput, { htmlFor: slugInput.id }));

    const planInput = document.createElement('input');
    planInput.type = 'text';
    planInput.id = 'actionTenantPlanCode';
    planInput.value = String(tenant?.plan_code || 'starter');
    planInput.placeholder = 'starter';
    grid.append(createModalInputGroup('Plan', planInput, { htmlFor: planInput.id }));

    const statusSelect = document.createElement('select');
    statusSelect.id = 'actionTenantStatus';
    [
        ['active', 'Activo'],
        ['suspended', 'Suspendido'],
    ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        if (String(tenant?.status || 'active') === value) {
            option.selected = true;
        }
        statusSelect.append(option);
    });
    grid.append(createModalInputGroup('Estado', statusSelect, { htmlFor: statusSelect.id }));

    fragment.append(grid);
    return fragment;
}

function openTenantEditorModal(tenant = null) {
    if (!canCurrentUserManageTenants()) {
        showNotification('Solo super admin puede editar tenants.', 'error');
        return;
    }

    openActionModal({
        title: tenant ? `Editar tenant ${tenant.name || tenant.id}` : 'Nuevo tenant',
        subtitle: tenant
            ? 'Ajusta nombre, slug, estado y plan del tenant.'
            : 'Crea un tenant para una nueva empresa dentro de la plataforma.',
        submitLabel: tenant ? 'Guardar tenant' : 'Crear tenant',
        focusId: 'actionTenantName',
        fields: buildTenantModalFields(tenant),
        onSubmit: async () => {
            const payload = {
                name: String(document.getElementById('actionTenantName')?.value || '').trim(),
                slug: String(document.getElementById('actionTenantSlug')?.value || '').trim(),
                plan_code: String(document.getElementById('actionTenantPlanCode')?.value || '').trim(),
                status: String(document.getElementById('actionTenantStatus')?.value || 'active').trim(),
            };

            if (!payload.name || !payload.slug) {
                setActionModalError('Nombre y slug son obligatorios.');
                return;
            }

            if (tenant?.id) {
                await api.updateTenant(tenant.id, payload);
                closeActionModal(true);
                showNotification(`Tenant ${payload.name} actualizado.`, 'success');
            } else {
                const created = await api.createTenant(payload);
                closeActionModal(true);
                showNotification(`Tenant ${payload.name} creado.`, 'success');
                currentSelectedTenantId = String(created?.tenant?.id || payload.slug || '').trim().toLowerCase() || currentSelectedTenantId;
            }

            await loadTenantsSection({ silent: true });
        },
    });
}

function buildTechnicianModalFields(technician = null) {
    const fragment = document.createDocumentFragment();
    const grid = document.createElement('div');
    grid.className = 'action-modal-grid';

    const displayNameInput = document.createElement('input');
    displayNameInput.type = 'text';
    displayNameInput.id = 'actionTechnicianDisplayName';
    displayNameInput.value = String(technician?.display_name || '');
    displayNameInput.placeholder = 'Ej: Luis Rivera';
    grid.append(createModalInputGroup('Nombre visible', displayNameInput, { htmlFor: displayNameInput.id }));

    const employeeCodeInput = document.createElement('input');
    employeeCodeInput.type = 'text';
    employeeCodeInput.id = 'actionTechnicianEmployeeCode';
    employeeCodeInput.value = String(technician?.employee_code || '');
    employeeCodeInput.placeholder = 'Ej: TEC-09';
    grid.append(createModalInputGroup('Código interno', employeeCodeInput, { htmlFor: employeeCodeInput.id }));

    const webUserSelect = document.createElement('select');
    webUserSelect.id = 'actionTechnicianWebUserId';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'Sin usuario vinculado';
    webUserSelect.append(emptyOption);
    getSelectableWebUsersForTechnician(technician).forEach((user) => {
        const option = document.createElement('option');
        option.value = String(user.id);
        const role = String(user.role || '').trim();
        const activeSuffix = user.is_active === false ? ' · inactivo' : '';
        option.textContent = role
            ? `${user.username} · ${role}${activeSuffix}`
            : `${user.username}${activeSuffix}`;
        if (Number(user.id) === Number(technician?.web_user_id)) {
            option.selected = true;
        }
        webUserSelect.append(option);
    });
    grid.append(createModalInputGroup('Usuario web vinculado', webUserSelect, { htmlFor: webUserSelect.id }));

    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.id = 'actionTechnicianEmail';
    emailInput.value = String(technician?.email || '');
    emailInput.placeholder = 'correo@empresa.com';
    grid.append(createModalInputGroup('Email', emailInput, { htmlFor: emailInput.id }));

    const phoneInput = document.createElement('input');
    phoneInput.type = 'text';
    phoneInput.id = 'actionTechnicianPhone';
    phoneInput.value = String(technician?.phone || '');
    phoneInput.placeholder = '099 000 111';
    grid.append(createModalInputGroup('Teléfono', phoneInput, { htmlFor: phoneInput.id }));

    const notesInput = document.createElement('textarea');
    notesInput.id = 'actionTechnicianNotes';
    notesInput.rows = 4;
    notesInput.value = String(technician?.notes || '');
    notesInput.placeholder = 'Notas operativas o contexto del técnico';
    fragment.append(grid, createModalInputGroup('Notas', notesInput, { htmlFor: notesInput.id }));
    return fragment;
}

function openTechnicianEditorModal(technician = null) {
    if (!canCurrentUserManageTechnicians()) {
        showNotification('No tienes permisos para editar técnicos.', 'error');
        return;
    }

    const openModal = () => openActionModal({
        title: technician ? `Editar técnico #${technician.id}` : 'Nuevo técnico',
        subtitle: technician
            ? 'Ajusta la ficha operativa del técnico dentro del tenant actual.'
            : 'Crea un técnico reutilizable para asignaciones operativas.',
        submitLabel: technician ? 'Guardar cambios' : 'Crear técnico',
        focusId: 'actionTechnicianDisplayName',
        fields: buildTechnicianModalFields(technician),
        onSubmit: async () => {
            const displayName = String(document.getElementById('actionTechnicianDisplayName')?.value || '').trim();
            const employeeCode = String(document.getElementById('actionTechnicianEmployeeCode')?.value || '').trim();
            const email = String(document.getElementById('actionTechnicianEmail')?.value || '').trim();
            const phone = String(document.getElementById('actionTechnicianPhone')?.value || '').trim();
            const notes = String(document.getElementById('actionTechnicianNotes')?.value || '').trim();
            const rawWebUserId = String(document.getElementById('actionTechnicianWebUserId')?.value || '').trim();
            const webUserId = parseStrictInteger(rawWebUserId);

            if (!displayName) {
                setActionModalError('El nombre visible es obligatorio.');
                return;
            }

            const payload = {
                display_name: displayName,
                employee_code: employeeCode,
                email,
                phone,
                notes,
                web_user_id: Number.isInteger(webUserId) && webUserId > 0 ? webUserId : null,
            };

            if (technician?.id) {
                await api.updateTechnician(technician.id, payload);
                closeActionModal(true);
                showNotification(`Técnico ${displayName} actualizado.`, 'success');
            } else {
                await api.createTechnician(payload);
                closeActionModal(true);
                showNotification(`Técnico ${displayName} creado.`, 'success');
            }

            await loadTechniciansSection({ silent: true, refreshAssignments: true });
        },
    });

    if (!currentWebUsersData.length) {
        void loadWebUsersForTechnicians({ silent: false }).then(() => {
            openModal();
        });
        return;
    }

    openModal();
}

function buildTechnicianAssignmentModalFields(technician) {
    const fragment = document.createDocumentFragment();
    const grid = document.createElement('div');
    grid.className = 'action-modal-grid';

    const entityTypeSelect = document.createElement('select');
    entityTypeSelect.id = 'actionTechnicianAssignmentEntityType';
    [
        ['installation', 'Registro'],
        ['incident', 'Incidencia'],
        ['asset', 'Equipo'],
        ['zone', 'Zona'],
    ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        entityTypeSelect.append(option);
    });
    grid.append(createModalInputGroup('Entidad', entityTypeSelect, { htmlFor: entityTypeSelect.id }));

    const entityIdInput = document.createElement('input');
    entityIdInput.type = 'text';
    entityIdInput.id = 'actionTechnicianAssignmentEntityId';
    entityIdInput.placeholder = 'Ej: 45 o zona-centro';
    grid.append(createModalInputGroup('ID entidad', entityIdInput, { htmlFor: entityIdInput.id }));

    const assignmentRoleSelect = document.createElement('select');
    assignmentRoleSelect.id = 'actionTechnicianAssignmentRole';
    [
        ['owner', 'Responsable'],
        ['assistant', 'Apoyo'],
        ['reviewer', 'Revisión'],
    ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        assignmentRoleSelect.append(option);
    });
    grid.append(createModalInputGroup('Rol asignado', assignmentRoleSelect, { htmlFor: assignmentRoleSelect.id }));

    const note = document.createElement('textarea');
    note.id = 'actionTechnicianAssignmentNote';
    note.rows = 3;
    note.placeholder = `Contexto de asignación para ${technician?.display_name || 'el técnico'} (opcional)`;
    fragment.append(grid, createModalInputGroup('Metadata', note, { htmlFor: note.id }));
    return fragment;
}

function openTechnicianAssignmentModal(technician) {
    if (!canCurrentUserManageTechnicianAssignments()) {
        showNotification('No tienes permisos para asignar técnicos.', 'error');
        return;
    }

    openActionModal({
        title: `Asignar ${technician?.display_name || 'técnico'}`,
        subtitle: 'Vincula este técnico a una entidad operativa del tenant.',
        submitLabel: 'Guardar asignación',
        focusId: 'actionTechnicianAssignmentEntityId',
        fields: buildTechnicianAssignmentModalFields(technician),
        onSubmit: async () => {
            const entityType = String(document.getElementById('actionTechnicianAssignmentEntityType')?.value || '').trim();
            const entityId = String(document.getElementById('actionTechnicianAssignmentEntityId')?.value || '').trim();
            const assignmentRole = String(document.getElementById('actionTechnicianAssignmentRole')?.value || 'owner').trim();
            const note = String(document.getElementById('actionTechnicianAssignmentNote')?.value || '').trim();

            if (!entityId) {
                setActionModalError('Debes indicar el identificador de la entidad.');
                return;
            }

            const payload = {
                entity_type: entityType,
                entity_id: entityType === 'zone' ? entityId : Number(entityId),
                assignment_role: assignmentRole,
                metadata_json: note ? { note } : undefined,
            };

            await api.createTechnicianAssignment(technician.id, payload);
            closeActionModal(true);
            expandedTechnicianAssignmentPanels.add(technician.id);
            showNotification(`Asignación guardada para ${technician.display_name}.`, 'success');
            await loadTechniciansSection({ silent: true, refreshAssignments: false });
            await loadTechnicianAssignments(technician.id, { force: true, silent: true });
        },
    });
}

function buildEntityTechnicianAssignmentFields(entityConfig = {}) {
    const fragment = document.createDocumentFragment();
    const grid = document.createElement('div');
    grid.className = 'action-modal-grid';

    const technicianSelect = document.createElement('select');
    technicianSelect.id = 'actionEntityAssignmentTechnicianId';
    technicianSelect.appendChild(new Option('Selecciona un técnico', ''));
    currentTechniciansData
        .filter((item) => item && item.is_active)
        .sort((left, right) => String(left.display_name || '').localeCompare(String(right.display_name || ''), 'es'))
        .forEach((technician) => {
            const label = technician.employee_code
                ? `${technician.display_name} · ${technician.employee_code}`
                : technician.display_name;
            technicianSelect.appendChild(new Option(label, String(technician.id)));
        });
    grid.append(createModalInputGroup('Técnico', technicianSelect, { htmlFor: technicianSelect.id }));

    const assignmentRoleSelect = document.createElement('select');
    assignmentRoleSelect.id = 'actionEntityAssignmentRole';
    [
        ['owner', 'Responsable'],
        ['assistant', 'Apoyo'],
        ['reviewer', 'Revisión'],
    ].forEach(([value, label]) => {
        assignmentRoleSelect.appendChild(new Option(label, value, value === entityConfig.defaultRole, value === entityConfig.defaultRole));
    });
    grid.append(createModalInputGroup('Rol asignado', assignmentRoleSelect, { htmlFor: assignmentRoleSelect.id }));

    const note = document.createElement('textarea');
    note.id = 'actionEntityAssignmentNote';
    note.rows = 3;
    note.placeholder = `Contexto de asignación para ${entityConfig.entityLabel || 'esta entidad'} (opcional)`;
    fragment.append(grid, createModalInputGroup('Metadata', note, { htmlFor: note.id }));
    return fragment;
}

async function openEntityTechnicianAssignmentModal(entityConfig = {}) {
    if (!canCurrentUserManageTechnicianAssignments()) {
        showNotification('No tienes permisos para asignar técnicos.', 'error');
        return;
    }

    const entityType = String(entityConfig.entityType || '').trim().toLowerCase();
    const entityId = String(entityConfig.entityId || '').trim();
    const entityLabel = String(entityConfig.entityLabel || `${entityType} ${entityId}`).trim();
    if (!entityType || !entityId) {
        showNotification('No pudimos identificar la entidad operativa a asignar.', 'error');
        return;
    }

    if (!currentTechniciansData.some((item) => item && item.is_active)) {
        showNotification('Primero necesitas cargar al menos un técnico activo en el tenant.', 'warning');
        return;
    }

    openActionModal({
        title: `Asignar técnico a ${entityLabel}`,
        subtitle: 'Esta asignación quedará disponible para operación, filtros y cola del tenant.',
        submitLabel: 'Guardar asignación',
        focusId: 'actionEntityAssignmentTechnicianId',
        fields: buildEntityTechnicianAssignmentFields({
            entityLabel,
            defaultRole: entityConfig.defaultRole || 'owner',
        }),
        onSubmit: async () => {
            const technicianId = parseStrictInteger(document.getElementById('actionEntityAssignmentTechnicianId')?.value);
            const assignmentRole = String(document.getElementById('actionEntityAssignmentRole')?.value || 'owner').trim();
            const note = String(document.getElementById('actionEntityAssignmentNote')?.value || '').trim();

            if (!Number.isInteger(technicianId) || technicianId <= 0) {
                setActionModalError('Debes seleccionar un técnico.');
                return;
            }

            const currentAssignments = await loadTechnicianAssignmentsForEntity(entityType, entityId, {
                force: true,
                silent: true,
            });
            const duplicateAssignment = currentAssignments.find((assignment) =>
                Number(assignment?.technician_id) === technicianId &&
                String(assignment?.assignment_role || '').trim().toLowerCase() === assignmentRole.toLowerCase());
            if (duplicateAssignment) {
                setActionModalError('Ese técnico ya tiene una asignación activa con ese rol en esta entidad.');
                return;
            }

            await api.createTechnicianAssignment(technicianId, {
                entity_type: entityType,
                entity_id: entityType === 'zone' ? entityId : Number(entityId),
                assignment_role: assignmentRole,
                metadata_json: note ? { note } : undefined,
            });

            closeActionModal(true);
            technicianAssignmentsByEntityKey.delete(buildTechnicianAssignmentEntityKey(entityType, entityId));
            showNotification(`Asignación guardada para ${entityLabel}.`, 'success');
            await loadTechniciansSection({ silent: true, refreshAssignments: false });
            if (typeof entityConfig.onApplied === 'function') {
                await entityConfig.onApplied();
            }
            dashboardOverview?.renderTechnicianLoadAttention?.();
        },
    });
}

async function removeEntityTechnicianAssignment(assignment, entityConfig = {}) {
    if (!canCurrentUserManageTechnicianAssignments()) {
        showNotification('No tienes permisos para desasignar técnicos.', 'error');
        return;
    }

    const entityLabel = String(entityConfig.entityLabel || 'esta entidad').trim();
    const technicianName = String(
        assignment?.technician_display_name || assignment?.display_name || assignment?.technician_name || 'el técnico',
    ).trim();
    const confirmed = window.confirm(`¿Quitar a ${technicianName} de ${entityLabel}?`);
    if (!confirmed) return;

    await api.deleteTechnicianAssignment(assignment.id);
    technicianAssignmentsByEntityKey.delete(
        buildTechnicianAssignmentEntityKey(entityConfig.entityType, entityConfig.entityId),
    );
    showNotification(`Asignación removida de ${entityLabel}.`, 'success');
    await loadTechniciansSection({ silent: true, refreshAssignments: false });
    if (typeof entityConfig.onApplied === 'function') {
        await entityConfig.onApplied();
    }
    dashboardOverview?.renderTechnicianLoadAttention?.();
}

async function renderEntityTechnicianAssignmentsPanel(entityConfig = {}) {
    const entityType = String(entityConfig.entityType || '').trim().toLowerCase();
    const entityId = String(entityConfig.entityId || '').trim();
    const entityLabel = String(entityConfig.entityLabel || `${entityType} ${entityId}`).trim();
    const title = String(entityConfig.title || 'Técnicos asignados').trim();
    const emptyText = String(entityConfig.emptyText || 'Sin técnicos asignados todavía.').trim();
    const compact = entityConfig.compact === true;
    const showEmptyMessage = entityConfig.showEmptyMessage !== false;

    const panel = document.createElement('section');
    panel.className = compact ? 'entity-technician-panel is-compact' : 'entity-technician-panel';

    const head = document.createElement('div');
    head.className = 'entity-technician-panel-head';
    const heading = document.createElement('strong');
    heading.textContent = title;
    head.appendChild(heading);

    if (canCurrentUserManageTechnicianAssignments()) {
        const assignBtn = document.createElement('button');
        assignBtn.type = 'button';
        assignBtn.className = 'btn-secondary';
        assignBtn.textContent = 'Asignar técnico';
        assignBtn.addEventListener('click', () => {
            void openEntityTechnicianAssignmentModal({
                entityType,
                entityId,
                entityLabel,
                defaultRole: entityConfig.defaultRole || 'owner',
                onApplied: entityConfig.onApplied,
            });
        });
        head.appendChild(assignBtn);
    }
    panel.appendChild(head);

    const body = document.createElement('div');
    body.className = 'entity-technician-panel-body';
    panel.appendChild(body);

    const assignments = await loadTechnicianAssignmentsForEntity(entityType, entityId, {
        force: entityConfig.force === true,
        silent: true,
    });

    if (!assignments.length) {
        if (!showEmptyMessage) {
            return panel;
        }
        const empty = document.createElement('p');
        empty.className = 'asset-muted';
        empty.textContent = emptyText;
        body.appendChild(empty);
        return panel;
    }

    assignments.forEach((assignment) => {
        const item = document.createElement('div');
        item.className = 'entity-technician-item';

        const copy = document.createElement('div');
        copy.className = 'entity-technician-copy';
        const primary = document.createElement('strong');
        const technicianName = String(assignment?.technician_display_name || '').trim() || `Técnico #${assignment?.technician_id || '-'}`;
        primary.textContent = technicianName;
        const meta = document.createElement('small');
        const metaParts = [
            TECHNICIAN_ASSIGNMENT_ROLE_LABELS[String(assignment?.assignment_role || '').trim()] || assignment?.assignment_role || 'Responsable',
            assignment?.technician_employee_code ? `Código ${assignment.technician_employee_code}` : '',
            assignment?.assigned_by_username ? `por ${assignment.assigned_by_username}` : '',
        ].filter(Boolean);
        meta.textContent = metaParts.join(' · ');
        copy.append(primary, meta);
        item.appendChild(copy);

        if (canCurrentUserManageTechnicianAssignments()) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'btn-secondary';
            removeBtn.textContent = 'Quitar';
            removeBtn.addEventListener('click', () => {
                void removeEntityTechnicianAssignment(assignment, {
                    entityType,
                    entityId,
                    entityLabel,
                    onApplied: entityConfig.onApplied,
                });
            });
            item.appendChild(removeBtn);
        }

        body.appendChild(item);
    });

    return panel;
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

function closeActionModal(force = false) {
    return dashboardModals.closeActionModal(force);
}

function setActionModalError(message = '') {
    return dashboardModals.setActionModalError(message);
}

function openActionModal(config = {}) {
    return dashboardModals.openActionModal(config);
}

function openActionConfirmModal(config = {}) {
    return dashboardModals.openActionConfirmModal(config);
}

function createModalInputGroup(labelText, control, { htmlFor = '', className = '' } = {}) {
    const group = document.createElement('div');
    group.className = className ? `input-group ${className}` : 'input-group';
    const label = document.createElement('label');
    if (htmlFor) {
        label.setAttribute('for', htmlFor);
    }
    label.textContent = labelText;
    group.append(label, control);
    return group;
}

function createGpsCapturePanel({ panelId, statusId, summaryId, buttonId }) {
    const wrapper = document.createElement('div');
    wrapper.id = panelId;
    wrapper.className = 'gps-capture-panel';
    wrapper.dataset.gpsState = 'pending';

    const header = document.createElement('div');
    header.className = 'gps-capture-panel-header';

    const copyWrap = document.createElement('div');
    copyWrap.className = 'gps-capture-panel-copy';

    const title = document.createElement('strong');
    title.className = 'gps-capture-panel-title';
    title.textContent = 'Ubicacion puntual';

    const status = document.createElement('span');
    status.id = statusId;
    status.className = 'gps-capture-panel-status';
    status.textContent = 'Capturando ubicacion puntual...';

    copyWrap.append(title, status);

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.id = buttonId;
    retryButton.className = 'btn-secondary';
    retryButton.textContent = 'Capturar ubicacion';

    header.append(copyWrap, retryButton);

    const summary = document.createElement('p');
    summary.id = summaryId;
    summary.className = 'gps-capture-panel-summary';
    summary.textContent = 'Intentamos obtener una ubicacion puntual para este formulario. No bloquea el guardado.';

    wrapper.append(header, summary);
    return wrapper;
}

function buildManualRecordFields(defaultClient) {
    const fragment = document.createDocumentFragment();
    const grid = document.createElement('div');
    grid.className = 'action-modal-grid';

    const clientInput = document.createElement('input');
    clientInput.type = 'text';
    clientInput.id = 'actionRecordClient';
    clientInput.value = defaultClient;
    clientInput.autocomplete = 'off';
    grid.appendChild(createModalInputGroup('Cliente (opcional)', clientInput, { htmlFor: 'actionRecordClient' }));

    const brandInput = document.createElement('input');
    brandInput.type = 'text';
    brandInput.id = 'actionRecordBrand';
    brandInput.value = 'N/A';
    brandInput.autocomplete = 'off';
    grid.appendChild(createModalInputGroup('Marca/Equipo (opcional)', brandInput, { htmlFor: 'actionRecordBrand' }));

    const versionInput = document.createElement('input');
    versionInput.type = 'text';
    versionInput.id = 'actionRecordVersion';
    versionInput.value = 'N/A';
    versionInput.autocomplete = 'off';
    grid.appendChild(createModalInputGroup('Versión/Referencia (opcional)', versionInput, { htmlFor: 'actionRecordVersion' }));

    const notesTextarea = document.createElement('textarea');
    notesTextarea.id = 'actionRecordNotes';
    notesTextarea.rows = 4;
    grid.appendChild(createModalInputGroup('Notas (opcional)', notesTextarea, {
        htmlFor: 'actionRecordNotes',
        className: 'full-width',
    }));

    const siteToggleWrap = document.createElement('div');
    siteToggleWrap.className = 'input-group full-width';
    const siteToggleRow = document.createElement('label');
    siteToggleRow.className = 'checkbox-label';
    const siteToggleInput = document.createElement('input');
    siteToggleInput.type = 'checkbox';
    siteToggleInput.id = 'actionRecordUseGpsAsSite';
    const siteToggleText = document.createElement('span');
    siteToggleText.textContent = 'Usar esta captura como referencia del sitio';
    siteToggleRow.append(siteToggleInput, siteToggleText);
    const siteToggleHelp = document.createElement('p');
    siteToggleHelp.className = 'asset-muted';
    siteToggleHelp.textContent = 'Si la captura es valida, el registro nacera con una referencia operativa para futuras incidencias y cierres.';
    siteToggleWrap.append(siteToggleRow, siteToggleHelp);
    grid.appendChild(siteToggleWrap);

    const siteRadiusInput = document.createElement('input');
    siteRadiusInput.type = 'number';
    siteRadiusInput.step = '1';
    siteRadiusInput.min = '1';
    siteRadiusInput.id = 'actionRecordSiteRadius';
    siteRadiusInput.placeholder = 'Ej: 60';
    grid.appendChild(createModalInputGroup('Radio inicial del sitio (m)', siteRadiusInput, {
        htmlFor: 'actionRecordSiteRadius',
    }));

    fragment.appendChild(grid);
    fragment.appendChild(createGpsCapturePanel({
        panelId: 'actionRecordGpsPanel',
        statusId: 'actionRecordGpsStatus',
        summaryId: 'actionRecordGpsSummary',
        buttonId: 'actionRecordGpsRetryBtn',
    }));
    return fragment;
}

function buildAssetLinkFields({ defaultCode, defaultInstallationId, defaultNotes, needsExternalCode }) {
    const fragment = document.createDocumentFragment();
    const grid = document.createElement('div');
    grid.className = 'action-modal-grid';

    if (needsExternalCode) {
        const codeInput = document.createElement('input');
        codeInput.type = 'text';
        codeInput.id = 'actionAssetCode';
        codeInput.value = defaultCode;
        codeInput.autocomplete = 'off';
        grid.appendChild(createModalInputGroup(
            'Código externo del equipo (QR/serie)',
            codeInput,
            { htmlFor: 'actionAssetCode' },
        ));
    }

    const installationInput = document.createElement('input');
    installationInput.type = 'text';
    installationInput.id = 'actionAssetInstallationId';
    installationInput.value = defaultInstallationId;
    installationInput.autocomplete = 'off';
    installationInput.placeholder = 'Ej: 245';
    grid.appendChild(createModalInputGroup(
        'ID de registro destino',
        installationInput,
        {
            htmlFor: 'actionAssetInstallationId',
            className: needsExternalCode ? '' : 'full-width',
        },
    ));

    const notesTextarea = document.createElement('textarea');
    notesTextarea.id = 'actionAssetNotes';
    notesTextarea.rows = 3;
    notesTextarea.value = defaultNotes;
    grid.appendChild(createModalInputGroup('Nota de asociacion (opcional)', notesTextarea, {
        htmlFor: 'actionAssetNotes',
        className: 'full-width',
    }));

    fragment.appendChild(grid);
    return fragment;
}

function buildAssetLookupFields() {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'actionLookupAssetCode';
    input.autocomplete = 'off';
    input.placeholder = 'Ej: EQ-SL3-001';
    return createModalInputGroup(
        'Código externo del equipo',
        input,
        { htmlFor: 'actionLookupAssetCode' },
    );
}

function createManualRecordFromWeb() {
    if (!requireActiveSession()) return;

    const defaultClient = String(currentUser?.username || '').trim();
    let gpsController = null;
    const modalOpened = openActionModal({
        title: 'Nuevo registro manual',
        subtitle: 'Crea un registro sin depender de una instalación previa.',
        submitLabel: 'Crear registro',
        focusId: 'actionRecordClient',
        fields: buildManualRecordFields(defaultClient),
        onSubmit: async () => {
            const clientName = String(document.getElementById('actionRecordClient')?.value || '').trim();
            const brand = String(document.getElementById('actionRecordBrand')?.value || '').trim();
            const version = String(document.getElementById('actionRecordVersion')?.value || '').trim();
            const notes = String(document.getElementById('actionRecordNotes')?.value || '').trim();
            const gpsSnapshot = gpsController?.getSnapshotForSubmit?.() || null;
            const useGpsAsSite = document.getElementById('actionRecordUseGpsAsSite')?.checked === true;
            const rawSiteRadius = String(document.getElementById('actionRecordSiteRadius')?.value || '').trim();
            let sitePayload = {};

            if (useGpsAsSite || rawSiteRadius) {
                const parsedRadius = Number.parseInt(rawSiteRadius, 10);
                if (!Number.isInteger(parsedRadius) || parsedRadius <= 0) {
                    setActionModalError('Debes indicar un radio inicial valido para configurar el sitio.');
                    return;
                }

                const gpsStatus = String(gpsSnapshot?.status || 'pending').trim().toLowerCase();
                if (gpsStatus !== 'captured') {
                    setActionModalError('Para usar la captura como referencia del sitio, primero necesitas una ubicacion valida.');
                    return;
                }

                sitePayload = {
                    site_lat: Number(gpsSnapshot.lat),
                    site_lng: Number(gpsSnapshot.lng),
                    site_radius_m: parsedRadius,
                };
            }

            const result = await api.createRecord({
                client_name: clientName || 'Sin cliente',
                driver_brand: brand || 'N/A',
                driver_version: version || 'N/A',
                status: 'manual',
                notes,
                driver_description: 'Registro manual desde dashboard web',
                os_info: 'web',
                installation_time_seconds: 0,
                gps: gpsSnapshot,
                ...sitePayload,
            });

            const createdRecord = result?.record && typeof result.record === 'object'
                ? result.record
                : null;
            closeActionModal(true);
            if (createdRecord) {
                handleRealtimeInstallation(createdRecord, { notify: false });
            }
            const recordId = Number(createdRecord?.id);
            showNotification(
                Number.isInteger(recordId) && recordId > 0
                    ? `Registro manual creado (#${recordId})`
                    : 'Registro manual creado.',
                'success',
            );

            if (Number.isInteger(recordId) && recordId > 0) {
                currentSelectedInstallationId = recordId;
            }
        },
    });

    if (modalOpened && dashboardGeolocation) {
        gpsController = dashboardGeolocation.createController({
            panelElement: document.getElementById('actionRecordGpsPanel'),
            statusElement: document.getElementById('actionRecordGpsStatus'),
            summaryElement: document.getElementById('actionRecordGpsSummary'),
            captureButton: document.getElementById('actionRecordGpsRetryBtn'),
        });
        void gpsController.capture();
    }
}

function buildInstallationSiteConfigFields(installation = {}) {
    const fragment = document.createDocumentFragment();
    const grid = document.createElement('div');
    grid.className = 'action-modal-grid';

    const siteLatInput = document.createElement('input');
    siteLatInput.type = 'number';
    siteLatInput.step = 'any';
    siteLatInput.id = 'actionInstallationSiteLat';
    siteLatInput.value = installation?.site_lat ?? '';
    grid.appendChild(createModalInputGroup('Latitud sitio', siteLatInput, { htmlFor: siteLatInput.id }));

    const siteLngInput = document.createElement('input');
    siteLngInput.type = 'number';
    siteLngInput.step = 'any';
    siteLngInput.id = 'actionInstallationSiteLng';
    siteLngInput.value = installation?.site_lng ?? '';
    grid.appendChild(createModalInputGroup('Longitud sitio', siteLngInput, { htmlFor: siteLngInput.id }));

    const siteRadiusInput = document.createElement('input');
    siteRadiusInput.type = 'number';
    siteRadiusInput.step = '1';
    siteRadiusInput.min = '1';
    siteRadiusInput.id = 'actionInstallationSiteRadius';
    siteRadiusInput.value = installation?.site_radius_m ?? '';
    grid.appendChild(createModalInputGroup('Radio permitido (m)', siteRadiusInput, { htmlFor: siteRadiusInput.id }));

    const help = document.createElement('p');
    help.className = 'asset-muted';
    help.textContent = 'Si dejas los tres campos vacios, el registro quedara sin referencia operativa guardada.';
    const helpWrap = document.createElement('div');
    helpWrap.className = 'input-group full-width';
    helpWrap.appendChild(help);
    grid.appendChild(helpWrap);

    fragment.appendChild(grid);
    return fragment;
}

async function openInstallationSiteConfigModal(installation) {
    const installationId = Number.parseInt(String(installation?.id || ''), 10);
    if (!Number.isInteger(installationId) || installationId <= 0) {
        showNotification('No se pudo abrir la configuracion del sitio.', 'error');
        return;
    }

    openActionModal({
        title: `Configurar sitio #${installationId}`,
        subtitle: 'Define la referencia geografica del registro para futuras consultas operativas.',
        submitLabel: 'Guardar sitio',
        focusId: 'actionInstallationSiteLat',
        fields: buildInstallationSiteConfigFields(installation),
        onSubmit: async () => {
            const rawLat = String(document.getElementById('actionInstallationSiteLat')?.value || '').trim();
            const rawLng = String(document.getElementById('actionInstallationSiteLng')?.value || '').trim();
            const rawRadius = String(document.getElementById('actionInstallationSiteRadius')?.value || '').trim();
            const allEmpty = !rawLat && !rawLng && !rawRadius;

            if (!allEmpty && (!rawLat || !rawLng || !rawRadius)) {
                setActionModalError('Debes completar latitud, longitud y radio juntos, o dejar los tres vacios.');
                return;
            }

            const payload = allEmpty
                ? {
                    site_lat: null,
                    site_lng: null,
                    site_radius_m: null,
                }
                : {
                    site_lat: Number(rawLat),
                    site_lng: Number(rawLng),
                    site_radius_m: Number(rawRadius),
                };

            const result = await api.updateInstallation(installationId, payload);
            closeActionModal(true);

            const updatedInstallation = result?.installation && typeof result.installation === 'object'
                ? result.installation
                : { ...installation, ...payload };
            currentInstallationsData = (currentInstallationsData || []).map((item) =>
                Number(item?.id) === installationId ? { ...item, ...updatedInstallation } : item,
            );
            upsertInstallationCacheEntries([{ id: installationId, ...updatedInstallation }]);

            showNotification(
                payload.site_lat === null
                    ? `Referencia operativa removida del registro #${installationId}.`
                    : `Sitio actualizado para registro #${installationId}.`,
                payload.site_lat === null ? 'info' : 'success',
            );

            void loadInstallations();
            if (Number.isInteger(currentSelectedInstallationId) && currentSelectedInstallationId === installationId) {
                void showIncidentsForInstallation(installationId);
            }
        },
    });
}

function openIncidentModal(options = {}) {
    return dashboardIncidents.openIncidentModal(options);
}
function createIncidentFromWeb(installationId, options = {}) {
    return dashboardIncidents.createIncidentFromWeb(installationId, options);
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

    openActionModal({
        title,
        subtitle,
        submitLabel: 'Asociar equipo',
        focusId: needsExternalCode ? 'actionAssetCode' : 'actionAssetInstallationId',
        fields: buildAssetLinkFields({
            defaultCode,
            defaultInstallationId,
            defaultNotes,
            needsExternalCode,
        }),
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
                void loadAssetDetail(knownAssetId, { keepSelection: true }).catch(() => {
                    showNotification('La asociacion se guardo, pero no pudimos refrescar el detalle del equipo.', 'warning');
                });
                return;
            }
            currentSelectedInstallationId = installationId;
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
        fields: buildAssetLookupFields(),
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

async function selectAndUploadIncidentPhoto(incidentId, installationId, options = {}) {
    return dashboardIncidents.selectAndUploadIncidentPhoto(incidentId, installationId, options);
}
function updateStats(stats) {
    return dashboardOverview.updateStats(stats);
}

function prefersReducedMotion() {
    return dashboardOverview.prefersReducedMotion();
}

function animateNumber(elementId, value) {
    return dashboardOverview.animateNumber(elementId, value);
}

// Chart rendering functions
function renderSuccessChart(stats) {
    return dashboardOverview.renderSuccessChart(stats);
}

function renderBrandChart(stats) {
    return dashboardOverview.renderBrandChart(stats);
}

function setupTrendRangeToggle() {
    return dashboardOverview.setupTrendRangeToggle();
}

async function renderTrendChart(days = currentTrendRangeDays) {
    return dashboardOverview.renderTrendChart(days);
}

function scheduleDashboardRetry(delayMs = 900) {
    const normalizedDelay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 900;
    if (dashboardRefreshRetryTimer) {
        clearTimeout(dashboardRefreshRetryTimer);
    }
    dashboardRefreshRetryTimer = setTimeout(() => {
        dashboardRefreshRetryTimer = null;
        void loadDashboard({ skipRetry: true });
    }, normalizedDelay);
}

async function loadDashboard(config = {}) {
    const followupDelayMs = Number.isFinite(config?.followupDelayMs) ? Number(config.followupDelayMs) : 0;
    const skipRetry = config?.skipRetry === true;

    if (followupDelayMs > 0) {
        scheduleDashboardRetry(followupDelayMs);
    }

    if (dashboardLoadPromise) {
        return dashboardLoadPromise;
    }

    dashboardLoadPromise = Promise.resolve(dashboardOverview.loadDashboard())
        .then((success) => {
            if (hasActiveSession()) {
                void loadTechniciansSection({ silent: true, refreshAssignments: true });
            }
            if (success === false && !skipRetry) {
                scheduleDashboardRetry(Math.max(900, followupDelayMs || 0));
            }
            return success;
        })
        .finally(() => {
            dashboardLoadPromise = null;
        });

    return dashboardLoadPromise;
}

function renderRecentInstallations(installations) {
    return dashboardOverview.renderRecentInstallations(installations);
}

// Advanced Filters Functions
function getActiveFilters() {
    const filters = {};

    const searchValue = document.getElementById('searchInput')?.value?.trim();
    const brandValue = document.getElementById('brandFilter')?.value;
    const geofenceValue = document.getElementById('geofenceFilter')?.value;
    const gpsValue = document.getElementById('gpsFilter')?.value;
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;

    if (searchValue) filters.search = searchValue;
    if (brandValue) filters.brand = brandValue;
    if (geofenceValue) filters.geofence = geofenceValue;
    if (gpsValue) filters.gps = gpsValue;
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

    if (clearBtn instanceof HTMLButtonElement) {
        clearBtn.disabled = !hasFilters;
        clearBtn.classList.toggle('is-disabled', !hasFilters);
    }

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

    if (filters.gps) {
        const gpsLabel = filters.gps === 'captured'
            ? 'GPS util'
            : filters.gps === 'failed'
                ? 'GPS fallido'
                : 'GPS pendiente';
        appendChip('GPS:', gpsLabel, 'gps');
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
        case 'geofence':
            if (document.getElementById('geofenceFilter')) {
                document.getElementById('geofenceFilter').value = '';
            }
            break;
        case 'gps':
            document.getElementById('gpsFilter').value = '';
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
    if (document.getElementById('geofenceFilter')) {
        document.getElementById('geofenceFilter').value = '';
    }
    document.getElementById('gpsFilter').value = '';
    document.getElementById('startDate').value = '';
    document.getElementById('endDate').value = '';

    updateFilterChips();
    debouncedSearch();
}

function hasInstallationSiteConfig(installation) {
    return Number.isFinite(Number(installation?.site_lat))
        && Number.isFinite(Number(installation?.site_lng))
        && Number(installation?.site_radius_m) > 0;
}

function isGpsFailureStatus(status) {
    return ['denied', 'timeout', 'unavailable', 'unsupported', 'override'].includes(status);
}

function applyInstallationClientSideFilters(installations, filters) {
    return (installations || []).filter((installation) => {
        if (filters.geofence === 'configured' && !hasInstallationSiteConfig(installation)) {
            return false;
        }
        if (filters.geofence === 'missing' && hasInstallationSiteConfig(installation)) {
            return false;
        }

        const gpsStatus = String(installation?.gps_capture_status || 'pending').trim().toLowerCase() || 'pending';
        if (filters.gps === 'captured' && gpsStatus !== 'captured') {
            return false;
        }
        if (filters.gps === 'failed' && !isGpsFailureStatus(gpsStatus)) {
            return false;
        }
        if (filters.gps === 'pending' && gpsStatus !== 'pending') {
            return false;
        }

        return true;
    });
}

function toDurationSeconds(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
}

function formatDurationToHHMM(value) {
    const totalSeconds = toDurationSeconds(value);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseDurationHHMMToSeconds(rawValue) {
    const normalized = String(rawValue || '').trim();
    if (!normalized) return null;
    const match = normalized.match(/^(\d{1,3}):([0-5]\d)$/);
    if (!match) return null;
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    const result = hours * 3600 + minutes * 60;
    if (result < 0 || result > INCIDENT_ESTIMATED_DURATION_MAX_SECONDS) return null;
    return result;
}

function resolveIncidentEstimatedDurationSeconds(incident) {
    const explicit = Number(incident?.estimated_duration_seconds);
    if (Number.isFinite(explicit) && explicit >= 0) {
        return Math.floor(explicit);
    }
    const legacy = Number(incident?.time_adjustment_seconds);
    if (Number.isFinite(legacy) && legacy >= 0) {
        return Math.floor(legacy);
    }
    return 0;
}

function resolveIncidentRuntimeStartMs(incident) {
    const normalizedStatus = normalizeIncidentStatus(incident?.incident_status);
    const parseIso = (value) => {
        const parsed = Date.parse(String(value || ''));
        return Number.isFinite(parsed) ? parsed : null;
    };

    return parseIso(incident?.work_started_at)
        ?? (normalizedStatus === 'in_progress' ? parseIso(incident?.status_updated_at) : null)
        ?? parseIso(incident?.created_at);
}

function resolveIncidentRealDurationSeconds(incident) {
    const normalizedStatus = normalizeIncidentStatus(incident?.incident_status);
    const explicit = Number(incident?.actual_duration_seconds);
    const parseIso = (value) => {
        const parsed = Date.parse(String(value || ''));
        return Number.isFinite(parsed) ? parsed : null;
    };

    const workStartedAtMs = resolveIncidentRuntimeStartMs(incident);
    const workEndedAtMs = parseIso(incident?.work_ended_at)
        ?? parseIso(incident?.resolved_at)
        ?? (normalizedStatus === 'in_progress' ? Date.now() : null);
    let derivedSegmentSeconds = null;
    if (Number.isFinite(workStartedAtMs) && Number.isFinite(workEndedAtMs) && workEndedAtMs >= workStartedAtMs) {
        derivedSegmentSeconds = Math.floor((workEndedAtMs - workStartedAtMs) / 1000);
    }

    if (Number.isFinite(explicit) && explicit >= 0) {
        return normalizedStatus === 'in_progress' && Number.isFinite(derivedSegmentSeconds)
            ? Math.floor(explicit) + derivedSegmentSeconds
            : Math.floor(explicit);
    }

    if (!Number.isFinite(workStartedAtMs) || !Number.isFinite(workEndedAtMs) || workEndedAtMs < workStartedAtMs) {
        return null;
    }
    return Math.floor((workEndedAtMs - workStartedAtMs) / 1000);
}

function bindIncidentEstimatedDurationFields(defaultSeconds = 0) {
    const presetSelect = document.getElementById('actionIncidentEstimatedPreset');
    const customWrap = document.getElementById('actionIncidentEstimatedCustomWrap');
    const customInput = document.getElementById('actionIncidentEstimatedCustom');
    if (!presetSelect || !customWrap || !customInput) return;

    const toggleCustomField = () => {
        const isCustom = presetSelect.value === '__custom__';
        customWrap.classList.toggle('is-hidden', !isCustom);
        customInput.disabled = !isCustom;
        if (isCustom) {
            customInput.focus();
        }
    };

    const normalizedDefaultSeconds = Math.max(
        0,
        Math.min(INCIDENT_ESTIMATED_DURATION_MAX_SECONDS, toDurationSeconds(defaultSeconds)),
    );
    const presetMatch = INCIDENT_ESTIMATED_DURATION_PRESETS.find(
        (preset) => preset.seconds === normalizedDefaultSeconds,
    );
    if (presetMatch) {
        presetSelect.value = String(presetMatch.seconds);
        customInput.value = formatDurationToHHMM(normalizedDefaultSeconds);
    } else {
        presetSelect.value = '__custom__';
        customInput.value = formatDurationToHHMM(normalizedDefaultSeconds);
    }

    toggleCustomField();
    presetSelect.addEventListener('change', () => {
        if (presetSelect.value !== '__custom__') {
            const seconds = Number.parseInt(presetSelect.value, 10);
            if (Number.isInteger(seconds) && seconds >= 0) {
                customInput.value = formatDurationToHHMM(seconds);
            }
        }
        toggleCustomField();
    });
}

function readIncidentEstimatedDurationFromModal() {
    const presetSelect = document.getElementById('actionIncidentEstimatedPreset');
    const customInput = document.getElementById('actionIncidentEstimatedCustom');
    if (!presetSelect || !customInput) {
        return { error: 'No se pudo leer el tiempo estimado.' };
    }

    const presetValue = String(presetSelect.value || '').trim();
    if (presetValue && presetValue !== '__custom__') {
        const seconds = Number.parseInt(presetValue, 10);
        if (
            Number.isInteger(seconds)
            && seconds >= 0
            && seconds <= INCIDENT_ESTIMATED_DURATION_MAX_SECONDS
        ) {
            return { seconds };
        }
        return { error: 'Selecciona un tiempo estimado valido.' };
    }

    const customSeconds = parseDurationHHMMToSeconds(customInput.value);
    if (!Number.isInteger(customSeconds)) {
        return { error: 'El tiempo personalizado debe tener formato HH:MM (ej: 01:30).' };
    }
    return { seconds: customSeconds };
}

function ensureIncidentRuntimeTicker() {
    if (incidentRuntimeTickerId) return;
    incidentRuntimeTickerId = window.setInterval(() => {
        const liveRuntimeNodes = document.querySelectorAll(
            '.incident-highlight-chip[data-runtime-live="1"]',
        );
        if (!liveRuntimeNodes.length) {
            stopIncidentRuntimeTicker();
            return;
        }
        const nowMs = Date.now();
        for (const node of liveRuntimeNodes) {
            const startMs = Number(node.dataset.runtimeStartMs || '');
            const baseSeconds = Math.max(0, Number(node.dataset.runtimeBaseSeconds || 0) || 0);
            if (!Number.isFinite(startMs) || startMs <= 0) continue;
            const runtimeSeconds = baseSeconds + Math.max(0, Math.floor((nowMs - startMs) / 1000));
            node.textContent = `Tiempo real: ${formatDuration(runtimeSeconds)} (en curso)`;
        }
    }, 1000);
}

function stopIncidentRuntimeTicker() {
    if (!incidentRuntimeTickerId) return;
    window.clearInterval(incidentRuntimeTickerId);
    incidentRuntimeTickerId = null;
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
    return dashboardOverview.normalizeRecordAttentionState(value);
}

function recordAttentionStateLabel(value) {
    return dashboardOverview.recordAttentionStateLabel(value);
}

function recordAttentionStateIconName(value) {
    return dashboardOverview.recordAttentionStateIconName(value);
}

function buildRecordAttentionBadge(record) {
    return dashboardOverview.buildRecordAttentionBadge(record);
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

function createMaterialIconNode(iconName, sizeClass = 'icon-inline-sm') {
    const normalizedIcon = String(iconName || '').trim();
    if (!normalizedIcon) return null;
    const icon = document.createElement('span');
    icon.className = `material-symbols-outlined ${sizeClass}`.trim();
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = normalizedIcon;
    return icon;
}

function setElementTextWithMaterialIcon(element, iconName, text, sizeClass = 'icon-inline-sm') {
    if (!(element instanceof HTMLElement)) return;
    const normalizedText = String(text || '').trim();
    const iconNode = createMaterialIconNode(iconName, sizeClass);
    if (!iconNode) {
        element.textContent = normalizedText;
        return;
    }
    if (normalizedText) {
        element.replaceChildren(iconNode, document.createTextNode(` ${normalizedText}`));
        return;
    }
    element.replaceChildren(iconNode);
}

function setContainerMessage(container, className, message) {
    if (!(container instanceof HTMLElement)) return;
    const copy = document.createElement('p');
    copy.className = className;
    copy.textContent = message;
    container.replaceChildren(copy);
}

function renderCountSummary(container, count, singularLabel, pluralLabel = `${singularLabel}s`) {
    if (!(container instanceof HTMLElement)) return;
    const normalizedCount = Math.max(0, Number(count) || 0);
    container.replaceChildren('Mostrando ');
    const countNode = document.createElement('span');
    countNode.className = 'count';
    countNode.textContent = String(normalizedCount);
    container.append(countNode, ` ${normalizedCount === 1 ? singularLabel : pluralLabel}`);
}

function renderVisibleCountSummary(container, visibleCount, totalCount, singularLabel, pluralLabel = `${singularLabel}s`) {
    if (!(container instanceof HTMLElement)) return;
    const normalizedVisible = Math.max(0, Number(visibleCount) || 0);
    const normalizedTotal = Math.max(0, Number(totalCount) || 0);
    container.replaceChildren('Mostrando ');
    const visibleNode = document.createElement('span');
    visibleNode.className = 'count';
    visibleNode.textContent = String(normalizedVisible);
    const totalNode = document.createElement('span');
    totalNode.className = 'count';
    totalNode.textContent = String(normalizedTotal);
    container.append(visibleNode, ' de ', totalNode, ` ${normalizedTotal === 1 ? singularLabel : pluralLabel}`);
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
        buildRecordAttentionBadge(inst).label,
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

async function exportToExcel(data, filename = 'registros.xls') {
    if (!data || !data.length) {
        showNotification('No hay datos para exportar', 'error');
        return;
    }

    const hasXlsx = await ensureXlsxLibrary();
    if (!hasXlsx) {
        showNotification('No se pudo cargar el exportador Excel', 'error');
        return;
    }

    const XLSX = window.XLSX;
    if (!XLSX?.utils?.book_new || typeof XLSX.writeFile !== 'function') {
        showNotification('No se pudo cargar el exportador Excel', 'error');
        return;
    }

    const titleStyle = {
        font: { bold: true, sz: 16, color: { rgb: '0F172A' } },
        fill: { fgColor: { rgb: 'D9F4F2' } },
        alignment: { horizontal: 'left', vertical: 'center' },
    };
    const subtitleStyle = {
        font: { italic: true, color: { rgb: '475569' } },
        alignment: { horizontal: 'left' },
    };
    const headerStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '0F766E' } },
        alignment: { horizontal: 'center', vertical: 'center' },
    };
    const sectionHeaderStyle = {
        font: { bold: true, color: { rgb: '0F172A' } },
        fill: { fgColor: { rgb: 'BAE6E0' } },
    };
    const noteStyle = {
        alignment: { vertical: 'top', wrapText: true },
    };
    const dateStyle = {
        numFmt: 'dd/mm/yyyy hh:mm',
        alignment: { horizontal: 'left' },
    };
    const centeredStyle = {
        alignment: { horizontal: 'center' },
    };

    const filters = typeof getActiveFilters === 'function' ? getActiveFilters() : {};
    const normalizeFilenameSegment = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
    const buildFilterSummary = () => {
        const parts = [];
        if (filters.startDate && filters.endDate) parts.push(`Periodo: ${filters.startDate} a ${filters.endDate}`);
        else if (filters.startDate) parts.push(`Periodo: desde ${filters.startDate}`);
        else if (filters.endDate) parts.push(`Periodo: hasta ${filters.endDate}`);
        if (filters.brand) parts.push(`Marca: ${filters.brand}`);
        if (filters.geofence) parts.push(`Geofence: ${filters.geofence}`);
        if (filters.gps) parts.push(`GPS: ${filters.gps}`);
        if (filters.search) parts.push(`Busqueda: ${filters.search}`);
        return parts.length ? parts.join(' | ') : 'Filtros: sin filtros activos';
    };
    const buildExportFilename = () => {
        if (filename && filename !== 'registros.xls') {
            return String(filename).replace(/\.xls$/i, '.xlsx');
        }
        const segments = ['registros'];
        if (filters.startDate && filters.endDate) segments.push(`${filters.startDate}_a_${filters.endDate}`);
        else if (filters.startDate) segments.push(`desde_${filters.startDate}`);
        else if (filters.endDate) segments.push(`hasta_${filters.endDate}`);
        if (filters.brand) {
            const brandSegment = normalizeFilenameSegment(filters.brand);
            if (brandSegment) segments.push(`marca-${brandSegment}`);
        }
        return `${segments.join('_')}.xlsx`;
    };
    const buildStatusStyle = (fillColor, fontColor = '0F172A') => ({
        font: { bold: true, color: { rgb: fontColor } },
        fill: { fgColor: { rgb: fillColor } },
        alignment: { horizontal: 'center' },
    });

    const workbook = XLSX.utils.book_new();
    const generatedAt = new Date();
    const filterSummary = buildFilterSummary();
    const normalizedFilename = buildExportFilename();
    const detailHeaders = [
        'ID',
        'Cliente',
        'Marca',
        'Version',
        'PC',
        'Tecnico',
        'Atencion',
        'Tiempo (s)',
        'Tiempo visible',
        'GPS',
        'Precision GPS (m)',
        'Geofence',
        'Radio geofence (m)',
        'Notas',
        'Fecha/Hora',
    ];
    const details = data.map((inst) => {
        const timestamp = inst?.timestamp ? new Date(inst.timestamp) : null;
        const gpsStatusRaw = String(inst?.gps_capture_status || 'pending').trim().toLowerCase() || 'pending';
        const gpsAccuracy = Number(inst?.gps_accuracy_m);
        const attention = buildRecordAttentionBadge(inst);
        const hasGeofence = hasInstallationSiteConfig(inst);
        return {
            id: Number(inst?.id) || inst?.id || '',
            clientName: sanitizeSpreadsheetCell(inst?.client_name || 'N/A'),
            brand: sanitizeSpreadsheetCell(inst?.driver_brand || 'N/A'),
            version: sanitizeSpreadsheetCell(inst?.driver_version || 'N/A'),
            pcName: sanitizeSpreadsheetCell(inst?.client_pc_name || 'N/A'),
            technician: sanitizeSpreadsheetCell(inst?.technician_name || 'N/A'),
            attentionLabel: sanitizeSpreadsheetCell(attention.label),
            attentionState: attention.stateClass,
            durationSeconds: Math.max(0, Number(inst?.installation_time_seconds) || 0),
            notes: sanitizeSpreadsheetCell(extractInstallationRecordNote(inst?.notes)),
            timestamp: timestamp instanceof Date && !Number.isNaN(timestamp.getTime()) ? timestamp : null,
            gpsStatus: sanitizeSpreadsheetCell(gpsStatusRaw),
            gpsStatusRaw,
            gpsAccuracy: Number.isFinite(gpsAccuracy) ? Math.max(0, gpsAccuracy) : null,
            geofenceLabel: hasGeofence ? 'Configurado' : 'Sin geofence',
            geofenceRadius: hasGeofence ? Math.max(0, Number(inst?.site_radius_m) || 0) : null,
        };
    });

    const summaryRows = [
        ['Reporte de registros'],
        [`Generado el ${generatedAt.toLocaleString('es-ES')}`],
        [filterSummary],
        [],
        ['Metrica', 'Valor'],
        ['Total de registros', details.length],
        ['Clientes unicos', new Set(details.map(item => item.clientName)).size],
        ['Marcas unicas', new Set(details.map(item => item.brand)).size],
        ['Tiempo promedio (s)', details.length ? Math.round(details.reduce((sum, item) => sum + item.durationSeconds, 0) / details.length) : 0],
        ['GPS capturado', details.filter(item => item.gpsStatusRaw === 'captured').length],
        ['GPS con falla', details.filter(item => isGpsFailureStatus(item.gpsStatusRaw)).length],
        ['Registros con geofence', details.filter(item => item.geofenceLabel === 'Configurado').length],
        [],
        ['Atencion', 'Cantidad'],
        ...Array.from(details.reduce((accumulator, item) => {
            accumulator.set(item.attentionLabel, (accumulator.get(item.attentionLabel) || 0) + 1);
            return accumulator;
        }, new Map()).entries()),
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet['!cols'] = [{ wch: 28 }, { wch: 18 }];
    summarySheet['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
    ];

    const detailHeaderRowNumber = 5;
    const detailRows = [
        ['Registros exportados'],
        [`Generado el ${generatedAt.toLocaleString('es-ES')}`],
        [filterSummary],
        [],
        detailHeaders,
        ...details.map(item => [
            item.id,
            item.clientName,
            item.brand,
            item.version,
            item.pcName,
            item.technician,
            item.attentionLabel,
            item.durationSeconds,
            formatDuration(item.durationSeconds),
            item.gpsStatus,
            item.gpsAccuracy,
            item.geofenceLabel,
            item.geofenceRadius,
            item.notes,
            item.timestamp,
        ]),
    ];
    const detailSheet = XLSX.utils.aoa_to_sheet(detailRows, { cellDates: true });
    detailSheet['!cols'] = [
        { wch: 10 },
        { wch: 24 },
        { wch: 18 },
        { wch: 14 },
        { wch: 18 },
        { wch: 18 },
        { wch: 16 },
        { wch: 12 },
        { wch: 14 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 18 },
        { wch: 48 },
        { wch: 20 },
    ];
    detailSheet['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: detailHeaders.length - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: detailHeaders.length - 1 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: detailHeaders.length - 1 } },
    ];
    detailSheet['!autofilter'] = { ref: `A${detailHeaderRowNumber}:${XLSX.utils.encode_col(detailHeaders.length - 1)}${detailRows.length}` };

    const clientsHeaderRowNumber = 5;
    const clientsHeaders = [
        'Cliente',
        'Total',
        'Marcas',
        'Tiempo promedio (s)',
        'GPS capturado',
        'Con geofence',
        'Ultima fecha',
        'Tecnicos',
    ];
    const clientSummaries = Array.from(details.reduce((accumulator, item) => {
        const bucket = accumulator.get(item.clientName) || {
            clientName: item.clientName,
            total: 0,
            durationSeconds: 0,
            gpsCaptured: 0,
            withGeofence: 0,
            brands: new Set(),
            technicians: new Set(),
            lastTimestamp: null,
        };
        bucket.total += 1;
        bucket.durationSeconds += item.durationSeconds;
        if (item.gpsStatusRaw === 'captured') bucket.gpsCaptured += 1;
        if (item.geofenceLabel === 'Configurado') bucket.withGeofence += 1;
        if (item.brand && item.brand !== 'N/A') bucket.brands.add(item.brand);
        if (item.technician && item.technician !== 'N/A') bucket.technicians.add(item.technician);
        if (item.timestamp && (!bucket.lastTimestamp || item.timestamp > bucket.lastTimestamp)) bucket.lastTimestamp = item.timestamp;
        accumulator.set(item.clientName, bucket);
        return accumulator;
    }, new Map()).values()).sort((a, b) => b.total - a.total || a.clientName.localeCompare(b.clientName));
    const clientsRows = [
        ['Resumen por cliente'],
        [`Generado el ${generatedAt.toLocaleString('es-ES')}`],
        [filterSummary],
        [],
        clientsHeaders,
        ...clientSummaries.map(item => [
            item.clientName,
            item.total,
            Array.from(item.brands).join(', ') || 'N/A',
            item.total ? Math.round(item.durationSeconds / item.total) : 0,
            item.gpsCaptured,
            item.withGeofence,
            item.lastTimestamp,
            Array.from(item.technicians).join(', ') || 'N/A',
        ]),
    ];
    const clientsSheet = XLSX.utils.aoa_to_sheet(clientsRows, { cellDates: true });
    clientsSheet['!cols'] = [
        { wch: 24 },
        { wch: 10 },
        { wch: 28 },
        { wch: 18 },
        { wch: 14 },
        { wch: 14 },
        { wch: 20 },
        { wch: 24 },
    ];
    clientsSheet['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: clientsHeaders.length - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: clientsHeaders.length - 1 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: clientsHeaders.length - 1 } },
    ];
    clientsSheet['!autofilter'] = { ref: `A${clientsHeaderRowNumber}:${XLSX.utils.encode_col(clientsHeaders.length - 1)}${clientsRows.length}` };

    function applyCellStyle(sheet, address, style) {
        if (!sheet[address]) return;
        sheet[address].s = style;
    }

    applyCellStyle(summarySheet, 'A1', titleStyle);
    applyCellStyle(summarySheet, 'A2', subtitleStyle);
    applyCellStyle(summarySheet, 'A3', subtitleStyle);
    applyCellStyle(summarySheet, 'A5', sectionHeaderStyle);
    applyCellStyle(summarySheet, 'B5', sectionHeaderStyle);
    applyCellStyle(summarySheet, 'A14', sectionHeaderStyle);
    applyCellStyle(summarySheet, 'B14', sectionHeaderStyle);

    applyCellStyle(detailSheet, 'A1', titleStyle);
    applyCellStyle(detailSheet, 'A2', subtitleStyle);
    applyCellStyle(detailSheet, 'A3', subtitleStyle);
    for (let columnIndex = 0; columnIndex < detailHeaders.length; columnIndex += 1) {
        applyCellStyle(detailSheet, `${XLSX.utils.encode_col(columnIndex)}${detailHeaderRowNumber}`, headerStyle);
    }

    applyCellStyle(clientsSheet, 'A1', titleStyle);
    applyCellStyle(clientsSheet, 'A2', subtitleStyle);
    applyCellStyle(clientsSheet, 'A3', subtitleStyle);
    for (let columnIndex = 0; columnIndex < clientsHeaders.length; columnIndex += 1) {
        applyCellStyle(clientsSheet, `${XLSX.utils.encode_col(columnIndex)}${clientsHeaderRowNumber}`, headerStyle);
    }

    for (let rowIndex = detailHeaderRowNumber + 1; rowIndex <= detailRows.length; rowIndex += 1) {
        applyCellStyle(detailSheet, `N${rowIndex}`, noteStyle);
        applyCellStyle(detailSheet, `O${rowIndex}`, dateStyle);
        applyCellStyle(detailSheet, `H${rowIndex}`, centeredStyle);
        applyCellStyle(detailSheet, `J${rowIndex}`, centeredStyle);
        applyCellStyle(detailSheet, `K${rowIndex}`, centeredStyle);
        applyCellStyle(detailSheet, `L${rowIndex}`, centeredStyle);
        applyCellStyle(detailSheet, `M${rowIndex}`, centeredStyle);

        const attentionCell = detailSheet[`G${rowIndex}`];
        if (attentionCell) {
            const normalizedAttention = String(attentionCell.v || '').toLowerCase();
            let fillColor = 'E2E8F0';
            let fontColor = '334155';
            if (normalizedAttention.includes('crit')) {
                fillColor = 'FECACA';
                fontColor = '991B1B';
            } else if (normalizedAttention.includes('alert') || normalizedAttention.includes('segu')) {
                fillColor = 'FDE68A';
                fontColor = '92400E';
            } else if (normalizedAttention.includes('ok') || normalizedAttention.includes('normal')) {
                fillColor = 'BBF7D0';
                fontColor = '166534';
            }
            attentionCell.s = buildStatusStyle(fillColor, fontColor);
        }

        const gpsCell = detailSheet[`J${rowIndex}`];
        if (gpsCell) {
            const gpsValue = String(gpsCell.v || '').toLowerCase();
            if (gpsValue === 'captured') gpsCell.s = buildStatusStyle('BBF7D0', '166534');
            else if (gpsValue === 'pending') gpsCell.s = buildStatusStyle('E2E8F0', '334155');
            else if (gpsValue === 'override') gpsCell.s = buildStatusStyle('FDE68A', '92400E');
            else gpsCell.s = buildStatusStyle('FECACA', '991B1B');
        }

        const geofenceCell = detailSheet[`L${rowIndex}`];
        if (geofenceCell) {
            const geofenceValue = String(geofenceCell.v || '').toLowerCase();
            geofenceCell.s = geofenceValue.includes('config')
                ? buildStatusStyle('BBF7D0', '166534')
                : buildStatusStyle('FEF3C7', '92400E');
        }
    }

    for (let rowIndex = clientsHeaderRowNumber + 1; rowIndex <= clientsRows.length; rowIndex += 1) {
        applyCellStyle(clientsSheet, `D${rowIndex}`, centeredStyle);
        applyCellStyle(clientsSheet, `E${rowIndex}`, centeredStyle);
        applyCellStyle(clientsSheet, `F${rowIndex}`, centeredStyle);
        applyCellStyle(clientsSheet, `G${rowIndex}`, dateStyle);
    }

    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumen');
    XLSX.utils.book_append_sheet(workbook, detailSheet, 'Registros');
    XLSX.utils.book_append_sheet(workbook, clientsSheet, 'Por cliente');
    XLSX.writeFile(workbook, normalizedFilename, {
        bookType: 'xlsx',
        compression: true,
        cellStyles: true,
    });

    showNotification(`Exportado: ${normalizedFilename}`, 'success');
}

function setupExportButtons() {
    const exportBtn = document.getElementById('exportBtn');
    if (!exportBtn) return;
    if (exportBtn.closest('.export-dropdown')) return;

    const exportDropdown = document.createElement('div');
    exportDropdown.className = 'export-dropdown';
    const btn = document.createElement('button');
    btn.id = 'exportBtn';
    btn.className = 'btn-secondary export-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.append(
        createMaterialIconNode('download'),
        document.createTextNode(' Exportar'),
    );

    const menu = document.createElement('div');
    menu.className = 'export-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Opciones de exportacion');

    const csvOption = document.createElement('button');
    csvOption.className = 'export-option';
    csvOption.type = 'button';
    csvOption.dataset.format = 'csv';
    csvOption.setAttribute('role', 'menuitem');
    csvOption.textContent = 'Exportar CSV';

    const excelOption = document.createElement('button');
    excelOption.className = 'export-option';
    excelOption.type = 'button';
    excelOption.dataset.format = 'excel';
    excelOption.setAttribute('role', 'menuitem');
    excelOption.textContent = 'Exportar Excel';

    menu.append(csvOption, excelOption);
    exportDropdown.append(btn, menu);

    exportBtn.replaceWith(exportDropdown);

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

    menu?.addEventListener('click', async (event) => {
        const option = event.target.closest('.export-option');
        if (!option) return;

        const format = option.dataset.format;
        if (format === 'csv') {
            exportToCSV(currentInstallationsData);
        } else if (format === 'excel') {
            option.disabled = true;
            try {
                await exportToExcel(currentInstallationsData);
            } finally {
                option.disabled = false;
            }
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
    const geofenceFilter = document.getElementById('geofenceFilter');
    const gpsFilter = document.getElementById('gpsFilter');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');

    if (brandFilter) {
        brandFilter.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }

    if (geofenceFilter) {
        geofenceFilter.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }

    if (gpsFilter) {
        gpsFilter.addEventListener('change', () => {
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

    const installationsSection = document.getElementById('installationsSection');
    const actionsContainer = installationsSection?.querySelector('.filter-actions');
    if (actionsContainer instanceof HTMLElement) {
        actionsContainer.classList.add('records-filter-actions');
    }
    const applyFiltersBtn = document.getElementById('applyFilters');
    const clearFiltersBtn = document.getElementById('clearFilters');
    const exportBtn = document.getElementById('exportBtn');
    const scanQrBtn = document.getElementById('installationsScanQrBtn');

    if (actionsContainer instanceof HTMLElement && !actionsContainer.querySelector('.records-filter-actions-primary')) {
        const primaryGroup = document.createElement('div');
        primaryGroup.className = 'records-filter-actions-primary';
        const secondaryGroup = document.createElement('div');
        secondaryGroup.className = 'records-filter-actions-secondary';

        if (scanQrBtn) {
            secondaryGroup.appendChild(scanQrBtn);
        }
        if (clearFiltersBtn) {
            secondaryGroup.appendChild(clearFiltersBtn);
        }
        if (applyFiltersBtn) {
            secondaryGroup.appendChild(applyFiltersBtn);
        }
        if (exportBtn) {
            secondaryGroup.appendChild(exportBtn);
        }

        actionsContainer.replaceChildren(primaryGroup, secondaryGroup);
    }

    const primaryActionsGroup = actionsContainer?.querySelector('.records-filter-actions-primary');
    const secondaryActionsGroup = actionsContainer?.querySelector('.records-filter-actions-secondary');

    if (primaryActionsGroup instanceof HTMLElement && !document.getElementById('createManualRecordBtn')) {
        const createRecordBtn = document.createElement('button');
        createRecordBtn.id = 'createManualRecordBtn';
        createRecordBtn.className = 'btn-primary';
        setElementTextWithMaterialIcon(createRecordBtn, 'edit_note', 'Nuevo registro manual');
        createRecordBtn.addEventListener('click', () => {
            void createManualRecordFromWeb();
        });
        primaryActionsGroup.appendChild(createRecordBtn);
    }

    if (secondaryActionsGroup instanceof HTMLElement && !document.getElementById('recordsUtilityActions')) {
        const utilityActions = document.createElement('details');
        utilityActions.id = 'recordsUtilityActions';
        utilityActions.className = 'records-utility-actions';

        const utilitySummary = document.createElement('summary');
        utilitySummary.textContent = 'Mas acciones';

        const utilityList = document.createElement('div');
        utilityList.className = 'records-utility-actions-list';
        utilityActions.append(utilitySummary, utilityList);
        secondaryActionsGroup.insertBefore(utilityActions, applyFiltersBtn || null);
    }

    const utilityActionsList = document.getElementById('recordsUtilityActions')?.querySelector('.records-utility-actions-list');

    if (utilityActionsList instanceof HTMLElement && !document.getElementById('openQrGeneratorBtn')) {
        const qrButton = document.createElement('button');
        qrButton.id = 'openQrGeneratorBtn';
        qrButton.type = 'button';
        qrButton.className = 'btn-secondary';
        setElementTextWithMaterialIcon(qrButton, 'qr_code_2', 'QR equipo');
        qrButton.addEventListener('click', () => {
            showQrModal({ type: 'asset', value: '' });
        });
        utilityActionsList.appendChild(qrButton);
    }
    if (utilityActionsList instanceof HTMLElement && !document.getElementById('associateAssetBtn')) {
        const associateButton = document.createElement('button');
        associateButton.id = 'associateAssetBtn';
        associateButton.type = 'button';
        associateButton.className = 'btn-secondary';
        setElementTextWithMaterialIcon(associateButton, 'link', 'Asociar equipo');
        associateButton.addEventListener('click', () => {
            void associateAssetFromWeb();
        });
        utilityActionsList.appendChild(associateButton);
    }
    if (utilityActionsList instanceof HTMLElement && !document.getElementById('lookupAssetBtn')) {
        const lookupButton = document.createElement('button');
        lookupButton.id = 'lookupAssetBtn';
        lookupButton.type = 'button';
        lookupButton.className = 'btn-secondary';
        setElementTextWithMaterialIcon(lookupButton, 'manage_search', 'Buscar equipo');
        lookupButton.addEventListener('click', () => {
            void openAssetLookupFromWeb();
        });
        utilityActionsList.appendChild(lookupButton);
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
    setContainerMessage(container, 'loading', 'Cargando...');

    if (resultsCount) {
        setContainerMessage(resultsCount, 'loading', 'Buscando...');
    }

    try {
        const filters = getActiveFilters();

        const params = {
            client_name: filters.search || '', // Use search for client_name
            brand: filters.brand || '',
            start_date: filters.startDate || '',
            end_date: filters.endDate || '',
            limit: 50
        };

        const installations = await api.getInstallations(params);
        const filteredInstallations = applyInstallationClientSideFilters(installations || [], filters);
        currentInstallationsData = filteredInstallations || [];
        upsertInstallationCacheEntries(currentInstallationsData);
        renderInstallationsTable(filteredInstallations);

        // Update results count
        if (resultsCount) {
            const count = filteredInstallations?.length || 0;
            renderCountSummary(resultsCount, count, 'resultado');
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


function makeTableRowKeyboardAccessible(row, ariaLabel) {
    if (!(row instanceof HTMLElement)) return;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    if (ariaLabel) {
        row.setAttribute('aria-label', ariaLabel);
    }
    row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        row.click();
    });
}

function buildInstallationSiteBadge(installation) {
    const hasSiteConfig =
        Number.isFinite(Number(installation?.site_lat))
        && Number.isFinite(Number(installation?.site_lng))
        && Number(installation?.site_radius_m) > 0;

    const badge = document.createElement('span');
    badge.className = `installation-site-badge ${hasSiteConfig ? 'is-configured' : 'is-missing'}`;
    if (hasSiteConfig) {
        badge.textContent = `Referencia ${Math.round(Number(installation.site_radius_m))} m`;
    } else {
        badge.textContent = 'Sin referencia';
    }
    return badge;
}

function buildInstallationGpsBadge(installation) {
    const status = String(installation?.gps_capture_status || 'pending').trim().toLowerCase() || 'pending';
    const accuracy = Number(installation?.gps_accuracy_m);
    const badge = document.createElement('span');
    badge.className = 'installation-site-badge installation-gps-badge';

    if (status === 'captured') {
        badge.classList.add('is-configured');
        badge.textContent = Number.isFinite(accuracy)
            ? `GPS +- ${Math.round(Math.max(0, accuracy))} m`
            : 'GPS capturado';
        return badge;
    }

    badge.classList.add('is-missing');
    if (status === 'denied') {
        badge.textContent = 'GPS denegado';
    } else if (status === 'timeout') {
        badge.textContent = 'GPS timeout';
    } else if (status === 'unavailable') {
        badge.textContent = 'GPS no disponible';
    } else if (status === 'unsupported') {
        badge.textContent = 'GPS sin soporte';
    } else if (status === 'override') {
        badge.textContent = 'GPS override';
    } else {
        badge.textContent = 'GPS pendiente';
    }
    return badge;
}

function buildInstallationTimeMetaRow(label, value) {
    const row = document.createElement('div');
    row.className = 'installation-time-row';

    const labelNode = document.createElement('span');
    labelNode.className = 'installation-time-label';
    labelNode.textContent = label;

    const valueNode = document.createElement('span');
    valueNode.className = 'installation-time-value';
    valueNode.textContent = value;

    row.append(labelNode, valueNode);
    return row;
}

function buildInstallationTimeSummary(installation) {
    const wrapper = document.createElement('div');
    wrapper.className = 'installation-time-summary';

    const estimatedCount = Math.max(0, Number(installation?.incident_estimated_duration_count) || 0);
    const actualCount = Math.max(0, Number(installation?.incident_actual_duration_count) || 0);
    const estimatedSeconds = Math.max(0, Number(installation?.incident_estimated_duration_seconds_total) || 0);
    const actualSeconds = Math.max(0, Number(installation?.incident_actual_duration_seconds_total) || 0);
    const installationSeconds = Math.max(0, Number(installation?.installation_time_seconds) || 0);

    const estimatedText = estimatedCount > 0 ? formatDuration(estimatedSeconds) : '-';
    const actualText = actualCount > 0
        ? formatDuration(actualSeconds)
        : installationSeconds > 0
            ? formatDuration(installationSeconds)
            : '-';

    wrapper.append(
        buildInstallationTimeMetaRow('Est.', estimatedText),
        buildInstallationTimeMetaRow('Real', actualText),
    );
    return wrapper;
}

function buildInstallationTextStack(primaryText, secondaryText = '', options = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = `installation-record-stack ${options.wrapperClass || ''}`.trim();

    const primary = document.createElement('div');
    primary.className = `installation-record-primary ${options.primaryClass || ''}`.trim();
    primary.textContent = primaryText;
    wrapper.appendChild(primary);

    if (secondaryText) {
        const secondary = document.createElement('div');
        secondary.className = `installation-record-secondary ${options.secondaryClass || ''}`.trim();
        secondary.textContent = secondaryText;
        wrapper.appendChild(secondary);
    }

    return wrapper;
}

function buildInstallationDateSummary(timestampValue) {
    const rawDate = timestampValue ? new Date(timestampValue) : null;
    if (!(rawDate instanceof Date) || Number.isNaN(rawDate.getTime())) {
        return buildInstallationTextStack('Sin fecha');
    }

    return buildInstallationTextStack(
        rawDate.toLocaleDateString('es-ES'),
        rawDate.toLocaleTimeString('es-ES'),
        { wrapperClass: 'installation-date-summary' },
    );
}

function renderInstallationsTable(installations) {
    const container = document.getElementById('installationsTable');
    container.replaceChildren();
    container.dataset.mobileCards = 'true';

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
    ['ID', 'Cliente', 'Marca', 'Atención', 'Tiempo', 'Notas', 'Fecha', 'Acciones'].forEach(label => {
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
        idCell.dataset.label = 'ID';
        idCell.className = 'installation-record-cell installation-record-id';
        idCell.appendChild(
            buildInstallationTextStack(
                `#${inst.id ?? 'N/A'}`,
                String(inst.technician_name || inst.reporter_username || '').trim(),
                { primaryClass: 'installation-record-id-value' },
            ),
        );

        const clientCell = document.createElement('td');
        clientCell.dataset.label = 'Cliente';
        clientCell.className = 'installation-record-cell installation-record-client';
        const clientPrimary = document.createElement('div');
        clientPrimary.className = 'installation-record-primary';
        clientPrimary.textContent = inst.client_name || 'N/A';
        const badgesWrap = document.createElement('div');
        badgesWrap.className = 'installation-meta-badges';
        const siteBadge = buildInstallationSiteBadge(inst);
        const gpsBadge = buildInstallationGpsBadge(inst);
        badgesWrap.append(siteBadge, gpsBadge);
        clientCell.append(clientPrimary, badgesWrap);

        const brandCell = document.createElement('td');
        brandCell.dataset.label = 'Marca';
        brandCell.className = 'installation-record-cell installation-record-brand';
        brandCell.appendChild(buildInstallationTextStack(inst.driver_brand || 'N/A'));

        const attentionCell = document.createElement('td');
        attentionCell.dataset.label = 'Atención';
        attentionCell.className = 'installation-record-cell installation-record-attention';
        const attentionBadge = document.createElement('span');
        const attentionMeta = buildRecordAttentionBadge(inst);
        attentionBadge.className = `badge ${attentionMeta.stateClass}`;
        setElementTextWithMaterialIcon(attentionBadge, attentionMeta.iconName, attentionMeta.label);
        attentionCell.appendChild(attentionBadge);

        const timeCell = document.createElement('td');
        timeCell.dataset.label = 'Tiempo';
        timeCell.className = 'installation-record-cell installation-record-time';
        timeCell.appendChild(buildInstallationTimeSummary(inst));

        const notesCell = document.createElement('td');
        notesCell.dataset.label = 'Notas';
        notesCell.className = 'installation-record-cell installation-record-notes';
        notesCell.appendChild(
            buildInstallationTextStack(
                formatInstallationRecordNotePreview(inst.notes),
                'Contexto del registro',
                { primaryClass: 'installation-record-note-text' },
            ),
        );

        const dateCell = document.createElement('td');
        dateCell.dataset.label = 'Fecha';
        dateCell.className = 'installation-record-cell installation-record-date-cell';
        dateCell.appendChild(buildInstallationDateSummary(inst.timestamp));

        const qrCell = document.createElement('td');
        qrCell.dataset.label = 'Acciones';
        qrCell.className = 'table-actions-cell installation-record-cell installation-record-actions';
        const actionsGroup = document.createElement('div');
        actionsGroup.className = 'table-actions-group';
        const qrButton = document.createElement('button');
        qrButton.type = 'button';
        qrButton.className = 'btn-secondary table-action-btn';
        qrButton.textContent = 'QR';
        qrButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            showQrModal({ type: 'installation', value: String(inst.id ?? '') });
        });
        const siteButton = document.createElement('button');
        siteButton.type = 'button';
        siteButton.className = 'btn-secondary table-action-btn';
        setElementTextWithMaterialIcon(
            siteButton,
            Number.isFinite(Number(inst.site_lat)) && Number.isFinite(Number(inst.site_lng)) && Number(inst.site_radius_m) > 0
                ? 'place'
                : 'add_location_alt',
            'Sitio',
        );
        siteButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openInstallationSiteConfigModal(inst);
        });
        actionsGroup.append(qrButton, siteButton);
        qrCell.appendChild(actionsGroup);

        row.append(idCell, clientCell, brandCell, attentionCell, timeCell, notesCell, dateCell, qrCell);
        tbody.appendChild(row);
    });

    table.append(thead, tbody);
    container.appendChild(table);

    container.querySelectorAll('tr[data-id]').forEach(row => {
        const rowId = String(row.dataset.id || '').trim();
        const clientName = String(row.cells?.[1]?.textContent || '').trim();
        const readableLabel = clientName
            ? `Abrir incidencias del registro ${rowId} de ${clientName}`
            : `Abrir incidencias del registro ${rowId}`;
        makeTableRowKeyboardAccessible(row, readableLabel);
        row.addEventListener('click', () => {
            const id = row.dataset.id;
            showIncidentsForInstallation(id);
        });
    });
}

async function showIncidentsForInstallation(installationId) {
    return dashboardIncidents.showIncidentsForInstallation(installationId);
}
function normalizeAssetStatusLabel(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (!normalized) return 'active';
    return normalized;
}

function getSeverityIconName(severity) {
    const normalized = normalizeSeverity(severity);
    if (normalized === 'critical') return 'emergency_home';
    if (normalized === 'high') return 'warning';
    if (normalized === 'medium') return 'priority_high';
    return 'info';
}

function normalizeIncidentStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'in_progress') return 'in_progress';
    if (normalized === 'paused') return 'paused';
    if (normalized === 'resolved') return 'resolved';
    return 'open';
}

function incidentStatusLabel(value) {
    const normalized = normalizeIncidentStatus(value);
    if (normalized === 'resolved') return 'Resuelta';
    if (normalized === 'paused') return 'Pausada';
    if (normalized === 'in_progress') return 'En curso';
    return 'Abierta';
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

async function updateIncidentEvidenceFromWeb(incident, options = {}) {
    return dashboardIncidents.updateIncidentEvidenceFromWeb(incident, options);
}
async function updateIncidentStatusFromWeb(incident, targetStatus, options = {}) {
    return dashboardIncidents.updateIncidentStatusFromWeb(incident, targetStatus, options);
}
async function deleteIncidentFromWeb(incident, options = {}) {
    return dashboardIncidents.deleteIncidentFromWeb(incident, options);
}
function deriveAssetAttentionMetaFromIncidents(incidents) {
    return dashboardIncidents.deriveAssetAttentionMetaFromIncidents(incidents);
}
function sortAssetIncidentsByPriority(incidents) {
    return dashboardIncidents.sortAssetIncidentsByPriority(incidents);
}
async function createIncidentForAsset(assetId) {
    return dashboardIncidents.createIncidentForAsset(assetId);
}
async function appendIncidentCard(parent, incident, options = {}) {
    return dashboardIncidents.appendIncidentCard(parent, incident, options);
}
async function loadAssetDetail(assetId, options = {}) {
    return dashboardAssets.loadAssetDetail(assetId, options);
}

function formatAssetUpdatedMeta(rawValue) {
    return dashboardAssets.formatAssetUpdatedMeta(rawValue);
}

function resolveAssetOperationalStateMeta(rawStatus) {
    return dashboardAssets.resolveAssetOperationalStateMeta(rawStatus);
}

async function renderAssetDetail(data) {
    return dashboardAssets.renderAssetDetail(data);
}

async function loadAssets() {
    return dashboardAssets.loadAssets();
}

function formatDriverSize(bytes, sizeMb) {
    return dashboardDrivers.formatDriverSize(bytes, sizeMb);
}

function updateDriverSelectedFileLabel() {
    return dashboardDrivers.updateDriverSelectedFileLabel();
}

function setSelectedDriverFile(file) {
    return dashboardDrivers.setSelectedDriverFile(file);
}

async function loadDrivers() {
    return dashboardDrivers.loadDrivers();
}

function renderDriversTable(drivers) {
    return dashboardDrivers.renderDriversTable(drivers);
}

async function uploadDriverFromWeb() {
    return dashboardDrivers.uploadDriverFromWeb();
}

function renderAssetsTable(assets) {
    return dashboardAssets.renderAssetsTable(assets);
}

async function linkAssetFromDetail(assetId) {
    return dashboardAssets.linkAssetFromDetail(assetId);
}

async function updateAssetStatusFromWeb(assetOrId, nextStatus) {
    return dashboardAssets.updateAssetStatusFromWeb(assetOrId, nextStatus);
}

async function deleteAssetFromWeb(assetOrId) {
    return dashboardAssets.deleteAssetFromWeb(assetOrId);
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
    return dashboardIncidents.renderIncidents(incidents, installationId);
}
async function viewPhoto(photoId, photoIds = []) {
    return dashboardModals.viewPhoto(photoId, photoIds);
}
function closePhotoModal() {
    return dashboardModals.closePhotoModal();
}
function canCurrentUserEditAssets() {
    return dashboardModals.canCurrentUserEditAssets();
}
function isQrEditSessionActive() {
    return dashboardModals.isQrEditSessionActive();
}
function getQrEditSessionRemainingMs() {
    return dashboardModals.getQrEditSessionRemainingMs();
}
function applyQrModalAccessState() {
    return dashboardModals.applyQrModalAccessState();
}
function openQrPasswordModal() {
    return dashboardModals.openQrPasswordModal();
}
function closeQrPasswordModal(options = {}) {
    return dashboardModals.closeQrPasswordModal(options);
}
async function confirmQrEditUnlockFromModal() {
    return dashboardModals.confirmQrEditUnlockFromModal();
}
function setQrError(message = '') {
    return dashboardModals.setQrError(message);
}
function applyQrTypeMeta() {
    return dashboardModals.applyQrTypeMeta();
}
function resetQrPreview() {
    return dashboardModals.resetQrPreview();
}
function showQrModal(options = {}) {
    return dashboardModals.showQrModal(options);
}

function closeQrModal() {
    return dashboardModals.closeQrModal();
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

function readAssetFormData() {
    const codeInput = document.getElementById('qrAssetCodeInput');
    const brandInput = document.getElementById('qrAssetBrandInput');
    const modelInput = document.getElementById('qrAssetModelInput');
    const serialInput = document.getElementById('qrAssetSerialInput');
    const clientInput = document.getElementById('qrAssetClientInput');
    const notesInput = document.getElementById('qrAssetNotesInput');
    if (!codeInput || !brandInput || !modelInput || !serialInput || !clientInput || !notesInput) {
        throw new Error('Formulario QR incompleto. Recarga la pagina.');
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
        throw new Error('El numero de serie es obligatorio para la etiqueta.');
    }

    const explicitCode = normalizeAssetCodeForQr(codeInput.value);
    const fallbackCode = normalizeAssetCodeForQr(serialNumber);
    const externalCode = explicitCode || fallbackCode;
    if (!externalCode) {
        throw new Error('No se pudo construir un codigo externo de equipo.');
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

function getQrLabelPresetConfig() {
    const select = document.getElementById('qrLabelPresetSelect');
    const selected = String(select?.value || currentQrLabelPreset || 'medium').toLowerCase();
    currentQrLabelPreset = Object.prototype.hasOwnProperty.call(QR_LABEL_PRESETS, selected)
        ? selected
        : 'medium';
    return QR_LABEL_PRESETS[currentQrLabelPreset];
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

function buildQrPayload(qrType, rawValue, assetData = null) {
    if (qrType === 'installation') {
        const installationId = Number.parseInt(String(rawValue || '').trim(), 10);
        if (!Number.isInteger(installationId) || installationId <= 0) {
            throw new Error('El ID de instalacion debe ser un entero positivo.');
        }
        return `dm://installation/${encodeURIComponent(String(installationId))}`;
    }

    const assetCode = normalizeAssetCodeForQr(
        assetData?.external_code || rawValue,
    );
    if (!assetCode) {
        throw new Error('El codigo de equipo es obligatorio.');
    }
    return `dm://asset/${encodeURIComponent(assetCode)}`;
}

function buildQrImageUrl(payload) {
    const qrEngine = window.DMQR;
    if (!qrEngine || typeof qrEngine.createPngDataUrl !== 'function') {
        throw new Error('Motor QR no disponible. Recarga la pagina.');
    }
    return qrEngine.createPngDataUrl(payload, {
        sizePx: QR_PREVIEW_SIZE_PX,
        ecc: 'M',
        marginModules: 2,
    });
}

function normalizeQrFilenameSegment(value, fallback = 'codigo') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return normalized || fallback;
}

function buildQrDownloadFileName(qrType, rawValue, assetData = null) {
    if (qrType === 'installation') {
        const installationId = Number.parseInt(String(rawValue || '').trim(), 10);
        return `qr-instalacion-${Number.isInteger(installationId) && installationId > 0 ? installationId : 'manual'}.png`;
    }

    const assetCode = normalizeAssetCodeForQr(assetData?.external_code || rawValue);
    return `qr-equipo-${normalizeQrFilenameSegment(assetCode, 'manual')}.png`;
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
                ctx.font = `700 ${Math.max(16, preset.titleSize)}px "Source Sans 3", "Segoe UI", sans-serif`;
                ctx.fillText('SiteOps', infoX, y, infoWidth);

                y += titleLineHeight;
                ctx.fillStyle = '#1f2937';
                ctx.font = `500 ${Math.max(12, preset.bodySize)}px "Source Sans 3", "Segoe UI", sans-serif`;
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

    try {
        const printFrame = document.createElement('iframe');
        printFrame.setAttribute('aria-hidden', 'true');
        printFrame.className = 'print-frame-hidden';

        const cleanup = () => {
            if (printFrame.parentNode) {
                printFrame.parentNode.removeChild(printFrame);
            }
        };

        document.body.appendChild(printFrame);
        const frameWindow = printFrame.contentWindow;
        const frameDocument = printFrame.contentDocument;
        if (!frameWindow || !frameDocument) {
            cleanup();
            showNotification('No se pudo preparar la impresion.', 'error');
            return;
        }

        frameDocument.documentElement.lang = 'es';
        frameDocument.head.replaceChildren();
        frameDocument.body.replaceChildren();

        const meta = frameDocument.createElement('meta');
        meta.setAttribute('charset', 'utf-8');
        const title = frameDocument.createElement('title');
        title.textContent = 'Etiqueta QR';
        const style = frameDocument.createElement('style');
        style.textContent = `
            html, body { margin: 0; padding: 0; background: #ffffff; }
            .page { padding: 18px; display: flex; justify-content: center; }
            .label { max-width: 840px; width: 100%; }
            .img { display: block; width: 100%; height: auto; }
            @media print {
              @page { size: auto; margin: 8mm; }
              .page { padding: 0; }
            }
        `;
        frameDocument.head.append(meta, title, style);

        const page = frameDocument.createElement('div');
        page.className = 'page';
        const label = frameDocument.createElement('div');
        label.className = 'label';
        const image = frameDocument.createElement('img');
        image.className = 'img';
        image.src = printableImageUrl;
        image.alt = 'Etiqueta QR';
        label.appendChild(image);
        page.appendChild(label);
        frameDocument.body.appendChild(page);

        setTimeout(() => {
            try {
                frameWindow.focus();
                frameWindow.print();
                setTimeout(cleanup, 1200);
            } catch (_error) {
                cleanup();
                showNotification('No se pudo abrir la impresion.', 'error');
            }
        }, 0);
    } catch (_error) {
        showNotification('No se pudo abrir la impresion.', 'error');
    }
}

async function loadAuditLogs() {
    return dashboardAudit.loadAuditLogs();
}

function renderAuditLogs(logs) {
    return dashboardAudit.renderAuditLogs(logs);
}

function getCurrentShiftLabel(now = new Date()) {
    const hour = now.getHours();
    if (hour >= 6 && hour < 12) return 'Turno mañana';
    if (hour >= 12 && hour < 18) return 'Turno tarde';
    return 'Turno noche';
}

function updateDashboardDateLabel(now = new Date()) {
    const dateEl = document.getElementById('dashboardDate');
    if (!dateEl) return;
    const rawLabel = now.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    });
    const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
    dateEl.textContent = label;
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
    return 'Sincronización en pausa';
}

function syncHeaderDelight(section, explicitStatus = null) {
    const normalizedSection = SECTION_TITLES[section] ? section : 'dashboard';
    document.body.dataset.activeSection = normalizedSection;
    updatePageSubtitleForSection(normalizedSection);
    updateDashboardDateLabel();

    const pulse = document.getElementById('opsPulse');
    const pulseText = document.getElementById('opsPulseText');
    if (!pulse || !pulseText) return;

    const fallbackStatus = getConnectionStatus();
    const status = explicitStatus ?? fallbackStatus;
    pulse.dataset.state = status;
    pulseText.textContent = buildOpsPulseText(status, normalizedSection);
    updateSettingsSyncLabel(status);
}

function updatePageTitleForSection(section) {
    const pageTitle = document.getElementById('pageTitle');
    if (!pageTitle) return;
    const normalizedSection = SECTION_TITLES[section] ? section : 'dashboard';
    pageTitle.textContent = SECTION_TITLES[normalizedSection];
    syncHeaderDelight(normalizedSection);
    syncHeaderPrimaryAction(normalizedSection);
    syncMobileNavMoreState(normalizedSection);
}

function resolveHeaderPrimaryActionConfig(section) {
    const normalizedSection = SECTION_TITLES[section] ? section : 'dashboard';
    if (normalizedSection === 'tenants' && !canCurrentUserManageTenants()) {
        return HEADER_PRIMARY_ACTIONS.dashboard;
    }
    if (normalizedSection === 'settings' && !canCurrentUserAccessAudit()) {
        return { icon: 'logout', label: 'Cerrar sesión', action: 'logout' };
    }
    return HEADER_PRIMARY_ACTIONS[normalizedSection] || HEADER_PRIMARY_ACTIONS.dashboard;
}

function executeHeaderPrimaryAction(actionKey) {
    if (!requireActiveSession()) return;

    switch (actionKey) {
        case 'createIncident':
            openIncidentModal({
                installationId: Number.isInteger(currentSelectedInstallationId) ? currentSelectedInstallationId : '',
            });
            return;
        case 'createAsset':
            navigateToSectionByKey('assets');
            showQrModal({ type: 'asset', value: '' });
            return;
        case 'createTenant':
            if (!canCurrentUserManageTenants()) {
                showNotification('Solo super admin puede crear tenants.', 'error');
                return;
            }
            navigateToSectionByKey('tenants');
            openTenantEditorModal();
            return;
        case 'pickDriverFile':
            navigateToSectionByKey('drivers');
            document.getElementById('driverPickFileBtn')?.click();
            return;
        case 'refreshAudit':
            if (!canCurrentUserAccessAudit()) {
                showNotification('No tienes permisos para acceder a Auditoría.', 'error');
                return;
            }
            navigateToSectionByKey('audit');
            document.getElementById('refreshAudit')?.click();
            return;
        case 'openAudit':
            if (!canCurrentUserAccessAudit()) {
                showNotification('No tienes permisos para acceder a Auditoría.', 'error');
                return;
            }
            navigateToSectionByKey('audit');
            return;
        case 'logout':
            document.getElementById('logoutBtn')?.click();
            return;
        case 'createRecord':
        default:
            createManualRecordFromWeb();
    }
}

function syncHeaderPrimaryAction(section) {
    const actionBtn = document.getElementById('headerPrimaryActionBtn');
    const iconEl = document.getElementById('headerPrimaryActionIcon');
    const labelEl = document.getElementById('headerPrimaryActionLabel');
    if (!actionBtn || !iconEl || !labelEl) return;

    const actionConfig = resolveHeaderPrimaryActionConfig(section);
    actionBtn.dataset.action = actionConfig.action;
    iconEl.textContent = actionConfig.icon;
    labelEl.textContent = actionConfig.label;
    actionBtn.setAttribute('aria-label', actionConfig.label);
    actionBtn.hidden = actionConfig.hidden === true;
}

function closeHeaderOverflowMenu(options = {}) {
    const shouldRestoreFocus = options.restoreFocus === true;
    const overflowMenu = document.getElementById('headerOverflowMenu');
    const overflowToggle = document.getElementById('headerOverflowBtn');
    if (!overflowMenu || !overflowToggle) return false;
    const wasOpen = overflowMenu.classList.contains('is-open');
    overflowMenu.classList.remove('is-open');
    overflowToggle.setAttribute('aria-expanded', 'false');
    if (wasOpen && shouldRestoreFocus) {
        overflowToggle.focus();
    }
    return wasOpen;
}

function setupHeaderOverflowMenu() {
    const overflowMenu = document.getElementById('headerOverflowMenu');
    const overflowToggle = document.getElementById('headerOverflowBtn');
    if (!overflowMenu || !overflowToggle) return;

    const setOverflowOpen = (isOpen) => {
        overflowMenu.classList.toggle('is-open', isOpen);
        overflowToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    };

    overflowToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setOverflowOpen(!overflowMenu.classList.contains('is-open'));
    });

    document.addEventListener('click', (event) => {
        if (!overflowMenu.classList.contains('is-open')) return;
        if (overflowMenu.contains(event.target) || overflowToggle.contains(event.target)) return;
        closeHeaderOverflowMenu();
    });

    overflowMenu.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
            closeHeaderOverflowMenu();
        });
    });
}

function validateSectionBindings(section, options = {}) {
    const sectionKey = String(section || '').trim();
    const requiredBindings = SECTION_REQUIRED_BINDINGS[sectionKey];
    if (!Array.isArray(requiredBindings) || requiredBindings.length === 0) return true;

    const sectionNode = document.getElementById(`${sectionKey}Section`);
    if (!(sectionNode instanceof HTMLElement)) {
        const missingSectionSignature = `${sectionKey}|missing-section-node`;
        if (!REPORTED_SECTION_BINDING_WARNINGS.has(missingSectionSignature)) {
            console.warn(`[UI bindings][${sectionKey}] Missing section container: ${sectionKey}Section`);
            REPORTED_SECTION_BINDING_WARNINGS.add(missingSectionSignature);
        }
        return false;
    }

    const missingIds = [];
    const misplacedIds = [];
    requiredBindings.forEach((bindingId) => {
        const node = document.getElementById(bindingId);
        if (!(node instanceof HTMLElement)) {
            missingIds.push(bindingId);
            return;
        }
        if (!sectionNode.contains(node)) {
            misplacedIds.push(bindingId);
        }
    });

    if (!missingIds.length && !misplacedIds.length) {
        return true;
    }

    const warningParts = [];
    if (missingIds.length) warningParts.push(`missing: ${missingIds.join(', ')}`);
    if (misplacedIds.length) warningParts.push(`outside section: ${misplacedIds.join(', ')}`);
    const warningSignature = `${sectionKey}|${warningParts.join('|')}`;
    if (!REPORTED_SECTION_BINDING_WARNINGS.has(warningSignature)) {
        console.warn(`[UI bindings][${sectionKey}] ${warningParts.join(' | ')}`);
        REPORTED_SECTION_BINDING_WARNINGS.add(warningSignature);
    }

    if (options.notify === true && !NOTIFIED_SECTION_BINDING_ERRORS.has(sectionKey)) {
        const sectionLabel = SECTION_TITLES[sectionKey] || sectionKey;
        showNotification(
            `Detectamos un desajuste visual en ${sectionLabel}. Recarga la página si falta información.`,
            'warning',
        );
        NOTIFIED_SECTION_BINDING_ERRORS.add(sectionKey);
    }

    return false;
}

function validateAllSectionBindings() {
    Object.keys(SECTION_REQUIRED_BINDINGS).forEach((sectionKey) => {
        validateSectionBindings(sectionKey);
    });
}

const dashboardNavigation = window.createDashboardNavigation({
    loadAssets,
    loadAuditLogs,
    loadDrivers,
    loadIncidentsWorkspace: (...args) => dashboardIncidents.showIncidentsWorkspace(...args),
    loadInstallations,
    loadTenants: loadTenantsSection,
    prefersReducedMotion,
    sectionTransitionOutMs: SECTION_TRANSITION_OUT_MS,
    syncSSEForCurrentContext,
    updatePageTitleForSection,
    validateSectionBindings,
});

function runSectionLoaders(section) {
    return dashboardNavigation.runSectionLoaders(section);
}

function navigateToSectionByKey(section) {
    return dashboardNavigation.navigateToSectionByKey(section);
}

async function activateSection(section) {
    return dashboardNavigation.activateSection(section);
}

// Event Listeners
dashboardAuth.bindSessionUi();
dashboardScan?.bindEvents();


document.getElementById('headerPrimaryActionBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('headerPrimaryActionBtn');
    const actionKey = String(btn?.dataset?.action || 'createRecord').trim();
    executeHeaderPrimaryAction(actionKey);
});

document.getElementById('overflowCreateIncidentBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    openIncidentModal({
        installationId: Number.isInteger(currentSelectedInstallationId) ? currentSelectedInstallationId : '',
    });
});

document.getElementById('notifBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    navigateToSectionByKey('dashboard');
    const attentionPanel = document.getElementById('attentionPanel');
    if (attentionPanel) {
        attentionPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    const badge = document.getElementById('notifBadge');
    const badgeCount = Number.parseInt(String(badge?.textContent || '0'), 10) || 0;
    if (badgeCount > 0) {
        showNotification(`Tienes ${badgeCount} alertas para revisar en "Atención ahora".`, 'warning');
    } else {
        showNotification('No hay alertas pendientes.', 'info');
    }
});

document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        if (!requireActiveSession()) return;
        const section = link.dataset.section;
        if (!section) return;
        if (section === 'tenants' && !canCurrentUserManageTenants()) {
            showNotification('Solo super admin puede acceder a tenants.', 'error');
            return;
        }
        if (section === 'audit' && !canCurrentUserAccessAudit()) {
            showNotification('No tienes permisos para acceder a Auditoría.', 'error');
            return;
        }
        closeHeaderOverflowMenu();
        closeMobileNavPanel();

        document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
        link.classList.add('active');

        void activateSection(section);
    });
});

document.getElementById('settingsOpenAuditBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    if (!canCurrentUserAccessAudit()) {
        showNotification('No tienes permisos para acceder a Auditoría.', 'error');
        return;
    }
    navigateToSectionByKey('audit');
});

document.getElementById('settingsRefreshTechniciansBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    void loadTechniciansSection({ silent: false, refreshAssignments: true });
});

document.getElementById('settingsCreateTechnicianBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    openTechnicianEditorModal(null);
});

document.getElementById('tenantsRefreshBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    void loadTenantsSection({ silent: false });
});

document.getElementById('tenantsCreateBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    openTenantEditorModal(null);
});

document.getElementById('tenantsEditBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    const tenant = currentTenantDetail?.tenant || null;
    if (!tenant) {
        showNotification('Selecciona un tenant primero.', 'warning');
        return;
    }
    openTenantEditorModal(tenant);
});

document.getElementById('tenantsDeleteBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    const tenant = currentTenantDetail?.tenant || null;
    if (!tenant) {
        showNotification('Selecciona un tenant primero.', 'warning');
        return;
    }
    confirmDeleteTenant(tenant);
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

document.getElementById('incidentsGoAssetsBtn')?.addEventListener('click', () => {
    if (!requireActiveSession()) return;
    navigateToSectionByKey('assets');
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
    setSelectedDriverFile(nextFile);
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

dashboardModals.bindSharedModalUi();

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

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (handleModalKeyboardInteraction(e)) {
        return;
    }

    if (e.key === 'Escape' && closeHeaderOverflowMenu({ restoreFocus: true })) {
        return;
    }
    if (e.key === 'Escape' && closeMobileNavPanel({ restoreFocus: true })) {
        return;
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
    return dashboardNavigation.getActiveSectionName();
}

function getConnectionStatus() {
    return dashboardRealtime ? dashboardRealtime.getConnectionStatus() : 'paused';
}

function canUseRealtimeNow() {
    return dashboardRealtime.canUseRealtimeNow();
}

function scheduleSSEReconnect(preferredDelayMs = null) {
    return dashboardRealtime.scheduleSSEReconnect(preferredDelayMs);
}

function syncSSEForCurrentContext(forceReconnect = false) {
    return dashboardRealtime.syncSSEForCurrentContext(forceReconnect);
}

function handleSSEMessage(data) {
    return dashboardRealtime.handleSSEMessage(data);
}

function handleRealtimeInstallation(installation, config = {}) {
    return dashboardRealtime.handleRealtimeInstallation(installation, config);
}

function handleRealtimeInstallationUpdate(installation) {
    return dashboardRealtime.handleRealtimeInstallationUpdate(installation);
}

function handleRealtimeInstallationDeleted(installation) {
    return dashboardRealtime.handleRealtimeInstallationDeleted(installation);
}

function handleRealtimeIncident(incident) {
    return dashboardRealtime.handleRealtimeIncident(incident);
}

function handleRealtimeIncidentStatusUpdate(incident) {
    return dashboardRealtime.handleRealtimeIncidentStatusUpdate(incident);
}

function handleRealtimeStatsUpdate(stats) {
    return dashboardRealtime.handleRealtimeStatsUpdate(stats);
}

function updateConnectionStatus(status) {
    return dashboardRealtime.updateConnectionStatus(status);
}

function closeSSE() {
    return dashboardRealtime.closeSSE();
}

// Initialize
const dashboardBootstrap = window.createDashboardBootstrap({
    api,
    applyAuthenticatedUser,
    closeSSE,
    forceLoginOnOpen: FORCE_LOGIN_ON_OPEN,
    getActiveSectionName,
    hideLogin,
    loadDashboard,
    resetToLoggedOutState: () => dashboardAuth.resetToLoggedOutState(),
    setupAdvancedFilters,
    setupExportButtons,
    setupHeaderOverflowMenu,
    setupMobileNavPanel,
    setupThemeToggle,
    setupTrendRangeToggle,
    syncHeaderDelight,
    syncHeaderPrimaryAction,
    syncMobileNavContext,
    syncMobileNavMoreState,
    syncSSEForCurrentContext,
    updateConnectionStatus,
    validateAllSectionBindings,
});

async function init() {
    return dashboardBootstrap.init();
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
    // Set initial theme
    const currentTheme = getCurrentTheme();
    setTheme(currentTheme);

    const themeToggleTargets = [
        document.getElementById('overflowThemeBtn'),
        document.getElementById('themeToggle'),
    ].filter(Boolean);
    themeToggleTargets.forEach((button) => {
        button.addEventListener('click', toggleTheme);
    });

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




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
let currentTrendRangeDays = 7;
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
    dashboard: 'Dashboard',
    installations: 'Registros',
    assets: 'Equipos',
    drivers: 'Drivers',
    incidents: 'Incidencias',
    audit: 'Auditoría',
    settings: 'Configuración',
};
const SECTION_SUBTITLES = {
    dashboard: 'Panorama general en tiempo real',
    installations: 'Seguimiento fino de registros operativos',
    assets: 'Inventario vivo con trazabilidad',
    drivers: 'Versionado centralizado de controladores',
    incidents: 'Atención de eventos con prioridad visible',
    audit: 'Trazas críticas y cumplimiento',
    settings: 'Preferencias operativas y atajos de gestión',
};
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
    settings: [
        'settingsUsername',
        'settingsRole',
        'settingsSyncStatus',
        'settingsOpenAuditBtn',
        'settingsLogoutBtn',
    ],
});
const MOBILE_NAV_OVERFLOW_SECTIONS = new Set(['drivers', 'audit', 'settings']);
const HEADER_PRIMARY_ACTIONS = {
    dashboard: { icon: 'add_circle', label: 'Nuevo registro', action: 'createRecord' },
    installations: { icon: 'add_circle', label: 'Nuevo registro', action: 'createRecord' },
    assets: { icon: 'qr_code_2', label: 'Nuevo equipo + QR', action: 'createAsset' },
    drivers: { icon: 'cloud_upload', label: 'Subir driver', action: 'pickDriverFile' },
    incidents: { icon: 'warning', label: 'Nueva incidencia', action: 'createIncident' },
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
    closeActionModal,
    createMaterialIconNode,
    escapeHtml,
    formatDurationToHHMM,
    formatDuration,
    getCurrentSelectedAssetId: () => currentSelectedAssetId,
    getCurrentSelectedInstallationId: () => currentSelectedInstallationId,
    getCurrentUser: () => currentUser,
    incidentChecklistPresets: INCIDENT_CHECKLIST_PRESETS,
    incidentEstimatedDurationMaxSeconds: INCIDENT_ESTIMATED_DURATION_MAX_SECONDS,
    incidentEstimatedDurationPresets: INCIDENT_ESTIMATED_DURATION_PRESETS,
    incidentStatusLabel,
    loadAssetDetail,
    loadInstallations,
    loadPhotoWithAuth,
    normalizeIncidentChecklistItems,
    normalizeIncidentStatus,
    normalizeSeverity,
    openActionConfirmModal,
    openActionModal,
    parseStrictInteger,
    readIncidentEstimatedDurationFromModal,
    recordAttentionStateIconName,
    renderContextualEmptyState,
    requireActiveSession,
    resolveIncidentEstimatedDurationSeconds,
    resolveIncidentRealDurationSeconds,
    resolveIncidentRuntimeStartMs,
    ensureIncidentRuntimeTicker,
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
    closeActionModal,
    createIncidentForAsset: (...args) => dashboardIncidents.createIncidentForAsset(...args),
    deriveAssetAttentionMetaFromIncidents: (...args) => dashboardIncidents.deriveAssetAttentionMetaFromIncidents(...args),
    escapeHtml,
    getCurrentSelectedAssetId: () => currentSelectedAssetId,
    makeTableRowKeyboardAccessible,
    normalizeAssetStatusLabel,
    normalizeIncidentStatus,
    openActionConfirmModal,
    openAssetLinkModal,
    parseStrictInteger,
    renderContextualEmptyState,
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
    createManualRecord: () => createManualRecordFromWeb(),
    getCharts: () => charts,
    getConnectionStatus,
    getCurrentTrendRangeDays: () => currentTrendRangeDays,
    getCurrentUser: () => currentUser,
    getLastCriticalIncidentsCount: () => lastCriticalIncidentsCount,
    isChartAvailable,
    kpiNumberAnimationMs: KPI_NUMBER_ANIMATION_MS,
    renderContextualEmptyState,
    requireActiveSession,
    setCurrentTrendRangeDays: (value) => {
        currentTrendRangeDays = Number.isInteger(value) ? value : currentTrendRangeDays;
    },
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
        currentSelectedInstallationId = null;
        currentAssetsData = [];
        currentSelectedAssetId = null;
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
    return dashboardAuth.updateSettingsSummary();
}

function applyAuthenticatedUser(user) {
    return dashboardAuth.applyAuthenticatedUser(user);
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
            const clientName = String(document.getElementById('actionRecordClient')?.value || '').trim();
            const brand = String(document.getElementById('actionRecordBrand')?.value || '').trim();
            const version = String(document.getElementById('actionRecordVersion')?.value || '').trim();
            const notes = String(document.getElementById('actionRecordNotes')?.value || '').trim();

            const result = await api.createRecord({
                client_name: clientName || 'Sin cliente',
                driver_brand: brand || 'N/A',
                driver_version: version || 'N/A',
                status: 'manual',
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

async function loadDashboard() {
    return dashboardOverview.loadDashboard();
}

function renderRecentInstallations(installations) {
    return dashboardOverview.renderRecentInstallations(installations);
}

// Advanced Filters Functions
function getActiveFilters() {
    const filters = {};
    
    const searchValue = document.getElementById('searchInput')?.value?.trim();
    const brandValue = document.getElementById('brandFilter')?.value;
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    
    if (searchValue) filters.search = searchValue;
    if (brandValue) filters.brand = brandValue;
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
    const explicit = Number(incident?.actual_duration_seconds);
    if (Number.isFinite(explicit) && explicit >= 0) {
        return Math.floor(explicit);
    }

    const normalizedStatus = normalizeIncidentStatus(incident?.incident_status);
    const parseIso = (value) => {
        const parsed = Date.parse(String(value || ''));
        return Number.isFinite(parsed) ? parsed : null;
    };

    const workStartedAtMs = resolveIncidentRuntimeStartMs(incident);
    const workEndedAtMs = parseIso(incident?.work_ended_at)
        ?? parseIso(incident?.resolved_at)
        ?? (normalizedStatus === 'in_progress' ? Date.now() : null);

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
        if (!liveRuntimeNodes.length) return;
        const nowMs = Date.now();
        for (const node of liveRuntimeNodes) {
            const startMs = Number(node.dataset.runtimeStartMs || '');
            if (!Number.isFinite(startMs) || startMs <= 0) continue;
            const runtimeSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
            node.textContent = `Tiempo real: ${formatDuration(runtimeSeconds)} (en curso)`;
        }
    }, 1000);
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
        html += `<td>${toExcelCell(buildRecordAttentionBadge(inst).label)}</td>`;
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
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    
    if (brandFilter) {
        brandFilter.addEventListener('change', () => {
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
        setElementTextWithMaterialIcon(createRecordBtn, 'edit_note', 'Nuevo registro manual');
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
        setElementTextWithMaterialIcon(qrButton, 'qr_code_2', 'QR equipo');
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
        setElementTextWithMaterialIcon(associateButton, 'link', 'Asociar equipo');
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
        setElementTextWithMaterialIcon(lookupButton, 'manage_search', 'Buscar equipo');
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
        setElementTextWithMaterialIcon(attentionBadge, attentionMeta.iconName, attentionMeta.label);
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
    if (normalized === 'resolved') return 'resolved';
    return 'open';
}

function incidentStatusLabel(value) {
    const normalized = normalizeIncidentStatus(value);
    if (normalized === 'resolved') return 'Resuelta';
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
async function viewPhoto(photoId) {
    return dashboardModals.viewPhoto(photoId);
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
    loadInstallations,
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

function handleRealtimeInstallation(installation) {
    return dashboardRealtime.handleRealtimeInstallation(installation);
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




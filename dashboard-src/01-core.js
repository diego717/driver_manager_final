// Domain: core (globals, utilities, registry helpers)

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
let installationsLoadInFlight = false;
let lastInstallationsLoadStartedAt = 0;
let currentSelectedInstallationId = null;
let currentAssetsData = [];
let currentSelectedAssetId = null;
let currentDriversData = [];
let selectedDriverFile = null;
const API_REQUEST_TIMEOUT_MS = 15000;
const API_RESPONSE_PARSE_TIMEOUT_MS = 15000;

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
const FORCE_LOGIN_ON_OPEN = false;
const INCIDENT_PHOTO_CONCURRENCY = 4;
const incidentPhotoThumbBlobUrls = new Set();
let currentPhotoModalBlobUrl = '';
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
const QR_EDIT_UNLOCK_TTL_MS = 10 * 60 * 1000;
let loginModalLastFocusedElement = null;
const LOGIN_MODAL_FOCUSABLE_SELECTOR =
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const dashboardModuleRegistry = Object.create(null);

function registerDashboardModule(name, moduleApi) {
    const moduleName = normalizeOptionalString(name, '');
    if (!moduleName) return;
    dashboardModuleRegistry[moduleName] = Object.freeze({ ...(moduleApi || {}) });
}

function exposeDashboardModules() {
    window.__DM_DASHBOARD_MODULES__ = Object.freeze({ ...dashboardModuleRegistry });
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
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
}

applyChartDefaults('light');

function normalizeOptionalString(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    const normalized = String(value).trim();
    return normalized || fallback;
}

async function parseApiResponsePayload(response) {
    if (!response) return null;
    if (typeof response.text !== 'function') {
        if (typeof response.json === 'function') {
            try {
                return await response.json();
            } catch {
                return null;
            }
        }
        return null;
    }

    const rawText = await response.text();
    if (!rawText) return null;

    const contentType = (response?.headers?.get?.('content-type') || '').toLowerCase();
    const looksLikeJson = contentType.includes('application/json');
    if (looksLikeJson) {
        try {
            return JSON.parse(rawText);
        } catch {
            return rawText;
        }
    }

    return rawText;
}

function extractApiErrorMessage(payload, response) {
    if (payload && typeof payload === 'object') {
        const fromNested = payload.error && typeof payload.error === 'object'
            ? payload.error.message
            : undefined;
        const fromMessage = payload.message;
        const message = fromNested || fromMessage;
        if (typeof message === 'string' && message.trim()) {
            return message.trim();
        }
    }

    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }

    return `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
}

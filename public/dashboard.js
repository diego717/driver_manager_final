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
const QR_EDIT_UNLOCK_TTL_MS = 10 * 60 * 1000;


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

async function parseApiResponsePayload(response) {
    const rawText = await response.text();
    if (!rawText) return null;

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
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

const api = {
    async request(endpoint, options = {}) {
        const baseHeaders = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        const sendRequest = async (useBearer = true) => {
            const authHeaders = useBearer && webAccessToken
                ? { Authorization: 'Bearer ' + webAccessToken }
                : {};
            const headers = {
                ...baseHeaders,
                ...authHeaders,
            };

            const response = await fetch(API_BASE + endpoint, {
                ...options,
                headers,
                credentials: 'include'
            });
            const payload = await parseApiResponsePayload(response);
            return { response, payload };
        };

        let { response, payload } = await sendRequest(true);

        // If bearer got stale (session rotated), retry once using only cookie session.
        if (response.status === 401 && webAccessToken) {
            const retryResult = await sendRequest(false);
            response = retryResult.response;
            payload = retryResult.payload;
            if (response.ok) {
                // Prefer cookie session from now on until next explicit login refreshes bearer.
                webAccessToken = '';
            }
        }
        
        if (response.status === 401) {
            currentUser = null;
            webAccessToken = '';
            closeSSE();
            resetProtectedViews();
            showLogin();
            throw new Error(extractApiErrorMessage(payload, response) || 'No autorizado');
        }

        if (!response.ok) {
            throw new Error(extractApiErrorMessage(payload, response));
        }

        if (payload === null) {
            return {};
        }

        return payload;
    },
    
    getInstallations(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request('/web/installations?' + query);
    },
    
    getStatistics() {
        return this.request('/web/statistics');
    },
    
    getAuditLogs(limit = 100) {
        return this.request('/web/audit-logs?limit=' + limit);
    },
    
    getIncidents(installationId) {
        return this.request('/web/installations/' + installationId + '/incidents');
    },

    createRecord(payload) {
        return this.request('/web/records', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    },

    createIncident(installationId, payload) {
        return this.request('/web/installations/' + installationId + '/incidents', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    },

    updateIncidentStatus(incidentId, payload) {
        return this.request('/web/incidents/' + incidentId + '/status', {
            method: 'PATCH',
            body: JSON.stringify(payload || {})
        });
    },

    resolveAsset(payload) {
        return this.request('/web/assets/resolve', {
            method: 'POST',
            body: JSON.stringify(payload || {})
        });
    },

    getAssets(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/web/assets?${query}`);
    },

    getAssetIncidents(assetId, params = {}) {
        const query = new URLSearchParams(params).toString();
        const suffix = query ? `?${query}` : '';
        return this.request(`/web/assets/${assetId}/incidents${suffix}`);
    },

    linkAssetToInstallation(assetId, payload) {
        return this.request('/web/assets/' + assetId + '/link-installation', {
            method: 'POST',
            body: JSON.stringify(payload || {})
        });
    },

    getDrivers(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(query ? `/web/drivers?${query}` : '/web/drivers');
    },

    async uploadDriver(file, metadata = {}) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('brand', String(metadata.brand || '').trim());
        formData.append('version', String(metadata.version || '').trim());
        formData.append('description', String(metadata.description || '').trim());

        const authHeaders = webAccessToken
            ? { Authorization: 'Bearer ' + webAccessToken }
            : {};

        const response = await fetch(API_BASE + '/web/drivers', {
            method: 'POST',
            headers: {
                ...authHeaders
            },
            body: formData,
            credentials: 'include'
        });

        const payload = await parseApiResponsePayload(response);

        if (response.status === 401) {
            currentUser = null;
            webAccessToken = '';
            closeSSE();
            resetProtectedViews();
            showLogin();
            throw new Error(extractApiErrorMessage(payload, response) || 'No autorizado');
        }
        if (!response.ok) {
            throw new Error(extractApiErrorMessage(payload, response));
        }

        return payload || {};
    },

    deleteDriver(key) {
        const encodedKey = encodeURIComponent(String(key || '').trim());
        return this.request('/web/drivers?key=' + encodedKey, {
            method: 'DELETE'
        });
    },

    async uploadIncidentPhoto(incidentId, file) {
        const authHeaders = webAccessToken
            ? { Authorization: 'Bearer ' + webAccessToken }
            : {};
        const response = await fetch(API_BASE + '/web/incidents/' + incidentId + '/photos', {
            method: 'POST',
            headers: {
                ...authHeaders,
                'Content-Type': file.type || 'image/jpeg',
                'X-File-Name': file.name || ('incident_' + incidentId + '.jpg')
            },
            body: file,
            credentials: 'include'
        });

        if (response.status === 401) {
            currentUser = null;
            webAccessToken = '';
            closeSSE();
            showLogin();
            throw new Error('No autorizado');
        }

        if (!response.ok) {
            let message = 'Error subiendo foto.';
            try {
                const payload = await response.json();
                message = payload?.error?.message || payload?.message || message;
            } catch (_err) {
                // Ignorar parseo de body en errores no JSON.
            }
            throw new Error(message);
        }

        return response.json();
    },
    
    getTrendData() {
        return this.request('/web/statistics/trend');
    },
    
    login(username, password) {
        return this.request('/web/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    },
    
    getMe() {
        return this.request('/web/auth/me');
    },

    logout() {
        return this.request('/web/auth/logout', { method: 'POST' });
    }
};

function showLogin() {
    resetProtectedViews();
    syncRoleBasedNavigationAccess();
    document.getElementById('loginModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function hideLogin() {
    document.getElementById('loginModal').classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('loginError').textContent = '';
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
        el.innerHTML = '<p class="loading">Inicia sesion para ver informacion.</p>';
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

async function createManualRecordFromWeb() {
    const clientName = prompt('Cliente (opcional):', currentUser?.username || '') ?? '';
    const brand = prompt('Marca/Equipo (opcional):', 'N/A');
    if (brand === null) return;
    const version = prompt('Version/Referencia (opcional):', 'N/A');
    if (version === null) return;
    const statusInput = prompt('Estado (manual/success/failed/unknown):', 'manual');
    if (statusInput === null) return;
    const status = String(statusInput).trim().toLowerCase() || 'manual';
    const validStatus = ['manual', 'success', 'failed', 'unknown'];
    if (!validStatus.includes(status)) {
        showNotification('Estado invalido. Usa: manual, success, failed o unknown.', 'error');
        return;
    }
    const notes = prompt('Notas (opcional):', '') ?? '';

    try {
        const result = await api.createRecord({
            client_name: (clientName || '').trim() || 'Sin cliente',
            driver_brand: (brand || '').trim() || 'N/A',
            driver_version: (version || '').trim() || 'N/A',
            status,
            notes: (notes || '').trim(),
            driver_description: 'Registro manual desde dashboard web',
            os_info: 'web',
            installation_time_seconds: 0
        });

        const recordId = result?.record?.id;
        showNotification(
            recordId ? `Registro manual creado (#${recordId})` : 'Registro manual creado.',
            'success'
        );
        await loadInstallations();

        if (recordId) {
            currentSelectedInstallationId = Number(recordId);
            await showIncidentsForInstallation(recordId);
        }
    } catch (err) {
        showNotification(`No se pudo crear registro: ${err.message || err}`, 'error');
    }
}

async function createIncidentFromWeb(installationId) {
    const targetId = Number.parseInt(String(installationId), 10);
    if (!Number.isInteger(targetId) || targetId <= 0) {
        showNotification('installation_id invalido para crear incidencia.', 'error');
        return;
    }

    const note = prompt('Detalle de la incidencia:', '');
    if (note === null) return;
    if (!String(note).trim()) {
        showNotification('La incidencia requiere una nota.', 'error');
        return;
    }

    const severityInput = prompt('Severidad (low/medium/high/critical):', 'medium');
    if (severityInput === null) return;
    const severity = normalizeSeverity(severityInput);

    const adjustmentRaw = prompt('Ajuste de tiempo en segundos (puede ser negativo):', '0');
    if (adjustmentRaw === null) return;
    const timeAdjustment = Number.parseInt(String(adjustmentRaw).trim(), 10);
    if (!Number.isInteger(timeAdjustment)) {
        showNotification('El ajuste de tiempo debe ser un numero entero.', 'error');
        return;
    }

    const applyToInstallation = confirm('Aplicar nota/ajuste al registro de instalacion?');

    try {
        const result = await api.createIncident(targetId, {
            note: String(note).trim(),
            reporter_username: currentUser?.username || 'web_user',
            time_adjustment_seconds: timeAdjustment,
            severity,
            source: 'web',
            apply_to_installation: applyToInstallation
        });

        const incidentId = result?.incident?.id;
        showNotification(
            incidentId
                ? `Incidencia creada (#${incidentId}) en instalacion #${targetId}`
                : `Incidencia creada en instalacion #${targetId}`,
            'success'
        );

        await showIncidentsForInstallation(targetId);
        await loadInstallations();
    } catch (err) {
        showNotification(`No se pudo crear incidencia: ${err.message || err}`, 'error');
    }
}

async function associateAssetFromWeb() {
    const externalCodeRaw = prompt('Código externo del equipo (QR/serie):', '') ?? '';
    const externalCode = String(externalCodeRaw || '').trim();
    if (!externalCode) {
        showNotification('Debes ingresar un código de equipo válido.', 'error');
        return;
    }

    const installationInput = prompt(
        'ID de instalación destino:',
        currentSelectedInstallationId ? String(currentSelectedInstallationId) : ''
    );
    if (installationInput === null) return;
    const installationId = Number.parseInt(String(installationInput).trim(), 10);
    if (!Number.isInteger(installationId) || installationId <= 0) {
        showNotification('installation_id inválido para asociación.', 'error');
        return;
    }

    const notes = prompt('Nota opcional de asociación:', '') ?? '';

    try {
        const resolved = await api.resolveAsset({
            external_code: externalCode
        });
        const assetId = Number(resolved?.asset?.id);
        if (!Number.isInteger(assetId) || assetId <= 0) {
            throw new Error('No se pudo resolver el ID del equipo.');
        }

        await api.linkAssetToInstallation(assetId, {
            installation_id: installationId,
            notes: String(notes || '').trim()
        });

        showNotification(
            `Equipo ${externalCode} asociado a instalación #${installationId}.`,
            'success'
        );
        currentSelectedInstallationId = installationId;
        await loadInstallations();
        await showIncidentsForInstallation(installationId);
    } catch (err) {
        showNotification(`No se pudo asociar equipo: ${err.message || err}`, 'error');
    }
}

async function openAssetLookupFromWeb() {
    if (!requireActiveSession()) return;
    const codeRaw = prompt('Codigo externo del equipo a consultar:', '') ?? '';
    const code = normalizeAssetCodeForQr(codeRaw);
    if (!code) {
        showNotification('Debes ingresar un codigo de equipo valido.', 'error');
        return;
    }

    try {
        const response = await api.getAssets({
            code,
            limit: 1
        });
        const asset = Array.isArray(response?.items) ? response.items[0] : null;
        if (!asset) {
            showNotification(`No existe equipo con codigo ${code}.`, 'info');
            return;
        }

        showQrModal({ type: 'asset', asset, readOnly: true });
        generateQrPreview({
            assetData: {
                external_code: normalizeAssetCodeForQr(asset.external_code || code),
                brand: normalizeAssetFormText(asset.brand, QR_MAX_BRAND_LENGTH),
                model: normalizeAssetFormText(asset.model, QR_MAX_MODEL_LENGTH),
                serial_number: normalizeAssetFormText(asset.serial_number, QR_MAX_SERIAL_LENGTH),
                client_name: normalizeAssetFormText(asset.client_name, QR_MAX_CLIENT_LENGTH),
                notes: normalizeAssetFormText(asset.notes, QR_MAX_NOTES_LENGTH),
            }
        });
        showNotification(`Equipo cargado: ${asset.external_code || code}`, 'success');
    } catch (err) {
        showNotification(`No se pudo consultar equipo: ${err.message || err}`, 'error');
    }
}

async function selectAndUploadIncidentPhoto(incidentId, installationId) {
    const targetIncidentId = Number.parseInt(String(incidentId), 10);
    if (!Number.isInteger(targetIncidentId) || targetIncidentId <= 0) {
        showNotification('incident_id invalido para subir foto.', 'error');
        return;
    }

    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
    picker.style.display = 'none';
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

function animateNumber(elementId, value) {
    const element = document.getElementById(elementId);
    element.style.opacity = '0';
    element.style.transform = 'translateY(10px)';
    
    setTimeout(() => {
        element.textContent = value;
        element.style.transition = 'all 0.3s ease';
        element.style.opacity = '1';
        element.style.transform = 'translateY(0)';
    }, 100);
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
            labels: ['Éxito', 'Fallido', 'Otro'],
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
                label: 'Instalaciones',
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
                    label: 'Instalaciones',
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
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'loading';
        emptyMessage.textContent = 'No hay instalaciones recientes';
        container.appendChild(emptyMessage);
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['ID', 'Cliente', 'Marca', 'Estado', 'Fecha'].forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');

    installations.forEach(inst => {
        const statusClass = inst.status || 'unknown';
        const statusIcon = inst.status === 'success' ? '✅' : inst.status === 'failed' ? '❌' : '❓';

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

        const dateCell = document.createElement('td');
        dateCell.textContent = new Date(inst.timestamp).toLocaleString('es-ES');

        row.append(idCell, clientCell, brandCell, statusCell, dateCell);
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
    
    clearBtn.style.display = hasFilters ? 'inline-flex' : 'none';
    
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
        removeSpan.textContent = '×';

        chip.append(labelSpan, valueSpan, removeSpan);
        chipsContainer.appendChild(chip);
    };

    if (filters.search) {
        appendChip('🔍', `"${filters.search}"`, 'search');
    }

    if (filters.brand) {
        appendChip('🏷️ Marca:', filters.brand, 'brand');
    }

    if (filters.status) {
        const statusLabel = filters.status === 'success' ? '✅ Éxito' : 
                           filters.status === 'failed' ? '❌ Fallido' : '❓ Desconocido';
        appendChip('📊 Estado:', statusLabel, 'status');
    }

    if (filters.startDate || filters.endDate) {
        const dateLabel = filters.startDate && filters.endDate ? 
            `${filters.startDate} - ${filters.endDate}` :
            filters.startDate ? `Desde: ${filters.startDate}` : `Hasta: ${filters.endDate}`;
        appendChip('📅', dateLabel, 'date');
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
function exportToCSV(data, filename = 'instalaciones.csv') {
    if (!data || !data.length) {
        showNotification('❌ No hay datos para exportar', 'error');
        return;
    }
    
    // CSV Headers
    const headers = ['ID', 'Cliente', 'Marca', 'Versión', 'Estado', 'Tiempo', 'Notas', 'Fecha'];
    
    // Convert data to CSV rows
    const rows = data.map(inst => [
        inst.id,
        inst.client_name || 'N/A',
        inst.driver_brand || 'N/A',
        inst.driver_version || 'N/A',
        inst.status || 'unknown',
        formatDuration(inst.installation_time_seconds || 0),
        inst.notes || '',
        inst.timestamp
    ]);
    
    // Combine headers and rows
    const csvContent = [
        headers.map(toCsvCell).join(','),
        ...rows.map(row => row.map(toCsvCell).join(','))
    ].join('\n');
    
    // Create and download file
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification(`✅ Exportado: ${filename}`, 'success');
}

function exportToExcel(data, filename = 'instalaciones.xls') {
    if (!data || !data.length) {
        showNotification('❌ No hay datos para exportar', 'error');
        return;
    }
    
    // Create HTML table for Excel
    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
    html += '<head><meta charset="UTF-8"><style>th { background-color: #06b6d4; color: white; font-weight: bold; }</style></head>';
    html += '<body><table border="1">';
    
    // Headers
    html += '<tr>';
    ['ID', 'Cliente', 'Marca', 'Versión', 'Estado', 'Tiempo', 'Notas', 'Fecha'].forEach(header => {
        html += `<th>${escapeHtml(header)}</th>`;
    });
    html += '</tr>';
    
    // Data rows
    data.forEach(inst => {
        html += '<tr>';
        html += `<td>${toExcelCell(inst.id)}</td>`;
        html += `<td>${toExcelCell(inst.client_name || 'N/A')}</td>`;
        html += `<td>${toExcelCell(inst.driver_brand || 'N/A')}</td>`;
        html += `<td>${toExcelCell(inst.driver_version || 'N/A')}</td>`;
        html += `<td>${toExcelCell(inst.status || 'unknown')}</td>`;
        html += `<td>${toExcelCell(formatDuration(inst.installation_time_seconds || 0))}</td>`;
        html += `<td>${toExcelCell((inst.notes || '').substring(0, 100))}</td>`;
        html += `<td>${toExcelCell(inst.timestamp)}</td>`;
        html += '</tr>';
    });
    
    html += '</table></body></html>';
    
    // Create and download file
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification(`✅ Exportado: ${filename}`, 'success');
}

function setupExportButtons() {
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        // Replace single export button with dropdown
        const filterActions = document.querySelector('.filter-actions');
        
        // Create export dropdown
        const exportDropdown = document.createElement('div');
        exportDropdown.className = 'export-dropdown';
        exportDropdown.style.cssText = 'position: relative; display: inline-block;';
        
        exportDropdown.innerHTML = `
            <button id="exportBtn" class="btn-secondary">📥 Exportar ▼</button>
            <div class="export-menu" style="
                display: none;
                position: absolute;
                right: 0;
                top: 100%;
                margin-top: 0.5rem;
                background: var(--bg-secondary);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                box-shadow: var(--shadow-lg);
                z-index: 100;
                min-width: 160px;
            ">
                <button class="export-option" data-format="csv" style="
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    width: 100%;
                    padding: 0.75rem 1rem;
                    background: none;
                    border: none;
                    color: var(--text-primary);
                    cursor: pointer;
                    font-size: 0.875rem;
                    text-align: left;
                ">📄 Exportar CSV</button>
                <button class="export-option" data-format="excel" style="
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    width: 100%;
                    padding: 0.75rem 1rem;
                    background: none;
                    border: none;
                    color: var(--text-primary);
                    cursor: pointer;
                    font-size: 0.875rem;
                    text-align: left;
                    border-top: 1px solid var(--border);
                ">📊 Exportar Excel</button>
            </div>
        `;
        
        // Replace old button
        exportBtn.replaceWith(exportDropdown);
        
        // Toggle menu
        const btn = exportDropdown.querySelector('#exportBtn');
        const menu = exportDropdown.querySelector('.export-menu');
        
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
        
        // Close on outside click
        document.addEventListener('click', () => {
            menu.style.display = 'none';
        });
        
        // Export options
        exportDropdown.querySelectorAll('.export-option').forEach(option => {
            option.addEventListener('click', () => {
                const format = option.dataset.format;
                if (format === 'csv') {
                    exportToCSV(currentInstallationsData);
                } else if (format === 'excel') {
                    exportToExcel(currentInstallationsData);
                }
                menu.style.display = 'none';
            });
            
            // Hover effect
            option.addEventListener('mouseenter', () => {
                option.style.background = 'var(--bg-hover)';
            });
            option.addEventListener('mouseleave', () => {
                option.style.background = 'none';
            });
        });
    }
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
        createRecordBtn.textContent = '📝 Registrar nuevo equipo';
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
        container.innerHTML = '<p class="error">❌ Error cargando instalaciones</p>';
        if (resultsCount) {
            resultsCount.textContent = 'Error al cargar';
        }
    }
}


function renderInstallationsTable(installations) {
    const container = document.getElementById('installationsTable');
    container.replaceChildren();

    if (!installations || !installations.length) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'loading';
        emptyMessage.textContent = 'No se encontraron instalaciones';
        container.appendChild(emptyMessage);
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['ID', 'Cliente', 'Marca', 'Versión', 'Estado', 'Tiempo', 'Notas', 'Fecha', 'QR'].forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');

    installations.forEach(inst => {
        const statusClass = inst.status || 'unknown';
        const statusIcon = inst.status === 'success' ? '✅' : inst.status === 'failed' ? '❌' : '❓';

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

        const versionCell = document.createElement('td');
        versionCell.textContent = inst.driver_version || 'N/A';

        const statusCell = document.createElement('td');
        const statusBadge = document.createElement('span');
        statusBadge.className = `badge ${statusClass}`;
        statusBadge.textContent = `${statusIcon} ${inst.status || 'unknown'}`;
        statusCell.appendChild(statusBadge);

        const timeCell = document.createElement('td');
        timeCell.textContent = formatDuration(inst.installation_time_seconds ?? 0);

        const notesCell = document.createElement('td');
        notesCell.textContent = inst.notes ? `${inst.notes.substring(0, 30)}...` : '-';

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

        row.append(idCell, clientCell, brandCell, versionCell, statusCell, timeCell, notesCell, dateCell, qrCell);
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
        container.innerHTML = '<p class="error">❌ Error cargando incidencias</p>';
    }
}

function normalizeAssetStatusLabel(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (!normalized) return 'active';
    return normalized;
}

function getSeverityIcon(severity) {
    if (severity === 'critical') return '🔴';
    if (severity === 'high') return '🟠';
    if (severity === 'medium') return '🟡';
    return '🔵';
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
    if (normalized === 'resolved') return '✅';
    if (normalized === 'in_progress') return '🟠';
    return '🟢';
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

async function updateIncidentStatusFromWeb(incident, targetStatus, options = {}) {
    if (!requireActiveSession()) return;
    const incidentId = Number.parseInt(String(incident?.id), 10);
    if (!Number.isInteger(incidentId) || incidentId <= 0) {
        showNotification('Incidencia inválida para actualizar estado.', 'error');
        return;
    }

    const normalizedStatus = normalizeIncidentStatus(targetStatus);
    let resolutionNote = '';
    if (normalizedStatus === 'resolved') {
        const noteInput = prompt('Nota de resolución (opcional):', incident?.resolution_note || '');
        if (noteInput === null) return;
        resolutionNote = String(noteInput || '').trim();
    }

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
        tableContainer.innerHTML = '<p class="error">❌ Error cargando equipos</p>';
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
        tableContainer.innerHTML = '<p class="error">Error cargando drivers</p>';
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
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'loading';
        emptyMessage.textContent = 'No hay drivers cargados.';
        container.appendChild(emptyMessage);
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Marca', 'Version', 'Archivo', 'Tamano', 'Subido', 'Acciones'].forEach((label) => {
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
        deleteBtn.style.marginLeft = '0.35rem';
        deleteBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const key = String(driver.key || '').trim();
            if (!key) return;
            if (!confirm(`Eliminar driver ${driver.brand || ''} ${driver.version || ''}?`)) return;
            try {
                await api.deleteDriver(key);
                showNotification('Driver eliminado', 'success');
                await loadDrivers();
            } catch (err) {
                showNotification(`No se pudo eliminar driver: ${err.message || err}`, 'error');
            }
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
        showNotification('La version es obligatoria.', 'error');
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
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'loading';
        emptyMessage.textContent = 'No se encontraron equipos';
        container.appendChild(emptyMessage);
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['ID', 'Codigo', 'Marca', 'Modelo', 'Serie', 'Cliente', 'Estado', 'Actualizado', 'Acciones'].forEach((label) => {
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
        incidentBtn.style.marginLeft = '0.35rem';
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
        let targetInstallationId = activeInstallationId;
        if (!Number.isInteger(targetInstallationId) || targetInstallationId <= 0) {
            const input = prompt('No hay instalacion activa para este equipo. ID de instalacion destino:', '');
            if (input === null) return;
            targetInstallationId = Number.parseInt(String(input).trim(), 10);
            if (!Number.isInteger(targetInstallationId) || targetInstallationId <= 0) {
                showNotification('installation_id invalido.', 'error');
                return;
            }
            await api.linkAssetToInstallation(numericAssetId, {
                installation_id: targetInstallationId,
                notes: 'Vinculo creado desde modulo Equipos',
            });
        }

        const noteInput = prompt('Detalle de la incidencia:', '');
        if (noteInput === null) return;
        const note = String(noteInput || '').trim();
        if (!note) {
            showNotification('La incidencia requiere una nota.', 'error');
            return;
        }
        const severityInput = prompt('Severidad (low/medium/high/critical):', 'medium');
        if (severityInput === null) return;
        const severity = normalizeSeverity(severityInput);
        const adjustmentInput = prompt('Ajuste de tiempo en segundos (puede ser negativo):', '0');
        if (adjustmentInput === null) return;
        const adjustment = Number.parseInt(String(adjustmentInput).trim(), 10);
        if (!Number.isInteger(adjustment)) {
            showNotification('El ajuste de tiempo debe ser entero.', 'error');
            return;
        }
        const applyToInstallation = confirm('Aplicar nota/ajuste tambien al registro de instalacion?');

        const result = await api.createIncident(targetInstallationId, {
            note,
            reporter_username: currentUser?.username || 'web_user',
            time_adjustment_seconds: adjustment,
            severity,
            source: 'web',
            apply_to_installation: applyToInstallation,
        });

        showNotification(
            `Incidencia #${result?.incident?.id || 'N/A'} creada para equipo #${numericAssetId}.`,
            'success',
        );
        await loadInstallations();
        await loadAssetDetail(numericAssetId, { keepSelection: true });
    } catch (err) {
        showNotification(`No se pudo crear incidencia del equipo: ${err.message || err}`, 'error');
    }
}

async function linkAssetFromDetail(assetId) {
    if (!requireActiveSession()) return;
    const installationInput = prompt('ID de instalacion a vincular con este equipo:', '');
    if (installationInput === null) return;
    const installationId = Number.parseInt(String(installationInput).trim(), 10);
    if (!Number.isInteger(installationId) || installationId <= 0) {
        showNotification('installation_id invalido.', 'error');
        return;
    }

    try {
        await api.linkAssetToInstallation(assetId, {
            installation_id: installationId,
            notes: 'Vinculo manual desde detalle de equipo',
        });
        showNotification(`Equipo vinculado a instalacion #${installationId}.`, 'success');
        await loadAssetDetail(assetId, { keepSelection: true });
    } catch (err) {
        showNotification(`No se pudo vincular equipo: ${err.message || err}`, 'error');
    }
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
            detailContainer.innerHTML = `<p class="error">❌ ${escapeHtml(err.message || String(err))}</p>`;
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
    linkBtn.textContent = 'Vincular instalacion';
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
        ['Codigo', asset.external_code || '-'],
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
            `Instalacion activa: #${activeLink.installation_id}` +
            (activeLink.installation_client_name ? ` (${activeLink.installation_client_name})` : '');
    } else {
        activeInfo.textContent = 'Sin instalacion activa vinculada.';
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
                `Instalacion #${link.installation_id} (${state})` +
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
        created.textContent = `🕐 ${new Date(incident.created_at).toLocaleString('es-ES')}`;
        header.append(left, created);

        const note = document.createElement('p');
        note.style.color = 'var(--text-secondary)';
        note.style.lineHeight = '1.6';
        note.textContent = incident.note || '';

        const statusMeta = document.createElement('small');
        statusMeta.className = 'asset-muted incident-meta-line';
        statusMeta.textContent = `Estado: ${buildIncidentStatusText(incident)}`;
        const resolutionMeta = document.createElement('small');
        resolutionMeta.className = 'asset-muted incident-meta-line';
        resolutionMeta.textContent = incident.resolution_note
            ? `Resolución: ${incident.resolution_note}`
            : 'Resolución: -';

        const sub = document.createElement('small');
        sub.className = 'asset-muted';
        sub.textContent =
            `Cliente: ${incident.installation_client_name || '-'} · ` +
            `${incident.installation_brand || '-'} ${incident.installation_version || ''}`.trim();

        card.append(header, note, statusMeta, resolutionMeta, sub);

        const statusActions = document.createElement('div');
        statusActions.className = 'incident-actions';
        const incidentStatus = normalizeIncidentStatus(incident.incident_status);

        const makeStatusBtn = (label, statusValue) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-secondary';
            button.textContent = label;
            const canUpdateIncident = canCurrentUserEditAssets();
            button.disabled = !canUpdateIncident || incidentStatus === statusValue;
            if (!canUpdateIncident) {
                button.title = 'Solo admin/super_admin puede cambiar estado de incidencias';
            }
            button.addEventListener('click', () => {
                void updateIncidentStatusFromWeb(incident, statusValue, {
                    assetId: Number.parseInt(String(asset.id), 10),
                    installationId: Number.parseInt(String(incident.installation_id), 10),
                });
            });
            return button;
        };
        statusActions.append(
            makeStatusBtn('Abrir', 'open'),
            makeStatusBtn('En curso', 'in_progress'),
            makeStatusBtn('Resolver', 'resolved'),
        );
        card.appendChild(statusActions);

        const uploadBtn = document.createElement('button');
        uploadBtn.className = 'btn-secondary';
        uploadBtn.textContent = 'Subir foto';
        uploadBtn.style.marginTop = '0.5rem';
        uploadBtn.addEventListener('click', () => {
            void selectAndUploadIncidentPhoto(incident.id, incident.installation_id);
        });
        card.appendChild(uploadBtn);

        if (incident.photos && incident.photos.length) {
            const photosGrid = document.createElement('div');
            photosGrid.className = 'photos-grid';
            for (const photo of incident.photos) {
                const photoUrl = await loadPhotoWithAuth(photo.id);
                if (photoUrl) {
                    const image = document.createElement('img');
                    image.src = photoUrl;
                    image.className = 'photo-thumb';
                    image.alt = 'Foto de incidencia';
                    image.addEventListener('click', () => viewPhoto(photo.id));
                    photosGrid.appendChild(image);
                }
            }
            card.appendChild(photosGrid);
        }

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
    header.style.marginBottom = '1.5rem';

    const heading = document.createElement('h3');
    heading.textContent = `⚠️ Incidencias de Instalación #${installationId}`;

    const backButton = document.createElement('button');
    backButton.className = 'btn-secondary';
    backButton.textContent = '← Volver';
    backButton.addEventListener('click', () => {
        document.querySelector('[data-section="installations"]')?.click();
    });

    const createIncidentBtn = document.createElement('button');
    createIncidentBtn.className = 'btn-primary';
    createIncidentBtn.textContent = '⚠️ Crear incidencia';
    createIncidentBtn.addEventListener('click', () => {
        void createIncidentFromWeb(installationId);
    });

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '0.5rem';
    actions.append(createIncidentBtn, backButton);

    header.append(heading, actions);
    container.appendChild(header);

    if (!incidents || !incidents.length) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'loading';
        emptyMessage.textContent = 'No hay incidencias para esta instalación';
        container.appendChild(emptyMessage);
        return;
    }

    for (const inc of incidents) {
        const severityIcon = inc.severity === 'critical' ? '🔴' : inc.severity === 'high' ? '🟠' : inc.severity === 'medium' ? '🟡' : '🔵';

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
        createdAt.textContent = `🕐 ${new Date(inc.created_at).toLocaleString('es-ES')}`;

        incidentHeader.append(leftMeta, createdAt);

        const note = document.createElement('p');
        note.style.color = 'var(--text-secondary)';
        note.style.lineHeight = '1.6';
        note.textContent = inc.note || '';

        const statusMeta = document.createElement('small');
        statusMeta.className = 'asset-muted incident-meta-line';
        statusMeta.textContent = `Estado: ${buildIncidentStatusText(inc)}`;
        const resolutionMeta = document.createElement('small');
        resolutionMeta.className = 'asset-muted incident-meta-line';
        resolutionMeta.textContent = inc.resolution_note
            ? `Resolución: ${inc.resolution_note}`
            : 'Resolución: -';

        incidentCard.append(incidentHeader, note, statusMeta, resolutionMeta);

        const statusActions = document.createElement('div');
        statusActions.className = 'incident-actions';
        const incidentStatus = normalizeIncidentStatus(inc.incident_status);

        const makeStatusBtn = (label, statusValue) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-secondary';
            button.textContent = label;
            const canUpdateIncident = canCurrentUserEditAssets();
            button.disabled = !canUpdateIncident || incidentStatus === statusValue;
            if (!canUpdateIncident) {
                button.title = 'Solo admin/super_admin puede cambiar estado de incidencias';
            }
            button.addEventListener('click', () => {
                void updateIncidentStatusFromWeb(inc, statusValue, {
                    installationId: Number.parseInt(String(installationId), 10),
                });
            });
            return button;
        };
        statusActions.append(
            makeStatusBtn('Abrir', 'open'),
            makeStatusBtn('En curso', 'in_progress'),
            makeStatusBtn('Resolver', 'resolved'),
        );
        incidentCard.appendChild(statusActions);

        const uploadPhotoBtn = document.createElement('button');
        uploadPhotoBtn.className = 'btn-secondary';
        uploadPhotoBtn.textContent = '📤 Subir foto';
        uploadPhotoBtn.style.marginTop = '0.5rem';
        uploadPhotoBtn.addEventListener('click', () => {
            void selectAndUploadIncidentPhoto(inc.id, installationId);
        });
        incidentCard.appendChild(uploadPhotoBtn);

        if (inc.photos && inc.photos.length) {
            const photosGrid = document.createElement('div');
            photosGrid.className = 'photos-grid';
            for (const photo of inc.photos) {
                const photoUrl = await loadPhotoWithAuth(photo.id);
                if (photoUrl) {
                    const image = document.createElement('img');
                    image.src = photoUrl;
                    image.className = 'photo-thumb';
                    image.dataset.photoId = String(photo.id);
                    image.alt = 'Foto de incidencia';
                    image.addEventListener('click', () => viewPhoto(photo.id));
                    photosGrid.appendChild(image);
                }
            }
            incidentCard.appendChild(photosGrid);
        }

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
            helper.textContent = 'Modo solo lectura. Para editar, usa "Habilitar edicion" y confirma tu contrasena.';
        } else if (isReadOnlyAssetView && !canEdit) {
            helper.textContent = 'Modo solo lectura. Solo admin/super_admin pueden editar este equipo.';
        } else if (qrModalReadOnly && qrModalEditUnlocked && hasTimedUnlock) {
            const minutesLeft = Math.max(1, Math.ceil(getQrEditSessionRemainingMs() / 60000));
            helper.textContent = `Edicion habilitada temporalmente (${minutesLeft} min restantes).`;
        } else {
            helper.textContent = 'Requisitos: marca o modelo, y numero de serie. El codigo externo se genera automaticamente desde serie si queda vacio.';
        }
    }
}

async function verifyCurrentUserPassword(password) {
    const candidate = String(password || '');
    if (!candidate.trim()) {
        throw new Error('Debes ingresar tu contrasena.');
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
        setQrPasswordModalError(error?.message || 'No se pudo validar la contrasena.');
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
            throw new Error('El ID de instalacion debe ser un entero positivo.');
        }
        return `dm://installation/${encodeURIComponent(String(installationId))}`;
    }

    const assetCode = normalizeAssetCodeForQr(assetData?.external_code || rawValue);
    if (!assetCode) {
        throw new Error('El codigo de equipo es obligatorio.');
    }
    return `dm://asset/${encodeURIComponent(assetCode)}`;
}

function buildQrImageUrl(payload) {
    const qrGenerator = window.DMQR;
    if (!qrGenerator || typeof qrGenerator.createPngDataUrl !== 'function') {
        throw new Error('Generador QR no disponible. Recarga la pagina e intenta de nuevo.');
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
        return `Tipo: Instalacion\nID: ${String(rawValue || '').trim()}`;
    }
    const details = assetData || {};
    return [
        'Tipo: Equipo',
        `Codigo externo: ${details.external_code || '-'}`,
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
        setQrError('Modo solo lectura. Habilita edicion y confirma tu contrasena para guardar cambios.');
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
            area.style.position = 'fixed';
            area.style.left = '-9999px';
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
                ctx.fillText('Driver Manager', infoX, y, infoWidth);

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
        printFrame.style.position = 'fixed';
        printFrame.style.right = '0';
        printFrame.style.bottom = '0';
        printFrame.style.width = '0';
        printFrame.style.height = '0';
        printFrame.style.border = '0';
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
        container.innerHTML = '<p class="error">❌ Error cargando logs</p>';
    }
}

function renderAuditLogs(logs) {
    const container = document.getElementById('auditLogs');
    const actionFilter = document.getElementById('auditActionFilter')?.value;
    container.replaceChildren();
    
    if (!logs || !logs.length) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'loading';
        emptyMessage.textContent = 'No hay logs de auditoría';
        container.appendChild(emptyMessage);
        return;
    }
    
    let filteredLogs = logs;
    if (actionFilter) {
        filteredLogs = logs.filter(log => log.action === actionFilter);
    }
    
    if (filteredLogs.length === 0) {
        const emptyFilteredMessage = document.createElement('p');
        emptyFilteredMessage.className = 'loading';
        emptyFilteredMessage.textContent = 'No hay logs para el filtro seleccionado';
        container.appendChild(emptyFilteredMessage);
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['🕐 Fecha', '📝 Acción', '👤 Usuario', '✅ Estado', '💻 Detalles'].forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');

    filteredLogs.forEach(log => {
        const successIcon = log.success ? '✅' : '❌';
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
        actionCode.style.background = 'var(--bg-card)';
        actionCode.style.padding = '0.25rem 0.5rem';
        actionCode.style.borderRadius = '4px';
        actionCode.style.fontSize = '0.75rem';
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
        detailsCell.style.color = 'var(--text-secondary)';
        detailsCell.style.fontSize = '0.875rem';
        detailsCell.textContent = details;

        row.append(dateCell, actionCell, userCell, statusCell, detailsCell);
        tbody.appendChild(row);
    });

    table.append(thead, tbody);
    container.appendChild(table);
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
        showNotification('✅ Bienvenido, ' + result.user.username + '!', 'success');
    } catch (err) {
        document.getElementById('loginError').textContent = '❌ Credenciales inválidas';
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
    showNotification('👋 Sesión cerrada', 'info');
});

document.getElementById('refreshBtn').addEventListener('click', () => {
    if (!requireActiveSession()) return;
    const btn = document.getElementById('refreshBtn');
    btn.style.transform = 'rotate(360deg)';
    btn.style.transition = 'transform 0.5s ease';
    
    setTimeout(() => {
        btn.style.transform = '';
        btn.style.transition = '';
    }, 500);
    
    loadDashboard();
    showNotification('🔄 Dashboard actualizado', 'info');
});

document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        if (!requireActiveSession()) return;
        const section = link.dataset.section;
        if (section === 'audit' && !canCurrentUserAccessAudit()) {
            showNotification('No tienes permisos para acceder a Auditoria.', 'error');
            return;
        }
        
        document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById(section + 'Section').classList.add('active');
        
        const titles = {
            dashboard: 'Dashboard',
            installations: 'Instalaciones',
            assets: 'Equipos',
            drivers: 'Drivers',
            incidents: 'Incidencias',
            audit: 'Auditoría'
        };
        document.getElementById('pageTitle').textContent = titles[section] || 'Dashboard';
        
        if (section === 'installations') loadInstallations();
        if (section === 'assets') loadAssets();
        if (section === 'drivers') loadDrivers();
        if (section === 'audit') loadAuditLogs();
        syncSSEForCurrentContext();
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
        showNotification('La edicion ya esta habilitada temporalmente.', 'info');
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

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('photoModal').classList.remove('active');
        closeQrPasswordModal();
        closeQrModal();
    }
    if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        loadDashboard();
    }
});

// Notification system
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 1rem;
        right: 1rem;
        padding: 1rem 1.5rem;
        background: ${type === 'success' ? 'rgba(16, 185, 129, 0.9)' : type === 'error' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(6, 182, 212, 0.9)'};
        color: white;
        border-radius: 12px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
        z-index: 9999;
        font-weight: 500;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

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
        showNotification('⚠️ Conexión en tiempo real perdida. Recarga la página para reconectar.', 'error');
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
            showNotification('🔌 Conectado en tiempo real', 'success');
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
    const statusIcon = installation.status === 'success' ? '✅' : installation.status === 'failed' ? '❌' : '💻';
    showNotification(`${statusIcon} Nueva instalación: ${installation.client_name || 'Sin cliente'}`, 'info');
    
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
    showNotification(`🗑️ Instalación #${installation.id} eliminada`, 'info');
}

function handleRealtimeIncident(incident) {
    const severityIcon = incident.severity === 'critical' ? '🔴' : incident.severity === 'high' ? '🟠' : '⚠️';
    showNotification(`${severityIcon} Nueva incidencia en instalación #${incident.installation_id}`, 'warning');
}

function handleRealtimeIncidentStatusUpdate(incident) {
    if (!incident || !incident.id) return;
    showNotification(
        `ℹ️ Incidencia #${incident.id} ahora está "${incidentStatusLabel(incident.incident_status)}".`,
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

    if (hiddenByScroll) {
        indicator.style.opacity = '0';
        indicator.style.transform = 'translateY(-12px) scale(0.96)';
        indicator.style.pointerEvents = 'none';
        return;
    }

    indicator.style.opacity = dimmed ? '0.6' : '1';
    indicator.style.transform = dimmed ? 'scale(0.9)' : 'scale(1)';
    indicator.style.pointerEvents = canReconnect ? 'auto' : 'none';
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
    const existingIndicator = document.getElementById('connectionStatus');
    if (
        existingIndicator &&
        connectionStatusLastRendered.status === status &&
        (now - connectionStatusLastRendered.at) < CONNECTION_STATUS_DEDUP_MS
    ) {
        return;
    }

    ensureConnectionStatusMobileBindings();
    connectionStatusLastRendered = { status, at: now };

    const statusConfig = {
        connected: { icon: '🟢', text: 'En vivo', color: 'rgba(16, 185, 129, 0.9)' },
        disconnected: { icon: '🔴', text: 'Desconectado', color: 'rgba(239, 68, 68, 0.9)' },
        reconnecting: { icon: '🟡', text: 'Reconectando...', color: 'rgba(245, 158, 11, 0.9)' },
        paused: { icon: '⏸️', text: 'En pausa', color: 'rgba(100, 116, 139, 0.9)' },
        failed: { icon: '⚫', text: 'Error de conexión', color: 'rgba(148, 163, 184, 0.9)' }
    };

    const config = statusConfig[status] || statusConfig.disconnected;
    const isMobileViewport = isMobileDashboardViewport();
    const canManualReconnect = status === 'disconnected' || status === 'failed' || status === 'paused';
    const compactMobileText = {
        connected: 'En vivo',
        disconnected: 'Sin red',
        reconnecting: 'Reconectando',
        paused: 'En pausa',
        failed: 'Sin conexion'
    };
    const displayText = isMobileViewport
        ? (compactMobileText[status] || config.text)
        : config.text;
    const showStatusIcon = !(isMobileViewport && status === 'reconnecting');

    const indicator = existingIndicator || document.createElement('div');
    indicator.id = 'connectionStatus';
    indicator.style.cssText = `
        position: fixed;
        ${isMobileViewport ? 'top: calc(env(safe-area-inset-top, 0px) + 0.625rem);' : 'bottom: 1rem;'}
        right: 0.625rem;
        ${isMobileViewport ? 'bottom: auto;' : ''}
        padding: ${isMobileViewport ? '0.375rem 0.625rem' : '0.5rem 1rem'};
        background: ${config.color};
        color: white;
        border-radius: 9999px;
        font-size: ${isMobileViewport ? '0.6875rem' : '0.75rem'};
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        z-index: ${isMobileViewport ? '950' : '9998'};
        max-width: ${isMobileViewport ? '55vw' : 'none'};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
        transition: opacity 0.25s ease, transform 0.25s ease, background-color 0.25s ease;
        cursor: ${canManualReconnect ? 'pointer' : 'default'};
    `;
    indicator.innerHTML = showStatusIcon
        ? `<span aria-hidden="true">${config.icon}</span><span>${displayText}</span>`
        : `<span>${displayText}</span>`;
    indicator.setAttribute('aria-live', 'polite');

    indicator.dataset.canReconnect = canManualReconnect ? '1' : '0';
    indicator.dataset.dimmed = '0';
    indicator.dataset.hiddenByScroll = '0';
    connectionStatusForceVisibleUntil = now + (isMobileViewport ? 3600 : 0);
    applyConnectionStatusVisualState(indicator);

    if (canManualReconnect) {
        indicator.onclick = () => {
            showNotification('🔄 Intentando reconectar...', 'info');
            sseReconnectAttempts = 0;
            syncSSEForCurrentContext(true);
        };
        indicator.title = 'Click para reconectar';
    } else {
        indicator.onclick = null;
        indicator.removeAttribute('title');
    }

    if (!existingIndicator) {
        document.body.appendChild(indicator);
    }

    if (connectionStatusScrollHideTimer) {
        clearTimeout(connectionStatusScrollHideTimer);
        connectionStatusScrollHideTimer = null;
    }
    if (isMobileViewport && !canManualReconnect) {
        const hideDelayMs = status === 'connected' ? 2600 : 4200;
        connectionStatusScrollHideTimer = setTimeout(() => {
            const liveIndicator = document.getElementById('connectionStatus');
            if (!liveIndicator) return;
            if (Date.now() < connectionStatusForceVisibleUntil) return;
            liveIndicator.dataset.hiddenByScroll = '1';
            applyConnectionStatusVisualState(liveIndicator);
        }, hideDelayMs);
    }

    if (status === 'connected') {
        const renderStamp = connectionStatusLastRendered.at;
        setTimeout(() => {
            const liveIndicator = document.getElementById('connectionStatus');
            if (!liveIndicator) return;
            if (
                connectionStatusLastRendered.status !== 'connected' ||
                connectionStatusLastRendered.at !== renderStamp
            ) {
                return;
            }
            liveIndicator.dataset.dimmed = '1';
            applyConnectionStatusVisualState(liveIndicator);
        }, 5000);
    }
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
                // Ignorar si no habia sesion activa.
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
    showNotification(`🎨 Tema ${themeLabel} activado`, 'info');
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

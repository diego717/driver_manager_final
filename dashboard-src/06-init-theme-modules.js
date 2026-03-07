// Domain: init-theme-modules (init, theme, module exports, bootstrapping)

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
            if (!me || typeof me !== 'object' || !normalizeOptionalString(me.username, '')) {
                throw new Error('No active web session');
            }
            applyAuthenticatedUser(me);
            hideLogin();
            loadDashboard();
            syncSSEForCurrentContext(true);
        }
    } catch (err) {
        if (isExpectedSessionBootstrapError(err)) {
            console.info('No active web session. Showing login.');
        } else {
            console.error('Error validating session:', err);
        }
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
    
    // Close SSE and cleanup blob URLs on page unload.
    window.addEventListener('beforeunload', () => {
        closeSSE();
        revokeIncidentPhotoThumbBlobUrls();
        closePhotoModal();
    });
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

registerDashboardModule('core', {
    normalizeOptionalString,
    parseApiResponsePayload,
    extractApiErrorMessage,
    escapeHtml,
    showNotification,
});

registerDashboardModule('api', {
    request: api.request.bind(api),
    getStatistics: api.getStatistics.bind(api),
    getTrendData: api.getTrendData.bind(api),
    getInstallations: api.getInstallations.bind(api),
    getIncidents: api.getIncidents.bind(api),
    getAssets: api.getAssets.bind(api),
    getDrivers: api.getDrivers.bind(api),
    getAuditLogs: api.getAuditLogs.bind(api),
    getMe: api.getMe.bind(api),
    login: api.login.bind(api),
    logout: api.logout.bind(api),
});

registerDashboardModule('auth', {
    showLogin,
    hideLogin,
    hasActiveSession,
    requireActiveSession,
    applyAuthenticatedUser,
    canCurrentUserAccessAudit,
});

registerDashboardModule('sections', {
    loadDashboard,
    loadInstallations,
    loadAssets,
    loadDrivers,
    loadAuditLogs,
    renderInstallationsTable,
    renderAssetsTable,
    renderDriversTable,
    renderIncidents,
    renderAuditLogs,
});

registerDashboardModule('realtime', {
    initSSE,
    closeSSE,
    updateConnectionStatus,
    syncSSEForCurrentContext,
});

registerDashboardModule('theme', {
    getCurrentTheme,
    setTheme,
    toggleTheme,
    setupThemeToggle,
    updateChartTheme,
});

registerDashboardModule('qr', {
    showQrModal,
    closeQrModal,
    generateQrPreview,
    saveAssetFromQrModal,
    copyQrPayloadToClipboard,
    downloadQrImage,
    printQrLabel,
});

exposeDashboardModules();

const isJsDomRuntime = typeof navigator !== 'undefined'
    && /jsdom/i.test(String(navigator.userAgent || ''));
const shouldAutoInit = window.__DM_DISABLE_AUTO_INIT__ !== true && !isJsDomRuntime;

if (shouldAutoInit) {
    if (!window.__DM_DASHBOARD_INIT_DONE__) {
        window.__DM_DASHBOARD_INIT_DONE__ = true;
        init();
    } else {
        console.warn('[init] dashboard.js ya estaba inicializado; se evita doble registro de listeners.');
    }
}

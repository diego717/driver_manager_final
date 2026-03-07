// Domain: realtime (notifications + SSE lifecycle)

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    const normalizedType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
    notification.className = `toast-notification toast-${normalizedType}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('is-leaving');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
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
    showNotification(`🗑️ Registro #${installation.id} eliminado`, 'info');
}

function handleRealtimeIncident(incident) {
    const severityIcon = incident.severity === 'critical' ? '🔴' : incident.severity === 'high' ? '🟠' : '⚠️';
    showNotification(`${severityIcon} Nueva incidencia en registro #${incident.installation_id}`, 'warning');
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
    if (typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia('(max-width: 768px)').matches;
}

function applyConnectionStatusVisualState(indicator) {
    if (!indicator) return;
    const hiddenByScroll = indicator.dataset.hiddenByScroll === '1';
    const dimmed = indicator.dataset.dimmed === '1';
    const canReconnect = indicator.dataset.canReconnect === '1';
    indicator.classList.toggle('is-hidden-scroll', hiddenByScroll);
    indicator.classList.toggle('is-dimmed', !hiddenByScroll && dimmed);
    indicator.classList.toggle('is-clickable', !hiddenByScroll && canReconnect);
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
    indicator.className = `connection-status status-${status}${isMobileViewport ? ' is-mobile' : ''}`;
    indicator.dataset.status = status;
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

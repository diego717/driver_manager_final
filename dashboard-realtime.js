(function attachDashboardRealtimeFactory(global) {
    function createDashboardRealtime(options) {
        let eventSource = null;
        let eventSourceEpoch = 0;
        let sseReconnectTimer = null;
        let sseReconnectAttempts = 0;
        let sseLastConnectAttemptAt = 0;
        let connectionStatusLastRendered = { status: '', at: 0 };

        function getConnectionStatus() {
            return connectionStatusLastRendered?.status || 'paused';
        }

        function canUseRealtimeNow() {
            if (!options.getCurrentUser()) return false;
            if (document.visibilityState !== 'visible') return false;
            return options.activeSections.has(options.getActiveSectionName());
        }

        function scheduleSSEReconnect(preferredDelayMs = null) {
            if (!canUseRealtimeNow()) {
                return;
            }

            if (sseReconnectAttempts >= options.maxReconnectAttempts) {
                console.error('[SSE] Max reconnection attempts reached');
                updateConnectionStatus('failed');
                options.showNotification(
                    'Conexi\u00f3n en tiempo real perdida. Recarga la p\u00e1gina para reconectar.',
                    'error',
                );
                return;
            }

            sseReconnectAttempts++;
            const exponentialDelay = Math.min(
                options.maxReconnectDelayMs,
                options.baseReconnectDelayMs * Math.pow(2, sseReconnectAttempts - 1),
            );
            const normalizedPreferredDelay = Number.isFinite(preferredDelayMs) && preferredDelayMs > 0
                ? Math.min(preferredDelayMs, options.maxReconnectDelayMs)
                : exponentialDelay;
            const jitterMs = Math.floor(Math.random() * 600);
            const delayMs = Math.max(options.baseReconnectDelayMs, normalizedPreferredDelay) + jitterMs;

            console.log(
                `[SSE] Reconnecting in ${delayMs}ms... ` +
                `Attempt ${sseReconnectAttempts}/${options.maxReconnectAttempts}`,
            );
            updateConnectionStatus('reconnecting');

            if (sseReconnectTimer) {
                clearTimeout(sseReconnectTimer);
            }
            sseReconnectTimer = setTimeout(() => {
                initSSE();
            }, delayMs);
        }

        let lastSyncAt = 0;
        const SYNC_COOLDOWN_MS = 1000;
        let lastDashboardRefreshAt = 0;
        const DASHBOARD_REFRESH_THROTTLE_MS = 1200;

        function refreshDashboardIfActive() {
            if (!options.isSectionActive('dashboard')) return;
            const now = Date.now();
            if (now - lastDashboardRefreshAt < DASHBOARD_REFRESH_THROTTLE_MS) {
                return;
            }
            lastDashboardRefreshAt = now;
            void options.loadDashboard({ followupDelayMs: 1200 });
        }

        function renderVisibleResultsCount(container, visibleCount, totalCount) {
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
            container.append(visibleNode, ' de ', totalNode, ` resultado${normalizedTotal !== 1 ? 's' : ''}`);
        }

        function syncSSEForCurrentContext(forceReconnect = false) {
            if (!canUseRealtimeNow()) {
                closeSSE();
                updateConnectionStatus('paused');
                return;
            }

            const now = Date.now();
            if (forceReconnect && (now - lastSyncAt < SYNC_COOLDOWN_MS)) {
                console.log('[SSE] Sync throttled');
                return;
            }
            if (forceReconnect) {
                lastSyncAt = now;
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
            if (now - sseLastConnectAttemptAt < options.minConnectGapMs) {
                if (eventSource) {
                    return;
                }
                scheduleSSEReconnect(options.minConnectGapMs);
                return;
            }
            sseLastConnectAttemptAt = now;

            if (sseReconnectTimer) {
                clearTimeout(sseReconnectTimer);
                sseReconnectTimer = null;
            }
            if (eventSource) {
                eventSource.onopen = null;
                eventSource.onmessage = null;
                eventSource.onerror = null;
                eventSource.close();
                eventSource = null;
            }

            try {
                const sseUrl = `${options.apiBase}/web/events`;
                const nextEventSource = new EventSource(sseUrl, { withCredentials: true });
                const nextEpoch = eventSourceEpoch + 1;
                eventSourceEpoch = nextEpoch;
                eventSource = nextEventSource;

                nextEventSource.onopen = () => {
                    if (eventSource !== nextEventSource || eventSourceEpoch !== nextEpoch) return;
                    console.log('[SSE] Connection established');
                    sseReconnectAttempts = 0;
                    updateConnectionStatus('connected');
                };

                nextEventSource.onmessage = (event) => {
                    if (eventSource !== nextEventSource || eventSourceEpoch !== nextEpoch) return;
                    try {
                        const data = JSON.parse(event.data);
                        handleSSEMessage(data);
                    } catch (error) {
                        console.error('[SSE] Error parsing message:', error);
                    }
                };

                nextEventSource.onerror = (error) => {
                    if (eventSource !== nextEventSource || eventSourceEpoch !== nextEpoch) return;
                    console.error('[SSE] Connection error:', error);
                    if (eventSource) {
                        eventSource.onopen = null;
                        eventSource.onmessage = null;
                        eventSource.onerror = null;
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
            } catch (error) {
                console.error('[SSE] Error initializing:', error);
                scheduleSSEReconnect();
            }
        }

        function handleSSEMessage(data) {
            switch (data.type) {
                case 'connected':
                    console.log('[SSE]', data.message);
                    options.showNotification('Conectado en tiempo real', 'success');
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
                    options.handleRealtimeIncident(data.incident);
                    break;
                case 'incident_status_updated':
                    options.handleRealtimeIncidentStatusUpdate(data.incident);
                    break;
                case 'incident_deleted':
                    options.handleRealtimeIncidentStatusUpdate({
                        ...(data?.incident || {}),
                        incident_status: 'resolved',
                    });
                    if (options.isSectionActive('incidents')) {
                        const installationId = Number(data?.incident?.installation_id);
                        if (Number.isInteger(installationId) && installationId > 0) {
                            options.showIncidentsForInstallation(installationId);
                        }
                    }
                    if (options.isSectionActive('dashboard')) {
                        refreshDashboardIfActive();
                    }
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

        function handleRealtimeInstallation(installation, config = {}) {
            const currentInstallationsData = options.getCurrentInstallationsData();
            const installationId = Number.parseInt(String(installation?.id || ''), 10);
            const alreadyTracked = Array.isArray(currentInstallationsData)
                && Number.isInteger(installationId)
                && installationId > 0
                && currentInstallationsData.some((item) => Number.parseInt(String(item?.id || ''), 10) === installationId);

            if (Array.isArray(currentInstallationsData)) {
                const nextInstallations = currentInstallationsData.filter(
                    (item) => Number.parseInt(String(item?.id || ''), 10) !== installationId,
                );
                nextInstallations.unshift(installation);
                options.setCurrentInstallationsData(nextInstallations);

                if (options.isSectionActive('installations')) {
                    options.renderInstallationsTable(nextInstallations.slice(0, 50));

                    const resultsCount = document.getElementById('resultsCount');
                    if (resultsCount) {
                        const count = nextInstallations.length;
                        renderVisibleResultsCount(resultsCount, Math.min(count, 50), count);
                    }
                }
            }

            if (config.notify !== false && !alreadyTracked) {
                const attentionState = options.normalizeRecordAttentionState(installation?.attention_state);
                const statusIcon = attentionState === 'critical'
                    ? 'CRIT'
                    : attentionState === 'in_progress'
                        ? 'CURSO'
                        : attentionState === 'open'
                            ? 'ABIERTA'
                            : 'REG';
                options.showNotification(
                    `${statusIcon} Nuevo registro: ${installation?.client_name || 'Sin cliente'}`,
                    'info',
                );
            }

            if (!alreadyTracked && options.isSectionActive('dashboard')) {
                setTimeout(() => {
                    refreshDashboardIfActive();
                }, 1000);
            }
        }

        function handleRealtimeInstallationUpdate(installation) {
            const currentInstallationsData = options.getCurrentInstallationsData();
            if (!Array.isArray(currentInstallationsData)) return;

            const nextInstallations = currentInstallationsData.slice();
            const index = nextInstallations.findIndex((item) => item.id === installation.id);
            if (index === -1) return;

            nextInstallations[index] = installation;
            options.setCurrentInstallationsData(nextInstallations);
            if (options.isSectionActive('installations')) {
                options.renderInstallationsTable(nextInstallations);
            }
            refreshDashboardIfActive();
        }

        function handleRealtimeInstallationDeleted(installation) {
            if (!installation?.id) return;

            const currentInstallationsData = options.getCurrentInstallationsData();
            if (Array.isArray(currentInstallationsData)) {
                const nextInstallations = currentInstallationsData.filter((item) => item.id !== installation.id);
                options.setCurrentInstallationsData(nextInstallations);
                if (options.isSectionActive('installations')) {
                    options.renderInstallationsTable(nextInstallations);
                }
            }

            options.showNotification(`Registro #${installation.id} eliminado`, 'info');
            refreshDashboardIfActive();
        }

        function handleRealtimeStatsUpdate(stats) {
            if (!options.isSectionActive('dashboard')) return;

            options.updateStats(stats);
            options.renderSuccessChart(stats);
            options.renderBrandChart(stats);
            void options.renderTrendChart(options.getCurrentTrendRangeDays());
        }

        function updateConnectionStatus(status) {
            const now = Date.now();
            if (
                connectionStatusLastRendered.status === status &&
                (now - connectionStatusLastRendered.at) < options.connectionStatusDedupMs
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

            options.syncHeaderDelight(options.getActiveSectionName() || 'dashboard', normalizedStatus);
        }

        function closeSSE() {
            if (eventSource) {
                eventSource.onopen = null;
                eventSource.onmessage = null;
                eventSource.onerror = null;
                eventSource.close();
                eventSource = null;
            }
            if (sseReconnectTimer) {
                clearTimeout(sseReconnectTimer);
                sseReconnectTimer = null;
            }
            eventSourceEpoch += 1;

            connectionStatusLastRendered = { status: '', at: 0 };
            const indicator = document.getElementById('connectionStatus');
            if (indicator) {
                indicator.remove();
            }
        }

        return {
            canUseRealtimeNow,
            closeSSE,
            getConnectionStatus,
            handleRealtimeIncident: options.handleRealtimeIncident,
            handleRealtimeIncidentStatusUpdate: options.handleRealtimeIncidentStatusUpdate,
            handleRealtimeInstallation,
            handleRealtimeInstallationDeleted,
            handleRealtimeInstallationUpdate,
            handleRealtimeStatsUpdate,
            handleSSEMessage,
            scheduleSSEReconnect,
            syncSSEForCurrentContext,
            updateConnectionStatus,
        };
    }

    global.createDashboardRealtime = createDashboardRealtime;
})(window);

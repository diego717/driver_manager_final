(function attachDashboardRealtimeFactory(global) {
    function createDashboardRealtime(options) {
        let eventSource = null;
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
            if (now - sseLastConnectAttemptAt < options.minConnectGapMs) {
                scheduleSSEReconnect(options.minConnectGapMs);
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
                const sseUrl = `${options.apiBase}/web/events`;
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
                    } catch (error) {
                        console.error('[SSE] Error parsing message:', error);
                    }
                };

                eventSource.onerror = (error) => {
                    console.error('[SSE] Connection error:', error);
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
            const currentInstallationsData = options.getCurrentInstallationsData();
            if (Array.isArray(currentInstallationsData) && options.isSectionActive('installations')) {
                const nextInstallations = [installation, ...currentInstallationsData];
                options.setCurrentInstallationsData(nextInstallations);
                options.renderInstallationsTable(nextInstallations.slice(0, 50));

                const resultsCount = document.getElementById('resultsCount');
                if (resultsCount) {
                    const count = nextInstallations.length;
                    resultsCount.innerHTML =
                        `Mostrando <span class="count">${Math.min(count, 50)}</span> ` +
                        `de <span class="count">${count}</span> resultado${count !== 1 ? 's' : ''}`;
                }
            }

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

            if (options.isSectionActive('dashboard')) {
                setTimeout(() => {
                    void options.loadDashboard();
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
                eventSource.close();
                eventSource = null;
            }
            if (sseReconnectTimer) {
                clearTimeout(sseReconnectTimer);
                sseReconnectTimer = null;
            }

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

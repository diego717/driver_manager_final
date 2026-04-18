(function initPublicTracking(globalScope) {
    const documentRef = globalScope.document;
    const POLLING_INTERVAL_MS = 15000;
    let pollingTimerId = null;
    let pollingEnabled = false;
    let activeLoadRequestId = 0;
    let eventSource = null;
    let eventSourceEnabled = false;
    let hasInitialized = false;

    function resolveEffectiveTheme() {
        const explicitTheme = String(documentRef.documentElement?.dataset?.theme || '').trim().toLowerCase();
        if (explicitTheme === 'dark' || explicitTheme === 'light') {
            return explicitTheme;
        }
        if (typeof globalScope.matchMedia === 'function') {
            try {
                return globalScope.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            } catch {
                return 'light';
            }
        }
        return 'light';
    }

    function buildThemeTogglePath(targetTheme) {
        try {
            const url = new URL(globalScope.location.href);
            url.searchParams.set('theme', targetTheme);
            return `${url.pathname}${url.search}${url.hash}`;
        } catch {
            return `?theme=${encodeURIComponent(targetTheme)}`;
        }
    }

    function updateThemeToggleControl(currentTheme) {
        const toggleEl = documentRef.getElementById('publicTrackingThemeToggleBtn');
        if (!toggleEl || String(toggleEl.tagName || '').toLowerCase() !== 'a') return;
        const targetTheme = String(currentTheme || '').toLowerCase() === 'dark' ? 'light' : 'dark';
        const nextLabel = targetTheme === 'dark' ? 'Usar modo oscuro' : 'Usar modo claro';
        toggleEl.dataset.targetTheme = targetTheme;
        toggleEl.textContent = nextLabel;
        toggleEl.setAttribute('aria-label', nextLabel);
        toggleEl.setAttribute('href', buildThemeTogglePath(targetTheme));
    }

    function applyTheme(nextTheme, options = {}) {
        const { syncUrl = true } = options;
        const normalizedTheme = String(nextTheme || '').trim().toLowerCase();
        if (normalizedTheme !== 'dark' && normalizedTheme !== 'light') return;
        if (documentRef.documentElement) {
            documentRef.documentElement.setAttribute('data-theme', normalizedTheme);
        }
        if (syncUrl && globalScope.history && typeof globalScope.history.replaceState === 'function') {
            const targetPath = buildThemeTogglePath(normalizedTheme);
            globalScope.history.replaceState(null, '', targetPath);
        }
        updateThemeToggleControl(normalizedTheme);
    }

    function bindThemeToggleControl() {
        const toggleEl = documentRef.getElementById('publicTrackingThemeToggleBtn');
        if (!toggleEl || String(toggleEl.tagName || '').toLowerCase() !== 'a') return;
        updateThemeToggleControl(resolveEffectiveTheme());
        toggleEl.addEventListener('click', (event) => {
            const targetTheme = String(toggleEl.dataset.targetTheme || '').trim().toLowerCase();
            if (targetTheme !== 'dark' && targetTheme !== 'light') return;
            event.preventDefault();
            applyTheme(targetTheme, { syncUrl: true });
        });
    }

    function setConnectionState(state) {
        const badgeEl = documentRef.getElementById('publicTrackingConnectionBadge');
        if (!badgeEl) return;
        const normalized = String(state || 'idle').trim().toLowerCase();
        badgeEl.dataset.state = normalized;
        if (normalized === 'live') {
            badgeEl.textContent = 'En vivo';
            return;
        }
        if (normalized === 'polling') {
            badgeEl.textContent = 'Sincronizando';
            return;
        }
        if (normalized === 'offline') {
            badgeEl.textContent = 'Sin enlace';
            return;
        }
        badgeEl.textContent = 'Actualizando';
    }

    function resolveTrackingToken() {
        const bodyToken = String(documentRef.body?.dataset?.trackingToken || '').trim();
        if (bodyToken) return bodyToken;
        const parts = String(globalScope.location?.pathname || '').split('/').filter(Boolean);
        if (parts[0] === 'track' && parts[1]) {
            return decodeURIComponent(parts[1]);
        }
        return '';
    }

    function statusTone(tracking) {
        const normalized = String(tracking?.public_status || '').trim().toLowerCase();
        if (normalized === 'cerrado' || normalized === 'resuelto') return 'success';
        if (normalized === 'demorado') return 'warning';
        if (tracking?.reopened) return 'reopened';
        return 'neutral';
    }

    function humanizeStatusLabel(tracking) {
        return String(tracking?.public_status_label || tracking?.public_status || 'Sin datos');
    }

    function ensureBrandLockup() {
        const headEl = documentRef.querySelector('.public-tracking-head');
        if (!(headEl instanceof HTMLElement)) return;
        if (headEl.querySelector('.public-tracking-brand')) return;

        const brand = documentRef.createElement('div');
        brand.className = 'public-tracking-brand';
        brand.setAttribute('aria-label', 'SiteOps');
        brand.innerHTML = `
            <div class="public-tracking-brand-mark" aria-hidden="true">
                <span class="public-tracking-brand-ring"></span>
                <span class="public-tracking-brand-axis public-tracking-brand-axis-horizontal"></span>
                <span class="public-tracking-brand-axis public-tracking-brand-axis-vertical"></span>
                <span class="public-tracking-brand-node"></span>
            </div>
            <div class="public-tracking-brand-copy">
                <strong>SiteOps</strong>
                <span>Public Tracking</span>
            </div>
        `;

        headEl.prepend(brand);
    }

    function setStatus(title, message, tone = 'neutral') {
        ensureBrandLockup();
        const titleEl = documentRef.getElementById('publicTrackingTitle');
        const messageEl = documentRef.getElementById('publicTrackingMessage');
        if (titleEl) titleEl.textContent = title;
        if (messageEl) {
            messageEl.textContent = message;
            messageEl.dataset.tone = tone;
        }
    }

    function renderSummary(tracking) {
        const summaryEl = documentRef.getElementById('publicTrackingSummary');
        const badgeEl = documentRef.getElementById('publicTrackingStatusBadge');
        const transitionEl = documentRef.getElementById('publicTrackingTransition');
        const textEl = documentRef.getElementById('publicTrackingSummaryText');
        if (!summaryEl || !badgeEl || !textEl) return;

        summaryEl.hidden = false;
        summaryEl.dataset.tone = statusTone(tracking);
        badgeEl.textContent = humanizeStatusLabel(tracking);
        badgeEl.dataset.tone = statusTone(tracking);
        if (transitionEl) {
            const transitionText = String(tracking?.public_transition_label || '').trim();
            transitionEl.hidden = !transitionText;
            transitionEl.textContent = transitionText;
        }
        textEl.textContent = String(tracking?.public_message || 'Seguimiento disponible.');
    }

    function renderMeta(tracking) {
        const metaEl = documentRef.getElementById('publicTrackingMeta');
        if (!metaEl) return;
        const metaItems = [];
        metaItems.push(`Referencia: ${tracking.public_reference || `Servicio #${tracking.installation_id}`}`);
        metaItems.push(`Estado actual: ${humanizeStatusLabel(tracking)}`);
        if (tracking.public_transition_label) {
            metaItems.push(`Cambio reciente: ${tracking.public_transition_label}`);
        }
        if (tracking.reopened) {
            metaItems.push('Seguimiento: caso reabierto');
        }
        if (tracking.last_updated_at) {
            metaItems.push(`Ultima actualizacion: ${new Date(tracking.last_updated_at).toLocaleString('es-ES')}`);
        }
        metaEl.replaceChildren();
        metaItems.forEach((item) => {
            const chip = documentRef.createElement('span');
            chip.className = 'public-tracking-chip';
            chip.textContent = item;
            metaEl.appendChild(chip);
        });
    }

    function renderTimeline(tracking) {
        const timelineEl = documentRef.getElementById('publicTrackingTimeline');
        if (!timelineEl) return;
        timelineEl.replaceChildren();
        const milestones = Array.isArray(tracking?.milestones) ? tracking.milestones : [];
        if (!milestones.length) {
            const emptyState = documentRef.createElement('p');
            emptyState.className = 'public-tracking-empty';
            emptyState.textContent = 'Todavia no hay hitos publicos disponibles.';
            timelineEl.appendChild(emptyState);
            return;
        }
        milestones.forEach((milestone) => {
            const item = documentRef.createElement('article');
            item.className = 'public-tracking-timeline-item';
            item.dataset.type = String(milestone.type || 'update');

            const label = documentRef.createElement('strong');
            label.textContent = String(milestone.label || 'Actualizacion');

            const time = documentRef.createElement('span');
            time.className = 'public-tracking-timeline-time';
            time.textContent = milestone.timestamp
                ? new Date(milestone.timestamp).toLocaleString('es-ES')
                : 'Sin fecha';

            item.append(label, time);
            timelineEl.appendChild(item);
        });
    }

    function clearPollingTimer() {
        if (pollingTimerId !== null) {
            globalScope.clearTimeout(pollingTimerId);
            pollingTimerId = null;
        }
    }

    function schedulePolling() {
        clearPollingTimer();
        if (!pollingEnabled || eventSourceEnabled || documentRef.hidden) {
            return;
        }
        setConnectionState('polling');
        pollingTimerId = globalScope.setTimeout(() => {
            void loadTrackingState({ silent: true });
        }, POLLING_INTERVAL_MS);
    }

    function closeEventSource() {
        if (eventSource && typeof eventSource.close === 'function') {
            eventSource.close();
        }
        eventSource = null;
        eventSourceEnabled = false;
    }

    function renderTracking(tracking) {
        ensureBrandLockup();
        setStatus(
            tracking.public_reference || `Servicio #${tracking.installation_id}`,
            tracking.public_message || 'Seguimiento disponible.',
            statusTone(tracking),
        );
        renderSummary(tracking);
        renderMeta(tracking);
        renderTimeline(tracking);
    }

    function startEventStream() {
        const token = resolveTrackingToken();
        if (!token || typeof globalScope.EventSource !== 'function' || eventSource) {
            return false;
        }

        try {
            const nextEventSource = new globalScope.EventSource(`/track/${encodeURIComponent(token)}/events`);
            eventSource = nextEventSource;
            eventSourceEnabled = true;
            setConnectionState('live');
            clearPollingTimer();

            nextEventSource.onmessage = (event) => {
                let payload = {};
                try {
                    payload = JSON.parse(String(event?.data || '{}'));
                } catch {
                    return;
                }

                if (payload?.tracking && typeof payload.tracking === 'object') {
                    renderTracking(payload.tracking);
                }

                if (payload?.type === 'tracking_revoked' || payload?.type === 'tracking_expired') {
                    setStatus('Enlace no disponible', payload?.message || 'Este enlace ya no esta disponible.', 'error');
                    setConnectionState('offline');
                    closeEventSource();
                    pollingEnabled = false;
                    clearPollingTimer();
                }

                if (payload?.type === 'snapshot_unavailable') {
                    setStatus('Seguimiento no disponible', payload?.message || 'No se pudo cargar el estado actual.', 'error');
                    setConnectionState('offline');
                }
            };

            nextEventSource.onerror = () => {
                if (eventSource !== nextEventSource) return;
                closeEventSource();
                schedulePolling();
            };

            return true;
        } catch {
            closeEventSource();
            setConnectionState('polling');
            return false;
        }
    }

    function handleVisibilityChange() {
        if (documentRef.hidden) {
            clearPollingTimer();
            closeEventSource();
            return;
        }
        if (startEventStream()) {
            return;
        }
        void loadTrackingState({ silent: true });
    }

    async function loadTrackingState(options = {}) {
        const { silent = false } = options;
        ensureBrandLockup();
        const token = resolveTrackingToken();
        if (!token) {
            setStatus('Enlace no disponible', 'No se pudo resolver el token del seguimiento.', 'error');
            setConnectionState('offline');
            return;
        }

        clearPollingTimer();
        const requestId = activeLoadRequestId + 1;
        activeLoadRequestId = requestId;

        const refreshBtn = documentRef.getElementById('publicTrackingRefreshBtn');
        if (refreshBtn instanceof HTMLButtonElement) {
            refreshBtn.disabled = true;
        }

        try {
            setConnectionState(silent ? 'polling' : 'loading');
            if (!silent) {
                setStatus('Cargando estado...', 'Estamos consultando el estado mas reciente del servicio.');
            }
            const response = await fetch(`/track/${encodeURIComponent(token)}/state`, {
                method: 'GET',
                cache: 'no-store',
                credentials: 'omit',
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.success !== true || !payload?.tracking) {
                throw new Error(payload?.error?.message || 'Este enlace ya no esta disponible.');
            }
            if (requestId !== activeLoadRequestId) {
                return;
            }

            renderTracking(payload.tracking);
            setConnectionState('live');
        } catch (error) {
            if (requestId !== activeLoadRequestId) {
                return;
            }
            setStatus('Enlace no disponible', error?.message || 'Este enlace ya no esta disponible.', 'error');
            setConnectionState('offline');
            renderSummary({
                public_status_label: 'No disponible',
                public_transition_label: '',
                public_message: error?.message || 'Este enlace ya no esta disponible.',
            });
            renderMeta({
                public_reference: '',
                installation_id: '',
                public_status: '',
                public_status_label: '',
                last_updated_at: '',
            });
            renderTimeline({ milestones: [] });
        } finally {
            if (requestId === activeLoadRequestId && refreshBtn instanceof HTMLButtonElement) {
                refreshBtn.disabled = false;
            }
            if (requestId === activeLoadRequestId) {
                if (!documentRef.hidden && startEventStream()) {
                    return;
                }
                schedulePolling();
            }
        }
    }

    globalScope.addEventListener('DOMContentLoaded', () => {
        if (hasInitialized) return;
        hasInitialized = true;
        ensureBrandLockup();
        bindThemeToggleControl();
        documentRef.getElementById('publicTrackingRefreshBtn')?.addEventListener('click', () => {
            void loadTrackingState();
        });
        documentRef.addEventListener('visibilitychange', handleVisibilityChange);
        globalScope.addEventListener('beforeunload', () => {
            clearPollingTimer();
            closeEventSource();
        });
        setConnectionState('loading');
        pollingEnabled = true;
        void loadTrackingState();
    });
})(window);

(function initPublicTracking(globalScope) {
    const documentRef = globalScope.document;
    const POLLING_INTERVAL_MS = 15000;
    let pollingTimerId = null;
    let pollingEnabled = false;
    let activeLoadRequestId = 0;

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

    function setStatus(title, message, tone = 'neutral') {
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
        if (!pollingEnabled || documentRef.hidden) {
            return;
        }
        pollingTimerId = globalScope.setTimeout(() => {
            void loadTrackingState({ silent: true });
        }, POLLING_INTERVAL_MS);
    }

    function handleVisibilityChange() {
        if (documentRef.hidden) {
            clearPollingTimer();
            return;
        }
        void loadTrackingState({ silent: true });
    }

    async function loadTrackingState(options = {}) {
        const { silent = false } = options;
        const token = resolveTrackingToken();
        if (!token) {
            setStatus('Enlace no disponible', 'No se pudo resolver el token del seguimiento.', 'error');
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

            const tracking = payload.tracking;
            setStatus(
                tracking.public_reference || `Servicio #${tracking.installation_id}`,
                tracking.public_message || 'Seguimiento disponible.',
                statusTone(tracking),
            );
            renderSummary(tracking);
            renderMeta(tracking);
            renderTimeline(tracking);
        } catch (error) {
            if (requestId !== activeLoadRequestId) {
                return;
            }
            setStatus('Enlace no disponible', error?.message || 'Este enlace ya no esta disponible.', 'error');
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
                schedulePolling();
            }
        }
    }

    globalScope.addEventListener('DOMContentLoaded', () => {
        documentRef.getElementById('publicTrackingRefreshBtn')?.addEventListener('click', () => {
            void loadTrackingState();
        });
        documentRef.addEventListener('visibilitychange', handleVisibilityChange);
        globalScope.addEventListener('beforeunload', clearPollingTimer);
        pollingEnabled = true;
        void loadTrackingState();
    });
})(window);

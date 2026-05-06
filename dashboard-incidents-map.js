(function attachDashboardIncidentsMapFactory(global) {
    function createDashboardIncidentsMap(ctx) {
        const {
            options,
            canCurrentUserManagePublicTracking,
            canCurrentUserViewTenantIncidentMap,
            shouldUseAssignedIncidentMap,
            canCurrentUserWriteOperationalData,
            runIncidentRefreshInBackground,
            applyVisibleIncidentUpdate,
        } = ctx;
        const PUBLIC_TRACKING_URL_INPUT_ID = 'actionPublicTrackingUrl';
        const PUBLIC_TRACKING_URL_LINK_ID = 'actionPublicTrackingLink';
        const PUBLIC_TRACKING_STATUS_ID = 'actionPublicTrackingStatus';
        const PUBLIC_TRACKING_EXPIRES_ID = 'actionPublicTrackingExpires';
        const PUBLIC_TRACKING_SNAPSHOT_ID = 'actionPublicTrackingSnapshot';
        const PUBLIC_TRACKING_COPY_ID = 'actionPublicTrackingCopyBtn';
        const PUBLIC_TRACKING_REVOKE_ID = 'actionPublicTrackingRevokeBtn';
        const INCIDENT_MAP_DEFAULT_DAYS = '30';
        const INCIDENT_MAP_DEFAULT_LIMIT = 240;
        const INCIDENT_MAP_ALLOWED_DAYS = new Set(['7', '30', '90', 'all']);
        const INCIDENT_MAP_DEFAULT_CENTER = [-56.1645, -34.9011];
        let incidentMapState = {
            days: INCIDENT_MAP_DEFAULT_DAYS,
            status: '',
            severity: '',
            sourceIncidents: [],
            incidents: [],
            linkedTechnician: null,
            scope: 'tenant',
            selectedIncidentId: null,
            targetSelectionIncidentId: null,
            savingTargetIncidentId: null,
            loading: false,
            map: null,
            mapLoaded: false,
            mapMarkers: [],
            pendingFitBounds: false,
        };
        let incidentMapRequestVersion = 0;

        function isButtonElement(element) {
            return element instanceof HTMLElement && element.tagName === 'BUTTON';
        }
        let incidentGoogleMapsLoaderPromise = null;

        function requestDashboardRefresh() {
            if (typeof options.loadDashboard !== 'function') return;
            void options.loadDashboard();
        }

        function parseIncidentCoordinateValue(value) {
            if (value === null || value === undefined || value === '') return null;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        }

        function resolveIncidentOperationalCoordinates(incident) {
            const targetLat = parseIncidentCoordinateValue(incident?.target_lat);
            const targetLng = parseIncidentCoordinateValue(incident?.target_lng);
            if (Number.isFinite(targetLat) && Number.isFinite(targetLng)) {
                return { lat: targetLat, lng: targetLng, source: 'target' };
            }

            const gpsLat = parseIncidentCoordinateValue(incident?.gps_lat);
            const gpsLng = parseIncidentCoordinateValue(incident?.gps_lng);
            if (Number.isFinite(gpsLat) && Number.isFinite(gpsLng)) {
                return { lat: gpsLat, lng: gpsLng, source: 'gps' };
            }

            return null;
        }

        function formatIncidentCoordinateLine(incident) {
            const coordinates = resolveIncidentOperationalCoordinates(incident);
            if (!coordinates) return 'Sin coordenadas disponibles.';
            return `Lat ${coordinates.lat.toFixed(5)} Â· Lng ${coordinates.lng.toFixed(5)} Â· ${coordinates.source === 'target' ? 'Destino operativo' : 'GPS del reporte'}`;
        }

        function buildIncidentMapsUrl(incident) {
            const coordinates = resolveIncidentOperationalCoordinates(incident);
            if (!coordinates) return '';
            return `https://www.google.com/maps?q=${coordinates.lat},${coordinates.lng}`;
        }

        function resolveIncidentGoogleMapsApiKey() {
            const globalKey = String(window.__DM_GOOGLE_MAPS_API_KEY__ || '').trim();
            if (globalKey) return globalKey;
            try {
                return String(window.localStorage.getItem('dm_google_maps_api_key') || '').trim();
            } catch {
                return '';
            }
        }

        function hasIncidentGoogleMapsApi() {
            return Boolean(window.google?.maps && typeof window.google.maps.Map === 'function');
        }

        function hasIncidentGooglePlacesApi() {
            return Boolean(window.google?.maps?.places && typeof window.google.maps.places.Autocomplete === 'function');
        }

        function ensureIncidentGoogleMapsApi() {
            if (hasIncidentGoogleMapsApi()) {
                return Promise.resolve(window.google.maps);
            }
            if (incidentGoogleMapsLoaderPromise) {
                return incidentGoogleMapsLoaderPromise;
            }

            const apiKey = resolveIncidentGoogleMapsApiKey();
            if (!apiKey) {
                return Promise.reject(new Error(
                    'Configura `GOOGLE_MAPS_API_KEY` o `dm_google_maps_api_key` para ver el mapa real de incidencias.',
                ));
            }

            incidentGoogleMapsLoaderPromise = new Promise((resolve, reject) => {
                const cleanup = () => {
                    try {
                        delete window.__dmIncidentGoogleMapsReady__;
                    } catch {
                        window.__dmIncidentGoogleMapsReady__ = undefined;
                    }
                };
                const failLoad = () => {
                    cleanup();
                    incidentGoogleMapsLoaderPromise = null;
                    reject(new Error('Google Maps no pudo inicializarse. Revisa la API key o la conectividad.'));
                };

                window.__dmIncidentGoogleMapsReady__ = () => {
                    cleanup();
                    resolve(window.google.maps);
                };

                const existingScript = document.getElementById('incidentGoogleMapsScript');
                if (existingScript) {
                    existingScript.addEventListener('error', failLoad, { once: true });
                    return;
                }

                const script = document.createElement('script');
                script.id = 'incidentGoogleMapsScript';
                script.async = true;
                script.defer = true;
                script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&language=es&region=UY&callback=__dmIncidentGoogleMapsReady__`;
                script.addEventListener('error', failLoad, { once: true });
                document.head.appendChild(script);
            });

            return incidentGoogleMapsLoaderPromise;
        }

        function setIncidentDispatchPlacesStatus(message) {
            const help = document.getElementById('actionIncidentDispatchPlacesStatus');
            if (!(help instanceof HTMLElement)) return;
            help.textContent = String(message || '').trim();
        }

        function dispatchIncidentInputMutation(input, value) {
            if (!(input instanceof HTMLInputElement)) return;
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function applyIncidentDispatchPlaceSelection(place) {
            const addressInput = document.getElementById('actionIncidentDispatchAddress');
            const placeInput = document.getElementById('actionIncidentDispatchPlace');
            const latInput = document.getElementById('actionIncidentTargetLat');
            const lngInput = document.getElementById('actionIncidentTargetLng');
            const targetLabelInput = document.getElementById('actionIncidentTargetLabel');
            if (!(addressInput instanceof HTMLInputElement)) return;

            const nextAddress = String(place?.formatted_address || '').trim();
            const nextPlaceName = String(place?.name || '').trim();
            const nextLat = Number(place?.geometry?.location?.lat?.());
            const nextLng = Number(place?.geometry?.location?.lng?.());
            const previousPlace = placeInput instanceof HTMLInputElement ? String(placeInput.value || '').trim() : '';
            const previousAddress = String(addressInput.value || '').trim();
            const previousTargetLabel = targetLabelInput instanceof HTMLInputElement
                ? String(targetLabelInput.value || '').trim()
                : '';

            if (nextAddress) {
                dispatchIncidentInputMutation(addressInput, nextAddress);
            }
            if (placeInput instanceof HTMLInputElement && nextPlaceName) {
                dispatchIncidentInputMutation(placeInput, nextPlaceName);
            }
            if (latInput instanceof HTMLInputElement && Number.isFinite(nextLat)) {
                dispatchIncidentInputMutation(latInput, nextLat.toFixed(6));
            }
            if (lngInput instanceof HTMLInputElement && Number.isFinite(nextLng)) {
                dispatchIncidentInputMutation(lngInput, nextLng.toFixed(6));
            }
            if (
                targetLabelInput instanceof HTMLInputElement
                && (
                    !previousTargetLabel
                    || previousTargetLabel === previousPlace
                    || previousTargetLabel === previousAddress
                )
            ) {
                const nextTargetLabel = nextPlaceName || nextAddress;
                if (nextTargetLabel) {
                    dispatchIncidentInputMutation(targetLabelInput, nextTargetLabel);
                }
            }

            setIncidentDispatchPlacesStatus(
                Number.isFinite(nextLat) && Number.isFinite(nextLng)
                    ? 'DirecciÃ³n validada con Google Maps. Coordenadas y nombre completados.'
                    : 'DirecciÃ³n sugerida aplicada. Puedes completar coordenadas manualmente si hace falta.',
            );
        }

        function bindIncidentDispatchPlacesAutocomplete() {
            const addressInput = document.getElementById('actionIncidentDispatchAddress');
            if (!(addressInput instanceof HTMLInputElement)) return;
            if (addressInput.dataset.placesBound === '1') return;

            setIncidentDispatchPlacesStatus(
                'Escribe una direcciÃ³n o lugar y elige una sugerencia de Google. Si no aparece, puedes cargarlo manualmente.',
            );

            if (!hasIncidentGooglePlacesApi()) {
                const apiKey = resolveIncidentGoogleMapsApiKey();
                if (!apiKey) {
                    return;
                }
                void ensureIncidentGoogleMapsApi()
                    .then(() => {
                        bindIncidentDispatchPlacesAutocomplete();
                    })
                    .catch(() => {
                        setIncidentDispatchPlacesStatus(
                            'No pudimos cargar Google Places. Puedes seguir completando direcciÃ³n y coordenadas manualmente.',
                        );
                    });
                return;
            }

            addressInput.dataset.placesBound = '1';
            addressInput.autocomplete = 'off';
            const autocomplete = new window.google.maps.places.Autocomplete(addressInput, {
                fields: ['formatted_address', 'geometry', 'name'],
                types: ['geocode', 'establishment'],
            });
            autocomplete.addListener('place_changed', () => {
                const place = autocomplete.getPlace?.();
                if (!place || typeof place !== 'object') {
                    setIncidentDispatchPlacesStatus(
                        'No pudimos leer la sugerencia elegida. Puedes completar la direcciÃ³n manualmente.',
                    );
                    return;
                }
                applyIncidentDispatchPlaceSelection(place);
            });
        }

        function renderIncidentMapCanvasMessage(message, tone = 'neutral') {
            const canvas = document.getElementById('incidentMapCanvas');
            if (!canvas) return;
            canvas.innerHTML = '';
            const state = document.createElement('div');
            state.className = `incident-map-empty incident-map-empty-${tone}`;
            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined';
            icon.textContent = tone === 'error' ? 'map_off' : 'explore_off';
            const copy = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = tone === 'error' ? 'No pudimos iniciar el mapa' : 'Mapa listo para configurar';
            const body = document.createElement('p');
            body.textContent = message;
            copy.append(title, body);
            state.append(icon, copy);
            canvas.appendChild(state);
        }

        function clearIncidentMapMarkers() {
            if (!Array.isArray(incidentMapState.mapMarkers)) {
                incidentMapState.mapMarkers = [];
                return;
            }
            incidentMapState.mapMarkers.forEach((marker) => {
                if (marker && typeof marker.setMap === 'function') {
                    marker.setMap(null);
                }
            });
            incidentMapState.mapMarkers = [];
        }

        function destroyIncidentMap() {
            clearIncidentMapMarkers();
            if (incidentMapState.map && typeof incidentMapState.map.getDiv === 'function') {
                const mapContainer = incidentMapState.map.getDiv();
                if (mapContainer) {
                    mapContainer.replaceChildren();
                }
            }
            incidentMapState.map = null;
            incidentMapState.mapLoaded = false;
        }

        function syncIncidentMapCursor() {
            const canvas = incidentMapState.map && typeof incidentMapState.map.getDiv === 'function'
                ? incidentMapState.map.getDiv()
                : null;
            if (!canvas || !canvas.style) return;
            canvas.style.cursor = incidentMapState.targetSelectionIncidentId ? 'crosshair' : '';
        }

        function upsertIncidentInMapState(incident) {
            const incidentId = options.parseStrictInteger(incident?.id);
            if (!Number.isInteger(incidentId) || incidentId <= 0) return;
            [incidentMapState.sourceIncidents, incidentMapState.incidents].forEach((list) => {
                if (!Array.isArray(list)) return;
                const existingIndex = list.findIndex((entry) => (
                    options.parseStrictInteger(entry?.id) === incidentId
                ));
                if (existingIndex >= 0) {
                    list[existingIndex] = {
                        ...list[existingIndex],
                        ...incident,
                    };
                }
            });
        }

        function cancelIncidentMapTargetSelection({ silent = false } = {}) {
            if (!incidentMapState.targetSelectionIncidentId && !incidentMapState.savingTargetIncidentId) {
                return;
            }
            incidentMapState.targetSelectionIncidentId = null;
            incidentMapState.savingTargetIncidentId = null;
            syncIncidentMapCursor();
            renderIncidentMap();
            if (!silent) {
                options.showNotification('Ajuste manual del destino cancelado.', 'info');
            }
        }

        function beginIncidentMapTargetSelection(incident) {
            const incidentId = options.parseStrictInteger(incident?.id);
            if (!Number.isInteger(incidentId) || incidentId <= 0) {
                options.showNotification('Incidencia invÃ¡lida para ajustar destino.', 'error');
                return;
            }
            if (!incidentMapState.mapLoaded) {
                options.showNotification('El mapa aÃºn no estÃ¡ listo para fijar el destino.', 'warning');
                return;
            }
            incidentMapState.selectedIncidentId = incidentId;
            incidentMapState.targetSelectionIncidentId = incidentId;
            incidentMapState.savingTargetIncidentId = null;
            syncIncidentMapCursor();
            renderIncidentMap();
            options.showNotification(
                `Haz click en el mapa para fijar el destino operativo de la incidencia #${incidentId}.`,
                'info',
            );
        }

        async function persistIncidentMapTargetSelection(incident, lngLat) {
            const incidentId = options.parseStrictInteger(incident?.id);
            const installationId = options.parseStrictInteger(incident?.installation_id);
            const assetId = options.parseStrictInteger(incident?.asset_id);
            const lat = Number(Number(lngLat?.lat).toFixed(6));
            const lng = Number(Number(lngLat?.lng).toFixed(6));
            if (!Number.isInteger(incidentId) || incidentId <= 0 || !Number.isFinite(lat) || !Number.isFinite(lng)) {
                options.showNotification('No se pudo leer la coordenada seleccionada.', 'error');
                return;
            }

            incidentMapState.savingTargetIncidentId = incidentId;
            renderIncidentMapDetail();

            try {
                const result = await options.api.updateIncidentDispatchTarget(incidentId, {
                    dispatch_required: true,
                    target_lat: lat,
                    target_lng: lng,
                    target_source: 'manual_map',
                });
                const nextIncident = result?.incident && typeof result.incident === 'object'
                    ? result.incident
                    : {
                        ...incident,
                        target_lat: lat,
                        target_lng: lng,
                        target_source: 'manual_map',
                    };

                applyVisibleIncidentUpdate(nextIncident);
                upsertIncidentInMapState(nextIncident);
                incidentMapState.selectedIncidentId = incidentId;
                incidentMapState.targetSelectionIncidentId = null;
                incidentMapState.savingTargetIncidentId = null;
                syncIncidentMapCursor();
                renderIncidentMap();
                options.showNotification(`Destino operativo actualizado en incidencia #${incidentId}.`, 'success');
                runIncidentRefreshInBackground(
                    { installationId, assetId },
                    'Guardamos el destino operativo, pero no pudimos refrescar el contexto completo.',
                );
                requestDashboardRefresh();
            } catch (error) {
                incidentMapState.savingTargetIncidentId = null;
                syncIncidentMapCursor();
                renderIncidentMapDetail();
                options.showNotification(
                    `No se pudo guardar el destino operativo: ${error?.message || error}`,
                    'error',
                );
            }
        }

        function buildIncidentMapFeatures(incidents) {
            return (Array.isArray(incidents) ? incidents : [])
                .map((incident) => ({
                    incident,
                    coordinates: resolveIncidentOperationalCoordinates(incident),
                }))
                .filter((entry) => entry.coordinates)
                .map(({ incident, coordinates }) => ({
                    incident,
                    incidentId: options.parseStrictInteger(incident?.id) || 0,
                    lat: coordinates.lat,
                    lng: coordinates.lng,
                    coordinateSource: coordinates.source,
                }));
        }

        function buildIncidentMapMarkerIcon(incident, isSelected) {
            const severity = getIncidentMapSeverityTone(incident?.severity);
            const status = getIncidentMapStatusTone(incident?.incident_status);
            const fillColor = severity === 'critical'
                ? '#ef4444'
                : severity === 'high'
                    ? '#f97316'
                    : severity === 'medium'
                        ? '#f59e0b'
                        : '#eab308';
            const fillOpacity = status === 'resolved'
                ? 0.68
                : status === 'paused'
                    ? 0.8
                    : 0.96;

            return {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: isSelected ? 8 : 6,
                fillColor,
                fillOpacity,
                strokeColor: '#ffffff',
                strokeWeight: isSelected ? 3 : 2,
            };
        }

        function syncIncidentMapMarkers() {
            if (!incidentMapState.map || !incidentMapState.mapLoaded) return [];
            clearIncidentMapMarkers();
            const features = buildIncidentMapFeatures(incidentMapState.incidents);

            incidentMapState.mapMarkers = features.map((feature) => {
                const isSelected = feature.incidentId === incidentMapState.selectedIncidentId;
                const marker = new window.google.maps.Marker({
                    map: incidentMapState.map,
                    position: { lat: feature.lat, lng: feature.lng },
                    title: String(
                        feature.incident?.dispatch_place_name
                        || feature.incident?.installation_client_name
                        || `Incidencia #${feature.incidentId}`,
                    ).trim(),
                    icon: buildIncidentMapMarkerIcon(feature.incident, isSelected),
                    zIndex: isSelected ? 20 : 10,
                });

                marker.addListener('click', () => {
                    if (incidentMapState.targetSelectionIncidentId) return;
                    incidentMapState.selectedIncidentId = feature.incidentId;
                    renderIncidentMap();
                });

                return marker;
            });

            return features;
        }

        function fitIncidentMapToFeatures(features) {
            if (!incidentMapState.map || !Array.isArray(features) || !features.length) return;
            if (features.length === 1) {
                incidentMapState.map.panTo({ lat: features[0].lat, lng: features[0].lng });
                incidentMapState.map.setZoom(12);
                return;
            }

            const bounds = new window.google.maps.LatLngBounds();
            features.forEach((feature) => {
                bounds.extend({ lat: feature.lat, lng: feature.lng });
            });
            incidentMapState.map.fitBounds(bounds, 72);
        }

        function focusIncidentInMap() {
            if (!incidentMapState.map || !incidentMapState.mapLoaded || !incidentMapState.selectedIncidentId) return;
            const selectedIncident = incidentMapState.incidents.find((incident) => (
                options.parseStrictInteger(incident?.id) === incidentMapState.selectedIncidentId
            ));
            if (!selectedIncident) return;
            const coordinates = resolveIncidentOperationalCoordinates(selectedIncident);
            if (!coordinates) return;
            incidentMapState.map.panTo({ lat: coordinates.lat, lng: coordinates.lng });
        }

        function getIncidentMapSeverityTone(severity) {
            const normalized = options.normalizeSeverity(severity);
            if (normalized === 'critical') return 'critical';
            if (normalized === 'high') return 'high';
            if (normalized === 'medium') return 'medium';
            return 'low';
        }

        function getIncidentMapSeverityLabel(severity) {
            const normalized = options.normalizeSeverity(severity);
            if (normalized === 'critical') return 'CrÃ­tica';
            if (normalized === 'high') return 'Alta';
            if (normalized === 'medium') return 'Media';
            return 'Baja';
        }

        function getIncidentMapStatusTone(status) {
            const normalized = options.normalizeIncidentStatus(status);
            if (normalized === 'resolved') return 'resolved';
            if (normalized === 'in_progress') return 'active';
            if (normalized === 'paused') return 'paused';
            return 'open';
        }

        function formatIncidentMapRelativeTime(isoValue) {
            const timestamp = Date.parse(String(isoValue || ''));
            if (!Number.isFinite(timestamp)) return 'Sin fecha';
            const diffMs = Date.now() - timestamp;
            if (diffMs < 60 * 1000) return 'Hace instantes';
            const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
            if (diffHours < 24) return `Hace ${diffHours}h`;
            const diffDays = Math.floor(diffHours / 24);
            if (diffDays < 30) return `Hace ${diffDays}d`;
            return options.formatDateTime?.(isoValue) || String(isoValue || '').trim() || 'Sin fecha';
        }

        function updateIncidentMapFilterFeedback(sourceIncidents) {
            const safeSource = Array.isArray(sourceIncidents) ? sourceIncidents : [];
            const statusCounts = {
                '': safeSource.length,
                open: 0,
                in_progress: 0,
                paused: 0,
                resolved: 0,
            };
            const severityCounts = {
                '': safeSource.length,
                critical: 0,
                high: 0,
                medium: 0,
                low: 0,
            };

            safeSource.forEach((incident) => {
                const statusTone = getIncidentMapStatusTone(incident?.incident_status);
                if (Object.prototype.hasOwnProperty.call(statusCounts, statusTone)) {
                    statusCounts[statusTone] += 1;
                }

                const severityTone = getIncidentMapSeverityTone(incident?.severity);
                if (Object.prototype.hasOwnProperty.call(severityCounts, severityTone)) {
                    severityCounts[severityTone] += 1;
                }
            });

            [
                ['incidentMapStatusFilter', statusCounts, incidentMapState.status],
                ['incidentMapSeverityFilter', severityCounts, incidentMapState.severity],
            ].forEach(([selectId, counts, selectedValue]) => {
                const select = document.getElementById(selectId);
                if (!(select instanceof window.HTMLSelectElement)) return;
                Array.from(select.options || []).forEach((option) => {
                    const optionValue = String(option.value || '').trim().toLowerCase();
                    const baseLabel = String(option.dataset.baseLabel || option.textContent || '')
                        .replace(/\s+\(\d+\)\s*$/, '')
                        .trim();
                    option.dataset.baseLabel = baseLabel;
                    const count = Number.isInteger(counts[optionValue]) ? counts[optionValue] : 0;
                    option.textContent = `${baseLabel} (${count})`;
                });
                select.classList.toggle('is-filtered', Boolean(String(selectedValue || '').trim()));
            });
        }

        function syncIncidentMapRangeButtons() {
            document.querySelectorAll('.incident-map-range-btn').forEach((button) => {
                button.classList.toggle(
                    'is-active',
                    String(button.dataset.incidentMapDays || '').trim().toLowerCase() === incidentMapState.days,
                );
            });
        }

        function ensureAssignedIncidentMapDefaults() {
            if (!shouldUseAssignedIncidentMap()) return;
            if (incidentMapState.days !== 'all') {
                incidentMapState.days = 'all';
                syncIncidentMapRangeButtons();
            }
        }

        function applyIncidentMapClientFilters(incidents, filters = {}) {
            const list = Array.isArray(incidents) ? [...incidents] : [];
            const normalizedStatus = String(filters.status || '').trim().toLowerCase();
            const normalizedSeverity = String(filters.severity || '').trim().toLowerCase();
            const normalizedDays = String(filters.days || '').trim().toLowerCase();
            const limit = Number(filters.limit);
            let minTimestamp = null;
            if (normalizedDays && normalizedDays !== 'all') {
                const parsedDays = Number.parseInt(normalizedDays, 10);
                if (Number.isFinite(parsedDays) && parsedDays > 0) {
                    minTimestamp = Date.now() - (parsedDays * 24 * 60 * 60 * 1000);
                }
            }

            return list
                .filter((incident) => {
                    if (normalizedStatus && options.normalizeIncidentStatus(incident?.incident_status) !== normalizedStatus) {
                        return false;
                    }
                    if (normalizedSeverity && options.normalizeSeverity(incident?.severity) !== normalizedSeverity) {
                        return false;
                    }
                    if (minTimestamp !== null) {
                        const createdAt = Date.parse(String(
                            incident?.status_updated_at
                            || incident?.resolved_at
                            || incident?.created_at
                            || '',
                        ));
                        if (Number.isFinite(createdAt) && createdAt < minTimestamp) {
                            return false;
                        }
                    }
                    return true;
                })
                .slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
        }

        function updateIncidentMapSummary(incidents) {
            const summary = document.getElementById('incidentMapSummary');
            if (!summary) return;

            const total = incidents.length;
            const critical = incidents.filter((incident) => options.normalizeSeverity(incident?.severity) === 'critical').length;
            const active = incidents.filter((incident) => ['open', 'in_progress', 'paused'].includes(options.normalizeIncidentStatus(incident?.incident_status))).length;
            const uniqueClients = new Set(
                incidents
                    .map((incident) => String(incident?.installation_client_name || '').trim())
                    .filter(Boolean),
            ).size;

            summary.replaceChildren();

            [
                {
                    label: `${total} punto${total === 1 ? '' : 's'} visibles`,
                    tone: 'neutral',
                },
                {
                    label: `${critical} critica${critical === 1 ? '' : 's'}`,
                    tone: critical > 0 ? 'critical' : 'neutral',
                },
                {
                    label: `${active} activa${active === 1 ? '' : 's'}`,
                    tone: active > 0 ? 'active' : 'neutral',
                },
                {
                    label: `${uniqueClients} cliente${uniqueClients === 1 ? '' : 's'}`,
                    tone: 'muted',
                },
            ].forEach(({ label, tone }) => {
                const chip = document.createElement('span');
                chip.className = `incident-map-summary-chip incident-map-summary-chip-${tone}`;
                chip.textContent = label;
                summary.appendChild(chip);
            });
        }

        function renderIncidentMapDetailList(container, incidents) {
            const list = document.createElement('div');
            list.className = 'incident-map-recent-list';
            incidents.slice(0, 6).forEach((incident) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'incident-map-recent-item';
                button.dataset.incidentId = String(options.parseStrictInteger(incident?.id) || '');
                if (options.parseStrictInteger(incident?.id) === incidentMapState.selectedIncidentId) {
                    button.classList.add('is-active');
                }

                const titleRow = document.createElement('div');
                titleRow.className = 'incident-map-recent-head';
                const severityTone = getIncidentMapSeverityTone(incident?.severity);
                const statusTone = getIncidentMapStatusTone(incident?.incident_status);

                const severityDot = document.createElement('span');
                severityDot.className = `incident-map-recent-dot severity-${severityTone}`;
                severityDot.setAttribute('aria-hidden', 'true');

                const title = document.createElement('strong');
                title.textContent = String(incident?.installation_client_name || `Incidencia #${incident?.id || '-'}`).trim();

                const time = document.createElement('span');
                time.className = 'incident-map-recent-time';
                time.textContent = formatIncidentMapRelativeTime(incident?.created_at);
                titleRow.append(severityDot, title, time);

                const meta = document.createElement('div');
                meta.className = 'incident-map-recent-meta';
                const assetCode = String(incident?.asset_code || '').trim();

                const registration = document.createElement('span');
                registration.className = 'incident-map-recent-line';
                registration.textContent = `${assetCode || `Registro #${incident?.installation_id || '-'}`}`;

                const badges = document.createElement('div');
                badges.className = 'incident-map-recent-badges';

                const statusBadge = document.createElement('span');
                statusBadge.className = `incident-map-recent-status tone-${statusTone}`;
                statusBadge.textContent = options.incidentStatusLabel(incident?.incident_status);

                const severityBadge = document.createElement('span');
                severityBadge.className = `incident-map-recent-severity severity-${severityTone}`;
                severityBadge.textContent = getIncidentMapSeverityLabel(incident?.severity);

                badges.append(statusBadge, severityBadge);
                meta.append(registration, badges);
                button.append(titleRow, meta);
                button.addEventListener('click', () => {
                    incidentMapState.selectedIncidentId = options.parseStrictInteger(incident?.id);
                    if (incidentMapState.targetSelectionIncidentId) {
                        incidentMapState.targetSelectionIncidentId = incidentMapState.selectedIncidentId;
                    }
                    renderIncidentMap();
                });
                list.appendChild(button);
            });
            container.appendChild(list);
        }

        function renderIncidentMapDetail() {
            const container = document.getElementById('incidentMapDetail');
            if (!container) return;
            container.replaceChildren();

            if (incidentMapState.loading) {
                const loading = document.createElement('p');
                loading.className = 'loading';
                loading.textContent = 'Cargando contexto del mapa...';
                container.appendChild(loading);
                return;
            }

            if (!incidentMapState.incidents.length) {
                const empty = document.createElement('p');
                empty.className = 'incident-map-detail-empty';
                empty.textContent = incidentMapState.scope === 'assigned'
                    ? incidentMapState.linkedTechnician?.id
                        ? 'No tienes incidencias asignadas con coordenadas para este filtro.'
                        : 'Vincula un tecnico a tu usuario web para ver tu mapa operativo personal.'
                    : 'No hay incidencias con coordenadas para este filtro.';
                container.appendChild(empty);
                return;
            }

            const selectedIncident = incidentMapState.incidents.find((incident) => (
                options.parseStrictInteger(incident?.id) === incidentMapState.selectedIncidentId
            )) || incidentMapState.incidents[0];
            const selectedIncidentId = options.parseStrictInteger(selectedIncident?.id);
            incidentMapState.selectedIncidentId = selectedIncidentId;
            const operationalCoordinates = resolveIncidentOperationalCoordinates(selectedIncident);
            const hasTargetCoordinates =
                parseIncidentCoordinateValue(selectedIncident?.target_lat) !== null &&
                parseIncidentCoordinateValue(selectedIncident?.target_lng) !== null;
            const selectionActive = incidentMapState.targetSelectionIncidentId === selectedIncidentId;
            const savingSelection = incidentMapState.savingTargetIncidentId === selectedIncidentId;
            const severityTone = getIncidentMapSeverityTone(selectedIncident?.severity);
            const statusTone = getIncidentMapStatusTone(selectedIncident?.incident_status);

            const header = document.createElement('div');
            header.className = 'incident-map-detail-head';

            const eyebrow = document.createElement('span');
            eyebrow.className = 'incident-map-detail-eyebrow';
            eyebrow.textContent = `Incidencia #${selectedIncidentId || '-'}`;

            const title = document.createElement('h4');
            title.textContent = String(selectedIncident?.installation_client_name || 'Sin cliente').trim() || 'Sin cliente';

            const summary = document.createElement('p');
            const assetCode = String(selectedIncident?.asset_code || '').trim();
            summary.textContent = `${assetCode || 'Sin equipo'} Â· ${formatIncidentMapRelativeTime(selectedIncident?.created_at)}`;

            const chips = document.createElement('div');
            chips.className = 'incident-map-detail-chips';

            const severityChip = document.createElement('span');
            severityChip.className = `incident-map-detail-chip severity-${severityTone}`;
            severityChip.textContent = getIncidentMapSeverityLabel(selectedIncident?.severity);

            const statusChip = document.createElement('span');
            statusChip.className = `incident-map-detail-chip tone-${statusTone}`;
            statusChip.textContent = options.incidentStatusLabel(selectedIncident?.incident_status);

            const recordChip = document.createElement('span');
            recordChip.className = 'incident-map-detail-chip tone-neutral';
            recordChip.textContent = `Registro #${options.parseStrictInteger(selectedIncident?.installation_id) || '-'}`;

            chips.append(severityChip, statusChip, recordChip);

            const destination = document.createElement('p');
            destination.className = 'incident-map-detail-destination';
            const destinationText = String(
                selectedIncident?.dispatch_place_name
                || selectedIncident?.target_label
                || selectedIncident?.target_notes
                || '',
            ).trim();
            destination.textContent = destinationText || formatIncidentCoordinateLine(selectedIncident);

            header.append(eyebrow, title, summary, chips, destination);
            container.appendChild(header);

            const metrics = document.createElement('div');
            metrics.className = 'incident-map-detail-metrics';
            [
                ['Tecnico', String(selectedIncident?.reporter_username || 'Sin dato').trim() || 'Sin dato'],
                ['Coordenada', operationalCoordinates?.source === 'target'
                    ? 'Destino operativo'
                    : Number.isFinite(Number(selectedIncident?.gps_accuracy_m))
                        ? `${Math.round(Number(selectedIncident.gps_accuracy_m))} m`
                        : 'Sin dato'],
                ['Estado', options.incidentStatusLabel(selectedIncident?.incident_status)],
            ].forEach(([label, value]) => {
                const metric = document.createElement('div');
                metric.className = 'incident-map-detail-metric';
                const metricLabel = document.createElement('span');
                metricLabel.textContent = label;
                const metricValue = document.createElement('strong');
                metricValue.textContent = value;
                metric.append(metricLabel, metricValue);
                metrics.appendChild(metric);
            });
            container.appendChild(metrics);

            const note = document.createElement('p');
            note.className = 'incident-map-detail-note';
            note.textContent = String(selectedIncident?.note || '').trim() || 'Sin nota operativa.';
            container.appendChild(note);

            const coordinate = document.createElement('p');
            coordinate.className = 'incident-map-detail-coordinate';
            coordinate.textContent = formatIncidentCoordinateLine(selectedIncident);
            container.appendChild(coordinate);

            const dispatchSummary = document.createElement('p');
            dispatchSummary.className = 'incident-map-detail-note';
            dispatchSummary.textContent = selectedIncident?.dispatch_required === false
                ? 'Incidencia sin visita en sitio requerida.'
                : hasTargetCoordinates
                ? `Destino actual: ${String(selectedIncident?.dispatch_place_name || selectedIncident?.target_label || 'Punto operativo').trim()}`
                : 'Aun no definiste un destino operativo manual para esta incidencia.';
            container.appendChild(dispatchSummary);

            if (selectionActive || savingSelection) {
                const selectionHelp = document.createElement('p');
                selectionHelp.className = 'incident-map-detail-note';
                selectionHelp.textContent = savingSelection
                    ? 'Guardando coordenada operativa seleccionada...'
                    : 'Modo ajuste activo. Haz click en el mapa para fijar el nuevo destino operativo.';
                container.appendChild(selectionHelp);
            }

            const actions = document.createElement('div');
            actions.className = 'incident-map-detail-actions';

            const secondaryActions = document.createElement('div');
            secondaryActions.className = 'incident-map-detail-actions-secondary';

            if (canCurrentUserWriteOperationalData()) {
                const adjustTargetBtn = document.createElement('button');
                adjustTargetBtn.type = 'button';
                adjustTargetBtn.className = selectionActive ? 'btn-primary' : 'btn-secondary';
                adjustTargetBtn.innerHTML = selectionActive
                    ? '<span class="material-symbols-outlined icon-inline-sm">close</span> Cancelar ajuste'
                    : `<span class="material-symbols-outlined icon-inline-sm">${hasTargetCoordinates ? 'edit_location' : 'add_location_alt'}</span> ${hasTargetCoordinates ? 'Mover destino' : 'Elegir destino'}`;
                adjustTargetBtn.disabled = savingSelection || !incidentMapState.mapLoaded;
                adjustTargetBtn.addEventListener('click', () => {
                    if (selectionActive) {
                        cancelIncidentMapTargetSelection();
                        return;
                    }
                    beginIncidentMapTargetSelection(selectedIncident);
                });
                secondaryActions.appendChild(adjustTargetBtn);

                const editDispatchBtn = document.createElement('button');
                editDispatchBtn.type = 'button';
                editDispatchBtn.className = 'btn-secondary';
                editDispatchBtn.innerHTML = '<span class="material-symbols-outlined icon-inline-sm">edit_note</span> Editar destino';
                editDispatchBtn.disabled = savingSelection;
                editDispatchBtn.addEventListener('click', () => {
                    void updateIncidentDispatchTargetFromWeb(selectedIncident, {
                        installationId: selectedIncident?.installation_id,
                        assetId: selectedIncident?.asset_id,
                    });
                });
                secondaryActions.appendChild(editDispatchBtn);
            }

            const mapsUrl = buildIncidentMapsUrl(selectedIncident);
            if (mapsUrl) {
                const mapsLink = document.createElement('a');
                mapsLink.className = 'btn-secondary';
                mapsLink.href = mapsUrl;
                mapsLink.target = '_blank';
                mapsLink.rel = 'noreferrer noopener';
                mapsLink.innerHTML = '<span class="material-symbols-outlined icon-inline-sm">travel_explore</span> Ver en Maps';
                secondaryActions.appendChild(mapsLink);
            }

            if (secondaryActions.childElementCount) {
                actions.appendChild(secondaryActions);
            }

            const primaryActions = document.createElement('div');
            primaryActions.className = 'incident-map-detail-actions-primary';

            const openCaseBtn = document.createElement('button');
            openCaseBtn.type = 'button';
            openCaseBtn.className = 'btn-primary incident-map-open-case-btn';
            openCaseBtn.innerHTML = '<span class="material-symbols-outlined icon-inline-sm">warning</span> Abrir caso';
            openCaseBtn.addEventListener('click', async () => {
                await showIncidentsForInstallation(selectedIncident?.installation_id, {
                    focusIncidentId: selectedIncidentId,
                });
            });
            primaryActions.appendChild(openCaseBtn);
            actions.appendChild(primaryActions);
            container.appendChild(actions);

            const recentTitle = document.createElement('p');
            recentTitle.className = 'incident-map-recent-title';
            recentTitle.textContent = 'Puntos recientes';
            container.appendChild(recentTitle);
            renderIncidentMapDetailList(container, incidentMapState.incidents);
        }

        function ensureIncidentMapInstance() {
            const canvas = document.getElementById('incidentMapCanvas');
            if (!canvas) return false;
            if (!hasIncidentGoogleMapsApi()) {
                const apiKey = resolveIncidentGoogleMapsApiKey();
                if (!apiKey) {
                    destroyIncidentMap();
                    renderIncidentMapCanvasMessage(
                        'Configura `GOOGLE_MAPS_API_KEY` o `dm_google_maps_api_key` para ver el mapa real de incidencias.',
                        'neutral',
                    );
                    return false;
                }

                renderIncidentMapCanvasMessage('Cargando Google Maps para incidencias...', 'neutral');
                void ensureIncidentGoogleMapsApi()
                    .then(() => {
                        renderIncidentMap();
                    })
                    .catch((error) => {
                        destroyIncidentMap();
                        renderIncidentMapCanvasMessage(
                            error?.message || 'Google Maps no pudo inicializarse. Revisa la API key o la conectividad.',
                            'error',
                        );
                    });
                return false;
            }

            if (incidentMapState.map) {
                syncIncidentMapCursor();
                return true;
            }

            destroyIncidentMap();
            canvas.innerHTML = '';
            const map = new window.google.maps.Map(canvas, {
                center: { lat: INCIDENT_MAP_DEFAULT_CENTER[1], lng: INCIDENT_MAP_DEFAULT_CENTER[0] },
                zoom: 8.8,
                clickableIcons: false,
                fullscreenControl: false,
                mapTypeControl: false,
                streetViewControl: false,
                gestureHandling: 'greedy',
            });

            map.addListener('click', (event) => {
                const targetIncidentId = incidentMapState.targetSelectionIncidentId;
                if (!Number.isInteger(targetIncidentId) || targetIncidentId <= 0) return;
                if (incidentMapState.savingTargetIncidentId === targetIncidentId) return;
                const targetIncident = incidentMapState.incidents.find((incident) => (
                    options.parseStrictInteger(incident?.id) === targetIncidentId
                ));
                if (!targetIncident) return;
                const lat = Number(event?.latLng?.lat?.());
                const lng = Number(event?.latLng?.lng?.());
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                void persistIncidentMapTargetSelection(targetIncident, { lat, lng });
            });

            incidentMapState.map = map;
            incidentMapState.mapLoaded = true;
            syncIncidentMapCursor();
            return true;
        }

        function renderIncidentMap() {
            updateIncidentMapFilterFeedback(
                Array.isArray(incidentMapState.sourceIncidents) ? incidentMapState.sourceIncidents : [],
            );
            updateIncidentMapSummary(Array.isArray(incidentMapState.incidents) ? incidentMapState.incidents : []);
            const mapReady = ensureIncidentMapInstance();

            if (!mapReady) {
                renderIncidentMapDetail();
                return;
            }

            const incidents = Array.isArray(incidentMapState.incidents) ? incidentMapState.incidents : [];
            if (!incidentMapState.mapLoaded) {
                renderIncidentMapDetail();
                return;
            }

            if (!incidentMapState.selectedIncidentId) {
                incidentMapState.selectedIncidentId = options.parseStrictInteger(incidents[0]?.id);
            }

            const features = syncIncidentMapMarkers();
            if (incidentMapState.pendingFitBounds) {
                fitIncidentMapToFeatures(features);
                incidentMapState.pendingFitBounds = false;
            } else if (incidentMapState.selectedIncidentId) {
                focusIncidentInMap();
            }

            renderIncidentMapDetail();
        }

        async function loadIncidentMap(config = {}) {
            const requestVersion = ++incidentMapRequestVersion;
            ensureAssignedIncidentMapDefaults();
            incidentMapState.loading = true;
            if (config.resetSelection === true) {
                incidentMapState.selectedIncidentId = null;
                incidentMapState.targetSelectionIncidentId = null;
            }
            incidentMapState.pendingFitBounds = config.fitBounds !== false;
            renderIncidentMap();

            try {
                const useAssignedMap = shouldUseAssignedIncidentMap();
                const response = useAssignedMap
                    ? await options.api.getMyAssignedIncidentsMap()
                    : await options.api.getIncidentMap({
                        days: incidentMapState.days,
                        status: '',
                        severity: '',
                        limit: INCIDENT_MAP_DEFAULT_LIMIT,
                    });
                if (requestVersion !== incidentMapRequestVersion) return;
                incidentMapState.scope = useAssignedMap ? 'assigned' : 'tenant';
                incidentMapState.linkedTechnician = useAssignedMap ? response?.technician || null : null;
                incidentMapState.sourceIncidents = applyIncidentMapClientFilters(
                    Array.isArray(response?.incidents) ? response.incidents : [],
                    {
                        days: incidentMapState.days,
                        status: '',
                        severity: '',
                        limit: INCIDENT_MAP_DEFAULT_LIMIT,
                    },
                );
                incidentMapState.incidents = applyIncidentMapClientFilters(
                    incidentMapState.sourceIncidents,
                    {
                        days: 'all',
                        status: incidentMapState.status,
                        severity: incidentMapState.severity,
                        limit: INCIDENT_MAP_DEFAULT_LIMIT,
                    },
                );
                const selectedStillExists = incidentMapState.incidents.some((incident) => (
                    options.parseStrictInteger(incident?.id) === incidentMapState.selectedIncidentId
                ));
                if (!selectedStillExists) {
                    incidentMapState.selectedIncidentId = options.parseStrictInteger(incidentMapState.incidents[0]?.id);
                }
            } catch (error) {
                if (requestVersion !== incidentMapRequestVersion) return;
                incidentMapState.linkedTechnician = null;
                incidentMapState.sourceIncidents = [];
                incidentMapState.incidents = [];
                options.showNotification(
                    `No se pudo cargar el mapa de incidencias: ${error?.message || error}`,
                    'warning',
                );
            } finally {
                if (requestVersion !== incidentMapRequestVersion) return;
                incidentMapState.loading = false;
                renderIncidentMap();
            }
        }

        function bindIncidentMapControls() {
            if (document.body.dataset.incidentMapBound === '1') return;
            document.body.dataset.incidentMapBound = '1';

            document.querySelectorAll('.incident-map-range-btn').forEach((button) => {
                button.addEventListener('click', () => {
                    const nextDays = String(button.dataset.incidentMapDays || '').trim().toLowerCase();
                    if (!INCIDENT_MAP_ALLOWED_DAYS.has(nextDays) || nextDays === incidentMapState.days) return;
                    incidentMapState.days = nextDays;
                    syncIncidentMapRangeButtons();
                    void loadIncidentMap({ resetSelection: true });
                });
            });

            const statusFilter = document.getElementById('incidentMapStatusFilter');
            if (statusFilter) {
                statusFilter.addEventListener('change', () => {
                    incidentMapState.status = String(statusFilter.value || '').trim().toLowerCase();
                    void loadIncidentMap({ resetSelection: true });
                });
            }

            const severityFilter = document.getElementById('incidentMapSeverityFilter');
            if (severityFilter) {
                severityFilter.addEventListener('change', () => {
                    incidentMapState.severity = String(severityFilter.value || '').trim().toLowerCase();
                    void loadIncidentMap({ resetSelection: true });
                });
            }
        }

        function focusIncidentCard(incidentId) {
            const numericIncidentId = options.parseStrictInteger(incidentId);
            if (!Number.isInteger(numericIncidentId) || numericIncidentId <= 0) return;
            const card = document.querySelector(`.incident-card[data-incident-id="${numericIncidentId}"]`);
            if (!(card instanceof HTMLElement)) return;
            card.classList.add('incident-card-spotlight');
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            window.setTimeout(() => {
                card.classList.remove('incident-card-spotlight');
            }, 2200);
        }

        async function copyTextToClipboard(value) {
            const normalizedValue = String(value || '').trim();
            if (!normalizedValue) {
                throw new Error('No hay enlace activo para copiar.');
            }

            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(normalizedValue);
                return;
            }

            const fallbackInput = document.createElement('textarea');
            fallbackInput.value = normalizedValue;
            fallbackInput.setAttribute('readonly', 'true');
            fallbackInput.style.position = 'fixed';
            fallbackInput.style.opacity = '0';
            document.body.appendChild(fallbackInput);
            fallbackInput.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(fallbackInput);
            if (!copied) {
                throw new Error('No se pudo copiar el enlace.');
            }
        }

        function buildPublicTrackingManagementFields() {
            const fragment = document.createDocumentFragment();

            const summary = document.createElement('p');
            summary.id = PUBLIC_TRACKING_STATUS_ID;
            summary.className = 'gps-capture-panel-summary';
            summary.textContent = 'Cargando estado del enlace...';

            const urlGroup = document.createElement('div');
            urlGroup.className = 'input-group';
            const urlLabel = document.createElement('label');
            urlLabel.setAttribute('for', PUBLIC_TRACKING_URL_INPUT_ID);
            urlLabel.textContent = 'Enlace corto compartible';
            const urlInput = document.createElement('input');
            urlInput.type = 'text';
            urlInput.id = PUBLIC_TRACKING_URL_INPUT_ID;
            urlInput.readOnly = true;
            urlInput.placeholder = 'Aun no hay un enlace activo';
            const urlLink = document.createElement('a');
            urlLink.id = PUBLIC_TRACKING_URL_LINK_ID;
            urlLink.className = 'public-tracking-link';
            urlLink.target = '_blank';
            urlLink.rel = 'noreferrer noopener';
            urlLink.textContent = 'Abrir seguimiento publico';
            urlLink.hidden = true;
            urlGroup.append(urlLabel, urlInput, urlLink);

            const expires = document.createElement('p');
            expires.id = PUBLIC_TRACKING_EXPIRES_ID;
            expires.className = 'gps-capture-panel-summary';
            expires.textContent = 'Expiracion: s/d';

            const snapshot = document.createElement('p');
            snapshot.id = PUBLIC_TRACKING_SNAPSHOT_ID;
            snapshot.className = 'gps-capture-panel-summary';
            snapshot.textContent = 'Estado pÃºblico cacheado: s/d';

            const actions = document.createElement('div');
            actions.className = 'action-form-actions-inline';
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.id = PUBLIC_TRACKING_COPY_ID;
            copyBtn.className = 'btn-secondary';
            copyBtn.textContent = 'Copiar enlace';
            const revokeBtn = document.createElement('button');
            revokeBtn.type = 'button';
            revokeBtn.id = PUBLIC_TRACKING_REVOKE_ID;
            revokeBtn.className = 'btn-secondary';
            revokeBtn.textContent = 'Revocar';
            actions.append(copyBtn, revokeBtn);

            fragment.append(summary, urlGroup, expires, snapshot, actions);
            return fragment;
        }

        async function openPublicTrackingModal(installationId) {
            if (!options.requireActiveSession()) return;
            if (!canCurrentUserManagePublicTracking()) {
                options.showNotification('No tienes permisos para gestionar enlaces publicos.', 'error');
                return;
            }
            const targetInstallationId = options.parseStrictInteger(installationId);
            if (!Number.isInteger(targetInstallationId) || targetInstallationId <= 0) {
                options.showNotification('installation_id invÃ¡lido para tracking pÃºblico.', 'error');
                return;
            }

            let currentLink = null;
            const modalOpened = options.openActionModal({
                title: `Seguimiento pÃºblico #${targetInstallationId}`,
                subtitle: 'Genera un Magic Link de solo lectura para compartir el estado actual del servicio.',
                submitLabel: 'Crear enlace',
                focusId: PUBLIC_TRACKING_URL_INPUT_ID,
                fields: buildPublicTrackingManagementFields(),
                onSubmit: async () => {
                    const result = await options.api.createInstallationPublicTrackingLink(targetInstallationId);
                    currentLink = result?.link || null;
                    syncPublicTrackingModalUi();
                    options.showNotification(
                        currentLink?.tracking_url ? 'Enlace pÃºblico listo para compartir.' : 'Enlace pÃºblico actualizado.',
                        'success',
                    );
                },
            });

            if (!modalOpened) return;

            const statusEl = document.getElementById(PUBLIC_TRACKING_STATUS_ID);
            const urlInput = document.getElementById(PUBLIC_TRACKING_URL_INPUT_ID);
            const urlLink = document.getElementById(PUBLIC_TRACKING_URL_LINK_ID);
            const expiresEl = document.getElementById(PUBLIC_TRACKING_EXPIRES_ID);
            const snapshotEl = document.getElementById(PUBLIC_TRACKING_SNAPSHOT_ID);
            const copyBtn = document.getElementById(PUBLIC_TRACKING_COPY_ID);
            const revokeBtn = document.getElementById(PUBLIC_TRACKING_REVOKE_ID);
            const submitBtn = document.getElementById('actionModalSubmitBtn');

            function syncPublicTrackingModalUi() {
                const hasActiveLink = currentLink?.active === true && String(currentLink?.tracking_url || '').trim();
                if (statusEl instanceof HTMLElement) {
                    const shortCode = String(currentLink?.short_code || '').trim();
                    statusEl.textContent = hasActiveLink
                        ? shortCode
                            ? `Link corto activo (${shortCode}).`
                            : `Link activo (${String(currentLink?.status || 'active')}).`
                        : currentLink?.status === 'expired'
                            ? 'El Ãºltimo enlace ya expirÃ³.'
                            : 'No hay un enlace pÃºblico activo.';
                }
                if (urlInput instanceof HTMLInputElement) {
                    urlInput.value = hasActiveLink ? String(currentLink.tracking_url) : '';
                }
                if (urlLink instanceof HTMLAnchorElement) {
                    if (hasActiveLink) {
                        urlLink.href = String(currentLink.tracking_url);
                        urlLink.hidden = false;
                    } else {
                        urlLink.hidden = true;
                        urlLink.removeAttribute('href');
                    }
                }
                if (expiresEl instanceof HTMLElement) {
                    expiresEl.textContent = hasActiveLink && currentLink?.expires_at
                        ? `Expira: ${new Date(currentLink.expires_at).toLocaleString('es-ES')}`
                        : 'Expiracion: s/d';
                }
                if (snapshotEl instanceof HTMLElement) {
                    const snapshot = currentLink?.snapshot || {};
                    snapshotEl.textContent = snapshot?.public_status
                        ? `Estado pÃºblico cacheado: ${snapshot.public_status} (${snapshot.public_message || 'sin mensaje'})`
                        : 'Estado pÃºblico cacheado: s/d';
                }
                if (isButtonElement(copyBtn)) {
                    copyBtn.disabled = !hasActiveLink;
                }
                if (isButtonElement(revokeBtn)) {
                    revokeBtn.disabled = !hasActiveLink;
                }
                if (isButtonElement(submitBtn)) {
                    submitBtn.textContent = hasActiveLink ? 'Regenerar enlace' : 'Crear enlace';
                    submitBtn.dataset.defaultLabel = submitBtn.textContent;
                }
            }

            copyBtn?.addEventListener('click', async () => {
                try {
                    await copyTextToClipboard(currentLink?.tracking_url || '');
                    options.showNotification('Enlace copiado al portapapeles.', 'success');
                } catch (error) {
                    options.showNotification(error?.message || 'No se pudo copiar el enlace.', 'warning');
                }
            });

            revokeBtn?.addEventListener('click', async () => {
                if (!(currentLink?.active === true)) return;
                await options.api.deleteInstallationPublicTrackingLink(targetInstallationId);
                currentLink = {
                    active: false,
                    status: 'revoked',
                    tracking_url: null,
                    snapshot: currentLink?.snapshot || null,
                };
                syncPublicTrackingModalUi();
                options.showNotification('Enlace pÃºblico revocado.', 'info');
            });

            try {
                const result = await options.api.getInstallationPublicTrackingLink(targetInstallationId);
                currentLink = result?.link || null;
            } catch (error) {
                currentLink = null;
                if (statusEl instanceof HTMLElement) {
                    statusEl.textContent = error?.message || 'No se pudo cargar el estado del enlace.';
                }
            }
            syncPublicTrackingModalUi();
        }
        return {
            bindIncidentMapControls,
            bindIncidentDispatchPlacesAutocomplete,
            buildIncidentMapsUrl,
            ensureAssignedIncidentMapDefaults,
            formatIncidentCoordinateLine,
            loadIncidentMap,
            openPublicTrackingModal,
            renderIncidentMap,
            resolveIncidentOperationalCoordinates,
        };
    }

    global.createDashboardIncidentsMap = createDashboardIncidentsMap;
})(window);

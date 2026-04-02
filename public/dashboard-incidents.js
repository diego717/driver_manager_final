(function attachDashboardIncidentsFactory(global) {
    function createDashboardIncidents(options) {
        const INCIDENT_PHOTO_UPLOAD_MAX_FILES = 5;
        const INCIDENT_PHOTO_UPLOAD_MAX_FILE_BYTES = 5 * 1024 * 1024;
        const INCIDENT_PHOTO_UPLOAD_TARGET_FILE_BYTES = Math.round(2.5 * 1024 * 1024);
        const INCIDENT_PHOTO_UPLOAD_MAX_BATCH_BYTES = 20 * 1024 * 1024;
        const INCIDENT_PHOTO_UPLOAD_MAX_DIMENSION = 1600;
        const INCIDENT_PHOTO_UPLOAD_COMPRESS_QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42];
        const INCIDENT_PHOTO_UPLOAD_LABEL = `Subir fotos (max ${INCIDENT_PHOTO_UPLOAD_MAX_FILES} / 20MB)`;
        const INCIDENT_STATUS_ACTION_DEFINITIONS = {
            open: { label: 'Abrir', icon: 'radio_button_checked' },
            in_progress: { label: 'En curso', icon: 'pending_actions' },
            paused: { label: 'Pausar', icon: 'pause_circle' },
            resolved: { label: 'Resolver', icon: 'task_alt' },
        };
        const CONFORMITY_GPS_PANEL_ID = 'actionConformityGpsPanel';
        const CONFORMITY_GPS_STATUS_ID = 'actionConformityGpsStatus';
        const CONFORMITY_GPS_SUMMARY_ID = 'actionConformityGpsSummary';
        const CONFORMITY_GPS_RETRY_ID = 'actionConformityGpsRetryBtn';
        const CONFORMITY_GPS_OVERRIDE_WRAP_ID = 'actionConformityGpsOverrideWrap';
        const CONFORMITY_GPS_OVERRIDE_INPUT_ID = 'actionConformityGpsOverrideNote';
        const CONFORMITY_GPS_OVERRIDE_HELP_ID = 'actionConformityGpsOverrideHelp';
        const INCIDENT_GEOFENCE_OVERRIDE_WRAP_ID = 'actionIncidentGeofenceOverrideWrap';
        const INCIDENT_GEOFENCE_OVERRIDE_INPUT_ID = 'actionIncidentGeofenceOverrideNote';
        const INCIDENT_GEOFENCE_OVERRIDE_HELP_ID = 'actionIncidentGeofenceOverrideHelp';
        const PUBLIC_TRACKING_URL_INPUT_ID = 'actionPublicTrackingUrl';
        const PUBLIC_TRACKING_STATUS_ID = 'actionPublicTrackingStatus';
        const PUBLIC_TRACKING_EXPIRES_ID = 'actionPublicTrackingExpires';
        const PUBLIC_TRACKING_SNAPSHOT_ID = 'actionPublicTrackingSnapshot';
        const PUBLIC_TRACKING_COPY_ID = 'actionPublicTrackingCopyBtn';
        const PUBLIC_TRACKING_REVOKE_ID = 'actionPublicTrackingRevokeBtn';
        const CONFORMITY_SIGNATURE_CANVAS_ID = 'actionConformitySignatureCanvas';
        const CONFORMITY_SIGNATURE_CLEAR_ID = 'actionConformitySignatureClearBtn';
        let currentConformitySignaturePad = null;
        const INCIDENT_MAP_DEFAULT_DAYS = '30';
        const INCIDENT_MAP_DEFAULT_LIMIT = 240;
        const INCIDENT_MAP_ALLOWED_DAYS = new Set(['7', '30', '90', 'all']);
        const INCIDENT_MAP_SOURCE_ID = 'incident-map-source';
        const INCIDENT_MAP_LAYER_ID = 'incident-map-points';
        const INCIDENT_MAP_LAYER_HALO_ID = 'incident-map-points-halo';
        const INCIDENT_MAP_DEFAULT_CENTER = [-56.1645, -34.9011];
        let incidentMapState = {
            days: INCIDENT_MAP_DEFAULT_DAYS,
            status: '',
            severity: '',
            incidents: [],
            selectedIncidentId: null,
            loading: false,
            map: null,
            mapLoaded: false,
            currentStyleUrl: '',
            currentToken: '',
            pendingFitBounds: false,
        };
        let incidentMapRequestVersion = 0;

        function canCurrentUserAuditDeletedIncidents() {
            const role = String(options.getCurrentUser?.()?.role || '').toLowerCase();
            return role === 'super_admin';
        }

        function canCurrentUserManagePublicTracking() {
            const role = String(options.getCurrentUser?.()?.role || '').toLowerCase();
            return role === 'admin' || role === 'super_admin';
        }

        let includeDeletedIncidentsAudit = false;
        const recentLocalStatusUpdates = new Map();
        const LOCAL_STATUS_UPDATE_TTL_MS = 5000;
        let incidentsRenderSequence = 0;

        function formatPhotoBytes(bytes) {
            const numericBytes = Math.max(0, Number(bytes) || 0);
            if (numericBytes >= 1024 * 1024) {
                return `${(numericBytes / (1024 * 1024)).toFixed(1)}MB`;
            }
            if (numericBytes >= 1024) {
                return `${Math.round(numericBytes / 1024)}KB`;
            }
            return `${numericBytes}B`;
        }

        function readPhotoFileAsDataUrl(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(new Error('No se pudo leer la foto seleccionada.'));
                reader.readAsDataURL(file);
            });
        }

        function loadImageForOptimization(sourceUrl) {
            return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('No se pudo decodificar la foto seleccionada.'));
                image.src = sourceUrl;
            });
        }

        function canvasToBlob(canvas, mimeType, quality) {
            return new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                        return;
                    }
                    reject(new Error('No se pudo exportar la foto optimizada.'));
                }, mimeType, quality);
            });
        }

        async function optimizeIncidentPhotoFile(file) {
            const originalSize = Math.max(0, Number(file?.size) || 0);
            const normalizedType = String(file?.type || '').trim().toLowerCase();
            const canOptimize =
                file instanceof File &&
                /^image\/(jpeg|jpg|webp|png)$/i.test(normalizedType) &&
                typeof FileReader !== 'undefined' &&
                typeof Image !== 'undefined' &&
                typeof document !== 'undefined';

            if (!canOptimize) {
                return { file, optimized: false, originalSize, finalSize: originalSize };
            }

            try {
                const sourceUrl = await readPhotoFileAsDataUrl(file);
                const image = await loadImageForOptimization(sourceUrl);
                const width = Math.max(1, Number(image.naturalWidth || image.width) || 1);
                const height = Math.max(1, Number(image.naturalHeight || image.height) || 1);
                const ratio = Math.min(1, INCIDENT_PHOTO_UPLOAD_MAX_DIMENSION / Math.max(width, height));
                const targetWidth = Math.max(1, Math.round(width * ratio));
                const targetHeight = Math.max(1, Math.round(height * ratio));

                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetHeight;
                const context = canvas.getContext('2d');
                if (!context) {
                    return { file, optimized: false, originalSize, finalSize: originalSize };
                }
                context.drawImage(image, 0, 0, targetWidth, targetHeight);

                const shouldPreservePng = normalizedType === 'image/png';
                const exportMimeType = shouldPreservePng ? 'image/png' : 'image/jpeg';
                const exportName = shouldPreservePng
                    ? String(file.name || 'incident-photo').replace(/\.[a-z0-9]+$/i, '.png')
                    : String(file.name || 'incident-photo').replace(/\.[a-z0-9]+$/i, '.jpg');

                let bestBlob = null;
                let bestSize = Number.POSITIVE_INFINITY;
                const qualities = shouldPreservePng ? [undefined] : INCIDENT_PHOTO_UPLOAD_COMPRESS_QUALITIES;

                for (const quality of qualities) {
                    const blob = await canvasToBlob(canvas, exportMimeType, quality);
                    const blobSize = Math.max(0, Number(blob.size) || 0);
                    if (blobSize > 0 && blobSize < bestSize) {
                        bestBlob = blob;
                        bestSize = blobSize;
                    }
                    if (
                        blobSize >= 1024 &&
                        blobSize <= INCIDENT_PHOTO_UPLOAD_TARGET_FILE_BYTES
                    ) {
                        bestBlob = blob;
                        bestSize = blobSize;
                        break;
                    }
                }

                if (!bestBlob || !Number.isFinite(bestSize) || bestSize <= 0) {
                    return { file, optimized: false, originalSize, finalSize: originalSize };
                }

                if (bestSize >= originalSize && ratio === 1 && !shouldPreservePng) {
                    return { file, optimized: false, originalSize, finalSize: originalSize };
                }

                const optimizedFile = new File([bestBlob], exportName, {
                    type: exportMimeType,
                    lastModified: Date.now(),
                });
                return {
                    file: optimizedFile,
                    optimized: optimizedFile.size !== originalSize || optimizedFile.type !== normalizedType,
                    originalSize,
                    finalSize: Math.max(0, Number(optimizedFile.size) || 0),
                };
            } catch {
                return { file, optimized: false, originalSize, finalSize: originalSize };
            }
        }

        function runIncidentRefreshInBackground(config = {}, failureMessage = 'La incidencia se guardo, pero no pudimos refrescar la vista.') {
            void refreshIncidentContext(config).catch(() => {
                options.showNotification(failureMessage, 'warning');
            });
        }

        function pruneRecentLocalStatusUpdates(now = Date.now()) {
            recentLocalStatusUpdates.forEach((entry, incidentId) => {
                if (!entry || (now - entry.at) > LOCAL_STATUS_UPDATE_TTL_MS) {
                    recentLocalStatusUpdates.delete(incidentId);
                }
            });
        }

        function rememberRecentLocalStatusUpdate(incident, fallbackStatus = '') {
            const incidentId = options.parseStrictInteger(incident?.id);
            if (!Number.isInteger(incidentId) || incidentId <= 0) return;
            recentLocalStatusUpdates.set(incidentId, {
                at: Date.now(),
                status: options.normalizeIncidentStatus(incident?.incident_status || fallbackStatus),
            });
            pruneRecentLocalStatusUpdates();
        }

        function consumeRecentLocalStatusUpdate(incident) {
            pruneRecentLocalStatusUpdates();
            const incidentId = options.parseStrictInteger(incident?.id);
            if (!Number.isInteger(incidentId) || incidentId <= 0) return false;
            const recentEntry = recentLocalStatusUpdates.get(incidentId);
            if (!recentEntry) return false;
            const incomingStatus = options.normalizeIncidentStatus(incident?.incident_status);
            if (recentEntry.status && recentEntry.status !== incomingStatus) {
                return false;
            }
            recentLocalStatusUpdates.delete(incidentId);
            return true;
        }

        async function refreshIncidentContext(config = {}) {
            const parsedAssetId = options.parseStrictInteger(config.assetId);
            if (Number.isInteger(parsedAssetId) && parsedAssetId > 0) {
                await options.loadAssetDetail(parsedAssetId, { keepSelection: true });
                return;
            }

            const parsedInstallationId = options.parseStrictInteger(config.installationId);
            if (Number.isInteger(parsedInstallationId) && parsedInstallationId > 0) {
                await showIncidentsForInstallation(parsedInstallationId);
                return;
            }

            const activeAssetsSection = document.getElementById('assetsSection')?.classList.contains('active');
            const activeIncidentsSection = document.getElementById('incidentsSection')?.classList.contains('active');
            const currentSelectedAssetId = options.getCurrentSelectedAssetId();
            const currentSelectedInstallationId = options.getCurrentSelectedInstallationId();

            if (activeAssetsSection && Number.isInteger(currentSelectedAssetId) && currentSelectedAssetId > 0) {
                await options.loadAssetDetail(currentSelectedAssetId, { keepSelection: true });
                return;
            }

            if (
                activeIncidentsSection
                && Number.isInteger(currentSelectedInstallationId)
                && currentSelectedInstallationId > 0
            ) {
                await showIncidentsForInstallation(currentSelectedInstallationId);
                return;
            }

            if (Number.isInteger(currentSelectedInstallationId) && currentSelectedInstallationId > 0) {
                await showIncidentsForInstallation(currentSelectedInstallationId);
                return;
            }

            if (Number.isInteger(currentSelectedAssetId) && currentSelectedAssetId > 0) {
                await options.loadAssetDetail(currentSelectedAssetId, { keepSelection: true });
            }
        }

        function parseChecklistItemsFromMultiline(value) {
            return String(value || '')
                .split('\n')
                .map((item) => item.trim())
                .filter((item) => item.length > 0);
        }

        function dedupeChecklistItems(values) {
            const result = [];
            const seen = new Set();
            for (const rawValue of values || []) {
                const item = String(rawValue || '').trim();
                if (!item || seen.has(item)) continue;
                seen.add(item);
                result.push(item);
                if (result.length >= 30) break;
            }
            return result;
        }

        function getSeverityIconName(severity) {
            const normalized = options.normalizeSeverity(severity);
            if (normalized === 'critical') return 'emergency_home';
            if (normalized === 'high') return 'warning';
            if (normalized === 'medium') return 'priority_high';
            return 'info';
        }

        function createIncidentHighlightChip(text, tone = 'neutral') {
            const chip = document.createElement('span');
            chip.className = 'incident-highlight-chip';
            chip.dataset.tone = tone;
            chip.textContent = text;
            requestAnimationFrame(() => {
                chip.classList.add('is-visible');
            });
            return chip;
        }

        function pulseIncidentHighlightChip(chip) {
            if (!(chip instanceof HTMLElement)) return;
            chip.classList.remove('is-pulsing');
            void chip.offsetWidth;
            chip.classList.add('is-pulsing');
        }

        function normalizeIncidentContextText(value) {
            const normalized = String(value || '').trim();
            if (!normalized) return '';
            const collapsed = normalized.replace(/\s+/g, ' ');
            if (['-', 'sin cliente', 'sin contexto', 'n/a'].includes(collapsed.toLowerCase())) {
                return '';
            }
            return collapsed;
        }

        function appendIncidentContextSummary(parent, incident, config = {}) {
            const installationId = options.parseStrictInteger(config.installationId ?? incident?.installation_id);
            const assetId = options.parseStrictInteger(config.assetId ?? incident?.asset_id);
            const clientName = normalizeIncidentContextText(incident?.installation_client_name);

            const title = clientName
                || (Number.isInteger(assetId) && assetId > 0 ? `Equipo #${assetId}` : '')
                || (Number.isInteger(installationId) && installationId > 0 ? `Registro #${installationId}` : '');
            if (!title) return;

            const contextBlock = document.createElement('div');
            contextBlock.className = 'incident-context-summary';

            const primary = document.createElement('strong');
            primary.className = 'incident-context-primary';
            primary.textContent = title;
            contextBlock.appendChild(primary);

            const metaParts = [];
            if (Number.isInteger(assetId) && assetId > 0) {
                metaParts.push(`Equipo #${assetId}`);
            }
            if (Number.isInteger(installationId) && installationId > 0) {
                metaParts.push(`Registro #${installationId}`);
            }

            const installationBrand = normalizeIncidentContextText(incident?.installation_brand);
            const installationVersion = normalizeIncidentContextText(incident?.installation_version);
            const productLabel = [installationBrand, installationVersion].filter(Boolean).join(' ');
            if (productLabel) {
                metaParts.push(productLabel);
            }

            if (metaParts.length) {
                const secondary = document.createElement('small');
                secondary.className = 'incident-context-meta';
                secondary.textContent = metaParts.join(' | ');
                contextBlock.appendChild(secondary);
            }

            parent.appendChild(contextBlock);
        }

        function appendIncidentHighlights(parent, incident, config = {}) {
            const highlights = document.createElement('div');
            highlights.className = 'incident-highlights';

            const installationId = options.parseStrictInteger(config.installationId ?? incident?.installation_id);
            const assetId = options.parseStrictInteger(config.assetId ?? incident?.asset_id);
            const statusValue = options.normalizeIncidentStatus(incident?.incident_status);
            const estimatedDurationSeconds = options.resolveIncidentEstimatedDurationSeconds(incident);
            const realDurationSeconds = options.resolveIncidentRealDurationSeconds(incident);

            highlights.appendChild(
                createIncidentHighlightChip(
                    `Tiempo estimado: ${options.formatDuration(estimatedDurationSeconds)}`,
                    estimatedDurationSeconds > 0 ? 'accent' : 'neutral',
                ),
            );

            if (Number.isInteger(realDurationSeconds) && realDurationSeconds >= 0) {
                const runtimeChip = createIncidentHighlightChip(
                    `Tiempo real: ${options.formatDuration(realDurationSeconds)}${statusValue === 'in_progress'
                        ? ' (en curso)'
                        : statusValue === 'paused'
                            ? ' (en pausa)'
                            : ''
                    }`,
                    statusValue === 'resolved' ? 'resolved' : statusValue,
                );
                runtimeChip.dataset.chip = 'runtime';
                if (statusValue === 'in_progress') {
                    const runtimeStartMs = options.resolveIncidentRuntimeStartMs(incident);
                    if (Number.isFinite(runtimeStartMs) && runtimeStartMs > 0) {
                        runtimeChip.dataset.runtimeLive = '1';
                        runtimeChip.dataset.runtimeStartMs = String(runtimeStartMs);
                        runtimeChip.dataset.runtimeBaseSeconds = String(
                            Math.max(0, Number(incident?.actual_duration_seconds || 0) || 0),
                        );
                        options.ensureIncidentRuntimeTicker();
                    }
                }
                highlights.appendChild(runtimeChip);
            }

            if (
                (!Number.isInteger(installationId) || installationId <= 0)
                && (!Number.isInteger(assetId) || assetId <= 0)
            ) {
                highlights.appendChild(createIncidentHighlightChip('Contexto automatico', 'info'));
            }

            parent.appendChild(highlights);
        }

        function notifyGeofenceWarning() {}

        function hasValidSiteConfig(installation) {
            return Number.isFinite(Number(installation?.site_lat))
                && Number.isFinite(Number(installation?.site_lng))
                && Number(installation?.site_radius_m) > 0;
        }

        function haversineDistanceMeters(fromLat, fromLng, toLat, toLng) {
            const earthRadiusM = 6371000;
            const toRadians = (value) => (Number(value) * Math.PI) / 180;
            const lat1 = toRadians(fromLat);
            const lat2 = toRadians(toLat);
            const deltaLat = toRadians(Number(toLat) - Number(fromLat));
            const deltaLng = toRadians(Number(toLng) - Number(fromLng));
            const sinLat = Math.sin(deltaLat / 2);
            const sinLng = Math.sin(deltaLng / 2);
            const a = sinLat * sinLat
                + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return earthRadiusM * c;
        }

        function evaluateClientGeofence(snapshot, installation) {
            if (!hasValidSiteConfig(installation)) return null;
            const status = String(snapshot?.status || '').trim().toLowerCase();
            if (status !== 'captured') {
                return {
                    result: 'not_applicable',
                    distance_m: null,
                    radius_m: Number(installation.site_radius_m),
                };
            }

            const lat = Number(snapshot?.lat);
            const lng = Number(snapshot?.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                return {
                    result: 'not_applicable',
                    distance_m: null,
                    radius_m: Number(installation.site_radius_m),
                };
            }

            const radius = Number(installation.site_radius_m);
            const distance = haversineDistanceMeters(
                Number(installation.site_lat),
                Number(installation.site_lng),
                lat,
                lng,
            );
            return {
                result: distance <= radius ? 'inside' : 'outside',
                distance_m: distance,
                radius_m: radius,
            };
        }

        function buildIncidentMapsUrl(incident) {
            const lat = Number(incident?.gps_lat);
            const lng = Number(incident?.gps_lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
            return `https://www.google.com/maps?q=${lat},${lng}`;
        }

        function resolveIncidentMapboxToken() {
            const globalToken = String(window.__DM_MAPBOX_ACCESS_TOKEN__ || '').trim();
            if (globalToken) return globalToken;
            try {
                return String(window.localStorage.getItem('dm_mapbox_access_token') || '').trim();
            } catch {
                return '';
            }
        }

        function resolveIncidentMapStyleUrl() {
            const isDark = document.body?.dataset?.theme === 'dark';
            const themeStyle = String(
                isDark
                    ? window.__DM_MAPBOX_STYLE_URL_DARK__ || ''
                    : window.__DM_MAPBOX_STYLE_URL_LIGHT__ || '',
            ).trim();
            if (themeStyle) return themeStyle;

            const globalStyle = String(window.__DM_MAPBOX_STYLE_URL__ || '').trim();
            if (globalStyle) return globalStyle;
            try {
                const themeStoredStyle = String(
                    isDark
                        ? window.localStorage.getItem('dm_mapbox_style_url_dark') || ''
                        : window.localStorage.getItem('dm_mapbox_style_url_light') || '',
                ).trim();
                if (themeStoredStyle) return themeStoredStyle;
                const storedStyle = String(window.localStorage.getItem('dm_mapbox_style_url') || '').trim();
                if (storedStyle) return storedStyle;
            } catch {
                // ignore localStorage access issues
            }
            return isDark
                ? 'mapbox://styles/mapbox/dark-v11'
                : 'mapbox://styles/mapbox/light-v11';
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

        function destroyIncidentMap() {
            if (incidentMapState.map && typeof incidentMapState.map.remove === 'function') {
                incidentMapState.map.remove();
            }
            incidentMapState.map = null;
            incidentMapState.mapLoaded = false;
            incidentMapState.currentStyleUrl = '';
            incidentMapState.currentToken = '';
        }

        function buildIncidentMapGeoJson(incidents) {
            return {
                type: 'FeatureCollection',
                features: (Array.isArray(incidents) ? incidents : [])
                    .filter((incident) => (
                        Number.isFinite(Number(incident?.gps_lat)) && Number.isFinite(Number(incident?.gps_lng))
                    ))
                    .map((incident) => {
                        const incidentId = options.parseStrictInteger(incident?.id) || 0;
                        return {
                            type: 'Feature',
                            geometry: {
                                type: 'Point',
                                coordinates: [Number(incident.gps_lng), Number(incident.gps_lat)],
                            },
                            properties: {
                                id: incidentId,
                                client_name: String(incident?.installation_client_name || '').trim(),
                                asset_code: String(incident?.asset_code || '').trim(),
                                severity: getIncidentMapSeverityTone(incident?.severity),
                                status: getIncidentMapStatusTone(incident?.incident_status),
                                selected: incidentId === incidentMapState.selectedIncidentId ? 1 : 0,
                            },
                        };
                    }),
            };
        }

        function ensureIncidentMapLayers(mapInstance) {
            if (!mapInstance || !incidentMapState.mapLoaded) return;

            if (!mapInstance.getSource(INCIDENT_MAP_SOURCE_ID)) {
                mapInstance.addSource(INCIDENT_MAP_SOURCE_ID, {
                    type: 'geojson',
                    data: buildIncidentMapGeoJson([]),
                });
            }

            if (!mapInstance.getLayer(INCIDENT_MAP_LAYER_HALO_ID)) {
                mapInstance.addLayer({
                    id: INCIDENT_MAP_LAYER_HALO_ID,
                    type: 'circle',
                    source: INCIDENT_MAP_SOURCE_ID,
                    paint: {
                        'circle-radius': [
                            'case',
                            ['==', ['get', 'selected'], 1],
                            16,
                            11,
                        ],
                        'circle-color': [
                            'match',
                            ['get', 'severity'],
                            'critical', '#ef5b4d',
                            'high', '#f09a29',
                            'medium', '#0f756d',
                            '#3fa57c',
                        ],
                        'circle-opacity': [
                            'case',
                            ['==', ['get', 'selected'], 1],
                            0.24,
                            0.12,
                        ],
                        'circle-stroke-width': 0,
                    },
                });
            }

            if (!mapInstance.getLayer(INCIDENT_MAP_LAYER_ID)) {
                mapInstance.addLayer({
                    id: INCIDENT_MAP_LAYER_ID,
                    type: 'circle',
                    source: INCIDENT_MAP_SOURCE_ID,
                    paint: {
                        'circle-radius': [
                            'case',
                            ['==', ['get', 'selected'], 1],
                            8,
                            6,
                        ],
                        'circle-color': [
                            'match',
                            ['get', 'severity'],
                            'critical', '#ff6b5c',
                            'high', '#ef7f1a',
                            'medium', '#0f756d',
                            '#3fa57c',
                        ],
                        'circle-stroke-width': [
                            'case',
                            ['==', ['get', 'selected'], 1],
                            3,
                            2,
                        ],
                        'circle-stroke-color': '#ffffff',
                        'circle-opacity': [
                            'match',
                            ['get', 'status'],
                            'resolved', 0.68,
                            'paused', 0.8,
                            0.96,
                        ],
                    },
                });
            }
        }

        function syncIncidentMapSource() {
            if (!incidentMapState.map || !incidentMapState.mapLoaded) return [];
            ensureIncidentMapLayers(incidentMapState.map);
            const source = incidentMapState.map.getSource(INCIDENT_MAP_SOURCE_ID);
            const geoJson = buildIncidentMapGeoJson(incidentMapState.incidents);
            if (source && typeof source.setData === 'function') {
                source.setData(geoJson);
            }
            return geoJson.features || [];
        }

        function fitIncidentMapToFeatures(features) {
            if (!incidentMapState.map || !Array.isArray(features) || !features.length) return;
            if (features.length === 1) {
                incidentMapState.map.easeTo({
                    center: features[0].geometry.coordinates,
                    zoom: 12.6,
                    duration: 700,
                });
                return;
            }

            const bounds = new window.mapboxgl.LngLatBounds();
            features.forEach((feature) => {
                bounds.extend(feature.geometry.coordinates);
            });
            incidentMapState.map.fitBounds(bounds, {
                padding: { top: 68, right: 72, bottom: 68, left: 72 },
                duration: 700,
                maxZoom: 12.8,
            });
        }

        function focusIncidentInMap() {
            if (!incidentMapState.map || !incidentMapState.mapLoaded || !incidentMapState.selectedIncidentId) return;
            const selectedIncident = incidentMapState.incidents.find((incident) => (
                options.parseStrictInteger(incident?.id) === incidentMapState.selectedIncidentId
            ));
            if (!selectedIncident) return;
            const lng = Number(selectedIncident?.gps_lng);
            const lat = Number(selectedIncident?.gps_lat);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            incidentMapState.map.easeTo({
                center: [lng, lat],
                duration: 550,
                offset: [0, -40],
            });
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
            if (normalized === 'critical') return 'Crítica';
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
                `${total} punto${total === 1 ? '' : 's'} visibles`,
                `${critical} crítica${critical === 1 ? '' : 's'}`,
                `${active} activa${active === 1 ? '' : 's'}`,
                `${uniqueClients} cliente${uniqueClients === 1 ? '' : 's'}`,
            ].forEach((label) => {
                const chip = document.createElement('span');
                chip.className = 'incident-map-summary-chip';
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

                const title = document.createElement('strong');
                title.textContent = String(incident?.installation_client_name || `Incidencia #${incident?.id || '-'}`).trim();
                const meta = document.createElement('span');
                const assetCode = String(incident?.asset_code || '').trim();
                meta.textContent = `${assetCode || `Registro #${incident?.installation_id || '-'}`} · ${formatIncidentMapRelativeTime(incident?.created_at)}`;
                button.append(title, meta);
                button.addEventListener('click', () => {
                    incidentMapState.selectedIncidentId = options.parseStrictInteger(incident?.id);
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
                empty.textContent = 'No hay incidencias con coordenadas para este filtro.';
                container.appendChild(empty);
                return;
            }

            const selectedIncident = incidentMapState.incidents.find((incident) => (
                options.parseStrictInteger(incident?.id) === incidentMapState.selectedIncidentId
            )) || incidentMapState.incidents[0];
            const selectedIncidentId = options.parseStrictInteger(selectedIncident?.id);
            incidentMapState.selectedIncidentId = selectedIncidentId;

            const header = document.createElement('div');
            header.className = 'incident-map-detail-head';
            const eyebrow = document.createElement('span');
            eyebrow.className = 'incident-map-detail-eyebrow';
            eyebrow.textContent = `Incidencia #${selectedIncidentId || '-'}`;
            const title = document.createElement('h4');
            title.textContent = String(selectedIncident?.installation_client_name || 'Sin cliente').trim() || 'Sin cliente';
            const summary = document.createElement('p');
            const assetCode = String(selectedIncident?.asset_code || '').trim();
            summary.textContent = `${assetCode || 'Sin equipo'} · ${options.incidentStatusLabel(selectedIncident?.incident_status)} · ${formatIncidentMapRelativeTime(selectedIncident?.created_at)}`;
            header.append(eyebrow, title, summary);
            container.appendChild(header);

            const metrics = document.createElement('div');
            metrics.className = 'incident-map-detail-metrics';
            [
                ['Severidad', getIncidentMapSeverityLabel(selectedIncident?.severity)],
                ['Tecnico', String(selectedIncident?.reporter_username || 'Sin dato').trim() || 'Sin dato'],
                ['Precision', Number.isFinite(Number(selectedIncident?.gps_accuracy_m)) ? `${Math.round(Number(selectedIncident.gps_accuracy_m))} m` : 'Sin dato'],
                ['Registro', `#${options.parseStrictInteger(selectedIncident?.installation_id) || '-'}`],
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
            coordinate.textContent = `Lat ${Number(selectedIncident?.gps_lat).toFixed(5)} · Lng ${Number(selectedIncident?.gps_lng).toFixed(5)}`;
            container.appendChild(coordinate);

            const actions = document.createElement('div');
            actions.className = 'incident-map-detail-actions';

            const openCaseBtn = document.createElement('button');
            openCaseBtn.type = 'button';
            openCaseBtn.className = 'btn-primary';
            openCaseBtn.innerHTML = '<span class="material-symbols-outlined icon-inline-sm">warning</span> Abrir caso';
            openCaseBtn.addEventListener('click', async () => {
                await showIncidentsForInstallation(selectedIncident?.installation_id, {
                    focusIncidentId: selectedIncidentId,
                });
            });
            actions.appendChild(openCaseBtn);

            const mapsUrl = buildIncidentMapsUrl(selectedIncident);
            if (mapsUrl) {
                const mapsLink = document.createElement('a');
                mapsLink.className = 'btn-secondary';
                mapsLink.href = mapsUrl;
                mapsLink.target = '_blank';
                mapsLink.rel = 'noreferrer noopener';
                mapsLink.innerHTML = '<span class="material-symbols-outlined icon-inline-sm">travel_explore</span> Ver en Maps';
                actions.appendChild(mapsLink);
            }
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
            if (!window.mapboxgl || typeof window.mapboxgl.Map !== 'function') {
                destroyIncidentMap();
                renderIncidentMapCanvasMessage('Mapbox GL JS no pudo cargarse en este navegador.', 'error');
                return false;
            }

            const token = resolveIncidentMapboxToken();
            if (!token) {
                destroyIncidentMap();
                renderIncidentMapCanvasMessage('Configura `dm_mapbox_access_token` para ver el mapa real de incidencias.', 'neutral');
                return false;
            }

            const styleUrl = resolveIncidentMapStyleUrl();
            const requiresRebuild =
                !incidentMapState.map
                || incidentMapState.currentToken !== token
                || incidentMapState.currentStyleUrl !== styleUrl;

            if (!requiresRebuild) {
                return true;
            }

            destroyIncidentMap();
            canvas.innerHTML = '';
            window.mapboxgl.accessToken = token;

            const map = new window.mapboxgl.Map({
                container: canvas,
                style: styleUrl,
                center: INCIDENT_MAP_DEFAULT_CENTER,
                zoom: 8.8,
                attributionControl: false,
            });
            map.addControl(new window.mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

            map.on('load', () => {
                incidentMapState.mapLoaded = true;
                ensureIncidentMapLayers(map);
                renderIncidentMap();
            });
            map.on('mouseenter', INCIDENT_MAP_LAYER_ID, () => {
                map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', INCIDENT_MAP_LAYER_ID, () => {
                map.getCanvas().style.cursor = '';
            });
            map.on('click', INCIDENT_MAP_LAYER_ID, (event) => {
                const feature = Array.isArray(event?.features) ? event.features[0] : null;
                const incidentId = options.parseStrictInteger(feature?.properties?.id);
                if (!Number.isInteger(incidentId) || incidentId <= 0) return;
                incidentMapState.selectedIncidentId = incidentId;
                renderIncidentMap();
            });
            map.on('error', () => {
                if (!incidentMapState.mapLoaded) {
                    renderIncidentMapCanvasMessage('Mapbox no pudo inicializarse. Revisa el token o la conectividad.', 'error');
                }
            });

            incidentMapState.map = map;
            incidentMapState.currentStyleUrl = styleUrl;
            incidentMapState.currentToken = token;
            return true;
        }

        function renderIncidentMap() {
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

            const features = syncIncidentMapSource();
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
            incidentMapState.loading = true;
            if (config.resetSelection === true) {
                incidentMapState.selectedIncidentId = null;
            }
            incidentMapState.pendingFitBounds = config.fitBounds !== false;
            renderIncidentMap();

            try {
                const response = await options.api.getIncidentMap({
                    days: incidentMapState.days,
                    status: incidentMapState.status,
                    severity: incidentMapState.severity,
                    limit: INCIDENT_MAP_DEFAULT_LIMIT,
                });
                if (requestVersion !== incidentMapRequestVersion) return;
                incidentMapState.incidents = Array.isArray(response?.incidents) ? response.incidents : [];
                const selectedStillExists = incidentMapState.incidents.some((incident) => (
                    options.parseStrictInteger(incident?.id) === incidentMapState.selectedIncidentId
                ));
                if (!selectedStillExists) {
                    incidentMapState.selectedIncidentId = options.parseStrictInteger(incidentMapState.incidents[0]?.id);
                }
            } catch (error) {
                if (requestVersion !== incidentMapRequestVersion) return;
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
                    document.querySelectorAll('.incident-map-range-btn').forEach((btn) => {
                        btn.classList.toggle('is-active', btn === button);
                    });
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
            urlGroup.append(urlLabel, urlInput);

            const expires = document.createElement('p');
            expires.id = PUBLIC_TRACKING_EXPIRES_ID;
            expires.className = 'gps-capture-panel-summary';
            expires.textContent = 'Expiracion: s/d';

            const snapshot = document.createElement('p');
            snapshot.id = PUBLIC_TRACKING_SNAPSHOT_ID;
            snapshot.className = 'gps-capture-panel-summary';
            snapshot.textContent = 'Estado publico cacheado: s/d';

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
                options.showNotification('Solo admin o super_admin puede gestionar enlaces publicos.', 'error');
                return;
            }
            const targetInstallationId = options.parseStrictInteger(installationId);
            if (!Number.isInteger(targetInstallationId) || targetInstallationId <= 0) {
                options.showNotification('installation_id invalido para tracking publico.', 'error');
                return;
            }

            let currentLink = null;
            const modalOpened = options.openActionModal({
                title: `Seguimiento publico #${targetInstallationId}`,
                subtitle: 'Genera un Magic Link de solo lectura para compartir el estado actual del servicio.',
                submitLabel: 'Crear enlace',
                focusId: PUBLIC_TRACKING_URL_INPUT_ID,
                fields: buildPublicTrackingManagementFields(),
                onSubmit: async () => {
                    const result = await options.api.createInstallationPublicTrackingLink(targetInstallationId);
                    currentLink = result?.link || null;
                    syncPublicTrackingModalUi();
                    options.showNotification(
                        currentLink?.tracking_url ? 'Enlace publico listo para compartir.' : 'Enlace publico actualizado.',
                        'success',
                    );
                },
            });

            if (!modalOpened) return;

            const statusEl = document.getElementById(PUBLIC_TRACKING_STATUS_ID);
            const urlInput = document.getElementById(PUBLIC_TRACKING_URL_INPUT_ID);
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
                            ? 'El ultimo enlace ya expiro.'
                            : 'No hay un enlace publico activo.';
                }
                if (urlInput instanceof HTMLInputElement) {
                    urlInput.value = hasActiveLink ? String(currentLink.tracking_url) : '';
                }
                if (expiresEl instanceof HTMLElement) {
                    expiresEl.textContent = hasActiveLink && currentLink?.expires_at
                        ? `Expira: ${new Date(currentLink.expires_at).toLocaleString('es-ES')}`
                        : 'Expiracion: s/d';
                }
                if (snapshotEl instanceof HTMLElement) {
                    const snapshot = currentLink?.snapshot || {};
                    snapshotEl.textContent = snapshot?.public_status
                        ? `Estado publico cacheado: ${snapshot.public_status} (${snapshot.public_message || 'sin mensaje'})`
                        : 'Estado publico cacheado: s/d';
                }
                if (copyBtn instanceof HTMLButtonElement) {
                    copyBtn.disabled = !hasActiveLink;
                }
                if (revokeBtn instanceof HTMLButtonElement) {
                    revokeBtn.disabled = !hasActiveLink;
                }
                if (submitBtn instanceof HTMLButtonElement) {
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
                options.showNotification('Enlace publico revocado.', 'info');
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

        function formatIncidentCreatedAtText(value) {
            return value
                ? `Creada: ${new Date(value).toLocaleString('es-ES')}`
                : 'Creada: -';
        }

        function createInputGroup(labelText, control, { htmlFor = '', className = '' } = {}) {
            const group = document.createElement('div');
            group.className = className ? `input-group ${className}` : 'input-group';
            const label = document.createElement('label');
            if (htmlFor) {
                label.setAttribute('for', htmlFor);
            }
            label.textContent = labelText;
            group.append(label, control);
            return group;
        }

        function getAvailableTechnicians() {
            return Array.isArray(options.getAvailableTechnicians?.())
                ? options.getAvailableTechnicians().filter((item) => item && item.is_active)
                : [];
        }

        function normalizeTechnicianName(value) {
            return String(value || '').trim();
        }

        function normalizeTechnicianToken(value) {
            return normalizeTechnicianName(value).toLowerCase();
        }

        function collectAssignmentTechnicianNames(assignments) {
            const names = [];
            const seen = new Set();
            (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
                const name = normalizeTechnicianName(
                    assignment?.technician_display_name || assignment?.display_name || assignment?.technician_name,
                );
                const token = normalizeTechnicianToken(name);
                if (!token || seen.has(token)) return;
                seen.add(token);
                names.push(name);
            });
            return names;
        }

        function resolvePreferredTechnicianValue(preferredTechnicianNames = []) {
            const tokens = preferredTechnicianNames
                .map((value) => normalizeTechnicianToken(value))
                .filter(Boolean);
            if (!tokens.length) return '';

            const matchingTechnician = getAvailableTechnicians().find((technician) =>
                tokens.includes(normalizeTechnicianToken(technician?.display_name)));
            return normalizeTechnicianName(matchingTechnician?.display_name);
        }

        async function loadContextTechnicianAssignments({ incidentId = null, installationId = null, assetId = null } = {}) {
            const normalizedIncidentId = options.parseStrictInteger(incidentId);
            const normalizedInstallationId = options.parseStrictInteger(installationId);
            const normalizedAssetId = options.parseStrictInteger(assetId);
            const incidentPromise =
                Number.isInteger(normalizedIncidentId) && normalizedIncidentId > 0
                    ? options.getTechnicianAssignmentsForEntity?.('incident', normalizedIncidentId, { silent: true })
                        || Promise.resolve([])
                    : Promise.resolve([]);
            const installationPromise =
                Number.isInteger(normalizedInstallationId) && normalizedInstallationId > 0
                    ? options.getTechnicianAssignmentsForEntity?.('installation', normalizedInstallationId, { silent: true })
                        || Promise.resolve([])
                    : Promise.resolve([]);
            const assetPromise =
                Number.isInteger(normalizedAssetId) && normalizedAssetId > 0
                    ? options.getTechnicianAssignmentsForEntity?.('asset', normalizedAssetId, { silent: true })
                        || Promise.resolve([])
                    : Promise.resolve([]);

            const [incidentAssignments, installationAssignments, assetAssignments] = await Promise.all([
                incidentPromise,
                installationPromise,
                assetPromise,
            ]);
            const preferredAssignments = incidentAssignments.length
                ? incidentAssignments
                : installationAssignments.length
                    ? installationAssignments
                    : assetAssignments;
            return {
                incidentAssignments,
                installationAssignments,
                assetAssignments,
                preferredTechnicianNames: collectAssignmentTechnicianNames(preferredAssignments),
                allTechnicianNames: collectAssignmentTechnicianNames([
                    ...incidentAssignments,
                    ...installationAssignments,
                    ...assetAssignments,
                ]),
            };
        }

        function applyTechnicianSelectPreference(select, preferredTechnicianNames = []) {
            if (!(select instanceof HTMLSelectElement)) return;
            if (select.dataset.userSelected === '1') return;

            const preferredValue = resolvePreferredTechnicianValue(preferredTechnicianNames);
            if (preferredValue) {
                select.value = preferredValue;
            }
        }

        async function hydrateTechnicianSelectFromContext(selectId, context = {}) {
            const select = document.getElementById(selectId);
            if (!(select instanceof HTMLSelectElement)) return [];

            const assignmentContext = await loadContextTechnicianAssignments(context);
            applyTechnicianSelectPreference(select, assignmentContext.preferredTechnicianNames);
            return assignmentContext.allTechnicianNames;
        }

        function buildTechnicianSelect({ id, includeCurrentUserOption = true, preferredTechnicianNames = [] } = {}) {
            const select = document.createElement('select');
            select.id = id;

            if (includeCurrentUserOption) {
                const currentLabel = String(options.getCurrentUser?.()?.username || 'Usuario actual').trim() || 'Usuario actual';
                select.appendChild(new Option(`Usuario actual (${currentLabel})`, ''));
            }

            getAvailableTechnicians().forEach((technician) => {
                const detail = technician.employee_code ? ` · ${technician.employee_code}` : '';
                select.appendChild(new Option(`${technician.display_name}${detail}`, technician.display_name || ''));
            });

            applyTechnicianSelectPreference(select, preferredTechnicianNames);
            select.addEventListener('change', () => {
                select.dataset.userSelected = '1';
            });
            return select;
        }

        function createGpsCapturePanel({ panelId, statusId, summaryId, buttonId }) {
            const wrapper = document.createElement('div');
            wrapper.id = panelId;
            wrapper.className = 'gps-capture-panel';
            wrapper.dataset.gpsState = 'pending';

            const header = document.createElement('div');
            header.className = 'gps-capture-panel-header';

            const copyWrap = document.createElement('div');
            copyWrap.className = 'gps-capture-panel-copy';

            const title = document.createElement('strong');
            title.className = 'gps-capture-panel-title';
            title.textContent = 'Ubicacion puntual';

            const status = document.createElement('span');
            status.id = statusId;
            status.className = 'gps-capture-panel-status';
            status.textContent = 'Capturando ubicacion puntual...';

            copyWrap.append(title, status);

            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.id = buttonId;
            retryButton.className = 'btn-secondary';
            retryButton.textContent = 'Capturar ubicacion';

            header.append(copyWrap, retryButton);

            const summary = document.createElement('p');
            summary.id = summaryId;
            summary.className = 'gps-capture-panel-summary';
            summary.textContent = 'Intentamos obtener una ubicacion puntual para este formulario. No bloquea el guardado.';

            wrapper.append(header, summary);
            return wrapper;
        }

        function countActiveIncidents(incidents) {
            return (Array.isArray(incidents) ? incidents : []).filter((incident) => {
                if (String(incident?.deleted_at || '').trim()) return false;
                return options.normalizeIncidentStatus(incident?.incident_status) !== 'resolved';
            }).length;
        }

        function formatConformityStatusLabel(status) {
            const normalized = String(status || '').trim().toLowerCase();
            if (normalized === 'emailed') return 'Email enviado';
            if (normalized === 'email_failed') return 'Email con error';
            return 'Generada';
        }

        function formatConformityGeneratedAt(value) {
            const date = value ? new Date(value) : null;
            if (!date || Number.isNaN(date.getTime())) return 'Sin fecha';
            return date.toLocaleString('es-ES');
        }

        function createConformityStatusChip(label, tone = 'neutral') {
            const chip = document.createElement('span');
            chip.className = 'incident-highlight-chip';
            chip.dataset.tone = tone;
            chip.textContent = label;
            return chip;
        }

        function formatActiveIncidentsLabel(activeIncidentCount) {
            const count = Math.max(0, Number(activeIncidentCount) || 0);
            return count === 0
                ? 'Sin incidencias activas, listo para cerrar'
                : `${count} incidencia${count === 1 ? '' : 's'} activa${count === 1 ? '' : 's'}`;
        }

        function resolveClosureBannerState(activeIncidentCount, latestConformityStatus = '') {
            const count = Math.max(0, Number(activeIncidentCount) || 0);
            const latestStatus = String(latestConformityStatus || '').trim().toLowerCase();
            if (count > 0) {
                return {
                    tone: 'warning',
                    eyebrow: 'En atencion',
                    title: 'Caso en atencion operativa',
                    description: 'Todavia hay incidencias activas. Resuelvelas antes de emitir la conformidad final.',
                };
            }
            if (latestStatus === 'emailed') {
                return {
                    tone: 'resolved',
                    eyebrow: 'Conformidad enviada',
                    title: 'Cierre operativo completado',
                    description: 'La ultima conformidad ya fue generada y enviada por email. Puedes descargar el PDF o reabrir trabajo si surge una novedad.',
                };
            }
            if (latestStatus === 'email_failed') {
                return {
                    tone: 'warning',
                    eyebrow: 'Envio pendiente',
                    title: 'La conformidad existe pero el email fallo',
                    description: 'El PDF ya fue generado. Revisa la constancia anterior o vuelve a emitirla para intentar otro envio.',
                };
            }
            if (latestStatus === 'generated') {
                return {
                    tone: 'info',
                    eyebrow: 'Conformidad generada',
                    title: 'El PDF ya esta disponible',
                    description: 'La constancia ya fue generada, pero no se envio por email. Puedes revisarla o generar una nueva desde este registro.',
                };
            }
            return {
                tone: 'resolved',
                eyebrow: 'Listo para cierre',
                title: 'Caso listo para conformidad',
                description: 'No quedan incidencias activas. Genera la conformidad final y envia el PDF desde aqui.',
            };
        }

        function applyClosureBannerState(banner, activeIncidentCount, latestConformityStatus = '') {
            if (!(banner instanceof HTMLElement)) return;
            const state = resolveClosureBannerState(activeIncidentCount, latestConformityStatus);
            banner.dataset.tone = state.tone;

            const eyebrow = banner.querySelector('[data-role="closure-banner-eyebrow"]');
            if (eyebrow instanceof HTMLElement) {
                eyebrow.textContent = state.eyebrow;
            }

            const title = banner.querySelector('[data-role="closure-banner-title"]');
            if (title instanceof HTMLElement) {
                title.textContent = state.title;
            }

            const description = banner.querySelector('[data-role="closure-banner-description"]');
            if (description instanceof HTMLElement) {
                description.textContent = state.description;
            }
        }

        function applyConformityButtonState(button, activeIncidentCount) {
            if (!(button instanceof HTMLButtonElement)) return;
            const count = Math.max(0, Number(activeIncidentCount) || 0);
            button.dataset.activeIncidentCount = String(count);
            button.className = count === 0 ? 'btn-primary' : 'btn-secondary';
            const iconName = count === 0 ? 'mark_email_read' : 'rule';
            const label = count === 0
                ? 'Enviar conformidad final'
                : 'Revisar incidencias antes de cerrar';
            const icon = options.createMaterialIconNode(iconName);
            if (icon) {
                button.replaceChildren(icon, document.createTextNode(` ${label}`));
            } else {
                button.textContent = label;
            }
        }

        function applyCreateIncidentButtonState(button, activeIncidentCount) {
            if (!(button instanceof HTMLButtonElement)) return;
            const count = Math.max(0, Number(activeIncidentCount) || 0);
            button.dataset.activeIncidentCount = String(count);
            const iconName = count === 0 ? 'add_alert' : 'add_circle';
            const label = count === 0 ? 'Abrir nueva incidencia' : 'Crear incidencia';
            button.className = count === 0 ? 'btn-secondary' : 'btn-primary';
            const icon = options.createMaterialIconNode(iconName);
            if (icon) {
                button.replaceChildren(icon, document.createTextNode(` ${label}`));
            } else {
                button.textContent = label;
            }
            if (count === 0) {
                button.title = 'El caso quedo listo para conformidad. Usa esto solo si necesitas reabrir trabajo con una incidencia nueva.';
            } else {
                button.removeAttribute('title');
            }
        }

        function syncVisibleIncidentsHeaderState() {
            const container = document.getElementById('incidentsList');
            if (!(container instanceof HTMLElement)) return;
            const header = container.querySelector('.incidents-header');
            if (!(header instanceof HTMLElement)) return;

            const cards = Array.from(container.querySelectorAll('.incident-card'));
            const activeIncidentCount = cards.filter((card) => {
                if (!(card instanceof HTMLElement)) return false;
                if (card.classList.contains('incident-card-deleted')) return false;
                return options.normalizeIncidentStatus(card.dataset.status) !== 'resolved';
            }).length;

            header.dataset.activeIncidentCount = String(activeIncidentCount);
            const latestConformityStatus = String(header.dataset.latestConformityStatus || '').trim().toLowerCase();

            const summaryChip = header.querySelector('[data-role="active-incidents-chip"]');
            if (summaryChip instanceof HTMLElement) {
                summaryChip.textContent = formatActiveIncidentsLabel(activeIncidentCount);
                summaryChip.dataset.tone = activeIncidentCount === 0 ? 'resolved' : 'high';
            }

            const closureBanner = header.querySelector('[data-role="closure-banner"]');
            if (closureBanner instanceof HTMLElement) {
                applyClosureBannerState(closureBanner, activeIncidentCount, latestConformityStatus);
            }

            const conformityButton = header.querySelector('[data-role="conformity-trigger"]');
            if (conformityButton instanceof HTMLButtonElement) {
                applyConformityButtonState(conformityButton, activeIncidentCount);
            }

            const createIncidentButton = header.querySelector('[data-role="create-incident-trigger"]');
            if (createIncidentButton instanceof HTMLButtonElement) {
                applyCreateIncidentButtonState(createIncidentButton, activeIncidentCount);
            }
        }

        function buildInstallationConformityFields({
            installationId,
            activeIncidentCount,
            latestConformity,
        }) {
            const fragment = document.createDocumentFragment();
            const grid = document.createElement('div');
            grid.className = 'action-modal-grid';

            const summaryWrap = document.createElement('div');
            summaryWrap.className = 'conformity-modal-summary';
            const summaryTitle = document.createElement('strong');
            summaryTitle.textContent = `Registro #${installationId}`;
            const summaryBody = document.createElement('p');
            summaryBody.textContent = activeIncidentCount === 0
                ? 'No quedan incidencias activas. El caso esta listo para emitir la conformidad final y enviar el PDF por email.'
                : `Todavia hay ${activeIncidentCount} incidencia${activeIncidentCount === 1 ? '' : 's'} activa${activeIncidentCount === 1 ? '' : 's'}.`;
            const summaryMeta = document.createElement('div');
            summaryMeta.className = 'conformity-modal-meta';
            summaryMeta.appendChild(
                createConformityStatusChip(
                    activeIncidentCount === 0 ? 'Listo para cerrar' : `${activeIncidentCount} activas`,
                    activeIncidentCount === 0 ? 'resolved' : 'high',
                ),
            );
            if (latestConformity) {
                summaryMeta.appendChild(
                    createConformityStatusChip(
                        `Ultima: ${formatConformityStatusLabel(latestConformity.status)}`,
                        latestConformity.status === 'emailed' ? 'resolved' : latestConformity.status === 'email_failed' ? 'high' : 'info',
                    ),
                );
            }
            summaryWrap.append(summaryTitle, summaryBody, summaryMeta);
            grid.appendChild(summaryWrap);

            if (latestConformity) {
                const latestWrap = document.createElement('div');
                latestWrap.className = 'conformity-modal-latest';
                const latestTitle = document.createElement('strong');
                latestTitle.textContent = 'Ultima conformidad registrada';
                const latestBody = document.createElement('p');
                latestBody.textContent = `${latestConformity.signed_by_name || 'Sin firmante'} · ${formatConformityGeneratedAt(latestConformity.generated_at)} · ${formatConformityStatusLabel(latestConformity.status)}`;
                latestWrap.append(latestTitle, latestBody);
                if (latestConformity.pdf_download_path) {
                    const latestLink = document.createElement('a');
                    latestLink.href = latestConformity.pdf_download_path;
                    latestLink.target = '_blank';
                    latestLink.rel = 'noreferrer';
                    latestLink.className = 'conformity-modal-link';
                    latestLink.textContent = 'Ver ultimo PDF';
                    latestWrap.appendChild(latestLink);
                }
                grid.appendChild(latestWrap);
            }

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.id = 'actionConformitySignedByName';
            nameInput.autocomplete = 'off';
            nameInput.value = String(options.getCurrentUser?.()?.username || '').trim();
            nameInput.placeholder = 'Nombre y apellido';
            grid.appendChild(createInputGroup('Firmante', nameInput, { htmlFor: nameInput.id }));

            const documentInput = document.createElement('input');
            documentInput.type = 'text';
            documentInput.id = 'actionConformitySignedByDocument';
            documentInput.autocomplete = 'off';
            documentInput.placeholder = 'CI, DNI o referencia';
            grid.appendChild(createInputGroup('Documento', documentInput, { htmlFor: documentInput.id }));

            const emailInput = document.createElement('input');
            emailInput.type = 'email';
            emailInput.id = 'actionConformityEmailTo';
            emailInput.autocomplete = 'email';
            emailInput.placeholder = 'cliente@empresa.com';
            grid.appendChild(createInputGroup('Email destino', emailInput, { htmlFor: emailInput.id }));

            const summaryInput = document.createElement('textarea');
            summaryInput.id = 'actionConformitySummary';
            summaryInput.rows = 3;
            summaryInput.value = 'Instalacion validada en sitio.';
            grid.appendChild(createInputGroup('Resumen', summaryInput, {
                htmlFor: summaryInput.id,
                className: 'full-width',
            }));

            const technicianSelect = buildTechnicianSelect({
                id: 'actionConformityTechnicianName',
                includeCurrentUserOption: true,
            });
            grid.appendChild(createInputGroup('Tecnico responsable', technicianSelect, {
                htmlFor: technicianSelect.id,
            }));

            const technicianNoteInput = document.createElement('textarea');
            technicianNoteInput.id = 'actionConformityTechnicianNote';
            technicianNoteInput.rows = 3;
            technicianNoteInput.value = 'Se entrega constancia operativa con firma y evidencia asociada.';
            grid.appendChild(createInputGroup('Nota tecnica', technicianNoteInput, {
                htmlFor: technicianNoteInput.id,
                className: 'full-width',
            }));

            grid.appendChild(createGpsCapturePanel({
                panelId: CONFORMITY_GPS_PANEL_ID,
                statusId: CONFORMITY_GPS_STATUS_ID,
                summaryId: CONFORMITY_GPS_SUMMARY_ID,
                buttonId: CONFORMITY_GPS_RETRY_ID,
            }));

            const gpsOverrideInput = document.createElement('textarea');
            gpsOverrideInput.id = CONFORMITY_GPS_OVERRIDE_INPUT_ID;
            gpsOverrideInput.rows = 3;
            gpsOverrideInput.placeholder = 'Explica por que cierras sin coordenada valida.';
            const gpsOverrideGroup = createInputGroup('Motivo de override GPS', gpsOverrideInput, {
                htmlFor: gpsOverrideInput.id,
                className: 'full-width',
            });
            gpsOverrideGroup.id = CONFORMITY_GPS_OVERRIDE_WRAP_ID;
            gpsOverrideGroup.hidden = true;
            const gpsOverrideHelp = document.createElement('p');
            gpsOverrideHelp.id = CONFORMITY_GPS_OVERRIDE_HELP_ID;
            gpsOverrideHelp.className = 'asset-muted';
            gpsOverrideHelp.textContent = 'Si no hay captura usable, deja una justificacion operativa antes de generar el PDF.';
            gpsOverrideGroup.appendChild(gpsOverrideHelp);
            grid.appendChild(gpsOverrideGroup);

            const signatureGroup = document.createElement('div');
            signatureGroup.className = 'input-group full-width';
            const signatureLabel = document.createElement('label');
            signatureLabel.setAttribute('for', CONFORMITY_SIGNATURE_CANVAS_ID);
            signatureLabel.textContent = 'Firma';
            const signaturePad = document.createElement('div');
            signaturePad.className = 'conformity-signature-pad';
            const canvas = document.createElement('canvas');
            canvas.id = CONFORMITY_SIGNATURE_CANVAS_ID;
            canvas.className = 'conformity-signature-canvas';
            canvas.width = 640;
            canvas.height = 220;
            const signatureHint = document.createElement('div');
            signatureHint.className = 'conformity-signature-hint';
            signatureHint.textContent = 'Firma aqui con mouse, touch o lapiz.';
            const signatureToolbar = document.createElement('div');
            signatureToolbar.className = 'conformity-signature-toolbar';
            const clearSignatureBtn = document.createElement('button');
            clearSignatureBtn.type = 'button';
            clearSignatureBtn.id = CONFORMITY_SIGNATURE_CLEAR_ID;
            clearSignatureBtn.className = 'btn-secondary';
            clearSignatureBtn.textContent = 'Limpiar firma';
            signatureToolbar.appendChild(clearSignatureBtn);
            signaturePad.append(canvas, signatureHint);
            signatureGroup.append(signatureLabel, signaturePad, signatureToolbar);
            grid.appendChild(signatureGroup);

            const sendEmailWrap = document.createElement('label');
            sendEmailWrap.className = 'action-checkbox full-width';
            const sendEmailInput = document.createElement('input');
            sendEmailInput.type = 'checkbox';
            sendEmailInput.id = 'actionConformitySendEmail';
            sendEmailInput.checked = true;
            const sendEmailText = document.createElement('span');
            sendEmailText.textContent = 'Enviar email al generar la conformidad';
            sendEmailWrap.append(sendEmailInput, sendEmailText);
            grid.appendChild(sendEmailWrap);

            fragment.appendChild(grid);
            return fragment;
        }

        function initializeConformitySignaturePad() {
            const canvas = document.getElementById(CONFORMITY_SIGNATURE_CANVAS_ID);
            const clearBtn = document.getElementById(CONFORMITY_SIGNATURE_CLEAR_ID);
            if (!(canvas instanceof HTMLCanvasElement)) {
                currentConformitySignaturePad = null;
                return;
            }

            const ratio = Math.max(window.devicePixelRatio || 1, 1);
            const width = Math.max(canvas.clientWidth || 0, 640);
            const height = 220;
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            const context = canvas.getContext('2d');
            if (!context) {
                currentConformitySignaturePad = null;
                return;
            }

            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            context.lineCap = 'round';
            context.lineJoin = 'round';
            context.lineWidth = 2.6;
            context.strokeStyle = '#0f8b84';

            let drawing = false;
            let hasInk = false;
            let lastX = 0;
            let lastY = 0;

            function hideHint() {
                canvas.parentElement?.classList.add('has-ink');
            }

            function showHint() {
                canvas.parentElement?.classList.remove('has-ink');
            }

            function clearPad() {
                context.clearRect(0, 0, width, height);
                hasInk = false;
                showHint();
            }

            function getPoint(event) {
                const rect = canvas.getBoundingClientRect();
                return {
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                };
            }

            function beginStroke(event) {
                drawing = true;
                const point = getPoint(event);
                lastX = point.x;
                lastY = point.y;
                context.beginPath();
                context.moveTo(point.x, point.y);
                context.lineTo(point.x + 0.01, point.y + 0.01);
                context.stroke();
                hasInk = true;
                hideHint();
            }

            function continueStroke(event) {
                if (!drawing) return;
                const point = getPoint(event);
                context.beginPath();
                context.moveTo(lastX, lastY);
                context.lineTo(point.x, point.y);
                context.stroke();
                lastX = point.x;
                lastY = point.y;
            }

            function endStroke() {
                drawing = false;
            }

            clearPad();
            canvas.onpointerdown = (event) => {
                event.preventDefault();
                canvas.setPointerCapture?.(event.pointerId);
                beginStroke(event);
            };
            canvas.onpointermove = (event) => {
                event.preventDefault();
                continueStroke(event);
            };
            canvas.onpointerup = () => endStroke();
            canvas.onpointerleave = () => endStroke();
            canvas.onpointercancel = () => endStroke();

            if (clearBtn instanceof HTMLButtonElement) {
                clearBtn.onclick = () => clearPad();
            }

            currentConformitySignaturePad = {
                hasInk: () => hasInk,
                clear: clearPad,
                exportDataUrl: () => {
                    if (!hasInk) return '';
                    const exportCanvas = document.createElement('canvas');
                    exportCanvas.width = canvas.width;
                    exportCanvas.height = canvas.height;
                    const exportContext = exportCanvas.getContext('2d');
                    if (!exportContext) return '';
                    exportContext.fillStyle = '#ffffff';
                    exportContext.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
                    exportContext.drawImage(canvas, 0, 0);
                    return exportCanvas.toDataURL('image/png');
                },
            };
        }

        async function openInstallationConformityModal(installationId, config = {}) {
            if (!options.requireActiveSession()) return;
            const targetInstallationId = options.parseStrictInteger(installationId);
            if (!Number.isInteger(targetInstallationId) || targetInstallationId <= 0) {
                options.showNotification('installation_id invalido para generar conformidad.', 'error');
                return;
            }

            const activeIncidentCount = Math.max(0, Number(config.activeIncidentCount) || 0);
            if (activeIncidentCount > 0) {
                options.showNotification('Primero resuelve las incidencias activas antes de emitir la conformidad.', 'warning');
                return;
            }

            let latestConformity = config.latestConformity || null;
            if (!latestConformity) {
                try {
                    const result = await options.api.getInstallationConformity(targetInstallationId);
                    latestConformity = result?.conformity || null;
                } catch {
                    latestConformity = null;
                }
            }

            let gpsController = null;
            let latestGpsSnapshot = null;
            const targetInstallation = options.getInstallationById?.(targetInstallationId) || null;

            function syncConformityGpsOverrideUi(snapshot, state = {}) {
                latestGpsSnapshot = snapshot && typeof snapshot === 'object'
                    ? { ...snapshot }
                    : null;
                const overrideWrap = document.getElementById(CONFORMITY_GPS_OVERRIDE_WRAP_ID);
                const overrideInput = document.getElementById(CONFORMITY_GPS_OVERRIDE_INPUT_ID);
                const overrideHelp = document.getElementById(CONFORMITY_GPS_OVERRIDE_HELP_ID);
                if (!(overrideWrap instanceof HTMLElement) || !(overrideInput instanceof HTMLTextAreaElement)) {
                    return;
                }

                const status = String(snapshot?.status || 'pending').trim().toLowerCase() || 'pending';
                const requiresGpsOverride = status !== 'captured' && state?.inflight !== true;
                const requiresOverride = requiresGpsOverride;
                overrideWrap.hidden = !requiresOverride;
                overrideInput.required = requiresOverride;
                if (overrideHelp instanceof HTMLElement) {
                    if (requiresGpsOverride) {
                        overrideHelp.textContent = `La captura GPS quedo en estado "${status}". Para cerrar la conformidad debes dejar motivo de override.`;
                    } else {
                        overrideHelp.textContent = 'GPS listo para adjuntar en la conformidad.';
                    }
                }
            }

            const modalOpened = options.openActionModal({
                title: `Conformidad del registro #${targetInstallationId}`,
                subtitle: 'Captura la firma final y envia el PDF de conformidad al cliente.',
                submitLabel: 'Generar y enviar conformidad',
                focusId: 'actionConformitySignedByName',
                fields: buildInstallationConformityFields({
                    installationId: targetInstallationId,
                    activeIncidentCount,
                    latestConformity,
                }),
                onSubmit: async () => {
                    const signedByName = String(document.getElementById('actionConformitySignedByName')?.value || '').trim();
                    const signedByDocument = String(document.getElementById('actionConformitySignedByDocument')?.value || '').trim();
                    const emailTo = String(document.getElementById('actionConformityEmailTo')?.value || '').trim();
                    const summaryNote = String(document.getElementById('actionConformitySummary')?.value || '').trim();
                    const technicianName = String(document.getElementById('actionConformityTechnicianName')?.value || '').trim()
                        || String(options.getCurrentUser?.()?.username || '').trim()
                        || 'web';
                    const technicianNote = String(document.getElementById('actionConformityTechnicianNote')?.value || '').trim();
                    const sendEmail = document.getElementById('actionConformitySendEmail')?.checked === true;
                    const signatureDataUrl = currentConformitySignaturePad?.exportDataUrl?.() || '';

                    if (!signedByName) {
                        options.setActionModalError('El nombre del firmante es obligatorio.');
                        return;
                    }
                    if (!emailTo) {
                        options.setActionModalError('El email destino es obligatorio.');
                        return;
                    }
                    if (!signatureDataUrl || currentConformitySignaturePad?.hasInk?.() !== true) {
                        options.setActionModalError('La conformidad requiere una firma.');
                        return;
                    }

                    const gpsSnapshot = gpsController?.getSnapshotForSubmit?.() || latestGpsSnapshot || null;
                    const gpsStatus = String(gpsSnapshot?.status || 'pending').trim().toLowerCase() || 'pending';
                    const gpsOverrideNote = String(document.getElementById(CONFORMITY_GPS_OVERRIDE_INPUT_ID)?.value || '').trim();
                    let gpsPayload = gpsSnapshot;
                    if (gpsStatus !== 'captured') {
                        if (!gpsOverrideNote) {
                            options.setActionModalError('Si no hay una captura GPS valida, debes registrar motivo de override.');
                            return;
                        }
                        gpsPayload = {
                            status: 'override',
                            source: 'override',
                            note: gpsOverrideNote,
                        };
                    }

                    const result = await options.api.createInstallationConformity(targetInstallationId, {
                        signed_by_name: signedByName,
                        signed_by_document: signedByDocument,
                        email_to: emailTo,
                        signature_data_url: signatureDataUrl,
                        summary_note: summaryNote,
                        technician_name: technicianName,
                        technician_note: technicianNote,
                        include_all_incident_photos: true,
                        send_email: sendEmail,
                        gps: gpsPayload,
                    });

                    options.closeActionModal(true);
                    const conformityId = options.parseStrictInteger(result?.conformity?.id);
                    const statusLabel = formatConformityStatusLabel(result?.conformity?.status);
                    options.showNotification(
                        Number.isInteger(conformityId) && conformityId > 0
                            ? `Conformidad #${conformityId} generada (${statusLabel}).`
                            : `Conformidad generada (${statusLabel}).`,
                        result?.conformity?.status === 'email_failed' ? 'warning' : 'success',
                    );
                    const metadata = (() => {
                        try {
                            return JSON.parse(String(result?.conformity?.metadata_json || '{}'));
                        } catch {
                            return {};
                        }
                    })();
                    runIncidentRefreshInBackground(
                        { installationId: targetInstallationId },
                        'La conformidad se genero, pero no pudimos refrescar el registro.',
                    );
                },
            });

            if (modalOpened) {
                requestAnimationFrame(() => {
                    initializeConformitySignaturePad();
                    void hydrateTechnicianSelectFromContext('actionConformityTechnicianName', {
                        installationId: targetInstallationId,
                    });
                    if (options.geolocation) {
                        gpsController = options.geolocation.createController({
                            panelElement: document.getElementById(CONFORMITY_GPS_PANEL_ID),
                            statusElement: document.getElementById(CONFORMITY_GPS_STATUS_ID),
                            summaryElement: document.getElementById(CONFORMITY_GPS_SUMMARY_ID),
                            captureButton: document.getElementById(CONFORMITY_GPS_RETRY_ID),
                            onSnapshotChange: syncConformityGpsOverrideUi,
                        });
                        void gpsController.capture();
                    } else {
                        syncConformityGpsOverrideUi({
                            status: 'unsupported',
                            source: 'browser',
                            note: '',
                        }, {
                            inflight: false,
                        });
                    }
                });
            }
        }

        function buildIncidentCreateFields({
            defaultApply,
            defaultEstimatedDurationSeconds,
            defaultInstallationId,
            defaultNote,
            defaultSeverity,
            isAssetContext,
        }) {
            const fragment = document.createDocumentFragment();
            const grid = document.createElement('div');
            grid.className = 'action-modal-grid';

            const installationInput = document.createElement('input');
            installationInput.type = 'text';
            installationInput.id = 'actionIncidentInstallationId';
            installationInput.value = defaultInstallationId;
            installationInput.autocomplete = 'off';
            installationInput.placeholder = isAssetContext
                ? 'Opcional. Se usa vinculo activo o se crea contexto automatico'
                : 'Ej: 245';
            grid.appendChild(createInputGroup(
                isAssetContext ? 'ID de registro (opcional)' : 'ID de registro',
                installationInput,
                { htmlFor: 'actionIncidentInstallationId' },
            ));

            const severitySelect = document.createElement('select');
            severitySelect.id = 'actionIncidentSeverity';
            ['low', 'medium', 'high', 'critical'].forEach((severity) => {
                severitySelect.appendChild(
                    new Option(severity, severity, severity === defaultSeverity, severity === defaultSeverity),
                );
            });
            grid.appendChild(createInputGroup('Severidad', severitySelect, { htmlFor: 'actionIncidentSeverity' }));

            const technicianSelect = buildTechnicianSelect({
                id: 'actionIncidentTechnicianName',
                includeCurrentUserOption: true,
            });
            grid.appendChild(createInputGroup('Tecnico responsable', technicianSelect, { htmlFor: technicianSelect.id }));

            const estimatedPresetSelect = document.createElement('select');
            estimatedPresetSelect.id = 'actionIncidentEstimatedPreset';
            options.incidentEstimatedDurationPresets.forEach((preset) => {
                estimatedPresetSelect.appendChild(new Option(preset.label, String(preset.seconds)));
            });
            estimatedPresetSelect.appendChild(new Option('Personalizado (HH:MM)', '__custom__'));
            grid.appendChild(createInputGroup(
                'Tiempo estimado',
                estimatedPresetSelect,
                { htmlFor: 'actionIncidentEstimatedPreset' },
            ));

            const estimatedCustomInput = document.createElement('input');
            estimatedCustomInput.type = 'text';
            estimatedCustomInput.id = 'actionIncidentEstimatedCustom';
            estimatedCustomInput.value = options.formatDurationToHHMM(defaultEstimatedDurationSeconds);
            estimatedCustomInput.autocomplete = 'off';
            estimatedCustomInput.placeholder = 'Ej: 01:30';
            const estimatedCustomWrap = createInputGroup(
                'Tiempo personalizado (HH:MM)',
                estimatedCustomInput,
                { htmlFor: 'actionIncidentEstimatedCustom', className: 'is-hidden' },
            );
            estimatedCustomWrap.id = 'actionIncidentEstimatedCustomWrap';
            grid.appendChild(estimatedCustomWrap);

            const noteTextarea = document.createElement('textarea');
            noteTextarea.id = 'actionIncidentNote';
            noteTextarea.rows = 4;
            noteTextarea.placeholder = 'Describe el problema y el contexto';
            noteTextarea.value = defaultNote;
            grid.appendChild(createInputGroup(
                'Detalle de la incidencia',
                noteTextarea,
                { htmlFor: 'actionIncidentNote', className: 'full-width' },
            ));

            fragment.appendChild(grid);
            fragment.appendChild(createGpsCapturePanel({
                panelId: 'actionIncidentGpsPanel',
                statusId: 'actionIncidentGpsStatus',
                summaryId: 'actionIncidentGpsSummary',
                buttonId: 'actionIncidentGpsRetryBtn',
            }));

            const applyLabel = document.createElement('label');
            applyLabel.className = 'action-checkbox';
            applyLabel.setAttribute('for', 'actionIncidentApplyToRecord');
            const applyCheckbox = document.createElement('input');
            applyCheckbox.type = 'checkbox';
            applyCheckbox.id = 'actionIncidentApplyToRecord';
            applyCheckbox.checked = defaultApply;
            const applyCopy = document.createElement('span');
            applyCopy.textContent = 'Aplicar nota y tiempo al registro de instalacion.';
            applyLabel.append(applyCheckbox, applyCopy);
            fragment.appendChild(applyLabel);

            return fragment;
        }

        function buildIncidentEvidenceFields({
            currentEvidenceNote,
            customChecklistItems,
            selectedPresetItems,
        }) {
            const fragment = document.createDocumentFragment();
            const grid = document.createElement('div');
            grid.className = 'action-modal-grid incident-evidence-form-grid';

            const checklistGroup = document.createElement('div');
            checklistGroup.className = 'input-group full-width incident-evidence-checklist-group';
            const checklistLabel = document.createElement('label');
            checklistLabel.textContent = 'Checklist sugerido';
            const checklistGrid = document.createElement('div');
            checklistGrid.className = 'incident-checklist-grid';
            options.incidentChecklistPresets.forEach((label, index) => {
                const itemLabel = document.createElement('label');
                itemLabel.className = 'action-checkbox incident-checklist-option';
                itemLabel.setAttribute('for', `actionIncidentChecklistPreset-${index}`);
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = `actionIncidentChecklistPreset-${index}`;
                checkbox.name = 'actionIncidentChecklistPreset';
                checkbox.value = label;
                checkbox.checked = selectedPresetItems.includes(label);
                const text = document.createElement('span');
                text.textContent = label;
                itemLabel.append(checkbox, text);
                checklistGrid.appendChild(itemLabel);
            });
            checklistGroup.append(checklistLabel, checklistGrid);
            grid.appendChild(checklistGroup);

            const customChecklistTextarea = document.createElement('textarea');
            customChecklistTextarea.id = 'actionIncidentChecklistCustom';
            customChecklistTextarea.rows = 3;
            customChecklistTextarea.placeholder = 'Ej: Foto del serial\nValidacion con supervisor';
            customChecklistTextarea.value = customChecklistItems.join('\n');
            grid.appendChild(createInputGroup(
                'Checklist adicional (una linea por item)',
                customChecklistTextarea,
                { htmlFor: 'actionIncidentChecklistCustom', className: 'full-width' },
            ));

            const evidenceNoteTextarea = document.createElement('textarea');
            evidenceNoteTextarea.id = 'actionIncidentEvidenceNote';
            evidenceNoteTextarea.rows = 4;
            evidenceNoteTextarea.placeholder = 'Resumen operativo de evidencia';
            evidenceNoteTextarea.value = currentEvidenceNote;
            grid.appendChild(createInputGroup(
                'Nota operativa',
                evidenceNoteTextarea,
                { htmlFor: 'actionIncidentEvidenceNote', className: 'full-width' },
            ));

            fragment.appendChild(grid);
            return fragment;
        }

        function buildIncidentResolutionFields(defaultNote) {
            const resolutionNoteTextarea = document.createElement('textarea');
            resolutionNoteTextarea.id = 'actionIncidentResolutionNote';
            resolutionNoteTextarea.rows = 4;
            resolutionNoteTextarea.placeholder = 'Resumen de la solucion aplicada';
            resolutionNoteTextarea.value = defaultNote;
            return createInputGroup(
                'Nota de resolucion (opcional)',
                resolutionNoteTextarea,
                { htmlFor: 'actionIncidentResolutionNote' },
            );
        }

        function appendIncidentResolutionSummary(parent, incident) {
            const statusValue = options.normalizeIncidentStatus(incident?.incident_status);
            const resolutionNote = String(incident?.resolution_note || '').trim();
            if (!resolutionNote && statusValue !== 'resolved') return;

            const resolutionPanel = document.createElement('div');
            resolutionPanel.className = 'incident-resolution-panel';
            resolutionPanel.dataset.panelRole = 'resolution';
            resolutionPanel.dataset.status = statusValue;

            const resolutionHeader = document.createElement('div');
            resolutionHeader.className = 'incident-resolution-header';

            const resolutionLabel = document.createElement('small');
            resolutionLabel.className = 'asset-muted';
            resolutionLabel.textContent = 'Resolucion';

            const resolutionState = document.createElement('span');
            resolutionState.className = 'incident-resolution-state';
            options.setElementTextWithMaterialIcon(
                resolutionState,
                statusValue === 'resolved' ? 'verified' : 'pending_actions',
                statusValue === 'resolved' ? 'Cierre registrado' : 'Pendiente de cierre',
            );

            resolutionHeader.append(resolutionLabel, resolutionState);

            const resolutionBody = document.createElement('p');
            resolutionBody.className = 'incident-resolution-text';
            resolutionBody.textContent = resolutionNote || 'Incidencia marcada como resuelta sin nota de resolucion.';

            resolutionPanel.append(resolutionHeader, resolutionBody);

            const metaParts = [];
            if (incident?.resolved_at) {
                metaParts.push(`Resuelta: ${new Date(incident.resolved_at).toLocaleString('es-ES')}`);
            }
            const resolvedBy = String(incident?.resolved_by || incident?.status_updated_by || '').trim();
            if (resolvedBy) {
                metaParts.push(`por ${resolvedBy}`);
            }
            if (metaParts.length) {
                const resolutionMeta = document.createElement('small');
                resolutionMeta.className = 'incident-resolution-meta';
            resolutionMeta.textContent = metaParts.join(' | ');
                resolutionPanel.appendChild(resolutionMeta);
            }

            parent.appendChild(resolutionPanel);
        }

        function syncIncidentResolutionPanel(card, incident) {
            if (!(card instanceof HTMLElement)) return;
            card.querySelectorAll('.incident-resolution-panel[data-panel-role="resolution"]').forEach((panel) => {
                panel.remove();
            });

            const statusValue = options.normalizeIncidentStatus(incident?.incident_status);
            const resolutionNote = String(incident?.resolution_note || '').trim();
            if (!resolutionNote && statusValue !== 'resolved') return;

            const anchor = card.querySelector('.incident-actions');
            const fragmentHost = document.createElement('div');
            appendIncidentResolutionSummary(fragmentHost, incident);
            const resolutionPanel = fragmentHost.firstElementChild;
            if (!(resolutionPanel instanceof HTMLElement)) return;

            if (anchor instanceof HTMLElement) {
                card.insertBefore(resolutionPanel, anchor);
                return;
            }
            card.appendChild(resolutionPanel);
        }

        function decorateIncidentActionButton(button, actionKey, label, iconName) {
            if (!(button instanceof HTMLElement)) return;
            button.classList.add('incident-action-btn');
            button.dataset.action = String(actionKey || 'custom').trim() || 'custom';
            options.setElementTextWithMaterialIcon(button, iconName, label);
        }

        function buildIncidentStatusActionMeta(currentStatus, targetStatus) {
            const actionMeta = {
                ...(INCIDENT_STATUS_ACTION_DEFINITIONS[targetStatus] || { label: targetStatus, icon: '' }),
            };
            if (currentStatus === 'paused' && targetStatus === 'in_progress') {
                actionMeta.label = 'Reanudar';
            }
            return actionMeta;
        }

        function buildIncidentStatusUpdateOptions(incident, config = {}) {
            const updateOptions = {};
            const installationCandidate = config.installationId ?? incident?.installation_id;
            const parsedInstallationId = options.parseStrictInteger(installationCandidate);
            if (Number.isInteger(parsedInstallationId) && parsedInstallationId > 0) {
                updateOptions.installationId = parsedInstallationId;
            }

            const parsedAssetId = options.parseStrictInteger(config.assetId);
            if (Number.isInteger(parsedAssetId) && parsedAssetId > 0) {
                updateOptions.assetId = parsedAssetId;
            }
            return updateOptions;
        }

        function buildLiveIncidentCardState(incident, config = {}) {
            const baseIncident = incident && typeof incident === 'object' ? incident : {};
            const nextState = { ...baseIncident };
            const configInstallationId = options.parseStrictInteger(config.installationId);
            const configAssetId = options.parseStrictInteger(config.assetId);
            if (Number.isInteger(configInstallationId) && configInstallationId > 0) {
                nextState.installation_id = configInstallationId;
            }
            if (Number.isInteger(configAssetId) && configAssetId > 0) {
                nextState.asset_id = configAssetId;
            }
            return nextState;
        }

        function appendIncidentStatusActions(parent, incident, config = {}) {
            const isSoftDeleted = String(incident?.deleted_at || '').trim().length > 0;
            const statusActions = document.createElement('div');
            statusActions.className = 'incident-actions';
            const incidentStatus = options.normalizeIncidentStatus(incident.incident_status);
            const canUpdateIncident = options.canCurrentUserEditAssets() && !isSoftDeleted;
            const updateOptions = buildIncidentStatusUpdateOptions(incident, config);

            if (isSoftDeleted) {
                const auditNotice = document.createElement('small');
                auditNotice.className = 'asset-muted';
                auditNotice.textContent = `Eliminada: ${new Date(incident.deleted_at).toLocaleString('es-ES')}${incident?.deleted_by ? ` por ${incident.deleted_by}` : ''
                    }`;
                parent.appendChild(auditNotice);
            }

            const makeStatusBtn = (statusValue) => {
                const actionMeta = buildIncidentStatusActionMeta(incidentStatus, statusValue);
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn-secondary';
                decorateIncidentActionButton(button, statusValue, actionMeta.label, actionMeta.icon);
                button.dataset.current = incidentStatus === statusValue ? 'true' : 'false';
                button.disabled = !canUpdateIncident || incidentStatus === statusValue;
                if (!canUpdateIncident) {
                    button.title = 'Solo admin/super_admin puede cambiar estado de incidencias';
                }
                button.addEventListener('click', () => {
                    const liveIncident = button.closest('.incident-card')?.__incidentData || incident;
                    void updateIncidentStatusFromWeb(liveIncident, statusValue, updateOptions);
                });
                return button;
            };

            const evidenceBtn = document.createElement('button');
            evidenceBtn.type = 'button';
            evidenceBtn.className = 'btn-secondary';
            decorateIncidentActionButton(evidenceBtn, 'evidence', 'Evidencia', 'fact_check');
            evidenceBtn.disabled = !canUpdateIncident;
            if (!canUpdateIncident) {
                evidenceBtn.title = 'Solo admin/super_admin puede actualizar evidencia';
            }
            evidenceBtn.addEventListener('click', () => {
                const liveIncident = evidenceBtn.closest('.incident-card')?.__incidentData || incident;
                void updateIncidentEvidenceFromWeb(liveIncident, updateOptions);
            });

            // USER SUPER ADMIN DELETE BUTTON INJECT
            const isSuperAdmin = String(options.getCurrentUser()?.role || '').trim().toLowerCase() === 'super_admin';
            let deleteBtn = null;
            if (isSuperAdmin && !isSoftDeleted) {
                deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'btn-secondary incident-delete-btn';
                decorateIncidentActionButton(deleteBtn, 'delete', 'Eliminar', 'delete');
                deleteBtn.addEventListener('click', () => {
                    const liveIncident = deleteBtn.closest('.incident-card')?.__incidentData || incident;
                    void deleteIncidentFromWeb(liveIncident, updateOptions);
                });
            }

            statusActions.append(
                makeStatusBtn('open'),
                makeStatusBtn('in_progress'),
                makeStatusBtn('paused'),
                makeStatusBtn('resolved'),
                evidenceBtn,
            );
            if (deleteBtn) statusActions.append(deleteBtn);
            parent.appendChild(statusActions);
            return statusActions;
        }

        function appendIncidentUploadPhotoAction(parent, incident, installationId, config = {}) {
            const uploadPhotoBtn = document.createElement('button');
            uploadPhotoBtn.type = 'button';
            uploadPhotoBtn.className = 'btn-secondary';
            const iconName = String(config.icon || '').trim();
            const buttonLabel = String(config.label || INCIDENT_PHOTO_UPLOAD_LABEL);
            decorateIncidentActionButton(
                uploadPhotoBtn,
                'photo',
                buttonLabel,
                iconName || 'add_a_photo',
            );
            uploadPhotoBtn.classList.add('incident-upload-btn');
            uploadPhotoBtn.addEventListener('click', () => {
                const liveIncident = uploadPhotoBtn.closest('.incident-card')?.__incidentData || incident;
                void selectAndUploadIncidentPhoto(liveIncident.id, installationId, {
                    assetId: options.parseStrictInteger(config.assetId),
                });
            });
            parent.appendChild(uploadPhotoBtn);
        }

        async function appendIncidentPhotosGrid(parent, photos, config = {}) {
            if (!Array.isArray(photos) || photos.length === 0) return;
            const photosGrid = document.createElement('div');
            photosGrid.className = 'photos-grid';
            const photoIds = photos
                .map((photo) => options.parseStrictInteger(photo?.id))
                .filter((photoId) => Number.isInteger(photoId) && photoId > 0);

            for (const photo of photos) {
                const photoId = options.parseStrictInteger(photo?.id);
                if (!Number.isInteger(photoId) || photoId <= 0) continue;
                const photoUrl = await options.loadPhotoWithAuth(photoId);
                if (!photoUrl) continue;

                const image = document.createElement('img');
                image.src = photoUrl;
                image.className = 'photo-thumb';
                image.alt = 'Foto de incidencia';
                if (config.attachPhotoIdDataset === true) {
                    image.dataset.photoId = String(photoId);
                }
                image.addEventListener('click', () => options.viewPhoto(photoId, photoIds));
                photosGrid.appendChild(image);
            }

            if (photosGrid.childElementCount > 0) {
                parent.appendChild(photosGrid);
            }
        }

        function deriveAssetAttentionMetaFromIncidents(incidents) {
            const values = Array.isArray(incidents) ? incidents : [];
            const activeIncidents = values.filter((incident) => {
                const isDeleted = String(incident?.deleted_at || '').trim().length > 0;
                if (isDeleted) return false;
                return options.normalizeIncidentStatus(incident?.incident_status) !== 'resolved';
            });
            if (!activeIncidents.length) {
                return {
                    state: 'clear',
                    label: 'Sin incidencias activas',
                    badgeClass: 'attention-clear',
                    iconName: options.recordAttentionStateIconName('clear'),
                };
            }

            const hasCritical = activeIncidents.some(
                (incident) => options.normalizeSeverity(incident?.severity) === 'critical',
            );
            if (hasCritical) {
                return {
                    state: 'critical',
                    label: `Critica (${activeIncidents.length})`,
                    badgeClass: 'attention-critical',
                    iconName: options.recordAttentionStateIconName('critical'),
                };
            }

            const hasInProgress = activeIncidents.some(
                (incident) => options.normalizeIncidentStatus(incident?.incident_status) === 'in_progress',
            );
            if (hasInProgress) {
                return {
                    state: 'in_progress',
                    label: `En curso (${activeIncidents.length})`,
                    badgeClass: 'attention-in_progress',
                    iconName: options.recordAttentionStateIconName('in_progress'),
                };
            }

            const hasPaused = activeIncidents.some(
                (incident) => options.normalizeIncidentStatus(incident?.incident_status) === 'paused',
            );
            if (hasPaused) {
                return {
                    state: 'paused',
                    label: `En pausa (${activeIncidents.length})`,
                    badgeClass: 'attention-paused',
                    iconName: options.recordAttentionStateIconName('paused'),
                };
            }

            return {
                state: 'open',
                label: `Abiertas (${activeIncidents.length})`,
                badgeClass: 'attention-open',
                iconName: options.recordAttentionStateIconName('open'),
            };
        }

        function sortAssetIncidentsByPriority(incidents) {
            const values = Array.isArray(incidents) ? [...incidents] : [];
            const statusRank = { in_progress: 0, paused: 1, open: 2, resolved: 3 };
            const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
            const parseTime = (value) => {
                const parsed = Date.parse(String(value || ''));
                return Number.isFinite(parsed) ? parsed : 0;
            };

            values.sort((left, right) => {
                const leftStatus = options.normalizeIncidentStatus(left?.incident_status);
                const rightStatus = options.normalizeIncidentStatus(right?.incident_status);
                const byStatus = (statusRank[leftStatus] ?? 9) - (statusRank[rightStatus] ?? 9);
                if (byStatus !== 0) return byStatus;

                const leftSeverity = options.normalizeSeverity(left?.severity);
                const rightSeverity = options.normalizeSeverity(right?.severity);
                const bySeverity = (severityRank[leftSeverity] ?? 9) - (severityRank[rightSeverity] ?? 9);
                if (bySeverity !== 0) return bySeverity;

                return parseTime(right?.created_at) - parseTime(left?.created_at);
            });
            return values;
        }

        function appendIncidentEvidenceSummary(parent, incident) {
            const evidenceWrap = document.createElement('div');
            evidenceWrap.className = 'incident-evidence-block';

            const checklistTitle = document.createElement('small');
            checklistTitle.className = 'asset-muted';
            checklistTitle.textContent = 'Checklist de evidencia';
            evidenceWrap.appendChild(checklistTitle);

            const checklistItems = options.normalizeIncidentChecklistItems(incident?.checklist_items);
            if (checklistItems.length) {
                const checklistList = document.createElement('div');
                checklistList.className = 'incident-checklist-list';
                for (const item of checklistItems) {
                    checklistList.appendChild(createIncidentHighlightChip(item, 'info'));
                }
                evidenceWrap.appendChild(checklistList);
            } else {
                const checklistEmpty = document.createElement('small');
                checklistEmpty.className = 'asset-muted';
                checklistEmpty.textContent = 'Sin checklist cargado';
                evidenceWrap.appendChild(checklistEmpty);
            }

            const evidenceNote = String(incident?.evidence_note || '').trim();
            if (evidenceNote) {
                const noteLine = document.createElement('small');
                noteLine.className = 'asset-muted incident-meta-line';
                noteLine.textContent = `Nota operativa: ${evidenceNote}`;
                evidenceWrap.appendChild(noteLine);
            }

            parent.appendChild(evidenceWrap);
        }

        function syncIncidentEvidenceSummary(card, incident) {
            if (!(card instanceof HTMLElement)) return;
            card.querySelectorAll('.incident-evidence-block').forEach((block) => {
                block.remove();
            });

            const fragmentHost = document.createElement('div');
            appendIncidentEvidenceSummary(fragmentHost, incident);
            const evidenceBlock = fragmentHost.firstElementChild;
            if (!(evidenceBlock instanceof HTMLElement)) return;

            const highlights = card.querySelector('.incident-highlights');
            if (highlights instanceof HTMLElement) {
                highlights.insertAdjacentElement('afterend', evidenceBlock);
                return;
            }

            const anchor = card.querySelector('.incident-resolution-panel[data-panel-role="resolution"], .incident-actions');
            if (anchor instanceof HTMLElement) {
                card.insertBefore(evidenceBlock, anchor);
                return;
            }

            card.appendChild(evidenceBlock);
        }

        function applyVisibleIncidentUpdate(incident) {
            const incidentId = options.parseStrictInteger(incident?.id);
            if (!Number.isInteger(incidentId) || incidentId <= 0) return;

            const cards = document.querySelectorAll(`.incident-card[data-incident-id="${incidentId}"]`);
            if (!cards.length) return;

            const statusValue = options.normalizeIncidentStatus(incident?.incident_status);
            const canUpdateIncident = options.canCurrentUserEditAssets();
            const runtimeText = Number.isInteger(options.resolveIncidentRealDurationSeconds(incident))
                ? `Tiempo real: ${options.formatDuration(options.resolveIncidentRealDurationSeconds(incident))}${statusValue === 'in_progress'
                    ? ' (en curso)'
                    : statusValue === 'paused'
                        ? ' (en pausa)'
                        : ''
                }`
                : '';

            cards.forEach((card) => {
                if (!(card instanceof HTMLElement)) return;
                card.dataset.status = statusValue;
                card.dataset.updating = 'false';
                card.__incidentData = buildLiveIncidentCardState(incident, {
                    installationId: options.parseStrictInteger(incident?.installation_id),
                    assetId: options.parseStrictInteger(incident?.asset_id),
                });
                syncIncidentEvidenceSummary(card, incident);
                syncIncidentResolutionPanel(card, incident);
                syncVisibleIncidentsHeaderState();

                const statusBadge = card.querySelector('.incident-status-badge');
                if (statusBadge instanceof HTMLElement) {
                    statusBadge.className = `badge incident-status-badge attention-${statusValue}`;
                    options.setElementTextWithMaterialIcon(
                        statusBadge,
                        options.recordAttentionStateIconName(statusValue),
                        options.incidentStatusLabel(statusValue),
                    );
                }

                const runtimeChip = card.querySelector('.incident-highlight-chip[data-chip="runtime"]');
                if (runtimeChip instanceof HTMLElement && runtimeText) {
                    runtimeChip.dataset.tone = statusValue === 'resolved' ? 'resolved' : statusValue;
                    runtimeChip.textContent = runtimeText;
                    pulseIncidentHighlightChip(runtimeChip);
                    if (statusValue === 'in_progress') {
                        const runtimeStartMs = options.resolveIncidentRuntimeStartMs(incident);
                        if (Number.isFinite(runtimeStartMs) && runtimeStartMs > 0) {
                            runtimeChip.dataset.runtimeLive = '1';
                            runtimeChip.dataset.runtimeStartMs = String(runtimeStartMs);
                            runtimeChip.dataset.runtimeBaseSeconds = String(
                                Math.max(0, Number(incident?.actual_duration_seconds || 0) || 0),
                            );
                            options.ensureIncidentRuntimeTicker();
                        }
                    } else {
                        delete runtimeChip.dataset.runtimeLive;
                        delete runtimeChip.dataset.runtimeStartMs;
                        delete runtimeChip.dataset.runtimeBaseSeconds;
                    }
                }

                ['open', 'in_progress', 'paused', 'resolved'].forEach((targetStatus) => {
                    const actionBtn = card.querySelector(`.incident-action-btn[data-action="${targetStatus}"]`);
                    if (!(actionBtn instanceof HTMLButtonElement)) return;
                    const actionMeta = buildIncidentStatusActionMeta(statusValue, targetStatus);
                    decorateIncidentActionButton(actionBtn, targetStatus, actionMeta.label, actionMeta.icon);
                    actionBtn.dataset.current = statusValue === targetStatus ? 'true' : 'false';
                    actionBtn.disabled = !canUpdateIncident || statusValue === targetStatus;
                    if (!canUpdateIncident) {
                        actionBtn.title = 'Solo admin/super_admin puede cambiar estado de incidencias';
                    } else {
                        actionBtn.removeAttribute('title');
                    }
                });
            });
        }

        function setIncidentCardsUpdating(incidentId, isUpdating) {
            const numericIncidentId = options.parseStrictInteger(incidentId);
            if (!Number.isInteger(numericIncidentId) || numericIncidentId <= 0) return;
            const cards = document.querySelectorAll(`.incident-card[data-incident-id="${numericIncidentId}"]`);
            cards.forEach((card) => {
                if (!(card instanceof HTMLElement)) return;
                card.dataset.updating = isUpdating ? 'true' : 'false';
                const currentStatus = options.normalizeIncidentStatus(card.dataset.status);
                card.querySelectorAll('.incident-action-btn').forEach((button) => {
                    if (!(button instanceof HTMLButtonElement)) return;
                    if (isUpdating) {
                        button.disabled = true;
                        return;
                    }
                    const targetStatus = String(button.dataset.action || '').trim();
                    if (['open', 'in_progress', 'paused', 'resolved'].includes(targetStatus)) {
                        button.disabled = !options.canCurrentUserEditAssets() || currentStatus === targetStatus;
                    } else if (targetStatus === 'evidence') {
                        button.disabled = !options.canCurrentUserEditAssets();
                    }
                });
            });
        }

        function buildIncidentTechnicianTokens(incident, assignedTechnicianNames = []) {
            const labels = [];
            const seen = new Set();
            const pushLabel = (value) => {
                const label = normalizeTechnicianName(value);
                const token = normalizeTechnicianToken(label);
                if (!token || seen.has(token)) return;
                seen.add(token);
                labels.push(label);
            };

            pushLabel(incident?.reporter_username);
            assignedTechnicianNames.forEach((name) => pushLabel(name));
            return labels;
        }

        function applyIncidentTechnicianFilter(container, selectedValue = '') {
            const cards = Array.from(container.querySelectorAll('.incident-card'));
            const normalizedFilter = normalizeTechnicianToken(selectedValue);
            let visibleCount = 0;

            cards.forEach((card) => {
                if (!(card instanceof HTMLElement)) return;
                const tokens = String(card.dataset.technicianFilterTokens || '')
                    .split('|')
                    .map((token) => normalizeTechnicianToken(token))
                    .filter(Boolean);
                const matches = !normalizedFilter || tokens.includes(normalizedFilter);
                card.hidden = !matches;
                if (matches) {
                    visibleCount += 1;
                }
            });

            const emptyState = container.querySelector('.incidents-filter-empty');
            if (emptyState instanceof HTMLElement) {
                emptyState.hidden = visibleCount > 0;
            }
        }

        function hydrateIncidentTechnicianFilter(container, select) {
            if (!(container instanceof HTMLElement) || !(select instanceof HTMLSelectElement)) return;

            const cards = Array.from(container.querySelectorAll('.incident-card'));
            const optionMap = new Map();
            cards.forEach((card) => {
                if (!(card instanceof HTMLElement)) return;
                const labels = String(card.dataset.technicianFilterLabels || '')
                    .split('||')
                    .map((label) => normalizeTechnicianName(label))
                    .filter(Boolean);
                labels.forEach((label) => {
                    const token = normalizeTechnicianToken(label);
                    if (!token || optionMap.has(token)) return;
                    optionMap.set(token, label);
                });
            });

            select.replaceChildren(new Option('Todos los tecnicos', ''));
            Array.from(optionMap.values())
                .sort((left, right) => left.localeCompare(right, 'es'))
                .forEach((label) => {
                    select.appendChild(new Option(label, label));
                });

            const wrapper = select.closest('.incidents-technician-filter');
            if (wrapper instanceof HTMLElement) {
                wrapper.hidden = optionMap.size <= 1;
            }

            applyIncidentTechnicianFilter(container, select.value);
        }

        async function appendIncidentCard(parent, incident, config = {}) {
            const incidentCard = document.createElement('div');
            const statusValue = options.normalizeIncidentStatus(incident?.incident_status);
            const severityValue = options.normalizeSeverity(incident?.severity || 'medium');
            incidentCard.className = 'incident-card incident-card-detailed';
            incidentCard.dataset.incidentId = String(options.parseStrictInteger(incident?.id) || '');
            incidentCard.dataset.status = statusValue;
            incidentCard.dataset.severity = severityValue;
            incidentCard.dataset.updating = 'false';
            incidentCard.__incidentData = buildLiveIncidentCardState(incident, config);
            requestAnimationFrame(() => {
                incidentCard.classList.add('is-visible');
            });

            const incidentHeader = document.createElement('div');
            incidentHeader.className = 'incident-header';

            const headingBlock = document.createElement('div');
            headingBlock.className = 'incident-card-heading';

            const leftMeta = document.createElement('div');
            leftMeta.className = 'incident-card-header-left';

            const severityBadge = document.createElement('span');
            severityBadge.className = `badge ${severityValue}`;
            options.setElementTextWithMaterialIcon(
                severityBadge,
                getSeverityIconName(incident?.severity),
                String(incident?.severity || 'medium').toUpperCase(),
            );

            const statusBadge = document.createElement('span');
            statusBadge.className = `badge incident-status-badge attention-${statusValue}`;
            options.setElementTextWithMaterialIcon(
                statusBadge,
                options.recordAttentionStateIconName(statusValue),
                options.incidentStatusLabel(statusValue),
            );

            const incidentId = options.parseStrictInteger(incident?.id);
            const incidentRef = document.createElement('small');
            incidentRef.className = 'asset-muted';
            incidentRef.textContent = Number.isInteger(incidentId) && incidentId > 0
                ? `Inc #${incidentId}`
                : 'Incidencia';

            leftMeta.append(severityBadge, statusBadge, incidentRef);
            headingBlock.appendChild(leftMeta);

            const assignmentContext = await loadContextTechnicianAssignments({
                incidentId: options.parseStrictInteger(incident?.id),
                installationId: options.parseStrictInteger(config.installationId ?? incident?.installation_id),
                assetId: options.parseStrictInteger(config.assetId ?? incident?.asset_id),
            });
            const assignedTechnicianNames = assignmentContext.allTechnicianNames;
            const technicianLabels = buildIncidentTechnicianTokens(incident, assignedTechnicianNames);
            incidentCard.dataset.technicianFilterTokens = technicianLabels
                .map((label) => normalizeTechnicianToken(label))
                .join('|');
            incidentCard.dataset.technicianFilterLabels = technicianLabels.join('||');

            if (config.showReporter === true) {
                const reporter = document.createElement('small');
                reporter.className = 'incident-reporter-line';
                reporter.textContent = 'por ';
                const reporterStrong = document.createElement('strong');
                reporterStrong.textContent = String(incident?.reporter_username || 'desconocido').trim() || 'desconocido';
                reporter.appendChild(reporterStrong);
                headingBlock.appendChild(reporter);
            }

            if (assignedTechnicianNames.length) {
                const assignedLine = document.createElement('small');
                assignedLine.className = 'incident-reporter-line incident-assigned-line';
                assignedLine.textContent = 'Tecnico asignado: ';
                const assignedStrong = document.createElement('strong');
                assignedStrong.textContent = assignedTechnicianNames.join(', ');
                assignedLine.appendChild(assignedStrong);
                headingBlock.appendChild(assignedLine);
            }

            const createdAt = document.createElement('small');
            createdAt.className = 'asset-muted';
            createdAt.textContent = formatIncidentCreatedAtText(incident?.created_at);
            incidentHeader.append(headingBlock, createdAt);
            incidentCard.appendChild(incidentHeader);

            appendIncidentContextSummary(incidentCard, incident, {
                installationId: options.parseStrictInteger(config.installationId ?? incident?.installation_id),
                assetId: options.parseStrictInteger(config.assetId ?? incident?.asset_id),
            });

            const note = document.createElement('p');
            note.className = 'incident-note-text';
            note.textContent = String(incident?.note || '').trim() || 'Sin detalle operativo.';
            incidentCard.appendChild(note);

            appendIncidentHighlights(incidentCard, incident, {
                installationId: options.parseStrictInteger(config.installationId ?? incident?.installation_id),
                assetId: config.includeAssetChip === true
                    ? options.parseStrictInteger(config.assetId ?? incident?.asset_id)
                    : null,
                assetTone: config.assetTone || 'neutral',
            });

            if (typeof options.renderEntityTechnicianAssignmentsPanel === 'function') {
                const incidentTechniciansPanel = await options.renderEntityTechnicianAssignmentsPanel({
                    entityType: 'incident',
                    entityId: incidentId,
                    entityLabel: `incidencia #${incidentId}`,
                    title: 'Responsables de la incidencia',
                    emptyText: 'Sin técnicos asignados directamente a esta incidencia.',
                    compact: true,
                    defaultRole: 'owner',
                    showEmptyMessage: false,
                    onApplied: async () => {
                        await refreshIncidentContext({
                            installationId: options.parseStrictInteger(config.installationId ?? incident?.installation_id),
                            assetId: options.parseStrictInteger(config.assetId ?? incident?.asset_id),
                        });
                    },
                });
                incidentCard.appendChild(incidentTechniciansPanel);
            }

            appendIncidentEvidenceSummary(incidentCard, incident);
            appendIncidentResolutionSummary(incidentCard, incident);

            const deletedAtText = String(incident?.deleted_at || '').trim();
            if (deletedAtText) {
                incidentCard.classList.add('incident-card-deleted');
                const deletedPanel = document.createElement('div');
                deletedPanel.className = 'incident-resolution-panel';
                deletedPanel.dataset.status = 'deleted';

                const deletedHeader = document.createElement('div');
                deletedHeader.className = 'incident-resolution-header';

                const deletedLabel = document.createElement('small');
                deletedLabel.className = 'asset-muted';
                deletedLabel.textContent = 'Auditoría';

                const deletedState = document.createElement('span');
                deletedState.className = 'incident-resolution-state';
                options.setElementTextWithMaterialIcon(
                    deletedState,
                    'delete',
                    'Incidencia eliminada',
                );

                deletedHeader.append(deletedLabel, deletedState);
                deletedPanel.appendChild(deletedHeader);

                const deletedMeta = document.createElement('small');
                deletedMeta.className = 'incident-resolution-meta';
                const deletedBy = String(incident?.deleted_by || '').trim();
                const deletionReason = String(incident?.deletion_reason || '').trim();
                deletedMeta.textContent = [
                    `Fecha: ${new Date(deletedAtText).toLocaleString('es-ES')}`,
                    deletedBy ? `por ${deletedBy}` : '',
                    deletionReason ? `motivo: ${deletionReason}` : '',
                ].filter(Boolean).join(' | ');
                deletedPanel.appendChild(deletedMeta);
                incidentCard.appendChild(deletedPanel);
            }

            const actions = appendIncidentStatusActions(incidentCard, incident, {
                assetId: options.parseStrictInteger(config.assetId),
                installationId: options.parseStrictInteger(config.installationId ?? incident?.installation_id),
            });
            appendIncidentUploadPhotoAction(actions, incident, config.installationId ?? incident.installation_id, {
                label: config.uploadLabel || INCIDENT_PHOTO_UPLOAD_LABEL,
                icon: config.uploadIcon || 'add_a_photo',
                assetId: options.parseStrictInteger(config.assetId),
            });
            await appendIncidentPhotosGrid(incidentCard, incident.photos, {
                attachPhotoIdDataset: config.attachPhotoIdDataset === true,
            });
            parent.appendChild(incidentCard);
        }

        async function renderIncidents(incidents, installationId) {
            const container = document.getElementById('incidentsList');
            if (!container) return;
            const renderSequence = ++incidentsRenderSequence;
            const fragment = document.createDocumentFragment();
            const activeIncidentCount = countActiveIncidents(incidents);
            let latestConformity = null;
            try {
                const result = await options.api.getInstallationConformity(installationId);
                latestConformity = result?.conformity || null;
            } catch {
                latestConformity = null;
            }
            if (renderSequence !== incidentsRenderSequence) {
                return;
            }

            const header = document.createElement('div');
            header.className = 'incidents-header';
            header.dataset.installationId = String(options.parseStrictInteger(installationId) || '');
            header.dataset.activeIncidentCount = String(activeIncidentCount);
            header.dataset.latestConformityStatus = String(latestConformity?.status || '').trim().toLowerCase();
            const headerMain = document.createElement('div');
            headerMain.className = 'incidents-header-main';

            const heading = document.createElement('h3');
            const headingIcon = options.createMaterialIconNode('warning');
            if (headingIcon) {
                heading.replaceChildren(headingIcon, document.createTextNode(` Incidencias del registro #${installationId}`));
            } else {
                heading.textContent = `Incidencias del registro #${installationId}`;
            }
            headerMain.appendChild(heading);

            const headerMeta = document.createElement('div');
            headerMeta.className = 'incidents-header-meta';
            const activeIncidentsChip = createConformityStatusChip(
                formatActiveIncidentsLabel(activeIncidentCount),
                activeIncidentCount === 0 ? 'resolved' : 'high',
            );
            activeIncidentsChip.dataset.role = 'active-incidents-chip';
            headerMeta.appendChild(activeIncidentsChip);
            if (latestConformity) {
                headerMeta.appendChild(
                    createConformityStatusChip(
                        `Ultima conformidad: ${formatConformityStatusLabel(latestConformity.status)}`,
                        latestConformity.status === 'emailed'
                            ? 'resolved'
                            : latestConformity.status === 'email_failed'
                                ? 'high'
                                : 'info',
                    ),
                );
                headerMeta.appendChild(
                    createConformityStatusChip(
                        formatConformityGeneratedAt(latestConformity.generated_at),
                        'neutral',
                    ),
                );
            }
            headerMain.appendChild(headerMeta);

            const closureBanner = document.createElement('div');
            closureBanner.className = 'incidents-closure-banner';
            closureBanner.dataset.role = 'closure-banner';

            const closureBannerCopy = document.createElement('div');
            closureBannerCopy.className = 'incidents-closure-banner-copy';

            const closureBannerEyebrow = document.createElement('span');
            closureBannerEyebrow.className = 'incidents-closure-banner-eyebrow';
            closureBannerEyebrow.dataset.role = 'closure-banner-eyebrow';

            const closureBannerTitle = document.createElement('strong');
            closureBannerTitle.className = 'incidents-closure-banner-title';
            closureBannerTitle.dataset.role = 'closure-banner-title';

            const closureBannerDescription = document.createElement('p');
            closureBannerDescription.className = 'incidents-closure-banner-description';
            closureBannerDescription.dataset.role = 'closure-banner-description';

            closureBannerCopy.append(
                closureBannerEyebrow,
                closureBannerTitle,
                closureBannerDescription,
            );
            closureBanner.appendChild(closureBannerCopy);

            if (latestConformity) {
                const latestSummary = document.createElement('div');
                latestSummary.className = 'incidents-conformity-summary';

                const latestSummaryLabel = document.createElement('small');
                latestSummaryLabel.className = 'incidents-conformity-summary-label';
                latestSummaryLabel.textContent = 'Ultima conformidad';

                const latestSummaryPrimary = document.createElement('strong');
                latestSummaryPrimary.className = 'incidents-conformity-summary-primary';
                latestSummaryPrimary.textContent = latestConformity.signed_by_name || 'Sin firmante';

                const latestSummaryMeta = document.createElement('div');
                latestSummaryMeta.className = 'incidents-conformity-summary-meta';
                latestSummaryMeta.appendChild(
                    createConformityStatusChip(
                        formatConformityStatusLabel(latestConformity.status),
                        latestConformity.status === 'emailed'
                            ? 'resolved'
                            : latestConformity.status === 'email_failed'
                                ? 'high'
                                : 'info',
                    ),
                );
                latestSummaryMeta.appendChild(
                    createConformityStatusChip(
                        formatConformityGeneratedAt(latestConformity.generated_at),
                        'neutral',
                    ),
                );

                latestSummary.append(
                    latestSummaryLabel,
                    latestSummaryPrimary,
                    latestSummaryMeta,
                );

                if (latestConformity.pdf_download_path) {
                    const latestSummaryLink = document.createElement('a');
                    latestSummaryLink.href = latestConformity.pdf_download_path;
                    latestSummaryLink.target = '_blank';
                    latestSummaryLink.rel = 'noreferrer';
                    latestSummaryLink.className = 'conformity-modal-link';
                    latestSummaryLink.textContent = 'Descargar ultima constancia';
                    latestSummary.appendChild(latestSummaryLink);
                }

                closureBanner.appendChild(latestSummary);
            }

            applyClosureBannerState(closureBanner, activeIncidentCount, latestConformity?.status);
            headerMain.appendChild(closureBanner);

            const backButton = document.createElement('button');
            backButton.type = 'button';
            backButton.className = 'btn-secondary';
            const backIcon = options.createMaterialIconNode('arrow_back');
            if (backIcon) {
                backButton.replaceChildren(backIcon, document.createTextNode(' Volver'));
            } else {
                backButton.textContent = 'Volver';
            }
            backButton.addEventListener('click', () => {
                document.querySelector('[data-section="installations"]')?.click();
            });

            const createIncidentBtn = document.createElement('button');
            createIncidentBtn.type = 'button';
            createIncidentBtn.dataset.role = 'create-incident-trigger';
            applyCreateIncidentButtonState(createIncidentBtn, activeIncidentCount);
            createIncidentBtn.addEventListener('click', () => {
                const currentActiveIncidentCount = Math.max(
                    0,
                    Number.parseInt(String(createIncidentBtn.dataset.activeIncidentCount || header.dataset.activeIncidentCount || '0'), 10) || 0,
                );
                if (currentActiveIncidentCount === 0) {
                    options.openActionConfirmModal({
                        title: `Reabrir trabajo en registro #${installationId}`,
                        subtitle: 'Este registro ya quedo listo para conformidad. Crear una nueva incidencia vuelve a abrir el trabajo operativo.',
                        submitLabel: 'Abrir nueva incidencia',
                        acknowledgementText: 'Confirmo que necesito reabrir el trabajo con una nueva incidencia.',
                        missingConfirmationMessage: 'Debes confirmar la reapertura para continuar.',
                        onSubmit: async () => {
                            options.closeActionModal(true);
                            createIncidentFromWeb(installationId);
                        },
                    });
                    return;
                }
                createIncidentFromWeb(installationId);
            });

            const conformityBtn = document.createElement('button');
            conformityBtn.type = 'button';
            conformityBtn.dataset.role = 'conformity-trigger';
            applyConformityButtonState(conformityBtn, activeIncidentCount);
            conformityBtn.addEventListener('click', () => {
                const currentActiveIncidentCount = Math.max(
                    0,
                    Number.parseInt(String(conformityBtn.dataset.activeIncidentCount || header.dataset.activeIncidentCount || '0'), 10) || 0,
                );
                if (currentActiveIncidentCount > 0) {
                    options.showNotification(
                        `Quedan ${currentActiveIncidentCount} incidencia${currentActiveIncidentCount === 1 ? '' : 's'} activa${currentActiveIncidentCount === 1 ? '' : 's'}. Resuelvelas antes de emitir la conformidad.`,
                        'warning',
                    );
                    return;
                }
                void openInstallationConformityModal(installationId, {
                    activeIncidentCount: currentActiveIncidentCount,
                    latestConformity,
                });
            });

            const shareTrackingBtn = document.createElement('button');
            shareTrackingBtn.type = 'button';
            shareTrackingBtn.className = 'btn-secondary';
            shareTrackingBtn.dataset.role = 'public-tracking-trigger';
            const shareTrackingIcon = options.createMaterialIconNode('share');
            if (shareTrackingIcon) {
                shareTrackingBtn.replaceChildren(shareTrackingIcon, document.createTextNode(' Compartir seguimiento'));
            } else {
                shareTrackingBtn.textContent = 'Compartir seguimiento';
            }
            shareTrackingBtn.addEventListener('click', () => {
                void openPublicTrackingModal(installationId);
            });

            const actions = document.createElement('div');
            actions.className = 'incidents-header-actions';
            const utilityActions = document.createElement('div');
            utilityActions.className = 'incidents-header-utility-actions';
            const secondaryActions = document.createElement('div');
            secondaryActions.className = 'incidents-header-secondary-actions';
            const shareActions = document.createElement('div');
            shareActions.className = 'incidents-header-share-actions';
            const primaryActions = document.createElement('div');
            primaryActions.className = 'incidents-header-primary-actions';
            const technicianFilterWrap = document.createElement('label');
            technicianFilterWrap.className = 'incidents-technician-filter';
            technicianFilterWrap.hidden = true;

            const technicianFilterLabel = document.createElement('span');
            technicianFilterLabel.textContent = 'Tecnico';

            const technicianFilterSelect = document.createElement('select');
            technicianFilterSelect.id = 'incidentsTechnicianFilter';
            technicianFilterSelect.appendChild(new Option('Todos los tecnicos', ''));
            technicianFilterSelect.addEventListener('change', () => {
                applyIncidentTechnicianFilter(container, technicianFilterSelect.value);
            });
            technicianFilterWrap.append(technicianFilterLabel, technicianFilterSelect);

            if (canCurrentUserAuditDeletedIncidents()) {
                const auditToggleWrap = document.createElement('label');
                auditToggleWrap.className = 'action-checkbox';
                auditToggleWrap.title = 'Incluye incidencias eliminadas para auditoría';

                const auditToggle = document.createElement('input');
                auditToggle.type = 'checkbox';
                auditToggle.checked = includeDeletedIncidentsAudit === true;
                auditToggle.addEventListener('change', () => {
                    includeDeletedIncidentsAudit = auditToggle.checked === true;
                    void showIncidentsForInstallation(installationId);
                });

                const auditToggleText = document.createElement('span');
                auditToggleText.textContent = 'Mostrar eliminadas (auditoría)';

                auditToggleWrap.append(auditToggle, auditToggleText);
                utilityActions.appendChild(auditToggleWrap);
            }

            if (canCurrentUserManagePublicTracking()) {
                shareActions.appendChild(shareTrackingBtn);
            }
            secondaryActions.append(createIncidentBtn, backButton);
            primaryActions.appendChild(conformityBtn);
            actions.append(secondaryActions, utilityActions, shareActions, primaryActions);

            header.append(headerMain, actions);
            fragment.appendChild(header);

            const listToolbar = document.createElement('div');
            listToolbar.className = 'incidents-list-toolbar';
            listToolbar.appendChild(technicianFilterWrap);
            fragment.appendChild(listToolbar);

            if (!incidents || !incidents.length) {
                const emptyStateHost = document.createElement('div');
                options.renderContextualEmptyState(emptyStateHost, {
                    title: 'Sin incidencias para este registro',
                    description: 'Si detectas un problema, crea la primera incidencia desde aqui. Si ya cerraste el caso, puedes emitir la conformidad desde el encabezado.',
                    actionLabel: 'Crear incidencia',
                    onAction: () => createIncidentBtn.click(),
                    tone: 'neutral',
                });
                if (renderSequence !== incidentsRenderSequence) {
                    return;
                }
                fragment.appendChild(emptyStateHost);
                container.replaceChildren(fragment);
                return;
            }

            for (const incident of incidents) {
                await appendIncidentCard(fragment, incident, {
                    installationId: Number.parseInt(String(installationId), 10),
                    assetId: options.parseStrictInteger(incident?.asset_id),
                    includeAssetChip: true,
                    assetTone: 'accent',
                    showReporter: true,
                    attachPhotoIdDataset: true,
                    uploadLabel: INCIDENT_PHOTO_UPLOAD_LABEL,
                    uploadIcon: 'add_a_photo',
                });
                if (renderSequence !== incidentsRenderSequence) {
                    return;
                }
            }
            const filterEmptyState = document.createElement('p');
            filterEmptyState.className = 'asset-muted incidents-filter-empty';
            filterEmptyState.hidden = true;
            filterEmptyState.textContent = 'No hay incidencias visibles para el tecnico seleccionado.';
            fragment.appendChild(filterEmptyState);
            container.replaceChildren(fragment);
            hydrateIncidentTechnicianFilter(container, technicianFilterSelect);
        }

        function showIncidentsWorkspaceLanding() {
            const container = document.getElementById('incidentsList');
            if (!container) return;
            bindIncidentMapControls();
            container.replaceChildren();
            options.renderContextualEmptyState(container, {
                title: 'Sin registro seleccionado',
                description: 'Abre un registro desde Historial o entra desde Equipos para atender incidencias con el contexto correcto.',
                actionLabel: 'Ir a Equipos',
                onAction: () => {
                    options.navigateToSectionByKey?.('assets');
                },
                tone: 'info',
            });
        }

        function showIncidentsWorkspace() {
            if (!options.requireActiveSession()) return;
            bindIncidentMapControls();
            void loadIncidentMap();
            const currentInstallationId = options.parseStrictInteger(options.getCurrentSelectedInstallationId?.());
            if (Number.isInteger(currentInstallationId) && currentInstallationId > 0) {
                void showIncidentsForInstallation(currentInstallationId);
                return;
            }
            showIncidentsWorkspaceLanding();
        }

        function openIncidentModal(config = {}) {
            const parsedInstallationId = options.parseStrictInteger(config.installationId);
            const defaultInstallationId = Number.isInteger(parsedInstallationId) && parsedInstallationId > 0
                ? String(parsedInstallationId)
                : '';
            const defaultNote = String(config.note || '').trim();
            const defaultSeverity = options.normalizeSeverity(config.severity || 'medium');
            const parsedAdjustment = options.parseStrictInteger(config.timeAdjustment);
            const parsedEstimatedDuration = options.parseStrictInteger(config.estimatedDurationSeconds);
            let defaultEstimatedDurationSeconds = 0;
            if (Number.isInteger(parsedEstimatedDuration) && parsedEstimatedDuration >= 0) {
                defaultEstimatedDurationSeconds = Math.min(
                    parsedEstimatedDuration,
                    options.incidentEstimatedDurationMaxSeconds,
                );
            } else if (Number.isInteger(parsedAdjustment) && parsedAdjustment >= 0) {
                defaultEstimatedDurationSeconds = Math.min(
                    parsedAdjustment,
                    options.incidentEstimatedDurationMaxSeconds,
                );
            }
            const defaultApply = config.applyToInstallation === true;
            const numericAssetId = options.parseStrictInteger(config.assetId);
            const activeInstallationId = options.parseStrictInteger(config.activeInstallationId);
            const isAssetContext = Number.isInteger(numericAssetId) && numericAssetId > 0;
            let gpsController = null;
            let latestIncidentGpsSnapshot = null;

            function resolveTargetInstallationForGeofence() {
                const installationInput = document.getElementById('actionIncidentInstallationId');
                const rawValue = String(installationInput?.value || '').trim();
                const parsedValue = rawValue ? options.parseStrictInteger(rawValue) : null;
                if (Number.isInteger(parsedValue) && parsedValue > 0) {
                    return options.getInstallationById?.(parsedValue) || null;
                }
                if (Number.isInteger(activeInstallationId) && activeInstallationId > 0) {
                    return options.getInstallationById?.(activeInstallationId) || null;
                }
                return null;
            }

            function syncIncidentGeofenceOverrideUi(snapshot) {
                latestIncidentGpsSnapshot = snapshot && typeof snapshot === 'object'
                    ? { ...snapshot }
                    : null;
                const overrideWrap = document.getElementById(INCIDENT_GEOFENCE_OVERRIDE_WRAP_ID);
                const overrideInput = document.getElementById(INCIDENT_GEOFENCE_OVERRIDE_INPUT_ID);
                const overrideHelp = document.getElementById(INCIDENT_GEOFENCE_OVERRIDE_HELP_ID);
                if (!(overrideWrap instanceof HTMLElement) || !(overrideInput instanceof HTMLTextAreaElement)) {
                    return;
                }

                overrideWrap.hidden = true;
                overrideInput.required = false;
            }

            const modalOpened = options.openActionModal({
                title: isAssetContext ? `Nueva incidencia para equipo #${numericAssetId}` : 'Nueva incidencia',
                subtitle: isAssetContext
                    ? 'Completa detalle y severidad. El registro se resolvera automaticamente si no lo indicas.'
                    : 'Completa detalle, severidad y tiempo estimado.',
                submitLabel: 'Crear incidencia',
                focusId: 'actionIncidentNote',
                fields: buildIncidentCreateFields({
                    defaultApply,
                    defaultEstimatedDurationSeconds,
                    defaultInstallationId,
                    defaultNote,
                    defaultSeverity,
                    isAssetContext,
                }),
                onSubmit: async () => {
                    const installationRaw = String(document.getElementById('actionIncidentInstallationId')?.value || '').trim();
                    const targetInstallationId = installationRaw ? options.parseStrictInteger(installationRaw) : null;

                    if (installationRaw && (!Number.isInteger(targetInstallationId) || targetInstallationId <= 0)) {
                        options.setActionModalError('El ID de registro debe ser un entero positivo cuando se informa.');
                        return;
                    }
                    if (!isAssetContext && (!Number.isInteger(targetInstallationId) || targetInstallationId <= 0)) {
                        options.setActionModalError('El ID de registro debe ser un entero positivo.');
                        return;
                    }

                    const note = String(document.getElementById('actionIncidentNote')?.value || '').trim();
                    if (!note) {
                        options.setActionModalError('La incidencia requiere una nota.');
                        return;
                    }

                    const estimatedDurationResult = options.readIncidentEstimatedDurationFromModal();
                    if (estimatedDurationResult.error) {
                        options.setActionModalError(estimatedDurationResult.error);
                        return;
                    }

                    const severity = options.normalizeSeverity(document.getElementById('actionIncidentSeverity')?.value || 'medium');
                    const applyToInstallation = document.getElementById('actionIncidentApplyToRecord')?.checked === true;
                    const technicianName = String(document.getElementById('actionIncidentTechnicianName')?.value || '').trim()
                        || String(options.getCurrentUser?.()?.username || 'web_user').trim()
                        || 'web_user';
                    const payload = {
                        note,
                        reporter_username: technicianName,
                        time_adjustment_seconds: estimatedDurationResult.seconds,
                        estimated_duration_seconds: estimatedDurationResult.seconds,
                        severity,
                        source: 'web',
                        apply_to_installation: applyToInstallation,
                        gps: gpsController?.getSnapshotForSubmit?.(),
                    };
                    let result;
                    let resolvedInstallationId = Number.isInteger(targetInstallationId) ? targetInstallationId : null;

                    if (isAssetContext) {
                        if (
                            Number.isInteger(resolvedInstallationId)
                            && resolvedInstallationId > 0
                            && (!Number.isInteger(activeInstallationId) || activeInstallationId <= 0 || activeInstallationId !== resolvedInstallationId)
                        ) {
                            await options.api.linkAssetToInstallation(numericAssetId, {
                                installation_id: resolvedInstallationId,
                                notes: 'Vinculo creado desde modulo Equipos',
                            });
                        }
                        result = await options.api.createAssetIncident(numericAssetId, {
                            ...payload,
                            installation_id: resolvedInstallationId,
                        });
                        const apiInstallationId = options.parseStrictInteger(result?.installation_id ?? result?.incident?.installation_id);
                        if (Number.isInteger(apiInstallationId) && apiInstallationId > 0) {
                            resolvedInstallationId = apiInstallationId;
                        }
                    } else {
                        result = await options.api.createIncident(targetInstallationId, payload);
                        resolvedInstallationId = targetInstallationId;
                    }

                    options.closeActionModal(true);
                    const incidentId = Number(result?.incident?.id);
                    options.showNotification(
                        Number.isInteger(incidentId) && incidentId > 0 && Number.isInteger(resolvedInstallationId) && resolvedInstallationId > 0
                            ? `Incidencia creada (#${incidentId}) en registro #${resolvedInstallationId}`
                            : Number.isInteger(incidentId) && incidentId > 0
                                ? `Incidencia creada (#${incidentId})`
                            : 'Incidencia creada',
                        'success',
                    );
                    if (isAssetContext) {
                        runIncidentRefreshInBackground(
                            { assetId: numericAssetId, installationId: resolvedInstallationId },
                            'La incidencia se creo, pero no pudimos refrescar el detalle del equipo.',
                        );
                    } else if (Number.isInteger(resolvedInstallationId) && resolvedInstallationId > 0) {
                        runIncidentRefreshInBackground(
                            { installationId: resolvedInstallationId },
                            'La incidencia se creo, pero no pudimos refrescar el registro.',
                        );
                    }
                    void options.loadDashboard();
                },
            });

            if (modalOpened) {
                options.bindIncidentEstimatedDurationFields(defaultEstimatedDurationSeconds);
                document.getElementById('actionIncidentInstallationId')?.addEventListener('input', () => {
                    syncIncidentGeofenceOverrideUi(
                        gpsController?.getSnapshotForSubmit?.() || latestIncidentGpsSnapshot,
                    );
                    void hydrateTechnicianSelectFromContext('actionIncidentTechnicianName', {
                        installationId: document.getElementById('actionIncidentInstallationId')?.value || '',
                        assetId: numericAssetId,
                    });
                });
                void hydrateTechnicianSelectFromContext('actionIncidentTechnicianName', {
                    installationId: defaultInstallationId,
                    assetId: numericAssetId,
                });
                if (options.geolocation) {
                    gpsController = options.geolocation.createController({
                        panelElement: document.getElementById('actionIncidentGpsPanel'),
                        statusElement: document.getElementById('actionIncidentGpsStatus'),
                        summaryElement: document.getElementById('actionIncidentGpsSummary'),
                        captureButton: document.getElementById('actionIncidentGpsRetryBtn'),
                        onSnapshotChange: syncIncidentGeofenceOverrideUi,
                    });
                    void gpsController.capture();
                } else {
                    syncIncidentGeofenceOverrideUi({
                        status: 'unsupported',
                        source: 'browser',
                        note: '',
                    });
                }
            }
        }

        function createIncidentFromWeb(installationId, config = {}) {
            if (!options.requireActiveSession()) return;
            const targetId = options.parseStrictInteger(installationId);
            const numericAssetId = options.parseStrictInteger(config.assetId);
            if ((!Number.isInteger(targetId) || targetId <= 0) && (!Number.isInteger(numericAssetId) || numericAssetId <= 0)) {
                options.showNotification('installation_id invalido para crear incidencia.', 'error');
                return;
            }

            openIncidentModal({
                installationId: Number.isInteger(targetId) && targetId > 0 ? targetId : '',
                assetId: numericAssetId,
                activeInstallationId: options.parseStrictInteger(config.activeInstallationId),
            });
        }

        async function showIncidentsForInstallation(installationId, config = {}) {
            if (!options.requireActiveSession()) return;
            options.setCurrentSelectedInstallationId(Number.parseInt(String(installationId), 10));
            const container = document.getElementById('incidentsList');
            const isActive = options.getActiveSectionName() === 'incidents';
            if (!isActive) {
                document.querySelector('[data-section="incidents"]')?.click();
            }
            if (container) container.innerHTML = '<p class="loading">Cargando incidencias...</p>';

            try {
                const data = await options.api.getIncidents(installationId, {
                    includeDeleted: includeDeletedIncidentsAudit && canCurrentUserAuditDeletedIncidents(),
                });
                await renderIncidents(data.incidents || [], installationId);
                if (isActive) {
                    void loadIncidentMap();
                }
                if (options.parseStrictInteger(config.focusIncidentId) > 0) {
                    requestAnimationFrame(() => {
                        focusIncidentCard(config.focusIncidentId);
                    });
                }
            } catch (error) {
                const message = String(error?.message || '').trim()
                    || 'Error cargando incidencias';
                if (container) {
                    container.innerHTML = '';
                    const errorNode = document.createElement('p');
                    errorNode.className = 'error';
                    errorNode.textContent = message;
                    container.appendChild(errorNode);
                }
                options.showNotification(message, 'error');
            }
        }

        async function selectAndUploadIncidentPhoto(incidentId, installationId, config = {}) {
            const targetIncidentId = Number.parseInt(String(incidentId), 10);
            if (!Number.isInteger(targetIncidentId) || targetIncidentId <= 0) {
                options.showNotification('incident_id invalido para subir foto.', 'error');
                return;
            }
            const targetInstallationId = options.parseStrictInteger(installationId);
            const targetAssetId = options.parseStrictInteger(config.assetId);

            const picker = document.createElement('input');
            picker.className = 'hidden-file-picker';
            picker.type = 'file';
            picker.multiple = true;
            picker.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
            document.body.appendChild(picker);

            picker.addEventListener('change', async () => {
                const selectedFiles = Array.from(picker.files || []);
                picker.remove();
                if (!selectedFiles.length) return;

                const filesToUpload = selectedFiles.slice(0, INCIDENT_PHOTO_UPLOAD_MAX_FILES);
                if (selectedFiles.length > INCIDENT_PHOTO_UPLOAD_MAX_FILES) {
                    options.showNotification(
                        `Solo se permiten ${INCIDENT_PHOTO_UPLOAD_MAX_FILES} fotos por carga. Se subiran las primeras ${INCIDENT_PHOTO_UPLOAD_MAX_FILES}.`,
                        'warning',
                    );
                }

                const totalBatchBytes = filesToUpload.reduce(
                    (sum, file) => sum + Math.max(0, Number(file?.size) || 0),
                    0,
                );
                if (totalBatchBytes > INCIDENT_PHOTO_UPLOAD_MAX_BATCH_BYTES) {
                    options.showNotification(
                        `La carga seleccionada pesa ${formatPhotoBytes(totalBatchBytes)} y supera el maximo de ${formatPhotoBytes(INCIDENT_PHOTO_UPLOAD_MAX_BATCH_BYTES)} por tanda.`,
                        'error',
                    );
                    return;
                }

                options.showNotification(
                    filesToUpload.length > 1
                        ? `Preparando y optimizando ${filesToUpload.length} fotos (${formatPhotoBytes(totalBatchBytes)}) para incidencia #${targetIncidentId}...`
                        : `Preparando y optimizando 1 foto para incidencia #${targetIncidentId}...`,
                    'info',
                );

                let uploadedCount = 0;
                let optimizedCount = 0;
                const failedFiles = [];

                for (const file of filesToUpload) {
                    try {
                        const optimized = await optimizeIncidentPhotoFile(file);
                        const uploadFile = optimized.file;
                        if (Math.max(0, Number(uploadFile?.size) || 0) > INCIDENT_PHOTO_UPLOAD_MAX_FILE_BYTES) {
                            throw new Error(
                                `La foto ${uploadFile?.name || 'seleccionada'} supera el maximo de ${formatPhotoBytes(INCIDENT_PHOTO_UPLOAD_MAX_FILE_BYTES)} luego de optimizarla.`,
                            );
                        }
                        await options.api.uploadIncidentPhoto(targetIncidentId, uploadFile);
                        uploadedCount += 1;
                        if (optimized.optimized) {
                            optimizedCount += 1;
                        }
                    } catch (error) {
                        failedFiles.push({
                            name: String(file?.name || '').trim() || 'archivo',
                            message: error?.message || error,
                        });
                    }
                }

                if (!uploadedCount) {
                    const failure = failedFiles[0];
                    options.showNotification(
                        `No se pudo subir ninguna foto: ${failure?.message || 'Error desconocido.'}`,
                        'error',
                    );
                    return;
                }

                const uploadedLabel = uploadedCount === 1 ? '1 foto subida' : `${uploadedCount} fotos subidas`;
                if (failedFiles.length > 0) {
                    const firstFailedName = failedFiles[0]?.name || 'archivo';
                    options.showNotification(
                        `${uploadedLabel} a incidencia #${targetIncidentId}. Fallaron ${failedFiles.length} archivo(s), empezando por ${firstFailedName}.`,
                        'warning',
                    );
                } else {
                    options.showNotification(
                        optimizedCount > 0
                            ? `${uploadedLabel} a incidencia #${targetIncidentId}. ${optimizedCount} optimizada(s) antes de subir.`
                            : `${uploadedLabel} a incidencia #${targetIncidentId}.`,
                        'success',
                    );
                }

                if (Number.isInteger(targetInstallationId) && targetInstallationId > 0) {
                    runIncidentRefreshInBackground(
                        { installationId: targetInstallationId },
                        'Las fotos se subieron, pero no pudimos refrescar el registro.',
                    );
                } else if (Number.isInteger(targetAssetId) && targetAssetId > 0) {
                    runIncidentRefreshInBackground(
                        { assetId: targetAssetId },
                        'Las fotos se subieron, pero no pudimos refrescar el detalle del equipo.',
                    );
                }
            }, { once: true });

            picker.click();
        }

        async function updateIncidentEvidenceFromWeb(incident, config = {}) {
            if (!options.requireActiveSession()) return;
            const incidentId = options.parseStrictInteger(incident?.id);
            if (!Number.isInteger(incidentId) || incidentId <= 0) {
                options.showNotification('Incidencia invalida para actualizar evidencia.', 'error');
                return;
            }
            if (!options.canCurrentUserEditAssets()) {
                options.showNotification('Solo admin/super_admin puede actualizar evidencia.', 'warning');
                return;
            }

            const currentChecklist = options.normalizeIncidentChecklistItems(incident?.checklist_items);
            const currentEvidenceNote = String(incident?.evidence_note || '').trim();
            const selectedPresetItems = currentChecklist.filter((item) => options.incidentChecklistPresets.includes(item));
            const customChecklistItems = currentChecklist.filter((item) => !options.incidentChecklistPresets.includes(item));

            options.openActionModal({
                title: `Evidencia incidencia #${incidentId}`,
                subtitle: 'Actualiza checklist y nota operativa en el registro de evidencia.',
                submitLabel: 'Guardar evidencia',
                modalWidth: 'wide',
                focusId: 'actionIncidentEvidenceNote',
                fields: buildIncidentEvidenceFields({
                    currentEvidenceNote,
                    customChecklistItems,
                    selectedPresetItems,
                }),
                onSubmit: async () => {
                    const selectedPresets = Array.from(
                        document.querySelectorAll('input[name="actionIncidentChecklistPreset"]:checked'),
                    ).map((input) => String(input.value || '').trim());
                    const customItems = parseChecklistItemsFromMultiline(document.getElementById('actionIncidentChecklistCustom')?.value);
                    const checklistItems = dedupeChecklistItems([...selectedPresets, ...customItems]);
                    const evidenceNote = String(document.getElementById('actionIncidentEvidenceNote')?.value || '').trim();

                    if (!checklistItems.length && !evidenceNote) {
                        options.setActionModalError('Debes cargar checklist o nota operativa.');
                        return;
                    }

                    await options.api.updateIncidentEvidence(incidentId, {
                        checklist_items: checklistItems,
                        evidence_note: evidenceNote || null,
                    });
                    options.closeActionModal(true);
                    options.showNotification(`Evidencia actualizada en incidencia #${incidentId}`, 'success');
                    runIncidentRefreshInBackground(
                        config,
                        'La evidencia se guardo, pero no pudimos refrescar la vista.',
                    );
                    void options.loadDashboard();
                },
            });
        }

        async function updateIncidentStatusFromWeb(incident, targetStatus, config = {}) {
            if (!options.requireActiveSession()) return;
            const incidentId = Number.parseInt(String(incident?.id), 10);
            if (!Number.isInteger(incidentId) || incidentId <= 0) {
                options.showNotification('Incidencia invalida para actualizar estado.', 'error');
                return;
            }

            const normalizedStatus = options.normalizeIncidentStatus(targetStatus);
            const currentStatus = options.normalizeIncidentStatus(incident?.incident_status);
            const applyStatusUpdate = async (resolutionNote = '') => {
                setIncidentCardsUpdating(incidentId, true);
                try {
                    const result = await options.api.updateIncidentStatus(incidentId, {
                        incident_status: normalizedStatus,
                        resolution_note: resolutionNote,
                        reporter_username: options.getCurrentUser()?.username || 'web_user',
                    });
                    if (result?.incident && typeof result.incident === 'object') {
                        applyVisibleIncidentUpdate(result.incident);
                        rememberRecentLocalStatusUpdate(result.incident);
                    } else {
                        rememberRecentLocalStatusUpdate(
                            { id: incidentId, incident_status: normalizedStatus },
                            normalizedStatus,
                        );
                    }
                    options.showNotification(`Incidencia #${incidentId} actualizada a "${options.incidentStatusLabel(normalizedStatus)}".`, 'success');
                    runIncidentRefreshInBackground(
                        config,
                        'El estado se actualizo, pero no pudimos refrescar la vista.',
                    );
                    void options.loadDashboard();
                } catch (error) {
                    setIncidentCardsUpdating(incidentId, false);
                    options.showNotification(`No se pudo actualizar estado: ${error.message || error}`, 'error');
                }
            };

            if (normalizedStatus === 'resolved') {
                const defaultNote = String(incident?.resolution_note || '').trim();
                options.openActionModal({
                    title: `Resolver incidencia #${incidentId}`,
                    subtitle: 'Agrega una nota de resolucion opcional antes de cerrar la incidencia.',
                    submitLabel: 'Resolver incidencia',
                    focusId: 'actionIncidentResolutionNote',
                    fields: buildIncidentResolutionFields(defaultNote),
                    onSubmit: async () => {
                        const resolutionNote = String(document.getElementById('actionIncidentResolutionNote')?.value || '').trim();
                        await applyStatusUpdate(resolutionNote);
                        options.closeActionModal(true);
                    },
                });
                return;
            }

            if (currentStatus === 'resolved' && normalizedStatus !== 'resolved') {
                const targetStatusLabel = options.incidentStatusLabel(normalizedStatus);
                options.openActionConfirmModal({
                    title: `Reabrir incidencia #${incidentId}`,
                    subtitle: `La incidencia volvera al flujo activo y pasara a "${targetStatusLabel}".`,
                    submitLabel: `Cambiar a ${targetStatusLabel}`,
                    acknowledgementText: `Confirmo que quiero reabrir esta incidencia y moverla a "${targetStatusLabel}".`,
                    missingConfirmationMessage: 'Debes confirmar la reapertura para continuar.',
                    onSubmit: async () => {
                        await applyStatusUpdate('');
                        options.closeActionModal(true);
                    },
                });
                return;
            }

            await applyStatusUpdate('');
        }

        async function deleteIncidentFromWeb(incident, config = {}) {
            if (!options.requireActiveSession()) return;
            const incidentId = options.parseStrictInteger(incident?.id);
            if (!Number.isInteger(incidentId) || incidentId <= 0) return;

            options.openActionConfirmModal({
                title: `Eliminar incidencia #${incidentId}`,
                subtitle: 'Esta accion marcara la incidencia como eliminada y dejara rastro en el registro de auditoria.',
                submitLabel: 'Eliminar incidencia',
                acknowledgementText: 'Confirmo que deseo eliminar esta incidencia de los listados activos.',
                missingConfirmationMessage: 'Debes confirmar la eliminacion para continuar.',
                onSubmit: async () => {
                    options.closeActionModal(true);
                    try {
                        const updateOptions = buildIncidentStatusUpdateOptions(incident, config);
                        setIncidentCardsUpdating(incidentId, true);
                        await options.api.deleteIncident(incidentId);
                        options.showNotification(`Incidencia #${incidentId} eliminada.`, 'success');
                        runIncidentRefreshInBackground(
                            updateOptions,
                            'La incidencia se elimino, pero no pudimos refrescar la vista.',
                        );
                        void options.loadDashboard();
                    } catch (error) {
                        setIncidentCardsUpdating(incidentId, false);
                        options.showNotification(`No se pudo eliminar la incidencia: ${error.message || error}`, 'error');
                    }
                },
            });
        }

        async function createIncidentForAsset(assetId) {
            if (!options.requireActiveSession()) return;
            const numericAssetId = Number.parseInt(String(assetId), 10);
            if (!Number.isInteger(numericAssetId) || numericAssetId <= 0) {
                options.showNotification('asset_id invalido.', 'error');
                return;
            }

            try {
                const detail = await options.api.getAssetIncidents(numericAssetId, { limit: 1 });
                const activeInstallationId = Number(detail?.active_link?.installation_id);
                createIncidentFromWeb(activeInstallationId, {
                    assetId: numericAssetId,
                    activeInstallationId,
                });
            } catch (error) {
                options.showNotification(`No se pudo crear incidencia del equipo: ${error.message || error}`, 'error');
            }
        }

        function handleRealtimeIncident(incident) {
            const severityIcon = incident.severity === 'critical' ? 'CRIT' : incident.severity === 'high' ? 'ALTA' : 'WARN';
            const currentLinkedTechnician = options.getCurrentLinkedTechnician?.();
            const fallbackMessage = `${severityIcon} Nueva incidencia en registro #${incident.installation_id}`;
            if (!currentLinkedTechnician?.display_name) {
                options.showNotification(fallbackMessage, 'warning');
                return;
            }

            void loadContextTechnicianAssignments({
                incidentId: options.parseStrictInteger(incident?.id),
                installationId: options.parseStrictInteger(incident?.installation_id),
                assetId: options.parseStrictInteger(incident?.asset_id),
            }).then((assignmentContext) => {
                const assignedTokens = assignmentContext.allTechnicianNames
                    .map((name) => normalizeTechnicianToken(name))
                    .filter(Boolean);
                const currentTechnicianToken = normalizeTechnicianToken(currentLinkedTechnician.display_name);
                if (currentTechnicianToken && assignedTokens.includes(currentTechnicianToken)) {
                    options.showNotification(
                        `${severityIcon} Nueva incidencia asignada a tu cola: registro #${incident.installation_id}.`,
                        'warning',
                    );
                    return;
                }
                options.showNotification(fallbackMessage, 'warning');
            }).catch(() => {
                options.showNotification(fallbackMessage, 'warning');
            });
        }

        let lastRefreshAt = 0;
        const REFRESH_THROTTLE_MS = 2000;

        function handleRealtimeIncidentStatusUpdate(incident) {
            if (!incident || !incident.id) return;
            const isLocalEcho = consumeRecentLocalStatusUpdate(incident);
            const isDeleted = String(incident?.deleted_at || '').trim().length > 0;
            if (isDeleted) {
                options.showNotification(`Incidencia #${incident.id} eliminada.`, 'info');
            } else {
                applyVisibleIncidentUpdate(incident);
                if (isLocalEcho) {
                    return;
                }
                options.showNotification(
                    `Incidencia #${incident.id} ahora esta "${options.incidentStatusLabel(incident.incident_status)}".`,
                    'info',
                );
            }

            const now = Date.now();
            if (now - lastRefreshAt < REFRESH_THROTTLE_MS) {
                console.log('[SSE] Refresh throttled');
                return;
            }
            lastRefreshAt = now;

            const activeIncidentsSection = options.isSectionActive('incidents');
            const activeAssetsSection = options.isSectionActive('assets');
            const activeDashboardSection = options.isSectionActive('dashboard');
            const currentSelectedInstallationId = options.getCurrentSelectedInstallationId();
            const currentSelectedAssetId = options.getCurrentSelectedAssetId();

            if (activeIncidentsSection && currentSelectedInstallationId) {
                void showIncidentsForInstallation(currentSelectedInstallationId);
            }
            if (activeAssetsSection && currentSelectedAssetId) {
                void options.loadAssetDetail(currentSelectedAssetId, { keepSelection: true });
            }
            if (activeDashboardSection) {
                void options.loadDashboard();
            }
        }

        return {
            appendIncidentCard,
            createIncidentForAsset,
            createIncidentFromWeb,
            deleteIncidentFromWeb,
            deriveAssetAttentionMetaFromIncidents,
            handleRealtimeIncident,
            handleRealtimeIncidentStatusUpdate,
            openIncidentModal,
            openInstallationConformityModal,
            renderIncidents,
            selectAndUploadIncidentPhoto,
            showIncidentsForInstallation,
            showIncidentsWorkspace,
            sortAssetIncidentsByPriority,
            updateIncidentEvidenceFromWeb,
            updateIncidentStatusFromWeb,
        };
    }

    global.createDashboardIncidents = createDashboardIncidents;
})(window);

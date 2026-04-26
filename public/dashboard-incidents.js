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
        const PUBLIC_TRACKING_URL_INPUT_ID = 'actionPublicTrackingUrl';
        const PUBLIC_TRACKING_URL_LINK_ID = 'actionPublicTrackingLink';
        const PUBLIC_TRACKING_STATUS_ID = 'actionPublicTrackingStatus';
        const PUBLIC_TRACKING_EXPIRES_ID = 'actionPublicTrackingExpires';
        const PUBLIC_TRACKING_SNAPSHOT_ID = 'actionPublicTrackingSnapshot';
        const PUBLIC_TRACKING_COPY_ID = 'actionPublicTrackingCopyBtn';
        const PUBLIC_TRACKING_REVOKE_ID = 'actionPublicTrackingRevokeBtn';
        const CONFORMITY_SIGNATURE_CANVAS_ID = 'actionConformitySignatureCanvas';
        const CONFORMITY_SIGNATURE_CLEAR_ID = 'actionConformitySignatureClearBtn';
        const DEFAULT_COMMERCIAL_CLOSURE_MODE = 'budget_required';
        const COMMERCIAL_CLOSURE_MODE_LABELS = {
            budget_required: 'Requiere presupuesto',
            warranty_included: 'Garantia incluida',
            plan_included: 'Servicio mensual incluido',
            courtesy_included: 'Cortesia comercial',
        };
        let currentConformitySignaturePad = null;
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
        let incidentGoogleMapsLoaderPromise = null;

        function canCurrentUserAuditDeletedIncidents() {
            const role = String(options.getCurrentUser?.()?.role || '').toLowerCase();
            return role === 'super_admin';
        }

        function canCurrentUserManagePublicTracking() {
            if (typeof options.canCurrentUserManagePublicTracking === 'function') {
                return Boolean(options.canCurrentUserManagePublicTracking());
            }
            const role = String(options.getCurrentUser?.()?.role || '').toLowerCase();
            return role === 'admin' || role === 'super_admin' || role === 'platform_owner';
        }

        function canCurrentUserReopenIncidents() {
            if (typeof options.canCurrentUserReopenIncidents === 'function') {
                return Boolean(options.canCurrentUserReopenIncidents());
            }
            const role = String(options.getCurrentUser?.()?.role || '').toLowerCase();
            return role === 'admin' || role === 'supervisor' || role === 'platform_owner' || role === 'super_admin';
        }

        function canCurrentUserViewTenantIncidentMap() {
            if (typeof options.canCurrentUserViewTenantIncidentMap === 'function') {
                return Boolean(options.canCurrentUserViewTenantIncidentMap());
            }
            const role = String(options.getCurrentUser?.()?.role || '').trim().toLowerCase();
            return role === 'admin' || role === 'supervisor' || role === 'solo_lectura'
                || role === 'platform_owner' || role === 'super_admin';
        }

        function shouldUseAssignedIncidentMap() {
            if (typeof options.canCurrentUserOpenIncidentMap === 'function' && !options.canCurrentUserOpenIncidentMap()) {
                return false;
            }
            return !canCurrentUserViewTenantIncidentMap();
        }

        function canCurrentUserWriteOperationalData() {
            if (typeof options.canCurrentUserWriteOperationalData === 'function') {
                return Boolean(options.canCurrentUserWriteOperationalData());
            }

            const role = String(options.getCurrentUser?.()?.role || '').trim().toLowerCase();
            if (role) {
                return role === 'admin'
                    || role === 'supervisor'
                    || role === 'tecnico'
                    || role === 'platform_owner'
                    || role === 'super_admin';
            }

            if (typeof options.canCurrentUserEditAssets === 'function') {
                return Boolean(options.canCurrentUserEditAssets());
            }

            return false;
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

        function hasIncidentDispatchTargetContent(incident) {
            if (!incident || typeof incident !== 'object') return false;
            const textFields = [
                incident.dispatch_place_name,
                incident.dispatch_address,
                incident.dispatch_reference,
                incident.dispatch_contact_name,
                incident.dispatch_contact_phone,
                incident.dispatch_notes,
                incident.target_label,
                incident.target_source,
            ];
            if (textFields.some((value) => String(value || '').trim().length > 0)) {
                return true;
            }
            const targetLat = incident.target_lat;
            const targetLng = incident.target_lng;
            const hasTargetLat = targetLat !== null && targetLat !== undefined && targetLat !== '';
            const hasTargetLng = targetLng !== null && targetLng !== undefined && targetLng !== '';
            return (
                hasTargetLat &&
                hasTargetLng &&
                Number.isFinite(Number(targetLat)) &&
                Number.isFinite(Number(targetLng))
            );
        }

        function hasIncidentDispatchTargetData(incident) {
            if (!incident || typeof incident !== 'object') return false;
            if (incident.dispatch_required === false) {
                return true;
            }
            return hasIncidentDispatchTargetContent(incident);
        }

        function parseDispatchCoordinate(value, fieldLabel) {
            const normalized = String(value || '').trim();
            if (!normalized) return null;
            const parsed = Number(normalized.replace(',', '.'));
            if (!Number.isFinite(parsed)) {
                throw new Error(`Campo "${fieldLabel}" invÃ¡lido.`);
            }
            return parsed;
        }

        function readIncidentDispatchTargetFromModal() {
            const dispatchRequired = document.getElementById('actionIncidentDispatchRequired')?.value !== '0';
            if (!dispatchRequired) {
                return {
                    payload: {
                        dispatch_required: false,
                        target_lat: null,
                        target_lng: null,
                        target_label: null,
                        target_source: null,
                        dispatch_place_name: null,
                        dispatch_address: null,
                        dispatch_reference: null,
                        dispatch_contact_name: null,
                        dispatch_contact_phone: null,
                        dispatch_notes: null,
                    },
                };
            }

            const targetLat = parseDispatchCoordinate(
                document.getElementById('actionIncidentTargetLat')?.value,
                'Latitud',
            );
            const targetLng = parseDispatchCoordinate(
                document.getElementById('actionIncidentTargetLng')?.value,
                'Longitud',
            );

            if ((targetLat === null) !== (targetLng === null)) {
                return {
                    error: 'Latitud y longitud deben completarse juntas o dejarse vacias.',
                };
            }

            return {
                payload: {
                    dispatch_required: true,
                    target_lat: targetLat,
                    target_lng: targetLng,
                    target_label: String(document.getElementById('actionIncidentTargetLabel')?.value || '').trim() || null,
                    target_source: String(document.getElementById('actionIncidentTargetSource')?.value || '').trim() || null,
                    dispatch_place_name: String(document.getElementById('actionIncidentDispatchPlace')?.value || '').trim() || null,
                    dispatch_address: String(document.getElementById('actionIncidentDispatchAddress')?.value || '').trim() || null,
                    dispatch_reference: String(document.getElementById('actionIncidentDispatchReference')?.value || '').trim() || null,
                    dispatch_contact_name: String(document.getElementById('actionIncidentDispatchContactName')?.value || '').trim() || null,
                    dispatch_contact_phone: String(document.getElementById('actionIncidentDispatchContactPhone')?.value || '').trim() || null,
                    dispatch_notes: String(document.getElementById('actionIncidentDispatchNotes')?.value || '').trim() || null,
                },
            };
        }

        function buildIncidentDispatchTargetFields(incident = {}, config = {}) {
            const fragment = document.createDocumentFragment();
            const grid = document.createElement('div');
            grid.className = 'action-modal-grid incident-dispatch-grid';
            const hasExistingData = hasIncidentDispatchTargetContent(incident);
            const collapsible = config?.collapsible === true;
            const hideDispatchRequiredField = config?.hideDispatchRequiredField === true;
            const initialDispatchRequired = typeof config?.defaultDispatchRequired === 'boolean'
                ? config.defaultDispatchRequired
                : incident?.dispatch_required !== false;
            const startCollapsed = collapsible
                && config?.collapsedByDefault === true
                && !hasExistingData
                && incident?.dispatch_required !== false;
            const dispatchRequired = startCollapsed
                ? false
                : (hasExistingData ? true : initialDispatchRequired);

            const dispatchRequiredSelect = document.createElement('select');
            dispatchRequiredSelect.id = 'actionIncidentDispatchRequired';
            dispatchRequiredSelect.appendChild(new Option('Si', '1', dispatchRequired, dispatchRequired));
            dispatchRequiredSelect.appendChild(new Option('No', '0', !dispatchRequired, !dispatchRequired));
            const dispatchRequiredGroup = createInputGroup(
                'Requiere datos de visita',
                dispatchRequiredSelect,
                { htmlFor: dispatchRequiredSelect.id },
            );
            if (hideDispatchRequiredField) {
                dispatchRequiredGroup.classList.add('is-hidden');
                dispatchRequiredGroup.setAttribute('aria-hidden', 'true');
            }
            grid.appendChild(dispatchRequiredGroup);

            const dispatchTouchedInput = document.createElement('input');
            dispatchTouchedInput.type = 'hidden';
            dispatchTouchedInput.id = 'actionIncidentDispatchTouched';
            dispatchTouchedInput.value = '0';
            grid.appendChild(dispatchTouchedInput);

            const dispatchSummaryRow = document.createElement('div');
            dispatchSummaryRow.className = 'incident-dispatch-summary-row full-width';
            dispatchSummaryRow.hidden = !collapsible;
            const dispatchSummaryCopy = document.createElement('div');
            dispatchSummaryCopy.className = 'incident-dispatch-summary-copy';
            const dispatchSummaryTitle = document.createElement('strong');
            dispatchSummaryTitle.className = 'incident-dispatch-summary-title';
            dispatchSummaryTitle.textContent = 'Destino operativo';
            const dispatchSummaryState = document.createElement('span');
            dispatchSummaryState.className = 'incident-dispatch-summary-state';
            dispatchSummaryState.id = 'actionIncidentDispatchSummaryState';
            dispatchSummaryCopy.append(dispatchSummaryTitle, dispatchSummaryState);
            const dispatchToggleButton = document.createElement('button');
            dispatchToggleButton.type = 'button';
            dispatchToggleButton.id = 'actionIncidentDispatchToggle';
            dispatchToggleButton.className = 'incident-dispatch-toggle';
            dispatchToggleButton.setAttribute('aria-controls', 'actionIncidentDispatchFields');
            dispatchSummaryRow.append(dispatchSummaryCopy, dispatchToggleButton);
            grid.appendChild(dispatchSummaryRow);

            const dispatchHelp = document.createElement('p');
            dispatchHelp.className = 'gps-capture-panel-summary incident-dispatch-help full-width';
            dispatchHelp.id = 'actionIncidentDispatchRequiredHelp';
            dispatchHelp.textContent = dispatchRequired
                ? 'Completa destino solo si se requiere visita en sitio.'
                : 'La incidencia queda marcada sin visita en sitio requerida y se limpian los datos de destino operativo.';
            grid.appendChild(dispatchHelp);

            const dispatchFields = document.createElement('div');
            dispatchFields.id = 'actionIncidentDispatchFields';
            dispatchFields.className = 'action-modal-grid full-width incident-dispatch-fields';

            const sourceSelect = document.createElement('select');
            sourceSelect.id = 'actionIncidentTargetSource';
            [
                { value: '', label: 'Sin definir' },
                { value: 'manual_map', label: 'Punto manual' },
                { value: 'reporter_gps', label: 'GPS del reporte' },
                { value: 'installation_gps', label: 'GPS del registro' },
                { value: 'asset_context', label: 'Contexto del equipo' },
                { value: 'mobile_adjustment', label: 'Ajuste mobile' },
            ].forEach((option) => {
                sourceSelect.appendChild(
                    new Option(
                        option.label,
                        option.value,
                        option.value === String(incident?.target_source || '').trim(),
                        option.value === String(incident?.target_source || '').trim(),
                    ),
                );
            });
            dispatchFields.appendChild(createInputGroup('Origen del destino', sourceSelect, { htmlFor: sourceSelect.id }));

            const targetLabelInput = document.createElement('input');
            targetLabelInput.type = 'text';
            targetLabelInput.id = 'actionIncidentTargetLabel';
            targetLabelInput.autocomplete = 'off';
            targetLabelInput.placeholder = 'Ej: ATM-009 acceso principal';
            targetLabelInput.value = String(incident?.target_label || '').trim();
            dispatchFields.appendChild(createInputGroup('Etiqueta visible', targetLabelInput, { htmlFor: targetLabelInput.id }));

            const targetLatInput = document.createElement('input');
            targetLatInput.type = 'text';
            targetLatInput.id = 'actionIncidentTargetLat';
            targetLatInput.autocomplete = 'off';
            targetLatInput.placeholder = '-34.9011';
            targetLatInput.value = incident?.target_lat === null || incident?.target_lat === undefined
                ? ''
                : String(incident.target_lat);
            dispatchFields.appendChild(createInputGroup('Latitud', targetLatInput, { htmlFor: targetLatInput.id }));

            const targetLngInput = document.createElement('input');
            targetLngInput.type = 'text';
            targetLngInput.id = 'actionIncidentTargetLng';
            targetLngInput.autocomplete = 'off';
            targetLngInput.placeholder = '-56.1645';
            targetLngInput.value = incident?.target_lng === null || incident?.target_lng === undefined
                ? ''
                : String(incident.target_lng);
            dispatchFields.appendChild(createInputGroup('Longitud', targetLngInput, { htmlFor: targetLngInput.id }));

            const dispatchPlaceInput = document.createElement('input');
            dispatchPlaceInput.type = 'text';
            dispatchPlaceInput.id = 'actionIncidentDispatchPlace';
            dispatchPlaceInput.autocomplete = 'off';
            dispatchPlaceInput.placeholder = 'Ej: ATM-009';
            dispatchPlaceInput.value = String(incident?.dispatch_place_name || '').trim();
            dispatchFields.appendChild(createInputGroup('Nombre del lugar', dispatchPlaceInput, { htmlFor: dispatchPlaceInput.id }));

            const dispatchAddressInput = document.createElement('input');
            dispatchAddressInput.type = 'text';
            dispatchAddressInput.id = 'actionIncidentDispatchAddress';
            dispatchAddressInput.autocomplete = 'off';
            dispatchAddressInput.placeholder = 'Ej: Av. Italia 2456';
            dispatchAddressInput.value = String(incident?.dispatch_address || '').trim();
            dispatchFields.appendChild(createInputGroup('DirecciÃ³n', dispatchAddressInput, { htmlFor: dispatchAddressInput.id, className: 'full-width' }));

            const dispatchPlacesStatus = document.createElement('p');
            dispatchPlacesStatus.id = 'actionIncidentDispatchPlacesStatus';
            dispatchPlacesStatus.className = 'asset-muted full-width';
            dispatchPlacesStatus.textContent = 'Escribe una direcciÃ³n o usa una sugerencia para completar coordenadas.';
            dispatchFields.appendChild(dispatchPlacesStatus);

            const dispatchReferenceInput = document.createElement('textarea');
            dispatchReferenceInput.id = 'actionIncidentDispatchReference';
            dispatchReferenceInput.rows = 3;
            dispatchReferenceInput.placeholder = 'Referencia de acceso o ubicaciÃ³n interna';
            dispatchReferenceInput.value = String(incident?.dispatch_reference || '').trim();
            dispatchFields.appendChild(createInputGroup('Referencia', dispatchReferenceInput, { htmlFor: dispatchReferenceInput.id, className: 'full-width' }));

            const dispatchContactNameInput = document.createElement('input');
            dispatchContactNameInput.type = 'text';
            dispatchContactNameInput.id = 'actionIncidentDispatchContactName';
            dispatchContactNameInput.autocomplete = 'name';
            dispatchContactNameInput.placeholder = 'Persona de contacto';
            dispatchContactNameInput.value = String(incident?.dispatch_contact_name || '').trim();
            dispatchFields.appendChild(createInputGroup('Contacto', dispatchContactNameInput, { htmlFor: dispatchContactNameInput.id }));

            const dispatchContactPhoneInput = document.createElement('input');
            dispatchContactPhoneInput.type = 'text';
            dispatchContactPhoneInput.id = 'actionIncidentDispatchContactPhone';
            dispatchContactPhoneInput.autocomplete = 'tel';
            dispatchContactPhoneInput.placeholder = '+598...';
            dispatchContactPhoneInput.value = String(incident?.dispatch_contact_phone || '').trim();
            dispatchFields.appendChild(createInputGroup('TelÃ©fono', dispatchContactPhoneInput, { htmlFor: dispatchContactPhoneInput.id }));

            const dispatchNotesInput = document.createElement('textarea');
            dispatchNotesInput.id = 'actionIncidentDispatchNotes';
            dispatchNotesInput.rows = 3;
            dispatchNotesInput.placeholder = 'Notas operativas breves para la visita';
            dispatchNotesInput.value = String(incident?.dispatch_notes || '').trim();
            dispatchFields.appendChild(createInputGroup('Notas para la visita', dispatchNotesInput, { htmlFor: dispatchNotesInput.id, className: 'full-width' }));

            grid.appendChild(dispatchFields);
            const markDispatchTouched = () => {
                dispatchTouchedInput.value = '1';
            };
            const syncDispatchRequiredVisibility = () => {
                const currentRequired = dispatchRequiredSelect.value !== '0';
                if (collapsible) {
                    dispatchFields.hidden = false;
                    dispatchFields.classList.toggle('is-collapsed', !currentRequired);
                    dispatchFields.setAttribute('aria-hidden', currentRequired ? 'false' : 'true');
                } else {
                    dispatchFields.hidden = !currentRequired;
                    dispatchFields.classList.remove('is-collapsed');
                    dispatchFields.setAttribute('aria-hidden', currentRequired ? 'false' : 'true');
                }
                Array.from(dispatchFields.querySelectorAll('input, textarea, select')).forEach((field) => {
                    field.disabled = !currentRequired;
                });
                dispatchHelp.textContent = currentRequired
                    ? 'Completa destino solo si se requiere visita en sitio.'
                    : 'La incidencia queda marcada sin visita en sitio requerida y se limpian los datos de destino operativo.';
                if (collapsible) {
                    dispatchHelp.hidden = !currentRequired;
                    dispatchSummaryState.textContent = currentRequired
                        ? (hasExistingData ? 'con datos' : 'completando')
                        : 'sin datos';
                    dispatchToggleButton.textContent = currentRequired ? 'Ocultar' : '+ Agregar destino';
                    dispatchToggleButton.setAttribute('aria-expanded', currentRequired ? 'true' : 'false');
                }
            };
            dispatchRequiredSelect.addEventListener('change', () => {
                markDispatchTouched();
                syncDispatchRequiredVisibility();
            });
            if (collapsible) {
                dispatchToggleButton.addEventListener('click', () => {
                    const nextRequired = dispatchRequiredSelect.value === '0';
                    dispatchRequiredSelect.value = nextRequired ? '1' : '0';
                    dispatchRequiredSelect.dispatchEvent(new Event('change'));
                    if (nextRequired) {
                        requestAnimationFrame(() => {
                            document.getElementById('actionIncidentDispatchAddress')?.focus();
                        });
                    }
                });
            }
            syncDispatchRequiredVisibility();

            fragment.appendChild(grid);
            return fragment;
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

        function createIncidentMetricItem(label, value, config = {}) {
            const metric = document.createElement('div');
            metric.className = 'incident-metric';
            if (config.metricKey) {
                metric.dataset.metric = String(config.metricKey);
            }
            if (config.tone) {
                metric.dataset.tone = String(config.tone);
            }

            const metricLabel = document.createElement('small');
            metricLabel.className = 'incident-metric-label';
            metricLabel.textContent = label;

            const metricValue = document.createElement('strong');
            metricValue.className = 'incident-metric-value';
            metricValue.textContent = value;
            if (config.metricKey) {
                metricValue.dataset.metric = String(config.metricKey);
            }

            metric.append(metricLabel, metricValue);

            if (config.meta) {
                const meta = document.createElement('small');
                meta.className = 'incident-metric-meta';
                meta.textContent = String(config.meta);
                metric.appendChild(meta);
            }

            return metric;
        }

        function formatIncidentResolvedByMetricValue(incident) {
            const resolvedBy = String(incident?.resolved_by || incident?.status_updated_by || '').trim();
            const resolvedAtText = String(incident?.resolved_at || '').trim();
            if (!resolvedBy && !resolvedAtText) return '--';
            const resolvedAtLabel = resolvedAtText
                ? new Date(resolvedAtText).toLocaleString('es-ES', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                })
                : '';
            return [resolvedBy || 'Sin usuario', resolvedAtLabel].filter(Boolean).join(' Â· ');
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
            highlights.className = 'incident-highlights incident-highlights-quadrants';

            const installationId = options.parseStrictInteger(config.installationId ?? incident?.installation_id);
            const assetId = options.parseStrictInteger(config.assetId ?? incident?.asset_id);
            const statusValue = options.normalizeIncidentStatus(incident?.incident_status);
            const estimatedDurationSeconds = options.resolveIncidentEstimatedDurationSeconds(incident);
            const realDurationSeconds = options.resolveIncidentRealDurationSeconds(incident);
            const runtimeStatusMeta = statusValue === 'in_progress'
                ? 'En curso'
                : statusValue === 'paused'
                    ? 'En pausa'
                    : '';

            const estimatedMetric = createIncidentMetricItem(
                'Estimado',
                estimatedDurationSeconds > 0 ? options.formatDuration(estimatedDurationSeconds) : '--',
                {
                    metricKey: 'estimated',
                    tone: estimatedDurationSeconds > 0 ? 'accent' : 'neutral',
                },
            );
            highlights.appendChild(estimatedMetric);

            const runtimeMetric = createIncidentMetricItem(
                'Real',
                Number.isInteger(realDurationSeconds) && realDurationSeconds >= 0
                    ? options.formatDuration(realDurationSeconds)
                    : '--',
                {
                    metricKey: 'runtime',
                    tone: statusValue === 'resolved' ? 'resolved' : statusValue,
                    meta: runtimeStatusMeta,
                },
            );
            const runtimeMetricValue = runtimeMetric.querySelector('.incident-metric-value[data-metric="runtime"]');
            if (
                runtimeMetricValue instanceof HTMLElement
                && Number.isInteger(realDurationSeconds)
                && realDurationSeconds >= 0
                && statusValue === 'in_progress'
            ) {
                const runtimeStartMs = options.resolveIncidentRuntimeStartMs(incident);
                if (Number.isFinite(runtimeStartMs) && runtimeStartMs > 0) {
                    runtimeMetricValue.dataset.runtimeLive = '1';
                    runtimeMetricValue.dataset.runtimeStartMs = String(runtimeStartMs);
                    runtimeMetricValue.dataset.runtimeBaseSeconds = String(
                        Math.max(0, Number(incident?.actual_duration_seconds || 0) || 0),
                    );
                    options.ensureIncidentRuntimeTicker();
                }
            }
            highlights.appendChild(runtimeMetric);

            const resolvedMetric = createIncidentMetricItem(
                'Resuelta por',
                formatIncidentResolvedByMetricValue(incident),
                {
                    metricKey: 'resolved-by',
                    tone: statusValue === 'resolved' ? 'resolved' : 'neutral',
                },
            );
            highlights.appendChild(resolvedMetric);

            if (
                (!Number.isInteger(installationId) || installationId <= 0)
                && (!Number.isInteger(assetId) || assetId <= 0)
            ) {
                const contextHint = document.createElement('small');
                contextHint.className = 'incident-metrics-note asset-muted';
                contextHint.textContent = 'Contexto automatico';
                highlights.appendChild(contextHint);
            }

            parent.appendChild(highlights);
        }

        const incidentMapModule = global.createDashboardIncidentsMap({
            options,
            INCIDENT_MAP_DEFAULT_DAYS,
            INCIDENT_MAP_DEFAULT_LIMIT,
            INCIDENT_MAP_ALLOWED_DAYS,
            INCIDENT_MAP_DEFAULT_CENTER,
            get incidentMapState() { return incidentMapState; },
            set incidentMapState(value) { incidentMapState = value; },
            get incidentMapRequestVersion() { return incidentMapRequestVersion; },
            set incidentMapRequestVersion(value) { incidentMapRequestVersion = value; },
            get incidentGoogleMapsLoaderPromise() { return incidentGoogleMapsLoaderPromise; },
            set incidentGoogleMapsLoaderPromise(value) { incidentGoogleMapsLoaderPromise = value; },
            canCurrentUserManagePublicTracking,
            canCurrentUserViewTenantIncidentMap,
            shouldUseAssignedIncidentMap,
            canCurrentUserWriteOperationalData,
            runIncidentRefreshInBackground,
            applyVisibleIncidentUpdate,
        });
        const {
            bindIncidentMapControls,
            bindIncidentDispatchPlacesAutocomplete,
            buildIncidentMapsUrl,
            ensureAssignedIncidentMapDefaults,
            formatIncidentCoordinateLine,
            loadIncidentMap,
            openPublicTrackingModal,
            renderIncidentMap,
            resolveIncidentOperationalCoordinates,
        } = incidentMapModule;


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
                const detail = technician.employee_code ? ` Â· ${technician.employee_code}` : '';
                select.appendChild(new Option(`${technician.display_name}${detail}`, technician.display_name || ''));
            });

            applyTechnicianSelectPreference(select, preferredTechnicianNames);
            select.addEventListener('change', () => {
                select.dataset.userSelected = '1';
            });
            return select;
        }

        function createGpsCapturePanel({ panelId, statusId, summaryId, buttonId, compact = false }) {
            const wrapper = document.createElement('div');
            wrapper.id = panelId;
            wrapper.className = 'gps-capture-panel';
            if (compact) {
                wrapper.classList.add('gps-capture-panel-compact');
                wrapper.dataset.gpsMode = 'compact';
            }
            wrapper.dataset.gpsState = 'pending';

            const header = document.createElement('div');
            header.className = 'gps-capture-panel-header';

            const copyWrap = document.createElement('div');
            copyWrap.className = 'gps-capture-panel-copy';

            const title = document.createElement('strong');
            title.className = 'gps-capture-panel-title';
            title.textContent = compact ? 'GPS' : 'Ubicacion puntual';

            const status = document.createElement('span');
            status.id = statusId;
            status.className = 'gps-capture-panel-status';
            status.textContent = 'Capturando ubicaciÃ³n puntual...';

            copyWrap.append(title, status);

            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.id = buttonId;
            retryButton.className = compact ? 'btn-secondary gps-capture-panel-inline-retry' : 'btn-secondary';
            retryButton.textContent = compact ? 'Reintentar' : 'Capturar ubicaciÃ³n';

            header.append(copyWrap, retryButton);

            const summary = document.createElement('p');
            summary.id = summaryId;
            summary.className = 'gps-capture-panel-summary';
            summary.textContent = compact
                ? 'Sin precision disponible.'
                : 'Intentamos obtener una ubicaciÃ³n puntual para este formulario. No bloquea el guardado.';

            wrapper.append(header, summary);
            return wrapper;
        }

        function countActiveIncidents(incidents) {
            return (Array.isArray(incidents) ? incidents : []).filter((incident) => {
                if (String(incident?.deleted_at || '').trim()) return false;
                return options.normalizeIncidentStatus(incident?.incident_status) !== 'resolved';
            }).length;
        }

        const incidentCommercialModule = global.createDashboardIncidentsCommercial({
            options,
            createInputGroup,
            buildTechnicianSelect,
            createGpsCapturePanel,
            hydrateTechnicianSelectFromContext,
            runIncidentRefreshInBackground,
        });
        const {
            applyConformityButtonState,
            applyClosureBannerState,
            buildConformityHelperText,
            applyCreateIncidentButtonState,
            createConformityStatusChip,
            formatCurrencyFromCents,
            formatBudgetApprovalStatusLabel,
            formatBudgetDeliveryStatusLabel,
            formatActiveIncidentsLabel,
            formatBudgetGeneratedAt,
            formatCommercialClosureModeLabel,
            formatConformityGeneratedAt,
            formatConformityStatusLabel,
            isBudgetRequiredForCommercialClosure,
            normalizeCommercialClosureMode,
            openInstallationBudgetApprovalModal,
            openInstallationBudgetModal,
            openInstallationCommercialClosureModal,
            openInstallationConformityModal,
            resolveInstallationCommercialClosure,
            syncVisibleIncidentsHeaderState,
        } = incidentCommercialModule;

        function buildIncidentCreateFields({
            defaultApply,
            defaultEstimatedDurationSeconds,
            defaultInstallationId,
            defaultNote,
            defaultSeverity,
            isAssetContext,
        }) {
            const fragment = document.createDocumentFragment();
            const form = document.createElement('div');
            form.className = 'incident-create-form';
            const grid = document.createElement('div');
            grid.className = 'action-modal-grid incident-create-essential-grid';

            const installationInput = document.createElement('input');
            installationInput.type = 'text';
            installationInput.id = 'actionIncidentInstallationId';
            installationInput.value = defaultInstallationId;
            installationInput.autocomplete = 'off';
            installationInput.placeholder = isAssetContext
                ? 'Opcional. Se usa vÃ­nculo activo o se crea contexto automÃ¡tico'
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
            grid.appendChild(createInputGroup('TÃ©cnico responsable', technicianSelect, { htmlFor: technicianSelect.id }));

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

            const essentialsSection = document.createElement('section');
            essentialsSection.className = 'incident-create-section';
            essentialsSection.appendChild(grid);
            form.appendChild(essentialsSection);

            const dispatchSection = document.createElement('section');
            dispatchSection.className = 'incident-create-section';
            dispatchSection.appendChild(buildIncidentDispatchTargetFields({}, {
                collapsible: true,
                collapsedByDefault: true,
                defaultDispatchRequired: false,
                hideDispatchRequiredField: true,
            }));
            form.appendChild(dispatchSection);

            const gpsSection = document.createElement('section');
            gpsSection.className = 'incident-create-section incident-create-gps-section';
            gpsSection.appendChild(createGpsCapturePanel({
                panelId: 'actionIncidentGpsPanel',
                statusId: 'actionIncidentGpsStatus',
                summaryId: 'actionIncidentGpsSummary',
                buttonId: 'actionIncidentGpsRetryBtn',
                compact: true,
            }));
            form.appendChild(gpsSection);

            const applyLabel = document.createElement('label');
            applyLabel.className = 'action-checkbox';
            applyLabel.setAttribute('for', 'actionIncidentApplyToRecord');
            const applyCheckbox = document.createElement('input');
            applyCheckbox.type = 'checkbox';
            applyCheckbox.id = 'actionIncidentApplyToRecord';
            applyCheckbox.checked = defaultApply;
            const applyCopy = document.createElement('span');
            applyCopy.textContent = 'Aplicar nota y tiempo al registro de instalaciÃ³n.';
            applyLabel.append(applyCheckbox, applyCopy);
            const applySection = document.createElement('section');
            applySection.className = 'incident-create-section incident-create-footer';
            applySection.appendChild(applyLabel);
            form.appendChild(applySection);

            fragment.appendChild(form);

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
            customChecklistTextarea.placeholder = 'Ej: Foto del serial\nValidaciÃ³n con supervisor';
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
            resolutionNoteTextarea.placeholder = 'Resumen de la soluciÃ³n aplicada';
            resolutionNoteTextarea.value = defaultNote;
            return createInputGroup(
                'Nota de resoluciÃ³n (opcional)',
                resolutionNoteTextarea,
                { htmlFor: 'actionIncidentResolutionNote' },
            );
        }

        function appendIncidentDispatchTargetSummary(parent, incident) {
            const summary = document.createElement('div');
            summary.className = 'incident-evidence-block incident-secondary-panel incident-dispatch-block';

            const title = document.createElement('small');
            title.className = 'asset-muted';
            title.textContent = 'Destino operativo';
            summary.appendChild(title);

            if (incident?.dispatch_required === false) {
                const primary = document.createElement('strong');
                primary.className = 'incident-context-primary';
                primary.textContent = 'Sin despacho en sitio requerido';
                summary.appendChild(primary);

                const helpLine = document.createElement('small');
                helpLine.className = 'asset-muted incident-meta-line';
                helpLine.textContent = 'No se solicitaron direcciÃ³n, referencia ni coordenadas operativas para esta incidencia.';
                summary.appendChild(helpLine);

                const chips = document.createElement('div');
                chips.className = 'incident-checklist-list';
                chips.appendChild(createIncidentHighlightChip('Sin visita en sitio', 'info'));
                summary.appendChild(chips);

                parent.appendChild(summary);
                return;
            }

            const placeName = String(incident?.dispatch_place_name || incident?.target_label || '').trim();
            const address = String(incident?.dispatch_address || '').trim();
            const reference = String(incident?.dispatch_reference || '').trim();
            const contactName = String(incident?.dispatch_contact_name || '').trim();
            const contactPhone = String(incident?.dispatch_contact_phone || '').trim();
            const notes = String(incident?.dispatch_notes || '').trim();
            const targetSource = String(incident?.target_source || '').trim();
            const hasCoordinates =
                Number.isFinite(Number(incident?.target_lat)) &&
                Number.isFinite(Number(incident?.target_lng));

            const primary = document.createElement('strong');
            primary.className = 'incident-context-primary';
            primary.textContent = placeName || 'Sin destino operativo definido';
            summary.appendChild(primary);

            if (address) {
                const addressLine = document.createElement('small');
                addressLine.className = 'asset-muted incident-meta-line';
                addressLine.textContent = address;
                summary.appendChild(addressLine);
            } else {
                const missingAddress = document.createElement('small');
                missingAddress.className = 'asset-muted incident-meta-line';
                missingAddress.textContent = 'Falta direcciÃ³n legible para la visita';
                summary.appendChild(missingAddress);
            }

            if (reference) {
                const referenceLine = document.createElement('small');
                referenceLine.className = 'asset-muted incident-meta-line';
                referenceLine.textContent = `Referencia: ${reference}`;
                summary.appendChild(referenceLine);
            }

            if (contactName || contactPhone) {
                const contactLine = document.createElement('small');
                contactLine.className = 'asset-muted incident-meta-line';
                contactLine.textContent = `Contacto: ${[contactName, contactPhone].filter(Boolean).join(' | ')}`;
                summary.appendChild(contactLine);
            }

            if (notes) {
                const notesLine = document.createElement('small');
                notesLine.className = 'asset-muted incident-meta-line';
                notesLine.textContent = `Notas: ${notes}`;
                summary.appendChild(notesLine);
            }

            const chips = document.createElement('div');
            chips.className = 'incident-checklist-list';
            chips.appendChild(
                createIncidentHighlightChip(
                    hasCoordinates ? 'Con coordenadas operativas' : 'Sin coordenadas operativas',
                    hasCoordinates ? 'resolved' : 'warning',
                ),
            );
            if (targetSource) {
                chips.appendChild(createIncidentHighlightChip(`Origen: ${targetSource}`, 'info'));
            }
            if (!address || !reference) {
                chips.appendChild(createIncidentHighlightChip('InformaciÃ³n de visita incompleta', 'warning'));
            }
            summary.appendChild(chips);

            parent.appendChild(summary);
        }

        function appendIncidentResolutionSummary(parent, incident) {
            const statusValue = options.normalizeIncidentStatus(incident?.incident_status);
            const resolutionNote = String(incident?.resolution_note || '').trim();

            const resolutionPanel = document.createElement('div');
            resolutionPanel.className = 'incident-resolution-panel incident-secondary-panel';
            resolutionPanel.dataset.panelRole = 'resolution';
            resolutionPanel.dataset.status = statusValue;

            const resolutionHeader = document.createElement('div');
            resolutionHeader.className = 'incident-resolution-header';

            const resolutionLabel = document.createElement('small');
            resolutionLabel.className = 'asset-muted';
            resolutionLabel.textContent = 'ResoluciÃ³n';

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
            resolutionBody.textContent = resolutionNote || 'Sin nota de resoluciÃ³n.';

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

            const fragmentHost = document.createElement('div');
            appendIncidentResolutionSummary(fragmentHost, incident);
            const resolutionPanel = fragmentHost.firstElementChild;
            if (!(resolutionPanel instanceof HTMLElement)) return;

            const secondaryGrid = card.querySelector('.incident-secondary-grid');
            if (secondaryGrid instanceof HTMLElement) {
                secondaryGrid.appendChild(resolutionPanel);
                return;
            }

            const anchor = card.querySelector('.incident-actions');
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

        function isIncidentButtonElement(element) {
            return element instanceof HTMLElement && element.tagName === 'BUTTON';
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
            const statusGroup = document.createElement('div');
            statusGroup.className = 'incident-actions-group incident-actions-group-status';
            const actionsSpacer = document.createElement('div');
            actionsSpacer.className = 'incident-actions-spacer';
            const utilityGroup = document.createElement('div');
            utilityGroup.className = 'incident-actions-group incident-actions-group-utility';
            const incidentStatus = options.normalizeIncidentStatus(incident.incident_status);
            const canUpdateIncident = canCurrentUserWriteOperationalData() && !isSoftDeleted;
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
                    button.title = 'Solo roles operativos pueden cambiar estado de incidencias';
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
                evidenceBtn.title = 'Solo roles operativos pueden actualizar evidencia';
            }
            evidenceBtn.addEventListener('click', () => {
                const liveIncident = evidenceBtn.closest('.incident-card')?.__incidentData || incident;
                void updateIncidentEvidenceFromWeb(liveIncident, updateOptions);
            });

            const dispatchBtn = document.createElement('button');
            dispatchBtn.type = 'button';
            dispatchBtn.className = 'btn-secondary';
            decorateIncidentActionButton(dispatchBtn, 'dispatch', 'Destino', 'place');
            dispatchBtn.disabled = !canUpdateIncident;
            if (!canUpdateIncident) {
                dispatchBtn.title = 'Solo roles operativos pueden editar destino operativo';
            }
            dispatchBtn.addEventListener('click', () => {
                const liveIncident = dispatchBtn.closest('.incident-card')?.__incidentData || incident;
                void updateIncidentDispatchTargetFromWeb(liveIncident, updateOptions);
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

            statusGroup.append(
                makeStatusBtn('open'),
                makeStatusBtn('in_progress'),
                makeStatusBtn('paused'),
                makeStatusBtn('resolved'),
            );
            utilityGroup.append(
                dispatchBtn,
                evidenceBtn,
            );
            if (deleteBtn) utilityGroup.append(deleteBtn);
            statusActions.append(statusGroup, actionsSpacer, utilityGroup);
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
            const utilityGroup = parent.querySelector('.incident-actions-group-utility');
            if (utilityGroup instanceof HTMLElement) {
                utilityGroup.appendChild(uploadPhotoBtn);
                return;
            }
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
            evidenceWrap.className = 'incident-evidence-block incident-secondary-panel';

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
            card.querySelectorAll('.incident-evidence-block:not(.incident-dispatch-block)').forEach((block) => {
                block.remove();
            });

            const fragmentHost = document.createElement('div');
            appendIncidentEvidenceSummary(fragmentHost, incident);
            const evidenceBlock = fragmentHost.firstElementChild;
            if (!(evidenceBlock instanceof HTMLElement)) return;

            const secondaryGrid = card.querySelector('.incident-secondary-grid');
            if (secondaryGrid instanceof HTMLElement) {
                secondaryGrid.appendChild(evidenceBlock);
                return;
            }

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

        function syncIncidentDispatchTargetSummary(card, incident) {
            if (!(card instanceof HTMLElement)) return;
            card.querySelectorAll('.incident-dispatch-block').forEach((block) => {
                block.remove();
            });

            const fragmentHost = document.createElement('div');
            appendIncidentDispatchTargetSummary(fragmentHost, incident);
            const dispatchBlock = fragmentHost.firstElementChild;
            if (!(dispatchBlock instanceof HTMLElement)) return;

            const secondaryGrid = card.querySelector('.incident-secondary-grid');
            if (secondaryGrid instanceof HTMLElement) {
                secondaryGrid.appendChild(dispatchBlock);
                return;
            }

            const evidenceBlock = card.querySelector('.incident-evidence-block:not(.incident-dispatch-block)');
            if (evidenceBlock instanceof HTMLElement) {
                evidenceBlock.insertAdjacentElement('beforebegin', dispatchBlock);
                return;
            }

            const highlights = card.querySelector('.incident-highlights');
            if (highlights instanceof HTMLElement) {
                highlights.insertAdjacentElement('afterend', dispatchBlock);
                return;
            }

            const anchor = card.querySelector('.incident-resolution-panel[data-panel-role="resolution"], .incident-actions');
            if (anchor instanceof HTMLElement) {
                card.insertBefore(dispatchBlock, anchor);
                return;
            }

            card.appendChild(dispatchBlock);
        }

        function applyVisibleIncidentUpdate(incident) {
            const incidentId = options.parseStrictInteger(incident?.id);
            if (!Number.isInteger(incidentId) || incidentId <= 0) return;

            const cards = document.querySelectorAll(`.incident-card[data-incident-id="${incidentId}"]`);
            if (!cards.length) return;

            const statusValue = options.normalizeIncidentStatus(incident?.incident_status);
            const severityValue = options.normalizeSeverity(incident?.severity || 'medium');
            const canUpdateIncident = canCurrentUserWriteOperationalData();
            const estimatedDurationSeconds = options.resolveIncidentEstimatedDurationSeconds(incident);
            const estimatedMetricText = estimatedDurationSeconds > 0
                ? options.formatDuration(estimatedDurationSeconds)
                : '';
            const realDurationSeconds = options.resolveIncidentRealDurationSeconds(incident);
            const runtimeValueText = Number.isInteger(realDurationSeconds) && realDurationSeconds >= 0
                ? options.formatDuration(realDurationSeconds)
                : '';
            const runtimeMetaText = statusValue === 'in_progress'
                ? 'En curso'
                : statusValue === 'paused'
                    ? 'En pausa'
                    : '';
            const resolvedByMetricText = formatIncidentResolvedByMetricValue(incident);

            cards.forEach((card) => {
                if (!(card instanceof HTMLElement)) return;
                card.dataset.status = statusValue;
                card.dataset.severity = severityValue;
                card.dataset.updating = 'false';
                const statusLabel = options.incidentStatusLabel(statusValue);
                let liveStatusLabel = card.querySelector('[data-role="incident-live-status-label"]');
                if (!(liveStatusLabel instanceof HTMLElement)) {
                    liveStatusLabel = document.createElement('span');
                    liveStatusLabel.dataset.role = 'incident-live-status-label';
                    liveStatusLabel.style.position = 'absolute';
                    liveStatusLabel.style.width = '1px';
                    liveStatusLabel.style.height = '1px';
                    liveStatusLabel.style.overflow = 'hidden';
                    liveStatusLabel.style.clip = 'rect(0 0 0 0)';
                    card.prepend(liveStatusLabel);
                }
                liveStatusLabel.textContent = [statusLabel, runtimeMetaText].filter(Boolean).join(' ');
                card.__incidentData = buildLiveIncidentCardState(incident, {
                    installationId: options.parseStrictInteger(incident?.installation_id),
                    assetId: options.parseStrictInteger(incident?.asset_id),
                });
                const statusStrip = card.querySelector('.incident-status-strip');
                if (statusStrip instanceof HTMLElement) {
                    statusStrip.dataset.status = statusValue;
                    statusStrip.dataset.severity = card.dataset.severity || 'medium';
                }
                syncIncidentDispatchTargetSummary(card, incident);
                syncIncidentEvidenceSummary(card, incident);
                syncIncidentResolutionPanel(card, incident);
                syncVisibleIncidentsHeaderState();

                const statusBadge = card.querySelector('.incident-status-badge');
                if (statusBadge instanceof HTMLElement) {
                    statusBadge.className = `badge incident-status-badge attention-${statusValue}`;
                    options.setElementTextWithMaterialIcon(
                        statusBadge,
                        options.recordAttentionStateIconName(statusValue),
                        statusLabel,
                    );
                    statusBadge.setAttribute('aria-label', statusLabel);
                    if (!statusBadge.textContent.includes(statusLabel)) {
                        statusBadge.textContent = statusLabel;
                    }
                }

                const severityBadge = card.querySelector('.incident-status-strip .badge:not(.incident-status-badge)');
                if (severityBadge instanceof HTMLElement) {
                    severityBadge.className = `badge ${severityValue}`;
                    options.setElementTextWithMaterialIcon(
                        severityBadge,
                        getSeverityIconName(incident?.severity),
                        String(incident?.severity || 'medium').toUpperCase(),
                    );
                }

                const estimatedMetricValue = card.querySelector('.incident-metric-value[data-metric="estimated"]');
                if (estimatedMetricValue instanceof HTMLElement) {
                    estimatedMetricValue.textContent = estimatedMetricText || '--';
                }

                const runtimeMetricValue = card.querySelector('.incident-metric-value[data-metric="runtime"]');
                if (runtimeMetricValue instanceof HTMLElement) {
                    runtimeMetricValue.textContent = runtimeValueText || '--';
                    const runtimeMetric = runtimeMetricValue.closest('.incident-metric');
                    if (runtimeMetric instanceof HTMLElement) {
                        runtimeMetric.dataset.tone = statusValue === 'resolved' ? 'resolved' : statusValue;
                        let runtimeMeta = runtimeMetric.querySelector('.incident-metric-meta');
                        if (runtimeMetaText) {
                            if (!(runtimeMeta instanceof HTMLElement)) {
                                runtimeMeta = document.createElement('small');
                                runtimeMeta.className = 'incident-metric-meta';
                                runtimeMetric.appendChild(runtimeMeta);
                            }
                            runtimeMeta.textContent = runtimeMetaText;
                            runtimeMeta.hidden = false;
                        } else if (runtimeMeta instanceof HTMLElement) {
                            runtimeMeta.textContent = '';
                            runtimeMeta.hidden = true;
                        }
                    }
                    if (runtimeValueText && statusValue === 'in_progress') {
                        const runtimeStartMs = options.resolveIncidentRuntimeStartMs(incident);
                        if (Number.isFinite(runtimeStartMs) && runtimeStartMs > 0) {
                            runtimeMetricValue.dataset.runtimeLive = '1';
                            runtimeMetricValue.dataset.runtimeStartMs = String(runtimeStartMs);
                            runtimeMetricValue.dataset.runtimeBaseSeconds = String(
                                Math.max(0, Number(incident?.actual_duration_seconds || 0) || 0),
                            );
                            options.ensureIncidentRuntimeTicker();
                        }
                    } else {
                        delete runtimeMetricValue.dataset.runtimeLive;
                        delete runtimeMetricValue.dataset.runtimeStartMs;
                        delete runtimeMetricValue.dataset.runtimeBaseSeconds;
                    }
                }

                const resolvedMetricValue = card.querySelector('.incident-metric-value[data-metric="resolved-by"]');
                if (resolvedMetricValue instanceof HTMLElement) {
                    resolvedMetricValue.textContent = resolvedByMetricText;
                }

                ['open', 'in_progress', 'paused', 'resolved'].forEach((targetStatus) => {
                    const actionBtn = card.querySelector(`.incident-action-btn[data-action="${targetStatus}"]`);
                    if (!isIncidentButtonElement(actionBtn)) return;
                    const actionMeta = buildIncidentStatusActionMeta(statusValue, targetStatus);
                    decorateIncidentActionButton(actionBtn, targetStatus, actionMeta.label, actionMeta.icon);
                    actionBtn.dataset.current = statusValue === targetStatus ? 'true' : 'false';
                    actionBtn.disabled = !canUpdateIncident || statusValue === targetStatus;
                    if (!canUpdateIncident) {
                        actionBtn.title = 'Solo roles operativos pueden cambiar estado de incidencias';
                    } else {
                        actionBtn.removeAttribute('title');
                    }
                });
                if (statusValue === 'paused') {
                    const resumeBtn = card.querySelector('.incident-action-btn[data-action="in_progress"]');
                    if (isIncidentButtonElement(resumeBtn) && !resumeBtn.textContent.includes('Reanudar')) {
                        decorateIncidentActionButton(resumeBtn, 'in_progress', 'Reanudar', 'play_circle');
                    }
                }
            });

            upsertIncidentInMapState(incident);
            if (options.isSectionActive?.('incidentMap')) {
                renderIncidentMap();
            }
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
                    if (!isIncidentButtonElement(button)) return;
                    if (isUpdating) {
                        button.disabled = true;
                        return;
                    }
                    const targetStatus = String(button.dataset.action || '').trim();
                    if (['open', 'in_progress', 'paused', 'resolved'].includes(targetStatus)) {
                        const isReopenAction = currentStatus === 'resolved' && targetStatus !== 'resolved';
                        button.disabled =
                            !canCurrentUserWriteOperationalData()
                            || currentStatus === targetStatus
                            || (isReopenAction && !canCurrentUserReopenIncidents());
                    } else if (targetStatus === 'evidence') {
                        button.disabled = !canCurrentUserWriteOperationalData();
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

            select.replaceChildren(new Option('Todos los tÃ©cnicos', ''));
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

            const createdAt = document.createElement('small');
            createdAt.className = 'asset-muted incident-status-strip-time';
            createdAt.textContent = formatIncidentCreatedAtText(incident?.created_at);

            const statusStrip = document.createElement('div');
            statusStrip.className = 'incident-status-strip';
            statusStrip.dataset.status = statusValue;
            statusStrip.dataset.severity = severityValue;

            const statusStripMain = document.createElement('div');
            statusStripMain.className = 'incident-status-strip-main';
            statusStripMain.append(severityBadge, statusBadge, incidentRef);

            statusStrip.append(statusStripMain, createdAt);
            incidentCard.appendChild(statusStrip);

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
                assignedLine.textContent = 'TÃ©cnico asignado: ';
                const assignedStrong = document.createElement('strong');
                assignedStrong.textContent = assignedTechnicianNames.join(', ');
                assignedLine.appendChild(assignedStrong);
                headingBlock.appendChild(assignedLine);
            }

            if (headingBlock.childElementCount > 0) {
                incidentHeader.append(headingBlock);
                incidentCard.appendChild(incidentHeader);
            }

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

            const secondaryGrid = document.createElement('div');
            secondaryGrid.className = 'incident-secondary-grid';
            incidentCard.appendChild(secondaryGrid);

            appendIncidentDispatchTargetSummary(secondaryGrid, incident);

            if (typeof options.renderEntityTechnicianAssignmentsPanel === 'function') {
                const incidentTechniciansPanel = await options.renderEntityTechnicianAssignmentsPanel({
                    entityType: 'incident',
                    entityId: incidentId,
                    entityLabel: `incidencia #${incidentId}`,
                    title: 'Responsables de la incidencia',
                    emptyText: 'Sin tÃ©cnicos asignados directamente a esta incidencia.',
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
                if (incidentTechniciansPanel instanceof HTMLElement) {
                    incidentTechniciansPanel.classList.add('incident-secondary-panel', 'incident-responsible-block');
                    secondaryGrid.appendChild(incidentTechniciansPanel);
                }
            }

            appendIncidentEvidenceSummary(secondaryGrid, incident);
            appendIncidentResolutionSummary(secondaryGrid, incident);

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
                deletedLabel.textContent = 'AuditorÃ­a';

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
            let latestBudget = null;
            let latestApprovedBudget = null;
            try {
                const [conformityResult, budgetResult] = await Promise.all([
                    options.api.getInstallationConformity(installationId).catch(() => null),
                    options.api.getInstallationBudgetLatest(installationId).catch(() => null),
                ]);
                latestConformity = conformityResult?.conformity || null;
                latestBudget = budgetResult?.latest_budget || null;
                latestApprovedBudget = budgetResult?.latest_approved_budget || null;
            } catch {
                latestConformity = null;
                latestBudget = null;
                latestApprovedBudget = null;
            }
            if (renderSequence !== incidentsRenderSequence) {
                return;
            }
            const targetInstallation = options.getInstallationById?.(installationId) || null;
            const commercialClosure = resolveInstallationCommercialClosure(targetInstallation);
            const requiresApprovedBudget = commercialClosure.requiresApprovedBudget;

            const header = document.createElement('div');
            header.className = 'incidents-header';
            header.dataset.installationId = String(options.parseStrictInteger(installationId) || '');
            header.dataset.activeIncidentCount = String(activeIncidentCount);
            header.dataset.latestConformityStatus = String(latestConformity?.status || '').trim().toLowerCase();
            header.dataset.hasApprovedBudget = latestApprovedBudget ? '1' : '';
            header.dataset.requiresApprovedBudget = requiresApprovedBudget ? '1' : '0';
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
            headerMeta.appendChild(
                createConformityStatusChip(
                    `Cobertura: ${commercialClosure.label}`,
                    requiresApprovedBudget ? 'neutral' : 'resolved',
                ),
            );
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
            if (latestBudget) {
                headerMeta.appendChild(
                    createConformityStatusChip(
                        `Presupuesto: ${latestBudget.budget_number || `#${latestBudget.id}`}`,
                        'info',
                    ),
                );
                headerMeta.appendChild(
                    createConformityStatusChip(
                        `${formatBudgetApprovalStatusLabel(latestBudget.approval_status)} Â· ${formatBudgetDeliveryStatusLabel(latestBudget.delivery_status)}`,
                        latestBudget.approval_status === 'approved' ? 'resolved' : 'warning',
                    ),
                );
            } else {
                headerMeta.appendChild(
                    createConformityStatusChip(
                        requiresApprovedBudget
                            ? 'Sin presupuesto'
                            : 'Sin presupuesto (no requerido)',
                        requiresApprovedBudget ? 'warning' : 'resolved',
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

            if (latestBudget || latestApprovedBudget) {
                const budgetSummary = document.createElement('div');
                budgetSummary.className = 'incidents-conformity-summary';

                const budgetSummaryLabel = document.createElement('small');
                budgetSummaryLabel.className = 'incidents-conformity-summary-label';
                budgetSummaryLabel.textContent = 'Estado de presupuesto';

                const budgetSummaryPrimary = document.createElement('strong');
                budgetSummaryPrimary.className = 'incidents-conformity-summary-primary';
                budgetSummaryPrimary.textContent = latestBudget
                    ? `${latestBudget.budget_number || `#${latestBudget.id}`} Â· ${formatBudgetApprovalStatusLabel(latestBudget.approval_status)}`
                    : 'Sin presupuesto generado';

                const budgetSummaryMeta = document.createElement('div');
                budgetSummaryMeta.className = 'incidents-conformity-summary-meta';
                if (latestBudget) {
                    budgetSummaryMeta.appendChild(
                        createConformityStatusChip(
                            formatBudgetGeneratedAt(latestBudget.created_at),
                            'neutral',
                        ),
                    );
                    budgetSummaryMeta.appendChild(
                        createConformityStatusChip(
                            formatCurrencyFromCents(latestBudget.total_amount_cents, latestBudget.currency_code || 'UYU'),
                            'info',
                        ),
                    );
                }
                if (latestApprovedBudget) {
                    budgetSummaryMeta.appendChild(
                        createConformityStatusChip(
                            `Aprobado: ${latestApprovedBudget.budget_number || `#${latestApprovedBudget.id}`}`,
                            'resolved',
                        ),
                    );
                }
                budgetSummary.append(
                    budgetSummaryLabel,
                    budgetSummaryPrimary,
                    budgetSummaryMeta,
                );
                if (latestBudget?.pdf_download_path) {
                    const budgetSummaryLink = document.createElement('a');
                    budgetSummaryLink.href = latestBudget.pdf_download_path;
                    budgetSummaryLink.target = '_blank';
                    budgetSummaryLink.rel = 'noreferrer';
                    budgetSummaryLink.className = 'conformity-modal-link';
                    budgetSummaryLink.textContent = 'Descargar Ãºltimo presupuesto';
                    budgetSummary.appendChild(budgetSummaryLink);
                }
                closureBanner.appendChild(budgetSummary);
            }

            applyClosureBannerState(
                closureBanner,
                activeIncidentCount,
                latestConformity?.status,
                Boolean(latestApprovedBudget),
                requiresApprovedBudget,
            );
            headerMain.appendChild(closureBanner);

            const backButton = document.createElement('button');
            backButton.type = 'button';
            backButton.className = 'btn-secondary incidents-action-button incidents-action-button-quiet';
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
                        subtitle: 'Este registro ya quedÃ³ listo para conformidad. Crear una nueva incidencia vuelve a abrir el trabajo operativo.',
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

            const budgetBtn = document.createElement('button');
            budgetBtn.type = 'button';
            budgetBtn.className = 'btn-secondary incidents-action-button';
            budgetBtn.dataset.role = 'budget-trigger';
            const budgetIcon = options.createMaterialIconNode('request_quote');
            if (budgetIcon) {
                budgetBtn.replaceChildren(budgetIcon, document.createTextNode(' Presupuesto'));
            } else {
                budgetBtn.textContent = 'Presupuesto';
            }
            budgetBtn.addEventListener('click', () => {
                void openInstallationBudgetModal(installationId, {
                    budgetState: {
                        latest_budget: latestBudget,
                        latest_approved_budget: latestApprovedBudget,
                    },
                });
            });

            const approveBudgetBtn = document.createElement('button');
            approveBudgetBtn.type = 'button';
            approveBudgetBtn.className = 'btn-secondary incidents-action-button';
            approveBudgetBtn.dataset.role = 'budget-approve-trigger';
            const approveBudgetIcon = options.createMaterialIconNode('task_alt');
            if (approveBudgetIcon) {
                approveBudgetBtn.replaceChildren(approveBudgetIcon, document.createTextNode(' Aprobar presupuesto'));
            } else {
                approveBudgetBtn.textContent = 'Aprobar presupuesto';
            }
            approveBudgetBtn.hidden = !(latestBudget && String(latestBudget?.approval_status || '').toLowerCase() !== 'approved');
            approveBudgetBtn.addEventListener('click', () => {
                if (!latestBudget) {
                    options.showNotification('Primero genera un presupuesto para poder aprobarlo.', 'warning');
                    return;
                }
                void openInstallationBudgetApprovalModal(installationId, latestBudget);
            });

            const commercialClosureBtn = document.createElement('button');
            commercialClosureBtn.type = 'button';
            commercialClosureBtn.className = 'btn-secondary incidents-action-button';
            commercialClosureBtn.dataset.role = 'commercial-closure-trigger';
            const closureIcon = options.createMaterialIconNode('policy');
            if (closureIcon) {
                commercialClosureBtn.replaceChildren(closureIcon, document.createTextNode(' Cobertura'));
            } else {
                commercialClosureBtn.textContent = 'Cobertura';
            }
            commercialClosureBtn.addEventListener('click', () => {
                void openInstallationCommercialClosureModal(installationId, {
                    installation: targetInstallation,
                });
            });
            commercialClosureBtn.hidden = !canCurrentUserWriteOperationalData();

            const conformityBtn = document.createElement('button');
            conformityBtn.type = 'button';
            conformityBtn.dataset.role = 'conformity-trigger';
            applyConformityButtonState(
                conformityBtn,
                activeIncidentCount,
                Boolean(latestApprovedBudget),
                requiresApprovedBudget,
            );
            conformityBtn.addEventListener('click', () => {
                const currentActiveIncidentCount = Math.max(
                    0,
                    Number.parseInt(String(conformityBtn.dataset.activeIncidentCount || header.dataset.activeIncidentCount || '0'), 10) || 0,
                );
                if (currentActiveIncidentCount > 0) {
                    options.showNotification(
                        `Quedan ${currentActiveIncidentCount} incidencia${currentActiveIncidentCount === 1 ? '' : 's'} activa${currentActiveIncidentCount === 1 ? '' : 's'}. ResuÃ©lvelas antes de emitir la conformidad.`,
                        'warning',
                    );
                    return;
                }
                if (requiresApprovedBudget && !latestApprovedBudget) {
                    options.showNotification('Debes aprobar el Ãºltimo presupuesto para emitir la conformidad.', 'warning');
                    return;
                }
                void openInstallationConformityModal(installationId, {
                    activeIncidentCount: currentActiveIncidentCount,
                    latestConformity,
                    latestApprovedBudget,
                    requiresApprovedBudget,
                    commercialClosureMode: commercialClosure.mode,
                    commercialClosureNote: commercialClosure.note,
                });
            });

            const shareTrackingBtn = document.createElement('button');
            shareTrackingBtn.type = 'button';
            shareTrackingBtn.className = 'btn-secondary incidents-action-button';
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
            const createHeaderActionGroup = ({
                title,
                description,
                tone = 'neutral',
                role = '',
            }) => {
                const group = document.createElement('section');
                group.className = 'incidents-action-group';
                group.dataset.tone = tone;
                if (role) {
                    group.dataset.role = role;
                }

                const head = document.createElement('div');
                head.className = 'incidents-action-group-head';

                const titleEl = document.createElement('p');
                titleEl.className = 'incidents-action-group-title';
                titleEl.textContent = title;

                const descriptionEl = document.createElement('p');
                descriptionEl.className = 'incidents-action-group-description';
                descriptionEl.textContent = description;

                head.append(titleEl, descriptionEl);

                const body = document.createElement('div');
                body.className = 'incidents-action-group-body';
                group.append(head, body);

                return {
                    group,
                    body,
                    descriptionEl,
                };
            };

            const primaryGroup = createHeaderActionGroup({
                title: 'Cierre del caso',
                description: buildConformityHelperText(
                    activeIncidentCount,
                    Boolean(latestApprovedBudget),
                    requiresApprovedBudget,
                ),
                tone: 'primary',
            });
            primaryGroup.descriptionEl.dataset.role = 'conformity-helper-text';
            primaryGroup.body.appendChild(conformityBtn);

            const operationalGroup = createHeaderActionGroup({
                title: 'Gestion operativa',
                description: 'Abre incidencias y administra presupuesto, aprobacion y cobertura.',
                tone: 'operations',
            });
            operationalGroup.body.append(
                createIncidentBtn,
                budgetBtn,
                approveBudgetBtn,
                commercialClosureBtn,
            );

            const trackingGroup = createHeaderActionGroup({
                title: 'Seguimiento',
                description: 'Comparte el estado publico del caso con el cliente.',
                tone: 'tracking',
            });

            const utilityGroup = createHeaderActionGroup({
                title: 'Auditoria',
                description: 'Activa controles de revision para incidencias eliminadas.',
                tone: 'utility',
            });

            const navigationGroup = createHeaderActionGroup({
                title: 'Navegacion',
                description: 'Vuelve al listado de registros sin perder este contexto.',
                tone: 'navigation',
            });
            navigationGroup.body.appendChild(backButton);
            const technicianFilterWrap = document.createElement('label');
            technicianFilterWrap.className = 'incidents-technician-filter';
            technicianFilterWrap.hidden = true;

            const technicianFilterLabel = document.createElement('span');
            technicianFilterLabel.textContent = 'TÃ©cnico';

            const technicianFilterSelect = document.createElement('select');
            technicianFilterSelect.id = 'incidentsTechnicianFilter';
            technicianFilterSelect.appendChild(new Option('Todos los tÃ©cnicos', ''));
            technicianFilterSelect.addEventListener('change', () => {
                applyIncidentTechnicianFilter(container, technicianFilterSelect.value);
            });
            technicianFilterWrap.append(technicianFilterLabel, technicianFilterSelect);

            if (canCurrentUserAuditDeletedIncidents()) {
                const auditToggleWrap = document.createElement('label');
                auditToggleWrap.className = 'action-checkbox';
                auditToggleWrap.title = 'Incluye incidencias eliminadas para auditorÃ­a';

                const auditToggle = document.createElement('input');
                auditToggle.type = 'checkbox';
                auditToggle.checked = includeDeletedIncidentsAudit === true;
                auditToggle.addEventListener('change', () => {
                    includeDeletedIncidentsAudit = auditToggle.checked === true;
                    void showIncidentsForInstallation(installationId);
                });

                const auditToggleText = document.createElement('span');
                auditToggleText.textContent = 'Mostrar eliminadas (auditorÃ­a)';

                auditToggleWrap.append(auditToggle, auditToggleText);
                utilityGroup.body.appendChild(auditToggleWrap);
            }

            actions.append(primaryGroup.group, operationalGroup.group);
            if (canCurrentUserManagePublicTracking()) {
                trackingGroup.body.appendChild(shareTrackingBtn);
                actions.appendChild(trackingGroup.group);
            }
            if (utilityGroup.body.childElementCount > 0) {
                actions.appendChild(utilityGroup.group);
            }
            actions.appendChild(navigationGroup.group);

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
                    description: 'Si detectas un problema, crea la primera incidencia desde aquÃ­. Si ya cerraste el caso, puedes emitir la conformidad desde el encabezado.',
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

        function showIncidentMapWorkspace() {
            if (!options.requireActiveSession()) return;
            bindIncidentMapControls();
            ensureAssignedIncidentMapDefaults();
            void loadIncidentMap();
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

            function syncIncidentGpsSnapshot(snapshot) {
                latestIncidentGpsSnapshot = snapshot && typeof snapshot === 'object'
                    ? { ...snapshot }
                    : null;
            }

            const modalOpened = options.openActionModal({
                title: isAssetContext ? `Nueva incidencia para equipo #${numericAssetId}` : 'Nueva incidencia',
                subtitle: isAssetContext
                    ? 'Carga detalle y severidad; el registro se resuelve automÃ¡ticamente.'
                    : 'Carga detalle, severidad y tiempo estimado.',
                submitLabel: 'Crear incidencia',
                modalWidth: 'wide',
                modalClassName: 'action-modal-incident-create',
                hideOnboard: true,
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
                    const dispatchTargetResult = readIncidentDispatchTargetFromModal();
                    if (dispatchTargetResult.error) {
                        options.setActionModalError(dispatchTargetResult.error);
                        return;
                    }
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

                    const createdIncidentId = options.parseStrictInteger(result?.incident?.id);
                    const dispatchTouched = document.getElementById('actionIncidentDispatchTouched')?.value === '1';
                    if (
                        Number.isInteger(createdIncidentId)
                        && createdIncidentId > 0
                        && (
                            dispatchTargetResult.payload?.dispatch_required === false
                                ? dispatchTouched
                                : hasIncidentDispatchTargetContent(dispatchTargetResult.payload)
                        )
                    ) {
                        const dispatchResult = await options.api.updateIncidentDispatchTarget(
                            createdIncidentId,
                            dispatchTargetResult.payload,
                        );
                        if (dispatchResult?.incident && typeof dispatchResult.incident === 'object') {
                            result.incident = dispatchResult.incident;
                        }
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
                    syncIncidentGpsSnapshot(
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
                        mode: 'compact-inline',
                        onSnapshotChange: syncIncidentGpsSnapshot,
                    });
                    void gpsController.capture();
                } else {
                    syncIncidentGpsSnapshot({
                        status: 'unsupported',
                        source: 'browser',
                        note: '',
                    });
                }
                requestAnimationFrame(() => {
                    bindIncidentDispatchPlacesAutocomplete();
                });
            }
        }

        function createIncidentFromWeb(installationId, config = {}) {
            if (!options.requireActiveSession()) return;
            const targetId = options.parseStrictInteger(installationId);
            const numericAssetId = options.parseStrictInteger(config.assetId);
            if ((!Number.isInteger(targetId) || targetId <= 0) && (!Number.isInteger(numericAssetId) || numericAssetId <= 0)) {
                options.showNotification('installation_id invÃ¡lido para crear incidencia.', 'error');
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
                options.showNotification('incident_id invÃ¡lido para subir foto.', 'error');
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
                        `La carga seleccionada pesa ${formatPhotoBytes(totalBatchBytes)} y supera el mÃ¡ximo de ${formatPhotoBytes(INCIDENT_PHOTO_UPLOAD_MAX_BATCH_BYTES)} por tanda.`,
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
                                `La foto ${uploadFile?.name || 'seleccionada'} supera el mÃ¡ximo de ${formatPhotoBytes(INCIDENT_PHOTO_UPLOAD_MAX_FILE_BYTES)} luego de optimizarla.`,
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
                options.showNotification('Incidencia invÃ¡lida para actualizar evidencia.', 'error');
                return;
            }
            if (!canCurrentUserWriteOperationalData()) {
                options.showNotification('Solo roles operativos pueden actualizar evidencia.', 'warning');
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

        async function updateIncidentDispatchTargetFromWeb(incident, config = {}) {
            if (!options.requireActiveSession()) return;
            const incidentId = options.parseStrictInteger(incident?.id);
            if (!Number.isInteger(incidentId) || incidentId <= 0) {
                options.showNotification('Incidencia invÃ¡lida para actualizar destino operativo.', 'error');
                return;
            }
            if (!canCurrentUserWriteOperationalData()) {
                options.showNotification('Solo roles operativos pueden editar destino operativo.', 'warning');
                return;
            }

            const modalOpened = options.openActionModal({
                title: `Destino operativo #${incidentId}`,
                subtitle: 'Define direcciÃ³n, referencia y coordenadas operativas para el despacho.',
                submitLabel: 'Guardar destino',
                modalWidth: 'wide',
                focusId: 'actionIncidentDispatchRequired',
                fields: buildIncidentDispatchTargetFields(incident),
                onSubmit: async () => {
                    const dispatchTargetResult = readIncidentDispatchTargetFromModal();
                    if (dispatchTargetResult.error) {
                        options.setActionModalError(dispatchTargetResult.error);
                        return;
                    }

                    const result = await options.api.updateIncidentDispatchTarget(
                        incidentId,
                        dispatchTargetResult.payload,
                    );
                    if (result?.incident && typeof result.incident === 'object') {
                        applyVisibleIncidentUpdate(result.incident);
                    }
                    options.closeActionModal(true);
                    options.showNotification(`Destino operativo actualizado en incidencia #${incidentId}`, 'success');
                    runIncidentRefreshInBackground(
                        config,
                        'El destino operativo se guardo, pero no pudimos refrescar la vista.',
                    );
                    void options.loadDashboard();
                },
            });
            if (modalOpened) {
                requestAnimationFrame(() => {
                    bindIncidentDispatchPlacesAutocomplete();
                });
            }
        }

        async function updateIncidentStatusFromWeb(incident, targetStatus, config = {}) {
            if (!options.requireActiveSession()) return;
            const incidentId = Number.parseInt(String(incident?.id), 10);
            if (!Number.isInteger(incidentId) || incidentId <= 0) {
                options.showNotification('Incidencia invÃ¡lida para actualizar estado.', 'error');
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
                        if (normalizedStatus === 'paused') {
                            document
                                .querySelectorAll(`.incident-card[data-incident-id="${incidentId}"] .incident-action-btn[data-action="in_progress"]`)
                                .forEach((resumeBtn) => {
                                    if (isIncidentButtonElement(resumeBtn)) {
                                        decorateIncidentActionButton(resumeBtn, 'in_progress', 'Reanudar', 'play_circle');
                                    }
                                });
                        }
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
                        'El estado se actualizÃ³, pero no pudimos refrescar la vista.',
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
                    subtitle: 'Agrega una nota de resoluciÃ³n opcional antes de cerrar la incidencia.',
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
                    subtitle: `La incidencia volverÃ¡ al flujo activo y pasarÃ¡ a "${targetStatusLabel}".`,
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
                subtitle: 'Esta acciÃ³n marcarÃ¡ la incidencia como eliminada y dejarÃ¡ rastro en el registro de auditorÃ­a.',
                submitLabel: 'Eliminar incidencia',
                acknowledgementText: 'Confirmo que deseo eliminar esta incidencia de los listados activos.',
                missingConfirmationMessage: 'Debes confirmar la eliminaciÃ³n para continuar.',
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
                options.showNotification('asset_id invÃ¡lido.', 'error');
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
            showIncidentMapWorkspace,
            showIncidentsForInstallation,
            showIncidentsWorkspace,
            sortAssetIncidentsByPriority,
            updateIncidentDispatchTargetFromWeb,
            updateIncidentEvidenceFromWeb,
            updateIncidentStatusFromWeb,
        };
    }

    global.createDashboardIncidents = createDashboardIncidents;
})(window);

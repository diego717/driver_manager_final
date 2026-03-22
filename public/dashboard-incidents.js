(function attachDashboardIncidentsFactory(global) {
    function createDashboardIncidents(options) {
        const INCIDENT_PHOTO_UPLOAD_MAX_FILES = 5;
        const INCIDENT_PHOTO_UPLOAD_MAX_FILE_BYTES = 5 * 1024 * 1024;
        const INCIDENT_PHOTO_UPLOAD_MAX_BATCH_BYTES = 20 * 1024 * 1024;
        const INCIDENT_PHOTO_UPLOAD_LABEL = `Subir fotos (max ${INCIDENT_PHOTO_UPLOAD_MAX_FILES} / 20MB)`;
        const INCIDENT_STATUS_ACTION_DEFINITIONS = {
            open: { label: 'Abrir', icon: 'radio_button_checked' },
            in_progress: { label: 'En curso', icon: 'pending_actions' },
            paused: { label: 'Pausar', icon: 'pause_circle' },
            resolved: { label: 'Resolver', icon: 'task_alt' },
        };

        function canCurrentUserAuditDeletedIncidents() {
            const role = String(options.getCurrentUser?.()?.role || '').toLowerCase();
            return role === 'super_admin';
        }

        let includeDeletedIncidentsAudit = false;

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

        function runIncidentRefreshInBackground(config = {}, failureMessage = 'La incidencia se guardo, pero no pudimos refrescar la vista.') {
            void refreshIncidentContext(config).catch(() => {
                options.showNotification(failureMessage, 'warning');
            });
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
            return chip;
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
                    `Tiempo real: ${options.formatDuration(realDurationSeconds)}${
                        statusValue === 'in_progress'
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

            highlights.appendChild(
                createIncidentHighlightChip(
                    Number.isInteger(installationId) && installationId > 0
                        ? `Registro #${installationId}`
                        : 'Registro: auto/contexto',
                    'info',
                ),
            );

            if (Number.isInteger(assetId) && assetId > 0) {
                highlights.appendChild(
                    createIncidentHighlightChip(
                        `Equipo #${assetId}`,
                        config.assetTone || 'neutral',
                    ),
                );
            }

            parent.appendChild(highlights);
        }

        function formatIncidentCreatedAtText(value) {
            return value
                ? `Creada: ${new Date(value).toLocaleString('es-ES')}`
                : 'Creada: -';
        }

        function appendIncidentResolutionSummary(parent, incident) {
            const statusValue = options.normalizeIncidentStatus(incident?.incident_status);
            const resolutionNote = String(incident?.resolution_note || '').trim();
            if (!resolutionNote && statusValue !== 'resolved') return;

            const resolutionPanel = document.createElement('div');
            resolutionPanel.className = 'incident-resolution-panel';
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
                resolutionMeta.textContent = metaParts.join(' · ');
                resolutionPanel.appendChild(resolutionMeta);
            }

            parent.appendChild(resolutionPanel);
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
                auditNotice.textContent = `Eliminada: ${new Date(incident.deleted_at).toLocaleString('es-ES')}${
                    incident?.deleted_by ? ` por ${incident.deleted_by}` : ''
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

        function applyVisibleIncidentUpdate(incident) {
            const incidentId = options.parseStrictInteger(incident?.id);
            if (!Number.isInteger(incidentId) || incidentId <= 0) return;

            const cards = document.querySelectorAll(`.incident-card[data-incident-id="${incidentId}"]`);
            if (!cards.length) return;

            const statusValue = options.normalizeIncidentStatus(incident?.incident_status);
            const canUpdateIncident = options.canCurrentUserEditAssets();
            const runtimeText = Number.isInteger(options.resolveIncidentRealDurationSeconds(incident))
                ? `Tiempo real: ${options.formatDuration(options.resolveIncidentRealDurationSeconds(incident))}${
                    statusValue === 'in_progress'
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

            if (config.showReporter === true) {
                const reporter = document.createElement('small');
                reporter.className = 'incident-reporter-line';
                reporter.textContent = 'por ';
                const reporterStrong = document.createElement('strong');
                reporterStrong.textContent = String(incident?.reporter_username || 'desconocido').trim() || 'desconocido';
                reporter.appendChild(reporterStrong);
                headingBlock.appendChild(reporter);
            }

            const createdAt = document.createElement('small');
            createdAt.className = 'asset-muted';
            createdAt.textContent = formatIncidentCreatedAtText(incident?.created_at);
            incidentHeader.append(headingBlock, createdAt);
            incidentCard.appendChild(incidentHeader);

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
                ].filter(Boolean).join(' · ');
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
            container.replaceChildren();

            const header = document.createElement('div');
            header.className = 'incidents-header';
            header.classList.add('incidents-header');

            const heading = document.createElement('h3');
            const headingIcon = options.createMaterialIconNode('warning');
            if (headingIcon) {
                heading.replaceChildren(headingIcon, document.createTextNode(` Incidencias de Registro #${installationId}`));
            } else {
                heading.textContent = `Incidencias de Registro #${installationId}`;
            }

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
            createIncidentBtn.className = 'btn-primary';
            const createIcon = options.createMaterialIconNode('add_circle');
            if (createIcon) {
                createIncidentBtn.replaceChildren(createIcon, document.createTextNode(' Crear incidencia'));
            } else {
                createIncidentBtn.textContent = 'Crear incidencia';
            }
            createIncidentBtn.addEventListener('click', () => {
                createIncidentFromWeb(installationId);
            });

            const actions = document.createElement('div');
            actions.className = 'incidents-header-actions';

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
                actions.appendChild(auditToggleWrap);
            }

            actions.append(createIncidentBtn, backButton);

            header.append(heading, actions);
            container.appendChild(header);

            if (!incidents || !incidents.length) {
                options.renderContextualEmptyState(container, {
                    title: 'Sin incidencias para este registro',
                    description: 'Si detectas un problema, crea la primera incidencia desde aqui.',
                    actionLabel: 'Crear incidencia',
                    onAction: () => createIncidentBtn.click(),
                    tone: 'neutral',
                });
                return;
            }

            for (const incident of incidents) {
                await appendIncidentCard(container, incident, {
                    installationId: Number.parseInt(String(installationId), 10),
                    assetId: options.parseStrictInteger(incident?.asset_id),
                    includeAssetChip: true,
                    assetTone: 'accent',
                    showReporter: true,
                    attachPhotoIdDataset: true,
                    uploadLabel: INCIDENT_PHOTO_UPLOAD_LABEL,
                    uploadIcon: 'add_a_photo',
                });
            }
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
            const estimatedPresetOptions = options.incidentEstimatedDurationPresets.map((preset) => `
                <option value="${preset.seconds}">${options.escapeHtml(preset.label)}</option>
            `).join('');

            const modalOpened = options.openActionModal({
                title: isAssetContext ? `Nueva incidencia para equipo #${numericAssetId}` : 'Nueva incidencia',
                subtitle: isAssetContext
                    ? 'Completa detalle y severidad. El registro se resolvera automaticamente si no lo indicas.'
                    : 'Completa detalle, severidad y tiempo estimado.',
                submitLabel: 'Crear incidencia',
                focusId: 'actionIncidentNote',
                fieldsHtml: `
                    <div class="action-modal-grid">
                        <div class="input-group">
                            <label for="actionIncidentInstallationId">${isAssetContext ? 'ID de registro (opcional)' : 'ID de registro'}</label>
                            <input type="text" id="actionIncidentInstallationId" value="${options.escapeHtml(defaultInstallationId)}" autocomplete="off" placeholder="${options.escapeHtml(isAssetContext ? 'Opcional. Se usa vinculo activo o se crea contexto automatico' : 'Ej: 245')}">
                        </div>
                        <div class="input-group">
                            <label for="actionIncidentSeverity">Severidad</label>
                            <select id="actionIncidentSeverity">
                                <option value="low" ${defaultSeverity === 'low' ? 'selected' : ''}>low</option>
                                <option value="medium" ${defaultSeverity === 'medium' ? 'selected' : ''}>medium</option>
                                <option value="high" ${defaultSeverity === 'high' ? 'selected' : ''}>high</option>
                                <option value="critical" ${defaultSeverity === 'critical' ? 'selected' : ''}>critical</option>
                            </select>
                        </div>
                        <div class="input-group">
                            <label for="actionIncidentEstimatedPreset">Tiempo estimado</label>
                            <select id="actionIncidentEstimatedPreset">
                                ${estimatedPresetOptions}
                                <option value="__custom__">Personalizado (HH:MM)</option>
                            </select>
                        </div>
                        <div class="input-group is-hidden" id="actionIncidentEstimatedCustomWrap">
                            <label for="actionIncidentEstimatedCustom">Tiempo personalizado (HH:MM)</label>
                            <input type="text" id="actionIncidentEstimatedCustom" value="${options.escapeHtml(options.formatDurationToHHMM(defaultEstimatedDurationSeconds))}" autocomplete="off" placeholder="Ej: 01:30">
                        </div>
                        <div class="input-group full-width">
                            <label for="actionIncidentNote">Detalle de la incidencia</label>
                            <textarea id="actionIncidentNote" rows="4" placeholder="Describe el problema y el contexto">${options.escapeHtml(defaultNote)}</textarea>
                        </div>
                    </div>
                    <label class="action-checkbox" for="actionIncidentApplyToRecord">
                        <input type="checkbox" id="actionIncidentApplyToRecord" ${defaultApply ? 'checked' : ''}>
                        <span>Aplicar nota y tiempo al registro de instalacion.</span>
                    </label>
                `,
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
                    const payload = {
                        note,
                        reporter_username: options.getCurrentUser()?.username || 'web_user',
                        time_adjustment_seconds: estimatedDurationResult.seconds,
                        estimated_duration_seconds: estimatedDurationResult.seconds,
                        severity,
                        source: 'web',
                        apply_to_installation: applyToInstallation,
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
                },
            });

            if (modalOpened) {
                options.bindIncidentEstimatedDurationFields(defaultEstimatedDurationSeconds);
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

        async function showIncidentsForInstallation(installationId) {
            if (!options.requireActiveSession()) return;
            options.setCurrentSelectedInstallationId(Number.parseInt(String(installationId), 10));
            const container = document.getElementById('incidentsList');
            document.querySelector('[data-section="incidents"]')?.click();
            if (container) container.innerHTML = '<p class="loading">Cargando incidencias...</p>';

            try {
                const data = await options.api.getIncidents(installationId, {
                    includeDeleted: includeDeletedIncidentsAudit && canCurrentUserAuditDeletedIncidents(),
                });
                await renderIncidents(data.incidents || [], installationId);
            } catch (_error) {
                if (container) container.innerHTML = '<p class="error">Error cargando incidencias</p>';
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

                const oversizedFiles = filesToUpload.filter((file) =>
                    Math.max(0, Number(file?.size) || 0) > INCIDENT_PHOTO_UPLOAD_MAX_FILE_BYTES,
                );
                if (oversizedFiles.length > 0) {
                    const firstOversized = oversizedFiles[0];
                    options.showNotification(
                        `La foto ${firstOversized?.name || 'seleccionada'} supera el maximo de ${formatPhotoBytes(INCIDENT_PHOTO_UPLOAD_MAX_FILE_BYTES)} por archivo.`,
                        'error',
                    );
                    return;
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

                if (filesToUpload.length > 1) {
                    options.showNotification(
                        `Subiendo ${filesToUpload.length} fotos (${formatPhotoBytes(totalBatchBytes)}) a incidencia #${targetIncidentId}...`,
                        'info',
                    );
                }

                let uploadedCount = 0;
                const failedFiles = [];

                for (const file of filesToUpload) {
                    try {
                        await options.api.uploadIncidentPhoto(targetIncidentId, file);
                        uploadedCount += 1;
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
                        `${uploadedLabel} a incidencia #${targetIncidentId}.`,
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
            const presetChecklistHtml = options.incidentChecklistPresets.map((label, index) => {
                const checked = selectedPresetItems.includes(label) ? 'checked' : '';
                return `
                    <label class="action-checkbox" for="actionIncidentChecklistPreset-${index}">
                        <input type="checkbox" id="actionIncidentChecklistPreset-${index}" name="actionIncidentChecklistPreset" value="${options.escapeHtml(label)}" ${checked}>
                        <span>${options.escapeHtml(label)}</span>
                    </label>
                `;
            }).join('');

            options.openActionModal({
                title: `Evidencia incidencia #${incidentId}`,
                subtitle: 'Actualiza checklist y nota operativa en el registro de evidencia.',
                submitLabel: 'Guardar evidencia',
                focusId: 'actionIncidentEvidenceNote',
                fieldsHtml: `
                    <div class="input-group">
                        <label>Checklist sugerido</label>
                        <div class="incident-checklist-grid">${presetChecklistHtml}</div>
                    </div>
                    <div class="input-group">
                        <label for="actionIncidentChecklistCustom">Checklist adicional (una linea por item)</label>
                        <textarea id="actionIncidentChecklistCustom" rows="3" placeholder="Ej: Foto del serial\nValidacion con supervisor">${options.escapeHtml(customChecklistItems.join('\n'))}</textarea>
                    </div>
                    <div class="input-group">
                        <label for="actionIncidentEvidenceNote">Nota operativa</label>
                        <textarea id="actionIncidentEvidenceNote" rows="4" placeholder="Resumen operativo de evidencia">${options.escapeHtml(currentEvidenceNote)}</textarea>
                    </div>
                `,
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
                    }
                    options.showNotification(`Incidencia #${incidentId} actualizada a "${options.incidentStatusLabel(normalizedStatus)}".`, 'success');
                    runIncidentRefreshInBackground(
                        config,
                        'El estado se actualizo, pero no pudimos refrescar la vista.',
                    );
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
                    fieldsHtml: `
                        <div class="input-group">
                            <label for="actionIncidentResolutionNote">Nota de resolucion (opcional)</label>
                            <textarea id="actionIncidentResolutionNote" rows="4" placeholder="Resumen de la solucion aplicada">${options.escapeHtml(defaultNote)}</textarea>
                        </div>
                    `,
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
                        void runIncidentRefreshInBackground(updateOptions.installationId, updateOptions.assetId);
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
            options.showNotification(`${severityIcon} Nueva incidencia en registro #${incident.installation_id}`, 'warning');
        }

        function handleRealtimeIncidentStatusUpdate(incident) {
            if (!incident || !incident.id) return;
            const isDeleted = String(incident?.deleted_at || '').trim().length > 0;
            if (isDeleted) {
                options.showNotification(`Incidencia #${incident.id} eliminada.`, 'info');
            } else {
                applyVisibleIncidentUpdate(incident);
                options.showNotification(
                    `Incidencia #${incident.id} ahora esta "${options.incidentStatusLabel(incident.incident_status)}".`,
                    'info',
                );
            }

            const activeIncidentsSection = document.getElementById('incidentsSection')?.classList.contains('active');
            const activeAssetsSection = document.getElementById('assetsSection')?.classList.contains('active');
            const activeDashboardSection = document.getElementById('dashboardSection')?.classList.contains('active');
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
            renderIncidents,
            selectAndUploadIncidentPhoto,
            showIncidentsForInstallation,
            sortAssetIncidentsByPriority,
            updateIncidentEvidenceFromWeb,
            updateIncidentStatusFromWeb,
        };
    }

    global.createDashboardIncidents = createDashboardIncidents;
})(window);

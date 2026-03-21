(function attachDashboardAssetsFactory(global) {
    function createDashboardAssets(options) {
        function formatAssetUpdatedMeta(rawValue) {
            const parsedMs = Date.parse(String(rawValue || ''));
            if (!Number.isFinite(parsedMs)) {
                return { relative: '-', absolute: '-' };
            }
            const absolute = new Date(parsedMs).toLocaleString('es-ES');
            const diffSeconds = Math.max(0, Math.floor((Date.now() - parsedMs) / 1000));
            if (diffSeconds < 60) return { relative: 'hace instantes', absolute };
            if (diffSeconds < 3600) return { relative: `hace ${Math.floor(diffSeconds / 60)} min`, absolute };
            if (diffSeconds < 86400) return { relative: `hace ${Math.floor(diffSeconds / 3600)} h`, absolute };
            return { relative: `hace ${Math.floor(diffSeconds / 86400)} d`, absolute };
        }

        function resolveAssetOperationalStateMeta(rawStatus) {
            const normalized = String(rawStatus || '').trim().toLowerCase();
            if (normalized === 'active') return { label: 'Operativo', toneClass: 'asset-active' };
            if (normalized === 'maintenance') return { label: 'Mantenimiento', toneClass: 'asset-maintenance' };
            if (normalized === 'inactive') return { label: 'Inactivo', toneClass: 'asset-inactive' };
            if (normalized === 'retired') return { label: 'Retirado', toneClass: 'asset-retired' };
            return { label: options.normalizeAssetStatusLabel(rawStatus), toneClass: 'unknown' };
        }

        function createAssetDetailMetaItem(label, value) {
            const item = document.createElement('div');
            item.className = 'asset-meta-item';
            const title = document.createElement('small');
            title.textContent = label;
            const content = document.createElement('strong');
            content.textContent = String(value || '-').trim() || '-';
            item.append(title, content);
            return item;
        }

        async function renderAssetDetail(data) {
            const container = document.getElementById('assetDetail');
            if (!container) return;
            container.replaceChildren();

            const asset = data?.asset;
            if (!asset) {
                const message = document.createElement('p');
                message.className = 'loading';
                message.textContent = 'No hay detalle disponible para este equipo.';
                container.appendChild(message);
                return;
            }

            const incidents = options.sortAssetIncidentsByPriority(data?.incidents);
            const activeIncidents = incidents.filter(
                (incident) => options.normalizeIncidentStatus(incident?.incident_status) !== 'resolved',
            );
            const resolvedIncidents = incidents.filter(
                (incident) => options.normalizeIncidentStatus(incident?.incident_status) === 'resolved',
            );
            const stateMeta = resolveAssetOperationalStateMeta(asset.status);
            const attentionMeta = options.deriveAssetAttentionMetaFromIncidents(incidents);
            const updatedMeta = formatAssetUpdatedMeta(asset.updated_at);

            const summary = document.createElement('section');
            summary.className = 'asset-detail-summary';

            const summaryTop = document.createElement('div');
            summaryTop.className = 'asset-detail-summary-top';

            const identity = document.createElement('div');
            identity.className = 'asset-detail-identity';
            const code = document.createElement('h4');
            code.className = 'asset-detail-code';
            code.textContent = asset.external_code || `#${asset.id || '-'}`;
            const subtitle = document.createElement('p');
            subtitle.className = 'asset-muted';
            subtitle.textContent = `${asset.brand || '-'} ${asset.model || '-'}`.trim();
            identity.append(code, subtitle);

            const badges = document.createElement('div');
            badges.className = 'asset-detail-badges';
            const statusBadge = document.createElement('span');
            statusBadge.className = `badge ${stateMeta.toneClass}`;
            statusBadge.textContent = stateMeta.label;
            const attentionBadge = document.createElement('span');
            attentionBadge.className = `badge ${attentionMeta.badgeClass}`;
            options.setElementTextWithMaterialIcon(attentionBadge, attentionMeta.iconName, attentionMeta.label);
            badges.append(statusBadge, attentionBadge);
            summaryTop.append(identity, badges);
            summary.appendChild(summaryTop);

            const metaGrid = document.createElement('div');
            metaGrid.className = 'asset-meta-grid';
            metaGrid.append(
                createAssetDetailMetaItem('Cliente', asset.client_name || '-'),
                createAssetDetailMetaItem('Serie', asset.serial_number || '-'),
                createAssetDetailMetaItem('Actualizado', `${updatedMeta.relative} | ${updatedMeta.absolute}`),
                createAssetDetailMetaItem('ID interno', `#${asset.id || '-'}`),
            );
            summary.appendChild(metaGrid);
            container.appendChild(summary);

            const activeLink = data?.active_link;
            const activeLinkBanner = document.createElement('div');
            activeLinkBanner.className = 'asset-active-link-banner';
            if (activeLink?.installation_id) {
                activeLinkBanner.textContent =
                    `Instalacion activa #${activeLink.installation_id}` +
                    (activeLink.installation_client_name ? ` | ${activeLink.installation_client_name}` : '');
            } else {
                activeLinkBanner.textContent = 'Sin instalacion activa vinculada';
            }
            container.appendChild(activeLinkBanner);

            const toolbar = document.createElement('div');
            toolbar.className = 'asset-detail-toolbar';

            const createIncidentBtn = document.createElement('button');
            createIncidentBtn.type = 'button';
            createIncidentBtn.className = 'btn-primary';
            createIncidentBtn.textContent = 'Crear incidencia';
            createIncidentBtn.addEventListener('click', () => {
                void options.createIncidentForAsset(asset.id);
            });

            const linkBtn = document.createElement('button');
            linkBtn.type = 'button';
            linkBtn.className = 'btn-secondary';
            linkBtn.textContent = 'Vincular instalacion';
            linkBtn.addEventListener('click', () => {
                void linkAssetFromDetail(asset.id);
            });

            const qrBtn = document.createElement('button');
            qrBtn.type = 'button';
            qrBtn.className = 'btn-secondary';
            qrBtn.textContent = 'Ver QR';
            qrBtn.addEventListener('click', () => {
                options.showAssetQrModal(asset);
            });
            toolbar.append(createIncidentBtn, linkBtn, qrBtn);

            if (options.canCurrentUserEditAssets()) {
                const normalizedStatus = String(asset.status || '').trim().toLowerCase();
                const isInactiveAsset = normalizedStatus === 'inactive' || normalizedStatus === 'retired';

                const statusBtn = document.createElement('button');
                statusBtn.type = 'button';
                statusBtn.className = 'btn-secondary';
                statusBtn.textContent = isInactiveAsset ? 'Reactivar equipo' : 'Dar de baja equipo';
                statusBtn.addEventListener('click', () => {
                    void updateAssetStatusFromWeb(asset, isInactiveAsset ? 'active' : 'retired');
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'btn-secondary';
                deleteBtn.textContent = 'Eliminar equipo';
                deleteBtn.addEventListener('click', () => {
                    void deleteAssetFromWeb(asset);
                });
                toolbar.append(statusBtn, deleteBtn);
            }
            container.appendChild(toolbar);

            const links = Array.isArray(data?.links) ? data.links : [];
            if (links.length > 0) {
                const linksHistory = document.createElement('details');
                linksHistory.className = 'asset-links-history';
                const linksSummary = document.createElement('summary');
                linksSummary.textContent = `Historial de asociaciones (${links.length})`;
                linksHistory.appendChild(linksSummary);

                const linksList = document.createElement('div');
                linksList.className = 'asset-links-list';
                for (const link of links) {
                    const pill = document.createElement('div');
                    pill.className = 'asset-link-item';
                    const state = link.unlinked_at ? 'historial' : 'activa';
                    const text =
                        `Instalacion #${link.installation_id} (${state})` +
                        (link.installation_client_name ? ` | ${link.installation_client_name}` : '') +
                        (link.linked_at ? ` | vinculada: ${new Date(link.linked_at).toLocaleString('es-ES')}` : '');
                    pill.textContent = text;
                    linksList.appendChild(pill);
                }
                linksHistory.appendChild(linksList);
                container.appendChild(linksHistory);
            }

            const incidentsSection = document.createElement('section');
            incidentsSection.className = 'asset-incidents-section';
            const incidentsTitle = document.createElement('h4');
            incidentsTitle.textContent = `Incidencias activas (${activeIncidents.length})`;
            incidentsSection.appendChild(incidentsTitle);

            if (!incidents.length) {
                const emptyIncident = document.createElement('p');
                emptyIncident.className = 'asset-muted';
                emptyIncident.textContent = 'No hay incidencias registradas para este equipo.';
                incidentsSection.appendChild(emptyIncident);
            } else if (!activeIncidents.length) {
                const noActive = document.createElement('p');
                noActive.className = 'asset-muted';
                noActive.textContent = 'No hay incidencias activas. Revisa el historial para ver resueltas.';
                incidentsSection.appendChild(noActive);
            } else {
                const activeWrap = document.createElement('div');
                activeWrap.className = 'incidents-grid';
                for (const incident of activeIncidents) {
                    await options.appendIncidentCard(activeWrap, incident, {
                        assetId: options.parseStrictInteger(asset.id),
                    });
                }
                incidentsSection.appendChild(activeWrap);
            }
            container.appendChild(incidentsSection);

            if (resolvedIncidents.length) {
                const resolvedDetails = document.createElement('details');
                resolvedDetails.className = 'asset-incidents-history';
                const resolvedSummary = document.createElement('summary');
                resolvedSummary.textContent = `Resueltas (${resolvedIncidents.length})`;
                resolvedDetails.appendChild(resolvedSummary);

                const resolvedWrap = document.createElement('div');
                resolvedWrap.className = 'incidents-grid asset-incidents-history-grid';
                for (const incident of resolvedIncidents) {
                    await options.appendIncidentCard(resolvedWrap, incident, {
                        assetId: options.parseStrictInteger(asset.id),
                    });
                }
                resolvedDetails.appendChild(resolvedWrap);
                container.appendChild(resolvedDetails);
            }
        }

        async function loadAssetDetail(assetId, config = {}) {
            if (!options.requireActiveSession()) return;
            const numericAssetId = Number.parseInt(String(assetId), 10);
            if (!Number.isInteger(numericAssetId) || numericAssetId <= 0) {
                return;
            }
            options.setCurrentSelectedAssetId(numericAssetId);

            const detailContainer = document.getElementById('assetDetail');
            if (detailContainer && !config.keepSelection) {
                detailContainer.innerHTML = '<p class="loading">Cargando detalle del equipo...</p>';
            }

            try {
                const data = await options.api.getAssetIncidents(numericAssetId, { limit: 150 });
                await renderAssetDetail(data);
            } catch (err) {
                if (detailContainer) {
                    detailContainer.innerHTML = `<p class="error">${options.escapeHtml(err.message || String(err))}</p>`;
                }
            }
        }

        async function loadAssets() {
            if (!options.requireActiveSession()) return;
            const tableContainer = document.getElementById('assetsTable');
            const resultsCount = document.getElementById('assetsResultsCount');
            const searchInput = document.getElementById('assetsSearchInput');
            if (!tableContainer) return;

            tableContainer.innerHTML = '<p class="loading">Cargando equipos...</p>';
            if (resultsCount) {
                resultsCount.innerHTML = '<span class="loading">Buscando...</span>';
            }

            try {
                const search = String(searchInput?.value || '').trim();
                const params = { limit: 200 };
                if (search) {
                    params.search = search;
                }

                const response = await options.api.getAssets(params);
                const assets = Array.isArray(response?.items) ? response.items : [];
                options.setCurrentAssetsData(assets);
                renderAssetsTable(assets);

                if (resultsCount) {
                    const count = assets.length;
                    resultsCount.innerHTML = `Mostrando <span class="count">${count}</span> equipo${count !== 1 ? 's' : ''}`;
                }

                const currentSelectedAssetId = options.getCurrentSelectedAssetId();
                if (currentSelectedAssetId) {
                    const selectedAsset = assets.find((item) => Number(item.id) === Number(currentSelectedAssetId));
                    if (selectedAsset) {
                        await loadAssetDetail(selectedAsset.id, { keepSelection: true });
                    }
                }
            } catch (_err) {
                tableContainer.innerHTML = '<p class="error">Error cargando equipos</p>';
                if (resultsCount) {
                    resultsCount.textContent = 'Error al cargar';
                }
            }
        }

        function renderAssetsTable(assets) {
            const container = document.getElementById('assetsTable');
            if (!container) return;
            container.replaceChildren();

            if (!assets || !assets.length) {
                options.renderContextualEmptyState(container, {
                    title: 'No hay equipos registrados',
                    description: 'Crea un equipo con QR para asociarlo a registros o incidencias.',
                    actionLabel: 'Nuevo equipo + QR',
                    onAction: () => document.getElementById('assetsCreateQrBtn')?.click(),
                    tone: 'info',
                });
                return;
            }

            const table = document.createElement('table');
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            ['Equipo', 'Cliente', 'Estado', 'Actualizado', 'Acciones'].forEach((label) => {
                const th = document.createElement('th');
                th.textContent = label;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);

            const tbody = document.createElement('tbody');
            for (const asset of assets) {
                const row = document.createElement('tr');
                row.dataset.assetId = String(asset.id || '');

                const equipmentCell = document.createElement('td');
                const equipmentWrap = document.createElement('div');
                equipmentWrap.className = 'asset-table-equipment';
                const equipmentTitle = document.createElement('strong');
                equipmentTitle.className = 'asset-table-title';
                equipmentTitle.textContent = asset.external_code || `#${asset.id ?? 'N/A'}`;
                const equipmentMeta = document.createElement('small');
                equipmentMeta.className = 'asset-table-meta';
                equipmentMeta.textContent = [asset.brand || '-', asset.model || '-', asset.serial_number || '-'].join(' | ');
                equipmentWrap.append(equipmentTitle, equipmentMeta);
                equipmentCell.appendChild(equipmentWrap);

                const clientCell = document.createElement('td');
                const clientWrap = document.createElement('div');
                clientWrap.className = 'asset-table-client';
                const clientTitle = document.createElement('strong');
                clientTitle.className = 'asset-table-title';
                clientTitle.textContent = asset.client_name || '-';
                const clientMeta = document.createElement('small');
                clientMeta.className = 'asset-table-meta';
                clientMeta.textContent = `ID #${asset.id ?? 'N/A'}`;
                clientWrap.append(clientTitle, clientMeta);
                clientCell.appendChild(clientWrap);

                const statusCell = document.createElement('td');
                const statusBadge = document.createElement('span');
                const stateMeta = resolveAssetOperationalStateMeta(asset.status);
                statusBadge.className = `badge ${stateMeta.toneClass}`;
                statusBadge.textContent = stateMeta.label;
                statusCell.appendChild(statusBadge);

                const updatedCell = document.createElement('td');
                const updatedWrap = document.createElement('div');
                updatedWrap.className = 'asset-table-updated';
                const updatedMeta = formatAssetUpdatedMeta(asset.updated_at);
                const updatedRelative = document.createElement('strong');
                updatedRelative.className = 'asset-table-title';
                updatedRelative.textContent = updatedMeta.relative;
                const updatedAbsolute = document.createElement('small');
                updatedAbsolute.className = 'asset-table-meta';
                updatedAbsolute.textContent = updatedMeta.absolute;
                updatedWrap.append(updatedRelative, updatedAbsolute);
                updatedCell.appendChild(updatedWrap);

                const actionsCell = document.createElement('td');
                actionsCell.className = 'asset-table-actions';

                const detailBtn = document.createElement('button');
                detailBtn.type = 'button';
                detailBtn.className = 'btn-secondary table-action-btn';
                detailBtn.textContent = 'Detalle';
                detailBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void loadAssetDetail(asset.id);
                });

                const incidentBtn = document.createElement('button');
                incidentBtn.type = 'button';
                incidentBtn.className = 'btn-secondary table-action-btn';
                incidentBtn.textContent = 'Incidencia';
                incidentBtn.classList.add('spaced-action-btn');
                incidentBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void options.createIncidentForAsset(asset.id);
                });

                actionsCell.append(detailBtn, incidentBtn);
                row.append(equipmentCell, clientCell, statusCell, updatedCell, actionsCell);
                row.addEventListener('click', () => {
                    void loadAssetDetail(asset.id);
                });
                options.makeTableRowKeyboardAccessible(
                    row,
                    `Abrir detalle del equipo ${asset.external_code || `#${asset.id}`}`,
                );
                tbody.appendChild(row);
            }

            table.append(thead, tbody);
            container.appendChild(table);
        }

        async function linkAssetFromDetail(assetId) {
            if (!options.requireActiveSession()) return;
            const numericAssetId = Number.parseInt(String(assetId), 10);
            if (!Number.isInteger(numericAssetId) || numericAssetId <= 0) {
                options.showNotification('asset_id invalido.', 'error');
                return;
            }
            options.openAssetLinkModal({
                assetId: numericAssetId,
                notes: 'Vinculo manual desde detalle de equipo',
            });
        }

        async function updateAssetStatusFromWeb(assetOrId, nextStatus) {
            if (!options.requireActiveSession()) return;
            if (!options.canCurrentUserEditAssets()) {
                options.showNotification('Solo admin/super_admin puede cambiar estado de equipos.', 'warning');
                return;
            }

            const rawId = typeof assetOrId === 'object' && assetOrId !== null ? assetOrId.id : assetOrId;
            const numericAssetId = Number.parseInt(String(rawId), 10);
            if (!Number.isInteger(numericAssetId) || numericAssetId <= 0) {
                options.showNotification('asset_id invalido.', 'error');
                return;
            }

            const normalizedStatus = String(nextStatus || '').trim().toLowerCase();
            const allowedStatuses = new Set(['active', 'inactive', 'retired', 'maintenance']);
            if (!allowedStatuses.has(normalizedStatus)) {
                options.showNotification('Estado de equipo invalido.', 'error');
                return;
            }

            const rawCode = typeof assetOrId === 'object' && assetOrId !== null ? assetOrId.external_code : '';
            const assetLabel = String(rawCode || `#${numericAssetId}`).trim() || `#${numericAssetId}`;
            const isReactivation = normalizedStatus === 'active';

            options.openActionConfirmModal({
                title: isReactivation ? 'Reactivar equipo' : 'Dar de baja equipo',
                subtitle: isReactivation
                    ? `Confirma la reactivacion del equipo ${assetLabel}.`
                    : `Confirma la baja logica del equipo ${assetLabel}. Podra reactivarse luego.`,
                submitLabel: isReactivation ? 'Reactivar equipo' : 'Dar de baja',
                acknowledgementText: isReactivation
                    ? 'Entiendo que este equipo volvera a estado activo.'
                    : 'Entiendo que este equipo quedara fuera de operacion.',
                missingConfirmationMessage: 'Debes confirmar la accion para continuar.',
                onSubmit: async () => {
                    await options.api.updateAsset(numericAssetId, { status: normalizedStatus });
                    options.closeActionModal(true);
                    options.showNotification(
                        isReactivation ? 'Equipo reactivado correctamente.' : 'Equipo dado de baja correctamente.',
                        'success',
                    );
                    void loadAssets().catch(() => {
                        options.showNotification('El estado se actualizo, pero no pudimos refrescar equipos.', 'warning');
                    });
                },
            });
        }

        async function deleteAssetFromWeb(assetOrId) {
            if (!options.requireActiveSession()) return;
            if (!options.canCurrentUserEditAssets()) {
                options.showNotification('Solo admin/super_admin puede eliminar equipos.', 'warning');
                return;
            }

            const rawId = typeof assetOrId === 'object' && assetOrId !== null ? assetOrId.id : assetOrId;
            const numericAssetId = Number.parseInt(String(rawId), 10);
            if (!Number.isInteger(numericAssetId) || numericAssetId <= 0) {
                options.showNotification('asset_id invalido.', 'error');
                return;
            }

            const rawCode = typeof assetOrId === 'object' && assetOrId !== null ? assetOrId.external_code : '';
            const assetLabel = String(rawCode || `#${numericAssetId}`).trim() || `#${numericAssetId}`;

            options.openActionConfirmModal({
                title: 'Eliminar equipo',
                subtitle: `Confirma la eliminacion del equipo ${assetLabel}. Esta accion no se puede deshacer.`,
                submitLabel: 'Eliminar equipo',
                acknowledgementText: 'Entiendo que este equipo sera eliminado permanentemente.',
                missingConfirmationMessage: 'Debes confirmar la eliminacion para continuar.',
                onSubmit: async () => {
                    await options.api.deleteAsset(numericAssetId);
                    options.closeActionModal(true);
                    if (Number(options.getCurrentSelectedAssetId()) === numericAssetId) {
                        options.setCurrentSelectedAssetId(null);
                        const detailContainer = document.getElementById('assetDetail');
                        if (detailContainer) {
                            detailContainer.innerHTML = '<p class="loading">Selecciona un equipo para ver detalle.</p>';
                        }
                    }
                    options.showNotification('Equipo eliminado correctamente.', 'success');
                    void loadAssets().catch(() => {
                        options.showNotification('El equipo se elimino, pero no pudimos refrescar equipos.', 'warning');
                    });
                },
            });
        }

        return {
            deleteAssetFromWeb,
            formatAssetUpdatedMeta,
            linkAssetFromDetail,
            loadAssetDetail,
            loadAssets,
            renderAssetDetail,
            renderAssetsTable,
            resolveAssetOperationalStateMeta,
            updateAssetStatusFromWeb,
        };
    }

    global.createDashboardAssets = createDashboardAssets;
})(window);

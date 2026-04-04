(function attachDashboardAssetsFactory(global) {
    function createDashboardAssets(options) {
        function setContainerMessage(container, className, message) {
            if (!(container instanceof HTMLElement)) return;
            const copy = document.createElement('p');
            copy.className = className;
            copy.textContent = message;
            container.replaceChildren(copy);
        }

        function renderCountSummary(container, count, singularLabel, pluralLabel = `${singularLabel}s`) {
            if (!(container instanceof HTMLElement)) return;
            container.replaceChildren('Mostrando ');
            const countNode = document.createElement('span');
            countNode.className = 'count';
            countNode.textContent = String(Math.max(0, Number(count) || 0));
            container.append(countNode, ` ${Number(count) === 1 ? singularLabel : pluralLabel}`);
        }

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

        function formatLoanDateTime(rawValue) {
            const parsedMs = Date.parse(String(rawValue || ''));
            if (!Number.isFinite(parsedMs)) return '-';
            return new Date(parsedMs).toLocaleString('es-ES');
        }

        function resolveLoanStatusMeta(rawStatus) {
            const normalized = String(rawStatus || '').trim().toLowerCase();
            if (normalized === 'returned') {
                return {
                    badgeClass: 'loan-returned',
                    label: 'Devuelto',
                    bannerClass: 'asset-loan-banner-returned',
                    title: 'Prestamo cerrado',
                };
            }
            if (normalized === 'overdue') {
                return {
                    badgeClass: 'loan-overdue',
                    label: 'Vencido',
                    bannerClass: 'asset-loan-banner-overdue',
                    title: 'Prestamo vencido',
                };
            }
            return {
                badgeClass: 'loan-active',
                label: 'Activo',
                bannerClass: 'asset-loan-banner-active',
                title: 'Prestamo activo',
            };
        }

        function createActionField({ id, label, type = 'text', placeholder = '', value = '', rows = 4 } = {}) {
            const group = document.createElement('div');
            group.className = 'input-group';
            const labelNode = document.createElement('label');
            labelNode.setAttribute('for', id);
            labelNode.textContent = label;
            let control;
            if (type === 'textarea') {
                control = document.createElement('textarea');
                control.rows = rows;
            } else {
                control = document.createElement('input');
                control.type = type;
            }
            control.id = id;
            control.placeholder = placeholder;
            control.value = value;
            group.append(labelNode, control);
            return group;
        }

        function createLoanHistoryItem(loan) {
            const item = document.createElement('article');
            item.className = 'asset-loan-item';

            const header = document.createElement('div');
            header.className = 'asset-loan-item-header';
            const route = document.createElement('strong');
            route.className = 'asset-loan-route';
            route.textContent = `${loan.original_client || '-'} -> ${loan.borrowing_client || '-'}`;
            const statusBadge = document.createElement('span');
            const statusMeta = resolveLoanStatusMeta(loan.status);
            statusBadge.className = `badge ${statusMeta.badgeClass}`;
            statusBadge.textContent = statusMeta.label;
            header.append(route, statusBadge);

            const meta = document.createElement('p');
            meta.className = 'asset-loan-item-meta';
            const metaParts = [
                `Salida: ${formatLoanDateTime(loan.loaned_at)}`,
                loan.expected_return_at ? `Esperado: ${formatLoanDateTime(loan.expected_return_at)}` : 'Sin retorno estimado',
                loan.returned_at ? `Devuelto: ${formatLoanDateTime(loan.returned_at)}` : null,
                loan.loaned_by_username ? `Por: ${loan.loaned_by_username}` : null,
                loan.returned_by_username ? `Devuelto por: ${loan.returned_by_username}` : null,
            ].filter(Boolean);
            meta.textContent = metaParts.join(' | ');

            item.append(header, meta);

            if (loan.notes) {
                const notes = document.createElement('p');
                notes.className = 'asset-loan-item-notes';
                notes.textContent = `Notas: ${loan.notes}`;
                item.appendChild(notes);
            }

            if (loan.return_notes) {
                const returnNotes = document.createElement('p');
                returnNotes.className = 'asset-loan-item-notes';
                returnNotes.textContent = `Cierre: ${loan.return_notes}`;
                item.appendChild(returnNotes);
            }

            return item;
        }

        async function refreshAssetOperationalDetail(assetId, successMessage = '') {
            options.closeActionModal(true);
            if (successMessage) {
                options.showNotification(successMessage, 'success');
            }
            try {
                await loadAssetDetail(assetId, { keepSelection: true });
                await loadAssets();
            } catch (_error) {
                options.showNotification('La accion se guardo, pero no pudimos refrescar el detalle del equipo.', 'warning');
            }
        }

        function openCreateLoanModal(asset) {
            if (!options.requireActiveSession()) return;
            if (!options.canCurrentUserEditAssets()) {
                options.showNotification('Solo admin o plataforma puede registrar prestamos.', 'warning');
                return;
            }

            const assetId = Number.parseInt(String(asset?.id || ''), 10);
            if (!Number.isInteger(assetId) || assetId <= 0) {
                options.showNotification('asset_id invalido.', 'error');
                return;
            }

            const fields = document.createDocumentFragment();
            fields.append(
                createActionField({
                    id: 'assetLoanBorrowingClientInput',
                    label: 'Cliente receptor',
                    placeholder: 'Cliente o sede que recibe el equipo',
                }),
                createActionField({
                    id: 'assetLoanExpectedReturnInput',
                    label: 'Retorno esperado',
                    type: 'datetime-local',
                }),
                createActionField({
                    id: 'assetLoanNotesInput',
                    label: 'Notas operativas',
                    type: 'textarea',
                    placeholder: 'Motivo del prestamo, contacto o condiciones de entrega',
                    rows: 4,
                }),
            );

            options.openActionModal({
                title: 'Prestar equipo',
                subtitle: `Registra el prestamo temporal de ${asset.external_code || `#${assetId}`}.`,
                submitLabel: 'Registrar prestamo',
                focusId: 'assetLoanBorrowingClientInput',
                fields,
                onSubmit: async () => {
                    const borrowingClient = String(
                        document.getElementById('assetLoanBorrowingClientInput')?.value || '',
                    ).trim();
                    const expectedReturnRaw = String(
                        document.getElementById('assetLoanExpectedReturnInput')?.value || '',
                    ).trim();
                    const notes = String(document.getElementById('assetLoanNotesInput')?.value || '').trim();

                    if (!borrowingClient) {
                        throw new Error('Debes indicar el cliente receptor.');
                    }

                    let expectedReturnAt = null;
                    if (expectedReturnRaw) {
                        const parsed = new Date(expectedReturnRaw);
                        if (Number.isNaN(parsed.getTime())) {
                            throw new Error('La fecha de retorno es invalida.');
                        }
                        expectedReturnAt = parsed.toISOString();
                    }

                    await options.api.createAssetLoan(assetId, {
                        borrowing_client: borrowingClient,
                        expected_return_at: expectedReturnAt,
                        notes,
                    });

                    await refreshAssetOperationalDetail(
                        assetId,
                        `Prestamo registrado para ${asset.external_code || `#${assetId}`}.`,
                    );
                },
            });
        }

        function openReturnLoanModal(asset, loan) {
            if (!options.requireActiveSession()) return;
            if (!options.canCurrentUserEditAssets()) {
                options.showNotification('Solo admin o plataforma puede registrar devoluciones.', 'warning');
                return;
            }

            const loanId = Number.parseInt(String(loan?.id || ''), 10);
            const assetId = Number.parseInt(String(asset?.id || ''), 10);
            if (!Number.isInteger(loanId) || loanId <= 0 || !Number.isInteger(assetId) || assetId <= 0) {
                options.showNotification('No pudimos identificar el prestamo activo.', 'error');
                return;
            }

            const fields = document.createDocumentFragment();
            const summary = document.createElement('div');
            summary.className = 'asset-loan-action-summary';
            summary.textContent =
                `${loan.original_client || '-'} -> ${loan.borrowing_client || '-'} | ` +
                `Salida: ${formatLoanDateTime(loan.loaned_at)} | ` +
                (loan.expected_return_at
                    ? `Retorno esperado: ${formatLoanDateTime(loan.expected_return_at)}`
                    : 'Sin retorno esperado');
            fields.append(
                summary,
                createActionField({
                    id: 'assetLoanReturnNotesInput',
                    label: 'Notas de devolucion',
                    type: 'textarea',
                    placeholder: 'Estado del equipo al volver, faltantes o observaciones',
                    rows: 4,
                }),
            );

            options.openActionModal({
                title: 'Registrar devolucion',
                subtitle: `Cierra el prestamo activo de ${asset.external_code || `#${assetId}`}.`,
                submitLabel: 'Registrar devolucion',
                focusId: 'assetLoanReturnNotesInput',
                fields,
                onSubmit: async () => {
                    const returnNotes = String(
                        document.getElementById('assetLoanReturnNotesInput')?.value || '',
                    ).trim();

                    await options.api.returnAssetLoan(loanId, {
                        return_notes: returnNotes,
                    });

                    await refreshAssetOperationalDetail(
                        assetId,
                        `Devolucion registrada para ${asset.external_code || `#${assetId}`}.`,
                    );
                },
            });
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
            const loans = Array.isArray(data?.loans) ? data.loans : [];
            const activeLoan = loans.find((loan) => String(loan?.status || '').toLowerCase() !== 'returned') || null;
            const loanMeta = activeLoan ? resolveLoanStatusMeta(activeLoan.status) : null;
            const activeLoanCount = Number(data?.active_loan_count) || 0;
            const overdueLoanCount = Number(data?.overdue_loan_count) || 0;
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
                createAssetDetailMetaItem('Cliente operativo', asset.client_name || '-'),
                createAssetDetailMetaItem('Serie', asset.serial_number || '-'),
                createAssetDetailMetaItem('Actualizado', `${updatedMeta.relative} | ${updatedMeta.absolute}`),
                createAssetDetailMetaItem('ID interno', `#${asset.id || '-'}`),
                createAssetDetailMetaItem(
                    'Prestamos',
                    activeLoanCount
                        ? `${activeLoanCount} activo${activeLoanCount === 1 ? '' : 's'} | ${overdueLoanCount} vencido${overdueLoanCount === 1 ? '' : 's'}`
                        : 'Sin prestamos activos',
                ),
            );
            summary.appendChild(metaGrid);
            container.appendChild(summary);

            const activeLink = data?.active_link;
            const activeLinkBanner = document.createElement('div');
            activeLinkBanner.className = 'asset-active-link-banner';
            if (activeLink?.installation_id) {
                activeLinkBanner.textContent =
                    `Contexto activo | Registro #${activeLink.installation_id}` +
                    (activeLink.installation_client_name ? ` | ${activeLink.installation_client_name}` : '');
            } else {
                activeLinkBanner.textContent = 'Sin contexto activo. Puedes crear la incidencia y definir el registro durante el flujo.';
            }
            container.appendChild(activeLinkBanner);

            if (typeof options.renderEntityTechnicianAssignmentsPanel === 'function') {
                const techniciansPanel = await options.renderEntityTechnicianAssignmentsPanel({
                    entityType: 'asset',
                    entityId: asset.id,
                    entityLabel: `equipo ${asset.external_code || `#${asset.id}`}`,
                    title: 'Técnicos del equipo',
                    emptyText: 'Sin técnicos asignados a este equipo.',
                    onApplied: async () => {
                        await loadAssetDetail(asset.id, { keepSelection: true });
                    },
                });
                container.appendChild(techniciansPanel);
            }

            if (activeLoan && loanMeta) {
                const loanBanner = document.createElement('section');
                loanBanner.className = `asset-loan-banner ${loanMeta.bannerClass}`;

                const loanCopy = document.createElement('div');
                loanCopy.className = 'asset-loan-banner-copy';
                const loanTitle = document.createElement('strong');
                loanTitle.className = 'asset-loan-banner-title';
                loanTitle.textContent = `${loanMeta.title} | ${activeLoan.borrowing_client || '-'}`;
                const loanDescription = document.createElement('p');
                loanDescription.className = 'asset-loan-banner-description';
                loanDescription.textContent =
                    `Origen: ${activeLoan.original_client || '-'} | ` +
                    `Salida: ${formatLoanDateTime(activeLoan.loaned_at)} | ` +
                    (activeLoan.expected_return_at
                        ? `Retorno esperado: ${formatLoanDateTime(activeLoan.expected_return_at)}`
                        : 'Sin retorno comprometido');
                loanCopy.append(loanTitle, loanDescription);

                const loanBadge = document.createElement('span');
                loanBadge.className = `badge ${loanMeta.badgeClass}`;
                loanBadge.textContent = loanMeta.label;
                loanBanner.append(loanCopy, loanBadge);
                container.appendChild(loanBanner);
            }

            const toolbar = document.createElement('div');
            toolbar.className = 'asset-detail-toolbar';
            const primaryActions = document.createElement('div');
            primaryActions.className = 'asset-detail-toolbar-primary';
            const secondaryActions = document.createElement('div');
            secondaryActions.className = 'asset-detail-toolbar-secondary';

            const createIncidentBtn = document.createElement('button');
            createIncidentBtn.type = 'button';
            createIncidentBtn.className = 'btn-primary';
            createIncidentBtn.textContent = activeLink?.installation_id ? 'Nueva incidencia' : 'Nueva incidencia + contexto';
            createIncidentBtn.addEventListener('click', () => {
                void options.createIncidentForAsset(asset.id);
            });

            const linkBtn = document.createElement('button');
            linkBtn.type = 'button';
            linkBtn.className = 'btn-secondary';
            linkBtn.textContent = activeLink?.installation_id ? 'Ajustar contexto' : 'Vincular registro';
            linkBtn.addEventListener('click', () => {
                void linkAssetFromDetail(asset.id);
            });

            const qrBtn = document.createElement('button');
            qrBtn.type = 'button';
            qrBtn.className = 'btn-secondary';
            qrBtn.textContent = 'Ver QR';
            qrBtn.classList.add('asset-detail-toolbar-utility-btn');
            qrBtn.addEventListener('click', () => {
                options.showAssetQrModal(asset);
            });
            primaryActions.appendChild(createIncidentBtn);
            secondaryActions.append(linkBtn, qrBtn);

            if (options.canCurrentUserEditAssets()) {
                const loanBtn = document.createElement('button');
                loanBtn.type = 'button';
                loanBtn.className = activeLoan ? 'btn-primary' : 'btn-secondary';
                loanBtn.textContent = activeLoan ? 'Registrar devolucion' : 'Prestar equipo';
                loanBtn.addEventListener('click', () => {
                    if (activeLoan) {
                        openReturnLoanModal(asset, activeLoan);
                    } else {
                        openCreateLoanModal(asset);
                    }
                });
                if (activeLoan) {
                    loanBtn.className = 'btn-primary';
                    primaryActions.appendChild(loanBtn);
                } else {
                    secondaryActions.appendChild(loanBtn);
                }

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
                deleteBtn.className = 'btn-secondary btn-danger-subtle asset-detail-danger-action';
                deleteBtn.textContent = 'Eliminar equipo';
                deleteBtn.addEventListener('click', () => {
                    void deleteAssetFromWeb(asset);
                });

                const moreActions = document.createElement('details');
                moreActions.className = 'asset-detail-more-actions';

                const moreSummary = document.createElement('summary');
                moreSummary.textContent = 'Mas acciones';

                const moreList = document.createElement('div');
                moreList.className = 'asset-detail-more-actions-list';
                moreList.append(statusBtn, deleteBtn);
                moreActions.append(moreSummary, moreList);
                secondaryActions.appendChild(moreActions);
            }
            toolbar.append(primaryActions, secondaryActions);
            container.appendChild(toolbar);

            if (loans.length || data?.loan_error) {
                const loansHistory = document.createElement('details');
                loansHistory.className = 'asset-loans-history';
                if (activeLoan) {
                    loansHistory.open = true;
                }

                const loansSummary = document.createElement('summary');
                loansSummary.textContent = data?.loan_error
                    ? 'Prestamos no disponibles'
                    : `Historial de prestamos (${loans.length})`;
                loansHistory.appendChild(loansSummary);

                if (data?.loan_error) {
                    const unavailable = document.createElement('p');
                    unavailable.className = 'asset-muted asset-loan-unavailable';
                    unavailable.textContent = data.loan_error;
                    loansHistory.appendChild(unavailable);
                } else {
                    const loansList = document.createElement('div');
                    loansList.className = 'asset-loans-list';
                    loans.forEach((loan) => {
                        loansList.appendChild(createLoanHistoryItem(loan));
                    });
                    loansHistory.appendChild(loansList);
                }

                container.appendChild(loansHistory);
            }

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
                setContainerMessage(detailContainer, 'loading', 'Cargando detalle del equipo...');
            }

            try {
                const detailData = await options.api.getAssetIncidents(numericAssetId, { limit: 150 });
                let loansData = {
                    items: [],
                    active_count: 0,
                    overdue_count: 0,
                    loan_error: '',
                };

                try {
                    const response = await options.api.getAssetLoans(numericAssetId);
                    loansData = {
                        items: Array.isArray(response?.items) ? response.items : [],
                        active_count: Number(response?.active_count) || 0,
                        overdue_count: Number(response?.overdue_count) || 0,
                        loan_error: '',
                    };
                } catch (loanError) {
                    loansData.loan_error = loanError?.message || 'No pudimos cargar prestamos.';
                }

                await renderAssetDetail({
                    ...detailData,
                    loans: loansData.items,
                    active_loan_count: loansData.active_count,
                    overdue_loan_count: loansData.overdue_count,
                    loan_error: loansData.loan_error,
                });
            } catch (err) {
                if (detailContainer) {
                    setContainerMessage(detailContainer, 'error', err.message || String(err));
                }
            }
        }

        async function loadAssets() {
            if (!options.requireActiveSession()) return;
            const tableContainer = document.getElementById('assetsTable');
            const resultsCount = document.getElementById('assetsResultsCount');
            const searchInput = document.getElementById('assetsSearchInput');
            if (!tableContainer) return;

            setContainerMessage(tableContainer, 'loading', 'Cargando equipos...');
            if (resultsCount) {
                setContainerMessage(resultsCount, 'loading', 'Buscando...');
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
                    renderCountSummary(resultsCount, assets.length, 'equipo');
                }

                const currentSelectedAssetId = options.getCurrentSelectedAssetId();
                if (currentSelectedAssetId) {
                    const selectedAsset = assets.find((item) => Number(item.id) === Number(currentSelectedAssetId));
                    if (selectedAsset) {
                        await loadAssetDetail(selectedAsset.id, { keepSelection: true });
                    }
                }
            } catch (_err) {
                setContainerMessage(tableContainer, 'error', 'Error cargando equipos');
                if (resultsCount) {
                    resultsCount.textContent = 'Error al cargar';
                }
            }
        }

        function renderAssetsTable(assets) {
            const container = document.getElementById('assetsTable');
            if (!container) return;
            container.replaceChildren();
            container.dataset.mobileCards = 'true';

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
                equipmentCell.dataset.label = 'Equipo';
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
                clientCell.dataset.label = 'Cliente';
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
                statusCell.dataset.label = 'Estado';
                const statusBadge = document.createElement('span');
                const stateMeta = resolveAssetOperationalStateMeta(asset.status);
                statusBadge.className = `badge ${stateMeta.toneClass}`;
                statusBadge.textContent = stateMeta.label;
                statusCell.appendChild(statusBadge);

                const updatedCell = document.createElement('td');
                updatedCell.dataset.label = 'Actualizado';
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
                actionsCell.dataset.label = 'Acciones';
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
                options.showNotification('Solo admin o plataforma puede cambiar estado de equipos.', 'warning');
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
                options.showNotification('Solo admin o plataforma puede eliminar equipos.', 'warning');
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
                            setContainerMessage(detailContainer, 'loading', 'Selecciona un equipo para ver detalle.');
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

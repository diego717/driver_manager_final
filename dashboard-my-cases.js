(function attachDashboardMyCasesFactory(global) {
    'use strict';

    function createDashboardMyCases(options) {
        const STATUS_GROUPS = [
            { key: 'open', label: 'Pendientes', icon: 'schedule', emptyLabel: 'No hay incidencias pendientes.' },
            { key: 'in_progress', label: 'En curso', icon: 'pending_actions', emptyLabel: 'No hay incidencias en curso.' },
            { key: 'paused', label: 'Pausadas', icon: 'pause_circle', emptyLabel: 'No hay incidencias pausadas.' },
            { key: 'resolved', label: 'Resueltas', icon: 'task_alt', emptyLabel: 'No hay incidencias resueltas.' },
        ];

        const SOURCE_PRIORITY = {
            incident: 0,
            installation: 1,
            asset: 2,
        };

        const ROLE_PRIORITY = {
            owner: 0,
            assistant: 1,
            reviewer: 2,
        };

        let currentLinkedTechnician = null;
        let currentAssignments = [];
        let currentIncidents = [];
        let loadPromise = null;

        function normalizeStatus(value) {
            return typeof options.normalizeIncidentStatus === 'function'
                ? options.normalizeIncidentStatus(value)
                : String(value || '').trim().toLowerCase() || 'open';
        }

        function normalizeSeverity(value) {
            return typeof options.normalizeSeverity === 'function'
                ? options.normalizeSeverity(value)
                : String(value || '').trim().toLowerCase() || 'medium';
        }

        function getContainer() {
            return document.getElementById('myCasesList');
        }

        function getSummaryContainer() {
            return document.getElementById('myCasesSummary');
        }

        function getContextNode() {
            return document.getElementById('myCasesContext');
        }

        function parseStrictInteger(value) {
            return typeof options.parseStrictInteger === 'function'
                ? options.parseStrictInteger(value)
                : Number.parseInt(String(value || ''), 10);
        }

        function getSourcePriority(source) {
            const normalized = String(source || '').trim().toLowerCase();
            return Object.prototype.hasOwnProperty.call(SOURCE_PRIORITY, normalized)
                ? SOURCE_PRIORITY[normalized]
                : 99;
        }

        function getRolePriority(role) {
            const normalized = String(role || '').trim().toLowerCase();
            return Object.prototype.hasOwnProperty.call(ROLE_PRIORITY, normalized)
                ? ROLE_PRIORITY[normalized]
                : 99;
        }

        function getRoleLabel(role) {
            const normalized = String(role || '').trim().toLowerCase();
            if (normalized === 'assistant') return 'Apoyo';
            if (normalized === 'reviewer') return 'Revision';
            return 'Responsable';
        }

        function getSourceLabel(source, incident) {
            const normalized = String(source || '').trim().toLowerCase();
            if (normalized === 'installation') {
                return `Caso #${parseStrictInteger(incident?.installation_id) || '-'}`;
            }
            if (normalized === 'asset') {
                return incident?.asset_code
                    ? `Equipo ${incident.asset_code}`
                    : `Equipo #${parseStrictInteger(incident?.asset_id) || '-'}`;
            }
            return 'Asignada directo';
        }

        function formatRelativeDate(value) {
            const parsed = new Date(value);
            if (Number.isNaN(parsed.getTime())) return 'Sin fecha';
            return parsed.toLocaleString('es-UY', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });
        }

        function extractIncidentArray(response) {
            if (Array.isArray(response)) return response;
            if (Array.isArray(response?.incidents)) return response.incidents;
            return [];
        }

        function extractIncidentItem(response) {
            if (response?.incident && typeof response.incident === 'object') {
                return response.incident;
            }
            if (response && typeof response === 'object' && Number.isInteger(parseStrictInteger(response.id))) {
                return response;
            }
            return null;
        }

        function buildIncidentSortValue(incident) {
            const severity = normalizeSeverity(incident?.severity);
            const severityWeight = severity === 'critical'
                ? 0
                : severity === 'high'
                    ? 1
                    : severity === 'medium'
                        ? 2
                        : 3;
            const status = normalizeStatus(incident?.incident_status);
            const statusWeight = status === 'open'
                ? 0
                : status === 'in_progress'
                    ? 1
                    : status === 'paused'
                        ? 2
                        : 3;
            const referenceDate = Date.parse(
                String(
                    incident?.status_updated_at
                    || incident?.resolved_at
                    || incident?.created_at
                    || '',
                ),
            );
            return {
                severityWeight,
                statusWeight,
                dateWeight: Number.isFinite(referenceDate) ? -referenceDate : 0,
                idWeight: -(parseStrictInteger(incident?.id) || 0),
            };
        }

        function sortIncidents(items) {
            return [...items].sort((left, right) => {
                const leftSort = buildIncidentSortValue(left);
                const rightSort = buildIncidentSortValue(right);
                if (leftSort.statusWeight !== rightSort.statusWeight) {
                    return leftSort.statusWeight - rightSort.statusWeight;
                }
                if (leftSort.severityWeight !== rightSort.severityWeight) {
                    return leftSort.severityWeight - rightSort.severityWeight;
                }
                if (leftSort.dateWeight !== rightSort.dateWeight) {
                    return leftSort.dateWeight - rightSort.dateWeight;
                }
                return leftSort.idWeight - rightSort.idWeight;
            });
        }

        function rememberIncident(store, incident, assignment, sourceType) {
            const incidentId = parseStrictInteger(incident?.id);
            if (!Number.isInteger(incidentId) || incidentId <= 0) return;

            const candidate = {
                ...incident,
                assignment_source: sourceType,
                assignment_role: String(assignment?.assignment_role || 'owner').trim().toLowerCase() || 'owner',
                assigned_at: assignment?.assigned_at || null,
            };

            const current = store.get(incidentId);
            if (!current) {
                store.set(incidentId, candidate);
                return;
            }

            const nextSourcePriority = getSourcePriority(candidate.assignment_source);
            const currentSourcePriority = getSourcePriority(current.assignment_source);
            if (nextSourcePriority < currentSourcePriority) {
                store.set(incidentId, candidate);
                return;
            }

            if (
                nextSourcePriority === currentSourcePriority &&
                getRolePriority(candidate.assignment_role) < getRolePriority(current.assignment_role)
            ) {
                store.set(incidentId, candidate);
            }
        }

        function renderSummaryCards(incidents) {
            const summary = getSummaryContainer();
            if (!summary) return;

            const counts = {
                total: incidents.length,
                open: incidents.filter((incident) => normalizeStatus(incident?.incident_status) === 'open').length,
                in_progress: incidents.filter((incident) => normalizeStatus(incident?.incident_status) === 'in_progress').length,
                paused: incidents.filter((incident) => normalizeStatus(incident?.incident_status) === 'paused').length,
                resolved: incidents.filter((incident) => normalizeStatus(incident?.incident_status) === 'resolved').length,
            };

            const fragment = document.createDocumentFragment();
            [
                { key: 'total', label: 'Total visible', tone: 'neutral' },
                { key: 'open', label: 'Pendientes', tone: 'open' },
                { key: 'in_progress', label: 'En curso', tone: 'in_progress' },
                { key: 'paused', label: 'Pausadas', tone: 'paused' },
                { key: 'resolved', label: 'Resueltas', tone: 'resolved' },
            ].forEach((item) => {
                const card = document.createElement('article');
                card.className = `my-cases-summary-card tone-${item.tone}`;

                const label = document.createElement('small');
                label.textContent = item.label;

                const value = document.createElement('strong');
                value.textContent = String(counts[item.key] || 0);

                card.append(label, value);
                fragment.append(card);
            });

            summary.replaceChildren(fragment);
        }

        function renderContextCopy(technician, assignments, incidents) {
            const contextNode = getContextNode();
            if (!contextNode) return;

            if (!technician?.id) {
                contextNode.textContent = 'Vincula un tecnico a tu usuario web para ver estados y prioridades de tus incidencias asignadas.';
                return;
            }

            const resolvedCount = incidents.filter((incident) => normalizeStatus(incident?.incident_status) === 'resolved').length;
            const openCount = incidents.filter((incident) => normalizeStatus(incident?.incident_status) !== 'resolved').length;
            const employeeCode = String(technician.employee_code || '').trim();
            const technicianLabel = employeeCode
                ? `${technician.display_name} (${employeeCode})`
                : technician.display_name;

            contextNode.textContent = `${technicianLabel} · ${assignments.length} asignacion(es) activas · ${openCount} abiertas/operativas · ${resolvedCount} resueltas.`;
        }

        function renderLoadingState() {
            const summary = getSummaryContainer();
            const container = getContainer();
            if (summary) {
                summary.innerHTML = `
                    <article class="my-cases-summary-card tone-neutral is-loading">
                        <small>Sincronizando</small>
                        <strong>...</strong>
                    </article>
                `;
            }
            if (container) {
                container.innerHTML = '<p class="loading">Cargando tus casos...</p>';
            }
        }

        function renderUnlinkedState() {
            renderSummaryCards([]);
            renderContextCopy(null, [], []);
            const container = getContainer();
            if (!container) return;
            if (typeof options.renderContextualEmptyState === 'function') {
                options.renderContextualEmptyState(container, {
                    title: 'Sin tecnico vinculado',
                    description: 'Tu usuario web no tiene un tecnico asociado todavia. Al vincularlo, aqui vas a ver pendientes, casos en curso, pausas y resueltos.',
                    tone: 'neutral',
                });
                return;
            }
            container.innerHTML = '<p class="empty-state">Sin tecnico vinculado.</p>';
        }

        async function renderTabs(incidents) {
            const container = getContainer();
            if (!container) return;

            if (!incidents.length) {
                if (typeof options.renderContextualEmptyState === 'function') {
                    options.renderContextualEmptyState(container, {
                        title: 'Sin incidencias asignadas',
                        description: 'Cuando te asignen incidencias, esta bandeja va a ordenarlas por estado para que veas rapido que sigue abierto y que ya quedo resuelto.',
                        tone: 'neutral',
                    });
                    return;
                }
                container.innerHTML = '<p class="empty-state">No tienes incidencias asignadas.</p>';
                return;
            }

            const groups = new Map();
            STATUS_GROUPS.forEach((group) => groups.set(group.key, []));
            incidents.forEach((incident) => {
                const status = normalizeStatus(incident?.incident_status);
                if (!groups.has(status)) {
                    groups.set(status, []);
                }
                groups.get(status).push(incident);
            });

            const tabsNav = document.createElement('div');
            tabsNav.className = 'my-cases-tabs';
            tabsNav.setAttribute('role', 'tablist');

            const panelsWrap = document.createElement('div');
            panelsWrap.className = 'my-cases-panels';

            const defaultTab = STATUS_GROUPS.find((group) => (groups.get(group.key) || []).length > 0)?.key || STATUS_GROUPS[0].key;

            for (const group of STATUS_GROUPS) {
                const incidentsForGroup = sortIncidents(groups.get(group.key) || []);

                const tabButton = document.createElement('button');
                tabButton.type = 'button';
                tabButton.className = `my-cases-tab${group.key === defaultTab ? ' active' : ''}`;
                tabButton.dataset.tab = group.key;
                tabButton.setAttribute('role', 'tab');
                tabButton.setAttribute('aria-selected', group.key === defaultTab ? 'true' : 'false');
                tabButton.setAttribute('aria-controls', `myCasesPanel-${group.key}`);
                tabButton.setAttribute('id', `myCasesTab-${group.key}`);
                options.setElementTextWithMaterialIcon(tabButton, group.icon, `${group.label} (${incidentsForGroup.length})`);
                tabsNav.appendChild(tabButton);

                const panel = document.createElement('section');
                panel.className = 'my-cases-panel';
                panel.id = `myCasesPanel-${group.key}`;
                panel.dataset.tab = group.key;
                panel.setAttribute('role', 'tabpanel');
                panel.setAttribute('aria-labelledby', `myCasesTab-${group.key}`);
                panel.hidden = group.key !== defaultTab;

                if (!incidentsForGroup.length) {
                    const empty = document.createElement('p');
                    empty.className = 'empty-state';
                    empty.textContent = group.emptyLabel;
                    panel.appendChild(empty);
                } else {
                    const grid = document.createElement('div');
                    grid.className = 'incidents-grid my-cases-grid';

                    for (const incident of incidentsForGroup) {
                        const shell = document.createElement('article');
                        shell.className = 'my-cases-item';

                        const meta = document.createElement('div');
                        meta.className = 'my-cases-item-meta';

                        const sourcePill = document.createElement('span');
                        sourcePill.className = 'my-cases-pill';
                        sourcePill.textContent = getSourceLabel(incident.assignment_source, incident);

                        const rolePill = document.createElement('span');
                        rolePill.className = 'my-cases-pill';
                        rolePill.textContent = getRoleLabel(incident.assignment_role);

                        const datePill = document.createElement('span');
                        datePill.className = 'my-cases-pill';
                        datePill.textContent = formatRelativeDate(
                            incident?.resolved_at || incident?.status_updated_at || incident?.created_at,
                        );

                        meta.append(sourcePill, rolePill, datePill);
                        shell.appendChild(meta);

                        const cardMount = document.createElement('div');
                        shell.appendChild(cardMount);
                        await options.appendIncidentCard(cardMount, incident, {
                            installationId: parseStrictInteger(incident?.installation_id),
                            assetId: parseStrictInteger(incident?.asset_id),
                            includeAssetChip: true,
                            showReporter: false,
                        });

                        grid.appendChild(shell);
                    }

                    panel.appendChild(grid);
                }

                panelsWrap.appendChild(panel);
            }

            container.replaceChildren(tabsNav, panelsWrap);

            tabsNav.addEventListener('click', (event) => {
                const button = event.target.closest('.my-cases-tab');
                if (!(button instanceof HTMLElement) || button.classList.contains('active')) {
                    return;
                }

                const nextTab = button.dataset.tab;
                tabsNav.querySelectorAll('.my-cases-tab').forEach((tabNode) => {
                    tabNode.classList.toggle('active', tabNode === button);
                    tabNode.setAttribute('aria-selected', tabNode === button ? 'true' : 'false');
                });
                panelsWrap.querySelectorAll('.my-cases-panel').forEach((panelNode) => {
                    panelNode.hidden = panelNode.dataset.tab !== nextTab;
                });
            });
        }

        async function aggregateIncidentsFromAssignments(assignments) {
            const incidentStore = new Map();
            const directAssignments = [];
            const installationAssignments = new Map();
            const assetAssignments = new Map();

            assignments.forEach((assignment) => {
                const entityType = String(assignment?.entity_type || '').trim().toLowerCase();
                const entityId = parseStrictInteger(assignment?.entity_id);
                if (entityType === 'incident' && Number.isInteger(entityId) && entityId > 0) {
                    directAssignments.push({ assignment, entityId });
                    return;
                }
                if (entityType === 'installation' && Number.isInteger(entityId) && entityId > 0) {
                    if (!installationAssignments.has(entityId)) {
                        installationAssignments.set(entityId, assignment);
                    }
                    return;
                }
                if (entityType === 'asset' && Number.isInteger(entityId) && entityId > 0) {
                    if (!assetAssignments.has(entityId)) {
                        assetAssignments.set(entityId, assignment);
                    }
                }
            });

            await Promise.all([
                ...directAssignments.map(async ({ assignment, entityId }) => {
                    try {
                        const response = await options.api.getIncident(entityId);
                        const incident = extractIncidentItem(response);
                        if (incident) {
                            rememberIncident(incidentStore, incident, assignment, 'incident');
                        }
                    } catch {
                        // Ignore missing incident details so the rest of the queue can still render.
                    }
                }),
                ...Array.from(installationAssignments.entries()).map(async ([installationId, assignment]) => {
                    try {
                        const response = await options.api.getIncidents(installationId);
                        extractIncidentArray(response).forEach((incident) => {
                            rememberIncident(incidentStore, incident, assignment, 'installation');
                        });
                    } catch {
                        // Ignore installation-level fetch failures and keep rendering other assignments.
                    }
                }),
                ...Array.from(assetAssignments.entries()).map(async ([assetId, assignment]) => {
                    try {
                        const response = await options.api.getAssetIncidents(assetId);
                        extractIncidentArray(response).forEach((incident) => {
                            rememberIncident(incidentStore, incident, assignment, 'asset');
                        });
                    } catch {
                        // Ignore asset-level fetch failures and keep rendering other assignments.
                    }
                }),
            ]);

            return sortIncidents(Array.from(incidentStore.values()));
        }

        async function loadMyCasesSection(config = {}) {
            if (!options.requireActiveSession()) {
                return [];
            }

            if (loadPromise && config.force !== true) {
                return loadPromise;
            }

            renderLoadingState();

            loadPromise = (async () => {
                try {
                    if (typeof options.api.getMyLinkedTechnician === 'function') {
                        try {
                            const linkedResponse = await options.api.getMyLinkedTechnician();
                            currentLinkedTechnician = linkedResponse?.technician || null;
                        } catch {
                            await options.loadTechniciansSection?.({ silent: true });
                            currentLinkedTechnician = options.getCurrentLinkedTechnician?.() || null;
                        }
                    } else {
                        await options.loadTechniciansSection?.({ silent: true });
                        currentLinkedTechnician = options.getCurrentLinkedTechnician?.() || null;
                    }
                    if (!currentLinkedTechnician?.id) {
                        currentAssignments = [];
                        currentIncidents = [];
                        renderUnlinkedState();
                        return [];
                    }

                    const assignmentsResponse = await options.api.getTechnicianAssignments(currentLinkedTechnician.id, {
                        includeInactive: false,
                    });
                    currentAssignments = Array.isArray(assignmentsResponse?.assignments)
                        ? assignmentsResponse.assignments.filter((assignment) => !assignment?.unassigned_at)
                        : [];
                    currentIncidents = await aggregateIncidentsFromAssignments(currentAssignments);

                    renderSummaryCards(currentIncidents);
                    renderContextCopy(currentLinkedTechnician, currentAssignments, currentIncidents);
                    await renderTabs(currentIncidents);
                    return currentIncidents;
                } catch (error) {
                    renderSummaryCards([]);
                    renderContextCopy(currentLinkedTechnician, [], []);
                    const container = getContainer();
                    if (container) {
                        options.renderContextualEmptyState?.(container, {
                            title: 'No se pudieron cargar tus casos',
                            description: 'Revisa la sesion o vuelve a intentar la sincronizacion operativa.',
                            tone: 'critical',
                        });
                    }
                    if (config.silent !== true) {
                        options.showNotification(`No se pudieron cargar tus casos: ${error?.message || error}`, 'error');
                    }
                    return [];
                } finally {
                    loadPromise = null;
                }
            })();

            return loadPromise;
        }

        function setupMyCasesRefreshButton() {
            const refreshBtn = document.getElementById('myCasesRefreshBtn');
            if (!refreshBtn || refreshBtn.dataset.bound === 'true') return;
            refreshBtn.dataset.bound = 'true';
            refreshBtn.addEventListener('click', () => {
                void loadMyCasesSection({ force: true });
            });
        }

        return {
            loadMyCasesSection,
            setupMyCasesRefreshButton,
        };
    }

    global.createDashboardMyCases = createDashboardMyCases;
})(window);

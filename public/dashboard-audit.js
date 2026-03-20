(function attachDashboardAuditFactory(global) {
    function createDashboardAudit(options) {
        async function loadAuditLogs() {
            if (!options.requireActiveSession()) return;
            const container = document.getElementById('auditLogs');
            if (!container) return;
            container.innerHTML = '<p class="loading">Cargando logs...</p>';

            try {
                const logs = await options.api.getAuditLogs();
                renderAuditLogs(logs);
            } catch (_error) {
                container.replaceChildren();
                options.renderContextualEmptyState(container, {
                    title: 'No se pudieron cargar los logs',
                    description: 'Reintenta para validar el estado de auditoría.',
                    actionLabel: 'Reintentar',
                    onAction: () => loadAuditLogs(),
                    tone: 'warning',
                });
            }
        }

        function renderAuditLogs(logs) {
            const container = document.getElementById('auditLogs');
            if (!container) return;
            const actionFilter = document.getElementById('auditActionFilter')?.value;
            container.replaceChildren();

            if (!logs || !logs.length) {
                options.renderContextualEmptyState(container, {
                    title: 'Aún no hay logs de auditoría',
                    description: 'Cuando se registren eventos de acceso u operaciones, aparecerán aquí.',
                    actionLabel: 'Actualizar',
                    onAction: () => loadAuditLogs(),
                    tone: 'neutral',
                });
                return;
            }

            let filteredLogs = logs;
            if (actionFilter) {
                filteredLogs = logs.filter((log) => log.action === actionFilter);
            }

            if (filteredLogs.length === 0) {
                options.renderContextualEmptyState(container, {
                    title: 'No hay eventos para ese filtro',
                    description: 'Prueba otro tipo de acción o limpia el filtro actual.',
                    actionLabel: 'Quitar filtro',
                    onAction: () => {
                        const actionFilterSelect = document.getElementById('auditActionFilter');
                        if (actionFilterSelect) {
                            actionFilterSelect.value = '';
                        }
                        renderAuditLogs(logs);
                    },
                    tone: 'neutral',
                });
                return;
            }

            const table = document.createElement('table');
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            ['Fecha', 'Acción', 'Usuario', 'Estado', 'Detalles'].forEach((label) => {
                const th = document.createElement('th');
                th.textContent = label;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);

            const tbody = document.createElement('tbody');

            filteredLogs.forEach((log) => {
                const successIcon = log.success ? 'OK' : 'X';
                const successClass = log.success ? 'success' : 'failed';

                let details = '-';
                if (log.details) {
                    try {
                        const parsed = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                        details = Object.entries(parsed)
                            .map(([key, value]) => `${key}: ${value}`)
                            .slice(0, 2)
                            .join(', ');
                        if (details.length > 50) details = `${details.substring(0, 50)}...`;
                    } catch {
                        details = String(log.details).substring(0, 50);
                    }
                }

                const row = document.createElement('tr');

                const dateCell = document.createElement('td');
                dateCell.textContent = new Date(log.timestamp).toLocaleString('es-ES');

                const actionCell = document.createElement('td');
                const actionCode = document.createElement('code');
                actionCode.className = 'audit-action-code';
                actionCode.textContent = log.action || '-';
                actionCell.appendChild(actionCode);

                const userCell = document.createElement('td');
                const userStrong = document.createElement('strong');
                userStrong.textContent = log.username || '-';
                userCell.appendChild(userStrong);

                const statusCell = document.createElement('td');
                const badge = document.createElement('span');
                badge.className = `badge ${successClass}`;
                badge.textContent = successIcon;
                statusCell.appendChild(badge);

                const detailsCell = document.createElement('td');
                detailsCell.className = 'audit-details-cell';
                detailsCell.textContent = details;

                row.append(dateCell, actionCell, userCell, statusCell, detailsCell);
                tbody.appendChild(row);
            });

            table.append(thead, tbody);
            container.appendChild(table);
        }

        return {
            loadAuditLogs,
            renderAuditLogs,
        };
    }

    global.createDashboardAudit = createDashboardAudit;
})(window);

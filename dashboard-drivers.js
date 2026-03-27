(function attachDashboardDriversFactory(global) {
    function createDashboardDrivers(options) {
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

        function formatDriverSize(bytes, sizeMb) {
            const numericBytes = Number(bytes);
            if (Number.isFinite(numericBytes) && numericBytes > 0) {
                if (numericBytes >= 1024 * 1024) {
                    return `${(numericBytes / (1024 * 1024)).toFixed(2)} MB`;
                }
                return `${(numericBytes / 1024).toFixed(1)} KB`;
            }
            const numericMb = Number(sizeMb);
            if (Number.isFinite(numericMb) && numericMb > 0) {
                return `${numericMb.toFixed(2)} MB`;
            }
            return 'N/A';
        }

        function updateDriverSelectedFileLabel() {
            const label = document.getElementById('driversSelectedFileLabel');
            if (!label) return;
            const selectedDriverFile = options.getSelectedDriverFile();
            if (!selectedDriverFile) {
                label.textContent = 'Sin archivo seleccionado';
                return;
            }
            label.textContent = `${selectedDriverFile.name} (${formatDriverSize(selectedDriverFile.size, null)})`;
        }

        async function loadDrivers() {
            if (!options.requireActiveSession()) return;
            const tableContainer = document.getElementById('driversTable');
            const resultsCount = document.getElementById('driversResultsCount');
            if (!tableContainer) return;

            setContainerMessage(tableContainer, 'loading', 'Cargando drivers...');
            if (resultsCount) {
                setContainerMessage(resultsCount, 'loading', 'Buscando...');
            }

            try {
                const response = await options.api.getDrivers({ limit: 200 });
                const items = Array.isArray(response?.items) ? response.items : [];
                options.setCurrentDriversData(items);
                renderDriversTable(items);

                if (resultsCount) {
                    renderCountSummary(resultsCount, items.length, 'driver');
                }
            } catch (_err) {
                tableContainer.replaceChildren();
                options.renderContextualEmptyState(tableContainer, {
                    title: 'No se pudieron cargar los drivers',
                    description: 'Intenta nuevamente en unos segundos.',
                    actionLabel: 'Reintentar',
                    onAction: () => loadDrivers(),
                    tone: 'warning',
                });
                if (resultsCount) {
                    resultsCount.textContent = 'Error al cargar';
                }
            }
        }

        function renderDriversTable(drivers) {
            const container = document.getElementById('driversTable');
            if (!container) return;
            container.replaceChildren();

            if (!drivers || !drivers.length) {
                options.renderContextualEmptyState(container, {
                    title: 'Todavia no hay drivers cargados',
                    description: 'Sube el primer paquete para habilitar instalaciones por marca y version.',
                    actionLabel: 'Subir primer driver',
                    onAction: () => document.getElementById('driverPickFileBtn')?.click(),
                    tone: 'info',
                });
                return;
            }

            const table = document.createElement('table');
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            ['Marca', 'Version', 'Archivo', 'Tamano', 'Subido', 'Acciones'].forEach((label) => {
                const th = document.createElement('th');
                th.textContent = label;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);

            const tbody = document.createElement('tbody');
            for (const driver of drivers) {
                const row = document.createElement('tr');

                const brandCell = document.createElement('td');
                brandCell.textContent = driver.brand || '-';

                const versionCell = document.createElement('td');
                versionCell.textContent = driver.version || '-';

                const fileCell = document.createElement('td');
                fileCell.textContent = driver.filename || '-';

                const sizeCell = document.createElement('td');
                sizeCell.textContent = formatDriverSize(driver.size_bytes, driver.size_mb);

                const uploadedCell = document.createElement('td');
                uploadedCell.textContent = driver.last_modified
                    ? String(driver.last_modified)
                    : (driver.uploaded ? new Date(driver.uploaded).toLocaleString('es-ES') : '-');

                const actionsCell = document.createElement('td');
                const downloadBtn = document.createElement('button');
                downloadBtn.type = 'button';
                downloadBtn.className = 'btn-secondary table-action-btn';
                downloadBtn.textContent = 'Descargar';
                downloadBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const key = String(driver.key || '').trim();
                    if (!key) return;
                    window.open(`/web/drivers/download?key=${encodeURIComponent(key)}`, '_blank', 'noopener');
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'btn-secondary table-action-btn';
                deleteBtn.textContent = 'Eliminar';
                deleteBtn.classList.add('spaced-action-btn');
                deleteBtn.addEventListener('click', async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const key = String(driver.key || '').trim();
                    if (!key) return;
                    const driverLabel = String(`${driver.brand || ''} ${driver.version || ''}`).trim() || 'sin nombre';
                    options.openActionConfirmModal({
                        title: 'Eliminar driver',
                        subtitle: `Confirma la eliminacion de ${driverLabel}. Esta accion no se puede deshacer.`,
                        submitLabel: 'Eliminar driver',
                        acknowledgementText: 'Entiendo que este driver sera eliminado permanentemente.',
                        missingConfirmationMessage: 'Debes confirmar la eliminacion para continuar.',
                        onSubmit: async () => {
                            await options.api.deleteDriver(key);
                            options.closeActionModal(true);
                            options.showNotification('Driver eliminado', 'success');
                            await loadDrivers();
                        },
                    });
                });

                actionsCell.append(downloadBtn, deleteBtn);
                row.append(brandCell, versionCell, fileCell, sizeCell, uploadedCell, actionsCell);
                tbody.appendChild(row);
            }

            table.append(thead, tbody);
            container.appendChild(table);
        }

        async function uploadDriverFromWeb() {
            if (!options.requireActiveSession()) return;
            const brandInput = document.getElementById('driverBrandInput');
            const versionInput = document.getElementById('driverVersionInput');
            const descriptionInput = document.getElementById('driverDescriptionInput');
            const uploadBtn = document.getElementById('driverUploadBtn');
            const brand = String(brandInput?.value || '').trim();
            const version = String(versionInput?.value || '').trim();
            const description = String(descriptionInput?.value || '').trim();
            const selectedDriverFile = options.getSelectedDriverFile();

            if (!brand) {
                options.showNotification('La marca es obligatoria.', 'error');
                return;
            }
            if (!version) {
                options.showNotification('La version es obligatoria.', 'error');
                return;
            }
            if (!selectedDriverFile) {
                options.showNotification('Selecciona un archivo para subir.', 'error');
                return;
            }

            const previousText = uploadBtn?.textContent || '';
            if (uploadBtn) {
                uploadBtn.disabled = true;
                uploadBtn.textContent = 'Subiendo...';
            }

            try {
                await options.api.uploadDriver(selectedDriverFile, {
                    brand,
                    version,
                    description,
                });
                options.showNotification(`Driver ${brand} ${version} subido correctamente.`, 'success');
                options.setSelectedDriverFile(null);
                if (descriptionInput) descriptionInput.value = '';
                if (versionInput) versionInput.value = '';
                if (brandInput) brandInput.value = '';
                updateDriverSelectedFileLabel();
                await loadDrivers();
            } catch (err) {
                options.showNotification(`No se pudo subir driver: ${err.message || err}`, 'error');
            } finally {
                if (uploadBtn) {
                    uploadBtn.disabled = false;
                    uploadBtn.textContent = previousText || 'Subir driver';
                }
            }
        }

        function setSelectedDriverFile(file) {
            options.setSelectedDriverFile(file);
            updateDriverSelectedFileLabel();
        }

        return {
            formatDriverSize,
            loadDrivers,
            renderDriversTable,
            setSelectedDriverFile,
            updateDriverSelectedFileLabel,
            uploadDriverFromWeb,
        };
    }

    global.createDashboardDrivers = createDashboardDrivers;
})(window);

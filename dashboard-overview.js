(function attachDashboardOverviewFactory(global) {
    function createDashboardOverview(options) {
        function prefersReducedMotion() {
            return (
                typeof window !== 'undefined' &&
                typeof window.matchMedia === 'function' &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
            );
        }

        function countFractionDigits(value) {
            const normalized = String(value);
            const fraction = normalized.split('.')[1];
            if (!fraction) return 0;
            return Math.min(2, fraction.length);
        }

        function parseMetricDescriptor(value) {
            if (typeof value === 'number' && Number.isFinite(value)) {
                return {
                    isNumeric: true,
                    prefix: '',
                    suffix: '',
                    target: value,
                    decimals: countFractionDigits(value),
                    fallbackText: String(value),
                };
            }

            const textValue = String(value ?? '').trim();
            if (!textValue) {
                return { isNumeric: false, fallbackText: '' };
            }

            const metricMatch = textValue.match(/^([^\d-]*)(-?\d+(?:[.,]\d+)?)(.*)$/u);
            if (!metricMatch) {
                return { isNumeric: false, fallbackText: textValue };
            }

            const numericToken = metricMatch[2];
            const target = Number.parseFloat(numericToken.replace(',', '.'));
            if (!Number.isFinite(target)) {
                return { isNumeric: false, fallbackText: textValue };
            }

            const decimalToken = numericToken.split(/[.,]/)[1] || '';
            return {
                isNumeric: true,
                prefix: metricMatch[1],
                suffix: metricMatch[3],
                target,
                decimals: Math.min(2, decimalToken.length),
                fallbackText: textValue,
            };
        }

        function formatMetricNumber(value, decimals) {
            return value.toLocaleString('es-ES', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            });
        }

        function setMetricDisplay(element, descriptor, numericValue) {
            const formattedNumber = formatMetricNumber(numericValue, descriptor.decimals);
            element.textContent = `${descriptor.prefix}${formattedNumber}${descriptor.suffix}`;
        }

        function cancelMetricAnimation(element) {
            const activeAnimation = options.activeKpiAnimations.get(element);
            if (typeof activeAnimation === 'number') {
                cancelAnimationFrame(activeAnimation);
            }
            options.activeKpiAnimations.delete(element);
        }

        function animateNumber(elementId, value) {
            const element = document.getElementById(elementId);
            if (!element) return;

            const descriptor = parseMetricDescriptor(value);
            element.classList.remove('number-animate');
            void element.offsetWidth;
            element.classList.add('number-animate');

            if (!descriptor.isNumeric) {
                cancelMetricAnimation(element);
                element.textContent = descriptor.fallbackText;
                delete element.dataset.metricNumericValue;
                return;
            }

            const target = descriptor.target;
            const previousValue = Number.parseFloat(element.dataset.metricNumericValue || '');
            const startValue = Number.isFinite(previousValue) ? previousValue : 0;

            cancelMetricAnimation(element);

            if (prefersReducedMotion() || Math.abs(target - startValue) < 0.01) {
                setMetricDisplay(element, descriptor, target);
                element.dataset.metricNumericValue = String(target);
                return;
            }

            const animationStart = performance.now();
            const tick = (now) => {
                const elapsed = now - animationStart;
                const progress = Math.min(1, elapsed / options.kpiNumberAnimationMs);
                const easedProgress = 1 - Math.pow(1 - progress, 4);
                const currentValue = startValue + (target - startValue) * easedProgress;

                setMetricDisplay(element, descriptor, currentValue);

                if (progress < 1) {
                    const rafId = requestAnimationFrame(tick);
                    options.activeKpiAnimations.set(element, rafId);
                    return;
                }

                setMetricDisplay(element, descriptor, target);
                element.dataset.metricNumericValue = String(target);
                options.activeKpiAnimations.delete(element);
            };

            const initialRafId = requestAnimationFrame(tick);
            options.activeKpiAnimations.set(element, initialRafId);
        }

        function normalizeRecordAttentionState(value) {
            const normalized = String(value || '').trim().toLowerCase();
            if (normalized === 'critical' || normalized === 'in_progress' || normalized === 'open' || normalized === 'resolved') {
                return normalized;
            }
            return 'clear';
        }

        function recordAttentionStateLabel(value) {
            const normalized = normalizeRecordAttentionState(value);
            if (normalized === 'critical') return 'Cr\u00edtica';
            if (normalized === 'in_progress') return 'En curso';
            if (normalized === 'open') return 'Abierta';
            if (normalized === 'resolved') return 'Resuelta';
            return 'Sin incidencias';
        }

        function recordAttentionStateIconName(value) {
            const normalized = normalizeRecordAttentionState(value);
            if (normalized === 'critical') return 'error';
            if (normalized === 'in_progress') return 'pending';
            if (normalized === 'open') return 'report_problem';
            if (normalized === 'resolved') return 'check_circle';
            return 'radio_button_unchecked';
        }

        function buildRecordAttentionBadge(record) {
            const state = normalizeRecordAttentionState(record?.attention_state);
            const activeCount = Number(record?.incident_active_count || 0);
            const resolvedCount = Number(record?.incident_resolved_count || 0);
            let countLabel = '';
            if (state === 'resolved' && resolvedCount > 0) {
                countLabel = ` (${resolvedCount})`;
            } else if (activeCount > 0) {
                countLabel = ` (${activeCount})`;
            }
            return {
                stateClass: `attention-${state}`,
                iconName: recordAttentionStateIconName(state),
                label: `${recordAttentionStateLabel(state)}${countLabel}`,
            };
        }

        function updateStats(stats) {
            const criticalCount = Number(stats?.incident_critical_active_count) || 0;
            const inProgressCount = Number(stats?.incident_in_progress_count) || 0;
            const outsideSlaCount = Number(stats?.incident_outside_sla_count) || 0;
            const slaMinutes = Number(stats?.incident_sla_minutes) || 30;

            animateNumber('kpiCriticalIncidentsValue', criticalCount);
            animateNumber('kpiInProgressIncidentsValue', inProgressCount);
            animateNumber('kpiOutsideSlaIncidentsValue', outsideSlaCount);

            const syncClockEl = document.getElementById('kpiLastSyncTimeValue');
            if (syncClockEl) {
                syncClockEl.textContent = new Date().toLocaleTimeString('es-ES', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                });
            }

            const criticalMetaEl = document.getElementById('kpiCriticalMeta');
            if (criticalMetaEl) {
                const lastCriticalIncidentsCount = options.getLastCriticalIncidentsCount();
                if (lastCriticalIncidentsCount === null) {
                    criticalMetaEl.textContent = 'Sin cambios';
                } else {
                    const delta = criticalCount - lastCriticalIncidentsCount;
                    criticalMetaEl.textContent = delta > 0
                        ? `\u2191 +${delta}`
                        : delta < 0
                            ? `\u2193 ${delta}`
                            : 'Sin cambios';
                }
            }
            options.setLastCriticalIncidentsCount(criticalCount);

            const inProgressMetaEl = document.getElementById('kpiInProgressMeta');
            if (inProgressMetaEl) {
                inProgressMetaEl.textContent = inProgressCount > 10 ? 'Revisar' : 'Normal';
            }

            const slaMetaEl = document.getElementById('kpiSlaMeta');
            if (slaMetaEl) {
                slaMetaEl.textContent = outsideSlaCount > 0
                    ? `Revisar (${slaMinutes} min)`
                    : `OK (${slaMinutes} min)`;
            }

            const syncMetaEl = document.getElementById('kpiSyncMeta');
            if (syncMetaEl) {
                const syncStatus = options.getConnectionStatus();
                syncMetaEl.textContent = syncStatus === 'connected' ? 'OK' : 'Sincronizando';
            }

            options.setNotificationBadgeCount(criticalCount + outsideSlaCount);
        }

        function renderSuccessChart(stats) {
            if (!options.isChartAvailable()) return;
            const canvas = document.getElementById('successChart');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const charts = options.getCharts();

            if (charts.success) {
                charts.success.destroy();
            }

            const success = stats.successful_installations || 0;
            const failed = stats.failed_installations || 0;
            const total = stats.total_installations || 1;
            const other = total - success - failed;

            charts.success = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['\u00c9xito', 'Fallido', 'Otro'],
                    datasets: [{
                        data: [success, failed, Math.max(0, other)],
                        backgroundColor: [
                            'rgba(16, 185, 129, 0.8)',
                            'rgba(239, 68, 68, 0.8)',
                            'rgba(148, 163, 184, 0.3)',
                        ],
                        borderColor: [
                            'rgba(16, 185, 129, 1)',
                            'rgba(239, 68, 68, 1)',
                            'rgba(148, 163, 184, 0.5)',
                        ],
                        borderWidth: 2,
                        hoverOffset: 4,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                padding: 15,
                                usePointStyle: true,
                                pointStyle: 'circle',
                            },
                        },
                        tooltip: {
                            callbacks: {
                                label(context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `${label}: ${value} (${percentage}%)`;
                                },
                            },
                        },
                    },
                    cutout: '65%',
                },
            });
        }

        function renderBrandChart(stats) {
            if (!options.isChartAvailable()) return;
            const canvas = document.getElementById('brandChart');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const charts = options.getCharts();

            if (charts.brand) {
                charts.brand.destroy();
            }

            const brands = Object.entries(stats.by_brand || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6);

            if (brands.length === 0) {
                brands.push(['Sin datos', 1]);
            }

            const colors = [
                'rgba(6, 182, 212, 0.8)',
                'rgba(139, 92, 246, 0.8)',
                'rgba(16, 185, 129, 0.8)',
                'rgba(245, 158, 11, 0.8)',
                'rgba(239, 68, 68, 0.8)',
                'rgba(59, 130, 246, 0.8)',
            ];

            charts.brand = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: brands.map((brand) => brand[0]),
                    datasets: [{
                        label: 'Registros',
                        data: brands.map((brand) => brand[1]),
                        backgroundColor: colors,
                        borderColor: colors.map((color) => color.replace('0.8', '1')),
                        borderWidth: 2,
                        borderRadius: 6,
                        borderSkipped: false,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false,
                        },
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(71, 85, 105, 0.3)',
                            },
                            ticks: {
                                precision: 0,
                            },
                        },
                        x: {
                            grid: {
                                display: false,
                            },
                        },
                    },
                },
            });
        }

        function normalizeTrendRangeDays(daysCandidate) {
            const parsed = Number.parseInt(String(daysCandidate ?? ''), 10);
            if (!Number.isInteger(parsed) || !options.allowedTrendRangeDays.has(parsed)) {
                return 7;
            }
            return parsed;
        }

        function syncTrendRangeToggleUI() {
            const buttons = document.querySelectorAll('.chart-toggle button[data-trend-range]');
            const currentTrendRangeDays = options.getCurrentTrendRangeDays();
            buttons.forEach((button) => {
                const range = normalizeTrendRangeDays(button.dataset.trendRange);
                const isActive = range === currentTrendRangeDays;
                button.classList.toggle('active', isActive);
                button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });
        }

        function setupTrendRangeToggle() {
            const buttons = document.querySelectorAll('.chart-toggle button[data-trend-range]');
            if (!buttons.length) return;
            syncTrendRangeToggleUI();
            buttons.forEach((button) => {
                if (button.dataset.boundTrendToggle === '1') return;
                button.dataset.boundTrendToggle = '1';
                button.addEventListener('click', async () => {
                    if (!options.requireActiveSession()) return;
                    const selectedDays = normalizeTrendRangeDays(button.dataset.trendRange);
                    if (selectedDays === options.getCurrentTrendRangeDays()) return;
                    options.setCurrentTrendRangeDays(selectedDays);
                    syncTrendRangeToggleUI();
                    await renderTrendChart(options.getCurrentTrendRangeDays());
                });
            });
        }

        async function renderTrendChart(days = options.getCurrentTrendRangeDays()) {
            if (!options.isChartAvailable()) return;
            const canvas = document.getElementById('trendChart');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const normalizedDays = normalizeTrendRangeDays(days);
            options.setCurrentTrendRangeDays(normalizedDays);
            syncTrendRangeToggleUI();

            const charts = options.getCharts();
            if (charts.trend) {
                charts.trend.destroy();
            }

            try {
                const trendResponse = await options.api.getTrendData({ days: normalizedDays });
                const trendPoints = Array.isArray(trendResponse?.points) ? trendResponse.points : [];

                const labels = [];
                const data = [];

                if (trendPoints.length > 0) {
                    for (const point of trendPoints) {
                        const rawDate = typeof point?.date === 'string' ? point.date : '';
                        const date = rawDate ? new Date(`${rawDate}T00:00:00Z`) : null;
                        if (normalizedDays === 1) {
                            labels.push('\u00daltimas 24h');
                        } else {
                            labels.push(
                                date && !Number.isNaN(date.getTime())
                                    ? date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })
                                    : rawDate || 'N/A',
                            );
                        }
                        data.push(Number(point?.total_installations) || 0);
                    }
                } else {
                    const today = new Date();
                    for (let i = normalizedDays - 1; i >= 0; i--) {
                        const date = new Date(today);
                        date.setDate(date.getDate() - i);
                        labels.push(
                            normalizedDays === 1
                                ? '\u00daltimas 24h'
                                : date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }),
                        );
                        data.push(0);
                    }
                }

                charts.trend = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [{
                            label: normalizedDays === 1 ? 'Registros (24h)' : 'Registros (7d)',
                            data,
                            borderColor: 'rgba(6, 182, 212, 1)',
                            backgroundColor: 'rgba(6, 182, 212, 0.1)',
                            borderWidth: 3,
                            fill: true,
                            tension: 0.4,
                            pointBackgroundColor: 'rgba(6, 182, 212, 1)',
                            pointBorderColor: '#fff',
                            pointBorderWidth: 2,
                            pointRadius: 5,
                            pointHoverRadius: 7,
                        }],
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: {
                            intersect: false,
                            mode: 'index',
                        },
                        plugins: {
                            legend: {
                                display: false,
                            },
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: {
                                    color: 'rgba(71, 85, 105, 0.3)',
                                },
                                ticks: {
                                    precision: 0,
                                },
                            },
                            x: {
                                grid: {
                                    display: false,
                                },
                            },
                        },
                    },
                });
            } catch (err) {
                console.error('Error rendering trend chart:', err);
            }
        }

        async function loadDashboard() {
            if (!options.requireActiveSession()) return;
            options.validateSectionBindings('dashboard', { notify: true });
            try {
                const stats = await options.api.getStatistics();
                updateStats(stats);
                renderSuccessChart(stats);
                renderBrandChart(stats);
                await renderTrendChart(options.getCurrentTrendRangeDays());

                const installations = await options.api.getInstallations({ limit: 5 });
                renderRecentInstallations(installations);
            } catch (err) {
                console.error('Error cargando dashboard:', err);
            }
        }

        function renderRecentInstallations(installations) {
            const container = document.getElementById('recentInstallations');
            if (!container) return;
            container.replaceChildren();

            if (!installations || !installations.length) {
                const currentUser = options.getCurrentUser();
                options.renderContextualEmptyState(container, {
                    title: 'A\u00fan no hay registros recientes',
                    description: 'Cuando se genere actividad operativa, aparecer\u00e1 aqu\u00ed.',
                    actionLabel: currentUser && currentUser.role !== 'viewer' ? 'Crear registro manual' : '',
                    onAction: () => options.createManualRecord(),
                    tone: 'info',
                });
                return;
            }

            const table = document.createElement('table');
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            ['ID', 'Cliente', 'Marca', 'Atenci\u00f3n', 'Fecha'].forEach((label) => {
                const th = document.createElement('th');
                th.textContent = label;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);

            const tbody = document.createElement('tbody');

            installations.forEach((inst) => {
                const row = document.createElement('tr');

                const idCell = document.createElement('td');
                const strong = document.createElement('strong');
                strong.textContent = `#${inst.id ?? 'N/A'}`;
                idCell.appendChild(strong);

                const clientCell = document.createElement('td');
                clientCell.textContent = inst.client_name || 'N/A';

                const brandCell = document.createElement('td');
                brandCell.textContent = inst.driver_brand || 'N/A';

                const attentionCell = document.createElement('td');
                const attentionBadge = document.createElement('span');
                const attentionMeta = buildRecordAttentionBadge(inst);
                attentionBadge.className = `badge ${attentionMeta.stateClass}`;
                options.setElementTextWithMaterialIcon(attentionBadge, attentionMeta.iconName, attentionMeta.label);
                attentionCell.appendChild(attentionBadge);

                const dateCell = document.createElement('td');
                dateCell.textContent = new Date(inst.timestamp).toLocaleString('es-ES');

                row.append(idCell, clientCell, brandCell, attentionCell, dateCell);
                tbody.appendChild(row);
            });

            table.append(thead, tbody);
            container.appendChild(table);
        }

        return {
            animateNumber,
            buildRecordAttentionBadge,
            loadDashboard,
            normalizeRecordAttentionState,
            prefersReducedMotion,
            recordAttentionStateIconName,
            recordAttentionStateLabel,
            renderBrandChart,
            renderRecentInstallations,
            renderSuccessChart,
            renderTrendChart,
            setupTrendRangeToggle,
            updateStats,
        };
    }

    global.createDashboardOverview = createDashboardOverview;
})(window);

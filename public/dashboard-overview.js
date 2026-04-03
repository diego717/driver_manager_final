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
            if (normalized === 'critical' || normalized === 'in_progress' || normalized === 'paused' || normalized === 'open' || normalized === 'resolved') {
                return normalized;
            }
            return 'clear';
        }

        function recordAttentionStateLabel(value) {
            const normalized = normalizeRecordAttentionState(value);
            if (normalized === 'critical') return 'Cr\u00edtica';
            if (normalized === 'in_progress') return 'En curso';
            if (normalized === 'paused') return 'En pausa';
            if (normalized === 'open') return 'Abierta';
            if (normalized === 'resolved') return 'Resuelta';
            return 'Sin incidencias';
        }

        function recordAttentionStateIconName(value) {
            const normalized = normalizeRecordAttentionState(value);
            if (normalized === 'critical') return 'error';
            if (normalized === 'in_progress') return 'pending';
            if (normalized === 'paused') return 'pause_circle';
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

        function formatGpsAccuracyValue(value) {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue) || numericValue < 0) {
                return 's/d';
            }
            return `${Math.round(numericValue)} m`;
        }

        function buildGpsFlowMeta(summary, label) {
            const attemptedCount = Number(summary?.attempted_count) || 0;
            const captureRate = Number(summary?.capture_success_rate) || 0;
            const averageAccuracy = formatGpsAccuracyValue(summary?.average_accuracy_m);
            const p95Accuracy = formatGpsAccuracyValue(summary?.p95_accuracy_m);

            if (attemptedCount <= 0) {
                return `${label}: sin intentos registrados.`;
            }

            return `${label}: ${attemptedCount} intentos, ${captureRate}% util, prom. ${averageAccuracy}, p95 ${p95Accuracy}.`;
        }

        function setSummaryText(elementId, text) {
            const element = document.getElementById(elementId);
            if (!element) return;
            element.textContent = String(text || '').trim();
        }

        function getChartPalette() {
            const readToken = typeof options.readThemeToken === 'function'
                ? options.readThemeToken
                : (_name, fallbackValue) => fallbackValue;
            return {
                accent: readToken('--accent-primary', '#0f756d'),
                success: readToken('--success', '#16a34a'),
                warning: readToken('--warning', '#ca8a04'),
                error: readToken('--error', '#dc2626'),
                info: readToken('--info', '#2563eb'),
                text: readToken('--text-primary', '#1f2937'),
                muted: readToken('--text-secondary', '#64748b'),
                border: readToken('--border', '#cbd5e1'),
                background: readToken('--bg-card', '#ffffff'),
            };
        }

        function updateSuccessSummary(stats) {
            const success = Number(stats?.successful_installations) || 0;
            const failed = Number(stats?.failed_installations) || 0;
            const total = Math.max(0, Number(stats?.total_installations) || 0);
            const other = Math.max(0, total - success - failed);
            setSummaryText(
                'successChartSummary',
                `Resultado de registros: ${success} exitosos, ${failed} fallidos y ${other} en otros estados.`,
            );
        }

        function updateBrandSummary(stats) {
            const brands = Object.entries(stats?.by_brand || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);
            if (!brands.length) {
                setSummaryText('brandChartSummary', 'Distribución por marca: todavía no hay datos.');
                return;
            }
            const topBrands = brands.map(([brand, count]) => `${brand}: ${count}`).join(', ');
            setSummaryText('brandChartSummary', `Distribución por marca: ${topBrands}.`);
        }

        function updateTrendSummary(labels, data, normalizedDays) {
            if (!Array.isArray(labels) || !Array.isArray(data) || labels.length === 0 || data.length === 0) {
                setSummaryText('trendChartSummary', 'Tendencia de registros: todavía no hay datos.');
                return;
            }
            const normalizedPoints = data.map((value) => Number(value) || 0);
            const total = normalizedPoints.reduce((sum, value) => sum + value, 0);
            const peakValue = Math.max(...normalizedPoints);
            const peakIndex = normalizedPoints.indexOf(peakValue);
            const peakLabel = peakIndex >= 0 ? labels[peakIndex] : 'sin referencia';
            setSummaryText(
                'trendChartSummary',
                `Tendencia ${normalizedDays === 1 ? 'últimas 24 horas' : 'últimos 7 días'}: ${total} registros en total. Pico de ${peakValue} en ${peakLabel}.`,
            );
        }

        function renderLoanAttention(stats) {
            const attentionList = document.getElementById('attentionList');
            if (!attentionList) return;

            attentionList
                .querySelectorAll('[data-attention-kind="loan"]')
                .forEach((node) => node.remove());

            const dueSoonCount = Number(stats?.loan_due_soon_count) || 0;
            const overdueCount = Number(stats?.loan_overdue_count) || 0;
            if (dueSoonCount <= 0 && overdueCount <= 0) return;

            const entries = [];
            if (overdueCount > 0) {
                entries.push({
                    badgeClass: 'critical',
                    title: 'Prestamos vencidos',
                    body: overdueCount === 1
                        ? '1 equipo sigue sin devolverse.'
                        : `${overdueCount} equipos siguen sin devolverse.`,
                });
            }
            if (dueSoonCount > 0) {
                entries.push({
                    badgeClass: 'high',
                    title: 'Prestamos proximos a vencer',
                    body: dueSoonCount === 1
                        ? '1 equipo vence dentro de las proximas 48h.'
                        : `${dueSoonCount} equipos vencen dentro de las proximas 48h.`,
                });
            }

            entries.forEach((entry) => {
                const item = document.createElement('div');
                item.className = 'attention-item';
                item.dataset.attentionKind = 'loan';

                const badge = document.createElement('span');
                badge.className = `severity-badge ${entry.badgeClass}`;
                badge.textContent = entry.badgeClass === 'critical' ? 'Vencido' : 'Aviso';

                const textWrap = document.createElement('div');
                const title = document.createElement('strong');
                title.textContent = entry.title;
                const body = document.createElement('p');
                body.textContent = `${entry.body} Revisar desde Equipos.`;
                textWrap.append(title, body);

                item.append(badge, textWrap);

                if (typeof options.navigateToSectionByKey === 'function') {
                    const action = document.createElement('button');
                    action.type = 'button';
                    action.className = 'btn btn-sm btn-secondary';
                    action.textContent = 'Abrir';
                    action.addEventListener('click', () => options.navigateToSectionByKey('assets'));
                    item.append(action);
                }

                attentionList.appendChild(item);
            });
        }

        function renderTechnicianLoadAttention() {
            const attentionList = document.getElementById('attentionList');
            if (!attentionList) return;

            attentionList
                .querySelectorAll('[data-attention-kind="technician"]')
                .forEach((node) => node.remove());

            const summary = typeof options.getTechnicianLoadSummary === 'function'
                ? options.getTechnicianLoadSummary()
                : null;
            if (!summary) return;

            if (Number(summary.active) <= 0) {
                const item = document.createElement('div');
                item.className = 'attention-item';
                item.dataset.attentionKind = 'technician';

                const badge = document.createElement('span');
                badge.className = 'severity-badge medium';
                badge.textContent = 'Staff';

                const textWrap = document.createElement('div');
                const title = document.createElement('strong');
                title.textContent = 'Sin técnicos activos';
                const body = document.createElement('p');
                body.textContent = 'Carga aún no disponible. Activa técnicos desde Configuración.';
                textWrap.append(title, body);

                item.append(badge, textWrap);
                attentionList.appendChild(item);
                return;
            }

            if (!Array.isArray(summary.items) || !summary.items.length) {
                return;
            }

            summary.items.forEach((entry) => {
                const item = document.createElement('div');
                item.className = 'attention-item';
                item.dataset.attentionKind = 'technician';

                const badge = document.createElement('span');
                badge.className = `severity-badge ${entry.active_assignment_count > 2 ? 'high' : 'medium'}`;
                badge.textContent = `${entry.active_assignment_count}`;

                const textWrap = document.createElement('div');
                const title = document.createElement('strong');
                title.textContent = entry.display_name;
                const body = document.createElement('p');
                body.textContent =
                    `${entry.active_assignment_count} ${entry.active_assignment_count === 1 ? 'asignación activa' : 'asignaciones activas'}` +
                    (entry.employee_code ? ` · ${entry.employee_code}` : '') +
                    (entry.linked_web_user ? ' · con acceso web' : ' · sin usuario vinculado');
                textWrap.append(title, body);

                item.append(badge, textWrap);

                if (typeof options.navigateToSectionByKey === 'function') {
                    const action = document.createElement('button');
                    action.type = 'button';
                    action.className = 'btn btn-sm btn-secondary';
                    action.textContent = 'Ver staff';
                    action.addEventListener('click', () => options.navigateToSectionByKey('settings'));
                    item.append(action);
                }

                attentionList.appendChild(item);
            });
        }

        function updateStats(stats) {
            const criticalCount = Number(stats?.incident_critical_active_count) || 0;
            const inProgressCount = Number(stats?.incident_in_progress_count) || 0;
            const outsideSlaCount = Number(stats?.incident_outside_sla_count) || 0;
            const loanDueSoonCount = Number(stats?.loan_due_soon_count) || 0;
            const loanOverdueCount = Number(stats?.loan_overdue_count) || 0;
            const slaMinutes = Number(stats?.incident_sla_minutes) || 30;
            const gpsObservability = stats?.gps_observability || {};
            const installationGps = gpsObservability.installations || {};
            const incidentGps = gpsObservability.incidents || {};
            const overrides = gpsObservability.overrides || {};
            const usefulCaptures = (Number(installationGps.captured_count) || 0) + (Number(incidentGps.captured_count) || 0);
            const captureAttempts = (Number(installationGps.attempted_count) || 0) + (Number(incidentGps.attempted_count) || 0);
            const gpsFailures = (Number(installationGps.failure_count) || 0) + (Number(incidentGps.failure_count) || 0);
            const gpsOverrideCount = Number(overrides.conformity_gps_count) || 0;

            animateNumber('kpiCriticalIncidentsValue', criticalCount);
            animateNumber('kpiInProgressIncidentsValue', inProgressCount);
            animateNumber('kpiOutsideSlaIncidentsValue', outsideSlaCount);
            animateNumber('gpsOpsCapturedValue', usefulCaptures);
            animateNumber('gpsOpsFailuresValue', gpsFailures);
            animateNumber('gpsOpsOverridesValue', gpsOverrideCount);

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

            const gpsCapturedMetaEl = document.getElementById('gpsOpsCapturedMeta');
            if (gpsCapturedMetaEl) {
                gpsCapturedMetaEl.textContent = captureAttempts > 0
                    ? `${usefulCaptures}/${captureAttempts} capturas validas`
                    : 'Sin intentos registrados';
            }

            const gpsFailuresMetaEl = document.getElementById('gpsOpsFailuresMeta');
            if (gpsFailuresMetaEl) {
                const deniedCount = (Number(installationGps.denied_count) || 0) + (Number(incidentGps.denied_count) || 0);
                const timeoutCount = (Number(installationGps.timeout_count) || 0) + (Number(incidentGps.timeout_count) || 0);
                gpsFailuresMetaEl.textContent = gpsFailures > 0
                    ? `Denegado ${deniedCount} | Timeout ${timeoutCount}`
                    : 'Sin incidencias de captura';
            }

            const gpsOverridesMetaEl = document.getElementById('gpsOpsOverridesMeta');
            if (gpsOverridesMetaEl) {
                gpsOverridesMetaEl.textContent = gpsOverrideCount > 0
                    ? `Conformidades ${gpsOverrideCount}`
                    : 'Excepciones registradas por falta de captura usable';
            }

            const gpsInstallationsMetaEl = document.getElementById('gpsOpsInstallationsMeta');
            if (gpsInstallationsMetaEl) {
                gpsInstallationsMetaEl.textContent = buildGpsFlowMeta(installationGps, 'Registros');
            }

            const gpsIncidentsMetaEl = document.getElementById('gpsOpsIncidentsMeta');
            if (gpsIncidentsMetaEl) {
                gpsIncidentsMetaEl.textContent = buildGpsFlowMeta(incidentGps, 'Incidencias');
            }

            renderLoanAttention(stats);
            options.setNotificationBadgeCount(
                criticalCount + outsideSlaCount + loanDueSoonCount + loanOverdueCount,
            );
        }

        function renderSuccessChart(stats) {
            if (!options.isChartAvailable()) return;
            const canvas = document.getElementById('successChart');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const charts = options.getCharts();
            const palette = getChartPalette();

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
                            palette.success,
                            palette.error,
                            palette.muted,
                        ],
                        borderColor: [
                            palette.success,
                            palette.error,
                            palette.muted,
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
            const palette = getChartPalette();

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
                palette.accent,
                palette.info,
                palette.success,
                palette.warning,
                palette.error,
                palette.muted,
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
                                color: palette.border,
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
            const canvas = document.getElementById('trendChart');
            if (!canvas) return;
            const normalizedDays = normalizeTrendRangeDays(days);
            options.setCurrentTrendRangeDays(normalizedDays);
            syncTrendRangeToggleUI();
            const chartReady = typeof options.ensureChartsReady === 'function'
                ? await options.ensureChartsReady()
                : options.isChartAvailable();

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

                updateTrendSummary(labels, data, normalizedDays);

                if (!chartReady) {
                    return;
                }

                const ctx = canvas.getContext('2d');
                const palette = getChartPalette();
                charts.trend = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [{
                            label: normalizedDays === 1 ? 'Registros (24h)' : 'Registros (7d)',
                            data,
                            borderColor: palette.accent,
                            backgroundColor: palette.accent,
                            borderWidth: 3,
                            fill: false,
                            tension: 0.4,
                            pointBackgroundColor: palette.accent,
                            pointBorderColor: palette.background,
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
                                    color: palette.border,
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
            if (!options.requireActiveSession()) return false;
            options.validateSectionBindings('dashboard', { notify: true });
            options.setDashboardLoadingState?.(true);
            try {
                const stats = await options.api.getStatistics();
                updateStats(stats);
                updateSuccessSummary(stats);
                updateBrandSummary(stats);
                const chartsReady = typeof options.ensureChartsReady === 'function'
                    ? await options.ensureChartsReady()
                    : options.isChartAvailable();
                if (chartsReady) {
                    renderSuccessChart(stats);
                    renderBrandChart(stats);
                }
                await renderTrendChart(options.getCurrentTrendRangeDays());

                  const installations = await options.api.getInstallations({ limit: 5 });
                  options.cacheInstallations?.(installations);
                  renderRecentInstallations(installations);
                  renderTechnicianLoadAttention();
                  return true;
            } catch (err) {
                console.error('Error cargando dashboard:', err);
                return false;
            } finally {
                options.setDashboardLoadingState?.(false);
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
              renderTechnicianLoadAttention,
              setupTrendRangeToggle,
              updateStats,
          };
    }

    global.createDashboardOverview = createDashboardOverview;
})(window);

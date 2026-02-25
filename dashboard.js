const API_BASE = '';
let currentUser = null;
let charts = {};
let searchDebounceTimer = null;
let currentInstallationsData = [];

// WebSocket/SSE State
let eventSource = null;
let sseReconnectTimer = null;
let sseReconnectAttempts = 0;
const MAX_SSE_RECONNECT_ATTEMPTS = 5;
const SSE_RECONNECT_DELAY = 3000; // 3 seconds


// Chart.js default configuration

Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#334155';
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

const api = {
    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        const response = await fetch(API_BASE + endpoint, {
            ...options,
            headers,
            credentials: 'same-origin'
        });
        
        if (response.status === 401) {
            showLogin();
            throw new Error('No autorizado');
        }
        
        return response.json();
    },
    
    getInstallations(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request('/web/installations?' + query);
    },
    
    getStatistics() {
        return this.request('/web/statistics');
    },
    
    getAuditLogs(limit = 100) {
        return this.request('/web/audit-logs?limit=' + limit);
    },
    
    getIncidents(installationId) {
        return this.request('/web/installations/' + installationId + '/incidents');
    },
    
    getTrendData() {
        return this.request('/web/statistics/trend');
    },
    
    login(username, password) {
        return this.request('/web/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    },
    
    getMe() {
        return this.request('/web/auth/me');
    },

    logout() {
        return this.request('/web/auth/logout', { method: 'POST' });
    }
};

function showLogin() {
    document.getElementById('loginModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function hideLogin() {
    document.getElementById('loginModal').classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('loginError').textContent = '';
}

function updateStats(stats) {
    animateNumber('totalInstallations', stats.total_installations || 0);
    animateNumber('successRate', (stats.success_rate || 0) + '%');
    animateNumber('avgTime', (stats.average_time_minutes || 0) + ' min');
    animateNumber('uniqueClients', stats.unique_clients || 0);
}

function animateNumber(elementId, value) {
    const element = document.getElementById(elementId);
    element.style.opacity = '0';
    element.style.transform = 'translateY(10px)';
    
    setTimeout(() => {
        element.textContent = value;
        element.style.transition = 'all 0.3s ease';
        element.style.opacity = '1';
        element.style.transform = 'translateY(0)';
    }, 100);
}

// Chart rendering functions
function renderSuccessChart(stats) {
    const ctx = document.getElementById('successChart').getContext('2d');
    
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
            labels: ['Éxito', 'Fallido', 'Otro'],
            datasets: [{
                data: [success, failed, Math.max(0, other)],
                backgroundColor: [
                    'rgba(16, 185, 129, 0.8)',
                    'rgba(239, 68, 68, 0.8)',
                    'rgba(148, 163, 184, 0.3)'
                ],
                borderColor: [
                    'rgba(16, 185, 129, 1)',
                    'rgba(239, 68, 68, 1)',
                    'rgba(148, 163, 184, 0.5)'
                ],
                borderWidth: 2,
                hoverOffset: 4
            }]
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
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

function renderBrandChart(stats) {
    const ctx = document.getElementById('brandChart').getContext('2d');
    
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
        'rgba(59, 130, 246, 0.8)'
    ];
    
    charts.brand = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: brands.map(b => b[0]),
            datasets: [{
                label: 'Instalaciones',
                data: brands.map(b => b[1]),
                backgroundColor: colors,
                borderColor: colors.map(c => c.replace('0.8', '1')),
                borderWidth: 2,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(71, 85, 105, 0.3)'
                    },
                    ticks: {
                        precision: 0
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

async function renderTrendChart() {
    const ctx = document.getElementById('trendChart').getContext('2d');
    
    if (charts.trend) {
        charts.trend.destroy();
    }
    
    try {
        // Generate last 7 days labels
        const labels = [];
        const data = [];
        const today = new Date();
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            labels.push(date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }));
            data.push(Math.floor(Math.random() * 20) + 5); // Simulated data - replace with real API
        }
        
        charts.trend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Instalaciones',
                    data: data,
                    borderColor: 'rgba(6, 182, 212, 1)',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: 'rgba(6, 182, 212, 1)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(71, 85, 105, 0.3)'
                        },
                        ticks: {
                            precision: 0
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    } catch (err) {
        console.error('Error rendering trend chart:', err);
    }
}

async function loadDashboard() {
    try {
        const stats = await api.getStatistics();
        updateStats(stats);
        
        // Render charts
        renderSuccessChart(stats);
        renderBrandChart(stats);
        await renderTrendChart();
        
        const installations = await api.getInstallations({ limit: 5 });
        renderRecentInstallations(installations);
    } catch (err) {
        console.error('Error cargando dashboard:', err);
    }
}

function renderRecentInstallations(installations) {
    const container = document.getElementById('recentInstallations');
    if (!installations || !installations.length) {
        container.innerHTML = '<p class="loading">No hay instalaciones recientes</p>';
        return;
    }
    
    let html = '<table><thead><tr><th>ID</th><th>Cliente</th><th>Marca</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>';
    
    installations.forEach(inst => {
        const statusClass = inst.status || 'unknown';
        const statusIcon = inst.status === 'success' ? '✅' : inst.status === 'failed' ? '❌' : '❓';
        
        html += '<tr>';
        html += '<td><strong>#' + inst.id + '</strong></td>';
        html += '<td>' + (inst.client_name || 'N/A') + '</td>';
        html += '<td>' + (inst.driver_brand || 'N/A') + '</td>';
        html += '<td><span class="badge ' + statusClass + '">' + statusIcon + ' ' + inst.status + '</span></td>';
        html += '<td>' + new Date(inst.timestamp).toLocaleString('es-ES') + '</td>';
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

// Advanced Filters Functions
function getActiveFilters() {
    const filters = {};
    
    const searchValue = document.getElementById('searchInput')?.value?.trim();
    const brandValue = document.getElementById('brandFilter')?.value;
    const statusValue = document.getElementById('statusFilter')?.value;
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    
    if (searchValue) filters.search = searchValue;
    if (brandValue) filters.brand = brandValue;
    if (statusValue) filters.status = statusValue;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    
    return filters;
}

function updateFilterChips() {
    const chipsContainer = document.getElementById('filterChips');
    const clearBtn = document.getElementById('clearFilters');
    const filters = getActiveFilters();
    
    chipsContainer.innerHTML = '';
    let hasFilters = Object.keys(filters).length > 0;
    
    clearBtn.style.display = hasFilters ? 'inline-flex' : 'none';
    
    // Search chip
    if (filters.search) {
        chipsContainer.innerHTML += `
            <span class="filter-chip">
                <span class="chip-label">🔍</span>
                <span class="chip-value">"${filters.search}"</span>
                <span class="chip-remove" data-filter="search">×</span>
            </span>
        `;
    }
    
    // Brand chip
    if (filters.brand) {
        chipsContainer.innerHTML += `
            <span class="filter-chip">
                <span class="chip-label">🏷️ Marca:</span>
                <span class="chip-value">${filters.brand}</span>
                <span class="chip-remove" data-filter="brand">×</span>
            </span>
        `;
    }
    
    // Status chip
    if (filters.status) {
        const statusLabel = filters.status === 'success' ? '✅ Éxito' : 
                           filters.status === 'failed' ? '❌ Fallido' : '❓ Desconocido';
        chipsContainer.innerHTML += `
            <span class="filter-chip">
                <span class="chip-label">📊 Estado:</span>
                <span class="chip-value">${statusLabel}</span>
                <span class="chip-remove" data-filter="status">×</span>
            </span>
        `;
    }
    
    // Date range chips
    if (filters.startDate || filters.endDate) {
        const dateLabel = filters.startDate && filters.endDate ? 
            `${filters.startDate} - ${filters.endDate}` :
            filters.startDate ? `Desde: ${filters.startDate}` : `Hasta: ${filters.endDate}`;
        chipsContainer.innerHTML += `
            <span class="filter-chip">
                <span class="chip-label">📅</span>
                <span class="chip-value">${dateLabel}</span>
                <span class="chip-remove" data-filter="date">×</span>
            </span>
        `;
    }
    
    // Add click handlers to remove buttons
    chipsContainer.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filterType = e.target.dataset.filter;
            removeFilter(filterType);
        });
    });
}

function removeFilter(filterType) {
    switch (filterType) {
        case 'search':
            document.getElementById('searchInput').value = '';
            break;
        case 'brand':
            document.getElementById('brandFilter').value = '';
            break;
        case 'status':
            document.getElementById('statusFilter').value = '';
            break;
        case 'date':
            document.getElementById('startDate').value = '';
            document.getElementById('endDate').value = '';
            break;
    }
    
    updateFilterChips();
    
    // Apply filters immediately when removing
    debouncedSearch();
}

function clearAllFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('brandFilter').value = '';
    document.getElementById('statusFilter').value = '';
    document.getElementById('startDate').value = '';
    document.getElementById('endDate').value = '';
    
    updateFilterChips();
    debouncedSearch();
}

// Export Functions
function exportToCSV(data, filename = 'instalaciones.csv') {
    if (!data || !data.length) {
        showNotification('❌ No hay datos para exportar', 'error');
        return;
    }
    
    // CSV Headers
    const headers = ['ID', 'Cliente', 'Marca', 'Versión', 'Estado', 'Tiempo (s)', 'Notas', 'Fecha'];
    
    // Convert data to CSV rows
    const rows = data.map(inst => [
        inst.id,
        inst.client_name || 'N/A',
        inst.driver_brand || 'N/A',
        inst.driver_version || 'N/A',
        inst.status || 'unknown',
        inst.installation_time_seconds || 0,
        (inst.notes || '').replace(/"/g, '""'), // Escape quotes
        inst.timestamp
    ]);
    
    // Combine headers and rows
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    // Create and download file
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification(`✅ Exportado: ${filename}`, 'success');
}

function exportToExcel(data, filename = 'instalaciones.xlsx') {
    if (!data || !data.length) {
        showNotification('❌ No hay datos para exportar', 'error');
        return;
    }
    
    // Create HTML table for Excel
    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
    html += '<head><meta charset="UTF-8"><style>th { background-color: #06b6d4; color: white; font-weight: bold; }</style></head>';
    html += '<body><table border="1">';
    
    // Headers
    html += '<tr>';
    ['ID', 'Cliente', 'Marca', 'Versión', 'Estado', 'Tiempo (s)', 'Notas', 'Fecha'].forEach(header => {
        html += `<th>${header}</th>`;
    });
    html += '</tr>';
    
    // Data rows
    data.forEach(inst => {
        html += '<tr>';
        html += `<td>${inst.id}</td>`;
        html += `<td>${inst.client_name || 'N/A'}</td>`;
        html += `<td>${inst.driver_brand || 'N/A'}</td>`;
        html += `<td>${inst.driver_version || 'N/A'}</td>`;
        html += `<td>${inst.status || 'unknown'}</td>`;
        html += `<td>${inst.installation_time_seconds || 0}</td>`;
        html += `<td>${(inst.notes || '').substring(0, 100)}</td>`;
        html += `<td>${inst.timestamp}</td>`;
        html += '</tr>';
    });
    
    html += '</table></body></html>';
    
    // Create and download file
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification(`✅ Exportado: ${filename}`, 'success');
}

function setupExportButtons() {
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        // Replace single export button with dropdown
        const filterActions = document.querySelector('.filter-actions');
        
        // Create export dropdown
        const exportDropdown = document.createElement('div');
        exportDropdown.className = 'export-dropdown';
        exportDropdown.style.cssText = 'position: relative; display: inline-block;';
        
        exportDropdown.innerHTML = `
            <button id="exportBtn" class="btn-secondary">📥 Exportar ▼</button>
            <div class="export-menu" style="
                display: none;
                position: absolute;
                right: 0;
                top: 100%;
                margin-top: 0.5rem;
                background: var(--bg-secondary);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                box-shadow: var(--shadow-lg);
                z-index: 100;
                min-width: 160px;
            ">
                <button class="export-option" data-format="csv" style="
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    width: 100%;
                    padding: 0.75rem 1rem;
                    background: none;
                    border: none;
                    color: var(--text-primary);
                    cursor: pointer;
                    font-size: 0.875rem;
                    text-align: left;
                ">📄 Exportar CSV</button>
                <button class="export-option" data-format="excel" style="
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    width: 100%;
                    padding: 0.75rem 1rem;
                    background: none;
                    border: none;
                    color: var(--text-primary);
                    cursor: pointer;
                    font-size: 0.875rem;
                    text-align: left;
                    border-top: 1px solid var(--border);
                ">📊 Exportar Excel</button>
            </div>
        `;
        
        // Replace old button
        exportBtn.replaceWith(exportDropdown);
        
        // Toggle menu
        const btn = exportDropdown.querySelector('#exportBtn');
        const menu = exportDropdown.querySelector('.export-menu');
        
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
        
        // Close on outside click
        document.addEventListener('click', () => {
            menu.style.display = 'none';
        });
        
        // Export options
        exportDropdown.querySelectorAll('.export-option').forEach(option => {
            option.addEventListener('click', () => {
                const format = option.dataset.format;
                if (format === 'csv') {
                    exportToCSV(currentInstallationsData);
                } else if (format === 'excel') {
                    exportToExcel(currentInstallationsData);
                }
                menu.style.display = 'none';
            });
            
            // Hover effect
            option.addEventListener('mouseenter', () => {
                option.style.background = 'var(--bg-hover)';
            });
            option.addEventListener('mouseleave', () => {
                option.style.background = 'none';
            });
        });
    }
}


function debouncedSearch() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.classList.add('loading');
    }
    
    // Clear previous timer
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
    }
    
    // Set new timer - 300ms delay for real-time search
    searchDebounceTimer = setTimeout(() => {
        loadInstallations();
        if (searchInput) {
            searchInput.classList.remove('loading');
        }
    }, 300);
}

function setupAdvancedFilters() {
    // Real-time search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            updateFilterChips();
            debouncedSearch();
        });
        
        // Enter key triggers immediate search
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (searchDebounceTimer) {
                    clearTimeout(searchDebounceTimer);
                }
                loadInstallations();
            }
        });
    }
    
    // Filter change handlers
    const brandFilter = document.getElementById('brandFilter');
    const statusFilter = document.getElementById('statusFilter');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    
    if (brandFilter) {
        brandFilter.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }
    
    if (startDate) {
        startDate.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }
    
    if (endDate) {
        endDate.addEventListener('change', () => {
            updateFilterChips();
            debouncedSearch();
        });
    }
    
    // Clear filters button
    const clearBtn = document.getElementById('clearFilters');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearAllFilters);
    }
    
    // Keyboard shortcut: Ctrl+K to focus search
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
        }
    });
}

async function loadInstallations() {
    const container = document.getElementById('installationsTable');
    const resultsCount = document.getElementById('resultsCount');
    container.innerHTML = '<p class="loading">Cargando...</p>';
    
    if (resultsCount) {
        resultsCount.innerHTML = '<span class="loading">Buscando...</span>';
    }
    
    try {
        const filters = getActiveFilters();
        
        const params = {
            client_name: filters.search || '', // Use search for client_name
            brand: filters.brand || '',
            status: filters.status || '',
            start_date: filters.startDate || '',
            end_date: filters.endDate || '',
            limit: 50
        };
        
        const installations = await api.getInstallations(params);
        currentInstallationsData = installations || [];
        renderInstallationsTable(installations);
        
        // Update results count
        if (resultsCount) {
            const count = installations?.length || 0;
            resultsCount.innerHTML = `Mostrando <span class="count">${count}</span> resultado${count !== 1 ? 's' : ''}`;
        }
        
        // Update filter chips (in case they were cleared externally)
        updateFilterChips();
    } catch (err) {
        container.innerHTML = '<p class="error">❌ Error cargando instalaciones</p>';
        if (resultsCount) {
            resultsCount.textContent = 'Error al cargar';
        }
    }
}


function renderInstallationsTable(installations) {
    const container = document.getElementById('installationsTable');
    if (!installations || !installations.length) {
        container.innerHTML = '<p class="loading">No se encontraron instalaciones</p>';
        return;
    }
    
    let html = '<table><thead><tr><th>ID</th><th>Cliente</th><th>Marca</th><th>Versión</th><th>Estado</th><th>Tiempo</th><th>Notas</th><th>Fecha</th></tr></thead><tbody>';
    
    installations.forEach(inst => {
        const statusClass = inst.status || 'unknown';
        const statusIcon = inst.status === 'success' ? '✅' : inst.status === 'failed' ? '❌' : '❓';
        
        html += '<tr data-id="' + inst.id + '">';
        html += '<td><strong>#' + inst.id + '</strong></td>';
        html += '<td>' + (inst.client_name || 'N/A') + '</td>';
        html += '<td>' + (inst.driver_brand || 'N/A') + '</td>';
        html += '<td>' + (inst.driver_version || 'N/A') + '</td>';
        html += '<td><span class="badge ' + statusClass + '">' + statusIcon + ' ' + inst.status + '</span></td>';
        html += '<td>' + inst.installation_time_seconds + 's</td>';
        html += '<td>' + (inst.notes ? inst.notes.substring(0, 30) + '...' : '-') + '</td>';
        html += '<td>' + new Date(inst.timestamp).toLocaleString('es-ES') + '</td>';
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
    
    container.querySelectorAll('tr[data-id]').forEach(row => {
        row.addEventListener('click', () => {
            const id = row.dataset.id;
            showIncidentsForInstallation(id);
        });
    });
}

async function showIncidentsForInstallation(installationId) {
    const container = document.getElementById('incidentsList');
    document.querySelector('[data-section="incidents"]').click();
    container.innerHTML = '<p class="loading">Cargando incidencias...</p>';
    
    try {
        const data = await api.getIncidents(installationId);
        renderIncidents(data.incidents || [], installationId);
    } catch (err) {
        container.innerHTML = '<p class="error">❌ Error cargando incidencias</p>';
    }
}

async function loadPhotoWithAuth(photoId) {
    try {
        const response = await fetch(API_BASE + '/web/photos/' + photoId, {
            credentials: 'same-origin'
        });
        if (!response.ok) throw new Error('Failed to load photo');
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (err) {
        console.error('Error loading photo:', err);
        return '';
    }
}

async function renderIncidents(incidents, installationId) {
    const container = document.getElementById('incidentsList');
    
    let html = '<div class="incidents-header" style="margin-bottom: 1.5rem;">';
    html += '<h3>⚠️ Incidencias de Instalación #' + installationId + '</h3>';
    html += '<button onclick="document.querySelector(\'[data-section=\\\'installations\\\']\').click()" class="btn-secondary">← Volver</button>';
    html += '</div>';
    
    if (!incidents || !incidents.length) {
        html += '<p class="loading">No hay incidencias para esta instalación</p>';
        container.innerHTML = html;
        return;
    }
    
    for (const inc of incidents) {
        const severityIcon = inc.severity === 'critical' ? '🔴' : inc.severity === 'high' ? '🟠' : inc.severity === 'medium' ? '🟡' : '🔵';
        
        html += '<div class="incident-card">';
        html += '<div class="incident-header">';
        html += '<div><span class="badge ' + inc.severity + '">' + severityIcon + ' ' + inc.severity + '</span> <small>por <strong>' + inc.reporter_username + '</strong></small></div>';
        html += '<small>🕐 ' + new Date(inc.created_at).toLocaleString('es-ES') + '</small>';
        html += '</div>';
        html += '<p style="color: var(--text-secondary); line-height: 1.6;">' + inc.note + '</p>';
        
        if (inc.photos && inc.photos.length) {
            html += '<div class="photos-grid">';
            for (const photo of inc.photos) {
                const photoUrl = await loadPhotoWithAuth(photo.id);
                if (photoUrl) {
                    html += '<img src="' + photoUrl + '" class="photo-thumb" onclick="viewPhoto(' + photo.id + ')" data-photo-id="' + photo.id + '" alt="Foto de incidencia">';
                }
            }
            html += '</div>';
        }
        
        html += '</div>';
    }
    
    container.innerHTML = html;
}

async function viewPhoto(photoId) {
    const modal = document.getElementById('photoModal');
    const img = document.getElementById('photoViewer');
    const photoUrl = await loadPhotoWithAuth(photoId);
    if (photoUrl) {
        img.src = photoUrl;
        modal.classList.add('active');
    }
}

async function loadAuditLogs() {
    const container = document.getElementById('auditLogs');
    container.innerHTML = '<p class="loading">Cargando logs...</p>';
    
    try {
        const logs = await api.getAuditLogs();
        renderAuditLogs(logs);
    } catch (err) {
        container.innerHTML = '<p class="error">❌ Error cargando logs</p>';
    }
}

function renderAuditLogs(logs) {
    const container = document.getElementById('auditLogs');
    const actionFilter = document.getElementById('auditActionFilter')?.value;
    
    if (!logs || !logs.length) {
        container.innerHTML = '<p class="loading">No hay logs de auditoría</p>';
        return;
    }
    
    let filteredLogs = logs;
    if (actionFilter) {
        filteredLogs = logs.filter(log => log.action === actionFilter);
    }
    
    if (filteredLogs.length === 0) {
        container.innerHTML = '<p class="loading">No hay logs para el filtro seleccionado</p>';
        return;
    }
    
    let html = '<table><thead><tr><th>🕐 Fecha</th><th>📝 Acción</th><th>👤 Usuario</th><th>✅ Estado</th><th>💻 Detalles</th></tr></thead><tbody>';
    
    filteredLogs.forEach(log => {
        const successIcon = log.success ? '✅' : '❌';
        const successClass = log.success ? 'success' : 'failed';
        
        let details = '-';
        if (log.details) {
            try {
                const parsed = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                details = Object.entries(parsed)
                    .map(([k, v]) => `${k}: ${v}`)
                    .slice(0, 2)
                    .join(', ');
                if (details.length > 50) details = details.substring(0, 50) + '...';
            } catch {
                details = String(log.details).substring(0, 50);
            }
        }
        
        html += '<tr>';
        html += '<td>' + new Date(log.timestamp).toLocaleString('es-ES') + '</td>';
        html += '<td><code style="background: var(--bg-card); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem;">' + log.action + '</code></td>';
        html += '<td><strong>' + log.username + '</strong></td>';
        html += '<td><span class="badge ' + successClass + '">' + successIcon + '</span></td>';
        html += '<td style="color: var(--text-secondary); font-size: 0.875rem;">' + details + '</td>';
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

// Event Listeners
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const result = await api.login(username, password);
        currentUser = result.user;
        
        document.getElementById('username').textContent = result.user.username;
        document.getElementById('userRole').textContent = result.user.role;
        
        hideLogin();
        loadDashboard();
        
        // Show success notification
        showNotification('✅ Bienvenido, ' + result.user.username + '!', 'success');
    } catch (err) {
        document.getElementById('loginError').textContent = '❌ Credenciales inválidas';
        document.getElementById('loginPassword').value = '';
    }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        await api.logout();
    } catch (err) {
        console.error('Error during logout:', err);
    }
    currentUser = null;
    closeSSE();
    showLogin();
    showNotification('👋 Sesión cerrada', 'info');
});

document.getElementById('refreshBtn').addEventListener('click', () => {
    const btn = document.getElementById('refreshBtn');
    btn.style.transform = 'rotate(360deg)';
    btn.style.transition = 'transform 0.5s ease';
    
    setTimeout(() => {
        btn.style.transform = '';
        btn.style.transition = '';
    }, 500);
    
    loadDashboard();
    showNotification('🔄 Dashboard actualizado', 'info');
});

document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.dataset.section;
        
        document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById(section + 'Section').classList.add('active');
        
        const titles = {
            dashboard: '📈 Dashboard',
            installations: '💻 Instalaciones',
            incidents: '⚠️ Incidencias',
            audit: '📋 Auditoría'
        };
        document.getElementById('pageTitle').textContent = titles[section] || 'Dashboard';
        
        if (section === 'installations') loadInstallations();
        if (section === 'audit') loadAuditLogs();
    });
});

document.getElementById('applyFilters').addEventListener('click', () => {
    updateFilterChips();
    loadInstallations();
});


document.getElementById('refreshAudit').addEventListener('click', loadAuditLogs);

document.getElementById('auditActionFilter').addEventListener('change', () => {
    loadAuditLogs();
});

document.querySelector('#photoModal .close').addEventListener('click', () => {
    document.getElementById('photoModal').classList.remove('active');
});

// Close modal on outside click
document.getElementById('photoModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        document.getElementById('photoModal').classList.remove('active');
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('photoModal').classList.remove('active');
    }
    if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        loadDashboard();
    }
});

// Notification system
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 1rem;
        right: 1rem;
        padding: 1rem 1.5rem;
        background: ${type === 'success' ? 'rgba(16, 185, 129, 0.9)' : type === 'error' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(6, 182, 212, 0.9)'};
        color: white;
        border-radius: 12px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
        z-index: 9999;
        font-weight: 500;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// WebSocket/SSE Functions
function initSSE() {
    if (eventSource) {
        eventSource.close();
    }

    try {
        // Use EventSource for Server-Sent Events
        const sseUrl = `${API_BASE}/web/events`;
        eventSource = new EventSource(sseUrl, { withCredentials: true });

        eventSource.onopen = () => {
            console.log('[SSE] Connection established');
            sseReconnectAttempts = 0;
            updateConnectionStatus('connected');
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleSSEMessage(data);
            } catch (err) {
                console.error('[SSE] Error parsing message:', err);
            }
        };

        eventSource.onerror = (err) => {
            console.error('[SSE] Connection error:', err);
            updateConnectionStatus('disconnected');
            
            // Auto-reconnect logic
            if (sseReconnectAttempts < MAX_SSE_RECONNECT_ATTEMPTS) {
                sseReconnectAttempts++;
                console.log(`[SSE] Reconnecting... Attempt ${sseReconnectAttempts}/${MAX_SSE_RECONNECT_ATTEMPTS}`);
                updateConnectionStatus('reconnecting');
                
                if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
                sseReconnectTimer = setTimeout(() => {
                    initSSE();
                }, SSE_RECONNECT_DELAY * sseReconnectAttempts); // Exponential backoff
            } else {
                console.error('[SSE] Max reconnection attempts reached');
                updateConnectionStatus('failed');
                showNotification('⚠️ Conexión en tiempo real perdida. Recarga la página para reconectar.', 'error');
            }
        };

    } catch (err) {
        console.error('[SSE] Error initializing:', err);
    }
}

function handleSSEMessage(data) {
    switch (data.type) {
        case 'connected':
            console.log('[SSE]', data.message);
            showNotification('🔌 Conectado en tiempo real', 'success');
            break;
            
        case 'installation_created':
            handleRealtimeInstallation(data.installation);
            break;
            
        case 'installation_updated':
            handleRealtimeInstallationUpdate(data.installation);
            break;
            
        case 'incident_created':
            handleRealtimeIncident(data.incident);
            break;
            
        case 'stats_update':
            handleRealtimeStatsUpdate(data.statistics);
            break;
            
        case 'reconnect':
            console.log('[SSE] Server requested reconnect');
            eventSource.close();
            setTimeout(initSSE, 1000);
            break;
            
        case 'ping':
            // Keep-alive, no action needed
            break;
            
        default:
            console.log('[SSE] Unknown message type:', data.type);
    }
}

function handleRealtimeInstallation(installation) {
    // Add to current data if on installations page
    if (currentInstallationsData && document.getElementById('installationsSection')?.classList.contains('active')) {
        currentInstallationsData.unshift(installation);
        renderInstallationsTable(currentInstallationsData.slice(0, 50));
        
        // Update results count
        const resultsCount = document.getElementById('resultsCount');
        if (resultsCount) {
            const count = currentInstallationsData.length;
            resultsCount.innerHTML = `Mostrando <span class="count">${Math.min(count, 50)}</span> de <span class="count">${count}</span> resultado${count !== 1 ? 's' : ''}`;
        }
    }
    
    // Show notification
    const statusIcon = installation.status === 'success' ? '✅' : installation.status === 'failed' ? '❌' : '💻';
    showNotification(`${statusIcon} Nueva instalación: ${installation.client_name || 'Sin cliente'}`, 'info');
    
    // Refresh dashboard stats if on dashboard
    if (document.getElementById('dashboardSection')?.classList.contains('active')) {
        setTimeout(() => {
            loadDashboard();
        }, 1000);
    }
}

function handleRealtimeInstallationUpdate(installation) {
    // Update in current data if present
    if (currentInstallationsData) {
        const index = currentInstallationsData.findIndex(i => i.id === installation.id);
        if (index !== -1) {
            currentInstallationsData[index] = installation;
            if (document.getElementById('installationsSection')?.classList.contains('active')) {
                renderInstallationsTable(currentInstallationsData);
            }
        }
    }
}

function handleRealtimeIncident(incident) {
    const severityIcon = incident.severity === 'critical' ? '🔴' : incident.severity === 'high' ? '🟠' : '⚠️';
    showNotification(`${severityIcon} Nueva incidencia en instalación #${incident.installation_id}`, 'warning');
}

function handleRealtimeStatsUpdate(stats) {
    if (document.getElementById('dashboardSection')?.classList.contains('active')) {
        updateStats(stats);
        // Refresh charts with animation
        renderSuccessChart(stats);
        renderBrandChart(stats);
    }
}

function updateConnectionStatus(status) {
    // Remove existing status indicators
    const existingIndicator = document.getElementById('connectionStatus');
    if (existingIndicator) {
        existingIndicator.remove();
    }
    
    // Create new indicator
    const indicator = document.createElement('div');
    indicator.id = 'connectionStatus';
    
    const statusConfig = {
        connected: { icon: '🟢', text: 'En vivo', color: 'rgba(16, 185, 129, 0.9)' },
        disconnected: { icon: '🔴', text: 'Desconectado', color: 'rgba(239, 68, 68, 0.9)' },
        reconnecting: { icon: '🟡', text: 'Reconectando...', color: 'rgba(245, 158, 11, 0.9)' },
        failed: { icon: '⚫', text: 'Error de conexión', color: 'rgba(148, 163, 184, 0.9)' }
    };
    
    const config = statusConfig[status] || statusConfig.disconnected;
    
    indicator.style.cssText = `
        position: fixed;
        bottom: 1rem;
        right: 1rem;
        padding: 0.5rem 1rem;
        background: ${config.color};
        color: white;
        border-radius: 9999px;
        font-size: 0.75rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        z-index: 9998;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
        transition: all 0.3s ease;
        cursor: pointer;
    `;
    indicator.innerHTML = `<span>${config.icon}</span><span>${config.text}</span>`;
    
    // Click to reconnect if disconnected
    if (status === 'disconnected' || status === 'failed') {
        indicator.addEventListener('click', () => {
            showNotification('🔄 Intentando reconectar...', 'info');
            sseReconnectAttempts = 0;
            initSSE();
        });
        indicator.style.cursor = 'pointer';
        indicator.title = 'Click para reconectar';
    }
    
    document.body.appendChild(indicator);
    
    // Auto-hide after 5 seconds if connected
    if (status === 'connected') {
        setTimeout(() => {
            if (indicator.parentNode) {
                indicator.style.opacity = '0.6';
                indicator.style.transform = 'scale(0.9)';
            }
        }, 5000);
    }
}

function closeSSE() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    if (sseReconnectTimer) {
        clearTimeout(sseReconnectTimer);
        sseReconnectTimer = null;
    }
    const indicator = document.getElementById('connectionStatus');
    if (indicator) {
        indicator.remove();
    }
}

// Initialize
async function init() {
    try {
        const me = await api.getMe();
        currentUser = me;
        document.getElementById('username').textContent = me.username || 'Usuario';
        document.getElementById('userRole').textContent = me.role || 'admin';
        loadDashboard();

        // Initialize SSE connection for real-time updates
        initSSE();
    } catch (err) {
        console.error('Error validating session:', err);
        showLogin();
    }
    
    // Setup advanced filters
    setupAdvancedFilters();
    
    // Setup export buttons
    setupExportButtons();
    
    // Setup theme toggle
    setupThemeToggle();
    
    // Handle page visibility changes to reconnect SSE
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && currentUser && !eventSource) {
            console.log('[SSE] Page visible, reconnecting...');
            initSSE();
        }
    });
    
    // Close SSE on page unload
    window.addEventListener('beforeunload', closeSSE);
}


// Theme Management Functions
function getCurrentTheme() {
    // Check localStorage first, then system preference, default to dark
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        return savedTheme;
    }
    
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
    }
    
    return 'dark';
}

function setTheme(theme) {
    const html = document.documentElement;
    
    if (theme === 'light') {
        html.setAttribute('data-theme', 'light');
    } else {
        html.removeAttribute('data-theme');
    }
    
    // Save to localStorage
    localStorage.setItem('theme', theme);
    
    // Update Chart.js colors if charts exist
    updateChartTheme(theme);
}

function toggleTheme() {
    const currentTheme = getCurrentTheme();
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    
    // Show notification
    const themeLabel = newTheme === 'light' ? 'claro' : 'oscuro';
    showNotification(`🎨 Tema ${themeLabel} activado`, 'info');
}

function updateChartTheme(theme) {
    // Update Chart.js defaults
    if (theme === 'light') {
        Chart.defaults.color = '#475569';
        Chart.defaults.borderColor = '#cbd5e1';
    } else {
        Chart.defaults.color = '#94a3b8';
        Chart.defaults.borderColor = '#334155';
    }
    
    // Update existing charts if they exist
    Object.values(charts).forEach(chart => {
        if (chart) {
            chart.update();
        }
    });
}

function setupThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        // Set initial theme
        const currentTheme = getCurrentTheme();
        setTheme(currentTheme);
        
        // Add click handler
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    // Listen for system theme changes
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
        mediaQuery.addEventListener('change', (e) => {
            // Only auto-switch if user hasn't manually set a preference
            if (!localStorage.getItem('theme')) {
                setTheme(e.matches ? 'light' : 'dark');
            }
        });
    }
}

init();

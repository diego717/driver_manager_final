const API_BASE = '';
let authToken = localStorage.getItem('authToken');
let currentUser = null;
let charts = {};

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
        
        if (authToken) {
            headers['Authorization'] = 'Bearer ' + authToken;
        }
        
        const response = await fetch(API_BASE + endpoint, {
            ...options,
            headers
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

async function loadInstallations() {
    const container = document.getElementById('installationsTable');
    container.innerHTML = '<p class="loading">Cargando...</p>';
    
    try {
        const params = {
            client_name: document.getElementById('clientFilter').value,
            brand: document.getElementById('brandFilter').value,
            status: document.getElementById('statusFilter').value,
            start_date: document.getElementById('startDate').value,
            end_date: document.getElementById('endDate').value,
            limit: 50
        };
        
        const installations = await api.getInstallations(params);
        renderInstallationsTable(installations);
    } catch (err) {
        container.innerHTML = '<p class="error">❌ Error cargando instalaciones</p>';
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
        const headers = {};
        if (authToken) {
            headers['Authorization'] = 'Bearer ' + authToken;
        }
        const response = await fetch(API_BASE + '/photos/' + photoId, { headers });
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
        authToken = result.access_token;
        currentUser = result.user;
        localStorage.setItem('authToken', authToken);
        
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

document.getElementById('logoutBtn').addEventListener('click', () => {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
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

document.getElementById('applyFilters').addEventListener('click', loadInstallations);

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

// Initialize
async function init() {
    if (!authToken) {
        showLogin();
    } else {
        try {
            const me = await api.getMe();
            currentUser = me;
            document.getElementById('username').textContent = me.username || 'Usuario';
            document.getElementById('userRole').textContent = me.role || 'admin';
            loadDashboard();
        } catch (err) {
            console.error('Error validating session:', err);
            showLogin();
        }
    }
}

init();

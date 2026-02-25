// Este archivo contiene los assets del dashboard embebidos como strings
// Se genera automáticamente durante el build

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Driver Manager Dashboard</title>
    <style>
PLACEHOLDER_CSS
    </style>
</head>
<body>
    <div id="app">
        <nav class="sidebar">
            <div class="logo">
                <h1>Driver Manager</h1>
            </div>
            <ul class="nav-links">
                <li><a href="#" class="active" data-section="dashboard">Dashboard</a></li>
                <li><a href="#" data-section="installations">Instalaciones</a></li>
                <li><a href="#" data-section="incidents">Incidencias</a></li>
                <li><a href="#" data-section="audit">Auditoría</a></li>
            </ul>
            <div class="user-info">
                <span id="username">Usuario</span>
                <button id="logoutBtn" class="btn-secondary">Cerrar sesión</button>
            </div>
        </nav>
        
        <main class="main-content">
            <header class="header">
                <h2 id="pageTitle">Dashboard</h2>
                <div class="header-actions">
                    <button id="refreshBtn" class="btn-icon">↻</button>
                </div>
            </header>
            
            <div id="dashboardSection" class="section active">
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon total">📦</div>
                        <div class="stat-info">
                            <h3>Total Instalaciones</h3>
                            <p id="totalInstallations">-</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon success">✅</div>
                        <div class="stat-info">
                            <h3>Tasa de Éxito</h3>
                            <p id="successRate">-</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon time">⏱️</div>
                        <div class="stat-info">
                            <h3>Tiempo Promedio</h3>
                            <p id="avgTime">-</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon clients">👥</div>
                        <div class="stat-info">
                            <h3>Clientes Únicos</h3>
                            <p id="uniqueClients">-</p>
                        </div>
                    </div>
                </div>
                
                <div class="recent-section">
                    <h3>Instalaciones Recientes</h3>
                    <div id="recentInstallations" class="table-container">
                        <p class="loading">Cargando...</p>
                    </div>
                </div>
            </div>
            
            <div id="installationsSection" class="section">
                <div class="filters">
                    <input type="text" id="clientFilter" placeholder="Filtrar por cliente...">
                    <select id="brandFilter">
                        <option value="">Todas las marcas</option>
                    </select>
                    <select id="statusFilter">
                        <option value="">Todos los estados</option>
                        <option value="success">Éxito</option>
                        <option value="failed">Fallido</option>
                        <option value="unknown">Desconocido</option>
                    </select>
                    <input type="date" id="startDate">
                    <input type="date" id="endDate">
                    <button id="applyFilters" class="btn-primary">Aplicar</button>
                </div>
                <div id="installationsTable" class="table-container">
                    <p class="loading">Cargando instalaciones...</p>
                </div>
            </div>
            
            <div id="incidentsSection" class="section">
                <div id="incidentsList" class="incidents-grid">
                    <p class="loading">Cargando incidencias...</p>
                </div>
            </div>
            
            <div id="auditSection" class="section">
                <div id="auditLogs" class="table-container">
                    <p class="loading">Cargando logs...</p>
                </div>
            </div>
        </main>
    </div>
    
    <div id="loginModal" class="modal">
        <div class="modal-content">
            <h2>Iniciar Sesión</h2>
            <form id="loginForm">
                <input type="text" id="loginUsername" placeholder="Usuario" required>
                <input type="password" id="loginPassword" placeholder="Contraseña" required>
                <button type="submit" class="btn-primary">Ingresar</button>
            </form>
            <p id="loginError" class="error"></p>
        </div>
    </div>
    
    <div id="photoModal" class="modal">
        <div class="modal-content photo-modal">
            <span class="close">&times;</span>
            <img id="photoViewer" src="" alt="Foto de incidencia">
        </div>
    </div>
    
    <script>
PLACEHOLDER_JS
    </script>
</body>
</html>`;

export const DASHBOARD_CSS = `:root {
    --bg-primary: #0f172a;
    --bg-secondary: #1e293b;
    --bg-card: #334155;
    --text-primary: #f8fafc;
    --text-secondary: #94a3b8;
    --accent-primary: #06b6d4;
    --accent-secondary: #8b5cf6;
    --success: #10b981;
    --warning: #f59e0b;
    --error: #ef4444;
    --border: #475569;
    --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
    --radius: 12px;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.6;
}

#app {
    display: flex;
    min-height: 100vh;
}

.sidebar {
    width: 260px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
}

.logo h1 {
    font-size: 1.5rem;
    font-weight: 700;
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 2rem;
}

.nav-links {
    list-style: none;
    flex: 1;
}

.nav-links li {
    margin-bottom: 0.5rem;
}

.nav-links a {
    display: block;
    padding: 0.75rem 1rem;
    color: var(--text-secondary);
    text-decoration: none;
    border-radius: var(--radius);
    transition: all 0.2s;
}

.nav-links a:hover, .nav-links a.active {
    background: var(--bg-card);
    color: var(--text-primary);
}

.user-info {
    padding-top: 1rem;
    border-top: 1px solid var(--border);
}

.user-info span {
    display: block;
    margin-bottom: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
}

.main-content {
    flex: 1;
    padding: 2rem;
    overflow-y: auto;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
}

.header h2 {
    font-size: 1.875rem;
    font-weight: 600;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
}

.stat-card {
    background: var(--bg-secondary);
    border-radius: var(--radius);
    padding: 1.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    box-shadow: var(--shadow);
    border: 1px solid var(--border);
    transition: transform 0.2s;
}

.stat-card:hover {
    transform: translateY(-2px);
}

.stat-icon {
    width: 48px;
    height: 48px;
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
}

.stat-icon.total { background: rgba(6, 182, 212, 0.2); }
.stat-icon.success { background: rgba(16, 185, 129, 0.2); }
.stat-icon.time { background: rgba(139, 92, 246, 0.2); }
.stat-icon.clients { background: rgba(245, 158, 11, 0.2); }

.stat-info h3 {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 0.25rem;
}

.stat-info p {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
}

.section {
    display: none;
}

.section.active {
    display: block;
}

.filters {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
}

.filters input, .filters select {
    padding: 0.5rem 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-primary);
    font-size: 0.875rem;
}

.table-container {
    background: var(--bg-secondary);
    border-radius: var(--radius);
    overflow: hidden;
    box-shadow: var(--shadow);
}

table {
    width: 100%;
    border-collapse: collapse;
}

th, td {
    padding: 1rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
}

th {
    background: var(--bg-card);
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--text-secondary);
}

td {
    font-size: 0.875rem;
}

tr:hover {
    background: var(--bg-card);
}

.badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
}

.badge.success { background: rgba(16, 185, 129, 0.2); color: var(--success); }
.badge.failed { background: rgba(239, 68, 68, 0.2); color: var(--error); }
.badge.low { background: rgba(6, 182, 212, 0.2); color: var(--accent-primary); }
.badge.medium { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
.badge.high { background: rgba(239, 68, 68, 0.2); color: var(--error); }
.badge.critical { background: rgba(239, 68, 68, 0.4); color: var(--error); }

.incidents-grid {
    display: grid;
    gap: 1rem;
}

.incident-card {
    background: var(--bg-secondary);
    border-radius: var(--radius);
    padding: 1.5rem;
    border: 1px solid var(--border);
}

.incident-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
}

.photos-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.5rem;
    margin-top: 1rem;
}

.photo-thumb {
    width: 100%;
    height: 120px;
    object-fit: cover;
    border-radius: 8px;
    cursor: pointer;
    transition: transform 0.2s;
}

.photo-thumb:hover {
    transform: scale(1.05);
}

.modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    z-index: 1000;
    align-items: center;
    justify-content: center;
}

.modal.active {
    display: flex;
}

.modal-content {
    background: var(--bg-secondary);
    padding: 2rem;
    border-radius: var(--radius);
    max-width: 400px;
    width: 90%;
}

.modal-content.photo-modal {
    max-width: 90%;
    max-height: 90%;
    padding: 1rem;
}

.modal-content img {
    max-width: 100%;
    max-height: 80vh;
    border-radius: 8px;
}

.close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    font-size: 2rem;
    cursor: pointer;
    color: var(--text-secondary);
}

.btn-primary {
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: var(--radius);
    cursor: pointer;
    font-weight: 600;
    transition: opacity 0.2s;
}

.btn-primary:hover {
    opacity: 0.9;
}

.btn-secondary {
    background: var(--bg-card);
    color: var(--text-primary);
    border: 1px solid var(--border);
    padding: 0.5rem 1rem;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 0.875rem;
}

.btn-icon {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text-primary);
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 1.25rem;
}

.loading {
    text-align: center;
    padding: 2rem;
    color: var(--text-secondary);
}

.error {
    color: var(--error);
    font-size: 0.875rem;
    margin-top: 0.5rem;
}

@media (max-width: 768px) {
    .sidebar {
        width: 100%;
        position: fixed;
        bottom: 0;
        left: 0;
        flex-direction: row;
        padding: 0.5rem;
        z-index: 100;
    }
    
    .logo, .user-info {
        display: none;
    }
    
    .nav-links {
        display: flex;
        flex: 1;
        justify-content: space-around;
    }
    
    .main-content {
        padding: 1rem;
        padding-bottom: 5rem;
    }
    
    .stats-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}`;

export const DASHBOARD_JS = `const API_BASE = '';
let authToken = localStorage.getItem('authToken');

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
    
    login(username, password) {
        return this.request('/web/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    }
};

function showLogin() {
    document.getElementById('loginModal').classList.add('active');
}

function hideLogin() {
    document.getElementById('loginModal').classList.remove('active');
}

function updateStats(stats) {
    document.getElementById('totalInstallations').textContent = stats.total_installations || 0;
    document.getElementById('successRate').textContent = (stats.success_rate || 0) + '%';
    document.getElementById('avgTime').textContent = (stats.average_time_minutes || 0) + ' min';
    document.getElementById('uniqueClients').textContent = stats.unique_clients || 0;
}

async function loadDashboard() {
    try {
        const stats = await api.getStatistics();
        updateStats(stats);
        
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
        html += '<tr>';
        html += '<td>#' + inst.id + '</td>';
        html += '<td>' + (inst.client_name || 'N/A') + '</td>';
        html += '<td>' + (inst.driver_brand || 'N/A') + '</td>';
        html += '<td><span class="badge ' + inst.status + '">' + inst.status + '</span></td>';
        html += '<td>' + new Date(inst.timestamp).toLocaleString() + '</td>';
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
        container.innerHTML = '<p class="error">Error cargando instalaciones</p>';
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
        html += '<tr data-id="' + inst.id + '">';
        html += '<td>#' + inst.id + '</td>';
        html += '<td>' + (inst.client_name || 'N/A') + '</td>';
        html += '<td>' + (inst.driver_brand || 'N/A') + '</td>';
        html += '<td>' + (inst.driver_version || 'N/A') + '</td>';
        html += '<td><span class="badge ' + inst.status + '">' + inst.status + '</span></td>';
        html += '<td>' + inst.installation_time_seconds + 's</td>';
        html += '<td>' + (inst.notes || '-') + '</td>';
        html += '<td>' + new Date(inst.timestamp).toLocaleString() + '</td>';
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
        renderIncidents(data.incidents || []);
    } catch (err) {
        container.innerHTML = '<p class="error">Error cargando incidencias</p>';
    }
}

function renderIncidents(incidents) {
    const container = document.getElementById('incidentsList');
    if (!incidents || !incidents.length) {
        container.innerHTML = '<p class="loading">No hay incidencias para esta instalación</p>';
        return;
    }
    
    let html = '';
    
    incidents.forEach(inc => {
        html += '<div class="incident-card">';
        html += '<div class="incident-header">';
        html += '<div><span class="badge ' + inc.severity + '">' + inc.severity + '</span> <small>por ' + inc.reporter_username + '</small></div>';
        html += '<small>' + new Date(inc.created_at).toLocaleString() + '</small>';
        html += '</div>';
        html += '<p>' + inc.note + '</p>';
        
        if (inc.photos && inc.photos.length) {
            html += '<div class="photos-grid">';
            inc.photos.forEach(photo => {
                html += '<img src="/web/photos/' + photo.id + '" class="photo-thumb" onclick="viewPhoto(' + photo.id + ')">';
            });
            html += '</div>';
        }
        
        html += '</div>';
    });
    
    container.innerHTML = html;
}

function viewPhoto(photoId) {
    const modal = document.getElementById('photoModal');
    const img = document.getElementById('photoViewer');
    img.src = '/web/photos/' + photoId;
    modal.classList.add('active');
}

async function loadAuditLogs() {
    const container = document.getElementById('auditLogs');
    container.innerHTML = '<p class="loading">Cargando logs...</p>';
    
    try {
        const logs = await api.getAuditLogs();
        renderAuditLogs(logs);
    } catch (err) {
        container.innerHTML = '<p class="error">Error cargando logs</p>';
    }
}

function renderAuditLogs(logs) {
    const container = document.getElementById('auditLogs');
    if (!logs || !logs.length) {
        container.innerHTML = '<p class="loading">No hay logs de auditoría</p>';
        return;
    }
    
    let html = '<table><thead><tr><th>Fecha</th><th>Acción</th><th>Usuario</th><th>Éxito</th><th>Detalles</th></tr></thead><tbody>';
    
    logs.forEach(log => {
        html += '<tr>';
        html += '<td>' + new Date(log.timestamp).toLocaleString() + '</td>';
        html += '<td>' + log.action + '</td>';
        html += '<td>' + log.username + '</td>';
        html += '<td>' + (log.success ? '✅' : '❌') + '</td>';
        html += '<td>' + (log.details ? JSON.stringify(log.details).slice(0, 50) + '...' : '-') + '</td>';
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const result = await api.login(username, password);
        authToken = result.access_token;
        localStorage.setItem('authToken', authToken);
        document.getElementById('username').textContent = result.user.username;
        hideLogin();
        loadDashboard();
    } catch (err) {
        document.getElementById('loginError').textContent = 'Credenciales inválidas';
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    authToken = null;
    localStorage.removeItem('authToken');
    showLogin();
});

document.getElementById('refreshBtn').addEventListener('click', () => {
    loadDashboard();
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
            dashboard: 'Dashboard',
            installations: 'Instalaciones',
            incidents: 'Incidencias',
            audit: 'Auditoría'
        };
        document.getElementById('pageTitle').textContent = titles[section] || 'Dashboard';
        
        if (section === 'installations') loadInstallations();
        if (section === 'audit') loadAuditLogs();
    });
});

document.getElementById('applyFilters').addEventListener('click', loadInstallations);

document.querySelector('#photoModal .close').addEventListener('click', () => {
    document.getElementById('photoModal').classList.remove('active');
});

if (!authToken) {
    showLogin();
} else {
    loadDashboard();
}`;

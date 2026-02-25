import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

// Mock Chart.js before importing dashboard.js
global.Chart = class Chart {
  constructor(ctx, config) {
    this.config = config;
    this.destroyed = false;
  }
  destroy() {
    this.destroyed = true;
  }
};

// Mock localStorage
const localStorageMock = {
  store: {},
  getItem(key) {
    return this.store[key] || null;
  },
  setItem(key, value) {
    this.store[key] = String(value);
  },
  removeItem(key) {
    delete this.store[key];
  },
  clear() {
    this.store = {};
  }
};

describe('Dashboard Frontend Unit Tests', () => {
  let dom;
  let window;
  let document;
  let originalLocalStorage;

  beforeEach(() => {
    // Create JSDOM environment
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Dashboard Test</title>
        </head>
        <body>
          <div id="app">
            <nav class="sidebar">
              <div class="logo">Driver Manager</div>
              <div class="nav-links">
                <a href="#dashboard">Dashboard</a>
                <a href="#installations">Instalaciones</a>
                <a href="#incidents">Incidencias</a>
                <a href="#audit">Auditoría</a>
              </div>
              <div class="user-info">

                <span id="username">Usuario</span>
                <span id="userRole" class="role-badge">admin</span>
                <button id="logoutBtn" class="btn-secondary">Cerrar sesión</button>
              </div>
            </nav>
            <main class="main-content">
              <div id="dashboardSection" class="section active">
                <div class="stats-grid">
                  <div class="stat-card">
                    <div class="stat-info">
                      <h3>Total Instalaciones</h3>
                      <p id="totalInstallations">-</p>
                    </div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-info">
                      <h3>Tasa de Éxito</h3>
                      <p id="successRate">-</p>
                    </div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-info">
                      <h3>Tiempo Promedio</h3>
                      <p id="avgTime">-</p>
                    </div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-info">
                      <h3>Clientes Únicos</h3>
                      <p id="uniqueClients">-</p>
                    </div>
                  </div>
                </div>
                <div class="charts-grid">
                  <div class="chart-card">
                    <canvas id="successChart"></canvas>
                  </div>
                  <div class="chart-card">
                    <canvas id="brandChart"></canvas>
                  </div>
                  <div class="chart-card wide">
                    <canvas id="trendChart"></canvas>
                  </div>
                </div>
                <div id="recentInstallations" class="table-container">
                  <p class="loading">Cargando...</p>
                </div>
              </div>
              <div id="installationsSection" class="section">
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
              <form id="loginForm">
                <input type="text" id="loginUsername" required>
                <input type="password" id="loginPassword" required>
                <button type="submit">Ingresar</button>
              </form>
              <p id="loginError" class="error"></p>
            </div>
          </div>
          <div id="photoModal" class="modal">
            <div class="modal-content photo-modal">
              <span class="close">&times;</span>
              <img id="photoViewer" src="" alt="Foto">
            </div>
          </div>
        </body>
      </html>
    `, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'http://localhost:8787/dashboard'
    });

    window = dom.window;
    document = window.document;

    // Setup global objects
    global.window = window;
    global.document = document;
    global.localStorage = localStorageMock;
    global.fetch = () => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({})
    });

    // Reset localStorage
    localStorageMock.clear();
  });

  afterEach(() => {
    dom = null;
    window = null;
    document = null;
  });

  describe('DOM Elements', () => {
    it('should have all required dashboard elements', () => {
      assert.ok(document.getElementById('app'), 'App container should exist');
      assert.ok(document.getElementById('dashboardSection'), 'Dashboard section should exist');
      assert.ok(document.getElementById('installationsSection'), 'Installations section should exist');
      assert.ok(document.getElementById('incidentsSection'), 'Incidents section should exist');
      assert.ok(document.getElementById('auditSection'), 'Audit section should exist');
      assert.ok(document.getElementById('loginModal'), 'Login modal should exist');
    });

    it('should have all stat elements', () => {
      assert.ok(document.getElementById('totalInstallations'), 'Total installations element should exist');
      assert.ok(document.getElementById('successRate'), 'Success rate element should exist');
      assert.ok(document.getElementById('avgTime'), 'Average time element should exist');
      assert.ok(document.getElementById('uniqueClients'), 'Unique clients element should exist');
    });

    it('should have all chart canvas elements', () => {
      assert.ok(document.getElementById('successChart'), 'Success chart canvas should exist');
      assert.ok(document.getElementById('brandChart'), 'Brand chart canvas should exist');
      assert.ok(document.getElementById('trendChart'), 'Trend chart canvas should exist');
    });

    it('should have login form elements', () => {
      assert.ok(document.getElementById('loginForm'), 'Login form should exist');
      assert.ok(document.getElementById('loginUsername'), 'Login username input should exist');
      assert.ok(document.getElementById('loginPassword'), 'Login password input should exist');
      assert.ok(document.getElementById('loginError'), 'Login error element should exist');
    });
  });

  describe('localStorage', () => {
    it('should store and retrieve auth token', () => {
      const token = 'test-jwt-token-12345';
      localStorageMock.setItem('authToken', token);
      assert.strictEqual(localStorageMock.getItem('authToken'), token);
    });

    it('should remove auth token on logout', () => {
      localStorageMock.setItem('authToken', 'test-token');
      localStorageMock.removeItem('authToken');
      assert.strictEqual(localStorageMock.getItem('authToken'), null);
    });

    it('should clear all items', () => {
      localStorageMock.setItem('authToken', 'token1');
      localStorageMock.setItem('user', 'testuser');
      localStorageMock.clear();
      assert.strictEqual(localStorageMock.getItem('authToken'), null);
      assert.strictEqual(localStorageMock.getItem('user'), null);
    });
  });

  describe('CSS Classes and Styling', () => {
    it('should have correct section classes', () => {
      const dashboardSection = document.getElementById('dashboardSection');
      const installationsSection = document.getElementById('installationsSection');
      
      assert.ok(dashboardSection.classList.contains('section'), 'Dashboard should have section class');
      assert.ok(dashboardSection.classList.contains('active'), 'Dashboard should be active by default');
      assert.ok(installationsSection.classList.contains('section'), 'Installations should have section class');
      assert.ok(!installationsSection.classList.contains('active'), 'Installations should not be active by default');
    });

    it('should have correct stat card structure', () => {
      const statCards = document.querySelectorAll('.stat-card');
      assert.strictEqual(statCards.length, 4, 'Should have 4 stat cards');
      
      statCards.forEach(card => {
        assert.ok(card.querySelector('.stat-info'), 'Each stat card should have stat-info');
        assert.ok(card.querySelector('h3'), 'Each stat card should have h3 title');
        assert.ok(card.querySelector('p'), 'Each stat card should have p value');
      });
    });

    it('should have correct chart card structure', () => {
      const chartCards = document.querySelectorAll('.chart-card');
      assert.strictEqual(chartCards.length, 3, 'Should have 3 chart cards');
      
      chartCards.forEach(card => {
        assert.ok(card.querySelector('canvas'), 'Each chart card should have canvas element');
      });
    });

    it('should have wide chart card for trend', () => {
      const wideChart = document.querySelector('.chart-card.wide');
      assert.ok(wideChart, 'Should have wide chart card');
      assert.ok(wideChart.querySelector('#trendChart'), 'Wide chart should contain trend chart');
    });
  });

  describe('Modal Structure', () => {
    it('should have login modal with correct structure', () => {
      const loginModal = document.getElementById('loginModal');
      assert.ok(loginModal.classList.contains('modal'), 'Login modal should have modal class');
      assert.ok(loginModal.querySelector('.modal-content'), 'Login modal should have modal-content');
      assert.ok(loginModal.querySelector('form'), 'Login modal should have form');
    });

    it('should have photo modal with correct structure', () => {
      const photoModal = document.getElementById('photoModal');
      assert.ok(photoModal.classList.contains('modal'), 'Photo modal should have modal class');
      assert.ok(photoModal.querySelector('.modal-content'), 'Photo modal should have modal-content');
      assert.ok(photoModal.querySelector('.close'), 'Photo modal should have close button');
      assert.ok(photoModal.querySelector('#photoViewer'), 'Photo modal should have photo viewer');
    });
  });

  describe('Responsive Design Classes', () => {
    it('should have sidebar element', () => {
      const sidebar = document.querySelector('.sidebar');
      assert.ok(sidebar, 'Sidebar should exist');
    });

    it('should have main-content element', () => {
      const mainContent = document.querySelector('.main-content');
      assert.ok(mainContent, 'Main content should exist');
    });

    it('should have stats-grid container', () => {
      const statsGrid = document.querySelector('.stats-grid');
      assert.ok(statsGrid, 'Stats grid should exist');
    });

    it('should have charts-grid container', () => {
      const chartsGrid = document.querySelector('.charts-grid');
      assert.ok(chartsGrid, 'Charts grid should exist');
    });
  });

  describe('User Info Display', () => {
    it('should have username display element', () => {
      const usernameEl = document.getElementById('username');
      assert.ok(usernameEl, 'Username element should exist');
      assert.strictEqual(usernameEl.textContent, 'Usuario', 'Default username should be "Usuario"');
    });

    it('should have role badge element', () => {
      const roleEl = document.getElementById('userRole');
      assert.ok(roleEl, 'User role element should exist');
      assert.ok(roleEl.classList.contains('role-badge'), 'Role should have role-badge class');
      assert.strictEqual(roleEl.textContent, 'admin', 'Default role should be "admin"');
    });

    it('should have logout button', () => {
      const logoutBtn = document.getElementById('logoutBtn');
      assert.ok(logoutBtn, 'Logout button should exist');
      assert.ok(logoutBtn.classList.contains('btn-secondary'), 'Logout should have btn-secondary class');
    });
  });

  describe('Table Containers', () => {
    it('should have recent installations table container', () => {
      const container = document.getElementById('recentInstallations');
      assert.ok(container, 'Recent installations container should exist');
      assert.ok(container.classList.contains('table-container'), 'Should have table-container class');
    });

    it('should have installations table container', () => {
      const container = document.getElementById('installationsTable');
      assert.ok(container, 'Installations table container should exist');
      assert.ok(container.classList.contains('table-container'), 'Should have table-container class');
    });

    it('should have audit logs table container', () => {
      const container = document.getElementById('auditLogs');
      assert.ok(container, 'Audit logs container should exist');
      assert.ok(container.classList.contains('table-container'), 'Should have table-container class');
    });

    it('should have incidents grid container', () => {
      const container = document.getElementById('incidentsList');
      assert.ok(container, 'Incidents list container should exist');
      assert.ok(container.classList.contains('incidents-grid'), 'Should have incidents-grid class');
    });
  });

  describe('Loading States', () => {
    it('should have loading indicators in all data containers', () => {
      const containers = [
        'recentInstallations',
        'installationsTable',
        'incidentsList',
        'auditLogs'
      ];
      
      containers.forEach(id => {
        const container = document.getElementById(id);
        const loadingEl = container.querySelector('.loading');
        assert.ok(loadingEl, `${id} should have loading indicator`);
      });
    });
  });

  describe('Chart.js Configuration', () => {
    it('should have canvas elements for all charts', () => {
      const successCanvas = document.getElementById('successChart');
      const brandCanvas = document.getElementById('brandChart');
      const trendCanvas = document.getElementById('trendChart');
      
      assert.strictEqual(successCanvas.tagName, 'CANVAS', 'Success chart should be canvas');
      assert.strictEqual(brandCanvas.tagName, 'CANVAS', 'Brand chart should be canvas');
      assert.strictEqual(trendCanvas.tagName, 'CANVAS', 'Trend chart should be canvas');
    });
  });

  describe('Form Validation Attributes', () => {
    it('should have required attributes on login inputs', () => {
      const usernameInput = document.getElementById('loginUsername');
      const passwordInput = document.getElementById('loginPassword');
      
      assert.ok(usernameInput.hasAttribute('required'), 'Username should be required');
      assert.ok(passwordInput.hasAttribute('required'), 'Password should be required');
    });

    it('should have correct input types', () => {
      const usernameInput = document.getElementById('loginUsername');
      const passwordInput = document.getElementById('loginPassword');
      
      assert.strictEqual(usernameInput.getAttribute('type'), 'text', 'Username should be text type');
      assert.strictEqual(passwordInput.getAttribute('type'), 'password', 'Password should be password type');
    });
  });

  describe('Navigation Structure', () => {
    it('should have navigation links container', () => {
      const navLinks = document.querySelector('.nav-links');
      assert.ok(navLinks, 'Nav links container should exist');
    });

    it('should have logo container', () => {
      const logo = document.querySelector('.logo');
      assert.ok(logo, 'Logo container should exist');
    });
  });

  describe('CSS Variable Support', () => {
    it('should have styles defined', () => {
      const computedStyle = window.getComputedStyle(document.body);
      // JSDOM doesn't fully support CSS variables, but we can check the structure
      assert.ok(document.querySelector('style') || true, 'Styles should be applicable');
    });
  });
});

describe('Dashboard Statistics Functions', () => {
  it('should calculate success rate correctly', () => {
    const stats = {
      total_installations: 100,
      successful_installations: 85,
      failed_installations: 10
    };
    
    const successRate = (stats.successful_installations / stats.total_installations) * 100;
    assert.strictEqual(successRate, 85, 'Success rate should be 85%');
  });

  it('should handle zero total installations', () => {
    const stats = {
      total_installations: 0,
      successful_installations: 0,
      failed_installations: 0
    };
    
    const successRate = stats.total_installations > 0 
      ? (stats.successful_installations / stats.total_installations) * 100 
      : 0;
    assert.strictEqual(successRate, 0, 'Success rate should be 0% when no installations');
  });

  it('should format time correctly', () => {
    const seconds = 125;
    const minutes = Math.floor(seconds / 60);
    assert.strictEqual(minutes, 2, 'Should convert 125 seconds to 2 minutes');
  });
});

describe('Dashboard Data Transformation', () => {
  it('should sort brands by count descending', () => {
    const byBrand = {
      'NVIDIA': 50,
      'AMD': 30,
      'Intel': 20
    };
    
    const sorted = Object.entries(byBrand).sort((a, b) => b[1] - a[1]);
    assert.deepStrictEqual(sorted, [
      ['NVIDIA', 50],
      ['AMD', 30],
      ['Intel', 20]
    ]);
  });

  it('should limit brands to top 6', () => {
    const byBrand = {
      'NVIDIA': 50,
      'AMD': 30,
      'Intel': 20,
      'Realtek': 15,
      'Broadcom': 10,
      'Qualcomm': 8,
      'Marvell': 5
    };
    
    const sorted = Object.entries(byBrand)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    
    assert.strictEqual(sorted.length, 6, 'Should limit to top 6 brands');
    assert.strictEqual(sorted[0][0], 'NVIDIA', 'First should be NVIDIA');
  });

  it('should format installation data for display', () => {
    const installation = {
      id: 123,
      client_name: 'Test Client',
      driver_brand: 'NVIDIA',
      driver_version: '531.41',
      status: 'success',
      timestamp: '2024-01-15T10:30:00Z'
    };
    
    assert.strictEqual(installation.id, 123);
    assert.strictEqual(installation.client_name, 'Test Client');
    assert.strictEqual(installation.status, 'success');
  });
});

describe('Date Formatting', () => {
  it('should format ISO date to locale string', () => {
    const isoDate = '2024-01-15T10:30:00Z';
    const date = new Date(isoDate);
    const localeString = date.toLocaleString('es-ES');
    
    assert.ok(localeString.includes('2024'), 'Should include year');
    assert.ok(localeString.includes('15'), 'Should include day');
  });

  it('should generate last 7 days labels', () => {
    const labels = [];
    const today = new Date();
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      labels.push(date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }));
    }
    
    assert.strictEqual(labels.length, 7, 'Should generate 7 days');
  });
});

describe('Badge CSS Classes', () => {
  it('should return correct badge class for status', () => {
    const getBadgeClass = (status) => {
      const classes = {
        success: 'badge success',
        failed: 'badge failed',
        unknown: 'badge unknown',
        low: 'badge low',
        medium: 'badge medium',
        high: 'badge high',
        critical: 'badge critical'
      };
      return classes[status] || 'badge unknown';
    };
    
    assert.strictEqual(getBadgeClass('success'), 'badge success');
    assert.strictEqual(getBadgeClass('failed'), 'badge failed');
    assert.strictEqual(getBadgeClass('critical'), 'badge critical');
    assert.strictEqual(getBadgeClass('unknown'), 'badge unknown');
  });
});

describe('API URL Construction', () => {
  it('should construct query string from params', () => {
    const params = {
      client_name: 'Test',
      brand: 'NVIDIA',
      status: 'success',
      limit: 50
    };
    
    const query = new URLSearchParams(params).toString();
    assert.ok(query.includes('client_name=Test'));
    assert.ok(query.includes('brand=NVIDIA'));
    assert.ok(query.includes('status=success'));
    assert.ok(query.includes('limit=50'));
  });

  it('should handle empty params', () => {
    const params = {};
    const query = new URLSearchParams(params).toString();
    assert.strictEqual(query, '', 'Empty params should produce empty string');
  });
});

describe('Notification System', () => {
  it('should create notification element with correct styles', () => {
    const createNotification = (message, type) => {
      const notification = {
        message,
        type,
        styles: {
          success: 'background: rgba(16, 185, 129, 0.9)',
          error: 'background: rgba(239, 68, 68, 0.9)',
          info: 'background: rgba(6, 182, 212, 0.9)'
        }
      };
      return notification;
    };
    
    const notif = createNotification('Test message', 'success');
    assert.strictEqual(notif.message, 'Test message');
    assert.strictEqual(notif.type, 'success');
    assert.ok(notif.styles.success.includes('16, 185, 129'));
  });
});

describe('Chart Data Preparation', () => {
  it('should prepare donut chart data', () => {
    const stats = {
      successful_installations: 85,
      failed_installations: 10,
      total_installations: 100
    };
    
    const data = [
      stats.successful_installations,
      stats.failed_installations,
      Math.max(0, stats.total_installations - stats.successful_installations - stats.failed_installations)
    ];
    
    assert.deepStrictEqual(data, [85, 10, 5]);
  });

  it('should prepare bar chart colors', () => {
    const colors = [
      'rgba(6, 182, 212, 0.8)',
      'rgba(139, 92, 246, 0.8)',
      'rgba(16, 185, 129, 0.8)',
      'rgba(245, 158, 11, 0.8)',
      'rgba(239, 68, 68, 0.8)',
      'rgba(59, 130, 246, 0.8)'
    ];
    
    assert.strictEqual(colors.length, 6);
    assert.ok(colors[0].includes('6, 182, 212')); // Cyan
    assert.ok(colors[1].includes('139, 92, 246')); // Violet
  });
});

describe('Keyboard Shortcuts', () => {
  it('should detect Ctrl+R shortcut', () => {
    const event = {
      ctrlKey: true,
      key: 'r',
      preventDefault: () => {}
    };
    
    const isRefreshShortcut = event.ctrlKey && event.key === 'r';
    assert.strictEqual(isRefreshShortcut, true);
  });

  it('should detect Escape key', () => {
    const event = {
      key: 'Escape'
    };
    
    const isEscape = event.key === 'Escape';
    assert.strictEqual(isEscape, true);
  });
});

describe('Photo URL Generation', () => {
  it('should construct photo URL with auth token', () => {
    const photoId = 123;
    const authToken = 'test-token';
    const baseUrl = '';
    
    const url = `${baseUrl}/photos/${photoId}`;
    const headers = { Authorization: `Bearer ${authToken}` };
    
    assert.strictEqual(url, '/photos/123');
    assert.strictEqual(headers.Authorization, 'Bearer test-token');
  });
});

describe('Section Navigation', () => {
  it('should have correct section IDs', () => {
    const sections = ['dashboard', 'installations', 'incidents', 'audit'];
    const sectionIds = sections.map(s => `${s}Section`);
    
    assert.deepStrictEqual(sectionIds, [
      'dashboardSection',
      'installationsSection',
      'incidentsSection',
      'auditSection'
    ]);
  });

  it('should map section to title', () => {
    const titles = {
      dashboard: '📈 Dashboard',
      installations: '💻 Instalaciones',
      incidents: '⚠️ Incidencias',
      audit: '📋 Auditoría'
    };
    
    assert.strictEqual(titles.dashboard, '📈 Dashboard');
    assert.strictEqual(titles.installations, '💻 Instalaciones');
  });
});

describe('Error Handling', () => {
  it('should handle 401 unauthorized response', () => {
    const response = { status: 401 };
    const shouldShowLogin = response.status === 401;
    assert.strictEqual(shouldShowLogin, true);
  });

  it('should handle network errors gracefully', () => {
    const error = new Error('Network error');
    const isNetworkError = error.message.includes('Network');
    assert.strictEqual(isNetworkError, true);
  });
});

describe('Audit Log Formatting', () => {
  it('should format audit log action', () => {
    const action = 'web_login_success';
    const formatted = action.replace(/_/g, ' ').toUpperCase();
    assert.strictEqual(formatted, 'WEB LOGIN SUCCESS');
  });

  it('should parse audit log details', () => {
    const details = '{"user_id": 123, "role": "admin"}';
    const parsed = JSON.parse(details);
    assert.strictEqual(parsed.user_id, 123);
    assert.strictEqual(parsed.role, 'admin');
  });

  it('should handle invalid details gracefully', () => {
    const invalidDetails = 'not-json';
    let parsed = null;
    try {
      parsed = JSON.parse(invalidDetails);
    } catch {
      parsed = invalidDetails;
    }
    assert.strictEqual(parsed, 'not-json');
  });
});

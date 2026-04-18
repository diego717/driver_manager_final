(function attachDashboardAuthFactory(global) {
    function createDashboardAuth(options) {
        function normalizeRoleValue(role, fallback = 'solo_lectura') {
            const normalizedRole = String(role || fallback).trim().toLowerCase();
            if (!normalizedRole) return String(fallback || 'solo_lectura').trim().toLowerCase() || 'solo_lectura';
            if (normalizedRole === 'viewer') return 'solo_lectura';
            return normalizedRole;
        }

        function getCurrentRole() {
            return normalizeRoleValue(options.getCurrentUser()?.role || '');
        }

        function formatRoleLabel(role, tenantId = "") {
            const normalizedRole = normalizeRoleValue(role, '');
            const normalizedTenantId = String(tenantId || "").trim().toLowerCase();
            if (
                normalizedRole === "platform_owner" ||
                (normalizedRole === "super_admin" && normalizedTenantId === "default")
            ) {
                return "platform_owner";
            }
            if (normalizedRole === 'solo_lectura') return 'solo_lectura';
            if (normalizedRole === 'tecnico') return 'tecnico';
            if (normalizedRole === 'supervisor') return 'supervisor';
            return normalizedRole || 'admin';
        }

        function canCurrentUserManagePlatform() {
            const role = getCurrentRole();
            return role === 'platform_owner' || role === 'super_admin';
        }

        function canCurrentUserManageUsers() {
            const role = getCurrentRole();
            return role === 'admin' || canCurrentUserManagePlatform();
        }

        function canCurrentUserManageTechnicians() {
            return canCurrentUserManageUsers();
        }

        function canCurrentUserViewTechnicianCatalog() {
            const role = getCurrentRole();
            return role === 'admin'
                || role === 'supervisor'
                || role === 'solo_lectura'
                || canCurrentUserManagePlatform();
        }

        function canCurrentUserManageTechnicianAssignments() {
            const role = getCurrentRole();
            return role === 'admin' || role === 'supervisor' || canCurrentUserManagePlatform();
        }

        function canCurrentUserWriteOperationalData() {
            const role = getCurrentRole();
            return role === 'admin' || role === 'supervisor' || role === 'tecnico' || canCurrentUserManagePlatform();
        }

        function canCurrentUserEditAssets() {
            return canCurrentUserManageUsers();
        }

        function canCurrentUserViewAssetCatalog() {
            const role = getCurrentRole();
            return role === 'admin'
                || role === 'supervisor'
                || role === 'solo_lectura'
                || canCurrentUserManagePlatform();
        }

        function canCurrentUserManageAssetLinks() {
            const role = getCurrentRole();
            return role === 'admin' || role === 'supervisor' || canCurrentUserManagePlatform();
        }

        function canCurrentUserManageAssetLoans() {
            return canCurrentUserManageAssetLinks();
        }

        function canCurrentUserViewTenantIncidentMap() {
            const role = getCurrentRole();
            return role === 'admin'
                || role === 'supervisor'
                || role === 'solo_lectura'
                || canCurrentUserManagePlatform();
        }

        function canCurrentUserOpenIncidentMap() {
            const role = getCurrentRole();
            return hasActiveSession() && (
                canCurrentUserViewTenantIncidentMap()
                || role === 'tecnico'
            );
        }

        function canCurrentUserViewGlobalIncidents() {
            const role = getCurrentRole();
            return role !== 'tecnico' && hasActiveSession();
        }

        function canCurrentUserReopenIncidents() {
            const role = getCurrentRole();
            return role === 'admin' || role === 'supervisor' || canCurrentUserManagePlatform();
        }

        function showLogin() {
            resetProtectedViews();
            syncRoleBasedNavigationAccess();
            const usernameField = document.getElementById('loginUsername');
            options.openAccessibleModal('loginModal', { preferredElement: usernameField });
        }

        function hideLogin() {
            options.closeAccessibleModal('loginModal');
            const errorEl = document.getElementById('loginError');
            if (errorEl) {
                errorEl.textContent = '';
            }
        }

        function resetProtectedViews() {
            const ids = [
                'recentInstallations',
                'installationsTable',
                'assetsTable',
                'assetDetail',
                'incidentsList',
                'auditLogs',
                'resultsCount',
                'assetsResultsCount',
            ];
            const placeholderById = {
                recentInstallations: { type: 'html', message: 'Sin registros recientes por ahora.' },
                installationsTable: { type: 'html', message: 'Usa filtros o actualiza para ver registros.' },
                assetsTable: { type: 'html', message: 'Usa la busqueda para listar equipos.' },
                assetDetail: { type: 'html', message: 'Selecciona un equipo para ver sus datos de contexto.' },
                incidentsList: { type: 'html', message: 'Abre un registro o entra desde Equipos para ver incidencias con contexto.' },
                auditLogs: { type: 'html', message: 'Selecciona filtros para ver actividad de auditoría.' },
                resultsCount: { type: 'text', message: 'Sin registros para mostrar.' },
                assetsResultsCount: { type: 'text', message: 'Sin equipos para mostrar.' },
            };
            ids.forEach((id) => {
                const el = document.getElementById(id);
                if (!el) return;
                const placeholder = placeholderById[id] || { type: 'html', message: 'Sin informacion para mostrar.' };
                if (placeholder.type === 'text') {
                    el.textContent = placeholder.message;
                    return;
                }
                el.innerHTML = `<p class="loading">${placeholder.message}</p>`;
            });

            options.resetDataViews();
            options.closeHeaderOverflowMenu();
            options.closeMobileNavPanel();
            syncRoleBasedNavigationAccess();
            updateSettingsSummary();
            const activeSection = options.getActiveSectionName() || 'dashboard';
            options.syncMobileNavMoreState(activeSection);
            options.syncHeaderPrimaryAction(activeSection);
            options.setNotificationBadgeCount(0);
        }

        function hasActiveSession() {
            return Boolean(options.getCurrentUser()?.username);
        }

        function requireActiveSession() {
            if (hasActiveSession()) return true;
            showLogin();
            return false;
        }

        function canCurrentUserAccessAudit() {
            return canCurrentUserManageUsers();
        }

        function setSectionAccessVisibility(section, isVisible, selectors = []) {
            selectors.forEach((selector) => {
                const node = document.querySelector(selector);
                if (!(node instanceof HTMLElement)) return;
                node.classList.toggle('is-hidden', !isVisible);
                node.hidden = !isVisible;
            });
        }

        function syncRoleBasedNavigationAccess() {
            const shouldShowAudit = canCurrentUserAccessAudit();
            const shouldShowTechnicians = canCurrentUserViewTechnicianCatalog();
            const shouldShowAssets = canCurrentUserViewAssetCatalog();
            const shouldShowIncidentMap = canCurrentUserOpenIncidentMap();
            const shouldShowIncidents = canCurrentUserViewGlobalIncidents();

            setSectionAccessVisibility('incidents', shouldShowIncidents, [
                '.nav-links a[data-section="incidents"]',
                '#mobileNavIncidentsBtn',
            ]);
            setSectionAccessVisibility('incidentMap', shouldShowIncidentMap, [
                '.nav-links a[data-section="incidentMap"]',
                '#mobileNavIncidentMapBtn',
            ]);
            setSectionAccessVisibility('assets', shouldShowAssets, [
                '.nav-links a[data-section="assets"]',
                '#mobileNavAssetsBtn',
            ]);
            setSectionAccessVisibility('audit', shouldShowAudit, [
                '.nav-links a[data-section="audit"]',
                '#mobileNavAuditBtn',
                '#settingsOpenAuditBtn',
            ]);

            const techniciansPanel = document.getElementById('settingsTechniciansPanel');
            if (techniciansPanel) {
                techniciansPanel.hidden = !shouldShowTechnicians;
            }

            const activeSection = options.getActiveSectionName?.() || 'dashboard';
            const blockedActiveSection = (
                (activeSection === 'audit' && !shouldShowAudit)
                || (activeSection === 'assets' && !shouldShowAssets)
                || (activeSection === 'incidentMap' && !shouldShowIncidentMap)
                || (activeSection === 'incidents' && !shouldShowIncidents)
            );
            if (blockedActiveSection && typeof options.navigateToSectionByKey === 'function') {
                const fallbackSection = hasActiveSession() && getCurrentRole() === 'tecnico' ? 'myCases' : 'dashboard';
                options.navigateToSectionByKey(fallbackSection);
            }
        }

        function syncMobileNavContext() {
            const username = String(options.getCurrentUser()?.username || 'Usuario');
            const role = formatRoleLabel(
                options.getCurrentUser()?.role || 'admin',
                options.getCurrentUser()?.tenant_id || '',
            );
            const initial = (username || 'U').charAt(0).toUpperCase();

            const mobileUsernameEl = document.getElementById('mobileNavUsername');
            const mobileRoleEl = document.getElementById('mobileNavRole');
            const mobileInitialEl = document.getElementById('mobileNavInitial');

            if (mobileUsernameEl) mobileUsernameEl.textContent = username;
            if (mobileRoleEl) mobileRoleEl.textContent = role;
            if (mobileInitialEl) mobileInitialEl.textContent = initial;
        }

        function updateSettingsSyncLabel(status = 'paused') {
            const labelEl = document.getElementById('settingsSyncStatus');
            if (!labelEl) return;
            const normalized = ['connected', 'disconnected', 'reconnecting', 'paused', 'failed'].includes(status)
                ? status
                : 'paused';
            const labels = {
                connected: 'Conectado en tiempo real',
                disconnected: 'Conexión interrumpida',
                reconnecting: 'Reconectando',
                paused: 'Sincronización en pausa',
                failed: 'Sin enlace en tiempo real',
            };
            labelEl.textContent = labels[normalized] || labels.paused;
        }

        function updateSettingsSummary() {
            const currentUser = options.getCurrentUser();
            const usernameEl = document.getElementById('settingsUsername');
            const roleEl = document.getElementById('settingsRole');
            if (usernameEl) {
                usernameEl.textContent = String(currentUser?.username || '-');
            }
            if (roleEl) {
                roleEl.textContent = formatRoleLabel(currentUser?.role || '-', currentUser?.tenant_id || '');
            }
            syncMobileNavContext();
            updateSettingsSyncLabel(options.getConnectionStatus());
        }

        function applyAuthenticatedUser(user) {
            options.setCurrentUser(user);
            document.getElementById('username').textContent = user.username || 'Usuario';
            document.getElementById('userRole').textContent = formatRoleLabel(user.role || 'admin', user.tenant_id || '');
            const initial = (user.username || 'U').charAt(0).toUpperCase();
            const avatarEl = document.getElementById('userInitial');
            if (avatarEl) avatarEl.textContent = initial;
            syncRoleBasedNavigationAccess();
            updateSettingsSummary();
            const activeSection = options.getActiveSectionName() || 'dashboard';
            options.syncMobileNavMoreState(activeSection);
            options.syncHeaderPrimaryAction(activeSection);
        }

        function resetToLoggedOutState() {
            options.clearSessionState();
            options.closeSSE();
            resetProtectedViews();
            showLogin();
        }

        function handleUnauthorized() {
            resetToLoggedOutState();
        }

        async function handleLoginSubmit(event) {
            event.preventDefault();
            const username = document.getElementById('loginUsername')?.value || '';
            const password = document.getElementById('loginPassword')?.value || '';

            try {
                const result = await options.api.login(username, password);
                options.clearWebAccessToken();
                applyAuthenticatedUser(result.user);
                hideLogin();
                options.loadDashboard({ followupDelayMs: 1200 });
                options.syncSSEForCurrentContext(true);
                options.showNotification(`Bienvenido, ${result.user.username}!`, 'success');
            } catch (_error) {
                const errorEl = document.getElementById('loginError');
                if (errorEl) {
                    errorEl.textContent = 'Credenciales inválidas';
                }
                const passwordEl = document.getElementById('loginPassword');
                if (passwordEl) {
                    passwordEl.value = '';
                }
            }
        }

        async function handleLogout() {
            try {
                await options.api.logout();
            } catch (error) {
                console.error('Error during logout:', error);
            }

            resetToLoggedOutState();
            options.showNotification('Sesión cerrada', 'info');
        }

        function handleRefresh() {
            if (!requireActiveSession()) return;
            const btn = document.getElementById('refreshBtn');
            if (btn) {
                const spinTarget = btn.querySelector('.material-symbols-outlined') || btn;
                spinTarget.classList.add('btn-spin-once');
                setTimeout(() => {
                    spinTarget.classList.remove('btn-spin-once');
                }, 520);
            }

            options.loadDashboard({ followupDelayMs: 1200 });
            options.showNotification('Dashboard actualizado', 'info');
        }

        function bindSessionUi() {
            document.getElementById('loginForm')?.addEventListener('submit', handleLoginSubmit);
            document.getElementById('logoutBtn')?.addEventListener('click', () => {
                void handleLogout();
            });
            document.getElementById('refreshBtn')?.addEventListener('click', handleRefresh);
            document.getElementById('settingsLogoutBtn')?.addEventListener('click', () => {
                document.getElementById('logoutBtn')?.click();
            });
        }

        return {
            applyAuthenticatedUser,
            bindSessionUi,
            canCurrentUserEditAssets,
            canCurrentUserAccessAudit,
            canCurrentUserManagePlatform,
            canCurrentUserManageAssetLinks,
            canCurrentUserManageAssetLoans,
            canCurrentUserManageTechnicianAssignments,
            canCurrentUserManageTechnicians,
            canCurrentUserManageUsers,
            canCurrentUserOpenIncidentMap,
            canCurrentUserReopenIncidents,
            canCurrentUserViewAssetCatalog,
            canCurrentUserViewGlobalIncidents,
            canCurrentUserWriteOperationalData,
            canCurrentUserViewTechnicianCatalog,
            canCurrentUserViewTenantIncidentMap,
            handleUnauthorized,
            hasActiveSession,
            hideLogin,
            requireActiveSession,
            resetProtectedViews,
            resetToLoggedOutState,
            showLogin,
            syncMobileNavContext,
            syncRoleBasedNavigationAccess,
            updateSettingsSummary,
            updateSettingsSyncLabel,
        };
    }

    global.createDashboardAuth = createDashboardAuth;
})(window);

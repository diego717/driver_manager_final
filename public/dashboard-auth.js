(function attachDashboardAuthFactory(global) {
    function createDashboardAuth(options) {
        function formatRoleLabel(role, tenantId = "") {
            const normalizedRole = String(role || "").trim().toLowerCase();
            const normalizedTenantId = String(tenantId || "").trim().toLowerCase();
            if (
                normalizedRole === "platform_owner" ||
                (normalizedRole === "super_admin" && normalizedTenantId === "default")
            ) {
                return "platform_owner";
            }
            return String(role || "admin");
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
            ids.forEach((id) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.innerHTML = '<p class="loading">Inicia sesión para ver información.</p>';
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
            const role = String(options.getCurrentUser()?.role || '').toLowerCase();
            return role === 'admin' || role === 'super_admin' || role === 'platform_owner';
        }

        function syncRoleBasedNavigationAccess() {
            const auditLink = document.querySelector('.nav-links a[data-section="audit"]');
            const shouldShowAudit = canCurrentUserAccessAudit();
            if (auditLink) {
                const parent = auditLink.closest('li');
                if (parent) {
                    parent.classList.toggle('is-hidden', !shouldShowAudit);
                }
            }
            const mobileAuditBtn = document.getElementById('mobileNavAuditBtn');
            if (mobileAuditBtn) {
                mobileAuditBtn.classList.toggle('is-hidden', !shouldShowAudit);
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
            canCurrentUserAccessAudit,
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

// Domain: auth (session gating + login modal behavior)

function isLoginModalActive() {
    return Boolean(document.getElementById('loginModal')?.classList.contains('active'));
}

function getLoginModalFocusableElements() {
    const modal = document.getElementById('loginModal');
    if (!modal) return [];
    return Array.from(modal.querySelectorAll(LOGIN_MODAL_FOCUSABLE_SELECTOR))
        .filter((el) => {
            if (!el) return false;
            if (el.disabled) return false;
            if (el.getAttribute('aria-hidden') === 'true') return false;
            return true;
        });
}

function focusLoginModalEntryField() {
    const usernameInput = document.getElementById('loginUsername');
    if (usernameInput && typeof usernameInput.focus === 'function') {
        usernameInput.focus();
        return;
    }
    const focusables = getLoginModalFocusableElements();
    if (focusables[0] && typeof focusables[0].focus === 'function') {
        focusables[0].focus();
    }
}

function handleLoginModalKeydown(event) {
    if (!isLoginModalActive()) return false;
    if (!event) return false;

    if (event.key === 'Escape') {
        event.preventDefault();
        hideLogin();
        return true;
    }

    if (event.key !== 'Tab') return false;

    const focusables = getLoginModalFocusableElements();
    if (!focusables.length) {
        event.preventDefault();
        return true;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (!focusables.includes(active)) {
        event.preventDefault();
        first.focus();
        return true;
    }

    if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return true;
    }

    if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
        return true;
    }

    return false;
}

function showLogin(options = {}) {
    const preserveViews = options && options.preserveViews === true;
    if (!preserveViews) {
        resetProtectedViews();
    }
    syncRoleBasedNavigationAccess();
    const loginModal = document.getElementById('loginModal');
    if (!loginModal) return;
    if (!isLoginModalActive()) {
        loginModalLastFocusedElement = document.activeElement;
    }
    loginModal.classList.add('active');
    document.body.classList.add('modal-open');
    focusLoginModalEntryField();
}

function hideLogin() {
    const loginModal = document.getElementById('loginModal');
    if (loginModal) {
        loginModal.classList.remove('active');
    }
    document.body.classList.remove('modal-open');
    const loginError = document.getElementById('loginError');
    if (loginError) {
        loginError.textContent = '';
    }
    if (
        loginModalLastFocusedElement &&
        loginModalLastFocusedElement !== document.body &&
        typeof loginModalLastFocusedElement.focus === 'function'
    ) {
        loginModalLastFocusedElement.focus();
    }
    loginModalLastFocusedElement = null;
}

function normalizeInstallationsPayload(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (payload && typeof payload === 'object') {
        if (Array.isArray(payload.items)) {
            return payload.items;
        }
        if (Array.isArray(payload.installations)) {
            return payload.installations;
        }
        if (Array.isArray(payload.data)) {
            return payload.data;
        }
    }
    return [];
}

function resetProtectedViews() {
    if (hasActiveSession()) {
        return;
    }
    revokeIncidentPhotoThumbBlobUrls();
    closePhotoModal();
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
        el.innerHTML = '<p class="loading">Inicia sesion para ver informacion.</p>';
    });
    currentInstallationsData = [];
    currentSelectedInstallationId = null;
    currentAssetsData = [];
    currentSelectedAssetId = null;
    syncRoleBasedNavigationAccess();
}

function hasActiveSession() {
    return Boolean(currentUser && currentUser.username);
}

function requireActiveSession() {
    if (hasActiveSession()) return true;
    showLogin();
    return false;
}

function canCurrentUserAccessAudit() {
    const role = String(currentUser?.role || '').toLowerCase();
    return role === 'admin' || role === 'super_admin';
}

function isExpectedSessionBootstrapError(error) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) return false;
    return (
        message.includes('unauthorized') ||
        message.includes('no autorizado') ||
        message.includes('sesion') ||
        message.includes('token')
    );
}

function syncRoleBasedNavigationAccess() {
    const auditLink = document.querySelector('.nav-links a[data-section="audit"]');
    if (!auditLink) return;
    const shouldShowAudit = canCurrentUserAccessAudit();
    const parent = auditLink.closest('li');
    if (parent) {
        parent.classList.toggle('is-hidden', !shouldShowAudit);
    }
}

function applyAuthenticatedUser(user) {
    currentUser = user;
    document.getElementById('username').textContent = user.username || 'Usuario';
    document.getElementById('userRole').textContent = user.role || 'admin';
    const initial = (user.username || 'U').charAt(0).toUpperCase();
    const avatarEl = document.getElementById('userInitial');
    if (avatarEl) avatarEl.textContent = initial;
    syncRoleBasedNavigationAccess();
}

function normalizeSeverity(input) {
    const valid = ['low', 'medium', 'high', 'critical'];
    const value = String(input || '').trim().toLowerCase();
    return valid.includes(value) ? value : 'medium';
}

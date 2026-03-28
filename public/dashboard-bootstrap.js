(function attachDashboardBootstrapFactory(global) {
    function createDashboardBootstrap(options) {
        let visibilityHandlerBound = false;
        let unloadHandlerBound = false;

        async function bootstrapSessionState() {
            try {
                if (options.forceLoginOnOpen) {
                    try {
                        await options.api.logout();
                    } catch (_err) {
                        // Ignore stale server-side session cleanup failures.
                    }
                    options.resetToLoggedOutState();
                    return;
                }

                const me = await options.api.getMe();
                options.applyAuthenticatedUser(me);
                options.hideLogin();
                options.loadDashboard({ followupDelayMs: 1200 });
                options.syncSSEForCurrentContext(true);
            } catch (error) {
                console.error('Error validating session:', error);
                options.resetToLoggedOutState();
            }
        }

        async function init() {
            options.setupAdvancedFilters();
            options.setupExportButtons();
            options.setupThemeToggle();
            options.setupHeaderOverflowMenu();
            options.setupMobileNavPanel();
            options.setupTrendRangeToggle();

            const initialSection = options.getActiveSectionName() || 'dashboard';
            options.syncHeaderDelight(initialSection, 'paused');
            options.syncMobileNavContext();
            options.syncMobileNavMoreState(initialSection);
            options.syncHeaderPrimaryAction(initialSection);
            options.validateAllSectionBindings();

            await bootstrapSessionState();

            if (!visibilityHandlerBound) {
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        console.log('[SSE] Page visible, reconnecting...');
                        options.syncSSEForCurrentContext(true);
                        return;
                    }
                    options.closeSSE();
                    options.updateConnectionStatus('paused');
                });
                visibilityHandlerBound = true;
            }

            if (!unloadHandlerBound) {
                window.addEventListener('beforeunload', options.closeSSE);
                unloadHandlerBound = true;
            }
        }

        return { init };
    }

    global.createDashboardBootstrap = createDashboardBootstrap;
})(window);

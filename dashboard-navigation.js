(function attachDashboardNavigationFactory(global) {
    function createDashboardNavigation(options) {
        const transitionOutMs = Number.isFinite(options.sectionTransitionOutMs)
            ? options.sectionTransitionOutMs
            : 150;
        let sectionTransitionVersion = 0;

        function getActiveSectionName() {
            const activeSection = document.querySelector('.section.active');
            if (!activeSection?.id) return '';
            return activeSection.id.replace(/Section$/, '');
        }

        function runSectionLoaders(section) {
            options.validateSectionBindings(section, { notify: true });
            if (section === 'dashboard') options.loadDashboard({ followupDelayMs: 1200 });
            if (section === 'installations') options.loadInstallations();
            if (section === 'incidents') options.loadIncidentsWorkspace?.();
            if (section === 'assets') options.loadAssets();
            if (section === 'drivers') options.loadDrivers();
            if (section === 'audit') options.loadAuditLogs();
        }

        function navigateToSectionByKey(section) {
            const link = document.querySelector(`.nav-links a[data-section="${section}"]`);
            if (link instanceof HTMLElement) {
                link.click();
                return true;
            }
            return false;
        }

        async function activateSection(section) {
            const nextSection = document.getElementById(section + 'Section');
            if (!nextSection) return;

            const currentSection = document.querySelector('.section.active');
            const transitionId = ++sectionTransitionVersion;

            if (!currentSection || currentSection === nextSection || options.prefersReducedMotion()) {
                document.querySelectorAll('.section').forEach((sectionNode) => {
                    sectionNode.classList.remove('active', 'is-transitioning-out');
                });
                nextSection.classList.add('active');
                options.updatePageTitleForSection(section);
                runSectionLoaders(section);
                options.syncSSEForCurrentContext();
                return;
            }

            currentSection.classList.add('is-transitioning-out');
            currentSection.classList.remove('active');

            await new Promise((resolve) => {
                setTimeout(resolve, transitionOutMs);
            });

            if (transitionId !== sectionTransitionVersion) {
                return;
            }

            currentSection.classList.remove('is-transitioning-out');
            document.querySelectorAll('.section').forEach((sectionNode) => {
                if (sectionNode !== nextSection) {
                    sectionNode.classList.remove('active', 'is-transitioning-out');
                }
            });
            nextSection.classList.add('active');
            options.updatePageTitleForSection(section);
            runSectionLoaders(section);
            options.syncSSEForCurrentContext();
        }

        return {
            activateSection,
            getActiveSectionName,
            navigateToSectionByKey,
            runSectionLoaders,
        };
    }

    global.createDashboardNavigation = createDashboardNavigation;
})(window);

(function attachDashboardNavigationFactory(global) {
    function createDashboardNavigation(options) {
        const transitionOutMs = Number.isFinite(options.sectionTransitionOutMs)
            ? options.sectionTransitionOutMs
            : 150;
        let sectionTransitionVersion = 0;

        function sectionNameFromNode(node) {
            if (!(node instanceof HTMLElement) || !node.id) return '';
            return node.id.replace(/Section$/, '');
        }

        function emitSectionTransitionStart(fromSection, toSection) {
            if (typeof options.onSectionTransitionStart !== 'function') return;
            options.onSectionTransitionStart({
                fromSection: String(fromSection || ''),
                toSection: String(toSection || ''),
            });
        }

        function emitSectionTransitionEnd(fromSection, toSection) {
            if (typeof options.onSectionTransitionEnd !== 'function') return;
            options.onSectionTransitionEnd({
                fromSection: String(fromSection || ''),
                toSection: String(toSection || ''),
            });
        }

        function getActiveSectionName() {
            const activeSection = document.querySelector('.section.active');
            if (!activeSection?.id) return '';
            return activeSection.id.replace(/Section$/, '');
        }

        function runSectionLoaders(section) {
            options.validateSectionBindings(section, { notify: true });
            if (section === 'dashboard') options.loadDashboard({ followupDelayMs: 1200 });
            if (section === 'myCases') options.loadMyCasesSection?.();
            if (section === 'installations') options.loadInstallations();
            if (section === 'incidents') options.loadIncidentsWorkspace?.();
            if (section === 'incidentMap') options.loadIncidentMapWorkspace?.();
            if (section === 'assets') options.loadAssets();
            if (section === 'drivers') options.loadDrivers();
            if (section === 'tenants') options.loadTenants?.();
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

        function triggerSectionEntrance(sectionNode) {
            if (!(sectionNode instanceof HTMLElement) || options.prefersReducedMotion()) return;
            sectionNode.classList.remove('section-animate-in');
            void sectionNode.offsetWidth;
            sectionNode.classList.add('section-animate-in');
            window.setTimeout(() => {
                sectionNode.classList.remove('section-animate-in');
            }, 720);
        }

        async function activateSection(section) {
            const nextSection = document.getElementById(section + 'Section');
            if (!nextSection) return;

            const currentSection = document.querySelector('.section.active');
            const transitionId = ++sectionTransitionVersion;
            const fromSection = sectionNameFromNode(currentSection);
            const shouldEmitTransition = fromSection !== section;
            if (shouldEmitTransition) {
                emitSectionTransitionStart(fromSection, section);
            }

            if (!currentSection || currentSection === nextSection || options.prefersReducedMotion()) {
                document.querySelectorAll('.section').forEach((sectionNode) => {
                    sectionNode.classList.remove('active', 'is-transitioning-out');
                });
                nextSection.classList.add('active');
                triggerSectionEntrance(nextSection);
                options.updatePageTitleForSection(section);
                runSectionLoaders(section);
                options.syncSSEForCurrentContext();
                if (shouldEmitTransition) {
                    emitSectionTransitionEnd(fromSection, section);
                }
                return;
            }

            currentSection.classList.add('is-transitioning-out');

            await new Promise((resolve) => {
                setTimeout(resolve, transitionOutMs);
            });

            if (transitionId !== sectionTransitionVersion) {
                return;
            }

            currentSection.classList.remove('is-transitioning-out', 'active');
            document.querySelectorAll('.section').forEach((sectionNode) => {
                if (sectionNode !== nextSection) {
                    sectionNode.classList.remove('active', 'is-transitioning-out');
                }
            });
            nextSection.classList.add('active');
            triggerSectionEntrance(nextSection);
            options.updatePageTitleForSection(section);
            runSectionLoaders(section);
            options.syncSSEForCurrentContext();
            if (shouldEmitTransition) {
                emitSectionTransitionEnd(fromSection, section);
            }
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

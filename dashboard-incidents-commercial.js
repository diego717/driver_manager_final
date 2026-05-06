(function attachDashboardIncidentsCommercialFactory(global) {
    function createDashboardIncidentsCommercial(ctx) {
        const {
            options,
            createInputGroup,
            buildTechnicianSelect,
            createGpsCapturePanel,
            hydrateTechnicianSelectFromContext,
            runIncidentRefreshInBackground,
        } = ctx;
        const CONFORMITY_GPS_PANEL_ID = 'actionConformityGpsPanel';
        const CONFORMITY_GPS_STATUS_ID = 'actionConformityGpsStatus';
        const CONFORMITY_GPS_SUMMARY_ID = 'actionConformityGpsSummary';
        const CONFORMITY_GPS_RETRY_ID = 'actionConformityGpsRetryBtn';
        const CONFORMITY_GPS_OVERRIDE_WRAP_ID = 'actionConformityGpsOverrideWrap';
        const CONFORMITY_GPS_OVERRIDE_INPUT_ID = 'actionConformityGpsOverrideNote';
        const CONFORMITY_GPS_OVERRIDE_HELP_ID = 'actionConformityGpsOverrideHelp';
        const CONFORMITY_SIGNATURE_CANVAS_ID = 'actionConformitySignatureCanvas';
        const CONFORMITY_SIGNATURE_CLEAR_ID = 'actionConformitySignatureClearBtn';
        const DEFAULT_COMMERCIAL_CLOSURE_MODE = 'budget_required';
        const COMMERCIAL_CLOSURE_MODE_LABELS = {
            budget_required: 'Requiere presupuesto',
            warranty_included: 'Garantia incluida',
            plan_included: 'Servicio mensual incluido',
            courtesy_included: 'Cortesia comercial',
        };
        let currentConformitySignaturePad = null;

        function isButtonElement(element) {
            return element instanceof HTMLElement && element.tagName === 'BUTTON';
        }

        function formatConformityStatusLabel(status) {
            const normalized = String(status || '').trim().toLowerCase();
            if (normalized === 'emailed') return 'Email enviado';
            if (normalized === 'email_failed') return 'Email con error';
            return 'Generada';
        }

        function formatConformityGeneratedAt(value) {
            const date = value ? new Date(value) : null;
            if (!date || Number.isNaN(date.getTime())) return 'Sin fecha';
            return date.toLocaleString('es-ES');
        }

        function formatBudgetGeneratedAt(value) {
            const date = value ? new Date(value) : null;
            if (!date || Number.isNaN(date.getTime())) return 'Sin fecha';
            return date.toLocaleString('es-ES');
        }

        function formatBudgetApprovalStatusLabel(status) {
            const normalized = String(status || '').trim().toLowerCase();
            if (normalized === 'approved') return 'Aprobado';
            if (normalized === 'superseded') return 'Reemplazado';
            if (normalized === 'rejected') return 'Rechazado';
            return 'Pendiente';
        }

        function formatBudgetDeliveryStatusLabel(status) {
            const normalized = String(status || '').trim().toLowerCase();
            if (normalized === 'emailed') return 'Email enviado';
            if (normalized === 'email_failed') return 'Email con error';
            return 'Generado';
        }

        function normalizeCommercialClosureMode(value) {
            const normalized = String(value || DEFAULT_COMMERCIAL_CLOSURE_MODE).trim().toLowerCase();
            if (!normalized) return DEFAULT_COMMERCIAL_CLOSURE_MODE;
            if (Object.prototype.hasOwnProperty.call(COMMERCIAL_CLOSURE_MODE_LABELS, normalized)) {
                return normalized;
            }
            return DEFAULT_COMMERCIAL_CLOSURE_MODE;
        }

        function isBudgetRequiredForCommercialClosure(mode) {
            return normalizeCommercialClosureMode(mode) === DEFAULT_COMMERCIAL_CLOSURE_MODE;
        }

        function formatCommercialClosureModeLabel(mode) {
            const normalized = normalizeCommercialClosureMode(mode);
            return COMMERCIAL_CLOSURE_MODE_LABELS[normalized] || COMMERCIAL_CLOSURE_MODE_LABELS[DEFAULT_COMMERCIAL_CLOSURE_MODE];
        }

        function resolveInstallationCommercialClosure(installation) {
            const mode = normalizeCommercialClosureMode(installation?.commercial_closure_mode);
            return {
                mode,
                label: formatCommercialClosureModeLabel(mode),
                note: String(installation?.commercial_closure_note || '').trim(),
                setAt: String(installation?.commercial_closure_set_at || '').trim(),
                setBy: String(installation?.commercial_closure_set_by || '').trim(),
                requiresApprovedBudget: isBudgetRequiredForCommercialClosure(mode),
            };
        }

        function formatCurrencyFromCents(centsCandidate, currencyCode = 'UYU') {
            const cents = Number.parseInt(String(centsCandidate ?? '0'), 10);
            const safeCents = Number.isInteger(cents) ? cents : 0;
            const normalizedCurrency = String(currencyCode || 'UYU').trim().toUpperCase() || 'UYU';
            try {
                return new Intl.NumberFormat('es-UY', {
                    style: 'currency',
                    currency: normalizedCurrency,
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                }).format(safeCents / 100);
            } catch {
                return `${normalizedCurrency} ${(safeCents / 100).toFixed(2)}`;
            }
        }

        function createConformityStatusChip(label, tone = 'neutral') {
            const chip = document.createElement('span');
            chip.className = 'incident-highlight-chip';
            chip.dataset.tone = tone;
            chip.textContent = label;
            return chip;
        }

        function formatActiveIncidentsLabel(activeIncidentCount) {
            const count = Math.max(0, Number(activeIncidentCount) || 0);
            return count === 0
                ? 'Sin incidencias activas, listo para cerrar'
                : `${count} incidencia${count === 1 ? '' : 's'} activa${count === 1 ? '' : 's'}`;
        }

        function resolveClosureBannerState(
            activeIncidentCount,
            latestConformityStatus = '',
            hasApprovedBudget = false,
            requiresApprovedBudget = true,
        ) {
            const count = Math.max(0, Number(activeIncidentCount) || 0);
            const latestStatus = String(latestConformityStatus || '').trim().toLowerCase();
            if (count > 0) {
                return {
                    tone: 'warning',
                    eyebrow: 'En atenciÃ³n',
                    title: 'Caso en atenciÃ³n operativa',
                    description: 'TodavÃ­a hay incidencias activas. ResuÃ©lvelas antes de emitir la conformidad final.',
                };
            }
            if (requiresApprovedBudget && !hasApprovedBudget) {
                return {
                    tone: 'warning',
                    eyebrow: 'Presupuesto pendiente',
                    title: 'Falta presupuesto aprobado',
                    description: 'No quedan incidencias activas, pero debes aprobar el Ãºltimo presupuesto antes de emitir la conformidad final.',
                };
            }
            if (latestStatus === 'emailed') {
                return {
                    tone: 'resolved',
                    eyebrow: 'Conformidad enviada',
                    title: 'Cierre operativo completado',
                    description: 'La Ãºltima conformidad ya fue generada y enviada por email. Puedes descargar el PDF o reabrir trabajo si surge una novedad.',
                };
            }
            if (latestStatus === 'email_failed') {
                return {
                    tone: 'warning',
                    eyebrow: 'EnvÃ­o pendiente',
                    title: 'La conformidad existe pero el email fallÃ³',
                    description: 'El PDF ya fue generado. Revisa la constancia anterior o vuelve a emitirla para intentar otro envÃ­o.',
                };
            }
            if (latestStatus === 'generated') {
                return {
                    tone: 'info',
                    eyebrow: 'Conformidad generada',
                    title: 'El PDF ya estÃ¡ disponible',
                    description: 'La constancia ya fue generada, pero no se enviÃ³ por email. Puedes revisarla o generar una nueva desde este registro.',
                };
            }
            return {
                tone: 'resolved',
                eyebrow: 'Listo para cierre',
                title: 'Caso listo para conformidad',
                description: requiresApprovedBudget
                    ? 'No quedan incidencias activas. Genera la conformidad final y envÃ­a el PDF desde aquÃ­.'
                    : 'No quedan incidencias activas. Este caso tiene cobertura comercial y puede cerrarse sin presupuesto.',
            };
        }

        function applyClosureBannerState(
            banner,
            activeIncidentCount,
            latestConformityStatus = '',
            hasApprovedBudget = false,
            requiresApprovedBudget = true,
        ) {
            if (!(banner instanceof HTMLElement)) return;
            const state = resolveClosureBannerState(
                activeIncidentCount,
                latestConformityStatus,
                hasApprovedBudget,
                requiresApprovedBudget,
            );
            banner.dataset.tone = state.tone;

            const eyebrow = banner.querySelector('[data-role="closure-banner-eyebrow"]');
            if (eyebrow instanceof HTMLElement) {
                eyebrow.textContent = state.eyebrow;
            }

            const title = banner.querySelector('[data-role="closure-banner-title"]');
            if (title instanceof HTMLElement) {
                title.textContent = state.title;
            }

            const description = banner.querySelector('[data-role="closure-banner-description"]');
            if (description instanceof HTMLElement) {
                description.textContent = state.description;
            }
        }

        function applyConformityButtonState(
            button,
            activeIncidentCount,
            hasApprovedBudget = false,
            requiresApprovedBudget = true,
        ) {
            if (!isButtonElement(button)) return;
            const count = Math.max(0, Number(activeIncidentCount) || 0);
            const canSendConformity = count === 0 && (requiresApprovedBudget !== true || hasApprovedBudget === true);
            const shouldDisable = count === 0 && requiresApprovedBudget === true && hasApprovedBudget !== true;
            button.dataset.activeIncidentCount = String(count);
            button.className = canSendConformity
                ? 'btn-primary incidents-action-button incidents-action-button-emphasis'
                : 'btn-secondary incidents-action-button';
            const iconName = canSendConformity ? 'mark_email_read' : 'rule';
            const label = count === 0
                ? 'Enviar conformidad final'
                : 'Revisar incidencias antes de cerrar';
            button.disabled = shouldDisable;
            if (count > 0) {
                button.title = 'Debes resolver todas las incidencias activas antes de emitir la conformidad.';
            } else if (requiresApprovedBudget && !hasApprovedBudget) {
                button.title = 'Debes aprobar el Ãºltimo presupuesto para emitir la conformidad.';
            } else {
                button.removeAttribute('title');
            }
            const icon = options.createMaterialIconNode(iconName);
            if (icon) {
                button.replaceChildren(icon, document.createTextNode(` ${label}`));
            } else {
                button.textContent = label;
            }
        }

        function buildConformityHelperText(activeIncidentCount, hasApprovedBudget = false, requiresApprovedBudget = true) {
            const count = Math.max(0, Number(activeIncidentCount) || 0);
            if (count > 0) {
                return `Quedan ${count} incidencia${count === 1 ? '' : 's'} activa${count === 1 ? '' : 's'}. Debes resolverlas antes del cierre.`;
            }
            if (requiresApprovedBudget === true && hasApprovedBudget !== true) {
                return 'Aprobacion comercial pendiente: necesitas presupuesto aprobado antes de cerrar.';
            }
            return 'Caso listo. Genera y envia la conformidad final desde este bloque.';
        }

        function applyCreateIncidentButtonState(button, activeIncidentCount) {
            if (!isButtonElement(button)) return;
            const count = Math.max(0, Number(activeIncidentCount) || 0);
            button.dataset.activeIncidentCount = String(count);
            const iconName = count === 0 ? 'add_alert' : 'add_circle';
            const label = count === 0 ? 'Abrir nueva incidencia' : 'Crear incidencia';
            button.className = count === 0
                ? 'btn-secondary incidents-action-button'
                : 'btn-primary incidents-action-button';
            const icon = options.createMaterialIconNode(iconName);
            if (icon) {
                button.replaceChildren(icon, document.createTextNode(` ${label}`));
            } else {
                button.textContent = label;
            }
            if (count === 0) {
                button.title = 'El caso quedÃ³ listo para conformidad. Usa esto solo si necesitas reabrir trabajo con una incidencia nueva.';
            } else {
                button.removeAttribute('title');
            }
        }

        function syncVisibleIncidentsHeaderState() {
            const container = document.getElementById('incidentsList');
            if (!(container instanceof HTMLElement)) return;
            const header = container.querySelector('.incidents-header');
            if (!(header instanceof HTMLElement)) return;

            const cards = Array.from(container.querySelectorAll('.incident-card'));
            const activeIncidentCount = cards.filter((card) => {
                if (!(card instanceof HTMLElement)) return false;
                if (card.classList.contains('incident-card-deleted')) return false;
                return options.normalizeIncidentStatus(card.dataset.status) !== 'resolved';
            }).length;

            header.dataset.activeIncidentCount = String(activeIncidentCount);
            const latestConformityStatus = String(header.dataset.latestConformityStatus || '').trim().toLowerCase();
            const hasApprovedBudget = String(header.dataset.hasApprovedBudget || '').trim() === '1';
            const requiresApprovedBudget = String(header.dataset.requiresApprovedBudget || '').trim() !== '0';

            const summaryChip = header.querySelector('[data-role="active-incidents-chip"]');
            if (summaryChip instanceof HTMLElement) {
                summaryChip.textContent = formatActiveIncidentsLabel(activeIncidentCount);
                summaryChip.dataset.tone = activeIncidentCount === 0 ? 'resolved' : 'high';
            }

            const closureBanner = header.querySelector('[data-role="closure-banner"]');
            if (closureBanner instanceof HTMLElement) {
                applyClosureBannerState(
                    closureBanner,
                    activeIncidentCount,
                    latestConformityStatus,
                    hasApprovedBudget,
                    requiresApprovedBudget,
                );
            }

            const conformityButton = header.querySelector('[data-role="conformity-trigger"]');
            if (isButtonElement(conformityButton)) {
                applyConformityButtonState(
                    conformityButton,
                    activeIncidentCount,
                    hasApprovedBudget,
                    requiresApprovedBudget,
                );
            }
            const conformityHelperText = header.querySelector('[data-role="conformity-helper-text"]');
            if (conformityHelperText instanceof HTMLElement) {
                conformityHelperText.textContent = buildConformityHelperText(
                    activeIncidentCount,
                    hasApprovedBudget,
                    requiresApprovedBudget,
                );
            }

            const createIncidentButton = header.querySelector('[data-role="create-incident-trigger"]');
            if (isButtonElement(createIncidentButton)) {
                applyCreateIncidentButtonState(createIncidentButton, activeIncidentCount);
            }
        }

        function buildInstallationConformityFields({
            installationId,
            activeIncidentCount,
            latestConformity,
            latestApprovedBudget,
            requiresApprovedBudget = true,
            commercialClosureMode = DEFAULT_COMMERCIAL_CLOSURE_MODE,
            commercialClosureNote = '',
        }) {
            const fragment = document.createDocumentFragment();
            const grid = document.createElement('div');
            grid.className = 'action-modal-grid';

            const summaryWrap = document.createElement('div');
            summaryWrap.className = 'conformity-modal-summary';
            const summaryTitle = document.createElement('strong');
            summaryTitle.textContent = `Registro #${installationId}`;
            const summaryBody = document.createElement('p');
            summaryBody.textContent = activeIncidentCount === 0
                ? requiresApprovedBudget
                    ? 'No quedan incidencias activas. El caso estÃ¡ listo para emitir la conformidad final y enviar el PDF por email.'
                    : 'No quedan incidencias activas. Este caso tiene cobertura comercial y puede cerrarse sin presupuesto.'
                : `TodavÃ­a hay ${activeIncidentCount} incidencia${activeIncidentCount === 1 ? '' : 's'} activa${activeIncidentCount === 1 ? '' : 's'}.`;
            const summaryMeta = document.createElement('div');
            summaryMeta.className = 'conformity-modal-meta';
            summaryMeta.appendChild(
                createConformityStatusChip(
                    activeIncidentCount === 0 ? 'Listo para cerrar' : `${activeIncidentCount} activas`,
                    activeIncidentCount === 0 ? 'resolved' : 'high',
                ),
            );
            if (latestConformity) {
                summaryMeta.appendChild(
                    createConformityStatusChip(
                        `Ãºltima: ${formatConformityStatusLabel(latestConformity.status)}`,
                        latestConformity.status === 'emailed' ? 'resolved' : latestConformity.status === 'email_failed' ? 'high' : 'info',
                    ),
                );
            }
            if (latestApprovedBudget) {
                summaryMeta.appendChild(
                    createConformityStatusChip(
                        `Presupuesto: ${latestApprovedBudget.budget_number || `#${latestApprovedBudget.id}`}`,
                        'info',
                    ),
                );
            } else if (!requiresApprovedBudget) {
                summaryMeta.appendChild(
                    createConformityStatusChip(
                        `Cobertura: ${formatCommercialClosureModeLabel(commercialClosureMode)}`,
                        'resolved',
                    ),
                );
            }
            summaryWrap.append(summaryTitle, summaryBody, summaryMeta);
            grid.appendChild(summaryWrap);

            if (latestConformity) {
                const latestWrap = document.createElement('div');
                latestWrap.className = 'conformity-modal-latest';
                const latestTitle = document.createElement('strong');
                latestTitle.textContent = 'Ãºltima conformidad registrada';
                const latestBody = document.createElement('p');
                latestBody.textContent = `${latestConformity.signed_by_name || 'Sin firmante'} Â· ${formatConformityGeneratedAt(latestConformity.generated_at)} Â· ${formatConformityStatusLabel(latestConformity.status)}`;
                latestWrap.append(latestTitle, latestBody);
                if (latestConformity.pdf_download_path) {
                    const latestLink = document.createElement('a');
                    latestLink.href = latestConformity.pdf_download_path;
                    latestLink.target = '_blank';
                    latestLink.rel = 'noreferrer';
                    latestLink.className = 'conformity-modal-link';
                    latestLink.textContent = 'Ver Ãºltimo PDF';
                    latestWrap.appendChild(latestLink);
                }
                grid.appendChild(latestWrap);
            }

            if (latestApprovedBudget) {
                const budgetWrap = document.createElement('div');
                budgetWrap.className = 'conformity-modal-latest';
                const budgetTitle = document.createElement('strong');
                budgetTitle.textContent = 'Presupuesto asociado';
                const budgetBody = document.createElement('p');
                budgetBody.textContent = [
                    latestApprovedBudget.budget_number || `#${latestApprovedBudget.id}`,
                    formatBudgetApprovalStatusLabel(latestApprovedBudget.approval_status),
                    formatCurrencyFromCents(
                        latestApprovedBudget.total_amount_cents,
                        latestApprovedBudget.currency_code || 'UYU',
                    ),
                ].filter(Boolean).join(' Â· ');
                budgetWrap.append(budgetTitle, budgetBody);
                if (latestApprovedBudget.pdf_download_path) {
                    const budgetLink = document.createElement('a');
                    budgetLink.href = latestApprovedBudget.pdf_download_path;
                    budgetLink.target = '_blank';
                    budgetLink.rel = 'noreferrer';
                    budgetLink.className = 'conformity-modal-link';
                    budgetLink.textContent = 'Ver presupuesto aprobado';
                    budgetWrap.appendChild(budgetLink);
                }
                grid.appendChild(budgetWrap);
            } else if (!requiresApprovedBudget) {
                const coverageWrap = document.createElement('div');
                coverageWrap.className = 'conformity-modal-latest';
                const coverageTitle = document.createElement('strong');
                coverageTitle.textContent = 'Cobertura comercial';
                const coverageBody = document.createElement('p');
                const modeLabel = formatCommercialClosureModeLabel(commercialClosureMode);
                const note = String(commercialClosureNote || '').trim();
                coverageBody.textContent = note ? `${modeLabel} Â· ${note}` : modeLabel;
                coverageWrap.append(coverageTitle, coverageBody);
                grid.appendChild(coverageWrap);
            }

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.id = 'actionConformitySignedByName';
            nameInput.autocomplete = 'off';
            nameInput.value = String(options.getCurrentUser?.()?.username || '').trim();
            nameInput.placeholder = 'Nombre y apellido';
            grid.appendChild(createInputGroup('Firmante', nameInput, { htmlFor: nameInput.id }));

            const documentInput = document.createElement('input');
            documentInput.type = 'text';
            documentInput.id = 'actionConformitySignedByDocument';
            documentInput.autocomplete = 'off';
            documentInput.placeholder = 'CI, DNI o referencia';
            grid.appendChild(createInputGroup('Documento', documentInput, { htmlFor: documentInput.id }));

            const emailInput = document.createElement('input');
            emailInput.type = 'email';
            emailInput.id = 'actionConformityEmailTo';
            emailInput.autocomplete = 'email';
            emailInput.placeholder = 'cliente@empresa.com';
            grid.appendChild(createInputGroup('Email destino', emailInput, { htmlFor: emailInput.id }));

            const summaryInput = document.createElement('textarea');
            summaryInput.id = 'actionConformitySummary';
            summaryInput.rows = 3;
            summaryInput.value = 'Instalacion validada en sitio.';
            grid.appendChild(createInputGroup('Resumen', summaryInput, {
                htmlFor: summaryInput.id,
                className: 'full-width',
            }));

            const technicianSelect = buildTechnicianSelect({
                id: 'actionConformityTechnicianName',
                includeCurrentUserOption: true,
            });
            grid.appendChild(createInputGroup('TÃ©cnico responsable', technicianSelect, {
                htmlFor: technicianSelect.id,
            }));

            const technicianNoteInput = document.createElement('textarea');
            technicianNoteInput.id = 'actionConformityTechnicianNote';
            technicianNoteInput.rows = 3;
            technicianNoteInput.value = 'Se entrega constancia operativa con firma y evidencia asociada.';
            grid.appendChild(createInputGroup('Nota tecnica', technicianNoteInput, {
                htmlFor: technicianNoteInput.id,
                className: 'full-width',
            }));

            grid.appendChild(createGpsCapturePanel({
                panelId: CONFORMITY_GPS_PANEL_ID,
                statusId: CONFORMITY_GPS_STATUS_ID,
                summaryId: CONFORMITY_GPS_SUMMARY_ID,
                buttonId: CONFORMITY_GPS_RETRY_ID,
            }));

            const gpsOverrideInput = document.createElement('textarea');
            gpsOverrideInput.id = CONFORMITY_GPS_OVERRIDE_INPUT_ID;
            gpsOverrideInput.rows = 3;
            gpsOverrideInput.placeholder = 'Explica por que cierras sin coordenada valida.';
            const gpsOverrideGroup = createInputGroup('Motivo de override GPS', gpsOverrideInput, {
                htmlFor: gpsOverrideInput.id,
                className: 'full-width',
            });
            gpsOverrideGroup.id = CONFORMITY_GPS_OVERRIDE_WRAP_ID;
            gpsOverrideGroup.hidden = true;
            const gpsOverrideHelp = document.createElement('p');
            gpsOverrideHelp.id = CONFORMITY_GPS_OVERRIDE_HELP_ID;
            gpsOverrideHelp.className = 'asset-muted';
            gpsOverrideHelp.textContent = 'Si no hay captura usable, deja una justificacion operativa antes de generar el PDF.';
            gpsOverrideGroup.appendChild(gpsOverrideHelp);
            grid.appendChild(gpsOverrideGroup);

            const signatureGroup = document.createElement('div');
            signatureGroup.className = 'input-group full-width';
            const signatureLabel = document.createElement('label');
            signatureLabel.setAttribute('for', CONFORMITY_SIGNATURE_CANVAS_ID);
            signatureLabel.textContent = 'Firma';
            const signaturePad = document.createElement('div');
            signaturePad.className = 'conformity-signature-pad';
            const canvas = document.createElement('canvas');
            canvas.id = CONFORMITY_SIGNATURE_CANVAS_ID;
            canvas.className = 'conformity-signature-canvas';
            canvas.width = 640;
            canvas.height = 220;
            const signatureHint = document.createElement('div');
            signatureHint.className = 'conformity-signature-hint';
            signatureHint.textContent = 'Firma aquÃ­ con mouse, touch o lÃ¡piz.';
            const signatureToolbar = document.createElement('div');
            signatureToolbar.className = 'conformity-signature-toolbar';
            const clearSignatureBtn = document.createElement('button');
            clearSignatureBtn.type = 'button';
            clearSignatureBtn.id = CONFORMITY_SIGNATURE_CLEAR_ID;
            clearSignatureBtn.className = 'btn-secondary';
            clearSignatureBtn.textContent = 'Limpiar firma';
            signatureToolbar.appendChild(clearSignatureBtn);
            signaturePad.append(canvas, signatureHint);
            signatureGroup.append(signatureLabel, signaturePad, signatureToolbar);
            grid.appendChild(signatureGroup);

            const sendEmailWrap = document.createElement('label');
            sendEmailWrap.className = 'action-checkbox full-width';
            const sendEmailInput = document.createElement('input');
            sendEmailInput.type = 'checkbox';
            sendEmailInput.id = 'actionConformitySendEmail';
            sendEmailInput.checked = true;
            const sendEmailText = document.createElement('span');
            sendEmailText.textContent = 'Enviar email al generar la conformidad';
            sendEmailWrap.append(sendEmailInput, sendEmailText);
            grid.appendChild(sendEmailWrap);

            fragment.appendChild(grid);
            return fragment;
        }

        function initializeConformitySignaturePad() {
            const canvas = document.getElementById(CONFORMITY_SIGNATURE_CANVAS_ID);
            const clearBtn = document.getElementById(CONFORMITY_SIGNATURE_CLEAR_ID);
            if (!(canvas instanceof HTMLCanvasElement)) {
                currentConformitySignaturePad = null;
                return;
            }

            const ratio = Math.max(window.devicePixelRatio || 1, 1);
            const width = Math.max(canvas.clientWidth || 0, 640);
            const height = 220;
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            const context = canvas.getContext('2d');
            if (!context) {
                currentConformitySignaturePad = null;
                return;
            }

            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            context.lineCap = 'round';
            context.lineJoin = 'round';
            context.lineWidth = 2.6;
            context.strokeStyle = '#0f8b84';

            let drawing = false;
            let hasInk = false;
            let lastX = 0;
            let lastY = 0;

            function hideHint() {
                canvas.parentElement?.classList.add('has-ink');
            }

            function showHint() {
                canvas.parentElement?.classList.remove('has-ink');
            }

            function clearPad() {
                context.clearRect(0, 0, width, height);
                hasInk = false;
                showHint();
            }

            function getPoint(event) {
                const rect = canvas.getBoundingClientRect();
                return {
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                };
            }

            function beginStroke(event) {
                drawing = true;
                const point = getPoint(event);
                lastX = point.x;
                lastY = point.y;
                context.beginPath();
                context.moveTo(point.x, point.y);
                context.lineTo(point.x + 0.01, point.y + 0.01);
                context.stroke();
                hasInk = true;
                hideHint();
            }

            function continueStroke(event) {
                if (!drawing) return;
                const point = getPoint(event);
                context.beginPath();
                context.moveTo(lastX, lastY);
                context.lineTo(point.x, point.y);
                context.stroke();
                lastX = point.x;
                lastY = point.y;
            }

            function endStroke() {
                drawing = false;
            }

            clearPad();
            canvas.onpointerdown = (event) => {
                event.preventDefault();
                canvas.setPointerCapture?.(event.pointerId);
                beginStroke(event);
            };
            canvas.onpointermove = (event) => {
                event.preventDefault();
                continueStroke(event);
            };
            canvas.onpointerup = () => endStroke();
            canvas.onpointerleave = () => endStroke();
            canvas.onpointercancel = () => endStroke();

            if (isButtonElement(clearBtn)) {
                clearBtn.onclick = () => clearPad();
            }

            currentConformitySignaturePad = {
                hasInk: () => hasInk,
                clear: clearPad,
                exportDataUrl: () => {
                    if (!hasInk) return '';
                    const exportCanvas = document.createElement('canvas');
                    exportCanvas.width = canvas.width;
                    exportCanvas.height = canvas.height;
                    const exportContext = exportCanvas.getContext('2d');
                    if (!exportContext) return '';
                    exportContext.fillStyle = '#ffffff';
                    exportContext.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
                    exportContext.drawImage(canvas, 0, 0);
                    return exportCanvas.toDataURL('image/png');
                },
            };
        }

        function parsePositiveIntegerOrNotify(rawValue, invalidMessage) {
            const parsedValue = options.parseStrictInteger(rawValue);
            if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
                options.showNotification(invalidMessage, 'error');
                return null;
            }
            return parsedValue;
        }

        function readModalFieldValue(fieldId, fallback = '') {
            return String(document.getElementById(fieldId)?.value ?? fallback).trim();
        }

        function readModalCheckboxValue(fieldId) {
            return document.getElementById(fieldId)?.checked === true;
        }

        function collectConformityModalValues() {
            const technicianName = readModalFieldValue('actionConformityTechnicianName')
                || String(options.getCurrentUser?.()?.username || '').trim()
                || 'web';
            return {
                signedByName: readModalFieldValue('actionConformitySignedByName'),
                signedByDocument: readModalFieldValue('actionConformitySignedByDocument'),
                emailTo: readModalFieldValue('actionConformityEmailTo'),
                summaryNote: readModalFieldValue('actionConformitySummary'),
                technicianName,
                technicianNote: readModalFieldValue('actionConformityTechnicianNote'),
                sendEmail: readModalCheckboxValue('actionConformitySendEmail'),
                signatureDataUrl: currentConformitySignaturePad?.exportDataUrl?.() || '',
                hasSignatureInk: currentConformitySignaturePad?.hasInk?.() === true,
                gpsOverrideNote: readModalFieldValue(CONFORMITY_GPS_OVERRIDE_INPUT_ID),
            };
        }

        function validateConformityModalValues(values) {
            if (!values.signedByName) return 'El nombre del firmante es obligatorio.';
            if (!values.emailTo) return 'El email destino es obligatorio.';
            if (!values.signatureDataUrl || values.hasSignatureInk !== true) {
                return 'La conformidad requiere una firma.';
            }
            return '';
        }

        function resolveConformityGpsPayload(gpsSnapshot, gpsOverrideNote) {
            const gpsStatus = String(gpsSnapshot?.status || 'pending').trim().toLowerCase() || 'pending';
            if (gpsStatus === 'captured') {
                return {
                    gpsPayload: gpsSnapshot,
                    errorMessage: '',
                };
            }
            if (!gpsOverrideNote) {
                return {
                    gpsPayload: null,
                    errorMessage: 'Si no hay una captura GPS valida, debes registrar motivo de override.',
                };
            }
            return {
                gpsPayload: {
                    status: 'override',
                    source: 'override',
                    note: gpsOverrideNote,
                },
                errorMessage: '',
            };
        }

        async function openInstallationConformityModal(installationId, config = {}) {
            if (!options.requireActiveSession()) return;
            const targetInstallationId = parsePositiveIntegerOrNotify(
                installationId,
                'installation_id invÃ¡lido para generar conformidad.',
            );
            if (!targetInstallationId) return;

            const activeIncidentCount = Math.max(0, Number(config.activeIncidentCount) || 0);
            const commercialClosureMode = normalizeCommercialClosureMode(
                config.commercialClosureMode || DEFAULT_COMMERCIAL_CLOSURE_MODE,
            );
            const commercialClosureNote = String(config.commercialClosureNote || '').trim();
            const requiresApprovedBudget =
                config.requiresApprovedBudget === true
                    || (config.requiresApprovedBudget !== false
                        && isBudgetRequiredForCommercialClosure(commercialClosureMode));
            if (activeIncidentCount > 0) {
                options.showNotification('Primero resuelve las incidencias activas antes de emitir la conformidad.', 'warning');
                return;
            }

            let latestConformity = config.latestConformity || null;
            if (!latestConformity) {
                try {
                    const result = await options.api.getInstallationConformity(targetInstallationId);
                    latestConformity = result?.conformity || null;
                } catch {
                    latestConformity = null;
                }
            }
            let latestApprovedBudget = config.latestApprovedBudget || null;
            if (!latestApprovedBudget) {
                try {
                    const budgetState = await options.api.getInstallationBudgetLatest(targetInstallationId);
                    latestApprovedBudget = budgetState?.latest_approved_budget || null;
                } catch {
                    latestApprovedBudget = null;
                }
            }
            if (!latestApprovedBudget) {
                if (requiresApprovedBudget) {
                    options.showNotification('Debes aprobar el Ãºltimo presupuesto para emitir la conformidad.', 'warning');
                    return;
                }
            }

            let gpsController = null;
            let latestGpsSnapshot = null;

            function syncConformityGpsOverrideUi(snapshot, state = {}) {
                latestGpsSnapshot = snapshot && typeof snapshot === 'object'
                    ? { ...snapshot }
                    : null;
                const overrideWrap = document.getElementById(CONFORMITY_GPS_OVERRIDE_WRAP_ID);
                const overrideInput = document.getElementById(CONFORMITY_GPS_OVERRIDE_INPUT_ID);
                const overrideHelp = document.getElementById(CONFORMITY_GPS_OVERRIDE_HELP_ID);
                if (!(overrideWrap instanceof HTMLElement) || !(overrideInput instanceof HTMLTextAreaElement)) {
                    return;
                }

                const status = String(snapshot?.status || 'pending').trim().toLowerCase() || 'pending';
                const requiresGpsOverride = status !== 'captured' && state?.inflight !== true;
                const requiresOverride = requiresGpsOverride;
                overrideWrap.hidden = !requiresOverride;
                overrideInput.required = requiresOverride;
                if (overrideHelp instanceof HTMLElement) {
                    if (requiresGpsOverride) {
                        overrideHelp.textContent = `La captura GPS quedÃ³ en estado "${status}". Para cerrar la conformidad debes dejar motivo de override.`;
                    } else {
                        overrideHelp.textContent = 'GPS listo para adjuntar en la conformidad.';
                    }
                }
            }

            const modalOpened = options.openActionModal({
                title: `Conformidad del registro #${targetInstallationId}`,
                subtitle: 'Captura la firma final y envÃ­a el PDF de conformidad al cliente.',
                submitLabel: 'Generar y enviar conformidad',
                focusId: 'actionConformitySignedByName',
                fields: buildInstallationConformityFields({
                    installationId: targetInstallationId,
                    activeIncidentCount,
                    latestConformity,
                    latestApprovedBudget,
                    requiresApprovedBudget,
                    commercialClosureMode,
                    commercialClosureNote,
                }),
                onSubmit: async () => {
                    const formValues = collectConformityModalValues();
                    const formValidationError = validateConformityModalValues(formValues);
                    if (formValidationError) {
                        options.setActionModalError(formValidationError);
                        return;
                    }

                    const gpsSnapshot = gpsController?.getSnapshotForSubmit?.() || latestGpsSnapshot || null;
                    const gpsResolution = resolveConformityGpsPayload(gpsSnapshot, formValues.gpsOverrideNote);
                    if (gpsResolution.errorMessage) {
                        options.setActionModalError(gpsResolution.errorMessage);
                        return;
                    }

                    const conformityPayload = {
                        signed_by_name: formValues.signedByName,
                        signed_by_document: formValues.signedByDocument,
                        email_to: formValues.emailTo,
                        signature_data_url: formValues.signatureDataUrl,
                        summary_note: formValues.summaryNote,
                        technician_name: formValues.technicianName,
                        technician_note: formValues.technicianNote,
                        include_all_incident_photos: true,
                        send_email: formValues.sendEmail,
                        gps: gpsResolution.gpsPayload,
                    };
                    if (requiresApprovedBudget && latestApprovedBudget?.id) {
                        conformityPayload.budget_id = latestApprovedBudget.id;
                    }

                    const result = await options.api.createInstallationConformity(
                        targetInstallationId,
                        conformityPayload,
                    );

                    options.closeActionModal(true);
                    const conformityId = options.parseStrictInteger(result?.conformity?.id);
                    const statusLabel = formatConformityStatusLabel(result?.conformity?.status);
                    options.showNotification(
                        Number.isInteger(conformityId) && conformityId > 0
                            ? `Conformidad #${conformityId} generada (${statusLabel}).`
                            : `Conformidad generada (${statusLabel}).`,
                        result?.conformity?.status === 'email_failed' ? 'warning' : 'success',
                    );
                    runIncidentRefreshInBackground(
                        { installationId: targetInstallationId },
                        'La conformidad se genero, pero no pudimos refrescar el registro.',
                    );
                },
            });

            if (modalOpened) {
                requestAnimationFrame(() => {
                    initializeConformitySignaturePad();
                    void hydrateTechnicianSelectFromContext('actionConformityTechnicianName', {
                        installationId: targetInstallationId,
                    });
                    if (options.geolocation) {
                        gpsController = options.geolocation.createController({
                            panelElement: document.getElementById(CONFORMITY_GPS_PANEL_ID),
                            statusElement: document.getElementById(CONFORMITY_GPS_STATUS_ID),
                            summaryElement: document.getElementById(CONFORMITY_GPS_SUMMARY_ID),
                            captureButton: document.getElementById(CONFORMITY_GPS_RETRY_ID),
                            onSnapshotChange: syncConformityGpsOverrideUi,
                        });
                        void gpsController.capture();
                    } else {
                        syncConformityGpsOverrideUi({
                            status: 'unsupported',
                            source: 'browser',
                            note: '',
                        }, {
                            inflight: false,
                        });
                    }
                });
            }
        }

        function parseCurrencyAmountToCents(rawValue) {
            const normalized = String(rawValue || '')
                .trim()
                .replace(/\s+/g, '')
                .replace(',', '.');
            if (!normalized) return 0;
            if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
                return NaN;
            }
            const numericValue = Number(normalized);
            if (!Number.isFinite(numericValue)) return NaN;
            return Math.round(numericValue * 100);
        }

        function collectBudgetModalValues() {
            return {
                incidenceSummary: readModalFieldValue('actionBudgetIncidenceSummary'),
                scopeIncluded: readModalFieldValue('actionBudgetScopeIncluded'),
                scopeExcluded: readModalFieldValue('actionBudgetScopeExcluded'),
                laborAmountCents: parseCurrencyAmountToCents(readModalFieldValue('actionBudgetLaborAmount')),
                partsAmountCents: parseCurrencyAmountToCents(readModalFieldValue('actionBudgetPartsAmount')),
                taxAmountCents: parseCurrencyAmountToCents(readModalFieldValue('actionBudgetTaxAmount')),
                currencyCode: (readModalFieldValue('actionBudgetCurrencyCode', 'UYU') || 'UYU').toUpperCase(),
                estimatedDaysRaw: readModalFieldValue('actionBudgetEstimatedDays'),
                validUntil: readModalFieldValue('actionBudgetValidUntil'),
                emailTo: readModalFieldValue('actionBudgetEmailTo'),
                sendEmail: readModalCheckboxValue('actionBudgetSendEmail'),
            };
        }

        function validateBudgetModalValues(values) {
            if (!values.incidenceSummary) {
                return { estimatedDays: null, errorMessage: 'Debes describir la incidencia.' };
            }
            if (!values.scopeIncluded) {
                return { estimatedDays: null, errorMessage: 'Debes describir el alcance incluido.' };
            }
            if (!Number.isInteger(values.laborAmountCents) || values.laborAmountCents < 0) {
                return { estimatedDays: null, errorMessage: 'Monto invÃ¡lido en mano de obra.' };
            }
            if (!Number.isInteger(values.partsAmountCents) || values.partsAmountCents < 0) {
                return { estimatedDays: null, errorMessage: 'Monto invÃ¡lido en repuestos/insumos.' };
            }
            if (!Number.isInteger(values.taxAmountCents) || values.taxAmountCents < 0) {
                return { estimatedDays: null, errorMessage: 'Monto invÃ¡lido en impuestos.' };
            }
            if (!/^[A-Z]{3}$/.test(values.currencyCode)) {
                return { estimatedDays: null, errorMessage: 'Moneda invÃ¡lida. Usa codigo ISO de 3 letras (ej: UYU).' };
            }

            let estimatedDays = null;
            if (values.estimatedDaysRaw) {
                estimatedDays = Number.parseInt(values.estimatedDaysRaw, 10);
                if (!Number.isInteger(estimatedDays) || estimatedDays < 0) {
                    return { estimatedDays: null, errorMessage: 'Plazo invÃ¡lido. Usa un nÃºmero entero de dÃ­as.' };
                }
            }

            return { estimatedDays, errorMessage: '' };
        }

        function collectBudgetApprovalModalValues() {
            return {
                approvedByName: readModalFieldValue('actionBudgetApprovedByName'),
                approvedByChannel: readModalFieldValue('actionBudgetApprovedByChannel').toLowerCase(),
                approvalNote: readModalFieldValue('actionBudgetApprovalNote'),
            };
        }

        function buildInstallationBudgetFields({
            installationId,
            latestBudget,
            latestApprovedBudget,
        }) {
            const fragment = document.createDocumentFragment();
            const grid = document.createElement('div');
            grid.className = 'action-modal-grid';

            const summaryWrap = document.createElement('div');
            summaryWrap.className = 'conformity-modal-summary';
            const summaryTitle = document.createElement('strong');
            summaryTitle.textContent = `Registro #${installationId}`;
            const summaryBody = document.createElement('p');
            summaryBody.textContent = 'Define alcance y costos del presupuesto antes de la conformidad final.';
            const summaryMeta = document.createElement('div');
            summaryMeta.className = 'conformity-modal-meta';
            if (latestBudget) {
                summaryMeta.appendChild(
                    createConformityStatusChip(
                        `Ultimo: ${latestBudget.budget_number || `#${latestBudget.id}`}`,
                        'info',
                    ),
                );
                summaryMeta.appendChild(
                    createConformityStatusChip(
                        formatBudgetApprovalStatusLabel(latestBudget.approval_status),
                        latestBudget.approval_status === 'approved' ? 'resolved' : 'warning',
                    ),
                );
            } else {
                summaryMeta.appendChild(createConformityStatusChip('Sin presupuesto previo', 'neutral'));
            }
            if (latestApprovedBudget) {
                summaryMeta.appendChild(
                    createConformityStatusChip(
                        `Aprobado: ${latestApprovedBudget.budget_number || `#${latestApprovedBudget.id}`}`,
                        'resolved',
                    ),
                );
            }
            summaryWrap.append(summaryTitle, summaryBody, summaryMeta);
            grid.appendChild(summaryWrap);

            const incidenceInput = document.createElement('textarea');
            incidenceInput.id = 'actionBudgetIncidenceSummary';
            incidenceInput.rows = 3;
            incidenceInput.value = String(latestBudget?.incidence_summary || '').trim();
            incidenceInput.placeholder = 'Descripcion de la incidencia detectada';
            grid.appendChild(createInputGroup('Incidencia', incidenceInput, {
                htmlFor: incidenceInput.id,
                className: 'full-width',
            }));

            const includedInput = document.createElement('textarea');
            includedInput.id = 'actionBudgetScopeIncluded';
            includedInput.rows = 4;
            includedInput.value = String(latestBudget?.scope_included || '').trim();
            includedInput.placeholder = 'Tareas incluidas';
            grid.appendChild(createInputGroup('Alcance incluido', includedInput, {
                htmlFor: includedInput.id,
                className: 'full-width',
            }));

            const excludedInput = document.createElement('textarea');
            excludedInput.id = 'actionBudgetScopeExcluded';
            excludedInput.rows = 3;
            excludedInput.value = String(latestBudget?.scope_excluded || '').trim();
            excludedInput.placeholder = 'Exclusiones del presupuesto';
            grid.appendChild(createInputGroup('Exclusiones', excludedInput, {
                htmlFor: excludedInput.id,
                className: 'full-width',
            }));

            const laborInput = document.createElement('input');
            laborInput.type = 'text';
            laborInput.id = 'actionBudgetLaborAmount';
            laborInput.value = String(
                Number.isFinite((Number(latestBudget?.labor_amount_cents) || 0) / 100)
                    ? ((Number(latestBudget?.labor_amount_cents) || 0) / 100).toFixed(2)
                    : '0.00',
            );
            laborInput.placeholder = '0.00';
            grid.appendChild(createInputGroup('Mano de obra', laborInput, { htmlFor: laborInput.id }));

            const partsInput = document.createElement('input');
            partsInput.type = 'text';
            partsInput.id = 'actionBudgetPartsAmount';
            partsInput.value = String(
                Number.isFinite((Number(latestBudget?.parts_amount_cents) || 0) / 100)
                    ? ((Number(latestBudget?.parts_amount_cents) || 0) / 100).toFixed(2)
                    : '0.00',
            );
            partsInput.placeholder = '0.00';
            grid.appendChild(createInputGroup('Repuestos/insumos', partsInput, { htmlFor: partsInput.id }));

            const taxInput = document.createElement('input');
            taxInput.type = 'text';
            taxInput.id = 'actionBudgetTaxAmount';
            taxInput.value = String(
                Number.isFinite((Number(latestBudget?.tax_amount_cents) || 0) / 100)
                    ? ((Number(latestBudget?.tax_amount_cents) || 0) / 100).toFixed(2)
                    : '0.00',
            );
            taxInput.placeholder = '0.00';
            grid.appendChild(createInputGroup('Impuestos', taxInput, { htmlFor: taxInput.id }));

            const currencyInput = document.createElement('input');
            currencyInput.type = 'text';
            currencyInput.id = 'actionBudgetCurrencyCode';
            currencyInput.maxLength = 3;
            currencyInput.autocomplete = 'off';
            currencyInput.value = String(latestBudget?.currency_code || 'UYU').trim().toUpperCase() || 'UYU';
            grid.appendChild(createInputGroup('Moneda', currencyInput, { htmlFor: currencyInput.id }));

            const estimatedDaysInput = document.createElement('input');
            estimatedDaysInput.type = 'number';
            estimatedDaysInput.id = 'actionBudgetEstimatedDays';
            estimatedDaysInput.min = '0';
            estimatedDaysInput.step = '1';
            estimatedDaysInput.value =
                latestBudget?.estimated_days === null || latestBudget?.estimated_days === undefined
                    ? ''
                    : String(latestBudget.estimated_days);
            estimatedDaysInput.placeholder = 'DÃ­as estimados';
            grid.appendChild(createInputGroup('Plazo (dÃ­as)', estimatedDaysInput, { htmlFor: estimatedDaysInput.id }));

            const validUntilInput = document.createElement('input');
            validUntilInput.type = 'date';
            validUntilInput.id = 'actionBudgetValidUntil';
            validUntilInput.value = String(latestBudget?.valid_until || '').trim();
            grid.appendChild(createInputGroup('Validez hasta', validUntilInput, { htmlFor: validUntilInput.id }));

            const emailInput = document.createElement('input');
            emailInput.type = 'email';
            emailInput.id = 'actionBudgetEmailTo';
            emailInput.autocomplete = 'email';
            emailInput.value = String(latestBudget?.email_to || '').trim();
            emailInput.placeholder = 'cliente@empresa.com';
            grid.appendChild(createInputGroup('Email destino', emailInput, {
                htmlFor: emailInput.id,
                className: 'full-width',
            }));

            const sendEmailWrap = document.createElement('label');
            sendEmailWrap.className = 'action-checkbox full-width';
            const sendEmailInput = document.createElement('input');
            sendEmailInput.type = 'checkbox';
            sendEmailInput.id = 'actionBudgetSendEmail';
            sendEmailInput.checked = true;
            const sendEmailText = document.createElement('span');
            sendEmailText.textContent = 'Enviar email al generar el presupuesto';
            sendEmailWrap.append(sendEmailInput, sendEmailText);
            grid.appendChild(sendEmailWrap);

            fragment.appendChild(grid);
            return fragment;
        }

        function buildInstallationBudgetApprovalFields({ budget }) {
            const fragment = document.createDocumentFragment();
            const grid = document.createElement('div');
            grid.className = 'action-modal-grid';

            const summaryWrap = document.createElement('div');
            summaryWrap.className = 'conformity-modal-summary';
            const summaryTitle = document.createElement('strong');
            summaryTitle.textContent = `Presupuesto ${budget?.budget_number || `#${budget?.id || '-'}`}`;
            const summaryBody = document.createElement('p');
            summaryBody.textContent = [
                formatBudgetApprovalStatusLabel(budget?.approval_status),
                formatBudgetDeliveryStatusLabel(budget?.delivery_status),
                formatCurrencyFromCents(budget?.total_amount_cents, budget?.currency_code || 'UYU'),
            ].filter(Boolean).join(' Â· ');
            summaryWrap.append(summaryTitle, summaryBody);
            grid.appendChild(summaryWrap);

            const approvedByInput = document.createElement('input');
            approvedByInput.type = 'text';
            approvedByInput.id = 'actionBudgetApprovedByName';
            approvedByInput.autocomplete = 'off';
            approvedByInput.value = String(options.getCurrentUser?.()?.username || '').trim();
            approvedByInput.placeholder = 'Nombre de quien aprueba';
            grid.appendChild(createInputGroup('Aprobado por', approvedByInput, { htmlFor: approvedByInput.id }));

            const channelSelect = document.createElement('select');
            channelSelect.id = 'actionBudgetApprovedByChannel';
            channelSelect.appendChild(new Option('Email', 'email'));
            channelSelect.appendChild(new Option('WhatsApp', 'whatsapp'));
            channelSelect.appendChild(new Option('Firma', 'firma'));
            channelSelect.appendChild(new Option('TelÃ©fono', 'telefono'));
            channelSelect.appendChild(new Option('Otro', 'otro'));
            grid.appendChild(createInputGroup('Canal', channelSelect, { htmlFor: channelSelect.id }));

            const noteInput = document.createElement('textarea');
            noteInput.id = 'actionBudgetApprovalNote';
            noteInput.rows = 3;
            noteInput.placeholder = 'Nota opcional de aprobaciÃ³n';
            grid.appendChild(createInputGroup('Nota', noteInput, {
                htmlFor: noteInput.id,
                className: 'full-width',
            }));

            fragment.appendChild(grid);
            return fragment;
        }

        async function openInstallationBudgetModal(installationId, config = {}) {
            if (!options.requireActiveSession()) return;
            const targetInstallationId = parsePositiveIntegerOrNotify(
                installationId,
                'installation_id invÃ¡lido para crear presupuesto.',
            );
            if (!targetInstallationId) return;

            let budgetState = config.budgetState || null;
            if (!budgetState) {
                try {
                    budgetState = await options.api.getInstallationBudgetLatest(targetInstallationId);
                } catch {
                    budgetState = null;
                }
            }
            const latestBudget = budgetState?.latest_budget || null;
            const latestApprovedBudget = budgetState?.latest_approved_budget || null;

            options.openActionModal({
                title: `Presupuesto del registro #${targetInstallationId}`,
                subtitle: 'Genera un presupuesto separado y dÃ©jalo listo para aprobaciÃ³n del cliente.',
                submitLabel: 'Generar presupuesto',
                focusId: 'actionBudgetIncidenceSummary',
                fields: buildInstallationBudgetFields({
                    installationId: targetInstallationId,
                    latestBudget,
                    latestApprovedBudget,
                }),
                onSubmit: async () => {
                    const formValues = collectBudgetModalValues();
                    const validation = validateBudgetModalValues(formValues);
                    if (validation.errorMessage) {
                        options.setActionModalError(validation.errorMessage);
                        return;
                    }

                    const result = await options.api.createInstallationBudget(targetInstallationId, {
                        incidence_summary: formValues.incidenceSummary,
                        scope_included: formValues.scopeIncluded,
                        scope_excluded: formValues.scopeExcluded,
                        labor_amount_cents: formValues.laborAmountCents,
                        parts_amount_cents: formValues.partsAmountCents,
                        tax_amount_cents: formValues.taxAmountCents,
                        currency_code: formValues.currencyCode,
                        estimated_days: validation.estimatedDays,
                        valid_until: formValues.validUntil || null,
                        email_to: formValues.emailTo,
                        send_email: formValues.sendEmail,
                    });

                    options.closeActionModal(true);
                    const budgetNumber = String(result?.budget?.budget_number || `#${result?.budget?.id || '-'}`).trim();
                    options.showNotification(`Presupuesto ${budgetNumber} generado.`, 'success');
                    runIncidentRefreshInBackground(
                        { installationId: targetInstallationId },
                        'El presupuesto se genero, pero no pudimos refrescar la vista.',
                    );
                },
            });
        }

        async function openInstallationBudgetApprovalModal(installationId, budget) {
            if (!options.requireActiveSession()) return;
            const targetInstallationId = parsePositiveIntegerOrNotify(
                installationId,
                'installation_id invÃ¡lido para aprobar presupuesto.',
            );
            if (!targetInstallationId) return;
            const targetBudgetId = parsePositiveIntegerOrNotify(
                budget?.id,
                'budget_id invÃ¡lido para aprobar presupuesto.',
            );
            if (!targetBudgetId) return;

            options.openActionModal({
                title: `Aprobar presupuesto #${targetBudgetId}`,
                subtitle: 'Registra aprobaciÃ³n del cliente para habilitar la conformidad final.',
                submitLabel: 'Registrar aprobaciÃ³n',
                focusId: 'actionBudgetApprovedByName',
                fields: buildInstallationBudgetApprovalFields({ budget }),
                onSubmit: async () => {
                    const formValues = collectBudgetApprovalModalValues();

                    if (!formValues.approvedByName) {
                        options.setActionModalError('El nombre de quien aprueba es obligatorio.');
                        return;
                    }
                    if (!formValues.approvedByChannel) {
                        options.setActionModalError('Debes indicar un canal de aprobaciÃ³n.');
                        return;
                    }

                    const result = await options.api.approveInstallationBudget(
                        targetInstallationId,
                        targetBudgetId,
                        {
                            approved_by_name: formValues.approvedByName,
                            approved_by_channel: formValues.approvedByChannel,
                            approval_note: formValues.approvalNote,
                        },
                    );
                    options.closeActionModal(true);
                    const budgetNumber = String(result?.budget?.budget_number || `#${targetBudgetId}`).trim();
                    options.showNotification(`Presupuesto ${budgetNumber} aprobado.`, 'success');
                    runIncidentRefreshInBackground(
                        { installationId: targetInstallationId },
                        'La aprobaciÃ³n se registrÃ³, pero no pudimos refrescar la vista.',
                    );
                },
            });
        }

        function buildInstallationCommercialClosureFields({ installationId, commercialClosure }) {
            const fragment = document.createDocumentFragment();
            const grid = document.createElement('div');
            grid.className = 'action-modal-grid';

            const summaryWrap = document.createElement('div');
            summaryWrap.className = 'conformity-modal-summary';
            const summaryTitle = document.createElement('strong');
            summaryTitle.textContent = `Registro #${installationId}`;
            const summaryBody = document.createElement('p');
            summaryBody.textContent = 'Define si este caso requiere presupuesto aprobado antes de la conformidad final.';
            const summaryMeta = document.createElement('div');
            summaryMeta.className = 'conformity-modal-meta';
            summaryMeta.appendChild(
                createConformityStatusChip(
                    `Actual: ${commercialClosure.label}`,
                    commercialClosure.requiresApprovedBudget ? 'warning' : 'resolved',
                ),
            );
            if (commercialClosure.setBy || commercialClosure.setAt) {
                const setByText = commercialClosure.setBy ? `por ${commercialClosure.setBy}` : '';
                const setAtText = commercialClosure.setAt
                    ? `el ${new Date(commercialClosure.setAt).toLocaleString('es-ES')}`
                    : '';
                summaryMeta.appendChild(
                    createConformityStatusChip(
                        [setByText, setAtText].filter(Boolean).join(' ') || 'ConfiguraciÃ³n registrada',
                        'neutral',
                    ),
                );
            }
            summaryWrap.append(summaryTitle, summaryBody, summaryMeta);
            grid.appendChild(summaryWrap);

            const modeSelect = document.createElement('select');
            modeSelect.id = 'actionCommercialClosureMode';
            Object.entries(COMMERCIAL_CLOSURE_MODE_LABELS).forEach(([value, label]) => {
                modeSelect.appendChild(new Option(label, value, value === commercialClosure.mode, value === commercialClosure.mode));
            });
            grid.appendChild(createInputGroup('Cobertura comercial', modeSelect, { htmlFor: modeSelect.id }));

            const noteInput = document.createElement('textarea');
            noteInput.id = 'actionCommercialClosureNote';
            noteInput.rows = 3;
            noteInput.placeholder = 'Justificacion comercial (obligatoria cuando no requiere presupuesto).';
            noteInput.value = commercialClosure.note || '';
            grid.appendChild(createInputGroup('Motivo comercial', noteInput, {
                htmlFor: noteInput.id,
                className: 'full-width',
            }));

            fragment.appendChild(grid);
            return fragment;
        }

        async function openInstallationCommercialClosureModal(installationId, config = {}) {
            if (!options.requireActiveSession()) return;
            const targetInstallationId = parsePositiveIntegerOrNotify(
                installationId,
                'installation_id invÃ¡lido para configurar cobertura.',
            );
            if (!targetInstallationId) return;

            const targetInstallation = config.installation || options.getInstallationById?.(targetInstallationId) || null;
            const commercialClosure = resolveInstallationCommercialClosure(targetInstallation);

            options.openActionModal({
                title: `Cobertura comercial #${targetInstallationId}`,
                subtitle: 'Controla si la conformidad final requiere presupuesto aprobado.',
                submitLabel: 'Guardar cobertura',
                focusId: 'actionCommercialClosureMode',
                fields: buildInstallationCommercialClosureFields({
                    installationId: targetInstallationId,
                    commercialClosure,
                }),
                onSubmit: async () => {
                    const mode = normalizeCommercialClosureMode(
                        document.getElementById('actionCommercialClosureMode')?.value,
                    );
                    const note = String(document.getElementById('actionCommercialClosureNote')?.value || '').trim();
                    if (mode !== DEFAULT_COMMERCIAL_CLOSURE_MODE && !note) {
                        options.setActionModalError('Debes registrar el motivo comercial para cerrar sin presupuesto.');
                        return;
                    }

                    await options.api.updateInstallation(targetInstallationId, {
                        commercial_closure_mode: mode,
                        commercial_closure_note: mode === DEFAULT_COMMERCIAL_CLOSURE_MODE ? '' : note,
                    });

                    options.closeActionModal(true);
                    options.showNotification(
                        mode === DEFAULT_COMMERCIAL_CLOSURE_MODE
                            ? 'El caso vuelve a requerir presupuesto aprobado para la conformidad.'
                            : `Cobertura comercial actualizada: ${formatCommercialClosureModeLabel(mode)}.`,
                        'success',
                    );
                    runIncidentRefreshInBackground(
                        { installationId: targetInstallationId },
                        'La cobertura se guardo, pero no pudimos refrescar la vista.',
                    );
                    void options.loadInstallations?.();
                },
            });
        }
        return {
            applyConformityButtonState,
            applyClosureBannerState,
            buildConformityHelperText,
            applyCreateIncidentButtonState,
            createConformityStatusChip,
            formatCurrencyFromCents,
            formatBudgetApprovalStatusLabel,
            formatBudgetDeliveryStatusLabel,
            formatActiveIncidentsLabel,
            formatBudgetGeneratedAt,
            formatCommercialClosureModeLabel,
            formatConformityGeneratedAt,
            formatConformityStatusLabel,
            isBudgetRequiredForCommercialClosure,
            normalizeCommercialClosureMode,
            openInstallationBudgetApprovalModal,
            openInstallationBudgetModal,
            openInstallationCommercialClosureModal,
            openInstallationConformityModal,
            resolveInstallationCommercialClosure,
            syncVisibleIncidentsHeaderState,
        };
    }

    global.createDashboardIncidentsCommercial = createDashboardIncidentsCommercial;
})(window);

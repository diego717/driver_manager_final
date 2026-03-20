(function attachDashboardModalsFactory(global) {
    function createDashboardModals(options) {
        const modalLastFocused = new Map();
        let actionModalSubmitHandler = null;
        let actionModalSubmitBusy = false;
        let actionModalEventsBound = false;
        let qrPasswordModalBusy = false;

        function isElementFocusable(node) {
            if (!(node instanceof HTMLElement)) return false;
            if (node.hasAttribute('disabled')) return false;
            if (node.getAttribute('aria-hidden') === 'true') return false;
            if (node.getAttribute('inert') === '' || node.getAttribute('inert') === 'true') return false;
            return true;
        }

        function getModalFocusableElements(modalElement) {
            if (!(modalElement instanceof HTMLElement)) return [];
            return Array.from(modalElement.querySelectorAll(options.modalFocusableSelector)).filter(isElementFocusable);
        }

        function getActiveModalElements() {
            return Array.from(document.querySelectorAll('.modal.active'));
        }

        function getTopActiveModalElement() {
            const activeModals = getActiveModalElements();
            if (!activeModals.length) return null;
            return activeModals[activeModals.length - 1];
        }

        function syncBodyModalOpenState() {
            document.body.classList.toggle('modal-open', getActiveModalElements().length > 0);
        }

        function focusModalEntry(modalElement, preferredElement = null, { selectText = false } = {}) {
            if (!(modalElement instanceof HTMLElement)) return;
            const fallback = getModalFocusableElements(modalElement)[0] || null;
            const target = preferredElement instanceof HTMLElement ? preferredElement : fallback;
            if (!(target instanceof HTMLElement)) return;
            target.focus();
            if (
                selectText
                && typeof target.select === 'function'
                && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
            ) {
                target.select();
            }
        }

        function openAccessibleModal(modalId, config = {}) {
            const modal = document.getElementById(modalId);
            if (!(modal instanceof HTMLElement)) return false;
            if (!modal.classList.contains('active')) {
                const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                modalLastFocused.set(modalId, activeElement);
            }
            modal.classList.add('active');
            syncBodyModalOpenState();
            focusModalEntry(modal, config.preferredElement || null, {
                selectText: config.selectText === true,
            });
            return true;
        }

        function closeAccessibleModal(modalId, config = {}) {
            const modal = document.getElementById(modalId);
            if (!(modal instanceof HTMLElement)) return false;
            const wasActive = modal.classList.contains('active');
            modal.classList.remove('active');
            syncBodyModalOpenState();
            if (!wasActive) return false;
            const shouldRestoreFocus = config.restoreFocus !== false;
            const fallbackFocus = config.fallbackFocus instanceof HTMLElement ? config.fallbackFocus : null;
            if (shouldRestoreFocus) {
                const previousFocus = modalLastFocused.get(modalId);
                if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) {
                    previousFocus.focus();
                } else if (fallbackFocus) {
                    fallbackFocus.focus();
                }
            }
            modalLastFocused.delete(modalId);
            return true;
        }

        function trapFocusInsideModal(event, modalElement) {
            if (event.key !== 'Tab') return false;
            const focusables = getModalFocusableElements(modalElement);
            if (!focusables.length) {
                event.preventDefault();
                return true;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement;
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

        function setActionModalError(message = '') {
            const errorEl = document.getElementById('actionModalError');
            if (!errorEl) return;
            errorEl.textContent = String(message || '');
        }

        function setActionModalBusy(isBusy) {
            actionModalSubmitBusy = Boolean(isBusy);
            const submitBtn = document.getElementById('actionModalSubmitBtn');
            const cancelBtn = document.getElementById('actionModalCancelBtn');
            if (submitBtn) {
                const defaultLabel = submitBtn.dataset.defaultLabel || 'Guardar';
                submitBtn.disabled = actionModalSubmitBusy;
                submitBtn.textContent = actionModalSubmitBusy ? 'Procesando...' : defaultLabel;
            }
            if (cancelBtn) {
                cancelBtn.disabled = actionModalSubmitBusy;
            }
        }

        function closeActionModal(force = false) {
            if (actionModalSubmitBusy && !force) return;
            closeAccessibleModal('actionModal');
            setActionModalError('');
            actionModalSubmitHandler = null;
        }

        function openActionModal(config = {}) {
            const modal = document.getElementById('actionModal');
            const titleEl = document.getElementById('actionModalTitle');
            const subtitleEl = document.getElementById('actionModalSubtitle');
            const fieldsEl = document.getElementById('actionModalFields');
            const submitBtn = document.getElementById('actionModalSubmitBtn');
            if (!modal || !titleEl || !subtitleEl || !fieldsEl || !submitBtn) return false;

            titleEl.textContent = String(config.title || 'Accion');

            const subtitle = String(config.subtitle || '').trim();
            subtitleEl.textContent = subtitle;
            subtitleEl.classList.toggle('is-hidden', subtitle.length === 0);

            fieldsEl.innerHTML = String(config.fieldsHtml || '');

            const submitLabel = String(config.submitLabel || 'Guardar');
            submitBtn.dataset.defaultLabel = submitLabel;
            submitBtn.textContent = submitLabel;

            setActionModalError('');
            setActionModalBusy(false);
            actionModalSubmitHandler = typeof config.onSubmit === 'function' ? config.onSubmit : null;

            const preferredFocusId = String(config.focusId || '').trim();
            const preferredElement = preferredFocusId ? document.getElementById(preferredFocusId) : null;
            openAccessibleModal('actionModal', { preferredElement });

            return true;
        }

        function openActionConfirmModal(config = {}) {
            const confirmCheckboxId = 'actionModalConfirmCheckbox';
            const title = String(config.title || 'Confirmar accion').trim() || 'Confirmar accion';
            const subtitle = String(config.subtitle || '').trim();
            const submitLabel = String(config.submitLabel || 'Confirmar').trim() || 'Confirmar';
            const acknowledgementText = String(config.acknowledgementText || 'Confirmo esta accion.').trim()
                || 'Confirmo esta accion.';
            const missingConfirmationMessage = String(
                config.missingConfirmationMessage || 'Debes confirmar la accion para continuar.',
            ).trim() || 'Debes confirmar la accion para continuar.';
            const focusId = String(config.focusId || confirmCheckboxId).trim() || confirmCheckboxId;
            const onSubmit = typeof config.onSubmit === 'function' ? config.onSubmit : async () => {};

            return openActionModal({
                title,
                subtitle,
                submitLabel,
                focusId,
                fieldsHtml: `
                    <label class="action-checkbox" for="${confirmCheckboxId}">
                        <input type="checkbox" id="${confirmCheckboxId}">
                        <span>${options.escapeHtml(acknowledgementText)}</span>
                    </label>
                `,
                onSubmit: async () => {
                    const confirmed = document.getElementById(confirmCheckboxId)?.checked === true;
                    if (!confirmed) {
                        setActionModalError(missingConfirmationMessage);
                        return;
                    }
                    await onSubmit();
                },
            });
        }

        function bindActionModalEvents() {
            if (actionModalEventsBound) return;

            document.querySelector('#actionModal .close')?.addEventListener('click', () => {
                closeActionModal();
            });

            document.getElementById('actionModalCancelBtn')?.addEventListener('click', () => {
                closeActionModal();
            });

            document.getElementById('actionModal')?.addEventListener('click', (event) => {
                if (event.target !== event.currentTarget) return;
                closeActionModal();
            });

            document.getElementById('actionModalForm')?.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (actionModalSubmitBusy) return;
                if (typeof actionModalSubmitHandler !== 'function') return;

                setActionModalError('');
                try {
                    setActionModalBusy(true);
                    await actionModalSubmitHandler();
                } catch (error) {
                    setActionModalError(error?.message || 'No se pudo completar la accion.');
                } finally {
                    setActionModalBusy(false);
                }
            });

            actionModalEventsBound = true;
        }

        async function viewPhoto(photoId) {
            const img = document.getElementById('photoViewer');
            const photoUrl = await options.loadPhotoWithAuth(photoId);
            if (photoUrl) {
                img.src = photoUrl;
                const closeButton = document.querySelector('#photoModal .close');
                openAccessibleModal('photoModal', { preferredElement: closeButton });
            }
        }

        function closePhotoModal() {
            const image = document.getElementById('photoViewer');
            if (image instanceof HTMLImageElement) {
                image.removeAttribute('src');
            }
            closeAccessibleModal('photoModal');
        }

        function canCurrentUserEditAssets() {
            const role = String(options.getCurrentUser()?.role || '').toLowerCase();
            return role === 'admin' || role === 'super_admin';
        }

        function isQrEditSessionActive() {
            const unlockUntil = Number(options.getQrModalEditUnlockUntil() || 0);
            return Number.isFinite(unlockUntil) && unlockUntil > Date.now();
        }

        function getQrEditSessionRemainingMs() {
            return Math.max(0, Number(options.getQrModalEditUnlockUntil() || 0) - Date.now());
        }

        function setQrAssetInputsDisabled(disabled) {
            const inputIds = [
                'qrAssetCodeInput',
                'qrAssetBrandInput',
                'qrAssetModelInput',
                'qrAssetSerialInput',
                'qrAssetClientInput',
                'qrAssetNotesInput',
            ];
            inputIds.forEach((id) => {
                const element = document.getElementById(id);
                if (element) {
                    element.disabled = Boolean(disabled);
                    element.toggleAttribute('readonly', Boolean(disabled));
                }
            });
        }

        function applyQrModalAccessState() {
            const selectedType = document.querySelector('input[name="qrType"]:checked')?.value || 'asset';
            const saveBtn = document.getElementById('qrSaveAssetBtn');
            const enableEditBtn = document.getElementById('qrEnableEditBtn');
            const qrTypeRadios = document.querySelectorAll('input[name="qrType"]');
            const isAssetType = selectedType === 'asset';
            const hasTimedUnlock = isQrEditSessionActive();
            if (options.getQrModalReadOnly()) {
                options.setQrModalEditUnlocked(hasTimedUnlock);
            } else if (canCurrentUserEditAssets()) {
                options.setQrModalEditUnlocked(true);
            } else {
                options.setQrModalEditUnlocked(false);
            }
            const isReadOnlyAssetView = options.getQrModalReadOnly() && isAssetType && !options.getQrModalEditUnlocked();
            const canEdit = canCurrentUserEditAssets();

            qrTypeRadios.forEach((radio) => {
                radio.disabled = Boolean(options.getQrModalReadOnly());
            });

            setQrAssetInputsDisabled(isReadOnlyAssetView);

            if (saveBtn) {
                const shouldShowSave = isAssetType && (!options.getQrModalReadOnly() || options.getQrModalEditUnlocked());
                saveBtn.classList.toggle('is-hidden', !shouldShowSave);
                saveBtn.disabled = !shouldShowSave;
            }

            if (enableEditBtn) {
                const shouldShowEnableEdit = isReadOnlyAssetView && canEdit;
                enableEditBtn.classList.toggle('is-hidden', !shouldShowEnableEdit);
                enableEditBtn.disabled = !shouldShowEnableEdit;
            }

            const helper = document.getElementById('qrAssetHelper');
            if (helper) {
                if (isReadOnlyAssetView && canEdit) {
                    helper.textContent = 'Modo solo lectura. Para editar, usa "Habilitar edicion" y confirma tu contrasena.';
                } else if (isReadOnlyAssetView && !canEdit) {
                    helper.textContent = 'Modo solo lectura. Solo admin/super_admin pueden editar este equipo.';
                } else if (options.getQrModalReadOnly() && options.getQrModalEditUnlocked() && hasTimedUnlock) {
                    const minutesLeft = Math.max(1, Math.ceil(getQrEditSessionRemainingMs() / 60000));
                    helper.textContent = `Edicion habilitada temporalmente (${minutesLeft} min restantes).`;
                } else {
                    helper.textContent = 'Requisitos: marca o modelo, y numero de serie. El codigo externo se genera automaticamente desde serie si queda vacio.';
                }
            }
        }

        async function verifyCurrentUserPassword(password) {
            const candidate = String(password || '');
            if (!candidate.trim()) {
                throw new Error('Debes ingresar tu contrasena.');
            }

            await options.api.request('/web/auth/verify-password', {
                method: 'POST',
                body: JSON.stringify({
                    password: candidate,
                }),
            });
        }

        function setQrPasswordModalError(message = '') {
            const errorEl = document.getElementById('qrPasswordError');
            if (!errorEl) return;
            errorEl.textContent = message || '';
        }

        function setQrPasswordModalBusy(isBusy) {
            qrPasswordModalBusy = Boolean(isBusy);
            const confirmBtn = document.getElementById('qrPasswordConfirmBtn');
            const cancelBtn = document.getElementById('qrPasswordCancelBtn');
            const input = document.getElementById('qrPasswordInput');
            if (confirmBtn) confirmBtn.disabled = qrPasswordModalBusy;
            if (cancelBtn) cancelBtn.disabled = qrPasswordModalBusy;
            if (input) input.disabled = qrPasswordModalBusy;
        }

        function openQrPasswordModal() {
            const modal = document.getElementById('qrPasswordModal');
            const input = document.getElementById('qrPasswordInput');
            if (!modal || !input) return;
            setQrPasswordModalBusy(false);
            setQrPasswordModalError('');
            input.value = '';
            openAccessibleModal('qrPasswordModal', { preferredElement: input, selectText: true });
        }

        function closeQrPasswordModal(config = {}) {
            closeAccessibleModal('qrPasswordModal', { restoreFocus: config.restoreFocus !== false });
            setQrPasswordModalBusy(false);
            setQrPasswordModalError('');
        }

        async function confirmQrEditUnlockFromModal() {
            if (qrPasswordModalBusy) return;
            const input = document.getElementById('qrPasswordInput');
            const password = String(input?.value || '');
            try {
                setQrPasswordModalBusy(true);
                await verifyCurrentUserPassword(password);
                options.setQrModalEditUnlocked(true);
                options.setQrModalEditUnlockUntil(Date.now() + options.qrEditUnlockTtlMs);
                applyQrModalAccessState();
                closeQrPasswordModal();
                setQrError('');
                options.showNotification('Edicion habilitada por 10 minutos.', 'success');
            } catch (error) {
                setQrPasswordModalBusy(false);
                setQrPasswordModalError(error?.message || 'No se pudo validar la contrasena.');
            }
        }

        function setQrError(message = '') {
            const errorEl = document.getElementById('qrError');
            if (!errorEl) return;
            errorEl.textContent = message || '';
        }

        function applyQrTypeMeta() {
            const selectedType = document.querySelector('input[name="qrType"]:checked')?.value || 'asset';
            const installationFields = document.getElementById('qrInstallationFields');
            const assetFields = document.getElementById('qrAssetFields');
            const presetContainer = document.getElementById('qrLabelPresetContainer');
            if (selectedType === 'installation') {
                installationFields?.classList.remove('is-hidden');
                assetFields?.classList.add('is-hidden');
                presetContainer?.classList.add('is-hidden');
            } else {
                installationFields?.classList.add('is-hidden');
                assetFields?.classList.remove('is-hidden');
                presetContainer?.classList.remove('is-hidden');
            }
            const helperText = document.getElementById('qrHelperText');
            if (helperText) {
                helperText.textContent = 'Formato recomendado para mobile: dm://installation/{id}.';
            }
            applyQrModalAccessState();
        }

        function resetQrPreview() {
            options.resetQrState();
            const preview = document.getElementById('qrPreview');
            const previewImage = document.getElementById('qrPreviewImage');
            const payloadText = document.getElementById('qrPayloadText');
            const detailsText = document.getElementById('qrDetailsText');
            const copyBtn = document.getElementById('qrCopyBtn');
            const downloadBtn = document.getElementById('qrDownloadBtn');
            const printBtn = document.getElementById('qrPrintBtn');

            if (preview) preview.classList.add('is-hidden');
            if (previewImage) previewImage.removeAttribute('src');
            if (payloadText) payloadText.textContent = '';
            if (detailsText) detailsText.textContent = '';
            if (copyBtn) copyBtn.disabled = true;
            if (downloadBtn) downloadBtn.disabled = true;
            if (printBtn) printBtn.disabled = true;
        }

        function showQrModal(config = {}) {
            const modal = document.getElementById('qrModal');
            const valueInput = document.getElementById('qrValueInput');
            const codeInput = document.getElementById('qrAssetCodeInput');
            const brandInput = document.getElementById('qrAssetBrandInput');
            const modelInput = document.getElementById('qrAssetModelInput');
            const serialInput = document.getElementById('qrAssetSerialInput');
            const clientInput = document.getElementById('qrAssetClientInput');
            const notesInput = document.getElementById('qrAssetNotesInput');
            const presetSelect = document.getElementById('qrLabelPresetSelect');
            const type = config.type === 'installation' ? 'installation' : 'asset';
            const value = String(config.value || '');
            const asset = config.asset && typeof config.asset === 'object' ? config.asset : {};
            options.setQrModalReadOnly(Boolean(config.readOnly));
            options.setQrModalEditUnlocked(false);
            const radio = document.querySelector(`input[name="qrType"][value="${type}"]`);
            if (!modal || !valueInput || !radio) return;

            radio.checked = true;
            valueInput.value = value;
            if (codeInput) codeInput.value = options.normalizeAssetCodeForQr(asset.external_code || value);
            if (brandInput) brandInput.value = options.normalizeAssetFormText(asset.brand, options.qrMaxBrandLength);
            if (modelInput) modelInput.value = options.normalizeAssetFormText(asset.model, options.qrMaxModelLength);
            if (serialInput) {
                serialInput.value = options.normalizeAssetFormText(asset.serial_number, options.qrMaxSerialLength);
            }
            if (clientInput) {
                clientInput.value = options.normalizeAssetFormText(asset.client_name, options.qrMaxClientLength);
            }
            if (notesInput) notesInput.value = options.normalizeAssetFormText(asset.notes, options.qrMaxNotesLength);
            if (presetSelect) {
                presetSelect.value = options.getCurrentQrLabelPreset();
            }
            applyQrTypeMeta();
            applyQrModalAccessState();
            resetQrPreview();
            setQrError('');
            const preferredElement = type === 'installation'
                ? valueInput
                : (document.getElementById('qrAssetSerialInput') || valueInput);
            openAccessibleModal('qrModal', { preferredElement, selectText: true });
        }

        function closeQrModal() {
            closeQrPasswordModal({ restoreFocus: false });
            closeAccessibleModal('qrModal');
            options.setQrModalReadOnly(false);
            options.setQrModalEditUnlocked(false);
            setQrError('');
            resetQrPreview();
        }

        function closeTopActiveModal() {
            const modal = getTopActiveModalElement();
            if (!(modal instanceof HTMLElement)) return false;
            const modalId = modal.id;
            if (modalId === 'loginModal') {
                options.hideLogin();
                return true;
            }
            if (modalId === 'photoModal') {
                closePhotoModal();
                return true;
            }
            if (modalId === 'qrPasswordModal') {
                if (qrPasswordModalBusy) return true;
                closeQrPasswordModal();
                return true;
            }
            if (modalId === 'qrModal') {
                closeQrModal();
                return true;
            }
            if (modalId === 'actionModal') {
                closeActionModal();
                return true;
            }
            return false;
        }

        function handleModalKeyboardInteraction(event) {
            const topModal = getTopActiveModalElement();
            if (!(topModal instanceof HTMLElement)) return false;
            if (event.key === 'Escape') {
                event.preventDefault();
                return closeTopActiveModal();
            }
            return trapFocusInsideModal(event, topModal);
        }

        function bindSharedModalUi() {
            bindActionModalEvents();

            document.querySelector('#photoModal .close')?.addEventListener('click', () => {
                closePhotoModal();
            });

            document.getElementById('photoModal')?.addEventListener('click', (event) => {
                if (event.target === event.currentTarget) {
                    closePhotoModal();
                }
            });

            document.querySelector('#qrPasswordModal .close')?.addEventListener('click', () => {
                closeQrPasswordModal();
            });

            document.getElementById('qrPasswordCancelBtn')?.addEventListener('click', () => {
                closeQrPasswordModal();
            });

            document.getElementById('qrPasswordConfirmBtn')?.addEventListener('click', () => {
                void confirmQrEditUnlockFromModal();
            });

            document.getElementById('qrPasswordInput')?.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void confirmQrEditUnlockFromModal();
            });

            document.getElementById('qrPasswordModal')?.addEventListener('click', (event) => {
                if (event.target !== event.currentTarget) return;
                if (qrPasswordModalBusy) return;
                closeQrPasswordModal();
            });
        }

        return {
            applyQrModalAccessState,
            applyQrTypeMeta,
            bindSharedModalUi,
            canCurrentUserEditAssets,
            closeAccessibleModal,
            closeActionModal,
            closePhotoModal,
            closeQrModal,
            closeQrPasswordModal,
            confirmQrEditUnlockFromModal,
            getQrEditSessionRemainingMs,
            handleModalKeyboardInteraction,
            isQrEditSessionActive,
            openAccessibleModal,
            openActionConfirmModal,
            openActionModal,
            openQrPasswordModal,
            resetQrPreview,
            setActionModalError,
            setQrError,
            showQrModal,
            viewPhoto,
        };
    }

    global.createDashboardModals = createDashboardModals;
})(window);

(function attachDashboardScanFactory(global) {
    function createDashboardScan(options) {
        const DM_URI_PATTERN = /^dm:\/\/(installation|asset)\/([^?#]+)(?:\?([^#]*))?$/i;
        const ASSET_CODE_MAX_LENGTH = 128;
        const ASSET_BRAND_MAX_LENGTH = 120;
        const ASSET_MODEL_MAX_LENGTH = 160;
        const ASSET_SERIAL_MAX_LENGTH = 128;
        const ASSET_CLIENT_MAX_LENGTH = 180;
        const ASSET_NOTES_MAX_LENGTH = 2000;
        let stream = null;
        let detector = null;
        let detectorLoopHandle = 0;
        let jsQrLoopHandle = 0;
        let jsQrCanvas = null;
        let jsQrContext = null;
        let resolving = false;
        let lastCameraRawValue = '';
        let lastCameraRawAt = 0;

        function getRefs() {
            return {
                modal: document.getElementById('scanQrModal'),
                closeBtn: document.querySelector('#scanQrModal .close'),
                video: document.getElementById('scanQrVideo'),
                status: document.getElementById('scanQrStatus'),
                error: document.getElementById('scanQrError'),
                startBtn: document.getElementById('scanQrStartBtn'),
                stopBtn: document.getElementById('scanQrStopBtn'),
                form: document.getElementById('scanQrManualForm'),
                input: document.getElementById('scanQrManualInput'),
            };
        }

        function setStatus(message) {
            const refs = getRefs();
            if (refs.status) {
                refs.status.textContent = String(message || '');
            }
        }

        function setError(message = '') {
            const refs = getRefs();
            if (refs.error) {
                refs.error.textContent = String(message || '');
            }
        }

        function normalizeAssetMetadataValue(rawValue, maxLength) {
            return String(rawValue || '')
                .trim()
                .replace(/\s+/g, ' ')
                .slice(0, maxLength);
        }

        function parseAssetMetadataFromQuery(queryString, externalCode = '') {
            const rawQuery = String(queryString || '').trim();
            if (!rawQuery) return null;

            let params = null;
            try {
                params = new URLSearchParams(rawQuery);
            } catch {
                return null;
            }

            const readFirst = (...keys) => {
                for (const key of keys) {
                    const value = params.get(key);
                    if (value !== null && value !== undefined) {
                        return value;
                    }
                }
                return '';
            };

            const normalizedExternalCode = normalizeAssetMetadataValue(
                externalCode || readFirst('external_code', 'code', 'asset_code'),
                ASSET_CODE_MAX_LENGTH,
            );
            if (!normalizedExternalCode) return null;

            const brand = normalizeAssetMetadataValue(readFirst('brand', 'b'), ASSET_BRAND_MAX_LENGTH);
            const model = normalizeAssetMetadataValue(readFirst('model', 'm'), ASSET_MODEL_MAX_LENGTH);
            const serialNumber = normalizeAssetMetadataValue(
                readFirst('serial_number', 'serial', 'sn', 's'),
                ASSET_SERIAL_MAX_LENGTH,
            );
            const clientName = normalizeAssetMetadataValue(
                readFirst('client_name', 'client', 'c'),
                ASSET_CLIENT_MAX_LENGTH,
            );
            const notes = normalizeAssetMetadataValue(
                readFirst('notes', 'note', 'n'),
                ASSET_NOTES_MAX_LENGTH,
            );

            if (!brand && !model && !serialNumber && !clientName && !notes) {
                return null;
            }

            return {
                external_code: normalizedExternalCode,
                brand,
                model,
                serial_number: serialNumber,
                client_name: clientName,
                notes,
            };
        }

        function parseScannedPayload(input) {
            const raw = String(input || '').trim();
            if (!raw) return null;

            const dmMatch = raw.match(DM_URI_PATTERN);
            if (dmMatch) {
                const type = String(dmMatch[1] || '').toLowerCase();
                const payload = decodeURIComponent(dmMatch[2] || '').trim();
                const queryString = String(dmMatch[3] || '').trim();
                if (type === 'installation') {
                    const installationId = Number.parseInt(payload, 10);
                    if (!Number.isInteger(installationId) || installationId <= 0) {
                        return null;
                    }
                    return { type: 'installation', installationId, raw };
                }
                if (!payload) return null;
                return {
                    type: 'asset',
                    externalCode: payload,
                    assetData: parseAssetMetadataFromQuery(queryString, payload),
                    raw,
                };
            }

            if (/^\d+$/.test(raw)) {
                const installationId = Number.parseInt(raw, 10);
                if (Number.isInteger(installationId) && installationId > 0) {
                    return { type: 'installation', installationId, raw };
                }
            }

            return null;
        }

        function stopDetectorLoop() {
            if (detectorLoopHandle) {
                global.cancelAnimationFrame(detectorLoopHandle);
                detectorLoopHandle = 0;
            }
        }

        function stopJsQrLoop() {
            if (jsQrLoopHandle) {
                global.clearTimeout(jsQrLoopHandle);
                jsQrLoopHandle = 0;
            }
        }

        function getJsQrDecoder() {
            return typeof global.jsQR === 'function' ? global.jsQR : null;
        }

        function ensureJsQrCanvas(width, height) {
            if (!(jsQrCanvas instanceof HTMLCanvasElement)) {
                jsQrCanvas = document.createElement('canvas');
            }
            if (jsQrCanvas.width !== width) jsQrCanvas.width = width;
            if (jsQrCanvas.height !== height) jsQrCanvas.height = height;
            if (!jsQrContext) {
                jsQrContext = jsQrCanvas.getContext('2d', { willReadFrequently: true });
            }
            return jsQrContext;
        }

        async function stopCamera() {
            stopDetectorLoop();
            stopJsQrLoop();
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
                stream = null;
            }
            const refs = getRefs();
            if (refs.video instanceof HTMLVideoElement && refs.video.srcObject) {
                refs.video.pause();
                refs.video.srcObject = null;
            }
        }

        async function closeModal() {
            await stopCamera();
            const refs = getRefs();
            if (refs.modal instanceof HTMLElement) {
                refs.modal.classList.remove('active');
            }
            document.body.classList.remove('modal-open');
            resolving = false;
            setError('');
        }

        async function openModal() {
            if (typeof options.requireActiveSession === 'function' && !options.requireActiveSession()) {
                return;
            }
            const refs = getRefs();
            if (!(refs.modal instanceof HTMLElement)) return;
            refs.modal.classList.add('active');
            document.body.classList.add('modal-open');
            setError('');
            setStatus('Preparando escaneo...');
            refs.input?.focus();
            await startCamera();
        }

        function resolveCameraDecoderMode() {
            if (typeof global.BarcodeDetector === 'function') {
                if (!detector) {
                    detector = new global.BarcodeDetector({
                        formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8'],
                    });
                }
                return 'barcode';
            }
            if (getJsQrDecoder()) {
                return 'jsqr';
            }
            return null;
        }

        async function openResolvedInstallation(installationId) {
            await options.openInstallation(installationId);
            options.showNotification?.(`Registro #${installationId} listo para trabajar.`, 'success');
        }

        async function openResolvedAsset(assetRecordId, installationId = null) {
            await options.openAsset(assetRecordId);
            if (Number.isInteger(installationId) && installationId > 0) {
                options.showNotification?.(
                    `Equipo #${assetRecordId} con instalacion activa #${installationId}.`,
                    'info',
                );
            } else {
                options.showNotification?.(`Equipo #${assetRecordId} abierto en detalle.`, 'success');
            }
        }

        function shouldIgnoreRepeatedCameraValue(rawValue) {
            const normalized = String(rawValue || '').trim();
            const now = Date.now();
            if (
                normalized
                && normalized === lastCameraRawValue
                && now - lastCameraRawAt < 2200
            ) {
                return true;
            }
            lastCameraRawValue = normalized;
            lastCameraRawAt = now;
            return false;
        }

        async function resolveAssetFromLabelPayload(parsed, source = 'manual') {
            if (!parsed || parsed.type !== 'asset' || !parsed.assetData) return false;
            if (typeof options.resolveAssetFromLabelPayload !== 'function') return false;

            setStatus('Etiqueta detectada. Registrando equipo...');
            const resolved = await options.resolveAssetFromLabelPayload(parsed.assetData, {
                source,
                rawValue: parsed.raw,
            });
            const assetRecordId = Number.parseInt(
                String(resolved?.asset?.id ?? resolved?.id ?? ''),
                10,
            );
            const installationId = Number.parseInt(
                String(
                    resolved?.active_link?.installation_id
                    ?? resolved?.installation_id
                    ?? '',
                ),
                10,
            );
            if (!Number.isInteger(assetRecordId) || assetRecordId <= 0) {
                return false;
            }
            await openResolvedAsset(
                assetRecordId,
                Number.isInteger(installationId) && installationId > 0 ? installationId : null,
            );
            await closeModal();
            return true;
        }

        async function resolveScannedValue(rawValue, source = 'manual') {
            if (resolving) return;
            resolving = true;

            try {
                const parsed = parseScannedPayload(rawValue);
                if (!parsed) {
                    if (source === 'camera') {
                        setError('');
                        setStatus('Codigo detectado, pero no coincide con el formato operativo. Sigue apuntando o usa el fallback manual.');
                        return;
                    }
                    throw new Error(
                        'Formato esperado: dm://installation/{id}, dm://asset/{external_code}, dm://asset/{external_code}?v=2&brand=... o numero puro.',
                    );
                }

                setError('');
                setStatus('Resolviendo codigo...');

                if (parsed.type === 'installation') {
                    await openResolvedInstallation(parsed.installationId);
                    await closeModal();
                    return;
                }

                const lookup = await options.api.lookupCode(parsed.externalCode, 'asset');
                const match = lookup?.match || {};
                const assetRecordId = Number.parseInt(String(match.asset_record_id || ''), 10);
                const installationId = Number.parseInt(String(match.installation_id || ''), 10);

                if (Number.isInteger(assetRecordId) && assetRecordId > 0) {
                    await openResolvedAsset(
                        assetRecordId,
                        Number.isInteger(installationId) && installationId > 0 ? installationId : null,
                    );
                    await closeModal();
                    return;
                }

                if (Number.isInteger(installationId) && installationId > 0) {
                    await openResolvedInstallation(installationId);
                    await closeModal();
                    return;
                }

                const resolvedFromLabel = await resolveAssetFromLabelPayload(parsed, source);
                if (resolvedFromLabel) {
                    return;
                }

                throw new Error('No se encontro un equipo o registro activo para ese codigo.');
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setError(message);
                setStatus('No pudimos resolver el codigo. Revisa el formato o usa otro destino.');
            } finally {
                resolving = false;
            }
        }

        async function tickDetector() {
            const refs = getRefs();
            if (!(refs.video instanceof HTMLVideoElement) || !(detector && stream)) {
                return;
            }

            try {
                const barcodes = await detector.detect(refs.video);
                if (Array.isArray(barcodes) && barcodes.length > 0) {
                    const rawValue = String(barcodes[0]?.rawValue || '').trim();
                    if (rawValue && !shouldIgnoreRepeatedCameraValue(rawValue)) {
                        await resolveScannedValue(rawValue, 'camera');
                        return;
                    }
                }
            } catch {
                setStatus('No pudimos leer la camara. Usa el fallback manual.');
                return;
            }

            detectorLoopHandle = global.requestAnimationFrame(() => {
                void tickDetector();
            });
        }

        async function tickJsQr() {
            const refs = getRefs();
            const decodeFrame = getJsQrDecoder();
            if (!(refs.video instanceof HTMLVideoElement) || !(stream && decodeFrame)) {
                return;
            }

            const frameWidth = Number(refs.video.videoWidth || refs.video.clientWidth || 0);
            const frameHeight = Number(refs.video.videoHeight || refs.video.clientHeight || 0);
            if (frameWidth <= 0 || frameHeight <= 0) {
                jsQrLoopHandle = global.setTimeout(() => {
                    void tickJsQr();
                }, 180);
                return;
            }

            try {
                const context = ensureJsQrCanvas(frameWidth, frameHeight);
                if (!context?.drawImage || !context?.getImageData) {
                    setStatus('Tu navegador no expone lectura de video para escaneo automatico. Usa el fallback manual.');
                    return;
                }
                context.drawImage(refs.video, 0, 0, frameWidth, frameHeight);
                const frame = context.getImageData(0, 0, frameWidth, frameHeight);
                const result = decodeFrame(frame.data, frameWidth, frameHeight, {
                    inversionAttempts: 'dontInvert',
                });
                const rawValue = String(result?.data || '').trim();
                if (rawValue && !shouldIgnoreRepeatedCameraValue(rawValue)) {
                    await resolveScannedValue(rawValue, 'camera');
                    return;
                }
            } catch {
                setStatus('No pudimos leer la camara automaticamente. Usa el fallback manual.');
                return;
            }

            jsQrLoopHandle = global.setTimeout(() => {
                void tickJsQr();
            }, 180);
        }

        async function startCamera() {
            await stopCamera();

            const refs = getRefs();
            if (!(refs.video instanceof HTMLVideoElement)) return;

            if (!global.navigator?.mediaDevices?.getUserMedia) {
                setStatus('Este navegador no expone camara para la web. Usa el fallback manual.');
                return;
            }

            try {
                stream = await global.navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' },
                    audio: false,
                });
                refs.video.srcObject = stream;
                await refs.video.play();
                if (typeof global.BarcodeDetector !== 'function' && typeof options.ensureJsQrAvailability === 'function') {
                    await options.ensureJsQrAvailability();
                }
                const decoderMode = resolveCameraDecoderMode();
                if (decoderMode === 'barcode') {
                    setStatus('Camara activa. Apunta al QR para resolver contexto.');
                    void tickDetector();
                } else if (decoderMode === 'jsqr') {
                    setStatus('Camara activa. Escaneo compatible activado para este navegador.');
                    void tickJsQr();
                } else {
                    setStatus('Camara activa, pero este navegador no soporta escaneo automatico. Usa el fallback manual.');
                }
            } catch (error) {
                const errorName = String(error?.name || '').trim().toLowerCase();
                const rawMessage = String(error?.message || error || '').trim();
                const normalizedMessage = rawMessage.toLowerCase();
                const isPermissionDenied =
                    errorName === 'notallowederror'
                    || normalizedMessage.includes('permission denied')
                    || normalizedMessage.includes('permission dismissed')
                    || normalizedMessage.includes('denied');
                if (isPermissionDenied) {
                    setError('La camara fue bloqueada por el navegador o el sistema.');
                    setStatus(
                        'Permiso de camara bloqueado. Habilitalo desde el icono del sitio o desde Ajustes > Apps > Chrome > Permisos > Camara, y vuelve a intentar.',
                    );
                    return;
                }
                setStatus(`No se pudo iniciar camara (${rawMessage || 'error desconocido'}). Usa el fallback manual.`);
            }
        }

        function bindOpenButtons() {
            [
                'overflowScanQrBtn',
                'installationsScanQrBtn',
                'incidentsScanQrBtn',
            ].forEach((id) => {
                document.getElementById(id)?.addEventListener('click', () => {
                    void openModal();
                });
            });
        }

        function bindModalEvents() {
            const refs = getRefs();
            refs.closeBtn?.addEventListener('click', () => {
                void closeModal();
            });
            refs.modal?.addEventListener('click', (event) => {
                if (event.target !== refs.modal) return;
                void closeModal();
            });
            refs.startBtn?.addEventListener('click', () => {
                void startCamera();
            });
            refs.stopBtn?.addEventListener('click', () => {
                void stopCamera();
                setStatus('Camara detenida. Puedes seguir con el fallback manual.');
            });
            refs.form?.addEventListener('submit', (event) => {
                event.preventDefault();
                const rawValue = String(refs.input?.value || '').trim();
                void resolveScannedValue(rawValue, 'manual');
            });
            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                if (!refs.modal?.classList.contains('active')) return;
                void closeModal();
            });
        }

        function bindEvents() {
            bindOpenButtons();
            bindModalEvents();
        }

        return {
            bindEvents,
            openModal,
            closeModal,
            parseScannedPayload,
            resolveScannedValue,
            startCamera,
            stopCamera,
        };
    }

    global.createDashboardScan = createDashboardScan;
})(window);

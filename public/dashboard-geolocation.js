(function attachDashboardGeolocationFactory(global) {
    function createDashboardGeolocation() {
        const CAPTURE_OPTIONS = Object.freeze({
            enableHighAccuracy: true,
            timeout: 8000,
            maximumAge: 0,
        });
        const STATUS_LABELS = Object.freeze({
            pending: 'Capturando ubicacion puntual...',
            captured: 'Ubicacion capturada',
            denied: 'Permiso denegado',
            timeout: 'Tiempo agotado',
            unavailable: 'Ubicacion no disponible',
            unsupported: 'Geolocalizacion no soportada',
        });
        const STATUS_SUMMARIES = Object.freeze({
            pending: 'Intentamos obtener una ubicacion puntual para este formulario. No bloquea el guardado.',
            denied: 'El formulario se puede guardar igual. Quedara registrado que el permiso fue denegado.',
            timeout: 'El formulario se puede guardar igual. Quedara registrado que la captura expiro.',
            unavailable: 'El formulario se puede guardar igual. Quedara registrado que la ubicacion no estuvo disponible.',
            unsupported: 'Este navegador no expone geolocalizacion para la captura puntual.',
        });

        function buildDefaultSnapshot() {
            return {
                status: 'pending',
                source: 'none',
                note: '',
            };
        }

        function cloneSnapshot(snapshot) {
            return snapshot && typeof snapshot === 'object'
                ? { ...snapshot }
                : buildDefaultSnapshot();
        }

        function mapBrowserError(error) {
            const code = Number(error?.code);
            if (code === 1) {
                return {
                    status: 'denied',
                    source: 'browser',
                    note: '',
                };
            }
            if (code === 3) {
                return {
                    status: 'timeout',
                    source: 'browser',
                    note: '',
                };
            }
            return {
                status: 'unavailable',
                source: 'browser',
                note: '',
            };
        }

        function captureSnapshot() {
            const geolocationApi = global?.navigator?.geolocation || null;
            if (!geolocationApi || typeof geolocationApi.getCurrentPosition !== 'function') {
                return Promise.resolve({
                    status: 'unsupported',
                    source: 'browser',
                    note: '',
                });
            }

            return new Promise((resolve) => {
                geolocationApi.getCurrentPosition(
                    (position) => {
                        resolve({
                            lat: Number(position?.coords?.latitude),
                            lng: Number(position?.coords?.longitude),
                            accuracy_m: Number(position?.coords?.accuracy),
                            captured_at: new Date(position?.timestamp || Date.now()).toISOString(),
                            source: 'browser',
                            status: 'captured',
                            note: '',
                        });
                    },
                    (error) => {
                        resolve(mapBrowserError(error));
                    },
                    CAPTURE_OPTIONS,
                );
            });
        }

        function formatCoordinate(value) {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) return '-';
            return numericValue.toFixed(5);
        }

        function formatAccuracy(value) {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) return '-';
            return `+- ${Math.round(Math.max(0, numericValue))} m`;
        }

        function formatCapturedAt(value) {
            const parsed = value ? new Date(value) : null;
            if (!parsed || Number.isNaN(parsed.getTime())) return 'Sin hora';
            return parsed.toLocaleString('es-ES');
        }

        function describeSnapshot(snapshot) {
            if (snapshot?.status === 'captured') {
                return [
                    `Lat ${formatCoordinate(snapshot.lat)}`,
                    `Lng ${formatCoordinate(snapshot.lng)}`,
                    formatAccuracy(snapshot.accuracy_m),
                    formatCapturedAt(snapshot.captured_at),
                ].join(' | ');
            }
            return STATUS_SUMMARIES[snapshot?.status] || STATUS_SUMMARIES.pending;
        }

        function createController(config = {}) {
            const panelElement = config.panelElement || null;
            const statusElement = config.statusElement || null;
            const summaryElement = config.summaryElement || null;
            const captureButton = config.captureButton || null;
            const onSnapshotChange = typeof config.onSnapshotChange === 'function'
                ? config.onSnapshotChange
                : null;
            let currentSnapshot = buildDefaultSnapshot();
            let inflightCapture = null;

            function render() {
                const status = String(currentSnapshot?.status || 'pending').trim().toLowerCase() || 'pending';
                if (panelElement instanceof HTMLElement) {
                    panelElement.dataset.gpsState = status;
                }
                if (statusElement instanceof HTMLElement) {
                    statusElement.textContent = STATUS_LABELS[status] || STATUS_LABELS.pending;
                }
                if (summaryElement instanceof HTMLElement) {
                    summaryElement.textContent = describeSnapshot(currentSnapshot);
                }
                if (captureButton instanceof HTMLButtonElement) {
                    captureButton.disabled = inflightCapture !== null;
                    captureButton.textContent = inflightCapture ? 'Capturando...' : 'Capturar ubicacion';
                }
                if (onSnapshotChange) {
                    onSnapshotChange(cloneSnapshot(currentSnapshot), {
                        inflight: inflightCapture !== null,
                    });
                }
            }

            async function capture() {
                if (inflightCapture) {
                    return inflightCapture;
                }

                currentSnapshot = {
                    status: 'pending',
                    source: 'browser',
                    note: '',
                };
                render();

                inflightCapture = captureSnapshot()
                    .then((snapshot) => {
                        currentSnapshot = cloneSnapshot(snapshot);
                        return currentSnapshot;
                    })
                    .finally(() => {
                        inflightCapture = null;
                        render();
                    });

                return inflightCapture;
            }

            function getSnapshotForSubmit() {
                if (inflightCapture) {
                    return {
                        status: 'pending',
                        source: 'browser',
                        note: 'capture_in_progress_at_submit',
                    };
                }
                return cloneSnapshot(currentSnapshot);
            }

            if (captureButton instanceof HTMLButtonElement) {
                captureButton.addEventListener('click', () => {
                    void capture();
                });
            }

            render();

            return {
                capture,
                getSnapshotForSubmit,
            };
        }

        return {
            buildDefaultSnapshot,
            createController,
        };
    }

    global.createDashboardGeolocation = createDashboardGeolocation;
})(window);

// Dashboard API client module.
// Exposes a small factory on window so dashboard.js can stay focused on UI logic.
(function initDashboardApi(globalScope) {
    function parseApiResponsePayload(response) {
        return response.text().then((rawText) => {
            if (!rawText) return null;

            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            const looksLikeJson = contentType.includes('application/json');
            if (!looksLikeJson) {
                return rawText;
            }

            try {
                return JSON.parse(rawText);
            } catch {
                return rawText;
            }
        });
    }

    function extractApiErrorMessage(payload, response) {
        if (payload && typeof payload === 'object') {
            const nestedError = payload.error && typeof payload.error === 'object'
                ? payload.error.message
                : undefined;
            const directMessage = payload.message;
            const message = nestedError || directMessage;
            if (typeof message === 'string' && message.trim()) {
                return message.trim();
            }
        }

        if (typeof payload === 'string' && payload.trim()) {
            return payload.trim();
        }

        return `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    }

    function createClient(config = {}) {
        const apiBase = String(config.apiBase || '');
        const credentials = config.credentials || 'include';
        const getAccessToken = typeof config.getAccessToken === 'function'
            ? config.getAccessToken
            : () => '';
        const setAccessToken = typeof config.setAccessToken === 'function'
            ? config.setAccessToken
            : () => {};
        const onUnauthorized = typeof config.onUnauthorized === 'function'
            ? config.onUnauthorized
            : () => {};

        function buildUrl(endpoint) {
            return `${apiBase}${endpoint}`;
        }

        function isLocalhost(hostname) {
            return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
        }

        function assertSecureAuthTransport(endpoint) {
            if (!String(endpoint || '').startsWith('/web/auth/')) {
                return;
            }

            const protocol = globalScope?.location?.protocol || '';
            const hostname = globalScope?.location?.hostname || '';
            if (protocol === 'https:' || isLocalhost(hostname)) {
                return;
            }

            throw new Error('El inicio de sesión solo está permitido sobre HTTPS.');
        }

        async function request(endpoint, options = {}) {
            assertSecureAuthTransport(endpoint);
            const baseHeaders = {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            };

            const sendRequest = async (useBearer = true) => {
                const authHeaders = useBearer && getAccessToken()
                    ? { Authorization: `Bearer ${getAccessToken()}` }
                    : {};
                const headers = {
                    ...baseHeaders,
                    ...authHeaders,
                };
                const requestInit = {
                    ...options,
                    headers,
                    credentials,
                };
                if (!Object.prototype.hasOwnProperty.call(requestInit, 'cache')) {
                    const method = String(requestInit.method || 'GET').toUpperCase();
                    if (method === 'GET') {
                        requestInit.cache = 'no-store';
                    }
                }

                const response = await fetch(buildUrl(endpoint), requestInit);
                const payload = await parseApiResponsePayload(response);
                return { response, payload };
            };

            let { response, payload } = await sendRequest(true);

            // If bearer got stale (session rotated), retry once using only cookie session.
            if (response.status === 401 && getAccessToken()) {
                const retryResult = await sendRequest(false);
                response = retryResult.response;
                payload = retryResult.payload;
                if (response.ok) {
                    // Prefer cookie session until the next explicit login refreshes bearer.
                    setAccessToken('');
                }
            }

            if (response.status === 401) {
                onUnauthorized();
                throw new Error(extractApiErrorMessage(payload, response) || 'No autorizado');
            }

            if (!response.ok) {
                throw new Error(extractApiErrorMessage(payload, response));
            }

            if (payload === null) {
                return {};
            }

            return payload;
        }

        async function uploadDriver(file, metadata = {}) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('brand', String(metadata.brand || '').trim());
            formData.append('version', String(metadata.version || '').trim());
            formData.append('description', String(metadata.description || '').trim());

            const authHeaders = getAccessToken()
                ? { Authorization: `Bearer ${getAccessToken()}` }
                : {};

            const response = await fetch(buildUrl('/web/drivers'), {
                method: 'POST',
                headers: {
                    ...authHeaders,
                },
                body: formData,
                credentials,
            });
            const payload = await parseApiResponsePayload(response);

            if (response.status === 401) {
                onUnauthorized();
                throw new Error(extractApiErrorMessage(payload, response) || 'No autorizado');
            }

            if (!response.ok) {
                throw new Error(extractApiErrorMessage(payload, response));
            }

            return payload || {};
        }

        async function uploadIncidentPhoto(incidentId, file) {
            const authHeaders = getAccessToken()
                ? { Authorization: `Bearer ${getAccessToken()}` }
                : {};
            const response = await fetch(buildUrl(`/web/incidents/${incidentId}/photos`), {
                method: 'POST',
                headers: {
                    ...authHeaders,
                    'Content-Type': file.type || 'image/jpeg',
                    'X-File-Name': file.name || `incident_${incidentId}.jpg`,
                },
                body: file,
                credentials,
            });

            const payload = await parseApiResponsePayload(response);

            if (response.status === 401) {
                onUnauthorized();
                throw new Error('No autorizado');
            }

            if (!response.ok) {
                let message = 'Error subiendo foto.';
                if (payload && typeof payload === 'object') {
                    message = payload.error?.message || payload.message || message;
                } else if (typeof payload === 'string' && payload.trim()) {
                    message = payload.trim();
                }
                throw new Error(message);
            }

            if (payload && typeof payload === 'object') {
                return payload;
            }
            return {};
        }

        return {
            request,
            getInstallations(params = {}) {
                const query = new URLSearchParams(params).toString();
                return request(`/web/installations?${query}`);
            },
            getStatistics() {
                return request('/web/statistics');
            },
            getAuditLogs(limit = 100) {
                return request(`/web/audit-logs?limit=${limit}`);
            },
            getIncidents(installationId, options = {}) {
                const query = new URLSearchParams();
                if (options?.includeDeleted === true) {
                    query.set('include_deleted', '1');
                }
                const suffix = query.toString() ? `?${query.toString()}` : '';
                return request(`/web/installations/${installationId}/incidents${suffix}`);
            },
            lookupCode(code, type) {
                const query = new URLSearchParams({
                    code: String(code || '').trim(),
                    type: String(type || '').trim() || 'asset',
                });
                return request(`/web/lookup?${query.toString()}`);
            },
            createRecord(payload) {
                return request('/web/records', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
            },
            updateInstallation(installationId, payload) {
                return request(`/web/installations/${installationId}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload || {}),
                });
            },
            createIncident(installationId, payload) {
                return request(`/web/installations/${installationId}/incidents`, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
            },
            createAssetIncident(assetId, payload) {
                return request(`/web/assets/${assetId}/incidents`, {
                    method: 'POST',
                    body: JSON.stringify(payload || {}),
                });
            },
            deleteIncident(incidentId) {
                return request(`/web/incidents/${incidentId}`, {
                    method: 'DELETE',
                });
            },
            updateIncidentStatus(incidentId, payload) {
                return request(`/web/incidents/${incidentId}/status`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload || {}),
                });
            },
            updateIncidentEvidence(incidentId, payload) {
                return request(`/web/incidents/${incidentId}/evidence`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload || {}),
                });
            },
            getInstallationConformity(installationId) {
                return request(`/web/installations/${installationId}/conformity`);
            },
            createInstallationConformity(installationId, payload) {
                return request(`/web/installations/${installationId}/conformity`, {
                    method: 'POST',
                    body: JSON.stringify(payload || {}),
                });
            },
            getInstallationPublicTrackingLink(installationId) {
                return request(`/web/installations/${installationId}/public-tracking-link`);
            },
            createInstallationPublicTrackingLink(installationId) {
                return request(`/web/installations/${installationId}/public-tracking-link`, {
                    method: 'POST',
                });
            },
            deleteInstallationPublicTrackingLink(installationId) {
                return request(`/web/installations/${installationId}/public-tracking-link`, {
                    method: 'DELETE',
                });
            },
            resolveAsset(payload) {
                return request('/web/assets/resolve', {
                    method: 'POST',
                    body: JSON.stringify(payload || {}),
                });
            },
            getAssets(params = {}) {
                const query = new URLSearchParams(params).toString();
                return request(`/web/assets?${query}`);
            },
            getAssetIncidents(assetId, params = {}) {
                const query = new URLSearchParams(params).toString();
                const suffix = query ? `?${query}` : '';
                return request(`/web/assets/${assetId}/incidents${suffix}`);
            },
            getAssetLoans(assetId, params = {}) {
                const query = new URLSearchParams(params).toString();
                const suffix = query ? `?${query}` : '';
                return request(`/web/assets/${assetId}/loans${suffix}`);
            },
            createAssetLoan(assetId, payload) {
                return request(`/web/assets/${assetId}/loans`, {
                    method: 'POST',
                    body: JSON.stringify(payload || {}),
                });
            },
            returnAssetLoan(loanId, payload) {
                return request(`/web/loans/${loanId}/return`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload || {}),
                });
            },
            updateAsset(assetId, payload) {
                return request(`/web/assets/${assetId}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload || {}),
                });
            },
            deleteAsset(assetId) {
                return request(`/web/assets/${assetId}`, {
                    method: 'DELETE',
                });
            },
            linkAssetToInstallation(assetId, payload) {
                return request(`/web/assets/${assetId}/link-installation`, {
                    method: 'POST',
                    body: JSON.stringify(payload || {}),
                });
            },
            getDrivers(params = {}) {
                const query = new URLSearchParams(params).toString();
                return request(query ? `/web/drivers?${query}` : '/web/drivers');
            },
            uploadDriver,
            deleteDriver(key) {
                const encodedKey = encodeURIComponent(String(key || '').trim());
                return request(`/web/drivers?key=${encodedKey}`, {
                    method: 'DELETE',
                });
            },
            uploadIncidentPhoto,
            getTrendData(params = {}) {
                const query = new URLSearchParams();
                Object.entries(params || {}).forEach(([key, value]) => {
                    if (value === undefined || value === null || value === '') return;
                    query.set(key, String(value));
                });
                const suffix = query.toString();
                return request(suffix ? `/web/statistics/trend?${suffix}` : '/web/statistics/trend');
            },
            login(username, password) {
                return request('/web/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ username, password }),
                });
            },
            getMe() {
                return request('/web/auth/me');
            },
            logout() {
                return request('/web/auth/logout', { method: 'POST' });
            },
        };
    }

    globalScope.DashboardApi = Object.freeze({
        createClient,
    });
})(window);

// Domain: api (HTTP client + web endpoints)

const api = {
    async request(endpoint, options = {}) {
        const baseHeaders = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        const sendRequest = async (useBearer = true) => {
            const authHeaders = useBearer && webAccessToken
                ? { Authorization: 'Bearer ' + webAccessToken }
                : {};
            const headers = {
                ...baseHeaders,
                ...authHeaders,
            };

            const abortController = new AbortController();
            let timeoutId = null;
            let response;
            try {
                const fetchPromise = fetch(API_BASE + endpoint, {
                    ...options,
                    headers,
                    credentials: 'include',
                    signal: abortController.signal,
                });
                const timeoutPromise = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        try {
                            abortController.abort();
                        } catch (_err) {
                            // Best effort abort.
                        }
                        reject(new Error(`Timeout de ${Math.floor(API_REQUEST_TIMEOUT_MS / 1000)}s en ${endpoint}.`));
                    }, API_REQUEST_TIMEOUT_MS);
                });
                response = await Promise.race([fetchPromise, timeoutPromise]);
            } catch (error) {
                if (error?.name === 'AbortError') {
                    throw new Error(
                        `Timeout de ${Math.floor(API_REQUEST_TIMEOUT_MS / 1000)}s en ${endpoint}.`,
                    );
                }
                throw error;
            } finally {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            }
            const payload = await Promise.race([
                parseApiResponsePayload(response),
                new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(
                            new Error(
                                `Timeout de parseo (${Math.floor(API_RESPONSE_PARSE_TIMEOUT_MS / 1000)}s) en ${endpoint}.`,
                            ),
                        );
                    }, API_RESPONSE_PARSE_TIMEOUT_MS);
                }),
            ]);
            return { response, payload };
        };

        let { response, payload } = await sendRequest(true);

        // If bearer got stale (session rotated), retry once using only cookie session.
        if (response.status === 401 && webAccessToken) {
            const retryResult = await sendRequest(false);
            response = retryResult.response;
            payload = retryResult.payload;
            if (response.ok) {
                // Prefer cookie session from now on until next explicit login refreshes bearer.
                webAccessToken = '';
            }
        }
        
        if (response.status === 401) {
            const message = extractApiErrorMessage(payload, response) || 'No autorizado';
            const isAuthEndpoint = endpoint.startsWith('/web/auth/');

            if (isAuthEndpoint) {
                currentUser = null;
                webAccessToken = '';
                closeSSE();
                resetProtectedViews();
                showLogin();
                throw new Error(message);
            }

            webAccessToken = '';
            closeSSE();
            showLogin({ preserveViews: true });
            showNotification(`Sesion requerida en ${endpoint}: ${message}`, 'error');
            throw new Error(`Sesion requerida en ${endpoint}: ${message}`);
        }

        if (!response.ok) {
            throw new Error(extractApiErrorMessage(payload, response));
        }

        if (payload === null) {
            return {};
        }

        return payload;
    },
    
    getInstallations(params = {}) {
        const queryParams = new URLSearchParams(params);
        if (!queryParams.has('compact')) {
            queryParams.set('compact', '1');
        }
        const query = queryParams.toString();
        return this.request('/web/installations?' + query);
    },
    
    getStatistics() {
        return this.request('/web/statistics');
    },
    
    getAuditLogs(limit = 100) {
        return this.request('/web/audit-logs?limit=' + limit);
    },
    
    getIncidents(installationId) {
        return this.request('/web/installations/' + installationId + '/incidents');
    },

    createRecord(payload) {
        return this.request('/web/records', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    },

    createIncident(installationId, payload) {
        return this.request('/web/installations/' + installationId + '/incidents', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    },

    updateIncidentStatus(incidentId, payload) {
        return this.request('/web/incidents/' + incidentId + '/status', {
            method: 'PATCH',
            body: JSON.stringify(payload || {})
        });
    },

    updateIncidentEvidence(incidentId, payload) {
        return this.request('/web/incidents/' + incidentId + '/evidence', {
            method: 'PATCH',
            body: JSON.stringify(payload || {})
        });
    },

    resolveAsset(payload) {
        return this.request('/web/assets/resolve', {
            method: 'POST',
            body: JSON.stringify(payload || {})
        });
    },

    getAssets(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/web/assets?${query}`);
    },

    getAssetIncidents(assetId, params = {}) {
        const query = new URLSearchParams(params).toString();
        const suffix = query ? `?${query}` : '';
        return this.request(`/web/assets/${assetId}/incidents${suffix}`);
    },

    linkAssetToInstallation(assetId, payload) {
        return this.request('/web/assets/' + assetId + '/link-installation', {
            method: 'POST',
            body: JSON.stringify(payload || {})
        });
    },

    getDrivers(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(query ? `/web/drivers?${query}` : '/web/drivers');
    },

    async uploadDriver(file, metadata = {}) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('brand', String(metadata.brand || '').trim());
        formData.append('version', String(metadata.version || '').trim());
        formData.append('description', String(metadata.description || '').trim());

        const sendUpload = async (useBearer = true) => {
            const authHeaders = useBearer && webAccessToken
                ? { Authorization: 'Bearer ' + webAccessToken }
                : {};
            const response = await fetch(API_BASE + '/web/drivers', {
                method: 'POST',
                headers: {
                    ...authHeaders
                },
                body: formData,
                credentials: 'include'
            });
            const payload = await parseApiResponsePayload(response);
            return { response, payload };
        };

        let { response, payload } = await sendUpload(true);
        if (response.status === 401 && webAccessToken) {
            const retryResult = await sendUpload(false);
            response = retryResult.response;
            payload = retryResult.payload;
            if (response.ok) {
                webAccessToken = '';
            }
        }

        if (response.status === 401) {
            const message = extractApiErrorMessage(payload, response) || 'No autorizado';
            webAccessToken = '';
            closeSSE();
            showLogin({ preserveViews: true });
            throw new Error(message);
        }
        if (!response.ok) {
            throw new Error(extractApiErrorMessage(payload, response));
        }

        return payload || {};
    },

    deleteDriver(key) {
        const encodedKey = encodeURIComponent(String(key || '').trim());
        return this.request('/web/drivers?key=' + encodedKey, {
            method: 'DELETE'
        });
    },

    async uploadIncidentPhoto(incidentId, file) {
        const sendUpload = async (useBearer = true) => {
            const authHeaders = useBearer && webAccessToken
                ? { Authorization: 'Bearer ' + webAccessToken }
                : {};
            const response = await fetch(API_BASE + '/web/incidents/' + incidentId + '/photos', {
                method: 'POST',
                headers: {
                    ...authHeaders,
                    'Content-Type': file.type || 'image/jpeg',
                    'X-File-Name': file.name || ('incident_' + incidentId + '.jpg')
                },
                body: file,
                credentials: 'include'
            });
            const payload = await parseApiResponsePayload(response);
            return { response, payload };
        };

        let { response, payload } = await sendUpload(true);
        if (response.status === 401 && webAccessToken) {
            const retryResult = await sendUpload(false);
            response = retryResult.response;
            payload = retryResult.payload;
            if (response.ok) {
                webAccessToken = '';
            }
        }

        if (response.status === 401) {
            const message = extractApiErrorMessage(payload, response) || 'No autorizado';
            webAccessToken = '';
            closeSSE();
            showLogin({ preserveViews: true });
            throw new Error(message);
        }

        if (!response.ok) {
            throw new Error(extractApiErrorMessage(payload, response) || 'Error subiendo foto.');
        }

        return (payload && typeof payload === 'object') ? payload : {};
    },
    
    getTrendData() {
        return this.request('/web/statistics/trend');
    },
    
    login(username, password) {
        return this.request('/web/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    },
    
    getMe() {
        return this.request('/web/auth/me');
    },

    logout() {
        return this.request('/web/auth/logout', { method: 'POST' });
    }
};

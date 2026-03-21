"""
Módulo de Historial de Instalaciones - Versión Cloud con Seguridad Mejorada
Gestiona el historial de instalaciones a través de una API de Cloudflare Worker.

SECURITY IMPROVEMENTS:
- SEC-001: Removed hardcoded production API URL
- SEC-003: Added API authentication with tokens
"""
from collections import Counter
from datetime import datetime, timezone

from core.logger import get_logger
from managers.history_assets_client import HistoryAssetsClient
from managers.history_incidents_client import HistoryIncidentsClient
from managers.history_installations_client import HistoryInstallationsClient
from managers.history_request_adapter import HistoryRequestAdapter

logger = get_logger()


class InstallationHistory:
    """
    Gestor de historial de instalaciones basado en API con seguridad mejorada.
    
    SECURITY FEATURES:
    - No hardcoded URLs
    - API token authentication
    - Request signing with HMAC
    - Timestamp validation to prevent replay attacks
    """
    
    def __init__(self, config_manager):
        """
        Inicializar gestor de historial.
        
        Args:
            config_manager: Una instancia de ConfigManager para obtener la configuración.
        """
        self.config_manager = config_manager
        self.timeout = 10
        self.request_adapter = HistoryRequestAdapter(config_manager, timeout=self.timeout)
        self.installations_client = HistoryInstallationsClient(
            lambda *args, **kwargs: self._make_request(*args, **kwargs)
        )
        self.incidents_client = HistoryIncidentsClient(
            lambda *args, **kwargs: self._make_request(*args, **kwargs)
        )
        self.assets_client = HistoryAssetsClient(
            lambda *args, **kwargs: self._make_request(*args, **kwargs),
            incident_normalizer=self.incidents_client.normalize_incident_lifecycle_fields,
        )
        
        # Inicializar configuración de API

    @property
    def api_url(self):
        return self.request_adapter.api_url

    @api_url.setter
    def api_url(self, value):
        self.request_adapter.api_url = value

    @property
    def api_token(self):
        return self.request_adapter.api_token

    @api_token.setter
    def api_token(self, value):
        self.request_adapter.api_token = value

    @property
    def api_secret(self):
        return self.request_adapter.api_secret

    @api_secret.setter
    def api_secret(self, value):
        self.request_adapter.api_secret = value

    @property
    def api_tenant_id(self):
        return self.request_adapter.api_tenant_id

    @api_tenant_id.setter
    def api_tenant_id(self, value):
        self.request_adapter.api_tenant_id = value

    @property
    def web_token_provider(self):
        return self.request_adapter.web_token_provider

    @web_token_provider.setter
    def web_token_provider(self, value):
        self.request_adapter.web_token_provider = value

    @property
    def web_auth_failure_handler(self):
        return self.request_adapter.web_auth_failure_handler

    @web_auth_failure_handler.setter
    def web_auth_failure_handler(self, value):
        self.request_adapter.web_auth_failure_handler = value

    @property
    def allow_unsigned_requests(self):
        return self.request_adapter.allow_unsigned_requests

    @allow_unsigned_requests.setter
    def allow_unsigned_requests(self, value):
        self.request_adapter.allow_unsigned_requests = value

    def set_web_token_provider(self, token_provider):
        """Registrar proveedor de token web (Bearer) para endpoints /web/*."""
        self.request_adapter.set_web_token_provider(token_provider)

    def set_web_auth_failure_handler(self, failure_handler):
        """Registrar callback para invalidar sesión local cuando el Bearer falle con 401."""
        self.request_adapter.set_web_auth_failure_handler(failure_handler)

    def _notify_web_auth_failure(self, api_detail=""):
        """Notificar al runtime desktop que el Bearer actual quedó inválido."""
        self.request_adapter._notify_web_auth_failure(api_detail)

    def _current_desktop_auth_mode(self):
        """Resolver modo desktop desde env o config persistida."""
        return self.request_adapter._current_desktop_auth_mode()

    def _get_web_access_token(self):
        return self.request_adapter._get_web_access_token()

    def _should_use_web_bearer_mode(self):
        return self.request_adapter._should_use_web_bearer_mode()

    def _requires_web_session(self):
        """Indicate when desktop is configured as web-only but has no active bearer session."""
        return self.request_adapter._requires_web_session()

    def _default_statistics(self):
        """Estructura estándar de estadísticas para mantener compatibilidad."""
        return {
            'total_installations': 0,
            'successful_installations': 0,
            'failed_installations': 0,
            'success_rate': 0,
            'average_time_minutes': 0,
            'unique_clients': 0,
            'top_drivers': {},
            'by_brand': {}
        }

    def _compute_statistics_from_installations(self, installations):
        """Calcular estadísticas base a partir de la lista de instalaciones."""
        normalized_installations = installations or []
        total = len(normalized_installations)
        success = len(
            [inst for inst in normalized_installations if str(inst.get('status', '')).lower() == 'success']
        )
        failed = len(
            [inst for inst in normalized_installations if str(inst.get('status', '')).lower() == 'failed']
        )
        success_rate = round((success / total) * 100, 2) if total else 0

        valid_seconds = []
        for inst in normalized_installations:
            raw_value = inst.get('installation_time_seconds')
            if raw_value in (None, ''):
                continue
            try:
                valid_seconds.append(float(raw_value))
            except (TypeError, ValueError):
                continue

        average_time_minutes = round((sum(valid_seconds) / len(valid_seconds)) / 60, 2) if valid_seconds else 0

        unique_clients = len(
            {
                str(inst.get('client_name')).strip()
                for inst in normalized_installations
                if inst.get('client_name')
            }
        )

        top_drivers_counter = Counter()
        by_brand_counter = Counter()
        for inst in normalized_installations:
            brand = (inst.get('driver_brand') or '').strip()
            version = (inst.get('driver_version') or '').strip()

            if brand:
                by_brand_counter[brand] += 1

            driver_key = f"{brand} {version}".strip()
            if driver_key:
                top_drivers_counter[driver_key] += 1

        return {
            'total_installations': total,
            'successful_installations': success,
            'failed_installations': failed,
            'success_rate': success_rate,
            'average_time_minutes': average_time_minutes,
            'unique_clients': unique_clients,
            'top_drivers': dict(top_drivers_counter),
            'by_brand': dict(by_brand_counter),
        }

    def _normalize_statistics(self, stats, start_date=None, end_date=None):
        """
        Normalizar estadísticas para garantizar todas las claves esperadas.
        Si la API no devuelve datos validos, recalcula desde instalaciones.
        Si devuelve datos parciales, completa faltantes con defaults.
        """
        normalized = self._default_statistics()
        stats_payload = stats if isinstance(stats, dict) else None

        if not stats_payload:
            installations = self.get_installations(start_date=start_date, end_date=end_date)
            return self._compute_statistics_from_installations(installations)

        for key in normalized.keys():
            if key in stats_payload and stats_payload.get(key) is not None:
                normalized[key] = stats_payload.get(key)

        return normalized

    def _parse_iso_datetime(self, value):
        """Parsear datetime ISO de forma tolerante y normalizarlo a UTC naive."""
        if not value:
            return None

        if isinstance(value, datetime):
            parsed = value
        else:
            raw = str(value).strip()
            if raw.endswith('Z'):
                raw = f"{raw[:-1]}+00:00"
            try:
                parsed = datetime.fromisoformat(raw)
            except ValueError:
                return None

        if parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed

    def _apply_local_filters(
        self,
        installations,
        limit=None,
        client_name=None,
        brand=None,
        status=None,
        start_date=None,
        end_date=None,
    ):
        """
        Aplicar filtros localmente como fallback cuando el Worker no soporta
        parámetros de consulta (o los ignora).
        """
        items = installations or []
        filtered = []

        start_dt = self._parse_iso_datetime(start_date)
        end_dt = self._parse_iso_datetime(end_date)

        client_filter = str(client_name).strip().casefold() if client_name else None
        brand_filter = str(brand).strip().casefold() if brand else None
        status_filter = str(status).strip().casefold() if status else None

        for inst in items:
            if client_filter:
                current_client = str(inst.get('client_name') or '').strip().casefold()
                if client_filter not in current_client:
                    continue

            if brand_filter:
                current_brand = str(inst.get('driver_brand') or '').strip().casefold()
                if current_brand != brand_filter:
                    continue

            if status_filter:
                current_status = str(inst.get('status') or '').strip().casefold()
                if current_status != status_filter:
                    continue

            if start_dt or end_dt:
                ts = self._parse_iso_datetime(inst.get('timestamp'))
                if ts is None:
                    continue
                if start_dt and ts < start_dt:
                    continue
                # Rango semiclosed [start, end) para evitar incluir el primer instante del mes siguiente.
                if end_dt and ts >= end_dt:
                    continue

            filtered.append(inst)

        if limit:
            try:
                limit_val = int(limit)
                if limit_val > 0:
                    return filtered[:limit_val]
            except (TypeError, ValueError):
                pass

        return filtered

    def _initialize_api_config(self):
        """
        Inicializar configuración de API de forma segura.
        
        SECURITY: Valida que todos los parámetros necesarios estén presentes.
        """
        self.request_adapter._initialize_api_config()
    
    def _get_api_url(self):
        """
        Obtiene la URL de la API desde configuración.
        
        SECURITY FIX (SEC-001): No hardcoded fallback URL.
        Si la configuración falla, la aplicación debe ser reconfigurada.
        
        Returns:
            str: API URL
            
        Raises:
            ConnectionError: Si la URL no está configurada
        """
        return self.request_adapter._get_api_url()

        # Detectar entorno de testing
        if "PYTEST_CURRENT_TEST" in os.environ or "unittest" in sys.modules:
            config = self.config_manager.load_config_data()
            return config.get('api_url', '').rstrip('/') if config else ''
        
        # Si ya se cargó en inicialización, usar ese
        if self.api_url:
            return self.api_url
        
        # Intentar cargar desde ConfigManager
        try:
            config = self.config_manager.load_config_data()
            if config and config.get('api_url'):
                api_url = config.get('api_url').rstrip('/')
                logger.debug(f"API URL loaded from config: {api_url[:30]}...")
                self.api_url = api_url
                return api_url
        except Exception as e:
            logger.error(f"Failed to load API URL from config: {e}")
        
        # No usar fallback hardcodeado para la URL de API.
        logger.critical(
            "API URL not configured. Application requires reconfiguration.",
            severity='CRITICAL'
        )
        raise ConnectionError(
            "❌ API URL no configurada.\n\n"
            "Por favor, configura las credenciales de Cloudflare "
            "en la pestaña de Administración.\n\n"
            "Si eres super_admin, ve a:\n"
            "Administración > Configuración de Cloudflare R2 > "
            "Campo 'URL de API de Historial'"
        )
    
    def _generate_request_signature(self, method, path, timestamp, body_hash, nonce):
        """
        Generar firma HMAC para solicitudes legacy privadas.
        
        SECURITY IMPROVEMENT (SEC-003): Request signing to prevent tampering.
        
        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint
            timestamp: Unix timestamp
            body: Request body (for POST/PUT)
            
        Returns:
            str: HMAC signature
        """
        return self.request_adapter._generate_request_signature(
            method,
            path,
            timestamp,
            body_hash,
            nonce,
        )

        if not self.api_secret:
            return None
        
        # Canonical string (alineado con worker.js):
        # METHOD|/path|timestamp|sha256(body_bytes)|nonce
        message = f"{method.upper()}|{path}|{timestamp}|{body_hash}|{nonce}"
        
        # Generar HMAC-SHA256
        signature = hmac.new(
            self.api_secret.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        
        return signature

    def _generate_request_nonce(self):
        """Generar nonce unico por request para prevenir replay."""
        return self.request_adapter._generate_request_nonce()

        return secrets.token_urlsafe(18)
    
    def _get_headers(self, method='GET', path='/', body_hash=''):
        """
        Generar headers con autenticación legacy HMAC.
        
        SECURITY IMPROVEMENT (SEC-003): Added authentication headers.
        
        Args:
            method: HTTP method
            endpoint: API endpoint
            body: Request body
            
        Returns:
            dict: Headers con autenticación
        """
        return self.request_adapter._get_headers(method, path, body_hash)

        if not body_hash:
            body_hash = self._sha256_hex(b"")

        headers = {
            'Content-Type': 'application/json',
            'X-Body-SHA256': body_hash,
        }
        
        # Si hay autenticación configurada, agregar headers
        if self.api_token and self.api_secret:
            timestamp = int(time.time())
            nonce = self._generate_request_nonce()
            signature = self._generate_request_signature(method, path, timestamp, body_hash, nonce)
            
            headers.update({
                'X-API-Token': self.api_token,
                'X-Request-Timestamp': str(timestamp),
                'X-Request-Signature': signature,
                'X-Request-Nonce': nonce,
            })
            if self.api_tenant_id:
                headers['X-Tenant-Id'] = self.api_tenant_id
        
        return headers

    def _serialize_json_body(self, body):
        """Serializar body JSON de forma determinista para hash/firma/envío."""
        return self.request_adapter._serialize_json_body(body)

        if body is None:
            return ""
        return json.dumps(body, separators=(',', ':'), ensure_ascii=False)

    def _sha256_hex(self, raw_text):
        """Hash SHA-256 hexadecimal de texto UTF-8."""
        return self.request_adapter._sha256_hex(raw_text)

        if raw_text is None:
            raw_text = ""
        if isinstance(raw_text, bytes):
            payload = raw_text
        else:
            payload = str(raw_text).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()

    def _validate_record_id(self, record_id):
        """Validar y normalizar IDs de registros antes de construir endpoints."""
        raw_id = str(record_id).strip()
        if not raw_id.isdigit():
            raise ValueError(f"ID inválido: {record_id}")
        return int(raw_id)
    
    def _make_request(
        self,
        method,
        endpoint,
        params=None,
        expect_json=True,
        extra_headers=None,
        **kwargs,
    ):
        """
        Realizar solicitud HTTP con autenticación y validación.
        
        SECURITY IMPROVEMENTS:
        - SEC-001: No hardcoded URLs, raises error if not configured
        - SEC-003: Added authentication via tokens and HMAC signatures
        
        Args:
            method: HTTP method
            endpoint: API endpoint
            params: Query parameters
            **kwargs: Additional arguments for requests
            
        Returns:
            Response JSON or None
            
        Raises:
            ConnectionError: Si hay error de conexión o configuración
        """
        return self.request_adapter._make_request(
            method,
            endpoint,
            params=params,
            expect_json=expect_json,
            extra_headers=extra_headers,
            **kwargs,
        )

        worker_url = self._get_api_url()
        
        if not worker_url:
            raise ConnectionError(
                "La URL del Worker (API) no está configurada. "
                "Por favor, configura las credenciales de Cloudflare."
            )
        
        endpoint_clean = str(endpoint or "").lstrip("/")
        auth_mode = self._current_desktop_auth_mode()
        web_mode_active = auth_mode in {"web", "auto"}
        web_access_token = self._get_web_access_token()
        use_web_bearer_mode = self._should_use_web_bearer_mode()

        if web_mode_active and auth_mode == "web" and not web_access_token:
            raise ConnectionError(
                "❌ No hay sesión web activa para consumir la API.\n\n"
                "Inicia sesión nuevamente para operar en modo web."
            )

        if use_web_bearer_mode and endpoint_clean and not endpoint_clean.startswith("web/"):
            endpoint_clean = f"web/{endpoint_clean}"

        url = f"{worker_url}/{endpoint_clean}"
        path = f"/{endpoint_clean}"

        # Si llega JSON, serializarlo manualmente para asegurar hash/firma idénticos al payload enviado.
        body_bytes = b""
        if 'json' in kwargs:
            json_payload = kwargs.pop('json')
            serialized_body = self._serialize_json_body(json_payload)
            body_bytes = serialized_body.encode("utf-8")
            kwargs['data'] = body_bytes
        elif isinstance(kwargs.get('data'), bytes):
            body_bytes = kwargs.get('data')
        elif isinstance(kwargs.get('data'), str):
            body_bytes = kwargs.get('data').encode("utf-8")
            kwargs['data'] = body_bytes
        elif kwargs.get('data') is not None:
            body_bytes = str(kwargs.get('data')).encode("utf-8")
            kwargs['data'] = body_bytes

        body_hash = self._sha256_hex(body_bytes)

        # Generar headers según modo de autenticación activo.
        if use_web_bearer_mode:
            headers = {
                "Authorization": f"Bearer {web_access_token}",
            }
            if "json" in kwargs or kwargs.get("data") is not None:
                headers["Content-Type"] = "application/json"
            if extra_headers:
                headers.update(extra_headers)
        else:
            headers = self._get_headers(method, path, body_hash)
            if extra_headers:
                headers.update(extra_headers)
            if not self.allow_unsigned_requests:
                missing_auth_headers = [
                    header_name
                    for header_name in (
                        "X-API-Token",
                        "X-Request-Timestamp",
                        "X-Request-Signature",
                        "X-Request-Nonce",
                    )
                    if not headers.get(header_name)
                ]
                if missing_auth_headers:
                    if auth_mode == "auto":
                        raise ConnectionError(
                            "❌ Autenticación desktop no configurada para modo auto.\n\n"
                            "Activa una sesión web para usar /web/* o configura "
                            "DRIVER_MANAGER_API_TOKEN y DRIVER_MANAGER_API_SECRET para rutas legacy privadas.\n"
                            "Para debug local únicamente, habilita DRIVER_MANAGER_ALLOW_UNSIGNED_REQUESTS=true."
                        )
                    raise ConnectionError(
                        "❌ Autenticación API legacy no configurada para desktop.\n\n"
                        "Configura DRIVER_MANAGER_API_TOKEN y DRIVER_MANAGER_API_SECRET (o config.enc).\n"
                        "Para debug local únicamente, habilita DRIVER_MANAGER_ALLOW_UNSIGNED_REQUESTS=true."
                    )
        
        try:
            response = requests.request(
                method,
                url,
                headers=headers,
                params=params,
                timeout=self.timeout,
                **kwargs
            )
            response.raise_for_status()
            if expect_json:
                return response.json() if response.content else None
            return response
            
        except requests.exceptions.Timeout:
            logger.error(f"Request timeout: {url}")
            raise ConnectionError(f"Timeout al conectar con la API: {url}")
            
        except requests.exceptions.ConnectionError as e:
            logger.error(f"Connection error: {e}")
            raise ConnectionError(f"Error de conexión con la API: {str(e)}")
            
        except requests.exceptions.HTTPError as e:
            # Manejar errores de autenticación específicamente
            if e.response.status_code == 401:
                api_detail = ""
                try:
                    payload = e.response.json()
                    api_detail = payload.get("error", {}).get("message", "")
                except Exception:
                    api_detail = (e.response.text or "").strip()[:200]

                logger.error(
                    "API authentication failed (401 Unauthorized)",
                    api_detail=api_detail or "N/A"
                )

                detail_line = f"\nDetalle API: {api_detail}" if api_detail else ""
                if use_web_bearer_mode:
                    self._notify_web_auth_failure(api_detail)
                    web_session_error = (
                        "[ERROR] La sesion web de la API ya no es valida.\n\n"
                        "Inicia sesion nuevamente para continuar."
                        f"{detail_line}"
                    )
                    raise ConnectionError(web_session_error)
                    raise ConnectionError(
                        "âŒ La sesiÃ³n web de la API ya no es vÃ¡lida.\n\n"
                        "Inicia sesiÃ³n nuevamente para continuar."
                        f"{detail_line}"
                    )
                raise ConnectionError(
                    "❌ Autenticación fallida con la API.\n\n"
                    "Las credenciales de API pueden estar incorrectas o expiradas.\n"
                    "Contacta al super_admin para verificar la configuración."
                    f"{detail_line}"
                )
            elif e.response.status_code == 403:
                logger.error("API access forbidden (403 Forbidden)")
                raise ConnectionError(
                    "❌ Acceso denegado a la API.\n\n"
                    "Tu cuenta no tiene permisos para realizar esta operación."
                )
            else:
                logger.error(f"HTTP error: {e}")
                raise ConnectionError(f"Error HTTP {e.response.status_code}: {str(e)}")
            
        except Exception as e:
            logger.error(f"Unexpected error in API request: {e}", exc_info=True)
            raise ConnectionError(f"Error inesperado al conectar con la API: {str(e)}")
    
    def add_installation(self, **kwargs):
        """
        Añadir una nueva instalación y sincronizarla a la nube.
        Acepta argumentos clave-valor para compatibilidad.
        
        Args:
            **kwargs: Datos de instalación (driver_brand, driver_version, etc.)
            
        Returns:
            bool: True si se sincronizó exitosamente, False si solo se guardó local
        """
        installation_data = kwargs
        
        payload = self.installations_client.build_installation_payload(installation_data)
        self._save_local(payload)

        try:
            self.installations_client.create_installation(payload)
            logger.info("Installation record synced to cloud successfully")
            return True
            
        except ConnectionError as e:
            logger.warning(f"Could not sync to cloud: {e}")
            return False

    def create_manual_record(self, **kwargs):
        """
        Crear registro manual (sin requerir instalación previa de driver).

        Args:
            **kwargs: Datos opcionales del registro.

        Returns:
            tuple: (success: bool, record: dict | None)
        """
        record_data = kwargs

        payload = self.installations_client.build_manual_record_payload(record_data)
        self._save_local(payload)

        try:
            _saved_payload, record = self.installations_client.create_manual_record(payload)
            return True, record
        except ConnectionError as e:
            logger.warning(f"Could not create manual record in cloud: {e}")
            return False, None
    
    def _save_local(self, installation_data):
        """Guardar instalación localmente (placeholder)"""
        logger.debug(f"Saving installation locally: {installation_data}")
    
    def get_installations(self, limit=None, client_name=None, brand=None,
                          status=None, start_date=None, end_date=None):
        """
        Obtener historial de instalaciones desde la API con filtros.
        
        Args:
            limit: Limitar número de resultados
            client_name: Filtrar por nombre de cliente
            brand: Filtrar por marca
            status: Filtrar por estado
            start_date: Fecha inicio (ISO format)
            end_date: Fecha fin (ISO format)
            
        Returns:
            list: Lista de instalaciones
        """
        params = {}
        if limit:
            params['limit'] = limit
        if client_name:
            params['client_name'] = client_name
        if brand:
            params['brand'] = brand
        if status:
            params['status'] = status
        if start_date:
            params['start_date'] = start_date
        if end_date:
            params['end_date'] = end_date

        if self._requires_web_session():
            return []

        try:
            installations = self.installations_client.list_installations(params=params)
            return self._apply_local_filters(
                installations,
                limit=limit,
                client_name=client_name,
                brand=brand,
                status=status,
                start_date=start_date,
                end_date=end_date,
            )
        except ConnectionError as e:
            logger.error(f"Could not retrieve installation history: {e}")
            return []
    
    def get_installation_by_id(self, record_id):
        """
        Obtener una instalación por su ID desde la API.
        
        Args:
            record_id: ID del registro
            
        Returns:
            dict or None: Registro de instalación
        """
        try:
            normalized_record_id = self._validate_record_id(record_id)
        except ValueError as e:
            logger.warning(f"Invalid installation ID: {record_id} ({e})")
            return None

        try:
            return self.installations_client.get_installation_by_id(normalized_record_id)
        except ConnectionError as e:
            if "HTTP 404" in str(e):
                logger.warning(f"Installation {normalized_record_id} not found.")
                return None
            logger.error(f"Could not retrieve installation {normalized_record_id}: {e}")
            return None
        except Exception as e:
            logger.error(f"Could not retrieve installation {normalized_record_id}: {e}")
            return None
    
    def update_installation_details(self, record_id, notes, time_seconds):
        """
        Actualizar los detalles de un registro de instalación vía API.
        
        Args:
            record_id: ID del registro
            notes: Notas actualizadas
            time_seconds: Tiempo de instalación en segundos
            
        Returns:
            bool: True si se actualizó exitosamente
        """
        logger.operation_start("update_installation_details_cloud", record_id=record_id)
        try:
            normalized_record_id = self._validate_record_id(record_id)
        except ValueError as e:
            logger.error(f"Invalid installation ID for update: {record_id} ({e})")
            logger.operation_end("update_installation_details_cloud", success=False, reason=str(e))
            return False
        
        try:
            self.installations_client.update_installation_details(
                normalized_record_id,
                notes,
                time_seconds,
            )
            logger.operation_end("update_installation_details_cloud", success=True)
            return True
        except ConnectionError as e:
            logger.error(f"Failed to update installation {normalized_record_id}: {e}")
            return False
    
    def delete_installation(self, record_id):
        """
        Eliminar un registro de instalación por su ID vía API.
        
        Args:
            record_id: ID del registro
            
        Returns:
            bool: True si se eliminó exitosamente
        """
        logger.operation_start("delete_installation_cloud", record_id=record_id)
        try:
            normalized_record_id = self._validate_record_id(record_id)
        except ValueError as e:
            logger.error(f"Invalid installation ID for delete: {record_id} ({e})")
            logger.operation_end("delete_installation_cloud", success=False, reason=str(e))
            return False
        
        try:
            self.installations_client.delete_installation(normalized_record_id)
            logger.operation_end("delete_installation_cloud", success=True)
            return True
        except ConnectionError as e:
            logger.error(f"Failed to delete installation {normalized_record_id}: {e}")
            return False

    def _guess_image_content_type(self, file_path):
        """Determinar content type de imagen por extensión."""
        return self.incidents_client.guess_image_content_type(file_path)

    def get_incidents_for_installation(self, installation_id):
        """Listar incidencias (con fotos) asociadas a una instalación."""
        normalized_id = self._validate_record_id(installation_id)
        return self.incidents_client.list_incidents_for_installation(normalized_id)

    def _normalize_incident_lifecycle_fields(self, incident):
        """Garantizar estructura estable de lifecycle para incidencias."""
        return self.incidents_client.normalize_incident_lifecycle_fields(incident)

    def create_incident(
        self,
        installation_id,
        note,
        severity="medium",
        reporter_username="desktop",
        time_adjustment_seconds=0,
        apply_to_installation=False,
        source="desktop",
    ):
        """Crear incidencia para una instalación existente."""
        normalized_id = self._validate_record_id(installation_id)
        payload = self.incidents_client.build_create_incident_payload(
            note=note,
            severity=severity,
            reporter_username=reporter_username,
            time_adjustment_seconds=time_adjustment_seconds,
            apply_to_installation=apply_to_installation,
            source=source,
        )
        return self.incidents_client.create_incident(normalized_id, payload)

    def update_incident_status(
        self,
        incident_id,
        incident_status,
        resolution_note="",
        reporter_username="desktop",
    ):
        """Actualizar estado de ciclo de vida de una incidencia."""
        normalized_incident_id = self._validate_record_id(incident_id)
        payload = self.incidents_client.build_update_incident_status_payload(
            incident_status=incident_status,
            resolution_note=resolution_note,
            reporter_username=reporter_username,
        )
        return self.incidents_client.update_incident_status(normalized_incident_id, payload)

    def upload_incident_photo(self, incident_id, file_path):
        """Subir foto de evidencia a una incidencia."""
        normalized_incident_id = self._validate_record_id(incident_id)
        return self.incidents_client.upload_incident_photo(normalized_incident_id, file_path)

    def get_photo_content(self, photo_id):
        """Descargar bytes de una foto de incidencia para mostrarla en UI."""
        normalized_photo_id = self._validate_record_id(photo_id)
        return self.incidents_client.get_photo_content(normalized_photo_id)

    def resolve_asset(self, external_code, **kwargs):
        """
        Buscar o crear un equipo por código externo.

        Args:
            external_code: Código externo del equipo (QR/serie)
            **kwargs: Campos opcionales (serial_number, model, client_name, notes, status)

        Returns:
            dict | None: Registro del asset resuelto.
        """
        payload = self.assets_client.build_resolve_asset_payload(external_code, **kwargs)
        return self.assets_client.resolve_asset(payload)


    def get_assets(self, limit=100, search=None, brand=None, status=None, code=None):
        """
        Listar equipos desde la API.

        Args:
            limit: maximo de registros a devolver.
            search: busqueda libre por codigo/marca/modelo/serie/cliente.
            brand: filtro exacto de marca.
            status: filtro de estado.
            code: filtro exacto de codigo externo.

        Returns:
            list: equipos encontrados.
        """
        return self.assets_client.list_assets(
            limit=limit,
            search=search,
            brand=brand,
            status=status,
            code=code,
        )

    def get_asset_by_id(self, asset_id):
        """
        Obtener un equipo por ID.

        Args:
            asset_id: ID numerico del equipo.

        Returns:
            dict | None: equipo encontrado.
        """
        normalized_asset_id = self._validate_record_id(asset_id)
        try:
            return self.assets_client.get_asset_by_id(normalized_asset_id)
        except ConnectionError as error:
            if "HTTP 404" in str(error):
                return None
            raise

    def save_asset(self, external_code, **kwargs):
        """
        Guardar/actualizar equipo usando resolucion por codigo externo.
        Usa update_existing=True para persistir cambios en campos del equipo.

        Args:
            external_code: codigo externo unico del equipo.
            **kwargs: brand, serial_number, model, client_name, notes, status.

        Returns:
            dict | None: equipo persistido.
        """
        return self.assets_client.save_asset(external_code, **kwargs)

    def get_asset_incidents(self, asset_id, limit=100):
        """
        Obtener detalle extendido de equipo (vinculos + incidencias + fotos).

        Args:
            asset_id: ID numerico del equipo.
            limit: maximo de incidencias.

        Returns:
            dict: estructura con keys asset, active_link, links, incidents.
        """
        normalized_asset_id = self._validate_record_id(asset_id)
        return self.assets_client.get_asset_incidents(normalized_asset_id, limit=limit)

    def delete_asset(self, asset_id):
        """
        Eliminar un equipo por ID.

        Args:
            asset_id: ID numerico del equipo.

        Returns:
            bool: True si se elimino correctamente.
        """
        normalized_asset_id = self._validate_record_id(asset_id)
        return self.assets_client.delete_asset(normalized_asset_id)

    def link_asset_to_installation(self, asset_id, installation_id, notes=""):
        """
        Asociar un equipo a una instalación.

        Args:
            asset_id: ID numérico del equipo.
            installation_id: ID numérico de la instalación.
            notes: Nota opcional de asociación.

        Returns:
            dict | None: Registro de vínculo creado/activo.
        """
        normalized_asset_id = self._validate_record_id(asset_id)
        normalized_installation_id = self._validate_record_id(installation_id)
        return self.assets_client.link_asset_to_installation(
            normalized_asset_id,
            normalized_installation_id,
            notes=notes,
        )

    def associate_asset_with_installation(self, external_code, installation_id, notes=""):
        """
        Resolver (buscar/crear) asset por código y asociarlo a una instalación.

        Args:
            external_code: Código externo del equipo.
            installation_id: ID de instalación destino.
            notes: Nota opcional de vínculo.

        Returns:
            tuple(dict | None, dict | None): (asset, link)
        """
        normalized_installation_id = self._validate_record_id(installation_id)
        return self.assets_client.associate_asset_with_installation(
            external_code,
            normalized_installation_id,
            notes=notes,
        )
    
    def get_statistics(self, start_date=None, end_date=None):
        """
        Obtiene las estadísticas desde la base de datos D1.
        
        Args:
            start_date: Fecha inicio opcional
            end_date: Fecha fin opcional
            
        Returns:
            dict: Estadísticas de instalaciones
        """
        params = {}
        if start_date:
            params['start_date'] = start_date
        if end_date:
            params['end_date'] = end_date

        if self._requires_web_session():
            return self._default_statistics()

        try:
            stats = self.installations_client.get_statistics(params=params)
            return self._normalize_statistics(stats, start_date=start_date, end_date=end_date)
        except Exception as e:
            logger.error(f"Error retrieving statistics: {e}")
            try:
                installations = self.get_installations(start_date=start_date, end_date=end_date)
                return self._compute_statistics_from_installations(installations)
            except Exception as fallback_error:
                logger.error(f"Error computing fallback statistics: {fallback_error}")

        # Fallback final: devolver estructura vacía
        return self._default_statistics()
    
    def get_client_history(self, client_name):
        """
        Obtener historial de un cliente específico.
        
        Args:
            client_name: Nombre del cliente
            
        Returns:
            dict: Historial del cliente
        """
        logger.warning("get_client_history returns simplified data. Full logic should be server-side.")
        installations = self.get_installations(client_name=client_name)
        return {
            'client': None,
            'installations': installations,
            'notes': []
        }
    
    def get_all_clients(self):
        """Obtener todos los clientes (placeholder)"""
        logger.warning("get_all_clients not implemented in worker.")
        return []
    
    def clear_history(self, older_than_days=None):
        """Limpiar historial (operación peligrosa, no implementada)"""
        logger.warning("clear_history not implemented. Dangerous operation.")
        return 0

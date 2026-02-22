"""
Módulo de Historial de Instalaciones - Versión Cloud con Seguridad Mejorada
Gestiona el historial de instalaciones a través de una API de Cloudflare Worker.

SECURITY IMPROVEMENTS:
- SEC-001: Removed hardcoded production API URL
- SEC-003: Added API authentication with tokens
"""
import os
import sys
import platform
import hmac
import hashlib
import time
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests

from core.logger import get_logger

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
        self.api_url = None
        self.api_token = None
        self.api_secret = None
        self.timeout = 10
        
        # Inicializar configuración de API
        self._initialize_api_config()

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
        Si llegan parciales desde la API, completa desde instalaciones.
        """
        normalized = self._default_statistics()
        stats_payload = stats if isinstance(stats, dict) else {}
        for key in normalized.keys():
            if key in stats_payload and stats_payload.get(key) is not None:
                normalized[key] = stats_payload.get(key)

        missing_main_keys = any(
            key not in stats_payload or stats_payload.get(key) is None
            for key in ['total_installations', 'successful_installations', 'failed_installations']
        )

        if missing_main_keys:
            installations = self.get_installations(start_date=start_date, end_date=end_date)
            computed = self._compute_statistics_from_installations(installations)

            for key in normalized.keys():
                if key not in stats_payload or stats_payload.get(key) is None:
                    normalized[key] = computed[key]

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

    def _read_env_file(self, env_path: Path):
        """Leer variables clave=valor desde archivo .env (sin dependencias externas)."""
        data = {}
        if not env_path.exists():
            return data

        try:
            for raw in env_path.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                data[key.strip()] = value.strip().strip('"').strip("'")
        except Exception as error:
            logger.warning(f"No se pudo leer .env en {env_path}: {error}")

        return data

    def _is_test_environment(self):
        """Detectar ejecución de tests para mantener comportamiento determinista."""
        return "PYTEST_CURRENT_TEST" in os.environ or "unittest" in sys.modules
    
    def _initialize_api_config(self):
        """
        Inicializar configuración de API de forma segura.
        
        SECURITY: Valida que todos los parámetros necesarios estén presentes.
        """
        try:
            config = self.config_manager.load_config_data()
            
            if not config:
                logger.warning("No configuration found for API initialization")
                config = {}
            
            # Validar y cargar URL
            local_env = {} if self._is_test_environment() else self._read_env_file(Path("mobile-app/.env"))
            api_url = (
                config.get('api_url')
                or config.get('history_api_url', '')
                or os.getenv("DRIVER_MANAGER_HISTORY_API_URL", "")
                or local_env.get("EXPO_PUBLIC_API_BASE_URL", "")
            )
            if api_url:
                self.api_url = api_url.rstrip('/')
                logger.info(f"API URL configured: {self.api_url[:30]}...")
            
            # Cargar credenciales de autenticación (config cifrada o variables de entorno)
            self.api_token = (
                config.get('api_token')
                or os.getenv("DRIVER_MANAGER_API_TOKEN")
                or local_env.get("EXPO_PUBLIC_API_TOKEN")
            )
            self.api_secret = (
                config.get('api_secret')
                or os.getenv("DRIVER_MANAGER_API_SECRET")
                or local_env.get("EXPO_PUBLIC_API_SECRET")
            )
            
            if self.api_token and self.api_secret:
                logger.info("API authentication configured successfully")
            else:
                logger.warning(
                    "API authentication not configured. "
                    "Requests will be sent without authentication."
                )
                
        except Exception as e:
            logger.error(f"Failed to initialize API config: {e}", exc_info=True)
    
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
        
        # SECURITY FIX: No hardcoded fallback
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
    
    def _generate_request_signature(self, method, path, timestamp, body_hash):
        """
        Generar firma HMAC para la solicitud.
        
        SECURITY IMPROVEMENT (SEC-003): Request signing to prevent tampering.
        
        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint
            timestamp: Unix timestamp
            body: Request body (for POST/PUT)
            
        Returns:
            str: HMAC signature
        """
        if not self.api_secret:
            return None
        
        # Canonical string (alineado con worker.js):
        # METHOD|/path|timestamp|sha256(body_bytes)
        message = f"{method.upper()}|{path}|{timestamp}|{body_hash}"
        
        # Generar HMAC-SHA256
        signature = hmac.new(
            self.api_secret.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        
        return signature
    
    def _get_headers(self, method='GET', path='/', body_hash=''):
        """
        Generar headers con autenticación.
        
        SECURITY IMPROVEMENT (SEC-003): Added authentication headers.
        
        Args:
            method: HTTP method
            endpoint: API endpoint
            body: Request body
            
        Returns:
            dict: Headers con autenticación
        """
        headers = {'Content-Type': 'application/json'}
        
        # Si hay autenticación configurada, agregar headers
        if self.api_token and self.api_secret:
            timestamp = int(time.time())
            signature = self._generate_request_signature(method, path, timestamp, body_hash)
            
            headers.update({
                'X-API-Token': self.api_token,
                'X-Request-Timestamp': str(timestamp),
                'X-Request-Signature': signature
            })
        
        return headers

    def _serialize_json_body(self, body):
        """Serializar body JSON de forma determinista para hash/firma/envío."""
        if body is None:
            return ""
        return json.dumps(body, separators=(',', ':'), ensure_ascii=False)

    def _sha256_hex(self, raw_text):
        """Hash SHA-256 hexadecimal de texto UTF-8."""
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
    
    def _make_request(self, method, endpoint, params=None, **kwargs):
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
        worker_url = self._get_api_url()
        
        if not worker_url:
            raise ConnectionError(
                "La URL del Worker (API) no está configurada. "
                "Por favor, configura las credenciales de Cloudflare."
            )
        
        url = f"{worker_url}/{endpoint}"
        
        path = f"/{endpoint.lstrip('/')}"

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

        # Generar headers con autenticación
        headers = self._get_headers(method, path, body_hash)
        
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
            return response.json() if response.content else None
            
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
        
        # 1. Guardar localmente (por ahora solo log)
        self._save_local(installation_data)
        
        # 2. Enviar a la nube (Cloudflare D1)
        try:
            payload = {
                "timestamp": installation_data.get("timestamp") or datetime.now().isoformat(),
                "driver_brand": installation_data.get("driver_brand") or installation_data.get("brand"),
                "driver_version": installation_data.get("driver_version") or installation_data.get("version"),
                "status": installation_data.get("status"),
                "client_name": installation_data.get("client_name") or installation_data.get("client", "Desconocido"),
                "driver_description": installation_data.get("driver_description") or installation_data.get("description", ""),
                "installation_time_seconds": installation_data.get("installation_time") or installation_data.get("time_seconds", 0),
                "os_info": installation_data.get("os_info") or platform.system(),
                "notes": installation_data.get("notes") or installation_data.get("error_message", "")
            }
            
            self._make_request('post', 'installations', json=payload)
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

        payload = {
            "timestamp": record_data.get("timestamp") or datetime.now().isoformat(),
            "driver_brand": record_data.get("driver_brand") or record_data.get("brand") or "N/A",
            "driver_version": record_data.get("driver_version") or record_data.get("version") or "N/A",
            "status": record_data.get("status") or "manual",
            "client_name": record_data.get("client_name") or record_data.get("client") or "Sin cliente",
            "driver_description": record_data.get("driver_description") or record_data.get("description") or "Registro manual",
            "installation_time_seconds": record_data.get("installation_time_seconds")
            or record_data.get("installation_time")
            or record_data.get("time_seconds")
            or 0,
            "os_info": record_data.get("os_info") or platform.system(),
            "notes": record_data.get("notes") or "",
        }

        self._save_local(payload)

        try:
            response = self._make_request("post", "records", json=payload)
            if isinstance(response, dict):
                return True, response.get("record")
            return True, None
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
        
        try:
            installations = self._make_request('get', 'installations', params=params) or []
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
            return self._make_request('get', f'installations/{normalized_record_id}')
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
            val_seconds = int(float(time_seconds))
        except (ValueError, TypeError):
            val_seconds = 0
        
        payload = {
            "notes": notes,
            "installation_time_seconds": val_seconds
        }
        
        try:
            self._make_request('put', f'installations/{normalized_record_id}', json=payload)
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
            self._make_request('delete', f'installations/{normalized_record_id}')
            logger.operation_end("delete_installation_cloud", success=True)
            return True
        except ConnectionError as e:
            logger.error(f"Failed to delete installation {normalized_record_id}: {e}")
            return False
    
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
        
        try:
            stats = self._make_request('get', 'statistics', params=params)
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

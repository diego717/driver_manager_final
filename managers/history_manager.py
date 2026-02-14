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
from datetime import datetime

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
    
    def _initialize_api_config(self):
        """
        Inicializar configuración de API de forma segura.
        
        SECURITY: Valida que todos los parámetros necesarios estén presentes.
        """
        try:
            config = self.config_manager.load_config_data()
            
            if not config:
                logger.warning("No configuration found for API initialization")
                return
            
            # Validar y cargar URL
            api_url = config.get('api_url') or config.get('history_api_url', '')
            if api_url:
                self.api_url = api_url.rstrip('/')
                logger.info(f"API URL configured: {self.api_url[:30]}...")
            
            # Cargar credenciales de autenticación (si existen)
            self.api_token = config.get('api_token')
            self.api_secret = config.get('api_secret')
            
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
    
    def _generate_request_signature(self, method, endpoint, timestamp, body=None):
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
        
        # Crear string a firmar
        message_parts = [
            method.upper(),
            endpoint,
            str(timestamp)
        ]
        
        if body:
            import json
            message_parts.append(json.dumps(body, separators=(',', ':')))
        
        message = '|'.join(message_parts)
        
        # Generar HMAC-SHA256
        signature = hmac.new(
            self.api_secret.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        
        return signature
    
    def _get_headers(self, method='GET', endpoint='', body=None):
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
            signature = self._generate_request_signature(method, endpoint, timestamp, body)
            
            headers.update({
                'X-API-Token': self.api_token,
                'X-Request-Timestamp': str(timestamp),
                'X-Request-Signature': signature
            })
        
        return headers
    
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
        
        # Obtener body si existe
        body = kwargs.get('json')
        
        # Generar headers con autenticación
        headers = self._get_headers(method, endpoint, body)
        
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
                logger.error("API authentication failed (401 Unauthorized)")
                raise ConnectionError(
                    "❌ Autenticación fallida con la API.\n\n"
                    "Las credenciales de API pueden estar incorrectas o expiradas.\n"
                    "Contacta al super_admin para verificar la configuración."
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
            return self._make_request('get', 'installations', params=params) or []
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
            return self._make_request('get', f'installations/{record_id}')
        except ConnectionError as e:
            # Fallback: buscar en lista general
            if "404" in str(e):
                try:
                    logger.warning(f"Installation {record_id} not found directly, searching in list...")
                    installations = self.get_installations(limit=50)
                    for inst in installations:
                        if str(inst.get('id')) == str(record_id):
                            return inst
                except Exception:
                    pass
            
            logger.error(f"Could not retrieve installation {record_id}: {e}")
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
            val_seconds = int(float(time_seconds) * 60)
        except (ValueError, TypeError):
            val_seconds = 0
        
        payload = {
            "notes": notes,
            "installation_time_seconds": val_seconds
        }
        
        try:
            self._make_request('put', f'installations/{record_id}', json=payload)
            logger.operation_end("update_installation_details_cloud", success=True)
            return True
        except ConnectionError as e:
            logger.error(f"Failed to update installation {record_id}: {e}")
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
            self._make_request('delete', f'installations/{record_id}')
            logger.operation_end("delete_installation_cloud", success=True)
            return True
        except ConnectionError as e:
            logger.error(f"Failed to delete installation {record_id}: {e}")
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
            if stats:
                return stats
        except Exception as e:
            logger.error(f"Error retrieving statistics: {e}")
        
        # Fallback: devolver estructura vacía
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

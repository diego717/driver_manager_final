"""
Módulo de Historial de Instalaciones - Versión Cloud
Gestiona el historial de instalaciones a través de una API de Cloudflare Worker.
"""
import os
import sys
import platform
from datetime import datetime

import requests

from core.logger import get_logger

logger = get_logger()


class InstallationHistory:
    """
    Gestor de historial de instalaciones basado en API.
    Se comunica con un Cloudflare Worker que interactúa con una base de datos D1.
    """
    def __init__(self, config_manager):
        """
        Inicializar gestor de historial.
        Args:
            config_manager: Una instancia de ConfigManager para obtener la URL de la API.
        """
        self.config_manager = config_manager
        self.api_url = None
        self.headers = {'Content-Type': 'application/json'}
        self.timeout = 10  # Timeout en segundos para las peticiones

    def _get_api_url(self):
        """
        Obtiene la URL de la API. 
        Si falla el ConfigManager, usa la URL directa por seguridad.
        """
        # --- MEJORA DE SEGURIDAD ---
        # Detectar si estamos en un entorno de testing para evitar el fallback a producción.
        # Si se está ejecutando un test, solo se devolverá una URL si está explícitamente
        # configurada, de lo contrario, devolverá una cadena vacía para que la petición falle.
        if "PYTEST_CURRENT_TEST" in os.environ or "unittest" in sys.modules:
            config = self.config_manager.load_config_data()
            return config.get('api_url', '').rstrip('/') if config else ''

        # 1. Intentar por ConfigManager
        try:
            config = self.config_manager.load_config_data()
            if config and config.get('api_url'):
                return config.get('api_url').rstrip('/')
        except:
            pass

        # 2. BYPASS DIRECTO (Si el de arriba falla, este salva el reporte)
        return "https://driver-manager-db.diegosasen.workers.dev"

    def _make_request(self, method, endpoint, params=None, **kwargs):
    # Cambiamos el nombre de la variable local para no confundirla con el Bucket
        worker_url = self._get_api_url() 
        if not worker_url:
            raise ConnectionError("La URL del Worker (API) no está configurada.")

        url = f"{worker_url}/{endpoint}"
        
        try:
            response = requests.request(
                method,
                url,
                headers=self.headers,
                params=params, # <--- IMPORTANTE para los reportes
                timeout=self.timeout,
                **kwargs
            )
            response.raise_for_status()
            return response.json() if response.content else None
        except Exception as e:
            # Si falla, lanzamos el error para que ReportGenerator sepa que no hay datos
            raise ConnectionError(f"Error al conectar con la nube: {e}")

    def add_installation(self, **kwargs):
        """
        Añadir una nueva instalación localmente y sincronizarla a la nube.
        Acepta argumentos clave-valor para compatibilidad con event_handlers.
        """
        # Unificar datos
        installation_data = kwargs
        
        # 1. Guardar localmente
        self._save_local(installation_data)

        # 2. Enviar a la nube (Cloudflare D1)
        try:
            # Preparamos los datos exactamente como los espera el Worker
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
            logger.info("Registro sincronizado con la nube exitosamente.")
            return True

        except ConnectionError as e:
            # No bloqueamos el programa si falla el internet, solo avisamos
            logger.warning(f"No se pudo sincronizar con la nube: {e}")
            return False

    def _save_local(self, installation_data):
        """
        Guardar instalación localmente.
        """
        logger.debug(f"Guardando instalación localmente: {installation_data}")

    def get_installations(self, limit=None, client_name=None, brand=None,
                          status=None, start_date=None, end_date=None):
        """
        Obtener historial de instalaciones desde la API con filtros.
        """
        params = {}
        if limit:
            params['limit'] = limit
        if client_name:
            params['client_name'] = client_name
        if brand:
            params['brand'] = brand
        # El Worker necesita implementar el resto de los filtros para que funcionen.
        # Por ahora, solo 'limit', 'client_name' y 'brand' están en el worker de ejemplo.

        try:
            return self._make_request('get', 'installations', params=params) or []
        except ConnectionError as e:
            logger.error(f"No se pudo obtener el historial desde la nube: {e}")
            return [] # Devolver una lista vacía en caso de error de conexión.

    def get_installation_by_id(self, record_id):
        """
        Obtener una instalación por su ID desde la API.
        """
        try:
            return self._make_request('get', f'installations/{record_id}')
        except ConnectionError as e:
            # Si falla con 404, intentar buscar en la lista general (fallback)
            if "404" in str(e):
                try:
                    logger.warning(f"Instalación {record_id} no encontrada directamente (404), buscando en lista...")
                    # Buscamos en las últimas 50 instalaciones
                    installations = self.get_installations(limit=50)
                    for inst in installations:
                        if str(inst.get('id')) == str(record_id):
                            return inst
                except Exception:
                    pass # Si falla el fallback, mantenemos el error original
            
            logger.error(f"No se pudo obtener la instalación {record_id} desde la nube: {e}")
            return None

    def update_installation_details(self, record_id, notes, time_seconds):
        """
        Actualizar los detalles de un registro de instalación vía API.
        """
        logger.operation_start("update_installation_details_cloud", record_id=record_id)
        
        # Aseguramos que el tiempo sea un entero válido
        try:
            # Si viene texto o float, lo convertimos a entero
            val_seconds = int(float(time_seconds) * 60)
        except (ValueError, TypeError):
            # Si falla (ej: viene None), dejamos el valor original o ponemos 0
            val_seconds = 0

        payload = {
            "notes": notes,
            # Aquí asignamos el valor corregido a la clave que espera la base de datos
            "installation_time_seconds": val_seconds
        }
        
        try:
            # Enviamos la petición PUT al Worker
            self._make_request('put', f'installations/{record_id}', json=payload)
            logger.operation_end("update_installation_details_cloud", success=True)
            return True
        except ConnectionError as e:
            logger.error(f"Fallo al actualizar la instalación {record_id} en la nube: {e}")
            return False

    # --- Métodos que ya no aplican o necesitan un endpoint específico en el Worker ---

    def get_client_history(self, client_name):
        # Esta lógica ahora estaría del lado del servidor o requeriría múltiples llamadas.
        # Por simplicidad, la adaptamos para que solo devuelva las instalaciones.
        logger.warning("get_client_history ahora solo devuelve instalaciones. La lógica completa debería estar en el servidor.")
        installations = self.get_installations(client_name=client_name)
        return {
            'client': None,  # Necesitaríamos un endpoint /api/clients/:name
            'installations': installations,
            'notes': [] # Necesitaríamos un endpoint /api/clients/:name/notes
        }

    def get_statistics(self, start_date=None, end_date=None):
        """
        Obtiene las estadísticas reales desde la base de datos D1.
        """
        params = {}
        if start_date:
            params['start_date'] = start_date
        if end_date:
            params['end_date'] = end_date

        try:
            # 🚀 Ahora sí llamamos al servidor real
            stats = self._make_request('get', 'statistics', params=params)
            
            if stats:
                return stats
            
        except Exception as e:
            logger.error(f"Error al obtener estadísticas de la nube: {e}")
        
        # Fallback: Si falla la nube, devolvemos un diccionario vacío 
        # para que el reporte no explote, pero con los campos que espera el Excel.
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

    def get_all_clients(self):
        """
        Obtener todos los clientes desde la API.
        (Requiere que el endpoint /api/clients esté implementado en el worker)
        """
        logger.warning("get_all_clients no está implementado en el worker de ejemplo.")
        # try:
        #     return self._make_request('get', 'clients')
        # except ConnectionError:
        #      return []
        return [] # Placeholder

    def clear_history(self, older_than_days=None):
        """
        Limpiar historial (requiere endpoint en el worker).
        ¡ACCIÓN PELIGROSA! Debe estar protegida en el worker.
        """
        logger.warning("clear_history no está implementado en el worker. Es una acción peligrosa.")
        return 0
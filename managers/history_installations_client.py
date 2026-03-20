"""
Cliente de dominio para instalaciones/records/statistics.

Extrae armado de payloads y endpoints de InstallationHistory para
mantener el manager como fachada de compatibilidad.
"""

import platform
from datetime import datetime


class HistoryInstallationsClient:
    """Cliente liviano para endpoints de instalaciones y estadisticas."""

    def __init__(self, request_func):
        self._request = request_func

    def build_installation_payload(self, installation_data):
        return {
            "timestamp": installation_data.get("timestamp") or datetime.now().isoformat(),
            "driver_brand": installation_data.get("driver_brand") or installation_data.get("brand"),
            "driver_version": installation_data.get("driver_version") or installation_data.get("version"),
            "status": installation_data.get("status"),
            "client_name": installation_data.get("client_name") or installation_data.get("client", "Desconocido"),
            "driver_description": installation_data.get("driver_description")
            or installation_data.get("description", ""),
            "installation_time_seconds": installation_data.get("installation_time_seconds")
            or installation_data.get("installation_time")
            or installation_data.get("time_seconds", 0),
            "os_info": installation_data.get("os_info") or platform.system(),
            "notes": installation_data.get("notes") or installation_data.get("error_message", ""),
        }
 
    def create_installation(self, installation_data):
        payload = self.build_installation_payload(installation_data)
        self._request("post", "installations", json=payload)
        return payload

    def build_manual_record_payload(self, record_data):
        return {
            "timestamp": record_data.get("timestamp") or datetime.now().isoformat(),
            "driver_brand": record_data.get("driver_brand") or record_data.get("brand") or "N/A",
            "driver_version": record_data.get("driver_version") or record_data.get("version") or "N/A",
            "status": record_data.get("status") or "manual",
            "client_name": record_data.get("client_name") or record_data.get("client") or "Sin cliente",
            "driver_description": record_data.get("driver_description")
            or record_data.get("description")
            or "Registro manual",
            "installation_time_seconds": record_data.get("installation_time_seconds")
            or record_data.get("installation_time")
            or record_data.get("time_seconds")
            or 0,
            "os_info": record_data.get("os_info") or platform.system(),
            "notes": record_data.get("notes") or "",
        }
 
    def create_manual_record(self, record_data):
        payload = self.build_manual_record_payload(record_data)
        response = self._request("post", "records", json=payload)
        if isinstance(response, dict):
            return payload, response.get("record")
        return payload, None

    def list_installations(self, params=None):
        return self._request("get", "installations", params=params) or []

    def get_installation_by_id(self, normalized_record_id):
        return self._request("get", f"installations/{normalized_record_id}")

    def update_installation_details(self, normalized_record_id, notes, time_seconds):
        try:
            val_seconds = int(float(time_seconds))
        except (ValueError, TypeError):
            val_seconds = 0

        payload = {
            "notes": notes,
            "installation_time_seconds": val_seconds,
        }
        self._request("put", f"installations/{normalized_record_id}", json=payload)
        return payload

    def delete_installation(self, normalized_record_id):
        self._request("delete", f"installations/{normalized_record_id}")
        return True

    def get_statistics(self, params=None):
        return self._request("get", "statistics", params=params)

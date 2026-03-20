"""
Cliente de dominio para incidencias y fotos asociadas.
"""

from pathlib import Path


class HistoryIncidentsClient:
    """Cliente liviano para endpoints de incidencias/fotos."""

    def __init__(self, request_func):
        self._request = request_func

    def normalize_incident_lifecycle_fields(self, incident):
        if not isinstance(incident, dict):
            return incident
        normalized = dict(incident)
        status = str(normalized.get("incident_status") or "").strip().lower()
        if status not in {"open", "in_progress", "resolved"}:
            status = "open"
        normalized["incident_status"] = status
        normalized.setdefault("status_updated_at", normalized.get("created_at"))
        normalized.setdefault("status_updated_by", normalized.get("reporter_username"))
        normalized.setdefault("resolved_at", None)
        normalized.setdefault("resolved_by", None)
        normalized.setdefault("resolution_note", None)
        return normalized

    def guess_image_content_type(self, file_path):
        suffix = Path(file_path).suffix.lower()
        if suffix in (".jpg", ".jpeg"):
            return "image/jpeg"
        if suffix == ".png":
            return "image/png"
        if suffix == ".webp":
            return "image/webp"
        raise ValueError("Formato no soportado. Usa JPG, PNG o WEBP.")

    def list_incidents_for_installation(self, normalized_installation_id):
        payload = self._request("get", f"installations/{normalized_installation_id}/incidents")
        if isinstance(payload, dict):
            incidents = payload.get("incidents", []) or []
            return [self.normalize_incident_lifecycle_fields(item) for item in incidents]
        return []

    def build_create_incident_payload(
        self,
        note,
        severity="medium",
        reporter_username="desktop",
        time_adjustment_seconds=0,
        apply_to_installation=False,
        source="desktop",
    ):
        payload = {
            "reporter_username": str(reporter_username or "desktop"),
            "note": str(note or "").strip(),
            "severity": str(severity or "medium"),
            "time_adjustment_seconds": int(time_adjustment_seconds or 0),
            "apply_to_installation": bool(apply_to_installation),
            "source": str(source or "desktop"),
        }
        if not payload["note"]:
            raise ValueError("La incidencia requiere una nota/descripciÃ³n.")
        return payload

    def create_incident(self, normalized_installation_id, payload):
        result = self._request(
            "post",
            f"installations/{normalized_installation_id}/incidents",
            json=payload,
        )
        if isinstance(result, dict):
            return self.normalize_incident_lifecycle_fields(result.get("incident"))
        return None

    def build_update_incident_status_payload(
        self,
        incident_status,
        resolution_note="",
        reporter_username="desktop",
    ):
        normalized_status = str(incident_status or "").strip().lower()
        if normalized_status not in {"open", "in_progress", "resolved"}:
            raise ValueError("Estado de incidencia invÃ¡lido. Usa open, in_progress o resolved.")

        return {
            "incident_status": normalized_status,
            "resolution_note": str(resolution_note or "").strip(),
            "reporter_username": str(reporter_username or "desktop"),
        }

    def update_incident_status(self, normalized_incident_id, payload):
        result = self._request(
            "patch",
            f"incidents/{normalized_incident_id}/status",
            json=payload,
        )
        if isinstance(result, dict):
            return self.normalize_incident_lifecycle_fields(result.get("incident"))
        return None

    def upload_incident_photo(self, normalized_incident_id, file_path):
        file_to_upload = Path(file_path)
        if not file_to_upload.exists() or not file_to_upload.is_file():
            raise FileNotFoundError(f"No se encontrÃ³ el archivo: {file_path}")

        content_type = self.guess_image_content_type(file_to_upload)
        binary_data = file_to_upload.read_bytes()
        if len(binary_data) < 1024:
            raise ValueError("La imagen es demasiado pequeÃ±a o estÃ¡ corrupta.")

        result = self._request(
            "post",
            f"incidents/{normalized_incident_id}/photos",
            data=binary_data,
            extra_headers={
                "Content-Type": content_type,
                "X-File-Name": file_to_upload.name,
            },
        )
        if isinstance(result, dict):
            return result.get("photo")
        return None

    def get_photo_content(self, normalized_photo_id):
        response = self._request(
            "get",
            f"photos/{normalized_photo_id}",
            expect_json=False,
        )
        return response.content, response.headers.get("Content-Type", "image/jpeg")

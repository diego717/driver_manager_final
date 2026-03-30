"""
Domain client for tenant-scoped technicians and technician assignments.
"""

from __future__ import annotations


class TechnicianWebService:
    """Thin client for /technicians and /technician-assignments endpoints."""

    ALLOWED_ENTITY_TYPES = {"installation", "incident", "asset", "zone"}
    ALLOWED_ASSIGNMENT_ROLES = {"owner", "assistant", "reviewer"}

    def __init__(self, request_func):
        self._request = request_func

    def _normalize_optional_string(self, value):
        if isinstance(value, str):
            return value.strip()
        if value is None:
            return ""
        return str(value).strip()

    def _normalize_positive_int_or_none(self, value):
        if value in (None, ""):
            return None
        parsed = int(value)
        if parsed <= 0:
            raise ValueError("El identificador debe ser un entero positivo.")
        return parsed

    def _normalize_positive_int(self, value, field_name):
        try:
            parsed = int(value)
        except (TypeError, ValueError) as error:
            raise ValueError(f"{field_name} debe ser un entero positivo.") from error
        if parsed <= 0:
            raise ValueError(f"{field_name} debe ser un entero positivo.")
        return parsed

    def _normalize_entity_type(self, entity_type):
        normalized = self._normalize_optional_string(entity_type).lower()
        if normalized not in self.ALLOWED_ENTITY_TYPES:
            raise ValueError("entity_type invalido.")
        return normalized

    def _normalize_assignment_role(self, assignment_role):
        normalized = self._normalize_optional_string(assignment_role or "owner").lower() or "owner"
        if normalized not in self.ALLOWED_ASSIGNMENT_ROLES:
            raise ValueError("assignment_role invalido.")
        return normalized

    def _normalize_entity_id(self, entity_type, entity_id):
        if entity_type == "zone":
            normalized = self._normalize_optional_string(entity_id)
            if not normalized:
                raise ValueError("entity_id es obligatorio para zone.")
            return normalized
        return str(self._normalize_positive_int(entity_id, "entity_id"))

    def _normalize_technician(self, item):
        if not isinstance(item, dict):
            return {}
        return {
            "id": self._normalize_positive_int(item.get("id"), "id"),
            "tenant_id": self._normalize_optional_string(item.get("tenant_id")),
            "web_user_id": self._normalize_positive_int_or_none(item.get("web_user_id")),
            "display_name": self._normalize_optional_string(item.get("display_name")),
            "email": self._normalize_optional_string(item.get("email")),
            "phone": self._normalize_optional_string(item.get("phone")),
            "employee_code": self._normalize_optional_string(item.get("employee_code")),
            "notes": self._normalize_optional_string(item.get("notes")),
            "is_active": bool(item.get("is_active", True)),
            "created_at": self._normalize_optional_string(item.get("created_at")),
            "updated_at": self._normalize_optional_string(item.get("updated_at")),
            "active_assignment_count": max(0, int(item.get("active_assignment_count") or 0)),
        }

    def _normalize_assignment(self, item):
        if not isinstance(item, dict):
            return {}
        unassigned_at = item.get("unassigned_at")
        metadata_json = item.get("metadata_json")
        return {
            "id": self._normalize_positive_int(item.get("id"), "id"),
            "tenant_id": self._normalize_optional_string(item.get("tenant_id")),
            "technician_id": self._normalize_positive_int(item.get("technician_id"), "technician_id"),
            "entity_type": self._normalize_optional_string(item.get("entity_type")),
            "entity_id": self._normalize_optional_string(item.get("entity_id")),
            "assignment_role": self._normalize_assignment_role(item.get("assignment_role")),
            "assigned_by_user_id": self._normalize_positive_int_or_none(item.get("assigned_by_user_id")),
            "assigned_by_username": self._normalize_optional_string(item.get("assigned_by_username")),
            "assigned_at": self._normalize_optional_string(item.get("assigned_at")),
            "unassigned_at": self._normalize_optional_string(unassigned_at) or None,
            "metadata_json": self._normalize_optional_string(metadata_json) or None,
            "technician_display_name": self._normalize_optional_string(
                item.get("technician_display_name")
            ),
            "technician_employee_code": self._normalize_optional_string(
                item.get("technician_employee_code")
            ),
            "technician_is_active": (
                None if item.get("technician_is_active") is None else bool(item.get("technician_is_active"))
            ),
        }

    def _safe_request(self, method, endpoint, operation, **kwargs):
        try:
            return self._request(method, endpoint, **kwargs)
        except ConnectionError as error:
            raise ConnectionError(f"{operation}. {error}") from error

    def list_technicians(self, include_inactive=False):
        params = {"include_inactive": "1"} if include_inactive else None
        payload = self._safe_request(
            "get",
            "technicians",
            "No se pudo listar tecnicos",
            params=params,
        )
        technicians = payload.get("technicians") if isinstance(payload, dict) else []
        if not isinstance(technicians, list):
            technicians = []
        return [self._normalize_technician(item) for item in technicians if isinstance(item, dict)]

    def create_technician(
        self,
        display_name,
        employee_code="",
        email="",
        phone="",
        notes="",
        web_user_id=None,
    ):
        normalized_display_name = self._normalize_optional_string(display_name)
        if not normalized_display_name:
            raise ValueError("display_name es obligatorio.")

        payload = self._safe_request(
            "post",
            "technicians",
            "No se pudo crear tecnico",
            json={
                "display_name": normalized_display_name,
                "employee_code": self._normalize_optional_string(employee_code),
                "email": self._normalize_optional_string(email),
                "phone": self._normalize_optional_string(phone),
                "notes": self._normalize_optional_string(notes),
                "web_user_id": self._normalize_positive_int_or_none(web_user_id),
            },
        )
        technician = payload.get("technician") if isinstance(payload, dict) else None
        if not isinstance(technician, dict):
            raise ConnectionError("No se pudo crear tecnico. Respuesta de API invalida.")
        return self._normalize_technician(technician)

    def update_technician(self, technician_id, **kwargs):
        normalized_technician_id = self._normalize_positive_int(technician_id, "technician_id")
        patch_payload = {}

        for key in ("display_name", "employee_code", "email", "phone", "notes"):
            if key in kwargs and kwargs[key] is not None:
                patch_payload[key] = self._normalize_optional_string(kwargs[key])

        if "web_user_id" in kwargs:
            patch_payload["web_user_id"] = self._normalize_positive_int_or_none(kwargs.get("web_user_id"))
        if "is_active" in kwargs and kwargs.get("is_active") is not None:
            patch_payload["is_active"] = bool(kwargs.get("is_active"))

        if not patch_payload:
            raise ValueError("Debes enviar al menos un campo editable.")

        payload = self._safe_request(
            "patch",
            f"technicians/{normalized_technician_id}",
            "No se pudo actualizar tecnico",
            json=patch_payload,
        )
        technician = payload.get("technician") if isinstance(payload, dict) else None
        if not isinstance(technician, dict):
            raise ConnectionError("No se pudo actualizar tecnico. Respuesta de API invalida.")
        return self._normalize_technician(technician)

    def list_technician_assignments(self, technician_id, include_inactive=False):
        normalized_technician_id = self._normalize_positive_int(technician_id, "technician_id")
        params = {"include_inactive": "1"} if include_inactive else None
        payload = self._safe_request(
            "get",
            f"technicians/{normalized_technician_id}/assignments",
            "No se pudieron listar asignaciones del tecnico",
            params=params,
        )
        assignments = payload.get("assignments") if isinstance(payload, dict) else []
        if not isinstance(assignments, list):
            assignments = []
        return [self._normalize_assignment(item) for item in assignments if isinstance(item, dict)]

    def list_entity_assignments(self, entity_type, entity_id, include_inactive=False):
        normalized_entity_type = self._normalize_entity_type(entity_type)
        normalized_entity_id = self._normalize_entity_id(normalized_entity_type, entity_id)
        params = {
            "entity_type": normalized_entity_type,
            "entity_id": normalized_entity_id,
        }
        if include_inactive:
            params["include_inactive"] = "1"

        payload = self._safe_request(
            "get",
            "technician-assignments",
            "No se pudieron listar asignaciones por entidad",
            params=params,
        )
        assignments = payload.get("assignments") if isinstance(payload, dict) else []
        if not isinstance(assignments, list):
            assignments = []
        return [self._normalize_assignment(item) for item in assignments if isinstance(item, dict)]

    def create_assignment(
        self,
        technician_id,
        entity_type,
        entity_id,
        assignment_role="owner",
        metadata_json=None,
    ):
        normalized_technician_id = self._normalize_positive_int(technician_id, "technician_id")
        normalized_entity_type = self._normalize_entity_type(entity_type)
        normalized_entity_id = self._normalize_entity_id(normalized_entity_type, entity_id)

        payload_json = {
            "entity_type": normalized_entity_type,
            "entity_id": normalized_entity_id,
            "assignment_role": self._normalize_assignment_role(assignment_role),
        }
        if metadata_json not in (None, ""):
            payload_json["metadata_json"] = metadata_json

        payload = self._safe_request(
            "post",
            f"technicians/{normalized_technician_id}/assignments",
            "No se pudo crear asignacion de tecnico",
            json=payload_json,
        )
        assignment = payload.get("assignment") if isinstance(payload, dict) else None
        if not isinstance(assignment, dict):
            raise ConnectionError("No se pudo crear asignacion de tecnico. Respuesta de API invalida.")
        return self._normalize_assignment(assignment)

    def remove_assignment(self, assignment_id):
        normalized_assignment_id = self._normalize_positive_int(assignment_id, "assignment_id")
        payload = self._safe_request(
            "delete",
            f"technician-assignments/{normalized_assignment_id}",
            "No se pudo quitar asignacion",
        )
        assignment = payload.get("assignment") if isinstance(payload, dict) else None
        if not isinstance(assignment, dict):
            raise ConnectionError("No se pudo quitar asignacion. Respuesta de API invalida.")
        return self._normalize_assignment(assignment)

"""
Shared domain rules for installation history, incidents and assets.
"""

from __future__ import annotations

ALLOWED_INCIDENT_STATUSES = {"open", "in_progress", "paused", "resolved"}
DEFAULT_INCIDENT_STATUS = "open"

INCIDENT_NOTE_REQUIRED_MESSAGE = "La incidencia requiere una nota o descripcion."
INCIDENT_STATUS_INVALID_MESSAGE = (
    "Estado de incidencia invalido. Usa open, in_progress, paused o resolved."
)
UNSUPPORTED_IMAGE_FORMAT_MESSAGE = "Formato no soportado. Usa JPG, PNG o WEBP."
IMAGE_TOO_SMALL_MESSAGE = "La imagen es demasiado pequena o esta corrupta."
ASSET_EXTERNAL_CODE_REQUIRED_MESSAGE = "El codigo externo del equipo es obligatorio."


def normalize_incident_status(raw_value: object) -> str:
    status = str(raw_value or "").strip().lower()
    if status in ALLOWED_INCIDENT_STATUSES:
        return status
    return DEFAULT_INCIDENT_STATUS


def normalize_required_note(note: object) -> str:
    normalized_note = str(note or "").strip()
    if not normalized_note:
        raise ValueError(INCIDENT_NOTE_REQUIRED_MESSAGE)
    return normalized_note


def normalize_required_asset_code(external_code: object) -> str:
    normalized_code = str(external_code or "").strip()
    if not normalized_code:
        raise ValueError(ASSET_EXTERNAL_CODE_REQUIRED_MESSAGE)
    return normalized_code


def validate_incident_status(incident_status: object) -> str:
    normalized_status = str(incident_status or "").strip().lower()
    if normalized_status not in ALLOWED_INCIDENT_STATUSES:
        raise ValueError(INCIDENT_STATUS_INVALID_MESSAGE)
    return normalized_status

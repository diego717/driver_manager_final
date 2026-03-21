"""
Domain client for assets and installation links.
"""

from __future__ import annotations

from managers.history_domain_rules import normalize_required_asset_code


class HistoryAssetsClient:
    """Thin client for asset endpoints."""

    def __init__(self, request_func, incident_normalizer=None):
        self._request = request_func
        self._normalize_incident = incident_normalizer or (lambda item: item)

    def build_resolve_asset_payload(self, external_code, **kwargs):
        payload = {
            "external_code": normalize_required_asset_code(external_code),
        }
        for key in (
            "brand",
            "serial_number",
            "model",
            "client_name",
            "notes",
            "status",
            "update_existing",
        ):
            if key in kwargs and kwargs.get(key) is not None:
                payload[key] = kwargs.get(key)
        return payload

    def resolve_asset(self, payload):
        result = self._request("post", "assets/resolve", json=payload)
        if isinstance(result, dict):
            return result.get("asset")
        return None

    def list_assets(self, limit=100, search=None, brand=None, status=None, code=None):
        params = {}
        if limit:
            params["limit"] = int(limit)
        if search:
            params["search"] = str(search).strip()
        if brand:
            params["brand"] = str(brand).strip()
        if status:
            params["status"] = str(status).strip()
        if code:
            params["code"] = str(code).strip()

        payload = self._request("get", "assets", params=params)
        if isinstance(payload, dict):
            return payload.get("items") or []
        return []

    def get_asset_by_id(self, normalized_asset_id):
        payload = self._request("get", f"assets/{normalized_asset_id}")
        if isinstance(payload, dict):
            return payload.get("asset")
        return None

    def get_asset_incidents(self, normalized_asset_id, limit=100):
        params = {}
        if limit:
            params["limit"] = int(limit)
        payload = self._request(
            "get",
            f"assets/{normalized_asset_id}/incidents",
            params=params,
        )
        if isinstance(payload, dict):
            payload["incidents"] = [
                self._normalize_incident(item)
                for item in (payload.get("incidents") or [])
            ]
            return payload
        return {
            "asset": None,
            "active_link": None,
            "links": [],
            "incidents": [],
        }

    def delete_asset(self, normalized_asset_id):
        self._request("delete", f"assets/{normalized_asset_id}")
        return True

    def link_asset_to_installation(self, normalized_asset_id, normalized_installation_id, notes=""):
        payload = {
            "installation_id": normalized_installation_id,
            "notes": str(notes or "").strip(),
        }
        result = self._request(
            "post",
            f"assets/{normalized_asset_id}/link-installation",
            json=payload,
        )
        if isinstance(result, dict):
            return result.get("link")
        return None

    def save_asset(self, external_code, **kwargs):
        payload = dict(kwargs or {})
        payload["update_existing"] = True
        resolved_payload = self.build_resolve_asset_payload(external_code, **payload)
        return self.resolve_asset(resolved_payload)

    def associate_asset_with_installation(
        self,
        external_code,
        normalized_installation_id,
        notes="",
    ):
        asset = self.resolve_asset(self.build_resolve_asset_payload(external_code))
        if not isinstance(asset, dict):
            raise ConnectionError("No se pudo resolver el equipo en la API.")
        asset_id = asset.get("id")
        link = self.link_asset_to_installation(asset_id, normalized_installation_id, notes=notes)
        return asset, link

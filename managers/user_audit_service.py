import json
import os
import time
from datetime import datetime

from core.exceptions import AuthenticationError, handle_errors, returns_result_tuple


class UserAuditService:
    """Servicio de auditoria/access logs para UserManagerV2."""

    def __init__(self, owner):
        self.owner = owner

    def _get_system_info(self):
        return self.owner._get_system_info()

    def _can_use_audit_api(self):
        if self.owner.local_mode:
            return False

        client = self.owner.audit_api_client
        if client is None or not hasattr(client, "_make_request"):
            return False

        mode_getter = getattr(client, "_current_desktop_auth_mode", None)
        auth_mode = ""
        if callable(mode_getter):
            try:
                auth_mode = str(mode_getter() or "").strip().lower()
            except Exception:
                auth_mode = ""

        token_getter = getattr(client, "_get_web_access_token", None)
        web_access_token = ""
        if callable(token_getter):
            try:
                web_access_token = str(token_getter() or "").strip()
            except Exception:
                web_access_token = ""

        if auth_mode == self.owner.AUTH_MODE_WEB:
            return bool(web_access_token)

        if auth_mode == self.owner.AUTH_MODE_AUTO and web_access_token:
            return True

        allow_unsigned = bool(getattr(client, "allow_unsigned_requests", False))
        api_token = str(getattr(client, "api_token", "") or "").strip()
        api_secret = str(getattr(client, "api_secret", "") or "").strip()
        has_signed_auth = bool(api_token and api_secret)

        if auth_mode == self.owner.AUTH_MODE_AUTO:
            return allow_unsigned or has_signed_auth

        return allow_unsigned or has_signed_auth or auth_mode in {
            "",
            self.owner.AUTH_MODE_LEGACY,
        }

    def _should_defer_access_logging(self):
        if self.owner.local_mode or self._can_use_audit_api():
            return False

        if self.owner.auth_mode not in {self.owner.AUTH_MODE_WEB, self.owner.AUTH_MODE_AUTO}:
            return False

        if str(self.owner.current_web_token or "").strip():
            return False

        client = self.owner.audit_api_client
        allow_unsigned = bool(getattr(client, "allow_unsigned_requests", False))
        api_token = str(getattr(client, "api_token", "") or "").strip()
        api_secret = str(getattr(client, "api_secret", "") or "").strip()
        return not allow_unsigned and not (api_token and api_secret)

    def _normalize_audit_api_log_entry(self, entry):
        if not isinstance(entry, dict):
            return None

        raw_details = entry.get("details")
        details = {}
        if isinstance(raw_details, str):
            raw_value = raw_details.strip()
            if raw_value:
                try:
                    details = json.loads(raw_value)
                    if not isinstance(details, dict):
                        details = {"value": details}
                except json.JSONDecodeError:
                    details = {"raw": raw_details}
        elif isinstance(raw_details, dict):
            details = raw_details
        elif raw_details is not None:
            details = {"value": raw_details}

        raw_success = entry.get("success")
        if isinstance(raw_success, bool):
            success = raw_success
        elif isinstance(raw_success, (int, float)):
            success = int(raw_success) == 1
        elif isinstance(raw_success, str):
            success = raw_success.strip().lower() in ("1", "true", "yes", "ok")
        else:
            success = bool(raw_success)

        timestamp_value = entry.get("timestamp")
        if not timestamp_value:
            for key, value in entry.items():
                if not isinstance(key, str):
                    continue
                lowered = key.lower()
                if lowered.startswith("timest") and "mp" in lowered:
                    timestamp_value = value
                    break

        return {
            "timestamp": timestamp_value,
            "action": entry.get("action"),
            "username": entry.get("username"),
            "success": success,
            "details": details,
            "system_info": {
                "computer_name": entry.get("computer_name"),
                "ip": entry.get("ip_address"),
                "platform": entry.get("platform"),
            },
        }

    def _normalize_logs_data(self, logs_data):
        if not isinstance(logs_data, dict):
            self.owner.logger.warning(
                "Formato de logs invalido. Reinicializando estructura de logs."
            )
            return {"logs": [], "created_at": datetime.now().isoformat()}

        normalized = dict(logs_data)
        logs = normalized.get("logs")

        if logs is None and isinstance(normalized.get("access_logs"), list):
            logs = normalized.get("access_logs")
            normalized["logs"] = logs

        if not isinstance(logs, list):
            self.owner.logger.warning(
                "Estructura de logs corrupta o incompatible. Se usara lista vacaa."
            )
            normalized["logs"] = []

        if "created_at" not in normalized:
            normalized["created_at"] = datetime.now().isoformat()

        return normalized

    def _decode_cloud_logs_payload(self, cloud_payload):
        if not isinstance(cloud_payload, dict):
            return {"logs": [], "created_at": datetime.now().isoformat()}, False

        fallback_recovered = False
        payload_copy = dict(cloud_payload)

        if self.owner.cloud_encryption:
            decrypted = self.owner.cloud_encryption.decrypt_cloud_data(dict(payload_copy))
            if isinstance(decrypted, dict) and (
                isinstance(decrypted.get("logs"), list)
                or isinstance(decrypted.get("access_logs"), list)
            ):
                return self._normalize_logs_data(decrypted), fallback_recovered

        fallback_recovered = True

        if isinstance(payload_copy.get("logs"), list) or isinstance(
            payload_copy.get("access_logs"),
            list,
        ):
            self.owner.logger.warning(
                "Recuperando logs desde payload legacy sin validacian HMAC completa."
            )
            return self._normalize_logs_data(payload_copy), fallback_recovered

        encrypted_candidates = []
        if isinstance(payload_copy.get("access_logs"), str):
            encrypted_candidates.append(("access_logs", payload_copy.get("access_logs")))
        if isinstance(payload_copy.get("logs"), str):
            encrypted_candidates.append(("logs", payload_copy.get("logs")))

        if self.owner.security_manager and self.owner.security_manager.fernet:
            for field_name, encrypted_blob in encrypted_candidates:
                try:
                    decrypted_blob = self.owner.security_manager.decrypt_data(encrypted_blob)
                    if isinstance(decrypted_blob, list):
                        self.owner.logger.warning(
                            f"Recuperacian best-effort aplicada para '{field_name}' con HMAC invalido."
                        )
                        return self._normalize_logs_data(
                            {
                                "logs": decrypted_blob,
                                "created_at": payload_copy.get(
                                    "created_at",
                                    datetime.now().isoformat(),
                                ),
                            }
                        ), fallback_recovered
                    if isinstance(decrypted_blob, dict):
                        self.owner.logger.warning(
                            f"Recuperacian best-effort aplicada para '{field_name}' en formato dict."
                        )
                        return self._normalize_logs_data(decrypted_blob), fallback_recovered
                except Exception:
                    continue

        self.owner.logger.warning(
            "No fue posible recuperar contenido histarico de logs; se usara estructura vacaa."
        )
        return self._normalize_logs_data({}), fallback_recovered

    def _persist_logs_data(self, logs_data):
        if self.owner.local_mode:
            temp_logs_file = self.owner.logs_file.with_suffix(f"{self.owner.logs_file.suffix}.tmp")
            with open(temp_logs_file, "w", encoding="utf-8") as file:
                json.dump(logs_data, file, indent=2)
            os.replace(temp_logs_file, self.owner.logs_file)
            return

        if self.owner.cloud_encryption:
            encrypted_logs = self.owner.cloud_encryption.encrypt_cloud_data(logs_data)
            logs_content = json.dumps(encrypted_logs, indent=2)
        else:
            logs_content = json.dumps(logs_data, indent=2)

        self.owner.cloud_manager.upload_file_content(self.owner.logs_file, logs_content)

    def _load_legacy_logs_data(self):
        logs_data = {"logs": [], "created_at": datetime.now().isoformat()}

        try:
            if self.owner.local_mode:
                if self.owner.logs_file.exists():
                    with open(self.owner.logs_file, "r", encoding="utf-8-sig") as file:
                        logs_data = json.load(file)
            else:
                logs_content = self.owner.cloud_manager.download_file_content(self.owner.logs_file)
                if logs_content:
                    if isinstance(logs_content, bytes):
                        logs_content = logs_content.decode("utf-8-sig")
                    elif isinstance(logs_content, str):
                        logs_content = logs_content.lstrip("\ufeff")
                    cloud_payload = json.loads(logs_content)
                    logs_data, recovered = self._decode_cloud_logs_payload(cloud_payload)
                    if recovered:
                        self.owner.logger.warning(
                            "Se recuperaron logs historicos con fallback; normalizando archivo."
                        )
                        self._persist_logs_data(logs_data)
        except Exception as error:
            self.owner.logger.warning(
                f"No se pudo leer logs legacy: {error}. Se usara estructura vacia."
            )

        return self._normalize_logs_data(logs_data)

    def _log_entry_key(self, entry):
        details_blob = json.dumps(entry.get("details"), sort_keys=True, default=str)
        system_blob = json.dumps(entry.get("system_info"), sort_keys=True, default=str)
        return (
            entry.get("timestamp"),
            entry.get("action"),
            entry.get("username"),
            bool(entry.get("success")),
            details_blob,
            system_blob,
        )

    def _merge_logs_preserving_order(self, existing_logs, additional_logs):
        merged_logs = list(existing_logs or [])
        seen_keys = {self._log_entry_key(item) for item in merged_logs if isinstance(item, dict)}

        for entry in additional_logs or []:
            if not isinstance(entry, dict):
                continue
            entry_key = self._log_entry_key(entry)
            if entry_key in seen_keys:
                continue
            merged_logs.append(entry)
            seen_keys.add(entry_key)

        return merged_logs

    def _append_legacy_log_entry(self, log_entry):
        target_key = self.owner._log_entry_key(log_entry)

        for attempt in range(self.owner.LEGACY_LOG_APPEND_RETRIES):
            try:
                logs_data = self.owner._load_legacy_logs_data()
                current_logs = logs_data.get("logs", [])
                logs_data["logs"] = self.owner._merge_logs_preserving_order(current_logs, [log_entry])[-1000:]
                self.owner._persist_logs_data(logs_data)

                persisted = self.owner._load_legacy_logs_data()
                persisted_keys = {
                    self.owner._log_entry_key(item)
                    for item in persisted.get("logs", [])
                    if isinstance(item, dict)
                }
                if target_key in persisted_keys:
                    return True
            except Exception as error:
                self.owner.logger.warning(
                    f"Fallo append de log en intento {attempt + 1}/{self.owner.LEGACY_LOG_APPEND_RETRIES}: {error}"
                )

            time.sleep(0.02 * (attempt + 1))

        return False

    @returns_result_tuple("repair_access_logs")
    def repair_access_logs(self):
        self.owner.logger.operation_start("repair_access_logs")

        if not self.owner.current_user or self.owner.current_user.get("role") != "super_admin":
            raise AuthenticationError("Solo super_admin puede reparar logs de auditoria.")

        if self._can_use_audit_api():
            self.owner.logger.operation_end("repair_access_logs", success=True, mode="audit_api")
            return True, "Auditoria en D1 activa. No se requiere reparacion de archivo local."

        logs_data = self._load_legacy_logs_data()
        self._persist_logs_data(logs_data)

        total_logs = len(logs_data.get("logs", []))
        self.owner.logger.operation_end("repair_access_logs", success=True, total_logs=total_logs)
        return True, f"Logs reparados correctamente. Registros disponibles: {total_logs}"

    @handle_errors("_log_access", reraise=False, log_errors=False)
    def _log_access(self, action, username, success, details=None):
        try:
            system_info = self._get_system_info()
            log_entry = {
                "timestamp": datetime.now().isoformat(),
                "action": action,
                "username": username,
                "success": success,
                "details": details,
                "system_info": system_info,
            }

            if self._should_defer_access_logging():
                self.owner.logger.operation_end(
                    "_log_access",
                    success=True,
                    mode="deferred_until_web_login",
                )
                return

            if self._can_use_audit_api():
                self.owner.audit_api_client._make_request(
                    "post",
                    "audit-logs",
                    json={
                        "timestamp": log_entry["timestamp"],
                        "action": action,
                        "username": username,
                        "success": bool(success),
                        "details": details or {},
                        "computer_name": system_info.get("computer_name"),
                        "ip_address": system_info.get("ip"),
                        "platform": system_info.get("platform"),
                    },
                )
                self.owner.logger.operation_end("_log_access", success=True, mode="audit_api")
                return

            persisted = self._append_legacy_log_entry(log_entry)
            if not persisted:
                self.owner.logger.warning("No se pudo confirmar persistencia del log tras reintentos.")
            self.owner.logger.operation_end("_log_access", success=persisted, mode="legacy_storage")
        except Exception as error:
            self.owner.logger.error(f"Critical failure logging access: {error}", exc_info=True)
            self.owner.logger.operation_end("_log_access", success=False, reason=str(error))

    def get_access_logs(self, limit=100):
        self.owner.logger.operation_start("get_access_logs")
        if not self.owner.current_user:
            self.owner.logger.warning("Attempt to get logs without authentication")
            self.owner.logger.operation_end(
                "get_access_logs",
                success=False,
                reason="not_authenticated",
            )
            return []

        try:
            if self._can_use_audit_api():
                normalized_limit = max(1, int(limit or 100))
                rows = self.owner.audit_api_client._make_request(
                    "get",
                    "audit-logs",
                    params={"limit": normalized_limit},
                ) or []

                normalized_rows = []
                for row in rows:
                    normalized = self._normalize_audit_api_log_entry(row)
                    if normalized:
                        normalized_rows.append(normalized)

                normalized_rows.reverse()
                self.owner.logger.operation_end(
                    "get_access_logs",
                    success=True,
                    mode="audit_api",
                )
                return normalized_rows

            if self.owner.local_mode:
                if not self.owner.logs_file.exists():
                    return []
                with open(self.owner.logs_file, "r") as file:
                    logs_data = json.load(file)
            else:
                logs_content = self.owner.cloud_manager.download_file_content(self.owner.logs_file)
                if not logs_content:
                    return []

                if isinstance(logs_content, bytes):
                    logs_content = logs_content.decode("utf-8-sig")
                elif isinstance(logs_content, str):
                    logs_content = logs_content.lstrip("\ufeff")
                cloud_payload = json.loads(logs_content)
                logs_data, recovered = self._decode_cloud_logs_payload(cloud_payload)
                if recovered:
                    self.owner.logger.warning(
                        "Se detecta payload legacy/corrupto en get_access_logs; persistiendo reparacion."
                    )
                    self._persist_logs_data(logs_data)

            logs_data = self._normalize_logs_data(logs_data)
            logs = logs_data["logs"]
            self.owner.logger.operation_end("get_access_logs", success=True)
            return logs[-limit:] if len(logs) > limit else logs
        except Exception as error:
            if not self.owner.current_user and isinstance(error, ConnectionError):
                self.owner.logger.warning(f"Access logs unavailable until next login: {error}")
            else:
                self.owner.logger.error(f"Error getting access logs: {error}", exc_info=True)
            return []

import copy
import json
import sys
from datetime import datetime
from pathlib import Path

from core.exceptions import CloudStorageError, SecurityError, handle_errors


class UserRepository:
    """Persistencia/cache de usuarios para UserManagerV2."""

    def __init__(self, owner):
        self.owner = owner

    def _invalidate_users_cache(self):
        self.owner._users_cache_data = None
        self.owner._users_cache_loaded_at = 0.0

    def _set_users_cache(self, users_data):
        self.owner._users_cache_data = copy.deepcopy(self._normalize_users_data(users_data))
        self.owner._users_cache_loaded_at = self.owner._cache_clock()

    def _get_cached_users(self):
        if self.owner.local_mode or self.owner._users_cache_data is None:
            return None

        age = self.owner._cache_clock() - self.owner._users_cache_loaded_at
        if age > self.owner.USERS_CACHE_TTL_SECONDS:
            self._invalidate_users_cache()
            return None

        return copy.deepcopy(self.owner._users_cache_data)

    def _normalize_users_data(self, users_data):
        if not isinstance(users_data, dict):
            return {"users": {}, "created_at": datetime.now().isoformat(), "version": "2.1"}

        normalized = dict(users_data)
        users = normalized.get("users")

        if isinstance(users, list):
            rebuilt_users = {}
            for entry in users:
                if isinstance(entry, dict):
                    username = entry.get("username")
                    if username:
                        rebuilt_users[username] = entry
            users = rebuilt_users

        if not isinstance(users, dict):
            users = {}

        normalized["users"] = users
        normalized.setdefault("created_at", datetime.now().isoformat())
        normalized.setdefault("version", "2.1")
        return normalized

    def _decode_cloud_users_payload(self, cloud_payload):
        if not isinstance(cloud_payload, dict):
            return None
        payload_copy = dict(cloud_payload)

        if self.owner.cloud_encryption:
            decrypted = self.owner.cloud_encryption.decrypt_cloud_data(dict(payload_copy))
            if isinstance(decrypted, dict) and isinstance(decrypted.get("users"), dict):
                return self._normalize_users_data(decrypted)

        has_integrity_metadata = "_hmac" in payload_copy or bool(payload_copy.get("_encrypted"))
        if not has_integrity_metadata and isinstance(payload_copy.get("users"), dict):
            return self._normalize_users_data(payload_copy)

        raise SecurityError(
            "Payload cloud de usuarios con integridad invalida. "
            "No se aplicara recuperacion automatica; usa una reparacion offline/manual."
        )

    def _load_users_disk_fallback(self):
        fallback_paths = self._candidate_users_fallback_paths()

        for path in fallback_paths:
            try:
                if not path.exists():
                    continue
                with open(path, "r", encoding="utf-8-sig") as file:
                    data = json.load(file)
                normalized = self._normalize_users_data(data)
                if normalized.get("users"):
                    self.owner.logger.warning(f"Copia local de usuarios encontrada en: {path}")
                    return normalized
            except Exception as error:
                self.owner.logger.warning(
                    f"No se pudo leer fallback de usuarios en {path}: {error}"
                )

        self.owner.logger.warning("No se encontraron copias locales de usuarios para recuperacian.")
        return None

    def _candidate_users_fallback_paths(self):
        candidates = []

        def add_candidate(path):
            if not path:
                return
            if path not in candidates:
                candidates.append(path)

        add_candidate(self.owner.config_dir / "users.json")
        add_candidate(Path.home() / ".driver_manager" / "users.json")
        add_candidate(Path.home() / ".driver_manager_backup" / "users.json")

        try:
            if self.owner.security_manager and hasattr(self.owner.security_manager, "_get_config_dir"):
                config_dir = self.owner.security_manager._get_config_dir()
                if config_dir:
                    add_candidate(Path(config_dir) / "users.json")
        except Exception:
            pass

        runtime_roots = [Path.cwd(), Path(__file__).resolve().parents[1]]
        if getattr(sys, "frozen", False):
            runtime_roots.append(Path(sys.executable).resolve().parent)

        for root in runtime_roots:
            add_candidate(root / "users.json")
            add_candidate(root / "config" / "users.json")
            add_candidate(root / "data" / "users.json")

        return candidates

    def _load_users(self):
        self.owner.logger.operation_start("_load_users")
        try:
            cached_data = self._get_cached_users()
            if cached_data is not None:
                self.owner.logger.operation_end("_load_users", success=True, source="cache")
                return cached_data

            if self.owner.local_mode:
                if not self.owner.users_file.exists():
                    self.owner.logger.operation_end("_load_users", success=True)
                    return None

                with open(self.owner.users_file, "r", encoding="utf-8-sig") as file:
                    data = json.load(file)

                data = self._normalize_users_data(data)
                self.owner.logger.operation_end("_load_users", success=True)
                return data

            content = self.owner.cloud_manager.download_file_content(self.owner.users_file)
            if not content:
                self.owner.logger.warning(
                    "No content found for users file in cloud.",
                    file=self.owner.users_file,
                )
                fallback_users = self._load_users_disk_fallback()
                if fallback_users:
                    self.owner.logger.warning(
                        "Usando copia local de usuarios por ausencia de archivo en nube."
                    )
                    self._set_users_cache(fallback_users)
                    self.owner.logger.operation_end("_load_users", success=True)
                    return fallback_users
                self.owner.logger.operation_end("_load_users", success=True)
                return None

            if isinstance(content, bytes):
                content = content.decode("utf-8-sig")
            elif isinstance(content, str):
                content = content.lstrip("\ufeff")
            cloud_payload = json.loads(content)
            try:
                data = self._decode_cloud_users_payload(cloud_payload)
            except SecurityError as integrity_error:
                self.owner.logger.error(
                    f"Integridad invalida en payload cloud de usuarios: {integrity_error}"
                )
                raise CloudStorageError(
                    str(integrity_error),
                    original_error=integrity_error,
                ) from integrity_error

            if not data or not data.get("users"):
                fallback_users = self._load_users_disk_fallback()
                if fallback_users and fallback_users.get("users"):
                    self.owner.logger.warning(
                        "Recuperando base de usuarios desde copia local y subiendo a la nube."
                    )
                    try:
                        self._save_users(fallback_users)
                    except Exception as sync_error:
                        self.owner.logger.warning(
                            f"No se pudo subir copia local de usuarios a la nube: {sync_error}"
                        )
                    data = fallback_users

            if data is not None:
                self._set_users_cache(data)

            self.owner.logger.operation_end("_load_users", success=True)
            return data
        except Exception as error:
            self.owner.logger.error(f"Error loading users: {error}", exc_info=True)
            self.owner.logger.operation_end("_load_users", success=False, reason=str(error))
            raise CloudStorageError(
                f"Error loading users: {str(error)}",
                original_error=error,
            )

    @handle_errors("_save_users", reraise=True)
    def _save_users(self, users_data):
        self.owner.logger.operation_start("_save_users")
        try:
            normalized_data = self._normalize_users_data(users_data)
            if self.owner.local_mode:
                with open(self.owner.users_file, "w") as file:
                    json.dump(normalized_data, file, indent=2)
            else:
                if self.owner.cloud_encryption:
                    encrypted_data = self.owner.cloud_encryption.encrypt_cloud_data(normalized_data)
                    content = json.dumps(encrypted_data, indent=2)
                else:
                    content = json.dumps(normalized_data, indent=2)

                self.owner.cloud_manager.upload_file_content(self.owner.users_file, content)
                self._set_users_cache(normalized_data)
            self.owner.logger.operation_end("_save_users", success=True)
        except Exception as error:
            self.owner.logger.error(f"Error saving users: {error}", exc_info=True)
            self.owner.logger.operation_end("_save_users", success=False, reason=str(error))
            raise CloudStorageError(
                f"Error saving users: {str(error)}",
                original_error=error,
            )

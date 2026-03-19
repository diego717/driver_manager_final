import unittest
from unittest.mock import MagicMock
from unittest.mock import patch
import json
import shutil
from pathlib import Path

from core.exceptions import CloudStorageError, SecurityError
from managers.user_manager_v2 import UserManagerV2


class StubAuditApiClient:
    def __init__(self):
        self.web_token_provider = None
        self.web_auth_failure_handler = None

    def set_web_token_provider(self, provider):
        self.web_token_provider = provider

    def set_web_auth_failure_handler(self, handler):
        self.web_auth_failure_handler = handler


class TestUserManagerV2(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path("tests/temp_config")
        self.test_dir.mkdir(parents=True, exist_ok=True)
        self.superadmin_password = "N7!xTq4#Lm2@Vp9"
        self.admin_password = "Q4@rZ8!kP1#sM7t"
        self.viewer_password = "B9!wX3@hN6#yR2c"
        self.new_superadmin_password = "D5@uK8!pF2#vL9m"

        # Mock cloud manager and security manager
        self.mock_cloud = MagicMock()
        self.mock_security = MagicMock()

        # Initialize UserManager in local mode for easier testing
        self.user_manager = UserManagerV2(local_mode=True)
        self.user_manager.config_dir = self.test_dir
        self.user_manager.users_file = self.test_dir / "users.json"
        self.user_manager.logs_file = self.test_dir / "access_logs.json"

    def tearDown(self):
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir)

    def test_initialize_system(self):
        success, message = self.user_manager.initialize_system("superadmin", self.superadmin_password)
        self.assertTrue(success)
        self.assertTrue(self.user_manager.users_file.exists())

        with open(self.user_manager.users_file, 'r') as f:
            data = json.load(f)
            self.assertIn("superadmin", data["users"])
            self.assertEqual(data["users"]["superadmin"]["role"], "super_admin")
            self.assertEqual(data["users"]["superadmin"]["permissions"], ["all"])

    def test_initialize_system_rejects_weak_password(self):
        success, message = self.user_manager.initialize_system("superadmin", "weak123")
        self.assertFalse(success)
        self.assertIn("seguridad", message.lower())

    def test_authenticate(self):
        self.user_manager.initialize_system("superadmin", self.superadmin_password)

        # Test successful auth
        success, message = self.user_manager.authenticate("superadmin", self.superadmin_password)
        self.assertTrue(success)
        self.assertIsNotNone(self.user_manager.current_user)
        self.assertEqual(self.user_manager.current_user["username"], "superadmin")

        # AuthenticationError is caught by decorator and returns (False, message)
        success, message = self.user_manager.authenticate("superadmin", "wrongpassword")
        self.assertFalse(success)
        self.assertIn("Usuario o contrase", message)

        success, message = self.user_manager.authenticate("nonexistent", self.superadmin_password)
        self.assertFalse(success)
        self.assertIn("Usuario o contrase", message)

    @patch("managers.user_manager_v2.requests.post")
    def test_authenticate_web_mode_success(self, mock_post):
        audit_api = MagicMock()
        audit_api._get_api_url.return_value = "https://example.workers.dev"
        manager = UserManagerV2(
            local_mode=True,
            audit_api_client=audit_api,
            auth_mode="web",
        )
        manager.config_dir = self.test_dir
        manager.logs_file = self.test_dir / "access_logs_web.json"

        response = MagicMock()
        response.ok = True
        response.content = b'{"ok":true}'
        response.json.return_value = {
            "authenticated": True,
            "access_token": "token-abc",
            "token_type": "Bearer",
            "user": {
                "id": "u1",
                "username": "superadmin",
                "role": "super_admin",
                "tenant_id": "tenant-a",
                "is_active": True,
            },
        }
        mock_post.return_value = response

        success, message = manager.authenticate("superadmin", self.superadmin_password)
        self.assertTrue(success)
        self.assertIn("exitoso", message.lower())
        self.assertEqual(manager.current_user["username"], "superadmin")
        self.assertEqual(manager.current_user["role"], "super_admin")
        self.assertEqual(manager.current_user["source"], "web")
        self.assertEqual(manager.current_web_token, "token-abc")

    @patch("managers.user_manager_v2.requests.post")
    def test_authenticate_web_mode_invalid_credentials(self, mock_post):
        audit_api = MagicMock()
        audit_api._get_api_url.return_value = "https://example.workers.dev"
        manager = UserManagerV2(
            local_mode=True,
            audit_api_client=audit_api,
            auth_mode="web",
        )
        manager.config_dir = self.test_dir
        manager.logs_file = self.test_dir / "access_logs_web_invalid.json"

        response = MagicMock()
        response.ok = False
        response.status_code = 401
        response.text = "unauthorized"
        response.json.return_value = {"error": {"message": "Credenciales invalidas"}}
        mock_post.return_value = response

        success, message = manager.authenticate("superadmin", "wrongpassword")
        self.assertFalse(success)
        self.assertIn("incorrect", message.lower())

    @patch("managers.user_manager_v2.requests.post")
    def test_create_tenant_web_user_allows_empty_tenant_id(self, mock_post):
        audit_api = MagicMock()
        audit_api._get_api_url.return_value = "https://example.workers.dev"
        manager = UserManagerV2(
            cloud_manager=MagicMock(),
            security_manager=MagicMock(),
            local_mode=False,
            audit_api_client=audit_api,
            auth_mode="web",
        )
        manager.current_user = {"username": "diegosasen", "role": "super_admin", "source": "web"}
        manager.current_web_token = "token-current"
        manager.current_web_token_type = "Bearer"
        manager._log_access = MagicMock()

        verify_response = MagicMock()
        verify_response.ok = True
        verify_response.content = b'{"success":true}'
        verify_response.json.return_value = {
            "success": True,
            "verified": True,
        }

        create_response = MagicMock()
        create_response.ok = True
        create_response.content = b'{"ok":true}'
        create_response.json.return_value = {"ok": True}

        mock_post.side_effect = [verify_response, create_response]

        success, message = manager.create_tenant_web_user(
            username="Diego",
            password="Q4@rZ8!kP1#sM7t",
            role="admin",
            tenant_id="",
            admin_web_password="AdminPass123!",
        )

        self.assertTrue(success)
        self.assertIn("usuario web creado", message.lower())
        self.assertEqual(mock_post.call_count, 2)
        verify_args, verify_kwargs = mock_post.call_args_list[0]
        self.assertEqual(verify_args[0], "https://example.workers.dev/web/auth/verify-password")
        self.assertEqual(verify_kwargs["headers"]["Authorization"], "Bearer token-current")
        _args, kwargs = mock_post.call_args
        self.assertIsNone(kwargs["json"]["tenant_id"])

    @patch("managers.user_manager_v2.requests.get")
    @patch("managers.user_manager_v2.requests.post")
    def test_fetch_tenant_web_users_reuses_current_session_without_relogin(
        self,
        mock_post,
        mock_get,
    ):
        audit_api = MagicMock()
        audit_api._get_api_url.return_value = "https://example.workers.dev"
        manager = UserManagerV2(
            cloud_manager=MagicMock(),
            security_manager=MagicMock(),
            local_mode=False,
            audit_api_client=audit_api,
            auth_mode="web",
        )
        manager.current_user = {"username": "diegosasen", "role": "super_admin", "source": "web"}
        manager.current_web_token = "token-current"
        manager.current_web_token_type = "Bearer"

        verify_response = MagicMock()
        verify_response.ok = True
        verify_response.content = b'{"success":true}'
        verify_response.json.return_value = {
            "success": True,
            "verified": True,
        }
        mock_post.return_value = verify_response

        users_response = MagicMock()
        users_response.ok = True
        users_response.content = b'{"success":true}'
        users_response.json.return_value = {
            "success": True,
            "users": [
                {
                    "username": "viewer01",
                    "role": "viewer",
                    "tenant_id": "tenant-a",
                    "is_active": True,
                    "last_login_at": None,
                    "created_at": "2026-01-01T00:00:00",
                }
            ],
        }
        mock_get.return_value = users_response

        users = manager.fetch_tenant_web_users(
            admin_web_password="AdminPass123!",
            tenant_id="tenant-a",
        )

        self.assertEqual(len(users), 1)
        post_args, post_kwargs = mock_post.call_args
        self.assertEqual(post_args[0], "https://example.workers.dev/web/auth/verify-password")
        self.assertEqual(post_kwargs["headers"]["Authorization"], "Bearer token-current")
        get_args, get_kwargs = mock_get.call_args
        self.assertEqual(get_args[0], "https://example.workers.dev/web/auth/users")
        self.assertEqual(get_kwargs["headers"]["Authorization"], "Bearer token-current")
        self.assertEqual(get_kwargs["params"], {"tenant_id": "tenant-a"})

    @patch("managers.user_manager_v2.requests.post")
    def test_authenticate_web_mode_invalid_credentials_skip_remote_audit_without_session(self, mock_post):
        cloud = MagicMock()
        security = MagicMock()
        audit_api = MagicMock()
        audit_api._get_api_url.return_value = "https://example.workers.dev"
        audit_api._current_desktop_auth_mode.return_value = "web"
        audit_api._get_web_access_token.return_value = ""
        audit_api.allow_unsigned_requests = False
        audit_api.api_token = ""
        audit_api.api_secret = ""

        manager = UserManagerV2(
            cloud_manager=cloud,
            security_manager=security,
            local_mode=False,
            audit_api_client=audit_api,
            auth_mode="web",
        )
        manager.config_dir = self.test_dir
        manager.logs_file = self.test_dir / "access_logs_web_invalid_remote.json"
        manager._append_legacy_log_entry = MagicMock(return_value=True)

        response = MagicMock()
        response.ok = False
        response.status_code = 401
        response.text = "unauthorized"
        response.json.return_value = {"error": {"message": "Credenciales invalidas"}}
        mock_post.return_value = response

        success, message = manager.authenticate("superadmin", "wrongpassword")

        self.assertFalse(success)
        self.assertIn("incorrect", message.lower())
        audit_api._make_request.assert_not_called()
        manager._append_legacy_log_entry.assert_not_called()
        cloud.download_file_content.assert_not_called()

    @patch("managers.user_manager_v2.requests.post")
    def test_logout_invalidates_remote_web_session_best_effort(self, mock_post):
        audit_api = MagicMock()
        audit_api._get_api_url.return_value = "https://example.workers.dev"
        manager = UserManagerV2(
            local_mode=True,
            audit_api_client=audit_api,
            auth_mode="web",
        )
        manager.current_user = {"username": "superadmin", "role": "super_admin", "source": "web"}
        manager.current_web_token = "token-abc"
        manager.current_web_token_type = "Bearer"
        manager._log_access = MagicMock()

        response = MagicMock()
        response.ok = True
        mock_post.return_value = response

        manager.logout()

        mock_post.assert_called_once_with(
            "https://example.workers.dev/web/auth/logout",
            headers={"Authorization": "Bearer token-abc"},
            timeout=10,
        )
        manager._log_access.assert_called_once_with("logout", "superadmin", True)
        self.assertIsNone(manager.current_user)
        self.assertIsNone(manager.current_web_token)
        self.assertEqual(manager.current_web_token_type, "Bearer")

    def test_audit_api_web_auth_failure_clears_local_web_session_state(self):
        audit_api = StubAuditApiClient()
        manager = UserManagerV2(
            local_mode=True,
            audit_api_client=audit_api,
            auth_mode="web",
        )
        manager.current_user = {
            "username": "superadmin",
            "role": "super_admin",
            "source": "web",
        }
        manager.current_web_token = "token-abc"
        manager.current_web_token_type = "Bearer"

        self.assertEqual(audit_api.web_token_provider(), "token-abc")

        audit_api.web_auth_failure_handler("Sesion web invalida o cerrada.")

        self.assertIsNone(manager.current_user)
        self.assertIsNone(manager.current_web_token)
        self.assertEqual(manager.current_web_token_type, "Bearer")

    def test_get_access_logs_returns_empty_when_not_authenticated(self):
        manager = UserManagerV2(local_mode=True)
        manager.config_dir = self.test_dir
        manager.logs_file = self.test_dir / "access_logs_empty_auth.json"

        logs = manager.get_access_logs(limit=50)

        self.assertEqual(logs, [])

    def test_web_mode_skips_local_initialization_flow(self):
        audit_api = MagicMock()
        audit_api._get_api_url.return_value = "https://example.workers.dev"
        manager = UserManagerV2(
            local_mode=True,
            audit_api_client=audit_api,
            auth_mode="web",
        )
        manager.config_dir = self.test_dir
        manager.users_file = self.test_dir / "missing_users.json"

        self.assertTrue(manager.has_users())
        self.assertFalse(manager.needs_initialization())

    def test_authenticate_locks_account_after_repeated_failures(self):
        self.user_manager.initialize_system("superadmin", self.superadmin_password)
        max_attempts = self.user_manager.lockout_manager.MAX_FAILED_ATTEMPTS

        for _ in range(max_attempts):
            success, _ = self.user_manager.authenticate("superadmin", "WrongPassword123!")
            self.assertFalse(success)

        success, message = self.user_manager.authenticate("superadmin", self.superadmin_password)
        self.assertFalse(success)
        self.assertIn("Cuenta bloqueada", message)

    def test_unlock_user_account_allows_login_again(self):
        self.user_manager.initialize_system("superadmin", self.superadmin_password)
        max_attempts = self.user_manager.lockout_manager.MAX_FAILED_ATTEMPTS

        for _ in range(max_attempts):
            self.user_manager.authenticate("superadmin", "WrongPassword123!")

        self.user_manager.current_user = {"username": "superadmin", "role": "super_admin"}
        success, message = self.user_manager.unlock_user_account("superadmin")

        self.assertTrue(success)
        self.assertIn("desbloqueada", message.lower())

        success, _ = self.user_manager.authenticate("superadmin", self.superadmin_password)
        self.assertTrue(success)

    def test_create_user_permissions(self):
        self.user_manager.initialize_system("superadmin", self.superadmin_password)
        self.user_manager.authenticate("superadmin", self.superadmin_password)

        self.user_manager.create_user("admin_user", self.admin_password, role="admin")
        self.user_manager.create_user("viewer_user", self.viewer_password, role="viewer")

        users_data = self.user_manager._load_users()

        self.assertEqual(users_data["users"]["admin_user"]["permissions"], ["read", "write"])
        self.assertEqual(users_data["users"]["viewer_user"]["permissions"], ["read"])
        self.assertEqual(users_data["users"]["superadmin"]["permissions"], ["all"])

    def test_create_superadmin_permissions(self):
        self.user_manager.initialize_system("superadmin", self.superadmin_password)
        self.user_manager.authenticate("superadmin", self.superadmin_password)

        self.user_manager.create_user("superadmin2", self.new_superadmin_password, role="super_admin")

        users_data = self.user_manager._load_users()
        self.assertEqual(users_data["users"]["superadmin2"]["role"], "super_admin")
        self.assertEqual(users_data["users"]["superadmin2"]["permissions"], ["all"])

    def test_change_password(self):
        self.user_manager.initialize_system("superadmin", self.superadmin_password)

        success, message = self.user_manager.change_password(
            "superadmin", self.superadmin_password, self.new_superadmin_password
        )
        self.assertTrue(success)

        success, message = self.user_manager.authenticate("superadmin", self.superadmin_password)
        self.assertFalse(success)

        success, message = self.user_manager.authenticate("superadmin", self.new_superadmin_password)
        self.assertTrue(success)

    def test_change_password_rejects_recent_password_reuse(self):
        self.user_manager.initialize_system("superadmin", self.superadmin_password)

        success, _ = self.user_manager.change_password(
            "superadmin", self.superadmin_password, self.new_superadmin_password
        )
        self.assertTrue(success)

        success, message = self.user_manager.change_password(
            "superadmin", self.new_superadmin_password, self.superadmin_password
        )
        self.assertFalse(success)
        self.assertIn("No puedes reutilizar", message)

    def test_decode_cloud_users_payload_rejects_invalid_integrity(self):
        cloud = MagicMock()
        security = MagicMock()
        manager = UserManagerV2(cloud_manager=cloud, security_manager=security, local_mode=False)
        manager.cloud_encryption = MagicMock()
        manager.cloud_encryption.decrypt_cloud_data.return_value = {}

        payload = {
            "_encrypted": True,
            "_hmac": "invalid",
            "users": {
                "administrador": {
                    "username": "administrador",
                    "role": "super_admin",
                }
            },
        }

        with self.assertRaises(SecurityError):
            manager._decode_cloud_users_payload(payload)

    def test_load_users_fails_closed_when_cloud_payload_is_invalid(self):
        local_backup = {
            "users": {
                "administrador": {
                    "username": "administrador",
                    "password_hash": "hash",
                    "role": "super_admin",
                    "active": True,
                }
            },
            "created_at": "2026-02-17T00:00:00",
            "version": "2.1",
        }
        fallback_file = self.test_dir / "users.json"
        fallback_file.write_text(json.dumps(local_backup), encoding="utf-8")

        cloud = MagicMock()
        cloud.download_file_content.return_value = json.dumps(
            {
                "_encrypted": True,
                "_hmac": "invalid",
                "users": "tampered",
            }
        )
        security = MagicMock()
        manager = UserManagerV2(cloud_manager=cloud, security_manager=security, local_mode=False)
        manager.config_dir = self.test_dir
        manager.cloud_encryption = MagicMock()
        manager.cloud_encryption.decrypt_cloud_data.return_value = {}

        with patch.object(manager, "_save_users") as mock_save:
            with self.assertRaises(CloudStorageError):
                manager._load_users()

        mock_save.assert_not_called()

    def test_load_users_fails_closed_with_utf8_bom_backup_when_cloud_payload_is_invalid(self):
        local_backup = {
            "users": {
                "administrador": {
                    "username": "administrador",
                    "password_hash": "hash",
                    "role": "super_admin",
                    "active": True,
                }
            }
        }
        fallback_file = self.test_dir / "users.json"
        fallback_file.write_text(json.dumps(local_backup), encoding="utf-8-sig")

        cloud = MagicMock()
        cloud.download_file_content.return_value = json.dumps(
            {
                "_encrypted": True,
                "_hmac": "invalid",
                "users": "tampered",
            }
        )
        security = MagicMock()
        manager = UserManagerV2(cloud_manager=cloud, security_manager=security, local_mode=False)
        manager.config_dir = self.test_dir
        manager.cloud_encryption = MagicMock()
        manager.cloud_encryption.decrypt_cloud_data.return_value = {}

        with self.assertRaises(CloudStorageError):
            manager._load_users()

    def test_load_users_cloud_cache_uses_ttl(self):
        cloud = MagicMock()
        cloud.download_file_content.return_value = json.dumps(
            {
                "users": {
                    "cached_user": {
                        "username": "cached_user",
                        "password_hash": "hash",
                        "role": "admin",
                        "active": True,
                    }
                }
            }
        )
        security = MagicMock()
        manager = UserManagerV2(cloud_manager=cloud, security_manager=security, local_mode=False)
        manager._cache_clock = MagicMock(return_value=100.0)

        first = manager._load_users()
        second = manager._load_users()

        self.assertIn("cached_user", first["users"])
        self.assertIn("cached_user", second["users"])
        # Primer load: miss, segundo: hit.
        self.assertEqual(cloud.download_file_content.call_count, 1)

        # Invalidación explícita por expiración simulada del TTL.
        manager._users_cache_loaded_at = 0.0
        third = manager._load_users()
        self.assertIn("cached_user", third["users"])
        self.assertEqual(cloud.download_file_content.call_count, 2)

    def test_save_users_refreshes_cloud_cache(self):
        cloud = MagicMock()
        cloud.download_file_content.return_value = json.dumps(
            {
                "users": {
                    "legacy_user": {
                        "username": "legacy_user",
                        "password_hash": "hash",
                        "role": "admin",
                        "active": True,
                    }
                }
            }
        )
        security = MagicMock()
        manager = UserManagerV2(cloud_manager=cloud, security_manager=security, local_mode=False)
        manager._load_users()

        new_users_payload = {
            "users": {
                "new_user": {
                    "username": "new_user",
                    "password_hash": "new_hash",
                    "role": "viewer",
                    "active": True,
                }
            }
        }
        manager._save_users(new_users_payload)
        cloud.download_file_content.reset_mock()

        cached_users = manager._load_users()

        self.assertIn("new_user", cached_users["users"])
        cloud.download_file_content.assert_not_called()

    def test_log_access_uses_audit_api_when_available(self):
        cloud = MagicMock()
        security = MagicMock()
        audit_api = MagicMock()
        manager = UserManagerV2(
            cloud_manager=cloud,
            security_manager=security,
            local_mode=False,
            audit_api_client=audit_api,
        )

        manager._log_access("login_success", "admin_root", True, {"role": "super_admin"})

        audit_api._make_request.assert_called_once()
        args, kwargs = audit_api._make_request.call_args
        self.assertEqual(args[0], "post")
        self.assertEqual(args[1], "audit-logs")
        self.assertEqual(kwargs["json"]["action"], "login_success")
        cloud.download_file_content.assert_not_called()
        cloud.upload_file_content.assert_not_called()

    def test_log_access_legacy_retries_and_merges_when_race_detected(self):
        cloud = MagicMock()
        security = MagicMock()
        manager = UserManagerV2(cloud_manager=cloud, security_manager=security, local_mode=False)
        manager._cache_clock = MagicMock(return_value=0.0)

        baseline_log = {
            "timestamp": "2026-02-01T10:00:00",
            "action": "baseline",
            "username": "system",
            "success": True,
            "details": {},
            "system_info": {"computer_name": "PC-01", "ip": "10.0.0.1", "platform": "Windows"},
        }
        concurrent_log = {
            "timestamp": "2026-02-01T10:00:01",
            "action": "concurrent_write",
            "username": "other_admin",
            "success": True,
            "details": {},
            "system_info": {"computer_name": "PC-02", "ip": "10.0.0.2", "platform": "Windows"},
        }

        load_call_count = {"value": 0}
        persisted_payloads = []

        def fake_load():
            load_call_count["value"] += 1
            if load_call_count["value"] == 1:
                return {"logs": [baseline_log], "created_at": "2026-02-01T09:00:00"}
            if load_call_count["value"] == 2:
                # Verificación post-escritura del intento 1: simula que otro proceso sobrescribió
                return {"logs": [baseline_log, concurrent_log], "created_at": "2026-02-01T09:00:00"}
            if load_call_count["value"] == 3:
                return {"logs": [baseline_log, concurrent_log], "created_at": "2026-02-01T09:00:00"}
            return persisted_payloads[-1]

        def fake_persist(payload):
            persisted_payloads.append(payload)

        with patch.object(manager, "_load_legacy_logs_data", side_effect=fake_load):
            with patch.object(manager, "_persist_logs_data", side_effect=fake_persist):
                manager._log_access("login_success", "admin_root", True, {"role": "super_admin"})

        self.assertGreaterEqual(len(persisted_payloads), 2)
        final_actions = [entry["action"] for entry in persisted_payloads[-1]["logs"]]
        self.assertIn("concurrent_write", final_actions)
        self.assertIn("login_success", final_actions)

    def test_get_access_logs_reads_from_audit_api_and_normalizes_payload(self):
        cloud = MagicMock()
        security = MagicMock()
        audit_api = MagicMock()
        audit_api._make_request.return_value = [
            {
                "id": 2,
                "timestamp": "2026-08-02T10:00:00",
                "action": "login_success",
                "username": "admin",
                "success": 1,
                "details": "{\"ip\":\"10.0.0.10\"}",
                "computer_name": "PC-02",
                "ip_address": "10.0.0.10",
                "platform": "Windows",
            },
            {
                "id": 1,
                "timestamp": "2026-08-01T10:00:00",
                "action": "login_failed",
                "username": "admin",
                "success": 0,
                "details": "{}",
                "computer_name": "PC-02",
                "ip_address": "10.0.0.10",
                "platform": "Windows",
            },
        ]
        manager = UserManagerV2(
            cloud_manager=cloud,
            security_manager=security,
            local_mode=False,
            audit_api_client=audit_api,
        )
        manager.current_user = {"username": "admin", "role": "super_admin"}

        logs = manager.get_access_logs(limit=100)

        self.assertEqual(len(logs), 2)
        # Se devuelve en orden ASC para mantener compatibilidad con la UI.
        self.assertEqual(logs[0]["action"], "login_failed")
        self.assertEqual(logs[1]["action"], "login_success")
        self.assertEqual(logs[1]["details"]["ip"], "10.0.0.10")
        self.assertTrue(logs[1]["success"])


if __name__ == "__main__":
    unittest.main()

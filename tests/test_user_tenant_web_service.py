import unittest
from unittest.mock import MagicMock, patch

from managers.user_tenant_web_service import UserTenantWebService


class TestUserTenantWebService(unittest.TestCase):
    def setUp(self):
        self.owner = MagicMock()
        self.owner.logger = MagicMock()
        self.owner.current_user = {
            "username": "superadmin",
            "role": "super_admin",
            "source": "web",
        }
        self.owner.current_web_token = "token-current"
        self.owner.current_web_token_type = "Bearer"
        self.owner.audit_api_client = MagicMock()
        self.owner.audit_api_client._get_api_url.return_value = "https://example.workers.dev"
        self.owner.password_validator = MagicMock()
        self.owner.password_validator.validate_password_strength.return_value = (
            True,
            "ok",
            90,
        )
        self.owner._verify_current_web_password.return_value = {
            "Authorization": "Bearer token-current",
        }
        self.owner._extract_http_error_message.return_value = "bad request"
        self.owner._log_access = MagicMock()
        self.service = UserTenantWebService(self.owner)

    @patch("managers.user_tenant_web_service.requests.post")
    def test_create_tenant_web_user_sends_optional_tenant_id_as_none(self, mock_post):
        response = MagicMock()
        response.ok = True
        response.content = b'{"ok":true}'
        response.json.return_value = {"ok": True}
        mock_post.return_value = response

        success, message = self.service.create_tenant_web_user(
            username="Diego",
            password="Q4@rZ8!kP1#sM7t",
            role="admin",
            tenant_id="",
            admin_web_password="AdminPass123!",
        )

        self.assertTrue(success)
        self.assertIn("usuario web creado", message.lower())
        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], "https://example.workers.dev/web/auth/users")
        self.assertIsNone(kwargs["json"]["tenant_id"])

    @patch("managers.user_tenant_web_service.requests.get")
    def test_fetch_tenant_web_users_normalizes_api_payload(self, mock_get):
        response = MagicMock()
        response.ok = True
        response.content = b'{"ok":true}'
        response.json.return_value = {
            "users": [
                {
                    "username": "viewer01",
                    "role": "viewer",
                    "tenant_id": "tenant-a",
                    "is_active": True,
                    "last_login_at": None,
                    "created_at": "2026-01-01T00:00:00",
                }
            ]
        }
        mock_get.return_value = response

        users = self.service.fetch_tenant_web_users(
            admin_web_password="AdminPass123!",
            tenant_id="tenant-a",
        )

        self.assertEqual(len(users), 1)
        self.assertEqual(users[0]["username"], "viewer01")
        self.assertEqual(users[0]["source"], "web")
        args, kwargs = mock_get.call_args
        self.assertEqual(args[0], "https://example.workers.dev/web/auth/users")
        self.assertEqual(kwargs["params"], {"tenant_id": "tenant-a"})


if __name__ == "__main__":
    unittest.main()

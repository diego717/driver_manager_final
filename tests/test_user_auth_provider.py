import unittest
from unittest.mock import MagicMock

from managers.user_auth_provider import UserAuthProvider


class TestUserAuthProvider(unittest.TestCase):
    def setUp(self):
        self.owner = MagicMock()
        self.owner.AUTH_MODE_LEGACY = "legacy"
        self.owner.AUTH_MODE_WEB = "web"
        self.owner.AUTH_MODE_AUTO = "auto"
        self.owner.ALLOWED_AUTH_MODES = {"legacy", "web", "auto"}
        self.owner.current_web_token = "token-123"
        self.owner.current_web_token_type = "Bearer"
        self.owner.current_user = {
            "username": "superadmin",
            "role": "super_admin",
            "source": "web",
        }
        self.owner.audit_api_client = None
        self.owner.logger = MagicMock()
        self.provider = UserAuthProvider(self.owner)

    def test_resolve_current_web_access_token(self):
        self.assertEqual(self.provider._resolve_current_web_access_token(), "token-123")

    def test_handle_audit_api_web_auth_failure_clears_web_session(self):
        self.provider._handle_audit_api_web_auth_failure("expired")

        self.assertIsNone(self.owner.current_user)
        self.assertIsNone(self.owner.current_web_token)
        self.assertEqual(self.owner.current_web_token_type, "Bearer")

    def test_permissions_for_role(self):
        self.assertEqual(self.provider._permissions_for_role("super_admin"), ["all"])
        self.assertIn("write", self.provider._permissions_for_role("admin"))
        self.assertIn("manage_tenant", self.provider._permissions_for_role("admin"))
        self.assertEqual(
            self.provider._permissions_for_role("supervisor"),
            ["read", "write_operational", "manage_assignments"],
        )
        self.assertEqual(
            self.provider._permissions_for_role("tecnico"),
            ["read", "write_operational"],
        )
        self.assertEqual(self.provider._permissions_for_role("solo_lectura"), ["read"])
        self.assertEqual(self.provider._permissions_for_role("viewer"), ["read"])

    def test_build_web_current_user_supports_tenant_roles(self):
        user = self.provider._build_web_current_user(
            "campo01",
            {
                "id": 9,
                "username": "campo01",
                "role": "tecnico",
                "tenant_id": "tenant-a",
            },
        )

        self.assertEqual(user["role"], "tecnico")
        self.assertEqual(user["tenant_id"], "tenant-a")
        self.assertEqual(user["permissions"], ["read", "write_operational"])

    def test_build_web_current_user_maps_legacy_viewer_to_solo_lectura(self):
        user = self.provider._build_web_current_user(
            "viewer01",
            {
                "username": "viewer01",
                "role": "viewer",
            },
        )

        self.assertEqual(user["role"], "solo_lectura")
        self.assertEqual(user["permissions"], ["read"])


if __name__ == "__main__":
    unittest.main()

import unittest
from unittest.mock import MagicMock

from managers.user_audit_service import UserAuditService


class TestUserAuditService(unittest.TestCase):
    def setUp(self):
        self.owner = MagicMock()
        self.owner.local_mode = False
        self.owner.AUTH_MODE_LEGACY = "legacy"
        self.owner.AUTH_MODE_WEB = "web"
        self.owner.AUTH_MODE_AUTO = "auto"
        self.owner.current_web_token = ""
        self.owner.auth_mode = "legacy"
        self.owner.logger = MagicMock()
        self.owner.audit_api_client = MagicMock()
        self.owner.audit_api_client._current_desktop_auth_mode.return_value = "legacy"
        self.owner.audit_api_client._get_web_access_token.return_value = ""
        self.owner.audit_api_client.allow_unsigned_requests = False
        self.owner.audit_api_client.api_token = "token"
        self.owner.audit_api_client.api_secret = "secret"
        self.service = UserAuditService(self.owner)

    def test_can_use_audit_api_with_legacy_signed_auth(self):
        self.assertTrue(self.service._can_use_audit_api())

    def test_normalize_audit_api_log_entry(self):
        entry = self.service._normalize_audit_api_log_entry(
            {
                "timestamp": "2026-03-19T10:00:00",
                "action": "login_success",
                "username": "admin",
                "success": 1,
                "details": "{\"ip\":\"10.0.0.1\"}",
                "computer_name": "PC-01",
                "ip_address": "10.0.0.1",
                "platform": "Windows",
            }
        )

        self.assertTrue(entry["success"])
        self.assertEqual(entry["details"], {"ip": "10.0.0.1"})
        self.assertEqual(entry["system_info"]["computer_name"], "PC-01")

    def test_get_access_logs_prefers_audit_api_and_returns_ascending_order(self):
        self.owner.current_user = {"username": "admin", "role": "super_admin"}
        self.owner.audit_api_client._make_request.return_value = [
            {
                "timestamp": "2026-03-19T11:00:00",
                "action": "login_success",
                "username": "admin",
                "success": 1,
                "details": "{}",
                "computer_name": "PC-02",
                "ip_address": "10.0.0.2",
                "platform": "Windows",
            },
            {
                "timestamp": "2026-03-19T10:00:00",
                "action": "login_failed",
                "username": "admin",
                "success": 0,
                "details": "{}",
                "computer_name": "PC-02",
                "ip_address": "10.0.0.2",
                "platform": "Windows",
            },
        ]

        logs = self.service.get_access_logs(limit=50)

        self.assertEqual(len(logs), 2)
        self.assertEqual(logs[0]["action"], "login_failed")
        self.assertEqual(logs[1]["action"], "login_success")


if __name__ == "__main__":
    unittest.main()

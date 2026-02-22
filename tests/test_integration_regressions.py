import shutil
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from managers.history_manager import InstallationHistory
from managers.user_manager_v2 import UserManagerV2


class TestTimestampRegressionIntegration(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path("tests/temp_integration")
        self.test_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir)

    def test_local_and_api_logs_use_timestamp_key_even_if_api_sends_legacy_typo(self):
        manager_local = UserManagerV2(local_mode=True)
        manager_local.config_dir = self.test_dir
        manager_local.logs_file = self.test_dir / "access_logs.json"
        manager_local.current_user = {"username": "admin", "role": "super_admin"}

        manager_local._log_access("login_success", "admin", True, {"source": "local"})
        local_logs = manager_local.get_access_logs(limit=10)
        self.assertTrue(local_logs)
        local_entry = local_logs[-1]
        self.assertIn("timestamp", local_entry)

        audit_api = MagicMock()
        audit_api._make_request.return_value = [
            {
                "id": 1,
                "timest\u00e1mp": local_entry["timestamp"],
                "action": local_entry["action"],
                "username": local_entry["username"],
                "success": 1,
                "details": "{\"source\":\"api\"}",
                "computer_name": "PC-01",
                "ip_address": "10.0.0.1",
                "platform": "Windows",
            }
        ]
        manager_api = UserManagerV2(
            cloud_manager=MagicMock(),
            security_manager=MagicMock(),
            local_mode=False,
            audit_api_client=audit_api,
        )
        manager_api.current_user = {"username": "admin", "role": "super_admin"}

        api_logs = manager_api.get_access_logs(limit=10)
        self.assertEqual(len(api_logs), 1)
        api_entry = api_logs[0]

        self.assertIn("timestamp", api_entry)
        self.assertEqual(api_entry["timestamp"], local_entry["timestamp"])
        self.assertEqual(api_entry["action"], local_entry["action"])
        self.assertEqual(api_entry["username"], local_entry["username"])
        self.assertTrue(api_entry["success"])


class TestPathTraversalRegressionIntegration(unittest.TestCase):
    def setUp(self):
        self.mock_config = MagicMock()
        self.mock_config.load_config_data.return_value = {"api_url": "https://api.example.com/"}
        self.history = InstallationHistory(self.mock_config)

    @patch("managers.history_manager.requests.request")
    def test_malicious_record_id_is_rejected_before_building_any_request_url(self, mock_request):
        result_get = self.history.get_installation_by_id("../../audit-logs")
        result_update = self.history.update_installation_details("../../audit-logs", "nota", "1.5")
        result_delete = self.history.delete_installation("../../audit-logs")

        self.assertIsNone(result_get)
        self.assertFalse(result_update)
        self.assertFalse(result_delete)
        mock_request.assert_not_called()


if __name__ == "__main__":
    unittest.main()

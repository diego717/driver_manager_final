import unittest
from unittest.mock import MagicMock, patch

from managers.history_manager import InstallationHistory


class TestInstallationHistory(unittest.TestCase):
    def setUp(self):
        self.mock_config = MagicMock()
        self.mock_config.load_config_data.return_value = {
            "api_url": "https://api.example.com/"
        }
        self.history = InstallationHistory(self.mock_config)

    def test_get_api_url_uses_config_in_test_environment(self):
        url = self.history._get_api_url()
        self.assertEqual(url, "https://api.example.com")

    @patch("managers.history_manager.requests.request")
    def test_make_request_success_returns_json(self, mock_request):
        mock_response = MagicMock()
        mock_response.content = b'{"ok": true}'
        mock_response.json.return_value = {"ok": True}
        mock_response.raise_for_status.return_value = None
        mock_request.return_value = mock_response

        response = self.history._make_request(
            "get",
            "installations",
            params={"limit": 10},
        )

        self.assertEqual(response, {"ok": True})
        mock_request.assert_called_once_with(
            "get",
            "https://api.example.com/installations",
            headers={"Content-Type": "application/json"},
            params={"limit": 10},
            timeout=10,
        )

    @patch("managers.history_manager.requests.request")
    def test_make_request_raises_connection_error(self, mock_request):
        mock_request.side_effect = Exception("boom")

        with self.assertRaises(ConnectionError):
            self.history._make_request("get", "installations")

    @patch.object(InstallationHistory, "_save_local")
    @patch.object(InstallationHistory, "_make_request")
    def test_add_installation_builds_payload_and_syncs(
        self, mock_make_request, mock_save_local
    ):
        mock_make_request.return_value = {"success": True}

        success = self.history.add_installation(
            brand="Zebra",
            version="1.2.3",
            status="success",
            client="Cliente A",
            description="Driver test",
            installation_time=45,
            notes="ok",
        )

        self.assertTrue(success)
        mock_save_local.assert_called_once()
        mock_make_request.assert_called_once()
        args, kwargs = mock_make_request.call_args
        self.assertEqual(args[0], "post")
        self.assertEqual(args[1], "installations")
        self.assertEqual(kwargs["json"]["driver_brand"], "Zebra")
        self.assertEqual(kwargs["json"]["driver_version"], "1.2.3")
        self.assertEqual(kwargs["json"]["installation_time_seconds"], 45)

    @patch.object(InstallationHistory, "_make_request")
    def test_add_installation_returns_false_on_connection_error(self, mock_make_request):
        mock_make_request.side_effect = ConnectionError("offline")

        success = self.history.add_installation(
            brand="Zebra",
            version="1.2.3",
            status="failed",
        )

        self.assertFalse(success)

    @patch.object(InstallationHistory, "_make_request")
    def test_update_installation_details_converts_minutes_to_seconds(self, mock_make_request):
        mock_make_request.return_value = {"success": True}

        success = self.history.update_installation_details("10", "nota", "2.5")

        self.assertTrue(success)
        args, kwargs = mock_make_request.call_args
        self.assertEqual(args[0], "put")
        self.assertEqual(args[1], "installations/10")
        self.assertEqual(kwargs["json"]["installation_time_seconds"], 150)
        self.assertEqual(kwargs["json"]["notes"], "nota")

    @patch.object(InstallationHistory, "_make_request")
    @patch.object(InstallationHistory, "get_installations")
    def test_get_installation_by_id_falls_back_after_404(
        self, mock_get_installations, mock_make_request
    ):
        mock_make_request.side_effect = ConnectionError("404 not found")
        mock_get_installations.return_value = [{"id": 99, "driver_brand": "Zebra"}]

        result = self.history.get_installation_by_id(99)

        self.assertEqual(result, {"id": 99, "driver_brand": "Zebra"})
        mock_get_installations.assert_called_once_with(limit=50)

    @patch.object(InstallationHistory, "_make_request")
    def test_get_statistics_returns_fallback_on_error(self, mock_make_request):
        mock_make_request.side_effect = Exception("network down")

        stats = self.history.get_statistics()

        self.assertEqual(stats["total_installations"], 0)
        self.assertIn("by_brand", stats)


if __name__ == "__main__":
    unittest.main()

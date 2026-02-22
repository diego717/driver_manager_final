import unittest
import os
import hmac
import hashlib
import json
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

    @patch.dict(
        os.environ,
        {
            "DRIVER_MANAGER_API_TOKEN": "env-token-123",
            "DRIVER_MANAGER_API_SECRET": "env-secret-abc",
        },
        clear=False,
    )
    def test_initialize_api_config_uses_env_auth_when_missing_in_config(self):
        self.mock_config.load_config_data.return_value = {
            "api_url": "https://api.example.com/"
        }

        history = InstallationHistory(self.mock_config)

        self.assertEqual(history.api_token, "env-token-123")
        self.assertEqual(history.api_secret, "env-secret-abc")

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

    @patch("managers.history_manager.requests.request")
    def test_make_request_post_json_sends_utf8_bytes_payload(self, mock_request):
        mock_response = MagicMock()
        mock_response.content = b'{"ok": true}'
        mock_response.json.return_value = {"ok": True}
        mock_response.raise_for_status.return_value = None
        mock_request.return_value = mock_response

        payload = {"notes": "texto con acentos áéíóú", "status": "manual"}
        self.history._make_request("post", "records", json=payload)

        _args, kwargs = mock_request.call_args
        sent_data = kwargs.get("data")
        self.assertIsInstance(sent_data, bytes)

        expected = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.assertEqual(sent_data, expected)

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

    @patch.object(InstallationHistory, "_save_local")
    @patch.object(InstallationHistory, "_make_request")
    def test_create_manual_record_uses_records_endpoint(
        self, mock_make_request, mock_save_local
    ):
        mock_make_request.return_value = {"success": True, "record": {"id": 123}}

        success, record = self.history.create_manual_record(
            client_name="Cliente A",
            notes="Registro sin instalacion previa",
        )

        self.assertTrue(success)
        self.assertEqual(record, {"id": 123})
        mock_save_local.assert_called_once()
        args, kwargs = mock_make_request.call_args
        self.assertEqual(args[0], "post")
        self.assertEqual(args[1], "records")
        self.assertEqual(kwargs["json"]["status"], "manual")
        self.assertEqual(kwargs["json"]["client_name"], "Cliente A")

    @patch.object(InstallationHistory, "_make_request")
    def test_create_manual_record_returns_false_on_connection_error(self, mock_make_request):
        mock_make_request.side_effect = ConnectionError("offline")

        success, record = self.history.create_manual_record(notes="x")

        self.assertFalse(success)
        self.assertIsNone(record)

    @patch.object(InstallationHistory, "_make_request")
    def test_update_installation_details_uses_seconds_payload(self, mock_make_request):
        mock_make_request.return_value = {"success": True}

        success = self.history.update_installation_details("10", "nota", "45")

        self.assertTrue(success)
        args, kwargs = mock_make_request.call_args
        self.assertEqual(args[0], "put")
        self.assertEqual(args[1], "installations/10")
        self.assertEqual(kwargs["json"]["installation_time_seconds"], 45)
        self.assertEqual(kwargs["json"]["notes"], "nota")

    @patch.object(InstallationHistory, "_make_request")
    def test_get_installation_by_id_requests_direct_endpoint(
        self, mock_make_request
    ):
        mock_make_request.return_value = {"id": 99, "driver_brand": "Zebra"}

        result = self.history.get_installation_by_id(99)

        self.assertEqual(result, {"id": 99, "driver_brand": "Zebra"})
        mock_make_request.assert_called_once_with("get", "installations/99")

    @patch.object(InstallationHistory, "_make_request")
    def test_get_installation_by_id_rejects_invalid_id(self, mock_make_request):
        result = self.history.get_installation_by_id("../../audit-logs")

        self.assertIsNone(result)
        mock_make_request.assert_not_called()

    @patch.object(InstallationHistory, "_make_request")
    def test_update_installation_details_rejects_invalid_id(self, mock_make_request):
        success = self.history.update_installation_details("../../audit-logs", "nota", "2.5")

        self.assertFalse(success)
        mock_make_request.assert_not_called()

    @patch.object(InstallationHistory, "_make_request")
    def test_delete_installation_rejects_invalid_id(self, mock_make_request):
        success = self.history.delete_installation("../../audit-logs")

        self.assertFalse(success)
        mock_make_request.assert_not_called()

    @patch.object(InstallationHistory, "_make_request")
    def test_get_statistics_returns_fallback_on_error(self, mock_make_request):
        mock_make_request.side_effect = Exception("network down")

        stats = self.history.get_statistics()

        self.assertEqual(stats["total_installations"], 0)
        self.assertIn("by_brand", stats)

    @patch("managers.history_manager.time.time", return_value=1700000000)
    def test_get_headers_uses_worker_canonical_signature(self, _mock_time):
        self.mock_config.load_config_data.return_value = {
            "api_url": "https://api.example.com/",
            "api_token": "token-123",
            "api_secret": "secret-abc",
        }
        history = InstallationHistory(self.mock_config)

        empty_hash = hashlib.sha256(b"").hexdigest()
        headers = history._get_headers("GET", "/installations", empty_hash)

        expected_canonical = f"GET|/installations|1700000000|{empty_hash}"
        expected_signature = hmac.new(
            b"secret-abc",
            expected_canonical.encode(),
            hashlib.sha256,
        ).hexdigest()

        self.assertEqual(headers["X-API-Token"], "token-123")
        self.assertEqual(headers["X-Request-Timestamp"], "1700000000")
        self.assertEqual(headers["X-Request-Signature"], expected_signature)

    @patch.object(InstallationHistory, "get_installations")
    @patch.object(InstallationHistory, "_make_request")
    def test_get_statistics_normalizes_partial_worker_response(
        self, mock_make_request, mock_get_installations
    ):
        mock_make_request.return_value = {"by_brand": {"Zebra": 2}}
        mock_get_installations.return_value = [
            {
                "id": 1,
                "driver_brand": "Zebra",
                "driver_version": "1.0",
                "status": "success",
                "installation_time_seconds": 120,
                "client_name": "Cliente A",
            },
            {
                "id": 2,
                "driver_brand": "Magicard",
                "driver_version": "2.0",
                "status": "failed",
                "installation_time_seconds": 0,
                "client_name": "Cliente B",
            },
        ]

        stats = self.history.get_statistics()

        self.assertEqual(stats["total_installations"], 0)
        self.assertEqual(stats["successful_installations"], 0)
        self.assertEqual(stats["failed_installations"], 0)
        self.assertEqual(stats["unique_clients"], 0)
        self.assertEqual(stats["by_brand"], {"Zebra": 2})
        mock_get_installations.assert_not_called()

    @patch.object(InstallationHistory, "get_installations")
    @patch.object(InstallationHistory, "_make_request")
    def test_get_statistics_empty_worker_response_uses_installations_fallback(
        self, mock_make_request, mock_get_installations
    ):
        mock_make_request.return_value = {}
        mock_get_installations.return_value = [
            {
                "id": 1,
                "driver_brand": "Zebra",
                "driver_version": "1.0",
                "status": "success",
                "installation_time_seconds": 120,
                "client_name": "Cliente A",
            },
            {
                "id": 2,
                "driver_brand": "Magicard",
                "driver_version": "2.0",
                "status": "failed",
                "installation_time_seconds": 0,
                "client_name": "Cliente B",
            },
        ]

        stats = self.history.get_statistics()

        self.assertEqual(stats["total_installations"], 2)
        self.assertEqual(stats["successful_installations"], 1)
        self.assertEqual(stats["failed_installations"], 1)
        self.assertEqual(stats["unique_clients"], 2)
        mock_get_installations.assert_called_once()

    @patch.object(InstallationHistory, "_make_request")
    def test_get_installations_applies_local_date_filter_when_worker_ignores_params(
        self, mock_make_request
    ):
        mock_make_request.return_value = [
            {
                "id": 1,
                "timestamp": "2026-07-15T10:00:00",
                "driver_brand": "Zebra",
                "status": "success",
            },
            {
                "id": 2,
                "timestamp": "2025-07-20T10:00:00",
                "driver_brand": "Magicard",
                "status": "failed",
            },
            {
                "id": 3,
                "timestamp": "2026-08-01T00:00:00",
                "driver_brand": "Zebra",
                "status": "success",
            },
        ]

        installations = self.history.get_installations(
            start_date="2026-07-01T00:00:00",
            end_date="2026-08-01T00:00:00",
        )

        self.assertEqual([item["id"] for item in installations], [1])

    @patch.object(InstallationHistory, "_make_request")
    def test_get_statistics_with_date_filters_calls_worker_statistics_endpoint(
        self, mock_make_request
    ):
        mock_make_request.return_value = {
            "total_installations": 1,
            "successful_installations": 1,
            "failed_installations": 0,
            "success_rate": 100,
            "average_time_minutes": 2,
            "unique_clients": 1,
            "top_drivers": {"Zebra 1.0": 1},
            "by_brand": {"Zebra": 1},
        }

        stats = self.history.get_statistics(
            start_date="2026-02-01T00:00:00",
            end_date="2026-03-01T00:00:00",
        )

        self.assertEqual(stats["total_installations"], 1)
        self.assertEqual(stats["successful_installations"], 1)
        self.assertEqual(stats["failed_installations"], 0)
        self.assertEqual(stats["by_brand"], {"Zebra": 1})
        mock_make_request.assert_called_once_with(
            "get",
            "statistics",
            params={
                "start_date": "2026-02-01T00:00:00",
                "end_date": "2026-03-01T00:00:00",
            },
        )


if __name__ == "__main__":
    unittest.main()

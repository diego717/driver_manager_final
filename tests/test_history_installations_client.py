import unittest
from unittest.mock import MagicMock

from managers.history_installations_client import HistoryInstallationsClient


class TestHistoryInstallationsClient(unittest.TestCase):
    def setUp(self):
        self.request = MagicMock()
        self.client = HistoryInstallationsClient(self.request)

    def test_create_installation_builds_expected_payload(self):
        payload = self.client.create_installation(
            {
                "timestamp": "2026-03-19T10:00:00",
                "brand": "Zebra",
                "version": "1.2.3",
                "status": "success",
                "client": "Cliente A",
                "description": "Driver test",
                "installation_time": 45,
                "os_info": "Windows",
                "notes": "ok",
            }
        )

        self.assertEqual(payload["driver_brand"], "Zebra")
        self.assertEqual(payload["driver_version"], "1.2.3")
        self.assertEqual(payload["installation_time_seconds"], 45)
        self.assertEqual(payload["os_info"], "Windows")
        self.request.assert_called_once_with("post", "installations", json=payload)

    def test_create_manual_record_returns_record(self):
        self.request.return_value = {"record": {"id": 123}}

        payload, record = self.client.create_manual_record(
            {
                "timestamp": "2026-03-19T11:00:00",
                "client_name": "Cliente A",
                "notes": "manual",
                "os_info": "Windows",
            }
        )

        self.assertEqual(payload["status"], "manual")
        self.assertEqual(record, {"id": 123})
        self.request.assert_called_once_with("post", "records", json=payload)

    def test_update_installation_details_normalizes_seconds(self):
        payload = self.client.update_installation_details(99, "nota", "2.8")

        self.assertEqual(
            payload,
            {"notes": "nota", "installation_time_seconds": 2},
        )
        self.request.assert_called_once_with(
            "put",
            "installations/99",
            json=payload,
        )

    def test_list_installations_and_statistics_delegate_to_request(self):
        self.request.side_effect = [
            [{"id": 1}],
            {"by_brand": {"Zebra": 2}},
        ]

        installations = self.client.list_installations(params={"limit": 10})
        stats = self.client.get_statistics(params={"start_date": "2026-03-01"})

        self.assertEqual(installations, [{"id": 1}])
        self.assertEqual(stats, {"by_brand": {"Zebra": 2}})
        self.assertEqual(self.request.call_count, 2)


if __name__ == "__main__":
    unittest.main()

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from managers.history_incidents_client import HistoryIncidentsClient


class TestHistoryIncidentsClient(unittest.TestCase):
    def setUp(self):
        self.request = MagicMock()
        self.client = HistoryIncidentsClient(self.request)
        self.temp_dir = Path(tempfile.mkdtemp(prefix="history-incidents-"))

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_list_incidents_normalizes_lifecycle_fields(self):
        self.request.return_value = {
            "incidents": [
                {
                    "id": 1,
                    "incident_status": "OPEN",
                    "created_at": "2026-03-19T10:00:00",
                    "reporter_username": "desktop",
                }
            ]
        }

        incidents = self.client.list_incidents_for_installation(55)

        self.assertEqual(incidents[0]["incident_status"], "open")
        self.assertEqual(incidents[0]["status_updated_by"], "desktop")
        self.request.assert_called_once_with("get", "installations/55/incidents")

    def test_build_create_incident_payload_requires_note(self):
        with self.assertRaises(ValueError):
            self.client.build_create_incident_payload("")

    def test_create_and_update_incident_delegate_to_request(self):
        self.request.side_effect = [
            {"incident": {"id": 7, "incident_status": "open"}},
            {"incident": {"id": 7, "incident_status": "resolved"}},
        ]

        created = self.client.create_incident(
            11,
            self.client.build_create_incident_payload("Revisar equipo", severity="high"),
        )
        updated = self.client.update_incident_status(
            7,
            self.client.build_update_incident_status_payload("resolved", "ok"),
        )

        self.assertEqual(created["incident_status"], "open")
        self.assertEqual(updated["incident_status"], "resolved")
        self.assertEqual(self.request.call_count, 2)

    def test_upload_incident_photo_sends_binary_and_headers(self):
        photo_path = self.temp_dir / "evidence.jpg"
        photo_path.write_bytes(b"x" * 2048)
        self.request.return_value = {"photo": {"id": 99}}

        photo = self.client.upload_incident_photo(5, photo_path)

        self.assertEqual(photo, {"id": 99})
        _args, kwargs = self.request.call_args
        self.assertEqual(kwargs["extra_headers"]["Content-Type"], "image/jpeg")
        self.assertEqual(kwargs["extra_headers"]["X-File-Name"], "evidence.jpg")
        self.assertEqual(len(kwargs["data"]), 2048)

    def test_get_photo_content_returns_bytes_and_content_type(self):
        response = MagicMock()
        response.content = b"img"
        response.headers = {"Content-Type": "image/png"}
        self.request.return_value = response

        content, content_type = self.client.get_photo_content(123)

        self.assertEqual(content, b"img")
        self.assertEqual(content_type, "image/png")
        self.request.assert_called_once_with("get", "photos/123", expect_json=False)


if __name__ == "__main__":
    unittest.main()

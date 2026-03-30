import unittest
from unittest.mock import MagicMock

from managers.technician_web_service import TechnicianWebService


class TestTechnicianWebService(unittest.TestCase):
    def setUp(self):
        self.request = MagicMock()
        self.service = TechnicianWebService(self.request)

    def test_list_technicians_normalizes_payload(self):
        self.request.return_value = {
            "technicians": [
                {
                    "id": "10",
                    "tenant_id": " tenant-a ",
                    "web_user_id": "5",
                    "display_name": "  Ana Ruiz ",
                    "email": " ana@example.com ",
                    "phone": " 091234567 ",
                    "employee_code": " EMP-01 ",
                    "notes": " nota ",
                    "is_active": 1,
                    "active_assignment_count": "3",
                }
            ]
        }

        result = self.service.list_technicians(include_inactive=True)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], 10)
        self.assertEqual(result[0]["tenant_id"], "tenant-a")
        self.assertEqual(result[0]["web_user_id"], 5)
        self.assertEqual(result[0]["display_name"], "Ana Ruiz")
        self.assertEqual(result[0]["active_assignment_count"], 3)
        self.request.assert_called_once_with(
            "get",
            "technicians",
            params={"include_inactive": "1"},
        )

    def test_create_technician_builds_expected_payload(self):
        self.request.return_value = {
            "technician": {
                "id": 11,
                "tenant_id": "tenant-a",
                "display_name": "Carlos",
                "web_user_id": None,
                "is_active": True,
            }
        }

        technician = self.service.create_technician(
            display_name=" Carlos ",
            employee_code=" EMP-03 ",
            email=" carlos@example.com ",
            phone=" 099123123 ",
            notes=" nota ",
            web_user_id=None,
        )

        self.assertEqual(technician["id"], 11)
        _args, kwargs = self.request.call_args
        self.assertEqual(kwargs["json"]["display_name"], "Carlos")
        self.assertEqual(kwargs["json"]["employee_code"], "EMP-03")
        self.assertEqual(kwargs["json"]["email"], "carlos@example.com")
        self.assertEqual(kwargs["json"]["phone"], "099123123")
        self.assertEqual(kwargs["json"]["notes"], "nota")
        self.assertIsNone(kwargs["json"]["web_user_id"])

    def test_update_technician_requires_editable_fields(self):
        with self.assertRaises(ValueError):
            self.service.update_technician(10)

    def test_list_entity_assignments_validates_entity_type(self):
        with self.assertRaises(ValueError):
            self.service.list_entity_assignments("invalid", 10)

    def test_create_assignment_for_incident(self):
        self.request.return_value = {
            "assignment": {
                "id": 501,
                "tenant_id": "tenant-a",
                "technician_id": 11,
                "entity_type": "incident",
                "entity_id": "77",
                "assignment_role": "owner",
                "assigned_by_username": "admin",
                "assigned_at": "2026-03-29T10:00:00Z",
                "unassigned_at": None,
                "metadata_json": None,
            }
        }

        assignment = self.service.create_assignment(
            technician_id=11,
            entity_type="incident",
            entity_id=77,
            assignment_role="owner",
        )

        self.assertEqual(assignment["id"], 501)
        self.assertEqual(assignment["entity_type"], "incident")
        self.assertEqual(assignment["entity_id"], "77")
        self.request.assert_called_once_with(
            "post",
            "technicians/11/assignments",
            json={
                "entity_type": "incident",
                "entity_id": "77",
                "assignment_role": "owner",
            },
        )

    def test_remove_assignment_uses_delete_endpoint(self):
        self.request.return_value = {
            "assignment": {
                "id": 80,
                "tenant_id": "tenant-a",
                "technician_id": 5,
                "entity_type": "installation",
                "entity_id": "20",
                "assignment_role": "assistant",
                "assigned_by_username": "admin",
                "assigned_at": "2026-03-29T10:00:00Z",
                "unassigned_at": "2026-03-29T12:00:00Z",
            }
        }

        assignment = self.service.remove_assignment(80)

        self.assertEqual(assignment["id"], 80)
        self.request.assert_called_once_with("delete", "technician-assignments/80")

    def test_operation_error_is_wrapped_with_consistent_message(self):
        self.request.side_effect = ConnectionError("Error HTTP 409: duplicate")

        with self.assertRaises(ConnectionError) as context:
            self.service.create_technician(display_name="Ana")

        self.assertIn("No se pudo crear tecnico.", str(context.exception))


if __name__ == "__main__":
    unittest.main()

import unittest
from types import SimpleNamespace
from unittest.mock import patch

try:
    from ui.v2_incidents_bridge import IncidentsBridge, QMessageBox
    PYQT_AVAILABLE = True
except Exception:
    PYQT_AVAILABLE = False


class DummyStatusBar:
    def __init__(self):
        self.messages = []

    def showMessage(self, message, timeout=0):
        self.messages.append((message, timeout))


@unittest.skipUnless(PYQT_AVAILABLE, "PyQt6 is required for v2 incidents bridge tests")
class IncidentsBridgeTests(unittest.TestCase):
    def _build_window(self):
        self.installations = [
            {
                "id": 45,
                "timestamp": "2026-04-04T10:00:00",
                "driver_brand": "Zebra",
                "driver_version": "1.0",
                "client_name": "Cliente Uno",
                "attention_state": "open",
                "incident_active_count": 1,
            }
        ]
        self.incidents_by_installation = {
            45: [
                {
                    "id": 77,
                    "installation_id": 45,
                    "incident_status": "open",
                    "severity": "high",
                    "note": "Falla intermitente",
                    "created_at": "2026-04-04T10:30:00",
                    "reporter_username": "ops",
                    "photos": [],
                }
            ]
        }
        self.assignments_by_incident = {
            77: [
                {
                    "id": 9,
                    "assignment_role": "owner",
                    "technician_id": 5,
                    "technician_display_name": "Ana",
                    "technician_employee_code": "EMP-1",
                }
            ]
        }
        self.status_bar = DummyStatusBar()
        self.history_calls = []
        history = SimpleNamespace(
            get_installations=lambda limit=10: list(self.installations),
            get_incidents_for_installation=lambda installation_id: list(self.incidents_by_installation.get(installation_id, [])),
            list_entity_technician_assignments=lambda entity_type, entity_id, include_inactive=False: list(self.assignments_by_incident.get(entity_id, [])),
            create_incident=lambda **kwargs: self.history_calls.append(("create_incident", kwargs)),
            update_incident_status=lambda **kwargs: self.history_calls.append(("update_incident_status", kwargs)),
            upload_incident_photo=lambda incident_id, file_path: self.history_calls.append(("upload_incident_photo", incident_id, file_path)),
            list_technicians=lambda include_inactive=False: [
                {"id": 5, "display_name": "Ana", "employee_code": "EMP-1"}
            ],
            create_technician_assignment=lambda **kwargs: self.history_calls.append(("create_assignment", kwargs)),
            remove_technician_assignment=lambda assignment_id: self.history_calls.append(("remove_assignment", assignment_id)),
            get_photo_content=lambda photo_id: (b"\xff\xd8\xff", "image/jpeg"),
        )
        return SimpleNamespace(
            history=history,
            user_manager=SimpleNamespace(current_user={"username": "desktop-user"}),
            can_operate_incidents=True,
            can_manage_operational_records=True,
            is_admin=False,
            statusBar=lambda: self.status_bar,
        )

    def test_refresh_data_loads_records_incidents_and_assignments(self):
        bridge = IncidentsBridge(self._build_window())

        bridge.refreshData()

        self.assertEqual(bridge.recordsMetric, "1")
        self.assertEqual(bridge.openIncidentsMetric, "1")
        self.assertEqual(bridge.currentRecordIndex, 0)
        self.assertEqual(bridge.currentIncidentIndex, 0)
        self.assertEqual(bridge.assignmentPanelTitle, "Ana")
        self.assertEqual(bridge.statusMessage, "1 registros operativos cargados.")

    def test_create_incident_requires_permissions(self):
        window = self._build_window()
        window.can_operate_incidents = False
        bridge = IncidentsBridge(window)

        bridge.refreshData()
        bridge.createIncident()

        self.assertEqual(
            bridge.statusMessage,
            "Selecciona un registro y usa una sesion con permisos operativos.",
        )
        self.assertEqual(self.history_calls, [])

    def test_create_incident_sends_payload_and_refreshes(self):
        bridge = IncidentsBridge(self._build_window())
        bridge.refreshData()

        with patch("ui.v2_incidents_bridge.QInputDialog.getMultiLineText", return_value=("Nueva incidencia", True)), \
             patch("ui.v2_incidents_bridge.QInputDialog.getItem", side_effect=[("high", True), ("Si", True)]):
            bridge.createIncident()

        self.assertEqual(self.history_calls[0][0], "create_incident")
        self.assertEqual(
            self.history_calls[0][1],
            {
                "installation_id": 45,
                "note": "Nueva incidencia",
                "severity": "high",
                "reporter_username": "desktop-user",
                "time_adjustment_seconds": 0,
                "apply_to_installation": True,
                "source": "desktop",
            },
        )
        self.assertEqual(bridge.statusMessage, "Incidencia creada para registro #45.")

    def test_assign_and_remove_assignment_use_history_service(self):
        bridge = IncidentsBridge(self._build_window())
        bridge.refreshData()

        with patch("ui.v2_incidents_bridge.QInputDialog.getItem", side_effect=[("#5 - Ana (EMP-1)", True), ("assistant", True)]):
            bridge.assignTechnician()

        self.assertEqual(self.history_calls[0][0], "create_assignment")
        self.assertEqual(
            self.history_calls[0][1],
            {
                "technician_id": 5,
                "entity_type": "incident",
                "entity_id": 77,
                "assignment_role": "assistant",
            },
        )

        with patch("ui.v2_incidents_bridge.QMessageBox.question", return_value=QMessageBox.StandardButton.Yes), \
             patch.object(bridge, "refreshAssignments") as refresh_assignments:
            bridge.removeAssignment()

        self.assertEqual(self.history_calls[1], ("remove_assignment", 9))
        refresh_assignments.assert_called_once()


if __name__ == "__main__":
    unittest.main()

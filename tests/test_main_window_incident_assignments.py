import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

try:
    from PyQt6.QtCore import Qt
    from ui.main_window_incidents import (
        assign_technician_to_selected_incident,
        assign_technician_to_selected_installation,
        refresh_incident_assignments,
        refresh_installation_assignments,
    )
    PYQT_AVAILABLE = True
except Exception:
    PYQT_AVAILABLE = False


class DummyListItem:
    def __init__(self, text="", payload=None):
        self._text = text
        self._payload = payload

    def data(self, _role):
        return self._payload

    def setData(self, _role, payload):
        self._payload = payload

    def text(self):
        return self._text


class DummyListWidget:
    def __init__(self, items=None, current_index=None):
        self.items = list(items or [])
        self._current_index = current_index

    def addItem(self, item):
        self.items.append(item)

    def clear(self):
        self.items.clear()
        self._current_index = None

    def count(self):
        return len(self.items)

    def currentItem(self):
        if self._current_index is None:
            return None
        if self._current_index < 0 or self._current_index >= len(self.items):
            return None
        return self.items[self._current_index]

    def setCurrentRow(self, index):
        self._current_index = index if 0 <= index < len(self.items) else None


class DummyButton:
    def __init__(self):
        self.enabled = None

    def setEnabled(self, value):
        self.enabled = bool(value)


class DummyMessageBox:
    StandardButton = SimpleNamespace(Yes=1, No=2)

    def __init__(self):
        self.calls = []

    def warning(self, *_args):
        self.calls.append("warning")

    def information(self, *_args):
        self.calls.append("information")


@unittest.skipUnless(PYQT_AVAILABLE, "PyQt6 is required for incident assignment helper tests")
class IncidentAssignmentHelpersTests(unittest.TestCase):
    def test_refresh_incident_assignments_populates_list(self):
        history_tab = SimpleNamespace(
            incidents_list=DummyListWidget(
                [DummyListItem(payload={"id": 77})],
                current_index=0,
            ),
            incident_assignments_list=DummyListWidget(),
            remove_incident_assignment_btn=DummyButton(),
        )
        window = SimpleNamespace(
            history_tab=history_tab,
            history=SimpleNamespace(
                list_entity_technician_assignments=lambda *args, **kwargs: [
                    {
                        "id": 9,
                        "assignment_role": "owner",
                        "technician_id": 5,
                        "technician_display_name": "Ana",
                        "technician_employee_code": "EMP-1",
                    }
                ]
            ),
            can_manage_operational_records=True,
            is_admin=False,
        )

        refresh_incident_assignments(window)

        self.assertEqual(history_tab.incident_assignments_list.count(), 1)
        self.assertIn("Ana", history_tab.incident_assignments_list.items[0].text())
        self.assertTrue(history_tab.remove_incident_assignment_btn.enabled)

    def test_assign_technician_requires_permission(self):
        message_box = DummyMessageBox()
        history_tab = SimpleNamespace(
            incidents_list=DummyListWidget([DummyListItem(payload={"id": 11})], current_index=0)
        )
        history = SimpleNamespace(
            list_technicians=lambda include_inactive=False: [],
            create_technician_assignment=lambda **kwargs: None,
        )
        window = SimpleNamespace(
            history_tab=history_tab,
            history=history,
            can_manage_operational_records=False,
            is_admin=False,
        )

        assign_technician_to_selected_incident(window, message_box=message_box)

        self.assertIn("warning", message_box.calls)

    def test_assign_technician_creates_assignment(self):
        message_box = DummyMessageBox()
        history_tab = SimpleNamespace(
            incidents_list=DummyListWidget([DummyListItem(payload={"id": 12})], current_index=0),
            incident_assignments_list=DummyListWidget(),
            remove_incident_assignment_btn=DummyButton(),
        )
        created = []
        history = SimpleNamespace(
            list_technicians=lambda include_inactive=False: [
                {"id": 3, "display_name": "Carlos", "employee_code": "T-03"}
            ],
            create_technician_assignment=lambda **kwargs: created.append(kwargs),
            list_entity_technician_assignments=lambda *args, **kwargs: [],
        )
        window = SimpleNamespace(
            history_tab=history_tab,
            history=history,
            can_manage_operational_records=True,
            is_admin=False,
            user_manager=SimpleNamespace(
                current_user={"username": "coordinador"},
                _log_access=MagicMock(),
            ),
        )

        class InputDialogStub:
            @staticmethod
            def getItem(*_args, **_kwargs):
                if "Rol de asignacion" in str(_args[1]):
                    return "assistant", True
                return "#3 - Carlos (T-03)", True

        assign_technician_to_selected_incident(
            window,
            message_box=message_box,
            input_dialog=InputDialogStub,
        )

        self.assertEqual(len(created), 1)
        self.assertEqual(created[0]["technician_id"], 3)
        self.assertEqual(created[0]["entity_type"], "incident")
        self.assertEqual(created[0]["entity_id"], 12)
        self.assertEqual(created[0]["assignment_role"], "assistant")
        window.user_manager._log_access.assert_called_once()
        log_args = window.user_manager._log_access.call_args[0]
        self.assertEqual(log_args[0], "incident_assignment_created")
        self.assertEqual(log_args[1], "coordinador")
        self.assertTrue(log_args[2])

    def test_refresh_installation_assignments_populates_list(self):
        history_tab = SimpleNamespace(
            incidents_installations_list=DummyListWidget(
                [DummyListItem(payload={"id": 55})],
                current_index=0,
            ),
            installation_assignments_list=DummyListWidget(),
            remove_installation_assignment_btn=DummyButton(),
        )
        window = SimpleNamespace(
            history_tab=history_tab,
            history=SimpleNamespace(
                list_entity_technician_assignments=lambda *args, **kwargs: [
                    {
                        "id": 21,
                        "assignment_role": "reviewer",
                        "technician_id": 8,
                        "technician_display_name": "Lucia",
                        "technician_employee_code": "L-08",
                    }
                ]
            ),
            can_manage_operational_records=True,
            is_admin=False,
        )

        refresh_installation_assignments(window)

        self.assertEqual(history_tab.installation_assignments_list.count(), 1)
        self.assertIn("Lucia", history_tab.installation_assignments_list.items[0].text())
        self.assertTrue(history_tab.remove_installation_assignment_btn.enabled)

    def test_assign_technician_to_installation_creates_assignment(self):
        message_box = DummyMessageBox()
        history_tab = SimpleNamespace(
            incidents_installations_list=DummyListWidget([DummyListItem(payload={"id": 33})], current_index=0),
            installation_assignments_list=DummyListWidget(),
            remove_installation_assignment_btn=DummyButton(),
        )
        created = []
        history = SimpleNamespace(
            list_technicians=lambda include_inactive=False: [
                {"id": 4, "display_name": "Mauro", "employee_code": "M-04"}
            ],
            create_technician_assignment=lambda **kwargs: created.append(kwargs),
            list_entity_technician_assignments=lambda *args, **kwargs: [],
        )
        window = SimpleNamespace(
            history_tab=history_tab,
            history=history,
            can_manage_operational_records=True,
            is_admin=False,
            user_manager=SimpleNamespace(
                current_user={"username": "coordinador"},
                _log_access=MagicMock(),
            ),
        )

        class InputDialogStub:
            @staticmethod
            def getItem(*_args, **_kwargs):
                if "Rol de asignacion" in str(_args[1]):
                    return "reviewer", True
                return "#4 - Mauro (M-04)", True

        assign_technician_to_selected_installation(
            window,
            message_box=message_box,
            input_dialog=InputDialogStub,
        )

        self.assertEqual(len(created), 1)
        self.assertEqual(created[0]["entity_type"], "installation")
        self.assertEqual(created[0]["entity_id"], 33)
        self.assertEqual(created[0]["assignment_role"], "reviewer")
        window.user_manager._log_access.assert_called_once()
        log_args = window.user_manager._log_access.call_args[0]
        self.assertEqual(log_args[0], "installation_assignment_created")
        self.assertEqual(log_args[1], "coordinador")
        self.assertTrue(log_args[2])


if __name__ == "__main__":
    unittest.main()

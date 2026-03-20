import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

try:
    from PyQt6.QtCore import Qt
    from ui.main_window_bootstrap import initialize_manager_state
    from ui.main_window_incidents import (
        handle_incident_item_changed,
        refresh_incidents_view,
        show_incidents_for_selected_record,
        update_selected_incident_status,
    )
    from ui.main_window_session import (
        apply_authenticated_login_state,
        apply_navigation_access_control,
        current_user_role,
        handle_tab_changed,
        is_user_authenticated,
        run_admin_logout,
        run_login_dialog,
    )
    PYQT_AVAILABLE = True
except Exception:  # pragma: no cover - entorno sin PyQt
    PYQT_AVAILABLE = False


class DummySignal:
    def connect(self, _callback):
        return None


class DummyButton:
    def __init__(self):
        self.enabled = None
        self.visible = None
        self.text_value = ""

    def setEnabled(self, value):
        self.enabled = bool(value)

    def setVisible(self, value):
        self.visible = bool(value)

    def text(self):
        return self.text_value


class DummyStatusBar:
    def __init__(self):
        self.messages = []

    def showMessage(self, message, timeout=0):
        self.messages.append((message, timeout))


class DummyTabs:
    def __init__(self, current_index=0):
        self._current_index = current_index
        self.enabled = {}

    def setTabEnabled(self, index, enabled):
        self.enabled[index] = bool(enabled)

    def currentIndex(self):
        return self._current_index

    def setCurrentIndex(self, index):
        self._current_index = index

    def isTabEnabled(self, index):
        return self.enabled.get(index, False)


class DummyLabel:
    def __init__(self):
        self.text_value = ""
        self.visible = None

    def setText(self, value):
        self.text_value = value

    def setVisible(self, value):
        self.visible = bool(value)

    def clear(self):
        self.text_value = ""

    def setHtml(self, value):
        self.text_value = value


class DummyListItem:
    def __init__(self, text="", payload=None):
        self._text = text
        self._payload = payload
        self.tooltip = None
        self.icon = None

    def data(self, _role):
        return self._payload

    def setData(self, _role, payload):
        self._payload = payload

    def text(self):
        return self._text

    def setToolTip(self, value):
        self.tooltip = value

    def setIcon(self, value):
        self.icon = value


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

    def setCurrentItem(self, item):
        try:
            self._current_index = self.items.index(item)
        except ValueError:
            self.items.append(item)
            self._current_index = len(self.items) - 1

    def setCurrentRow(self, index):
        self._current_index = index if 0 <= index < len(self.items) else None

    def row(self, item):
        try:
            return self.items.index(item)
        except ValueError:
            return -1

    def selectedItems(self):
        current = self.currentItem()
        return [current] if current is not None else []


class DummyCombo:
    def __init__(self, text):
        self._text = text

    def currentText(self):
        return self._text


class DummyGroupBox:
    def __init__(self, title):
        self._title = title
        self.visible = None

    def title(self):
        return self._title

    def setVisible(self, value):
        self.visible = bool(value)


class DummyLineEdit:
    def __init__(self, placeholder):
        self._placeholder = placeholder
        self.visible = None

    def placeholderText(self):
        return self._placeholder

    def setVisible(self, value):
        self.visible = bool(value)


class DummyHistoryTab:
    def __init__(self):
        self.create_manual_button = DummyButton()
        self.create_incident_btn = DummyButton()
        self.upload_incident_photo_btn = DummyButton()
        self.view_incident_photo_btn = DummyButton()
        self.incident_mark_open_btn = DummyButton()
        self.incident_mark_progress_btn = DummyButton()
        self.incident_mark_resolved_btn = DummyButton()
        self.warning = DummyLabel()
        self.incidents_installations_limit = DummyCombo("25")
        self.incidents_severity_filter = DummyCombo("Todas")
        self.incidents_period_filter = DummyCombo("Todo")
        self.incidents_installations_list = DummyListWidget()
        self.incidents_list = DummyListWidget()
        self.incident_photos_list = DummyListWidget()
        self.incident_detail = DummyLabel()
        self.history_list = DummyListWidget()


class DummyAdminTab:
    def __init__(self):
        self.auth_status = DummyLabel()
        self.login_btn = DummyButton()
        self.logout_btn = DummyButton()
        self.admin_content = DummyLabel()
        self.user_mgmt_btn = DummyButton()
        self.group_boxes = [DummyGroupBox("Cloudflare R2"), DummyGroupBox("Operaciones")]
        self.buttons = []
        for text in [
            "📁 Seleccionar Archivo",
            "☁️ Subir a la Nube",
            "❌ Eliminar Seleccionado",
            "Guardar Configuración R2",
            "Probar Conexión",
        ]:
            button = DummyButton()
            button.text_value = text
            self.buttons.append(button)
        self.line_edits = [
            DummyLineEdit("Driver brand"),
            DummyLineEdit("Account id"),
            DummyLineEdit("Bucket name"),
        ]

    def findChildren(self, widget_cls):
        name = getattr(widget_cls, "__name__", "")
        if name == "QGroupBox":
            return self.group_boxes
        if name == "QPushButton":
            return self.buttons
        if name == "QLineEdit":
            return self.line_edits
        return []


class DummyConfigManager:
    def __init__(self):
        self.security = object()


class DummyHistory:
    def __init__(self, _config_manager):
        self.providers = []

    def set_web_token_provider(self, provider):
        self.providers.append(provider)


class DummyInstaller:
    pass


class DummyThemeManager:
    pass


class DummyReportGenerator:
    def __init__(self, history):
        self.history = history


class DummyLogger:
    def __init__(self):
        self.calls = []

    def operation_start(self, *args, **kwargs):
        self.calls.append(("operation_start", args, kwargs))

    def operation_end(self, *args, **kwargs):
        self.calls.append(("operation_end", args, kwargs))

    def security_event(self, *args, **kwargs):
        self.calls.append(("security_event", args, kwargs))

    def info(self, *args, **kwargs):
        self.calls.append(("info", args, kwargs))

    def debug(self, *args, **kwargs):
        self.calls.append(("debug", args, kwargs))

    def warning(self, *args, **kwargs):
        self.calls.append(("warning", args, kwargs))

    def error(self, *args, **kwargs):
        self.calls.append(("error", args, kwargs))


class DummyDialogAccepted:
    def __init__(self, _user_manager, _parent):
        pass

    def exec(self):
        return 1


class DummyDialogRejected:
    def __init__(self, _user_manager, _parent):
        pass

    def exec(self):
        return 0


@unittest.skipUnless(PYQT_AVAILABLE, "PyQt6 is required for MainWindow helper tests")
class MainWindowHelpersTests(unittest.TestCase):
    def test_initialize_manager_state_sets_defaults_and_cache_dir(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            target_cache = Path(tmp_dir) / "portable-cache"
            window = SimpleNamespace(
                config_manager=DummyConfigManager(),
                _sync_history_web_token_provider=lambda: None,
            )

            initialize_manager_state(
                window,
                portable_mode=True,
                portable_config={"enabled": True},
                get_cache_dir=lambda: target_cache,
                theme_manager_cls=DummyThemeManager,
                installer_cls=DummyInstaller,
                history_cls=DummyHistory,
                report_generator_cls=DummyReportGenerator,
                thread_pool_factory=lambda: "thread-pool",
                logger=None,
            )

            self.assertIsNone(window.cloud_manager)
            self.assertIsNone(window.history_manager)
            self.assertIsInstance(window.theme_manager, DummyThemeManager)
            self.assertIsInstance(window.installer, DummyInstaller)
            self.assertIsInstance(window.history, DummyHistory)
            self.assertIsInstance(window.report_gen, DummyReportGenerator)
            self.assertEqual(window._thumbnail_pool, "thread-pool")
            self.assertEqual(window.cache_dir, target_cache)
            self.assertTrue(window.cache_dir.exists())

    def test_auth_helpers_use_window_state(self):
        window = SimpleNamespace(
            is_authenticated=True,
            user_manager=SimpleNamespace(current_user={"role": "admin"}),
        )

        self.assertTrue(is_user_authenticated(window))
        self.assertEqual(current_user_role(window), "admin")

        window.is_authenticated = False
        self.assertFalse(is_user_authenticated(window))
        self.assertEqual(current_user_role(window), "admin")

    def test_apply_navigation_access_control_blocks_tabs_without_session(self):
        history_tab = DummyHistoryTab()
        status_bar = DummyStatusBar()
        tabs = DummyTabs(current_index=0)
        window = SimpleNamespace(
            is_authenticated=False,
            user_manager=None,
            tabs=tabs,
            drivers_tab_index=0,
            history_tab_index=1,
            incidents_tab_index=2,
            admin_tab_index=3,
            history_tab=history_tab,
            statusBar=lambda: status_bar,
            _is_user_authenticated=lambda: False,
            _current_user_role=lambda: "",
        )

        apply_navigation_access_control(window)

        self.assertFalse(tabs.enabled[0])
        self.assertFalse(tabs.enabled[1])
        self.assertFalse(tabs.enabled[2])
        self.assertTrue(tabs.enabled[3])
        self.assertEqual(tabs.currentIndex(), 3)
        self.assertEqual(history_tab.create_manual_button.enabled, False)
        self.assertEqual(status_bar.messages[-1], ("Inicia sesión para acceder a Drivers y Registros.", 5000))

    def test_apply_navigation_access_control_enables_history_actions_for_admin(self):
        history_tab = DummyHistoryTab()
        status_bar = DummyStatusBar()
        tabs = DummyTabs(current_index=1)
        window = SimpleNamespace(
            is_authenticated=True,
            user_manager=SimpleNamespace(current_user={"role": "super_admin"}),
            tabs=tabs,
            drivers_tab_index=0,
            history_tab_index=1,
            incidents_tab_index=2,
            admin_tab_index=3,
            history_tab=history_tab,
            statusBar=lambda: status_bar,
            _is_user_authenticated=lambda: True,
            _current_user_role=lambda: "super_admin",
        )

        apply_navigation_access_control(window)

        self.assertTrue(tabs.enabled[0])
        self.assertTrue(tabs.enabled[1])
        self.assertTrue(tabs.enabled[2])
        self.assertTrue(history_tab.create_manual_button.enabled)
        self.assertFalse(history_tab.create_incident_btn.enabled)

    def test_handle_tab_changed_redirects_when_tab_disabled(self):
        status_bar = DummyStatusBar()
        tabs = DummyTabs(current_index=1)
        tabs.enabled = {1: False, 3: True}
        window = SimpleNamespace(
            tabs=tabs,
            admin_tab_index=3,
            incidents_tab_index=2,
            refresh_incidents_view=lambda: None,
            statusBar=lambda: status_bar,
        )

        handle_tab_changed(window, 1)

        self.assertEqual(tabs.currentIndex(), 3)
        self.assertEqual(status_bar.messages[-1], ("Debes iniciar sesión para acceder a este menú.", 4000))

    def test_handle_tab_changed_refreshes_incidents_when_tab_enabled(self):
        status_bar = DummyStatusBar()
        tabs = DummyTabs(current_index=2)
        tabs.enabled = {2: True}
        refresh_calls = []
        window = SimpleNamespace(
            tabs=tabs,
            admin_tab_index=3,
            incidents_tab_index=2,
            refresh_incidents_view=lambda: refresh_calls.append("refresh"),
            statusBar=lambda: status_bar,
        )

        handle_tab_changed(window, 2)

        self.assertEqual(refresh_calls, ["refresh"])
        self.assertEqual(status_bar.messages, [])

    def test_apply_authenticated_login_state_updates_ui_and_refreshes_runtime(self):
        logger = DummyLogger()
        tabs = DummyTabs(current_index=3)
        status_bar = DummyStatusBar()
        upload_toggles = []
        sync_calls = []
        refresh_calls = []
        audit_calls = []
        admin_updates = []
        window = SimpleNamespace(
            user_manager=SimpleNamespace(current_user={"username": "ops", "role": "super_admin"}),
            is_authenticated=False,
            is_admin=False,
            tabs=tabs,
            drivers_tab_index=0,
            admin_tab=DummyAdminTab(),
            history_tab=DummyHistoryTab(),
            drivers_tab=SimpleNamespace(toggle_upload_section=lambda value: upload_toggles.append(value)),
            statusBar=lambda: status_bar,
            _apply_navigation_access_control=lambda: admin_updates.append("nav"),
            _is_web_auth_context=lambda: False,
            _sync_history_web_token_provider=lambda: sync_calls.append("sync"),
            refresh_drivers_list=lambda: refresh_calls.append("drivers"),
            refresh_audit_logs=lambda: audit_calls.append("audit"),
            event_handlers=SimpleNamespace(
                load_r2_config_to_admin_panel=lambda: admin_updates.append("load_r2"),
                update_admin_drivers_list=lambda drivers: admin_updates.append(("drivers", drivers)),
            ),
            all_drivers=[{"brand": "Zebra"}],
        )

        apply_authenticated_login_state(window, logger=logger)

        self.assertTrue(window.is_authenticated)
        self.assertTrue(window.is_admin)
        self.assertEqual(tabs.currentIndex(), 0)
        self.assertEqual(upload_toggles, [True])
        self.assertEqual(window.admin_tab.auth_status.text_value, "🔓 ops (super_admin)")
        self.assertFalse(window.admin_tab.login_btn.visible)
        self.assertTrue(window.admin_tab.logout_btn.visible)
        self.assertTrue(window.admin_tab.admin_content.visible)
        self.assertEqual(sync_calls, ["sync"])
        self.assertEqual(refresh_calls, ["drivers"])
        self.assertEqual(audit_calls, ["audit"])
        self.assertIn("load_r2", admin_updates)

    def test_run_admin_logout_resets_navigation_and_drivers(self):
        calls = []
        window = SimpleNamespace(
            event_handlers=SimpleNamespace(admin_logout=lambda: calls.append("logout")),
            _sync_history_web_token_provider=lambda: calls.append("sync"),
            drivers_tab=SimpleNamespace(toggle_upload_section=lambda value: calls.append(("upload", value))),
            _apply_navigation_access_control=lambda: calls.append("nav"),
            refresh_drivers_list=lambda: calls.append("drivers"),
        )

        run_admin_logout(window)

        self.assertEqual(calls, ["logout", "sync", ("upload", False), "nav", "drivers"])

    def test_run_login_dialog_logs_cancelled_when_dialog_rejected(self):
        logger = DummyLogger()
        window = SimpleNamespace(
            cloud_manager=object(),
            history_manager=object(),
            security_manager=object(),
            config_manager=DummyConfigManager(),
            _resolve_desktop_auth_mode=lambda: "legacy",
            user_manager=SimpleNamespace(
                current_user={},
                local_mode=False,
                auth_mode="legacy",
                audit_api_client=object(),
                needs_initialization=lambda: False,
            ),
        )

        run_login_dialog(
            window,
            logger=logger,
            login_dialog_cls=DummyDialogRejected,
            message_box=SimpleNamespace(),
        )

        operation_starts = [call for call in logger.calls if call[0] == "operation_start"]
        operation_ends = [call for call in logger.calls if call[0] == "operation_end"]
        self.assertEqual(len(operation_starts), 1)
        self.assertEqual(len(operation_ends), 1)
        self.assertEqual(operation_ends[0][2]["reason"], "cancelled")

    def test_refresh_incidents_view_populates_installations_and_selects_preferred_record(self):
        history_tab = DummyHistoryTab()
        window = SimpleNamespace(
            history_tab=history_tab,
            history=SimpleNamespace(
                get_installations=lambda limit: [
                    {
                        "id": 1,
                        "timestamp": "2026-03-20T10:00:00",
                        "driver_brand": "Zebra",
                        "driver_version": "1.0",
                        "client_name": "A",
                        "attention_state": "open",
                        "incident_active_count": 2,
                    },
                    {
                        "id": 2,
                        "timestamp": "2026-03-20T11:00:00",
                        "driver_brand": "Evolis",
                        "driver_version": "2.0",
                        "client_name": "B",
                        "attention_state": "clear",
                        "incident_active_count": 0,
                    },
                ]
            ),
            _parse_limit_from_text=lambda text, default=25: 25,
            _coerce_seconds=lambda value, allow_negative=False: int(value or 0),
            _thumbnail_item_map={},
        )

        refresh_incidents_view(window, preferred_record_id=2)

        self.assertEqual(history_tab.incidents_installations_list.count(), 2)
        current = history_tab.incidents_installations_list.currentItem()
        self.assertEqual(current.data(Qt.ItemDataRole.UserRole)["id"], 2)
        self.assertFalse(history_tab.create_incident_btn.enabled)

    def test_handle_incident_item_changed_renders_detail_and_photos(self):
        history_tab = DummyHistoryTab()
        incident = {
            "id": 77,
            "installation_id": 9,
            "incident_status": "open",
            "severity": "high",
            "note": "Falla intermitente",
            "created_at": "2026-03-20T09:00:00",
            "photos": [{"id": None, "file_name": "evidence.png", "content_type": "image/png"}],
        }
        current_item = DummyListItem(payload=incident)
        window = SimpleNamespace(
            history_tab=history_tab,
            is_admin=True,
            theme_manager=None,
            _thumbnail_item_map={},
            _photo_thumbnail_cache={},
            _thumbnail_inflight=set(),
            _coerce_seconds=lambda value, allow_negative=False: int(value or 0),
            _format_duration=lambda value: f"{value}s",
            _parse_incident_datetime=lambda value: None,
        )

        handle_incident_item_changed(
            window,
            current_item,
            worker_cls=lambda *_args, **_kwargs: None,
        )

        self.assertIn("Falla intermitente", history_tab.incident_detail.text_value)
        self.assertEqual(history_tab.incident_photos_list.count(), 1)
        self.assertTrue(history_tab.view_incident_photo_btn.enabled)

    def test_update_selected_incident_status_updates_backend_and_refreshes(self):
        history_tab = DummyHistoryTab()
        current_incident = DummyListItem(payload={"id": 15, "incident_status": "open"})
        current_installation = DummyListItem(payload={"id": 5})
        history_tab.incidents_list = DummyListWidget([current_incident], current_index=0)
        history_tab.incidents_installations_list = DummyListWidget([current_installation], current_index=0)
        info_calls = []
        history_calls = []
        refresh_calls = []
        window = SimpleNamespace(
            is_admin=True,
            history_tab=history_tab,
            history=SimpleNamespace(update_incident_status=lambda **kwargs: history_calls.append(kwargs)),
            user_manager=SimpleNamespace(current_user={"username": "ops"}),
            _on_incidents_installation_changed=lambda current: refresh_calls.append(current.data(Qt.ItemDataRole.UserRole)["id"]),
        )
        message_box = SimpleNamespace(
            information=lambda *_args: info_calls.append("info"),
            warning=lambda *_args: None,
            critical=lambda *_args: None,
        )

        update_selected_incident_status(window, "in_progress", message_box=message_box)

        self.assertEqual(history_calls[0]["incident_id"], 15)
        self.assertEqual(history_calls[0]["incident_status"], "in_progress")
        self.assertEqual(history_calls[0]["reporter_username"], "ops")
        self.assertEqual(refresh_calls, [5])
        self.assertEqual(info_calls, ["info"])

    def test_show_incidents_for_selected_record_switches_tab_and_refreshes(self):
        history_tab = DummyHistoryTab()
        selected = DummyListItem(payload=33)
        history_tab.history_list = DummyListWidget([selected], current_index=0)
        tabs = DummyTabs(current_index=0)
        refresh_calls = []
        window = SimpleNamespace(
            history_tab=history_tab,
            tabs=tabs,
            incidents_tab_index=2,
            refresh_incidents_view=lambda preferred_record_id=None: refresh_calls.append(preferred_record_id),
        )

        show_incidents_for_selected_record(window)

        self.assertEqual(tabs.currentIndex(), 2)
        self.assertEqual(refresh_calls, [33])


if __name__ == "__main__":
    unittest.main()

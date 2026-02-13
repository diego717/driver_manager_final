import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from core.exceptions import InstallationError

try:
    from handlers.event_handlers import EventHandlers
    from PyQt6.QtCore import Qt

    PYQT_AVAILABLE = True
except Exception:
    EventHandlers = None
    Qt = None
    PYQT_AVAILABLE = False


@unittest.skipUnless(PYQT_AVAILABLE, "PyQt6 is required for EventHandlers tests")
class TestEventHandlers(unittest.TestCase):
    def _build_main(self):
        main = MagicMock()
        main.drivers_tab = MagicMock()
        main.download_manager = MagicMock()
        main.progress_bar = MagicMock()
        main.statusBar.return_value = MagicMock()
        main.history = MagicMock()
        main.installer = MagicMock()
        main.refresh_history_view = MagicMock()
        main.config_manager = MagicMock()
        main.init_cloud_connection = MagicMock()
        main.load_config_data = MagicMock()
        main.admin_tab = MagicMock()
        main.user_manager = MagicMock()
        return main

    def test_on_driver_selected_sets_details_and_enables_buttons(self):
        main = self._build_main()
        handler = EventHandlers(main)

        driver = {
            "brand": "Zebra",
            "version": "1.2.3",
            "description": "Test driver",
            "last_modified": "2026-02-13",
            "size_mb": 12.5,
        }
        item = MagicMock()
        item.data.return_value = driver
        main.drivers_tab.drivers_list.selectedItems.return_value = [item]

        handler.on_driver_selected()

        main.drivers_tab.driver_details.setText.assert_called_once()
        text = main.drivers_tab.driver_details.setText.call_args.args[0]
        self.assertIn("Marca: Zebra", text)
        main.drivers_tab.download_btn.setEnabled.assert_called_with(True)
        main.drivers_tab.install_btn.setEnabled.assert_called_with(True)
        item.data.assert_called_once_with(Qt.ItemDataRole.UserRole)

    def test_on_driver_selected_clears_details_when_empty(self):
        main = self._build_main()
        handler = EventHandlers(main)
        main.drivers_tab.drivers_list.selectedItems.return_value = []

        handler.on_driver_selected()

        main.drivers_tab.driver_details.clear.assert_called_once()
        main.drivers_tab.download_btn.setEnabled.assert_called_with(False)
        main.drivers_tab.install_btn.setEnabled.assert_called_with(False)

    def test_download_and_install_uses_cache_path(self):
        main = self._build_main()
        handler = EventHandlers(main)

        with tempfile.TemporaryDirectory() as tmp:
            main.cache_dir = Path(tmp)
            driver = {"brand": "Magicard", "version": "2.0", "key": "drivers/x.exe"}
            item = MagicMock()
            item.data.return_value = driver
            main.drivers_tab.drivers_list.selectedItems.return_value = [item]

            handler.download_and_install()

            expected_path = str(Path(tmp) / "Magicard_v2.0.exe")
            main.download_manager.start_download.assert_called_once_with(
                driver, expected_path, install=True
            )

    @patch("handlers.event_handlers.QMessageBox.warning")
    def test_handle_installation_error_logs_failed_installation(self, mock_warning):
        main = self._build_main()
        handler = EventHandlers(main)
        main.installation_start_time = datetime.now()

        driver = {"brand": "Zebra", "version": "1.2.3", "description": "desc"}
        error = InstallationError("Error 740 elevation required")

        handler._handle_installation_error(
            error,
            "C:/drivers/installer.exe",
            driver,
            "Cliente A",
        )

        main.history.add_installation.assert_called_once()
        kwargs = main.history.add_installation.call_args.kwargs
        self.assertEqual(kwargs["status"], "failed")
        self.assertEqual(kwargs["driver_brand"], "Zebra")
        self.assertIn("740", kwargs["error_message"])
        main.refresh_history_view.assert_called_once()
        mock_warning.assert_called_once()

    @patch("handlers.event_handlers.QMessageBox.warning")
    def test_save_r2_config_denies_non_super_admin(self, mock_warning):
        main = self._build_main()
        handler = EventHandlers(main)

        main.user_manager.current_user = {"role": "admin", "username": "alice"}
        main.admin_tab.admin_account_id_input.text.return_value = "a"
        main.admin_tab.admin_access_key_input.text.return_value = "b"
        main.admin_tab.admin_secret_key_input.text.return_value = "c"
        main.admin_tab.admin_bucket_name_input.text.return_value = "d"
        main.admin_tab.admin_history_api_url_input.text.return_value = "e"

        handler.save_r2_config()

        mock_warning.assert_called_once()
        main.config_manager.save_config_data.assert_not_called()

    @patch("handlers.event_handlers.QMessageBox.information")
    def test_save_r2_config_persists_and_reconnects_for_super_admin(self, mock_info):
        main = self._build_main()
        handler = EventHandlers(main)

        main.user_manager.current_user = {"role": "super_admin", "username": "root"}
        main.admin_tab.admin_account_id_input.text.return_value = "acc"
        main.admin_tab.admin_access_key_input.text.return_value = "key"
        main.admin_tab.admin_secret_key_input.text.return_value = "secret"
        main.admin_tab.admin_bucket_name_input.text.return_value = "bucket"
        main.admin_tab.admin_history_api_url_input.text.return_value = "https://api.example.com"
        main.config_manager.save_config_data.return_value = True

        handler.save_r2_config()

        main.config_manager.save_config_data.assert_called_once()
        saved_config = main.config_manager.save_config_data.call_args.args[0]
        self.assertEqual(saved_config["account_id"], "acc")
        self.assertEqual(saved_config["bucket_name"], "bucket")
        main.init_cloud_connection.assert_called_once()
        mock_info.assert_called_once()
        main.user_manager._log_access.assert_called()

    def test_load_r2_config_to_admin_panel_denies_non_super_admin(self):
        main = self._build_main()
        handler = EventHandlers(main)

        main.user_manager.current_user = {"role": "viewer", "username": "bob"}
        main.load_config_data.return_value = {"account_id": "should_not_be_loaded"}

        handler.load_r2_config_to_admin_panel()

        main.load_config_data.assert_not_called()
        main.admin_tab.admin_account_id_input.setText.assert_not_called()

    def test_load_r2_config_to_admin_panel_populates_fields_for_super_admin(self):
        main = self._build_main()
        handler = EventHandlers(main)

        main.user_manager.current_user = {"role": "super_admin", "username": "root"}
        main.load_config_data.return_value = {
            "account_id": "acc",
            "access_key_id": "key",
            "secret_access_key": "secret",
            "bucket_name": "bucket",
            "history_api_url": "https://api.example.com",
        }

        handler.load_r2_config_to_admin_panel()

        main.admin_tab.admin_account_id_input.setText.assert_called_with("acc")
        main.admin_tab.admin_access_key_input.setText.assert_called_with("key")
        main.admin_tab.admin_secret_key_input.setText.assert_called_with("secret")
        main.admin_tab.admin_bucket_name_input.setText.assert_called_with("bucket")
        main.admin_tab.admin_history_api_url_input.setText.assert_called_with(
            "https://api.example.com"
        )


if __name__ == "__main__":
    unittest.main()

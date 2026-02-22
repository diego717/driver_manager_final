import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

try:
    from core.config_manager import ConfigManager, MASTER_PASSWORD_ENV

    PYQT_AVAILABLE = True
except Exception:
    ConfigManager = None
    MASTER_PASSWORD_ENV = "DRIVER_MANAGER_MASTER_PASSWORD"
    PYQT_AVAILABLE = False


class _DummyMain:
    def __init__(self):
        self.cloud_manager = None
        self.user_manager = None
        self.refresh_drivers_list = MagicMock()
        self._status_bar = MagicMock()

    def statusBar(self):
        return self._status_bar


@unittest.skipUnless(PYQT_AVAILABLE, "PyQt6 is required for ConfigManager tests")
class TestConfigManager(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.temp_dir.name)
        self.main = _DummyMain()

    def tearDown(self):
        self.temp_dir.cleanup()

    def _new_manager(self):
        fake_argv0 = self.base_path / "main.py"
        with patch.object(sys, "argv", [str(fake_argv0)]):
            manager = ConfigManager(self.main)
        return manager

    def test_apply_portable_config_with_valid_json_dict(self):
        manager = self._new_manager()
        portable_config = {
            "account_id": "acc-1",
            "access_key_id": "key-1",
            "secret_access_key": "secret-1",
            "bucket_name": "drivers-bucket",
            "api_url": "https://api.example.com",
        }

        with patch.object(manager, "save_config_data", return_value=True) as mock_save:
            with patch.object(manager, "init_cloud_connection", return_value=True) as mock_init:
                result = manager.apply_portable_config(portable_config)

        self.assertTrue(result)
        mock_save.assert_called_once_with(portable_config)
        mock_init.assert_called_once()

    def test_apply_portable_config_with_invalid_json_payload(self):
        manager = self._new_manager()

        with patch.object(manager, "save_config_data", return_value=True) as mock_save:
            with patch.object(manager, "init_cloud_connection", return_value=True) as mock_init:
                result_invalid_type = manager.apply_portable_config("not-a-json-object")
                result_missing_fields = manager.apply_portable_config({"account_id": "only-one-field"})

        self.assertFalse(result_invalid_type)
        self.assertFalse(result_missing_fields)
        mock_save.assert_not_called()
        mock_init.assert_not_called()

    def test_init_cloud_connection_with_missing_config(self):
        manager = self._new_manager()

        with patch.object(manager, "load_config_data", return_value=None):
            with patch("core.config_manager.CloudflareR2Manager") as mock_r2:
                result = manager.init_cloud_connection()

        self.assertFalse(result)
        self.assertIsNone(self.main.cloud_manager)
        mock_r2.assert_not_called()
        self.main.statusBar().showMessage.assert_called_with("❌ Configuración de nube faltante")

    def test_save_config_data_does_not_write_plaintext_credentials(self):
        manager = self._new_manager()
        manager.config_dir = self.base_path / "config"
        manager.config_dir.mkdir(parents=True, exist_ok=True)
        manager.config_file = manager.config_dir / "config.json"
        manager.encrypted_config_file = manager.config_dir / "config.enc"

        config_payload = {
            "account_id": "acc-sensitive",
            "access_key_id": "ak-sensitive",
            "secret_access_key": "sk-sensitive",
            "bucket_name": "bucket-sensitive",
            "api_url": "https://api.sensitive.example",
        }

        with patch.dict(os.environ, {MASTER_PASSWORD_ENV: "test-master-pass"}, clear=False):
            manager._set_master_password("test-master-pass")
            with patch.object(manager.security, "_get_config_dir", return_value=manager.config_dir):
                saved = manager.save_config_data(config_payload)

        self.assertTrue(saved)
        self.assertTrue(manager.encrypted_config_file.exists())
        self.assertFalse(manager.config_file.exists())

        encrypted_content = manager.encrypted_config_file.read_text(encoding="utf-8")
        self.assertNotIn("acc-sensitive", encrypted_content)
        self.assertNotIn("ak-sensitive", encrypted_content)
        self.assertNotIn("sk-sensitive", encrypted_content)
        self.assertNotIn("bucket-sensitive", encrypted_content)


if __name__ == "__main__":
    unittest.main()

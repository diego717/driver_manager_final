import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.master_password_vault import MasterPasswordVault


class TestMasterPasswordVault(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store_file = Path(self.temp_dir.name) / "vault.json"
        self.vault = MasterPasswordVault(store_file=self.store_file)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_save_and_load_password_with_mocked_dpapi(self):
        with patch.object(self.vault, "_supports_dpapi", return_value=True), patch.object(
            self.vault, "_dpapi_encrypt", return_value=b"encrypted"
        ), patch.object(self.vault, "_dpapi_decrypt", return_value=b"MyPass123!"):
            saved = self.vault.save_password("MyPass123!")
            loaded = self.vault.load_password()

        self.assertTrue(saved)
        self.assertEqual(loaded, "MyPass123!")
        self.assertTrue(self.store_file.exists())

        payload = json.loads(self.store_file.read_text(encoding="utf-8"))
        self.assertEqual(payload.get("scheme"), "dpapi")
        self.assertIn("blob", payload)

    def test_save_password_returns_false_when_not_supported(self):
        with patch.object(self.vault, "_supports_dpapi", return_value=False):
            saved = self.vault.save_password("MyPass123!")
        self.assertFalse(saved)
        self.assertFalse(self.store_file.exists())

    def test_load_password_returns_none_on_invalid_payload(self):
        self.store_file.parent.mkdir(parents=True, exist_ok=True)
        self.store_file.write_text("{invalid-json", encoding="utf-8")

        with patch.object(self.vault, "_supports_dpapi", return_value=True):
            loaded = self.vault.load_password()

        self.assertIsNone(loaded)

    def test_clear_password_removes_file(self):
        self.store_file.parent.mkdir(parents=True, exist_ok=True)
        self.store_file.write_text("{}", encoding="utf-8")

        self.vault.clear_password()
        self.assertFalse(self.store_file.exists())


if __name__ == "__main__":
    unittest.main()

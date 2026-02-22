import tempfile
import unittest
import hmac
import hashlib
from pathlib import Path
from unittest.mock import patch

from core.security_manager import CloudDataEncryption, SecurityManager


class TestSecurityManager(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def _new_manager(self):
        manager = SecurityManager()
        patcher = patch.object(manager, "_get_config_dir", return_value=self.config_path)
        patcher.start()
        self.addCleanup(patcher.stop)
        return manager

    def test_initialize_master_key_rejects_empty_password(self):
        manager = self._new_manager()
        self.assertFalse(manager.initialize_master_key(""))

    def test_encrypt_decrypt_data_roundtrip(self):
        manager = self._new_manager()
        self.assertTrue(manager.initialize_master_key("pass123"))

        original = {"account_id": "abc", "bucket": "drivers"}
        encrypted = manager.encrypt_data(original)
        decrypted = manager.decrypt_data(encrypted)

        self.assertEqual(decrypted, original)

    def test_hmac_validation_true_and_false(self):
        manager = self._new_manager()
        manager.initialize_master_key("pass123")

        payload = "important-data"
        valid_hmac = manager.generate_hmac(payload)

        self.assertTrue(manager.verify_hmac(payload, valid_hmac))
        self.assertFalse(manager.verify_hmac(payload, "invalid-hmac"))

    def test_encrypt_and_decrypt_config_file_roundtrip(self):
        manager = self._new_manager()
        config_file = self.config_path / "config.enc"
        original = {"api_url": "https://api.example.com", "bucket_name": "drivers"}

        self.assertTrue(manager.encrypt_config_file(original, "pass123", file_path=config_file))
        decrypted = manager.decrypt_config_file("pass123", file_path=config_file)

        self.assertEqual(decrypted, original)

    def test_decrypt_config_file_returns_none_when_hmac_is_tampered(self):
        manager = self._new_manager()
        config_file = self.config_path / "config.enc"
        manager.encrypt_config_file({"x": 1}, "pass123", file_path=config_file)

        with patch.object(manager, "verify_hmac", return_value=False):
            with patch.object(manager, "_try_recover_salt", return_value=False):
                decrypted = manager.decrypt_config_file("pass123", file_path=config_file)
                self.assertIsNone(decrypted)

    def test_try_recover_salt_does_not_mutate_instance_state(self):
        manager = self._new_manager()
        self.assertTrue(manager.initialize_master_key("pass123"))
        original_key = manager.master_key
        original_fernet = manager.fernet

        legacy_home = self.config_path / "legacy-home"
        legacy_salt_dir = legacy_home / ".driver_manager"
        legacy_salt_dir.mkdir(parents=True, exist_ok=True)
        legacy_salt_file = legacy_salt_dir / ".security_salt"
        legacy_salt = b"0123456789ABCDEF"
        legacy_salt_file.write_bytes(legacy_salt)

        encrypted_data = "payload-test"
        derived_key = manager._derive_key("pass123", legacy_salt)
        expected_hmac = hmac.new(derived_key, encrypted_data.encode(), hashlib.sha256).hexdigest()

        with patch("core.security_manager.Path.home", return_value=legacy_home):
            recovery_data = manager._try_recover_salt("pass123", encrypted_data, expected_hmac)

        self.assertIsNotNone(recovery_data)
        self.assertEqual(manager.master_key, original_key)
        self.assertIs(manager.fernet, original_fernet)

    def test_apply_recovered_salt_updates_crypto_context_and_copies_salt(self):
        manager = self._new_manager()

        legacy_salt_file = self.config_path / "legacy.security_salt"
        legacy_salt = b"FEDCBA9876543210"
        legacy_salt_file.write_bytes(legacy_salt)
        current_salt_file = self.config_path / "recovered.security_salt"
        derived_key = manager._derive_key("pass123", legacy_salt)

        success = manager._apply_recovered_salt(legacy_salt_file, current_salt_file, derived_key)

        self.assertTrue(success)
        self.assertEqual(manager.master_key, derived_key)
        self.assertEqual(current_salt_file.read_bytes(), legacy_salt)

    def test_cloud_data_encryption_roundtrip(self):
        manager = self._new_manager()
        manager.initialize_master_key("pass123")
        cloud_encryption = CloudDataEncryption(manager)

        original = {
            "users": {"admin": {"role": "super_admin"}},
            "access_logs": [{"action": "login"}],
            "meta": "ok",
        }

        encrypted = cloud_encryption.encrypt_cloud_data(original)
        decrypted = cloud_encryption.decrypt_cloud_data(encrypted.copy())

        self.assertTrue(encrypted.get("_encrypted"))
        self.assertEqual(decrypted["users"], original["users"])
        self.assertEqual(decrypted["access_logs"], original["access_logs"])
        self.assertEqual(decrypted["meta"], "ok")

    def test_cloud_data_encryption_returns_empty_dict_when_hmac_invalid(self):
        manager = self._new_manager()
        manager.initialize_master_key("pass123")
        cloud_encryption = CloudDataEncryption(manager)

        encrypted = cloud_encryption.encrypt_cloud_data({"users": {"admin": {}}})
        encrypted["users"] = "tampered"

        decrypted = cloud_encryption.decrypt_cloud_data(encrypted)
        self.assertEqual(decrypted, {})


if __name__ == "__main__":
    unittest.main()

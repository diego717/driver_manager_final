import os
import unittest
from unittest.mock import patch

from managers.history_manager import InstallationHistory


class DummyConfigManager:
    def __init__(self, config=None):
        self._config = config or {}

    def load_config_data(self):
        return dict(self._config)


class TestInstallationHistoryAuthMode(unittest.TestCase):
    def test_current_desktop_auth_mode_defaults_to_legacy(self):
        manager = InstallationHistory(DummyConfigManager())

        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(manager._current_desktop_auth_mode(), "legacy")

    def test_current_desktop_auth_mode_uses_config_when_env_missing(self):
        manager = InstallationHistory(DummyConfigManager({"desktop_auth_mode": "web"}))

        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(manager._current_desktop_auth_mode(), "web")

    def test_env_auth_mode_overrides_config(self):
        manager = InstallationHistory(DummyConfigManager({"desktop_auth_mode": "legacy"}))

        with patch.dict(os.environ, {"DRIVER_MANAGER_DESKTOP_AUTH_MODE": "auto"}, clear=True):
            self.assertEqual(manager._current_desktop_auth_mode(), "auto")

    def test_web_bearer_mode_requires_mode_and_token(self):
        manager = InstallationHistory(DummyConfigManager({"desktop_auth_mode": "web"}))
        manager.set_web_token_provider(lambda: "token-123")

        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(manager._should_use_web_bearer_mode())


if __name__ == "__main__":
    unittest.main()

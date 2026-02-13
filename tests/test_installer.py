import unittest
from unittest.mock import MagicMock, patch

from core.exceptions import InstallationError
from managers.installer import DriverInstaller


class TestDriverInstaller(unittest.TestCase):
    def setUp(self):
        self.installer = DriverInstaller()
        self.installer.system = "Windows"

    @patch("managers.installer.os.path.exists", return_value=False)
    def test_install_driver_raises_if_file_not_found(self, _mock_exists):
        with self.assertRaises(InstallationError):
            self.installer.install_driver("C:/missing/driver.exe")

    @patch("managers.installer.subprocess.run")
    def test_install_windows_silent_success(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)

        self.installer._install_windows("C:/drivers/setup.exe")

        mock_run.assert_called_once_with(
            ["C:/drivers/setup.exe", "/S"],
            capture_output=True,
            timeout=300,
            check=False,
        )

    @patch("managers.installer.subprocess.run")
    def test_install_windows_requests_elevation_on_winerror_740(self, mock_run):
        err = OSError("elevation required")
        err.winerror = 740
        mock_run.side_effect = err

        with patch.object(self.installer, "is_admin", return_value=False):
            with patch.object(self.installer, "run_as_admin", return_value=True) as mock_run_admin:
                self.installer._install_windows("C:/drivers/setup.exe")
                mock_run_admin.assert_called_once_with("C:/drivers/setup.exe")

    @patch("managers.installer.subprocess.Popen")
    @patch("managers.installer.subprocess.run")
    def test_install_windows_interactive_mode_as_admin(self, mock_run, mock_popen):
        mock_run.return_value = MagicMock(returncode=1)

        with patch.object(self.installer, "is_admin", return_value=True):
            self.installer._install_windows("C:/drivers/setup.exe")

        self.assertEqual(mock_run.call_count, 5)
        mock_popen.assert_called_once_with(["C:/drivers/setup.exe"])

    @patch("managers.installer.subprocess.run")
    def test_check_driver_installed_true_when_name_found(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="... Zebra Printer Driver ...")

        is_installed = self.installer.check_driver_installed("Zebra")

        self.assertTrue(is_installed)

    def test_check_driver_installed_returns_false_on_non_windows(self):
        self.installer.system = "Linux"
        self.assertFalse(self.installer.check_driver_installed("AnyDriver"))

    @patch("managers.installer.os.path.exists", return_value=False)
    def test_uninstall_driver_raises_if_file_not_found(self, _mock_exists):
        with self.assertRaises(InstallationError):
            self.installer.uninstall_driver("C:/missing/uninstall.exe")

    def test_run_as_admin_returns_false_on_non_windows(self):
        self.installer.system = "Linux"
        self.assertFalse(self.installer.run_as_admin("C:/drivers/setup.exe"))


if __name__ == "__main__":
    unittest.main()

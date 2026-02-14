import unittest
from unittest.mock import MagicMock
import json
import shutil
from pathlib import Path
from managers.user_manager_v2 import UserManagerV2


class TestUserManagerV2(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path("tests/temp_config")
        self.test_dir.mkdir(parents=True, exist_ok=True)
        self.superadmin_password = "N7!xTq4#Lm2@Vp9"
        self.admin_password = "Q4@rZ8!kP1#sM7t"
        self.viewer_password = "B9!wX3@hN6#yR2c"
        self.new_superadmin_password = "D5@uK8!pF2#vL9m"

        # Mock cloud manager and security manager
        self.mock_cloud = MagicMock()
        self.mock_security = MagicMock()

        # Initialize UserManager in local mode for easier testing
        self.user_manager = UserManagerV2(local_mode=True)
        self.user_manager.config_dir = self.test_dir
        self.user_manager.users_file = self.test_dir / "users.json"
        self.user_manager.logs_file = self.test_dir / "access_logs.json"

    def tearDown(self):
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir)

    def test_initialize_system(self):
        success, message = self.user_manager.initialize_system("superadmin", self.superadmin_password)
        self.assertTrue(success)
        self.assertTrue(self.user_manager.users_file.exists())

        with open(self.user_manager.users_file, 'r') as f:
            data = json.load(f)
            self.assertIn("superadmin", data["users"])
            self.assertEqual(data["users"]["superadmin"]["role"], "super_admin")
            self.assertEqual(data["users"]["superadmin"]["permissions"], ["all"])

    def test_authenticate(self):
        self.user_manager.initialize_system("superadmin", self.superadmin_password)

        # Test successful auth
        success, message = self.user_manager.authenticate("superadmin", self.superadmin_password)
        self.assertTrue(success)
        self.assertIsNotNone(self.user_manager.current_user)
        self.assertEqual(self.user_manager.current_user["username"], "superadmin")

        # AuthenticationError is caught by decorator and returns (False, message)
        success, message = self.user_manager.authenticate("superadmin", "wrongpassword")
        self.assertFalse(success)
        self.assertIn("Usuario o contrase", message)

        success, message = self.user_manager.authenticate("nonexistent", self.superadmin_password)
        self.assertFalse(success)
        self.assertIn("Usuario o contrase", message)

    def test_create_user_permissions(self):
        self.user_manager.initialize_system("superadmin", self.superadmin_password)
        self.user_manager.authenticate("superadmin", self.superadmin_password)

        self.user_manager.create_user("admin_user", self.admin_password, role="admin")
        self.user_manager.create_user("viewer_user", self.viewer_password, role="viewer")

        users_data = self.user_manager._load_users()

        self.assertEqual(users_data["users"]["admin_user"]["permissions"], ["read", "write"])
        self.assertEqual(users_data["users"]["viewer_user"]["permissions"], ["read"])
        self.assertEqual(users_data["users"]["superadmin"]["permissions"], ["all"])

    def test_create_superadmin_permissions(self):
        self.user_manager.initialize_system("superadmin", self.superadmin_password)
        self.user_manager.authenticate("superadmin", self.superadmin_password)

        self.user_manager.create_user("superadmin2", self.new_superadmin_password, role="super_admin")

        users_data = self.user_manager._load_users()
        self.assertEqual(users_data["users"]["superadmin2"]["role"], "super_admin")
        self.assertEqual(users_data["users"]["superadmin2"]["permissions"], ["all"])

    def test_change_password(self):
        self.user_manager.initialize_system("superadmin", self.superadmin_password)

        success, message = self.user_manager.change_password(
            "superadmin", self.superadmin_password, self.new_superadmin_password
        )
        self.assertTrue(success)

        success, message = self.user_manager.authenticate("superadmin", self.superadmin_password)
        self.assertFalse(success)

        success, message = self.user_manager.authenticate("superadmin", self.new_superadmin_password)
        self.assertTrue(success)


if __name__ == "__main__":
    unittest.main()

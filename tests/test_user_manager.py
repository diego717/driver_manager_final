import unittest
from unittest.mock import MagicMock, patch
import json
import os
import shutil
from pathlib import Path
from managers.user_manager_v2 import UserManagerV2
from core.exceptions import AuthenticationError, ValidationError

class TestUserManagerV2(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path("tests/temp_config")
        self.test_dir.mkdir(parents=True, exist_ok=True)

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
        success, message = self.user_manager.initialize_system("superadmin", "password123")
        self.assertTrue(success)
        self.assertTrue(self.user_manager.users_file.exists())

        with open(self.user_manager.users_file, 'r') as f:
            data = json.load(f)
            self.assertIn("superadmin", data["users"])
            self.assertEqual(data["users"]["superadmin"]["role"], "super_admin")
            self.assertEqual(data["users"]["superadmin"]["permissions"], ["all"])

    def test_authenticate(self):
        self.user_manager.initialize_system("superadmin", "password123")

        # Test successful auth
        success, message = self.user_manager.authenticate("superadmin", "password123")
        self.assertTrue(success)
        self.assertIsNotNone(self.user_manager.current_user)
        self.assertEqual(self.user_manager.current_user["username"], "superadmin")

        # Test failed auth (wrong password)
        # AuthenticationError is caught by decorator and returns (False, message)
        success, message = self.user_manager.authenticate("superadmin", "wrongpassword")
        self.assertFalse(success)
        self.assertIn("Contraseña incorrecta", message)

        # Test failed auth (non-existent user)
        success, message = self.user_manager.authenticate("nonexistent", "password123")
        self.assertFalse(success)
        self.assertIn("Usuario no encontrado", message)

    def test_create_user_permissions(self):
        self.user_manager.initialize_system("superadmin", "password123")
        self.user_manager.authenticate("superadmin", "password123")

        # Create admin
        self.user_manager.create_user("admin_user", "pass12345", role="admin")

        # Create viewer
        self.user_manager.create_user("viewer_user", "pass12345", role="viewer")

        users_data = self.user_manager._load_users()

        # Verify admin permissions
        self.assertEqual(users_data["users"]["admin_user"]["permissions"], ["read", "write"])

        # Verify viewer permissions
        self.assertEqual(users_data["users"]["viewer_user"]["permissions"], ["read"])

        # Verify superadmin remains with all permissions
        self.assertEqual(users_data["users"]["superadmin"]["permissions"], ["all"])

    def test_create_superadmin_permissions(self):
        self.user_manager.initialize_system("superadmin", "password123")
        self.user_manager.authenticate("superadmin", "password123")

        # Create another superadmin
        self.user_manager.create_user("superadmin2", "pass12345", role="super_admin")

        users_data = self.user_manager._load_users()
        self.assertEqual(users_data["users"]["superadmin2"]["role"], "super_admin")
        self.assertEqual(users_data["users"]["superadmin2"]["permissions"], ["all"])

    def test_change_password(self):
        self.user_manager.initialize_system("superadmin", "password123")

        success, message = self.user_manager.change_password("superadmin", "password123", "newpassword123")
        self.assertTrue(success)

        # Verify old password no longer works
        success, message = self.user_manager.authenticate("superadmin", "password123")
        self.assertFalse(success)

        # Verify new password works
        success, message = self.user_manager.authenticate("superadmin", "newpassword123")
        self.assertTrue(success)

if __name__ == "__main__":
    unittest.main()

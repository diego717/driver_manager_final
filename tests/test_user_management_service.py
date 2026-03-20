import unittest
from unittest.mock import MagicMock

from managers.user_management_service import UserManagementService


class TestUserManagementService(unittest.TestCase):
    def setUp(self):
        self.owner = MagicMock()
        self.owner.logger = MagicMock()
        self.owner.current_user = {"username": "superadmin", "role": "super_admin"}
        self.owner.password_validator = MagicMock()
        self.owner.password_validator.validate_password_strength.return_value = (
            True,
            "ok",
            92,
        )
        self.owner.password_validator.check_password_history.return_value = True
        self.owner.password_validator.PASSWORD_HISTORY_SIZE = 5
        self.owner._permissions_for_role.return_value = ["read", "write"]
        self.owner._hash_password.side_effect = ["hash-new-user", "hash-updated-password"]
        self.owner._log_access = MagicMock()
        self.owner._save_users = MagicMock()
        self.service = UserManagementService(self.owner)

    def test_create_user_persists_normalized_user(self):
        self.owner._load_users.return_value = {
            "users": {},
            "created_at": "2026-03-19T10:00:00",
            "version": "2.1",
        }

        success, message = self.service.create_user(
            "admin_user",
            "Q4@rZ8!kP1#sM7t",
            role="admin",
            full_name="Admin User",
        )

        self.assertTrue(success)
        self.assertIn("Usuario creado", message)
        saved_payload = self.owner._save_users.call_args.args[0]
        created_user = saved_payload["users"]["admin_user"]
        self.assertEqual(created_user["permissions"], ["read", "write"])
        self.assertEqual(created_user["full_name"], "Admin User")
        self.owner._log_access.assert_called_once()

    def test_change_password_updates_history_and_metadata(self):
        self.owner._load_users.return_value = {
            "users": {
                "superadmin": {
                    "username": "superadmin",
                    "password_hash": "hash-current",
                    "password_history": [],
                }
            }
        }
        self.owner._verify_password.return_value = True
        self.owner._hash_password.side_effect = None
        self.owner._hash_password.return_value = "hash-updated-password"

        success, message = self.service.change_password(
            "superadmin",
            "OldPass123!",
            "NewPass123!",
        )

        self.assertTrue(success)
        self.assertIn("Contrasena cambiada", message)
        saved_payload = self.owner._save_users.call_args.args[0]
        updated_user = saved_payload["users"]["superadmin"]
        self.assertEqual(updated_user["password_hash"], "hash-updated-password")
        self.assertEqual(updated_user["password_history"], ["hash-current"])
        self.assertEqual(updated_user["password_strength_score"], 92)

    def test_deactivate_user_marks_user_inactive(self):
        self.owner._load_users.return_value = {
            "users": {
                "viewer01": {
                    "username": "viewer01",
                    "active": True,
                }
            }
        }

        success, message = self.service.deactivate_user("viewer01")

        self.assertTrue(success)
        self.assertIn("desactivado", message.lower())
        saved_payload = self.owner._save_users.call_args.args[0]
        updated_user = saved_payload["users"]["viewer01"]
        self.assertFalse(updated_user["active"])
        self.assertEqual(updated_user["deactivated_by"], "superadmin")


if __name__ == "__main__":
    unittest.main()

import unittest

from core.password_policy import PasswordPolicy


class TestPasswordPolicy(unittest.TestCase):
    def test_accepts_strong_password(self):
        is_valid, message = PasswordPolicy.validate("N7!xTq4#Lm2@Vp9", username="superadmin")
        self.assertTrue(is_valid)
        self.assertIn("Fortaleza", message)

    def test_rejects_missing_complexity(self):
        is_valid, message = PasswordPolicy.validate("weakpassword12")
        self.assertFalse(is_valid)
        self.assertIn("mayuscula", message.lower())
        self.assertIn("especial", message.lower())

    def test_rejects_password_containing_username(self):
        is_valid, message = PasswordPolicy.validate("Admin_user#2026", username="admin_user")
        self.assertFalse(is_valid)
        self.assertIn("usuario", message.lower())


if __name__ == "__main__":
    unittest.main()

import unittest
from pathlib import Path


class TestMainWindowContracts(unittest.TestCase):
    def test_user_initialization_does_not_call_removed_legacy_migration_methods(self):
        source = Path("ui/main_window.py").read_text(encoding="utf-8-sig")

        self.assertNotIn("can_migrate_from_legacy(", source)
        self.assertNotIn("migrate_from_legacy(", source)


if __name__ == "__main__":
    unittest.main()

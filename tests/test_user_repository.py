import unittest
from pathlib import Path
from unittest.mock import MagicMock

from managers.user_repository import UserRepository


class TestUserRepository(unittest.TestCase):
    def setUp(self):
        self.owner = MagicMock()
        self.owner.local_mode = False
        self.owner._users_cache_data = None
        self.owner._users_cache_loaded_at = 0.0
        self.owner.USERS_CACHE_TTL_SECONDS = 2.0
        self.owner._cache_clock = MagicMock(return_value=100.0)
        self.owner.logger = MagicMock()
        self.owner.config_dir = Path("tests/temp_repo")
        self.owner.security_manager = None
        self.owner.cloud_encryption = None
        self.repo = UserRepository(self.owner)

    def test_normalize_users_data_handles_invalid_payload(self):
        normalized = self.repo._normalize_users_data(None)

        self.assertEqual(normalized["users"], {})
        self.assertEqual(normalized["version"], "2.1")

    def test_cache_roundtrip_and_ttl_expiration(self):
        payload = {"users": {"admin": {"username": "admin"}}}

        self.repo._set_users_cache(payload)
        self.assertEqual(self.repo._get_cached_users()["users"]["admin"]["username"], "admin")

        self.owner._cache_clock.return_value = 103.5
        self.assertIsNone(self.repo._get_cached_users())


if __name__ == "__main__":
    unittest.main()

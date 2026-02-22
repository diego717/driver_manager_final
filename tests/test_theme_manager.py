import unittest
from unittest.mock import patch

try:
    from ui.theme_manager import ThemeManager

    PYQT_AVAILABLE = True
except Exception:
    ThemeManager = None
    PYQT_AVAILABLE = False


class DummySettings:
    def __init__(self, *_args, **_kwargs):
        self._store = {}

    def value(self, key, default=None):
        return self._store.get(key, default)

    def setValue(self, key, value):
        self._store[key] = value


@unittest.skipUnless(PYQT_AVAILABLE, "PyQt6 is required for ThemeManager tests")
class TestThemeManager(unittest.TestCase):
    def test_generate_stylesheet_returns_non_empty_string_for_both_themes(self):
        with patch("ui.theme_manager.QSettings", DummySettings):
            manager = ThemeManager()

            self.assertTrue(manager.set_theme("light"))
            light_css = manager.generate_stylesheet()
            self.assertIsInstance(light_css, str)
            self.assertTrue(light_css.strip())

            self.assertTrue(manager.set_theme("dark"))
            dark_css = manager.generate_stylesheet()
            self.assertIsInstance(dark_css, str)
            self.assertTrue(dark_css.strip())

    def test_set_theme_invalid_returns_false_without_changing_state(self):
        with patch("ui.theme_manager.QSettings", DummySettings):
            manager = ThemeManager()
            initial_theme = manager.get_current_theme()

            result = manager.set_theme("invalid")

            self.assertFalse(result)
            self.assertEqual(manager.get_current_theme(), initial_theme)


if __name__ == "__main__":
    unittest.main()

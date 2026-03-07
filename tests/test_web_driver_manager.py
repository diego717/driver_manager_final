import shutil
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from core.exceptions import AuthenticationError
from managers.web_driver_manager import WebDriverManager


class _FakeStreamResponse:
    def __init__(self, chunks, status_code=200, headers=None):
        self._chunks = list(chunks or [])
        self.status_code = status_code
        self.ok = status_code < 400
        self.headers = headers or {}
        self.text = ""
        self.content = b"".join(self._chunks)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def iter_content(self, chunk_size=1024):
        _ = chunk_size
        for chunk in self._chunks:
            yield chunk

    def json(self):
        return {}


class TestWebDriverManager(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path("tests/temp_web_driver_manager")
        self.test_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir)

    @patch("managers.web_driver_manager.requests.get")
    def test_list_drivers_success(self, mock_get):
        response = MagicMock()
        response.ok = True
        response.status_code = 200
        response.content = b'{"items":[]}'
        response.json.return_value = {
            "items": [
                {"brand": "Zebra", "version": "1.0.0", "key": "drivers/x.exe"},
            ]
        }
        mock_get.return_value = response

        manager = WebDriverManager(
            api_url_provider=lambda: "https://example.workers.dev",
            token_provider=lambda: "token-123",
        )
        items = manager.list_drivers()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["brand"], "Zebra")

    def test_list_drivers_requires_token(self):
        manager = WebDriverManager(
            api_url_provider=lambda: "https://example.workers.dev",
            token_provider=lambda: "",
        )
        with self.assertRaises(AuthenticationError):
            manager.list_drivers()

    @patch("managers.web_driver_manager.requests.get")
    def test_download_driver_writes_file(self, mock_get):
        payload = [b"abc", b"def"]
        mock_get.return_value = _FakeStreamResponse(
            chunks=payload,
            status_code=200,
            headers={"Content-Length": "6"},
        )

        manager = WebDriverManager(
            api_url_provider=lambda: "https://example.workers.dev",
            token_provider=lambda: "token-123",
        )

        output_file = self.test_dir / "driver.exe"
        progress_values = []
        manager.download_driver(
            driver_key="drivers/demo/driver.exe",
            local_path=str(output_file),
            progress_callback=lambda value: progress_values.append(value),
        )

        self.assertTrue(output_file.exists())
        self.assertEqual(output_file.read_bytes(), b"abcdef")
        self.assertGreaterEqual(progress_values[-1], 100)


if __name__ == "__main__":
    unittest.main()

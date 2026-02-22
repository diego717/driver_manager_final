import unittest
from unittest.mock import MagicMock

try:
    from managers.download_manager import DownloadManager, UploadThread

    PYQT_AVAILABLE = True
except Exception:
    DownloadManager = None
    UploadThread = None
    PYQT_AVAILABLE = False


class _UploadCloudOk:
    def upload_driver(self, local_file, brand, version, description, progress_callback=None):
        if progress_callback:
            progress_callback(42)


class _UploadCloudFail:
    def upload_driver(self, local_file, brand, version, description, progress_callback=None):
        raise RuntimeError("upload failed")


@unittest.skipUnless(PYQT_AVAILABLE, "PyQt6 is required for DownloadManager tests")
class TestDownloadManager(unittest.TestCase):
    def _build_parent(self, cloud_manager):
        parent = MagicMock()
        parent.cloud_manager = cloud_manager
        parent.progress_bar = MagicMock()
        parent.statusBar.return_value = MagicMock()
        parent.on_download_error = MagicMock()
        parent.on_download_finished = MagicMock()
        parent.on_upload_error = MagicMock()
        parent.on_upload_finished = MagicMock()
        return parent

    def test_upload_thread_emits_finished_with_upload_info_dict(self):
        thread = UploadThread(
            _UploadCloudOk(),
            "C:/tmp/driver.exe",
            "Zebra",
            "1.0.0",
            "desc",
        )

        progress_values = []
        finished_payloads = []
        errors = []
        thread.progress.connect(progress_values.append)
        thread.finished.connect(finished_payloads.append)
        thread.error.connect(lambda msg, info: errors.append((msg, info)))

        thread.run()

        self.assertEqual(progress_values, [42])
        self.assertEqual(len(finished_payloads), 1)
        self.assertEqual(finished_payloads[0]["file_path"], "C:/tmp/driver.exe")
        self.assertEqual(finished_payloads[0]["brand"], "Zebra")
        self.assertEqual(finished_payloads[0]["version"], "1.0.0")
        self.assertEqual(finished_payloads[0]["description"], "desc")
        self.assertEqual(errors, [])

    def test_upload_thread_emits_error_with_message_and_upload_info(self):
        thread = UploadThread(
            _UploadCloudFail(),
            "C:/tmp/driver.exe",
            "Magicard",
            "2.1.0",
            "desc fail",
        )

        finished_payloads = []
        errors = []
        thread.finished.connect(finished_payloads.append)
        thread.error.connect(lambda msg, info: errors.append((msg, info)))

        thread.run()

        self.assertEqual(finished_payloads, [])
        self.assertEqual(len(errors), 1)
        error_msg, upload_info = errors[0]
        self.assertIn("upload failed", error_msg)
        self.assertEqual(upload_info["file_path"], "C:/tmp/driver.exe")
        self.assertEqual(upload_info["brand"], "Magicard")
        self.assertEqual(upload_info["version"], "2.1.0")
        self.assertEqual(upload_info["description"], "desc fail")

    def test_start_download_handles_missing_cloud_manager(self):
        parent = self._build_parent(cloud_manager=None)
        manager = DownloadManager(parent)

        result = manager.start_download({"key": "drivers/z.exe", "brand": "Zebra", "version": "1.0"}, "C:/tmp/z.exe")

        self.assertFalse(result)
        self.assertIsNone(manager.download_thread)
        parent.progress_bar.setVisible.assert_called_with(False)
        parent.on_download_error.assert_called_once()
        self.assertEqual(parent.on_download_error.call_args.args[0], "Cloud manager no configurado")

    def test_start_upload_handles_missing_cloud_manager(self):
        parent = self._build_parent(cloud_manager=None)
        manager = DownloadManager(parent)

        result = manager.start_upload("C:/tmp/z.exe", "Zebra", "1.0", "desc")

        self.assertFalse(result)
        self.assertIsNone(manager.upload_thread)
        parent.progress_bar.setVisible.assert_called_with(False)
        parent.on_upload_error.assert_called_once()
        call_args = parent.on_upload_error.call_args.args
        self.assertEqual(call_args[0], "Cloud manager no configurado")
        self.assertEqual(call_args[1]["file_path"], "C:/tmp/z.exe")

    def test_cancel_download_terminates_running_thread(self):
        parent = self._build_parent(cloud_manager=MagicMock())
        manager = DownloadManager(parent)
        manager.download_thread = MagicMock()
        manager.download_thread.isRunning.return_value = True

        result = manager.cancel_download()

        self.assertTrue(result)
        manager.download_thread.requestInterruption.assert_called_once()
        manager.download_thread.terminate.assert_called_once()
        manager.download_thread.wait.assert_called_once_with(2000)
        parent.progress_bar.setVisible.assert_called_with(False)


if __name__ == "__main__":
    unittest.main()

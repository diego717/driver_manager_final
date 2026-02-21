import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

from core.exceptions import ConfigurationError
from managers.cloud_manager import CloudflareR2Manager


class TestCloudflareR2Manager(unittest.TestCase):
    @patch.object(CloudflareR2Manager, "_ensure_manifest", return_value=None)
    @patch("managers.cloud_manager.boto3.client")
    def test_init_extracts_account_id_from_dashboard_url(self, mock_boto_client, _mock_manifest):
        mock_client = MagicMock()
        mock_client.head_bucket.return_value = None
        mock_boto_client.return_value = mock_client

        account_url = "https://dash.cloudflare.com/0123456789abcdef0123456789abcdef/r2/overview"
        manager = CloudflareR2Manager(
            account_url,
            "ACCESS_KEY",
            "SECRET_KEY",
            "my-bucket",
        )

        self.assertEqual(manager.bucket_name, "my-bucket")
        mock_boto_client.assert_called_once_with(
            "s3",
            endpoint_url="https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
            aws_access_key_id="ACCESS_KEY",
            aws_secret_access_key="SECRET_KEY",
            region_name="auto",
        )
        mock_client.head_bucket.assert_called_once_with(Bucket="my-bucket")

    def test_init_raises_when_credentials_are_missing(self):
        with self.assertRaises(ConfigurationError):
            CloudflareR2Manager("", "ACCESS_KEY", "SECRET_KEY", "my-bucket")

    def _new_manager(self):
        manager = CloudflareR2Manager.__new__(CloudflareR2Manager)
        manager.bucket_name = "my-bucket"
        manager.manifest_key = "manifest.json"
        manager.s3_client = MagicMock()
        return manager

    def test_ensure_manifest_creates_file_when_missing(self):
        manager = self._new_manager()
        manager.s3_client.head_object.side_effect = ClientError(
            {"Error": {"Code": "404", "Message": "Not Found"}},
            "HeadObject",
        )

        manager._ensure_manifest()

        manager.s3_client.put_object.assert_called_once()
        kwargs = manager.s3_client.put_object.call_args.kwargs
        self.assertEqual(kwargs["Bucket"], "my-bucket")
        self.assertEqual(kwargs["Key"], "manifest.json")
        self.assertIn('"drivers": []', kwargs["Body"])

    def test_list_drivers_reads_metadata_from_manifest_without_head_requests(self):
        manager = self._new_manager()
        manager._get_manifest = MagicMock(
            return_value={
                "drivers": [
                    {
                        "brand": "Zebra",
                        "version": "1.2.3",
                        "key": "drivers/z/1/setup.exe",
                        "size_bytes": 1048576,
                    },
                    {
                        "brand": "Magicard",
                        "version": "2.0.0",
                        "key": "drivers/m/2/setup.exe",
                        "uploaded": "2026-02-13T10:00:00",
                    },
                ]
            }
        )

        drivers = manager.list_drivers()

        self.assertEqual(len(drivers), 2)
        self.assertEqual(drivers[0]["size_mb"], 1.0)
        self.assertEqual(drivers[1]["last_modified"], "2026-02-13 10:00:00")
        self.assertEqual(drivers[1]["brand"], "Magicard")
        manager.s3_client.head_object.assert_not_called()

    @patch("managers.cloud_manager.os.path.getsize", return_value=100)
    def test_upload_driver_updates_manifest_and_reports_progress(self, _mock_getsize):
        manager = self._new_manager()
        manager._get_manifest = MagicMock(
            return_value={
                "drivers": [
                    {"brand": "Zebra", "version": "1.2.3", "key": "old/key.exe"},
                    {"brand": "Entrust", "version": "4.0", "key": "keep/key.exe"},
                ]
            }
        )
        manager._update_manifest = MagicMock()

        def upload_side_effect(local_path, bucket, key, Callback=None):
            if Callback:
                Callback(50)
                Callback(100)

        manager.s3_client.upload_file.side_effect = upload_side_effect
        progress_values = []

        driver_key = manager.upload_driver(
            "C:/tmp/new_driver.exe",
            "Zebra",
            "1.2.3",
            "updated",
            progress_callback=progress_values.append,
        )

        self.assertEqual(driver_key, "drivers/Zebra/1.2.3/new_driver.exe")
        self.assertEqual(progress_values, [50, 100])
        manager._update_manifest.assert_called_once()
        manifest = manager._update_manifest.call_args.args[0]
        keys = [d["key"] for d in manifest["drivers"]]
        self.assertIn("keep/key.exe", keys)
        self.assertIn("drivers/Zebra/1.2.3/new_driver.exe", keys)
        self.assertNotIn("old/key.exe", keys)
        uploaded_driver = next(d for d in manifest["drivers"] if d["key"] == "drivers/Zebra/1.2.3/new_driver.exe")
        self.assertEqual(uploaded_driver["size_bytes"], 100)
        self.assertAlmostEqual(uploaded_driver["size_mb"], 0.0, places=2)
        self.assertIn("last_modified", uploaded_driver)

    def test_download_driver_downloads_file_and_reports_progress(self):
        manager = self._new_manager()
        manager.s3_client.head_object.return_value = {"ContentLength": 100}

        def download_side_effect(bucket, key, local_path, Callback=None):
            if Callback:
                Callback(25)
                Callback(75)

        manager.s3_client.download_file.side_effect = download_side_effect
        progress_values = []

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cache" / "driver.exe"
            result = manager.download_driver(
                "drivers/Zebra/1.2.3/new_driver.exe",
                str(target),
                progress_callback=progress_values.append,
            )

            self.assertEqual(result, str(target))
            self.assertTrue(target.parent.exists())
            self.assertEqual(progress_values, [25, 100])

    def test_delete_driver_removes_entry_from_manifest(self):
        manager = self._new_manager()
        manager._get_manifest = MagicMock(
            return_value={
                "drivers": [
                    {"key": "drivers/a.exe", "brand": "A", "version": "1"},
                    {"key": "drivers/b.exe", "brand": "B", "version": "1"},
                ]
            }
        )
        manager._update_manifest = MagicMock()

        manager.delete_driver("drivers/a.exe")

        manager.s3_client.delete_object.assert_called_once_with(
            Bucket="my-bucket",
            Key="drivers/a.exe",
        )
        manifest = manager._update_manifest.call_args.args[0]
        self.assertEqual(len(manifest["drivers"]), 1)
        self.assertEqual(manifest["drivers"][0]["key"], "drivers/b.exe")

    def test_download_file_content_returns_none_for_missing_key(self):
        manager = self._new_manager()
        manager.s3_client.get_object.side_effect = ClientError(
            {"Error": {"Code": "NoSuchKey", "Message": "missing"}},
            "GetObject",
        )

        content = manager.download_file_content("missing.json")

        self.assertIsNone(content)

    def test_search_drivers_applies_filters(self):
        manager = self._new_manager()
        manager.list_drivers = MagicMock(
            return_value=[
                {"brand": "Zebra", "version": "1.0"},
                {"brand": "Zebra", "version": "2.0"},
                {"brand": "Magicard", "version": "1.0"},
            ]
        )

        result = manager.search_drivers(brand="Zebra", version="2.0")

        self.assertEqual(result, [{"brand": "Zebra", "version": "2.0"}])


if __name__ == "__main__":
    unittest.main()

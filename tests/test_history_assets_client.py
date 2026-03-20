import unittest
from unittest.mock import MagicMock

from managers.history_assets_client import HistoryAssetsClient


class TestHistoryAssetsClient(unittest.TestCase):
    def setUp(self):
        self.request = MagicMock()
        self.client = HistoryAssetsClient(
            self.request,
            incident_normalizer=lambda item: {"normalized": True, **item},
        )

    def test_build_resolve_asset_payload_requires_external_code(self):
        with self.assertRaises(ValueError):
            self.client.build_resolve_asset_payload("")

    def test_resolve_and_save_asset_delegate_to_request(self):
        self.request.side_effect = [
            {"asset": {"id": 10, "external_code": "A-1"}},
            {"asset": {"id": 11, "external_code": "A-2"}},
        ]

        asset = self.client.resolve_asset(
            self.client.build_resolve_asset_payload("A-1", brand="Zebra")
        )
        saved = self.client.save_asset("A-2", brand="Magicard")

        self.assertEqual(asset["id"], 10)
        self.assertEqual(saved["id"], 11)
        self.assertEqual(self.request.call_count, 2)

    def test_list_assets_and_get_asset_by_id(self):
        self.request.side_effect = [
            {"items": [{"id": 1}]},
            {"asset": {"id": 22}},
        ]

        items = self.client.list_assets(limit=20, brand="Zebra")
        asset = self.client.get_asset_by_id(22)

        self.assertEqual(items, [{"id": 1}])
        self.assertEqual(asset, {"id": 22})
        self.assertEqual(self.request.call_count, 2)

    def test_get_asset_incidents_normalizes_incidents(self):
        self.request.return_value = {
            "asset": {"id": 10},
            "active_link": None,
            "links": [],
            "incidents": [{"id": 1}],
        }

        payload = self.client.get_asset_incidents(10, limit=5)

        self.assertEqual(payload["incidents"], [{"normalized": True, "id": 1}])
        self.request.assert_called_once_with(
            "get",
            "assets/10/incidents",
            params={"limit": 5},
        )

    def test_delete_link_and_associate_asset(self):
        self.request.side_effect = [
            None,
            {"link": {"id": 5}},
            {"asset": {"id": 77}},
            {"link": {"id": 88}},
        ]

        deleted = self.client.delete_asset(44)
        link = self.client.link_asset_to_installation(44, 12, notes="ok")
        asset, assoc_link = self.client.associate_asset_with_installation("EXT-1", 12, notes="join")

        self.assertTrue(deleted)
        self.assertEqual(link, {"id": 5})
        self.assertEqual(asset, {"id": 77})
        self.assertEqual(assoc_link, {"id": 88})


if __name__ == "__main__":
    unittest.main()

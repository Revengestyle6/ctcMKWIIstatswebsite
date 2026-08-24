import json
import unittest

from match_upload import prepare_upload_document
from playoff_service import automatic_match_label, ensure_match_label


class MatchLabelTests(unittest.TestCase):
    def test_regular_label_uses_match_number_and_team_tags(self):
        match = {
            "league": "ctc",
            "season": "s3",
            "division": "d1",
            "match_number": 4,
            "teams": {
                "Raw team A": {"table_tag_str": "CS #112233"},
                "Raw team B": {"table_tag_str": "SLAY #abcdef"},
            },
        }

        document = prepare_upload_document(match)

        self.assertEqual(match["match_label"], "M4 CS vs SLAY")
        self.assertEqual(json.loads(document.content)["match_label"], "M4 CS vs SLAY")
        self.assertEqual(document.filename, "M4 CS vs SLAY.json")

    def test_existing_historical_label_is_preserved(self):
        match = {
            "match_number": 4,
            "match_label": "Original imported label",
            "teams": {"CS": {}, "SLAY": {}},
        }

        self.assertEqual(ensure_match_label(match), "Original imported label")
        self.assertEqual(match["match_label"], "Original imported label")

    def test_playoff_label_uses_series_metadata(self):
        match = {
            "match_type": "playoff",
            "playoff_stage": "semifinals",
            "playoff_series_number": 2,
            "series_match_number": 3,
            "teams": {"CS": {}, "SLAY": {}},
        }

        self.assertEqual(automatic_match_label(match), "Semifinals Series 2 — Match 3")


if __name__ == "__main__":
    unittest.main()

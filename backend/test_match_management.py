import unittest
from unittest.mock import Mock

from test_support import configure_test_environment

configure_test_environment()

from match_management import (  # noqa: E402
    _changes,
    _normalized_for_edit_comparison,
    delete_archive_best_effort,
    edit_preview_summary,
)


class MatchManagementComparisonTests(unittest.TestCase):
    def test_legacy_week_is_compared_as_match_number(self):
        before = _normalized_for_edit_comparison({"week": 4, "match_label": "M4 A vs B"})
        after = _normalized_for_edit_comparison({"match_number": 4, "match_label": "M4 A vs B"})

        self.assertEqual(_changes(before, after), [])

    def test_real_match_number_change_is_still_reported(self):
        before = _normalized_for_edit_comparison({"week": 4})
        after = _normalized_for_edit_comparison({"match_number": 5})

        self.assertEqual(
            _changes(before, after),
            [{"path": "match_number", "before": 4, "after": 5}],
        )

    def test_preview_summary_omits_rolled_back_after_ids(self):
        summary = {
            "records_before": {"races": 12},
            "records_after": {"races": 12},
            "record_ids_before": {"races": [1, 2]},
            "record_ids_after": {"races": [101, 102]},
        }

        preview = edit_preview_summary(summary)

        self.assertNotIn("record_ids_after", preview)
        self.assertEqual(preview["record_ids_before"], {"races": [1, 2]})
        self.assertIn("record_ids_after", summary)

    def test_obsolete_archive_cleanup_is_best_effort(self):
        storage = Mock()
        storage.delete.side_effect = OSError("storage unavailable")

        self.assertEqual(
            delete_archive_best_effort(storage, "accepted/old.json"),
            "pending",
        )
        storage.delete.assert_called_once_with("accepted/old.json")
        self.assertEqual(delete_archive_best_effort(storage, None), "not_needed")


if __name__ == "__main__":
    unittest.main()

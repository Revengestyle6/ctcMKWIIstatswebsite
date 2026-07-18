import unittest

from import_json_to_db import infer_role, resolve_role


class ImportRoleInferenceTests(unittest.TestCase):
    def test_valid_race_placements_infer_roles(self):
        cases = (
            (1, "runner"),
            (8, "runner"),
            (9, "bagger"),
            (10, "bagger"),
        )

        for position, expected_role in cases:
            with self.subTest(position=position):
                self.assertEqual(
                    infer_role(position),
                    (expected_role, "inferred"),
                )

    def test_missing_or_invalid_placements_remain_unknown(self):
        cases = (
            None,
            0,
            11,
            9.5,
            True,
            "10",
            float("nan"),
            float("inf"),
        )

        for position in cases:
            with self.subTest(position=position):
                self.assertEqual(infer_role(position), ("unknown", "unknown"))

    def test_explicit_role_always_wins(self):
        self.assertEqual(resolve_role("runner", 10), ("runner", "manual"))
        self.assertEqual(resolve_role(" BAGGER ", 1), ("bagger", "manual"))
        self.assertEqual(resolve_role(None, 9), ("bagger", "inferred"))


if __name__ == "__main__":
    unittest.main()

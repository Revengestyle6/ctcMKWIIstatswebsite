"""Unicode identity regressions across setup, review, editing and analytics."""

import unittest
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

from alias_management import add_alias, list_entities  # noqa: E402
from competition_setup import create_team, create_team_season_entry  # noqa: E402
from database_text import database_text_key  # noqa: E402
from import_json_to_db import (  # noqa: E402
    detect_new_entries,
    get_or_create_team,
    import_preview_match,
    load_database_team_aliases,
    resolve_team_alias,
)
from match_review import unapproved_entries  # noqa: E402
from models import (  # noqa: E402
    Division,
    Match,
    PlayoffSeries,
    PlayoffSeriesParticipant,
    Season,
    Team,
    TeamAlias,
    TeamLeagueIdentity,
    TeamSeasonEntry,
)
from sqlalchemy import select  # noqa: E402
from stats_queries import _get_scope, _resolve_team, list_matches, list_playoff_series  # noqa: E402
from team_identity_management import (  # noqa: E402
    add_league_identity,
    merge_team,
    team_merge_comparison,
    update_canonical_identity,
    update_season_identity,
)


class UnicodeTeamIdentityTests(unittest.TestCase):
    def setUp(self):
        self.database = PostgreSQLTestDatabase()
        self.addCleanup(self.database.close)
        self.session = self.database.SessionLocal()
        self.addCleanup(self.session.close)
        self.season = Season(league_code="gsc", season_code="s16", name="GSC S16")
        self.session.add(self.season)
        self.session.flush()
        self.division = Division(
            season_id=self.season.season_id, division_code="d2", division_name="D2"
        )
        self.session.add(self.division)
        self.session.flush()

    def register(self, tag, name="Zero Tolerance"):
        team = create_team(
            self.session, {"league": "gsc", "canonical_tag": tag, "canonical_name": name}
        )
        entry, *_ = create_team_season_entry(
            self.session,
            {
                "team_id": team.team_id,
                "season_id": self.season.season_id,
                "division_id": self.division.division_id,
                "display_name": name,
                "clan_tag": tag,
            },
        )
        return team, entry

    def match_data(self, first, second):
        return {
            "league": "gsc",
            "season": "s16",
            "division": "d2",
            "match_number": 1,
            "match_label": "M1 Unicode identity regression",
            "match_type": "regular",
            "result_type": "mutual_tie",
            "format": "5v5",
            "races_played": 0,
            "tracks": [],
            "teams": {tag: {"total_score": 0, "players": {}} for tag in (first, second)},
        }

    def test_database_keys_cover_contextual_and_expanding_unicode_casing(self):
        for value, expected in (
            ("ZΣ", "zσ"),
            ("Zσ", "zσ"),
            ("Zς", "zς"),
            ("βς", "βς"),
            ("ΟΣ", "οσ"),
            ("İ", "i"),
            ("ẞ", "ß"),
            ("𐐀", "𐐨"),
        ):
            with self.subTest(value=value):
                self.assertEqual(database_text_key(self.session, value), expected)

    def test_uppercase_sigma_preview_and_import_reuse_registered_identity(self):
        team, entry = self.register("ZΣ")
        self.register("OT", "Opponent")
        data = self.match_data("ZΣ", "OT")
        self.assertEqual(detect_new_entries(self.session, data), [])
        self.assertEqual(get_or_create_team(self.session, "gsc", "ZΣ").team_id, team.team_id)
        match = import_preview_match(self.session, data)
        self.session.flush()
        self.assertEqual(self.session.query(Team).count(), 2)
        self.assertEqual(self.session.query(TeamSeasonEntry).count(), 2)
        self.assertEqual(self.session.query(TeamLeagueIdentity).count(), 2)
        scope = _get_scope(self.session, season="s16", division="d2", league_code="gsc")
        self.assertEqual(
            _resolve_team(self.session, "ZΣ", scope).team_season_entry_id,
            entry.team_season_entry_id,
        )
        with patch("stats_queries.SessionLocal", self.database.SessionLocal):
            self.session.commit()
            self.assertEqual(
                [row["match_id"] for row in list_matches("s16", "d2", "ZΣ", league_code="gsc")],
                [match.match_id],
            )

    def test_playoff_team_filter_uses_the_same_sigma_keys_as_registration(self):
        first, first_entry = self.register("ZΣ")
        second, second_entry = self.register("OT", "Opponent")
        series = PlayoffSeries(
            season_id=self.season.season_id,
            division_id=self.division.division_id,
            stage="semifinals",
            series_number=1,
            best_of=3,
        )
        self.session.add(series)
        self.session.flush()
        for slot, (team, entry) in enumerate(((first, first_entry), (second, second_entry)), 1):
            self.session.add(
                PlayoffSeriesParticipant(
                    playoff_series_id=series.playoff_series_id,
                    team_id=team.team_id,
                    team_season_entry_id=entry.team_season_entry_id,
                    participant_slot=slot,
                )
            )
        self.session.flush()
        result = list_playoff_series("s16", "d2", "zσ", league_code="gsc", session=self.session)
        self.assertEqual(len(result["series"]), 1)

    def test_distinct_new_sigma_tags_require_separate_approvals(self):
        data = self.match_data("ZΣ", "Zς")
        entries = detect_new_entries(self.session, data)
        teams = [entry for entry in entries if entry["type"] == "team"]
        self.assertEqual({entry["value"] for entry in teams}, {"ZΣ", "Zς"})
        self.assertEqual(len({entry["key"] for entry in teams}), 2)
        _, unapproved, *_ = unapproved_entries(self.session, data, [teams[0]["key"]])
        self.assertEqual([entry["value"] for entry in unapproved], [teams[1]["value"]])

    def test_restore_sigma_season_tag_keeps_existing_team_and_import_identity(self):
        team, entry = self.register("ZE")
        self.register("OT", "Opponent")
        add_alias(self.session, "teams", team.team_id, {"value": "ZΣ"})
        add_league_identity(self.session, team.team_id, {"league": "gsc", "tag": "ZΣ"})
        team_id, entry_id = team.team_id, entry.team_season_entry_id
        update_season_identity(
            self.session,
            team_id,
            entry_id,
            {
                "display_name": "Zero Tolerance",
                "clan_tag": "ZΣ",
            },
        )
        self.assertEqual(team.canonical_tag, "ZΣ")
        self.assertEqual(entry.clan_tag, "ZΣ")
        self.assertEqual((team.team_id, entry.team_season_entry_id), (team_id, entry_id))
        aliases = self.session.scalars(
            select(TeamAlias.alias_value).where(TeamAlias.team_id == team_id)
        ).all()
        self.assertEqual(aliases, ["ZE"])
        identities = self.session.scalars(
            select(TeamLeagueIdentity.tag).where(TeamLeagueIdentity.team_id == team_id)
        ).all()
        self.assertEqual(set(identities), {"ZE", "ZΣ"})
        data = self.match_data("ZΣ", "OT")
        self.assertEqual(detect_new_entries(self.session, data), [])
        import_preview_match(self.session, data)
        self.session.flush()
        self.assertEqual(self.session.query(Team).count(), 2)
        self.assertEqual(self.session.query(TeamSeasonEntry).count(), 2)

    def test_duplicate_uppercase_sigma_is_a_validation_error_not_database_failure(self):
        team, _ = self.register("ZΣ")
        for requested in ("ZΣ", "zσ"):
            with self.subTest(requested=requested):
                with self.assertRaisesRegex(ValueError, "already linked to this team"):
                    add_league_identity(
                        self.session, team.team_id, {"league": "gsc", "tag": requested}
                    )
                with self.assertRaisesRegex(ValueError, "already this team's canonical tag"):
                    add_alias(self.session, "teams", team.team_id, {"value": requested})
        self.assertEqual(self.session.query(TeamLeagueIdentity).count(), 1)

    def test_alias_promotion_and_season_collision_use_database_keys(self):
        team, entry = self.register("ZE")
        other, other_entry = self.register("OT", "Opponent")
        self.session.add(TeamAlias(team_id=team.team_id, alias_value="ZΣ"))
        self.session.flush()
        team.canonical_identity_override = True
        detail, _ = update_canonical_identity(
            self.session, team.team_id, {"canonical_name": "Zero Tolerance", "canonical_tag": "ZΣ"}
        )
        self.assertEqual(detail["team"]["canonical_tag"], "ZΣ")
        self.assertIsNone(
            self.session.scalar(select(TeamAlias).where(TeamAlias.alias_value == "ZΣ"))
        )
        update_season_identity(
            self.session,
            team.team_id,
            entry.team_season_entry_id,
            {"display_name": "Zero Tolerance", "clan_tag": "ZΣ"},
        )
        with self.assertRaisesRegex(ValueError, "already used"):
            update_season_identity(
                self.session,
                other.team_id,
                other_entry.team_season_entry_id,
                {"display_name": "Opponent", "clan_tag": "ZΣ"},
            )
        self.assertEqual(
            [row["id"] for row in list_entities(self.session, "teams", "ZΣ")], [team.team_id]
        )

    def test_final_sigma_is_distinct_when_the_database_index_distinguishes_it(self):
        upper, _ = self.register("ZΣ", "Upper Sigma")
        final, _ = self.register("Zς", "Final Sigma")
        aliases = load_database_team_aliases(self.session)
        for tag, expected in (("zσ", upper), ("Zς", final)):
            with self.subTest(tag=tag):
                alias = resolve_team_alias(
                    aliases, "gsc", "s16", "d2", "", tag, session=self.session
                )
                self.assertEqual(alias["team_id"], expected.team_id)
        data = self.match_data("zσ", "Zς")
        self.assertEqual(detect_new_entries(self.session, data), [])
        import_preview_match(self.session, data)
        self.session.flush()
        self.assertEqual(self.session.query(Team).count(), 2)
        self.assertEqual(self.session.query(Match).count(), 1)

    def test_merge_preserves_distinct_sigma_entries_consistent_with_comparison(self):
        source, _ = self.register("ZΣ", "Upper Sigma")
        target, _ = self.register("Zς", "Final Sigma")
        comparison = team_merge_comparison(self.session, source.team_id, target.team_id)
        self.assertEqual(comparison["impact"]["overlapping_season_entries"], 0)
        merge_team(self.session, source.team_id, {"target_team_id": target.team_id})
        self.session.flush()
        entries = self.session.scalars(
            select(TeamSeasonEntry).where(TeamSeasonEntry.team_id == target.team_id)
        ).all()
        self.assertEqual({entry.clan_tag for entry in entries}, {"ZΣ", "Zς"})
        identities = self.session.scalars(
            select(TeamLeagueIdentity).where(TeamLeagueIdentity.team_id == target.team_id)
        ).all()
        self.assertEqual({identity.tag for identity in identities}, {"ZΣ", "Zς"})


if __name__ == "__main__":
    unittest.main()

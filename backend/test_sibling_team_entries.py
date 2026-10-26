"""A GSC division can contain opponents with the same canonical team identity."""

import copy
import json
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

import stats_db  # noqa: E402
from competition_setup import create_team_season_entry  # noqa: E402
from import_json_to_db import (  # noqa: E402
    detect_new_entries,
    import_preview_match,
    load_database_team_aliases,
    resolve_team_alias,
)
from match_editor_catalog import list_player_team_memberships, list_team_roster_pool  # noqa: E402
from models import (  # noqa: E402
    Division,
    DivisionPlayoffConfig,
    MatchTeam,
    PlayerSeasonEntry,
    Season,
    Team,
    TeamSeasonEntry,
)
from sqlalchemy import select  # noqa: E402
from standings_service import get_division_standings  # noqa: E402
from stats_queries import get_match_detail, list_playoff_series  # noqa: E402
from team_dashboard_stats import get_team_overview, get_team_roster, get_team_tracks  # noqa: E402
from team_identity_management import delete_season_identity, merge_team  # noqa: E402
from test_unaccounted_matches import aggregate_document  # noqa: E402
from track_analytics import get_track_analytics, get_track_dashboard  # noqa: E402


class SiblingTeamEntryTests(unittest.TestCase):
    def setUp(self):
        self.database = PostgreSQLTestDatabase()
        self.session = self.database.SessionLocal()
        self.season = Season(
            league_code="gsc", season_code="s16", season_number=16, name="GSC Season 16"
        )
        self.team = Team(
            canonical_name="Jinx", canonical_tag="Jx.", canonical_identity_override=True
        )
        self.session.add_all([self.season, self.team])
        self.session.flush()
        self.division = Division(
            season_id=self.season.season_id, division_code="d1", division_name="Division 1"
        )
        self.session.add(self.division)
        self.session.flush()
        self.entries = [self.register("Jx.A", "Jinx Alpha"), self.register("Jx.B", "Jinx Beta")]
        path = Path(__file__).parent / "JSON/ctc/s3/d2/W11 [M11] sts 366 - 356 CS.json"
        self.document = json.loads(path.read_text())
        self.document.update(league="gsc", season="s16", division="d1", match_number=1)
        self.document["teams"] = {
            tag: {**data, "table_tag_str": tag}
            for tag, data in zip(("Jx.A", "Jx.B"), self.document["teams"].values())
        }

    def tearDown(self):
        self.session.rollback()
        self.session.close()
        self.database.close()

    def register(self, tag, name):
        entry, *_ = create_team_season_entry(
            self.session,
            {
                "team_id": self.team.team_id,
                "season_id": self.season.season_id,
                "division_id": self.division.division_id,
                "clan_tag": tag,
                "display_name": name,
            },
        )
        return entry

    def overview(self, **kwargs):
        return get_team_overview(
            self.team.team_id,
            league="gsc",
            season="s16",
            division="d1",
            min_races=1,
            session=self.session,
            **kwargs,
        )

    def test_registration_requires_distinct_tags_and_rejects_duplicate_identity(self):
        with self.assertRaisesRegex(ValueError, "already registered"):
            self.register("jx.a", "jinx alpha")
        with self.assertRaisesRegex(ValueError, "already used"):
            self.register("jx.a", "Different name")
        # Names may coincide; distinct tags still unambiguously identify match sides.
        third = self.register("Jx.C", "Jinx Alpha")
        self.assertEqual(third.team_id, self.team.team_id)

    def test_season_tags_take_precedence_over_other_entries_names_ignoring_case(self):
        self.entries[0].display_name = "jx.b"
        self.session.flush()
        alias = resolve_team_alias(
            load_database_team_aliases(self.session),
            "gsc",
            "s16",
            "d1",
            "",
            "jx.b",
            session=self.session,
        )
        self.assertEqual(alias["canonical_tag"], "Jx.B")

    def test_merging_a_team_preserves_distinct_entries_in_the_same_division(self):
        source = Team(canonical_name="Separate team", canonical_tag="NEW")
        self.session.add(source)
        self.session.flush()
        source_entry, *_ = create_team_season_entry(
            self.session,
            {
                "team_id": source.team_id,
                "season_id": self.season.season_id,
                "division_id": self.division.division_id,
                "clan_tag": "NEW",
                "display_name": "Separate entry",
            },
        )
        result = merge_team(self.session, source.team_id, {"target_team_id": self.team.team_id})
        self.assertEqual(result["season_entries_consolidated"], 0)
        self.assertEqual(
            self.session.get(TeamSeasonEntry, source_entry.team_season_entry_id).team_id,
            self.team.team_id,
        )
        self.assertEqual(len(result["target"]["season_entries"]), 3)

    def test_import_standings_dashboards_rosters_and_track_reports_preserve_both_sides(self):
        self.assertEqual(
            [
                entry
                for entry in detect_new_entries(self.session, self.document)
                if entry["type"] == "team"
            ],
            [],
        )
        match = import_preview_match(self.session, self.document)
        sides = self.session.scalars(
            select(MatchTeam).where(MatchTeam.match_id == match.match_id)
        ).all()
        self.assertEqual(
            {side.team_season_entry_id for side in sides},
            {e.team_season_entry_id for e in self.entries},
        )
        detail = get_match_detail(match.match_id, session=self.session)
        self.assertEqual({side["tag"] for side in detail["teams"]}, {"Jx.A", "Jx.B"})
        standings = get_division_standings(self.session, league="gsc", season="s16", division="d1")
        self.assertEqual(len(standings["standings"]), 2)
        self.assertEqual(sum(row["wins"] for row in standings["standings"]), 1)
        self.assertEqual(sum(row["losses"] for row in standings["standings"]), 1)
        overview = self.overview()
        self.assertEqual(overview["record"], {"wins": 1, "losses": 1, "ties": 0, "unknown": 0})
        self.assertEqual(overview["metrics"]["average_differential"], 0)
        self.assertEqual(overview["metrics"]["races"], 24)
        self.assertEqual(overview["ranking"]["value"], 0)
        self.assertIsNone(overview["identity"]["current_entry"])
        self.assertEqual(len(overview["identity"]["current_entries"]), 2)
        self.assertEqual(
            self.overview(opponent_team_id=self.team.team_id)["record"], overview["record"]
        )
        with self.assertRaisesRegex(ValueError, "Choose a team season entry"):
            list_team_roster_pool(self.session, "gsc", "s16", "d1", self.team.team_id)
        rosters = [
            list_team_roster_pool(
                self.session, "gsc", "s16", "d1", self.team.team_id, e.team_season_entry_id
            )
            for e in self.entries
        ]
        self.assertTrue(rosters[0] and rosters[1])
        self.assertFalse(
            {p["player_id"] for p in rosters[0]} & {p["player_id"] for p in rosters[1]}
        )
        self.session.add(
            PlayerSeasonEntry(
                player_id=rosters[0][0]["player_id"],
                team_season_entry_id=self.entries[1].team_season_entry_id,
                season_id=self.season.season_id,
                division_id=self.division.division_id,
            )
        )
        self.session.flush()
        memberships = list_player_team_memberships(
            self.session, "gsc", "s16", "d1", [rosters[0][0]["player_id"]]
        )
        self.assertEqual(len(memberships[0]["teams"]), 2)
        tracks = get_track_analytics(
            self.session, league="gsc", season="s16", division="d1", min_plays=1
        )
        self.assertEqual(tracks["summary"]["races"], 12)
        track_id = tracks["tracks"][0]["track_id"]
        track = get_track_dashboard(
            self.session, track_id, league="gsc", season="s16", division="d1", min_plays=1
        )
        self.assertEqual(len(track["teams"]), 2)
        margins = {row["team_season_entry_id"]: row["average_margin"] for row in track["teams"]}
        self.assertEqual(sum(margins.values()), 0)
        player_entries = {
            p["player_id"]: e.team_season_entry_id
            for e, roster in zip(self.entries, rosters)
            for p in roster
        }
        for player in track["players"]:
            self.assertEqual(
                player["average_team_margin"], margins[player_entries[player["player_id"]]]
            )
        combined_tracks = get_team_tracks(
            self.team.team_id,
            league="gsc",
            season="s16",
            division="d1",
            min_races=1,
            session=self.session,
        )
        self.assertEqual(sum(row["races"] for row in combined_tracks["tracks"]), 24)
        with patch("stats_db.SessionLocal", return_value=nullcontext(self.session)):
            first = stats_db.top_team_players(
                "Jx.A", season="s16", division="d1", league="gsc", min_races=1
            )
        self.assertTrue({p["player_id"] for p in first} <= {p["player_id"] for p in rosters[0]})

    def test_aliases_cannot_put_one_season_entry_on_both_sides(self):
        # A scoped alias for one raw tag must resolve to the same entry, not become
        # a second competing side merely because the JSON has two object keys.
        from import_json_to_db import PlayerIdentities, import_match, load_database_team_aliases
        from models import SourceFile

        aliases = load_database_team_aliases(self.session)
        aliases[("gsc", "s16", "d1", "", "Other")] = aliases[("gsc", "s16", "d1", "", "Jx.A")]
        document = copy.deepcopy(self.document)
        document["teams"]["Other"] = document["teams"].pop("Jx.B")
        source = SourceFile(
            season_id=self.season.season_id,
            division_id=self.division.division_id,
            source_path="test.json",
            source_filename="test.json",
            file_sha256="test",
            json_shape="single_match",
        )
        self.session.add(source)
        self.session.flush()
        with self.assertRaisesRegex(ValueError, "distinct team season entries"):
            import_match(
                self.session,
                source,
                self.season,
                self.division,
                document,
                Path("m1.json"),
                0,
                aliases,
                PlayerIdentities(),
                "gsc",
                "s16",
                "d1",
                match_number_override=1,
            )

    def test_archive_correction_merges_extra_raw_team_into_one_of_two_entries(self):
        from import_json_to_db import (
            JSON_ROOT,
            PlayerIdentities,
            import_file,
            load_archive_team_aliases,
        )
        from models import Match, MatchPlayer

        path = JSON_ROOT / "ctc/s1/d1_2/W8 6c O.json"
        imported, skipped = import_file(
            self.session,
            path,
            load_archive_team_aliases(self.session),
            PlayerIdentities(),
        )
        self.assertEqual((imported, skipped), (1, 0))
        match = self.session.scalar(select(Match))
        sides = self.session.scalars(
            select(MatchTeam).where(MatchTeam.match_id == match.match_id)
        ).all()
        self.assertEqual(len(sides), 2)
        self.assertEqual(len({side.team_season_entry_id for side in sides}), 2)
        merged = next(side for side in sides if side.raw_team_key == "6¢|1")
        self.assertEqual(merged.final_score, 394)
        players = self.session.scalars(
            select(MatchPlayer).where(MatchPlayer.match_team_id == merged.match_team_id)
        ).all()
        self.assertEqual(len(players), 6)

    def test_unaccounted_sibling_match_keeps_two_records_and_entry_rosters(self):
        document = aggregate_document("totals")
        document.update(league="gsc", season="s16", division="d1")
        document["teams"] = {
            tag: {**data, "table_tag_str": tag}
            for tag, data in zip(("Jx.A", "Jx.B"), document["teams"].values())
        }
        import_preview_match(self.session, document)
        overview = self.overview(include_unaccounted=True)
        self.assertEqual(overview["record"]["wins"], 1)
        self.assertEqual(overview["record"]["losses"], 1)
        roster = get_team_roster(
            self.team.team_id,
            league="gsc",
            season="s16",
            division="d1",
            min_races=1,
            session=self.session,
            include_unaccounted=True,
            team_season_entry_id=self.entries[0].team_season_entry_id,
        )
        self.assertEqual(len(roster["players"]), 1)

    def test_playoff_sibling_pairing_counts_wins_and_clinches_by_entry(self):
        self.session.add(
            DivisionPlayoffConfig(
                division_id=self.division.division_id,
                format_code="three_team",
                playoff_team_count=3,
                semifinal_series_count=1,
                finals_bye_count=1,
            )
        )
        self.session.flush()
        document = copy.deepcopy(self.document)
        document.pop("match_number", None)
        document.pop("week", None)
        document.update(
            match_type="playoff",
            playoff_format="three_team",
            playoff_stage="semifinals",
            playoff_series_number=1,
            series_match_number=1,
            best_of=3,
        )
        import_preview_match(self.session, document)
        unused_sibling = self.register("Jx.C", "Jinx Gamma")
        delete_season_identity(self.session, self.team.team_id, unused_sibling.team_season_entry_id)
        self.assertIsNone(self.session.get(TeamSeasonEntry, unused_sibling.team_season_entry_id))
        document["series_match_number"] = 2
        self.assertFalse(
            any(entry["type"] == "team" for entry in detect_new_entries(self.session, document))
        )
        import_preview_match(self.session, document)
        series = list_playoff_series(
            session=self.session, league_code="gsc", season="s16", division="d1"
        )["series"][0]
        self.assertEqual(len(series["participants"]), 2)
        self.assertEqual(sorted(p["wins"] for p in series["participants"]), [0, 2])
        self.assertEqual(series["status"], "complete")
        self.assertIn(
            series["winner_team_season_entry_id"], {e.team_season_entry_id for e in self.entries}
        )
        document["series_match_number"] = 3
        with self.assertRaisesRegex(ValueError, "clinched"):
            detect_new_entries(self.session, document)

    def test_siblings_can_win_separate_semifinals_and_meet_in_finals(self):
        self.session.add(
            DivisionPlayoffConfig(
                division_id=self.division.division_id,
                format_code="four_team",
                playoff_team_count=4,
                semifinal_series_count=2,
                finals_bye_count=0,
            )
        )
        self.session.flush()
        for series_number, tags in enumerate((("Jx.A", "C"), ("Jx.B", "D")), 1):
            document = aggregate_document("totals")
            document.pop("match_number")
            document.update(
                league="gsc",
                season="s16",
                division="d1",
                match_type="playoff",
                playoff_format="four_team",
                playoff_stage="semifinals",
                playoff_series_number=series_number,
                series_match_number=1,
                best_of=1,
            )
            document["teams"] = {
                tag: {**data, "table_tag_str": tag}
                for tag, data in zip(tags, document["teams"].values())
            }
            import_preview_match(self.session, document)
        finals = copy.deepcopy(self.document)
        finals.pop("match_number", None)
        finals.pop("week", None)
        finals.update(
            match_type="playoff",
            playoff_format="four_team",
            playoff_stage="finals",
            playoff_series_number=1,
            series_match_number=1,
            best_of=1,
        )
        import_preview_match(self.session, finals)
        result = list_playoff_series(
            session=self.session, league_code="gsc", season="s16", division="d1"
        )
        final = next(series for series in result["series"] if series["stage"] == "finals")
        self.assertEqual(
            {participant["team_season_entry_id"] for participant in final["participants"]},
            {entry.team_season_entry_id for entry in self.entries},
        )
        self.assertEqual(final["status"], "complete")

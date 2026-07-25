# ruff: noqa: E402

import unittest
from contextlib import nullcontext
from unittest.mock import patch

from test_support import configure_test_environment

configure_test_environment()

import app as app_module
import dashboard_stats as dashboard_module
import stats_db
import stats_queries
from analytics_eligibility import analytics_excluded_race_ids
from dashboard_stats import (
    DashboardError,
    get_player_overview,
    get_player_performance,
    get_player_tracks,
    get_team_overview,
    get_team_roster,
    get_team_tracks,
    get_track_player_rankings,
)
from import_json_to_db import backfill_inferred_roles
from models import (
    Division,
    Match,
    MatchPlayer,
    MatchTeam,
    Player,
    PlayerAlias,
    PlayerFriendCode,
    PlayerSeasonEntry,
    Race,
    RacePlayerResult,
    RaceTeamResult,
    Season,
    SourceFile,
    Team,
    TeamLogo,
    TeamSeasonEntry,
    Track,
)
from test_support import PostgreSQLTestDatabase


class DashboardRoleContractTests(unittest.TestCase):
    def setUp(self):
        self.database = PostgreSQLTestDatabase()
        self.session = self.database.SessionLocal()
        self._seed()

    def tearDown(self):
        self.session.close()
        self.database.close()

    def _seed(self):
        seasons = [
            Season(league_code="ctc", season_code="s1", season_number=1, name="Season 1"),
            Season(league_code="ctc", season_code="s2", season_number=2, name="Season 2"),
        ]
        self.session.add_all(seasons)
        self.session.flush()
        divisions = {
            season.season_code: Division(
                season_id=season.season_id,
                division_code="d1",
                division_name="Division 1",
            )
            for season in seasons
        }
        alpha = Team(canonical_name="Alpha", canonical_tag="a")
        beta = Team(canonical_name="Beta", canonical_tag="b")
        gamma = Team(canonical_name="Gamma", canonical_tag="g")
        self.session.add_all([*divisions.values(), alpha, beta, gamma])
        self.session.flush()
        self.alpha_id = alpha.team_id
        self.gamma_id = gamma.team_id

        entries = {}
        for season in seasons:
            for team in (alpha, beta):
                entry = TeamSeasonEntry(
                    team_id=team.team_id,
                    season_id=season.season_id,
                    division_id=divisions[season.season_code].division_id,
                    display_name=team.canonical_name,
                    clan_tag=team.canonical_tag,
                    hex_color="#3366FF" if team is alpha else "#DD3344",
                )
                self.session.add(entry)
                self.session.flush()
                entries[(season.season_code, team.canonical_tag)] = entry

        players = [Player(canonical_lounge_name=f"Player {index}") for index in range(10)]
        players[0].canonical_lounge_name = "Role Switcher"
        players[0].primary_friend_code = "1111-2222-3333"
        self.session.add_all(players)
        self.session.flush()
        self.player_id = players[0].player_id
        self.tied_runner_ids = [players[1].player_id, players[2].player_id]
        self.players = players
        self.session.add_all(
            [
                PlayerFriendCode(player_id=self.player_id, friend_code="1111-2222-3333"),
                PlayerFriendCode(player_id=self.player_id, friend_code="4444-5555-6666"),
                PlayerAlias(
                    player_id=self.player_id, alias_type="mii_name", alias_value="a Switch"
                ),
            ]
        )

        track = Track(canonical_name="Test Track")
        self.session.add(track)
        self.session.flush()
        self.track = track
        # Selected-player rows exercise explicit, inferred, invalid, and unknown cases.
        match_specs = [
            (
                "s1",
                1,
                [15, 12, 10, 8],
                ["runner", "runner", "unknown", "runner"],
                [1, 3, 5, 4],
                40,
                5,
                35,
                30,
            ),
            (
                "s2",
                2,
                [0, 1, 4, 2],
                ["bagger", "bagger", "unknown", "bagger"],
                [10, 9, 9, 10],
                22,
                0,
                22,
                40,
            ),
            (
                "s2",
                3,
                [6, 32, 99, 9],
                ["runner", "runner", "bagger", "unknown"],
                [3, 5, 10, None],
                45,
                2,
                43,
                40,
            ),
        ]
        for spec in match_specs:
            self._add_match(spec, seasons, divisions, entries, players, track)

        self.session.add_all(
            [
                TeamLogo(
                    team_id=alpha.team_id,
                    asset_path="images/team-logos/1/default.webp",
                    alt_text="Alpha logo",
                    priority=1,
                ),
                TeamLogo(
                    team_id=alpha.team_id,
                    season_id=seasons[1].season_id,
                    asset_path="images/team-logos/1/season-2.webp",
                    alt_text="Alpha Season 2 logo",
                    priority=10,
                ),
            ]
        )
        self.session.commit()

    def _add_match(self, spec, seasons, divisions, entries, players, track):
        code, week, scores, roles, positions, raw, penalty, final, opponent = spec
        season = next(item for item in seasons if item.season_code == code)
        source = SourceFile(
            season_id=season.season_id,
            division_id=divisions[code].division_id,
            source_path=f"JSON/ctc/{code}/d1/w{week}.json",
            source_filename=f"w{week}.json",
            file_sha256=f"hash-{code}-{week}",
            json_shape="single",
        )
        self.session.add(source)
        self.session.flush()
        match = Match(
            season_id=season.season_id,
            division_id=divisions[code].division_id,
            source_file_id=source.source_file_id,
            week_number=week,
            match_label=f"Week {week}",
            format="5v5",
            races_played=4,
        )
        self.session.add(match)
        self.session.flush()
        match_teams = []
        for tag, team_score, team_penalty, team_final in (
            ("a", raw, penalty, final),
            ("b", opponent, 0, opponent),
        ):
            match_team = MatchTeam(
                match_id=match.match_id,
                team_season_entry_id=entries[(code, tag)].team_season_entry_id,
                raw_team_key=tag,
                raw_total_score=team_score,
                team_penalty_points=team_penalty,
                final_score=team_final,
            )
            self.session.add(match_team)
            self.session.flush()
            match_teams.append(match_team)

        match_players = []
        for index, player in enumerate(players):
            team_index = 0 if index < 5 else 1
            entry = entries[(code, "a" if team_index == 0 else "b")]
            player_entry = (
                self.session.query(PlayerSeasonEntry)
                .filter_by(
                    player_id=player.player_id,
                    team_season_entry_id=entry.team_season_entry_id,
                )
                .one_or_none()
            )
            if player_entry is None:
                player_entry = PlayerSeasonEntry(
                    player_id=player.player_id,
                    team_season_entry_id=entry.team_season_entry_id,
                    season_id=season.season_id,
                    division_id=divisions[code].division_id,
                    primary_lounge_name=player.canonical_lounge_name,
                    flag="us",
                    first_seen_match_id=match.match_id,
                    last_seen_match_id=match.match_id,
                )
                self.session.add(player_entry)
                self.session.flush()
            else:
                player_entry.last_seen_match_id = match.match_id
            match_player = MatchPlayer(
                match_team_id=match_teams[team_index].match_team_id,
                player_id=player.player_id,
                player_season_entry_id=player_entry.player_season_entry_id,
                friend_code_raw=f"{player.player_id:04d}-0000-0000",
                lounge_name_raw=player.canonical_lounge_name,
            )
            self.session.add(match_player)
            self.session.flush()
            match_players.append(match_player)

        opponent_bagger_scores = [0, 2, 1, 0]
        for race_index in range(4):
            race = Race(
                match_id=match.match_id,
                race_number=race_index + 1,
                track_id=track.track_id,
                track_name_raw=track.canonical_name,
            )
            self.session.add(race)
            self.session.flush()
            selected_role = roles[race_index]
            selected_is_bagger = selected_role == "bagger" or (
                selected_role == "unknown" and positions[race_index] in {9, 10}
            )
            for index, player in enumerate(players):
                team_index = 0 if index < 5 else 1
                role = "runner"
                score = 5
                position = (index % 5) + 1 + team_index * 5
                role_source = "manual"
                if index == 0:
                    role = selected_role
                    score = scores[race_index]
                    position = positions[race_index]
                    role_source = "unknown" if role == "unknown" else "manual"
                elif index == 4 and not selected_is_bagger:
                    role, score, position = "bagger", 1, 9
                elif index == 9:
                    role = "bagger"
                    score = opponent_bagger_scores[race_index]
                    position = 10
                self.session.add(
                    RacePlayerResult(
                        race_id=race.race_id,
                        match_player_id=match_players[index].match_player_id,
                        player_id=player.player_id,
                        match_team_id=match_teams[team_index].match_team_id,
                        team_season_entry_id=entries[
                            (code, "a" if team_index == 0 else "b")
                        ].team_season_entry_id,
                        score=score,
                        position=position,
                        role=role,
                        role_source=role_source,
                    )
                )
            if code == "s1" and race_index == 0:
                self.session.add(
                    RaceTeamResult(
                        race_id=race.race_id,
                        match_team_id=match_teams[0].match_team_id,
                        score=3,
                        result_type="missing_player",
                        reason="short_roster",
                    )
                )

    def test_reviewed_legacy_block_is_excluded_from_analytics_but_kept_in_raw_detail(self):
        match = self.session.query(Match).filter_by(week_number=3).one()
        exclusion = (
            {
                "source_path": "JSON/ctc/s2/d1/w3.json",
                "match_index": 0,
                "blocks": frozenset({1}),
                "reason": "Test collapsed aggregate block.",
            },
        )

        with patch("analytics_eligibility._load_default_exclusions", return_value=exclusion):
            excluded_ids = analytics_excluded_race_ids(self.session)
            overview = get_player_overview(
                self.player_id,
                season="s2",
                division="d1",
                role="runner",
                session=self.session,
            )
            team_tracks = get_team_tracks(
                self.alpha_id,
                season="s2",
                division="d1",
                min_races=1,
                session=self.session,
            )
            with patch.object(stats_db, "SessionLocal", return_value=nullcontext(self.session)):
                _average, _team, _track, legacy_race_count = stats_db.findteamavg(
                    "a",
                    "Test Track",
                    season="s2",
                    division="d1",
                )

        raw_detail = stats_db.get_match_detail(match.match_id, session=self.session)
        match_race_ids = {
            race_id
            for (race_id,) in self.session.query(Race.race_id).filter_by(match_id=match.match_id)
        }

        self.assertEqual(excluded_ids, match_race_ids)
        self.assertEqual(overview["metrics"]["races"], 0)
        self.assertEqual(team_tracks["tracks"][0]["races"], 4)
        self.assertEqual(legacy_race_count, 4)
        self.assertTrue(
            any(
                32 in player["scores"] for team in raw_detail["teams"] for player in team["players"]
            )
        )

    def test_match_history_orders_winner_first_in_summary_detail_and_differential(self):
        match = (
            self.session.query(Match)
            .join(Season, Season.season_id == Match.season_id)
            .filter(Season.season_code == "s2", Match.week_number == 2)
            .one()
        )

        detail = stats_queries.get_match_detail(match.match_id, session=self.session)
        self.assertEqual([team["tag"] for team in detail["teams"]], ["b", "a"])
        self.assertEqual([team["final_score"] for team in detail["teams"]], [40, 22])

        with patch.object(stats_queries, "SessionLocal", return_value=nullcontext(self.session)):
            summaries = stats_queries.list_matches(season="s2", division="d1")
        summary = next(row for row in summaries if row["match_id"] == match.match_id)
        self.assertEqual(summary["teams"], "b vs a")
        self.assertEqual(summary["scores"], "40 - 22")

        # Differential values use the same winner-first orientation as both tables.
        first_race_totals = [
            sum((player["scores"][0] or 0) for player in team["players"])
            + (team["missing_player"]["scores"][0] or 0)
            for team in detail["teams"]
        ]
        self.assertEqual(detail["differential"][0], first_race_totals[0] - first_race_totals[1])

    def _selected_result(self, week, race_number):
        return (
            self.session.query(RacePlayerResult)
            .join(Race, Race.race_id == RacePlayerResult.race_id)
            .join(Match, Match.match_id == Race.match_id)
            .filter(
                RacePlayerResult.player_id == self.player_id,
                Match.week_number == week,
                Race.race_number == race_number,
            )
            .one()
        )

    def _add_close_ranking_scope(self):
        season = Season(
            league_code="ctc",
            season_code="s3",
            season_number=3,
            name="Season 3",
        )
        self.session.add(season)
        self.session.flush()
        division = Division(
            season_id=season.season_id,
            division_code="d1",
            division_name="Division 1",
        )
        self.session.add(division)
        self.session.flush()
        alpha_entry = TeamSeasonEntry(
            team_id=self.alpha_id,
            season_id=season.season_id,
            division_id=division.division_id,
            display_name="Alpha",
            clan_tag="a",
        )
        self.session.add(alpha_entry)
        self.session.flush()
        source = SourceFile(
            season_id=season.season_id,
            division_id=division.division_id,
            source_path="JSON/ctc/s3/d1/w1.json",
            source_filename="w1.json",
            file_sha256="hash-s3-close-ranking",
            json_shape="single",
        )
        self.session.add(source)
        self.session.flush()
        match = Match(
            season_id=season.season_id,
            division_id=division.division_id,
            source_file_id=source.source_file_id,
            week_number=1,
            match_label="Close ranking",
            format="other",
            races_played=202,
        )
        self.session.add(match)
        self.session.flush()
        match_team = MatchTeam(
            match_id=match.match_id,
            team_season_entry_id=alpha_entry.team_season_entry_id,
            raw_team_key="a",
        )
        self.session.add(match_team)
        self.session.flush()

        match_players = []
        for player in self.players[1:3]:
            player_entry = PlayerSeasonEntry(
                player_id=player.player_id,
                team_season_entry_id=alpha_entry.team_season_entry_id,
                season_id=season.season_id,
                division_id=division.division_id,
                primary_lounge_name=player.canonical_lounge_name,
                first_seen_match_id=match.match_id,
                last_seen_match_id=match.match_id,
            )
            self.session.add(player_entry)
            self.session.flush()
            match_player = MatchPlayer(
                match_team_id=match_team.match_team_id,
                player_id=player.player_id,
                player_season_entry_id=player_entry.player_season_entry_id,
                friend_code_raw=f"close-{player.player_id}",
            )
            self.session.add(match_player)
            self.session.flush()
            match_players.append(match_player)

        for race_number in range(1, 203):
            race = Race(
                match_id=match.match_id,
                race_number=race_number,
                track_id=self.track.track_id,
                track_name_raw=self.track.canonical_name,
            )
            self.session.add(race)
            self.session.flush()
            for index, player in enumerate(self.players[1:3]):
                if index == 0 and race_number == 202:
                    continue
                self.session.add(
                    RacePlayerResult(
                        race_id=race.race_id,
                        match_player_id=match_players[index].match_player_id,
                        player_id=player.player_id,
                        match_team_id=match_team.match_team_id,
                        team_season_entry_id=alpha_entry.team_season_entry_id,
                        score=1 if race_number == 1 else 0,
                        position=10,
                        role="bagger",
                        role_source="manual",
                    )
                )
        self.session.flush()

    def test_overview_strictly_separates_roles_and_keeps_match_context(self):
        runner = get_player_overview(self.player_id, role="runner", session=self.session)
        bagger = get_player_overview(self.player_id, role="bagger", session=self.session)

        self.assertEqual(runner["role"], "runner")
        self.assertEqual(runner["metrics"]["total_points"], 51)
        self.assertEqual(runner["metrics"]["races"], 6)
        self.assertEqual(runner["metrics"]["excluded_score_rows"], 1)
        self.assertEqual(runner["metrics"]["best_match_score"], 45)
        self.assertEqual(runner["metrics"]["best_gp_score"], 45)
        self.assertIn("twelve_race_pace", runner["metrics"])
        self.assertNotIn("bag_points", runner["metrics"])

        self.assertEqual(bagger["metrics"]["total_points"], 7)
        self.assertEqual(bagger["metrics"]["bag_points"], 3)
        self.assertEqual(bagger["metrics"]["excluded_score_rows"], 1)
        self.assertIn("opponent_point_differential", bagger["metrics"])
        self.assertNotIn("twelve_race_pace", bagger["metrics"])
        self.assertEqual(
            [row["match_id"] for row in runner["recent_matches"]],
            [row["match_id"] for row in bagger["recent_matches"]],
        )
        self.assertEqual(
            [row["player_score"] for row in runner["recent_matches"]],
            [6, None, 45],
        )
        self.assertEqual([row["role_races"] for row in runner["recent_matches"]], [2, 0, 4])
        self.assertEqual(
            [row["player_score"] for row in bagger["recent_matches"]],
            [None, 7, None],
        )

    def test_role_backfill_repairs_analytics_and_is_idempotent(self):
        target = self._selected_result(2, 1)
        target.role = "runner"
        target.role_source = "inferred"

        wrong_bagger = (
            self.session.query(RacePlayerResult)
            .filter(
                RacePlayerResult.race_id == target.race_id,
                RacePlayerResult.player_id != self.player_id,
                RacePlayerResult.role == "runner",
                RacePlayerResult.position <= 8,
            )
            .first()
        )
        wrong_bagger.role = "bagger"
        wrong_bagger.role_source = "inferred"

        nonmatching_runner = self._selected_result(1, 1)
        nonmatching_runner.role_source = "inferred"

        unknown_runner = self._selected_result(1, 3)
        unknown_bagger = self._selected_result(2, 3)

        manual_zero = (
            self.session.query(RacePlayerResult)
            .filter(
                RacePlayerResult.race_id == target.race_id,
                RacePlayerResult.player_id != self.player_id,
                RacePlayerResult.score == 0,
                RacePlayerResult.position == 10,
            )
            .one()
        )
        manual_zero.role = "runner"
        manual_zero.role_source = "manual"
        self.session.flush()

        before_runner = get_player_overview(self.player_id, role="runner", session=self.session)
        before_bagger = get_player_overview(self.player_id, role="bagger", session=self.session)
        self.assertEqual(before_runner["metrics"]["races"], 7)
        self.assertEqual(before_bagger["metrics"]["races"], 4)

        self.assertEqual(backfill_inferred_roles(self.session), 4)
        self.assertEqual(backfill_inferred_roles(self.session), 0)
        self.session.refresh(target)
        self.session.refresh(wrong_bagger)
        self.session.refresh(nonmatching_runner)
        self.session.refresh(unknown_runner)
        self.session.refresh(unknown_bagger)
        self.session.refresh(manual_zero)

        self.assertEqual((target.role, target.role_source), ("bagger", "inferred"))
        self.assertEqual(
            (wrong_bagger.role, wrong_bagger.role_source),
            ("runner", "inferred"),
        )
        self.assertEqual(
            (nonmatching_runner.role, nonmatching_runner.role_source),
            ("runner", "inferred"),
        )
        self.assertEqual(
            (unknown_runner.role, unknown_runner.role_source),
            ("runner", "inferred"),
        )
        self.assertEqual(
            (unknown_bagger.role, unknown_bagger.role_source),
            ("bagger", "inferred"),
        )
        self.assertEqual((manual_zero.role, manual_zero.role_source), ("runner", "manual"))

        after_runner = get_player_overview(self.player_id, role="runner", session=self.session)
        after_bagger = get_player_overview(self.player_id, role="bagger", session=self.session)
        self.assertEqual(after_runner["metrics"]["races"], 6)
        self.assertEqual(after_bagger["metrics"]["races"], 5)
        self.assertEqual(after_bagger["metrics"]["zero_points"], 1)

    def test_performance_contract_distributions_and_coverage_are_role_specific(self):
        runner = get_player_performance(self.player_id, role=" RUNNER ", session=self.session)
        bagger = get_player_performance(self.player_id, role="bagger", session=self.session)

        self.assertEqual(
            set(runner),
            {
                "player_id",
                "role",
                "scope",
                "metrics",
                "role_coverage",
                "score_distribution",
                "placement_distribution",
                "by_race_number",
                "by_gp_number",
            },
        )
        self.assertEqual(runner["metrics"]["total_points"], 51)
        self.assertEqual(bagger["metrics"]["total_points"], 7)
        self.assertEqual(bagger["metrics"]["bag_points"], 3)
        self.assertIn({"score": 4, "races": 1}, bagger["score_distribution"])
        self.assertNotIn({"score": 15, "races": 1}, bagger["score_distribution"])
        self.assertEqual(runner["role_coverage"], bagger["role_coverage"])
        self.assertEqual(runner["role_coverage"]["inferred_runner"], 1)
        self.assertEqual(runner["role_coverage"]["inferred_bagger"], 1)
        self.assertEqual(runner["role_coverage"]["unknown"], 1)
        self.assertEqual(runner["metrics"]["excluded_score_rows"], 1)
        self.assertEqual(bagger["metrics"]["excluded_score_rows"], 1)

    def test_tracks_filter_and_threshold_use_only_selected_role(self):
        runner = get_player_tracks(self.player_id, role="runner", min_races=5, session=self.session)
        bagger = get_player_tracks(self.player_id, role="bagger", min_races=4, session=self.session)
        self.assertEqual(runner["tracks"][0]["total_points"], 51)
        self.assertEqual(runner["tracks"][0]["races"], 6)
        self.assertEqual(runner["tracks"][0]["scored_races"], 5)
        self.assertIn("podium_rate", runner["tracks"][0])
        self.assertNotIn("bag_point_rate", runner["tracks"][0])
        self.assertEqual(bagger["tracks"][0]["total_points"], 7)
        self.assertEqual(bagger["tracks"][0]["bag_points"], 3)
        self.assertEqual(
            get_player_tracks(self.player_id, role="bagger", min_races=5, session=self.session)[
                "tracks"
            ],
            [],
        )

    def test_track_player_rankings_keep_roles_separate_and_preserve_bagger_points(self):
        runner = get_track_player_rankings(
            self.track.track_id,
            season="s2",
            division="d1",
            role="runner",
            min_races=1,
            session=self.session,
        )
        bagger = get_track_player_rankings(
            self.track.track_id,
            season="s2",
            division="d1",
            role="bagger",
            min_races=4,
            session=self.session,
        )

        runner_player = next(row for row in runner["players"] if row["player_id"] == self.player_id)
        bagger_player = next(row for row in bagger["players"] if row["player_id"] == self.player_id)
        self.assertEqual(runner_player["metrics"]["total_points"], 6)
        self.assertEqual(runner_player["metrics"]["scored_races"], 1)
        self.assertNotIn("bag_points", runner_player["metrics"])
        self.assertEqual(bagger_player["metrics"]["total_points"], 7)
        self.assertEqual(bagger_player["metrics"]["bag_points"], 3)
        self.assertNotIn("twelve_race_pace", bagger_player["metrics"])
        self.assertEqual(bagger["scope"], {"season": "s2", "division": "d1"})
        self.assertEqual(bagger_player["role_coverage"]["total"], 8)

        thresholded = get_track_player_rankings(
            self.track.track_id,
            season="s2",
            division="d1",
            role="bagger",
            min_races=5,
            session=self.session,
        )
        self.assertNotIn(self.player_id, [row["player_id"] for row in thresholded["players"]])

    def test_track_rankings_and_roster_use_bulk_display_name_fallbacks(self):
        self.session.add_all(
            [
                PlayerAlias(
                    player_id=self.player_id,
                    alias_type="lounge_name",
                    alias_value="Older Lounge",
                    last_seen_match_id=1,
                ),
                PlayerAlias(
                    player_id=self.player_id,
                    alias_type="lounge_name",
                    alias_value="Recent Lounge",
                    last_seen_match_id=3,
                ),
                PlayerAlias(
                    player_id=self.players[1].player_id,
                    alias_type="table_name",
                    alias_value="Ignored Table",
                ),
                PlayerAlias(
                    player_id=self.players[2].player_id,
                    alias_type="table_name",
                    alias_value="Table Fallback",
                ),
                PlayerAlias(
                    player_id=self.players[3].player_id,
                    alias_type="mii_name",
                    alias_value="Mii Fallback",
                ),
            ]
        )
        self.players[2].canonical_lounge_name = None
        self.players[3].canonical_lounge_name = None
        self.session.flush()

        rankings = get_track_player_rankings(
            self.track.track_id,
            season="s2",
            division="d1",
            role="runner",
            min_races=1,
            session=self.session,
        )
        roster = get_team_roster(
            self.alpha_id,
            season="s2",
            division="d1",
            role="runner",
            min_races=1,
            session=self.session,
        )
        ranking_names = {row["player_id"]: row["name"] for row in rankings["players"]}
        roster_names = {row["player_id"]: row["name"] for row in roster["players"]}
        expected = {
            self.player_id: "Recent Lounge",
            self.players[1].player_id: "Player 1",
            self.players[2].player_id: "Table Fallback",
            self.players[3].player_id: "Mii Fallback",
        }
        for player_id, name in expected.items():
            self.assertEqual(ranking_names[player_id], name)
            self.assertEqual(roster_names[player_id], name)

    def test_top_tracks_route_integrates_flat_schema_aliases_and_role_math(self):
        self.session.add(
            PlayerAlias(
                player_id=self.player_id,
                alias_type="lounge_name",
                alias_value="Route Alias",
                last_seen_match_id=3,
            )
        )
        self.session.flush()
        app_module.app.config.update(TESTING=True)
        app_module.cache.clear()
        client = app_module.app.test_client()
        required_keys = {
            "player_id",
            "name",
            "role",
            "races",
            "scored_races",
            "points_per_race",
            "twelve_race_pace",
            "bag_point_rate",
            "zero_point_rate",
            "average_placement",
            "total_points",
            "excluded_score_rows",
        }

        with patch.object(stats_db, "SessionLocal", return_value=nullcontext(self.session)):
            runner_response = client.get(
                "/api/top-tracks?track=Test+Track&season=s2&division=d1&role=runner&min_races=1"
            )
            bagger_response = client.get(
                "/api/top-tracks?track=Test+Track&season=s2&division=d1&role=bagger&min_races=4"
            )

        self.assertEqual(runner_response.status_code, 200)
        self.assertEqual(bagger_response.status_code, 200)
        runner = next(
            row for row in runner_response.get_json() if row["player_id"] == self.player_id
        )
        bagger = next(
            row for row in bagger_response.get_json() if row["player_id"] == self.player_id
        )
        self.assertEqual(set(runner), required_keys | {"role_coverage"})
        self.assertEqual(set(bagger), required_keys | {"role_coverage"})
        self.assertEqual(runner["name"], "Route Alias")
        self.assertEqual(runner["total_points"], 6)
        self.assertEqual(runner["twelve_race_pace"], 72.0)
        self.assertIsNone(runner["bag_point_rate"])
        self.assertIsNone(runner["zero_point_rate"])
        self.assertEqual(bagger["name"], "Route Alias")
        self.assertEqual(bagger["total_points"], 7)
        self.assertIsNone(bagger["twelve_race_pace"])
        self.assertEqual(bagger["bag_point_rate"], 75.0)
        self.assertEqual(bagger["zero_point_rate"], 25.0)

    def test_track_player_average_preserves_invalid_only_role_metrics(self):
        self._selected_result(3, 1).score = 99
        self.session.flush()
        with patch.object(stats_db, "SessionLocal", return_value=nullcontext(self.session)):
            result = stats_db.findplayeravg(
                "Role Switcher",
                track="Test Track",
                season="s2",
                division="d1",
                role="runner",
            )

        metrics = result["metrics"]
        self.assertEqual(metrics["races"], 2)
        self.assertEqual(metrics["scored_races"], 0)
        self.assertEqual(metrics["total_points"], 0)
        self.assertIsNone(metrics["points_per_race"])
        self.assertEqual(metrics["average_placement"], 4.0)
        self.assertEqual(metrics["excluded_score_rows"], 2)
        self.assertEqual(metrics["wins"], 0)
        self.assertEqual(metrics["podiums"], 1)

    def test_rankings_classify_each_player_and_use_selected_role_eligibility(self):
        runner = get_player_overview(
            self.player_id,
            season="s2",
            division="d1",
            role="runner",
            min_races=2,
            session=self.session,
        )
        bagger = get_player_overview(
            self.player_id,
            season="s2",
            division="d1",
            role="bagger",
            min_races=4,
            session=self.session,
        )
        self.assertFalse(runner["ranking"]["eligible"])
        self.assertTrue(bagger["ranking"]["eligible"])
        self.assertEqual(bagger["ranking"]["metric"], "bagger_points_per_race")
        self.assertEqual(bagger["ranking"]["value"], 1.75)

        tied = [
            get_player_overview(
                player_id,
                season="s2",
                division="d1",
                role="runner",
                min_races=8,
                session=self.session,
            )["ranking"]
            for player_id in self.tied_runner_ids
        ]
        self.assertTrue(all(item["eligible"] for item in tied))
        self.assertEqual(tied[0]["value"], tied[1]["value"])
        self.assertEqual(tied[0]["rank"], tied[1]["rank"])

    def test_team_roster_uses_selected_role_for_metrics_threshold_and_sorting(self):
        runner = get_team_roster(
            self.alpha_id,
            season="s2",
            division="d1",
            role="runner",
            min_races=1,
            session=self.session,
        )
        bagger = get_team_roster(
            self.alpha_id,
            season="s2",
            division="d1",
            role="bagger",
            min_races=4,
            session=self.session,
        )
        selected_runner = next(
            row for row in runner["players"] if row["player_id"] == self.player_id
        )
        self.assertEqual(selected_runner["metrics"]["total_points"], 6)
        self.assertEqual(selected_runner["metrics"]["scored_races"], 1)
        thresholded_runner = get_team_roster(
            self.alpha_id,
            season="s2",
            division="d1",
            role="runner",
            min_races=2,
            session=self.session,
        )
        self.assertNotIn(
            self.player_id,
            [row["player_id"] for row in thresholded_runner["players"]],
        )
        selected = next(row for row in bagger["players"] if row["player_id"] == self.player_id)
        self.assertEqual(selected["matches"], 2)
        self.assertEqual(selected["metrics"]["total_points"], 7)
        self.assertEqual(selected["metrics"]["counterpart_races"], 4)
        self.assertEqual(selected["first_appearance"]["week"], 2)
        self.assertEqual(selected["last_appearance"]["week"], 3)
        self.assertEqual(bagger["role"], "bagger")

    def test_team_result_contracts_remain_role_independent(self):
        career = get_team_overview(self.alpha_id, session=self.session)
        self.assertEqual(career["record"], {"wins": 2, "losses": 1, "ties": 0, "unknown": 0})
        self.assertEqual(career["metrics"]["total_penalties"], 7)
        self.assertEqual(career["identity"]["logo_url"], "/images/team-logos/1/default.webp")
        season = get_team_overview(self.alpha_id, season="s2", division="d1", session=self.session)
        self.assertEqual(season["record"], {"wins": 1, "losses": 1, "ties": 0, "unknown": 0})
        self.assertEqual(season["metrics"]["average_differential"], -7.5)
        self.assertEqual(season["identity"]["logo_url"], "/images/team-logos/1/season-2.webp")

        tracks = get_team_tracks(self.alpha_id, min_races=1, session=self.session)
        self.assertEqual(tracks["tracks"][0]["races"], 12)
        self.assertEqual(tracks["tracks"][0]["average_score"], 23.5)

    def test_invalid_role_is_rejected(self):
        for function, args in (
            (get_player_overview, (self.player_id,)),
            (get_player_performance, (self.player_id,)),
            (get_player_tracks, (self.player_id,)),
            (get_team_roster, (self.alpha_id,)),
        ):
            with self.subTest(function=function.__name__):
                with self.assertRaisesRegex(ValueError, "role must be runner or bagger"):
                    function(*args, role="all", session=self.session)

    def test_empty_explicit_and_unknown_rows_remain_in_role_inputs(self):
        empty = self._selected_result(3, 4)
        empty.score = None
        empty.position = None
        empty.role = "runner"
        empty.role_source = "manual"
        self.session.flush()

        performance = get_player_performance(self.player_id, role="runner", session=self.session)
        self.assertEqual(performance["metrics"]["races"], 7)
        self.assertEqual(performance["metrics"]["scored_races"], 5)
        self.assertEqual(performance["role_coverage"]["explicit_runner"], 6)
        overview = get_player_overview(self.player_id, role="runner", session=self.session)
        self.assertEqual(overview["recent_matches"][0]["role_races"], 3)
        tracks = get_player_tracks(self.player_id, role="runner", min_races=5, session=self.session)
        self.assertEqual(tracks["tracks"][0]["races"], 7)
        self.assertEqual(tracks["tracks"][0]["scored_races"], 5)
        roster = get_team_roster(self.alpha_id, role="runner", min_races=1, session=self.session)
        selected = next(row for row in roster["players"] if row["player_id"] == self.player_id)
        self.assertEqual(selected["metrics"]["races"], 7)
        self.assertEqual(selected["last_appearance"]["week"], 3)

        empty.role = "unknown"
        empty.role_source = "unknown"
        self.session.flush()
        unknown = get_player_performance(self.player_id, role="runner", session=self.session)[
            "role_coverage"
        ]
        self.assertEqual(unknown["unknown"], 1)
        self.assertEqual(unknown["total"], 12)

    def test_invalid_only_recent_score_is_none_and_not_a_best_match(self):
        valid = self._selected_result(3, 1)
        valid.score = 99
        self.session.flush()

        overview = get_player_overview(self.player_id, role="runner", session=self.session)
        recent = overview["recent_matches"][0]
        self.assertIsNone(recent["player_score"])
        self.assertEqual(recent["role_races"], 2)
        self.assertEqual(recent["scored_role_races"], 0)
        self.assertEqual(recent["excluded_score_rows"], 2)
        self.assertEqual(overview["metrics"]["best_match_score"], 45)
        self.assertIsNone(overview["score_trend"][-1]["score"])

    def test_player_ranking_respects_team_filter_for_entire_population(self):
        unfiltered = get_player_overview(
            self.tied_runner_ids[0],
            season="s2",
            division="d1",
            role="runner",
            min_races=8,
            session=self.session,
        )["ranking"]
        filtered = get_player_overview(
            self.tied_runner_ids[0],
            season="s2",
            division="d1",
            team_id=self.alpha_id,
            role="runner",
            min_races=8,
            session=self.session,
        )["ranking"]
        self.assertEqual(unfiltered["population"], 7)
        self.assertEqual(filtered["population"], 3)
        self.assertTrue(filtered["eligible"])

    def test_roster_rejects_self_opponent_but_allows_empty_existing_opponent(self):
        with self.assertRaisesRegex(DashboardError, "A team cannot be its own opponent filter"):
            get_team_roster(
                self.alpha_id,
                opponent_team_id=self.alpha_id,
                session=self.session,
            )

        empty = get_team_roster(
            self.alpha_id,
            opponent_team_id=self.gamma_id,
            session=self.session,
        )
        self.assertEqual(empty["players"], [])
        self.assertEqual(empty["role_coverage"]["total"], 0)

    def test_roster_reports_aggregate_coverage_and_bulk_counterparts(self):
        with (
            patch(
                "dashboard_stats.bagger_counterpart_summary",
                side_effect=AssertionError("roster must aggregate counterparts in bulk"),
            ),
            patch(
                "team_dashboard_stats._bulk_bagger_counterpart_summaries",
                wraps=dashboard_module._bulk_bagger_counterpart_summaries,
            ) as bulk_counterparts,
        ):
            roster = get_team_roster(
                self.alpha_id,
                season="s2",
                division="d1",
                role="bagger",
                min_races=1,
                session=self.session,
            )
        bulk_counterparts.assert_called_once()
        self.assertEqual(roster["role_coverage"]["total"], 40)
        self.assertEqual(roster["role_coverage"]["inferred_bagger"], 1)
        self.assertEqual(roster["role_coverage"]["unknown"], 1)
        selected = next(row for row in roster["players"] if row["player_id"] == self.player_id)
        self.assertEqual(selected["metrics"]["counterpart_races"], 4)
        self.assertEqual(selected["metrics"]["opponent_points_for"], 7)
        self.assertEqual(selected["metrics"]["opponent_points_against"], 3)
        self.assertEqual(selected["metrics"]["opponent_point_differential"], 4)
        self.assertEqual(selected["role_coverage"]["total"], 8)

    def test_close_raw_ranking_averages_do_not_become_false_ties(self):
        self._add_close_ranking_scope()
        rankings = [
            get_player_overview(
                player_id,
                season="s3",
                division="d1",
                role="bagger",
                min_races=200,
                session=self.session,
            )["ranking"]
            for player_id in self.tied_runner_ids
        ]
        self.assertEqual(rankings[0]["value"], rankings[1]["value"])
        self.assertEqual(rankings[0]["rank"], 1)
        self.assertEqual(rankings[1]["rank"], 2)

    def test_track_rankings_use_exact_metric_then_races_name_and_id(self):
        self._add_close_ranking_scope()
        rankings = get_track_player_rankings(
            self.track.track_id,
            season="s3",
            division="d1",
            role="bagger",
            min_races=200,
            session=self.session,
        )
        self.assertEqual(
            [row["player_id"] for row in rankings["players"]],
            self.tied_runner_ids,
        )

        s3_results = (
            self.session.query(RacePlayerResult)
            .join(Race, Race.race_id == RacePlayerResult.race_id)
            .join(Match, Match.match_id == Race.match_id)
            .join(Season, Season.season_id == Match.season_id)
            .filter(Season.season_code == "s3")
        )
        for result in s3_results.all():
            result.score = 0
        self.session.flush()
        rankings = get_track_player_rankings(
            self.track.track_id,
            season="s3",
            division="d1",
            role="bagger",
            min_races=200,
            session=self.session,
        )
        self.assertEqual(
            [row["player_id"] for row in rankings["players"]],
            list(reversed(self.tied_runner_ids)),
        )

        extra = (
            s3_results.filter(RacePlayerResult.player_id == self.tied_runner_ids[1])
            .order_by(RacePlayerResult.race_player_result_id.desc())
            .first()
        )
        self.session.delete(extra)
        self.players[1].canonical_lounge_name = "Zulu Tie"
        self.players[2].canonical_lounge_name = "Alpha Tie"
        self.session.flush()
        rankings = get_track_player_rankings(
            self.track.track_id,
            season="s3",
            division="d1",
            role="bagger",
            min_races=200,
            session=self.session,
        )
        self.assertEqual(
            [row["player_id"] for row in rankings["players"]],
            list(reversed(self.tied_runner_ids)),
        )

        self.players[1].canonical_lounge_name = "Same Tie"
        self.players[2].canonical_lounge_name = "Same Tie"
        self.session.flush()
        rankings = get_track_player_rankings(
            self.track.track_id,
            season="s3",
            division="d1",
            role="bagger",
            min_races=200,
            session=self.session,
        )
        self.assertEqual(
            [row["player_id"] for row in rankings["players"]],
            self.tied_runner_ids,
        )


if __name__ == "__main__":
    unittest.main()

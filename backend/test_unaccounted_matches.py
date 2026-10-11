"""Aggregate entry through the same import, correction, analytics, and review interfaces."""

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_support import PostgreSQLTestDatabase, configure_test_environment

configure_test_environment()

import app as app_module  # noqa: E402
from archive_storage import LocalArchiveStorage  # noqa: E402
from database_health import _match_and_result_issues  # noqa: E402
from import_json_to_db import import_preview_match  # noqa: E402
from match_management import (  # noqa: E402
    delete_match_from_database,
    match_inventory,
    replace_match,
)
from match_upload import validate_committable_match  # noqa: E402
from models import (  # noqa: E402
    Match,
    MatchPlayer,
    MatchTeam,
    Race,
    RacePlayerResult,
    ReviewSubmission,
    Track,
    UnaccountedMatch,
    UnaccountedPlayerScore,
    UnaccountedTeamAward,
)
from player_dashboard_stats import (  # noqa: E402
    get_player_overview,
    get_player_performance,
    get_player_tracks,
)
from review_queue import create_submission  # noqa: E402
from sqlalchemy import func, select  # noqa: E402
from standings_service import get_division_standings  # noqa: E402
from stats_queries import get_match_detail  # noqa: E402
from team_dashboard_stats import get_team_overview, get_team_roster  # noqa: E402


def aggregate_document(mode="gp", number=1):
    periods = [1, 2, 3] if mode == "gp" else [0]
    count = 4 if mode == "gp" else 12
    teams = {}
    for index, tag in enumerate(("A", "B")):
        points = 10 if index == 0 else 8
        fc = f"1111-2222-333{index}"
        teams[tag] = {
            "table_tag_str": f"{tag} #4F8CFF",
            "hex_color": "#4F8CFF",
            "penalties": 0,
            "total_score": points * 12,
            "players": {
                fc: {
                    "lounge_name": f"Player {tag}",
                    "total_score": points * 12,
                    "aggregate_scores": [
                        {
                            "gp_number": gp,
                            "role": "runner",
                            "points": points * count,
                            "races": count,
                            "disconnection_points": 2,
                        }
                        for gp in periods
                    ],
                }
            },
        }
    return {
        "league": "ctc",
        "season": "s99",
        "division": "d1",
        "match_number": number,
        "format": "5v5",
        "races_played": 12,
        "tracks": [],
        "teams": teams,
        "score_source": "unaccounted",
        "entry_mode": mode,
        "result_type": "played",
    }


class AggregateValidationTests(unittest.TestCase):
    def test_modes_and_inclusive_disconnect_points(self):
        for mode in ("gp", "totals"):
            validate_committable_match(aggregate_document(mode))

    def test_invalid_documents_are_rejected(self):
        changes = {
            "track": lambda d: d.update(tracks=["Invented"]),
            "mixed mode": lambda d: d.update(entry_mode="totals"),
            "invalid source": lambda d: d.update(score_source="other"),
            "accounted aggregate": lambda d: d.update(score_source="accounted"),
            "special result": lambda d: d.update(result_type="free_win"),
            "missing metadata": lambda d: d.pop("match_number"),
            "fractional races": lambda d: d.update(races_played=12.5),
            "nonfinite points": lambda d: d["teams"]["A"]["players"]["1111-2222-3330"][
                "aggregate_scores"
            ][0].update(points=float("nan")),
            "excess participation": lambda d: d["teams"]["A"]["players"]["1111-2222-3330"][
                "aggregate_scores"
            ][0].update(races=5),
            "double role": lambda d: d["teams"]["A"]["players"]["1111-2222-3330"][
                "aggregate_scores"
            ].append(
                copy.deepcopy(d["teams"]["A"]["players"]["1111-2222-3330"]["aggregate_scores"][0])
            ),
            "fake positions": lambda d: d["teams"]["A"]["players"]["1111-2222-3330"].update(
                race_positions=[1] * 12
            ),
            "wrong total": lambda d: d["teams"]["A"].update(total_score=500),
            "negative penalty": lambda d: d["teams"]["A"].update(penalties=-10),
            "excess DC": lambda d: d["teams"]["A"]["players"]["1111-2222-3330"]["aggregate_scores"][
                0
            ].update(disconnection_points=100),
        }
        for label, change in changes.items():
            with self.subTest(label=label):
                document = aggregate_document()
                change(document)
                with self.assertRaises(ValueError):
                    validate_committable_match(document)


class AggregateWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.database = PostgreSQLTestDatabase()
        self.SessionLocal = self.database.SessionLocal
        self.addCleanup(self.database.close)

    def import_document(self, document):
        with self.SessionLocal.begin() as session:
            match = import_preview_match(session, document)
            session.flush()
            return match.match_id

    def player_id(self, session):
        return session.scalar(
            select(MatchPlayer.player_id)
            .where(MatchPlayer.friend_code_raw == "1111-2222-3330")
            .limit(1)
        )

    def test_gp_and_totals_preserve_scores_without_race_facts(self):
        for mode in ("gp", "totals"):
            self.import_document(aggregate_document(mode, 1 if mode == "gp" else 2))
        with self.SessionLocal() as session:
            for model in (Race, RacePlayerResult, Track):
                self.assertEqual(session.scalar(select(func.count()).select_from(model)), 0)
            player = self.player_id(session)
            params = {"league": "ctc", "season": "s99", "division": "d1", "session": session}
            excluded = get_player_overview(player, **params)
            included = get_player_overview(player, include_unaccounted=True, **params)
            self.assertEqual(excluded["metrics"]["total_points"], 0)
            self.assertEqual(included["metrics"]["total_points"], 240)
            self.assertEqual(included["metrics"]["scored_races"], 24)
            self.assertEqual(included["metrics"]["best_gp_score"], 40)
            self.assertEqual(included["metrics"]["matches"], 2)
            self.assertEqual(included["record"]["wins"], 2)
            self.assertTrue(included["ranking"]["eligible"])
            self.assertTrue(
                all("Unaccounted" in row["label"] for row in included["recent_matches"])
            )
            performance = get_player_performance(player, include_unaccounted=True, **params)
            self.assertEqual(performance["by_race_number"], [])
            self.assertEqual(performance["score_distribution"], [])
            self.assertEqual(performance["placement_distribution"], [])
            self.assertEqual(
                performance["by_gp_number"],
                [{"gp_number": gp, "average": 10.0, "races": 4} for gp in (1, 2, 3)],
            )
            self.assertEqual(get_player_tracks(player, **params)["tracks"], [])
            team = session.scalar(select(MatchTeam.team_season_entry_id).limit(1))
            from models import TeamSeasonEntry

            team_id = session.get(TeamSeasonEntry, team).team_id
            self.assertEqual(get_team_overview(team_id, **params)["metrics"]["matches"], 0)
            self.assertEqual(
                get_team_overview(team_id, include_unaccounted=True, **params)["metrics"][
                    "matches"
                ],
                2,
            )
            roster = get_team_roster(team_id, include_unaccounted=True, **params)
            self.assertEqual(roster["players"][0]["metrics"]["total_points"], 240)
            self.assertEqual(
                roster["players"][0]["first_appearance"]["score_source"], "unaccounted"
            )
            self.assertEqual(roster["players"][0]["last_appearance"]["score_source"], "unaccounted")
            standings = get_division_standings(session, league="ctc", season="s99", division="d1")
            self.assertEqual(standings["standings"][0]["played"], 2)
            self.assertEqual(standings["standings"][0]["points_for"], 240)
            self.assertEqual(standings["leaderboard"][0]["runner_points"], 240)
            self.assertEqual(standings["leaderboard"][0]["unaccounted_matches"], 2)

    def test_awards_penalties_roles_and_detail(self):
        document = aggregate_document()
        player = document["teams"]["A"]["players"]["1111-2222-3330"]
        player["aggregate_scores"][0].update(points=20, races=2)
        player["aggregate_scores"].append(
            {"gp_number": 1, "role": "bagger", "points": 1, "races": 2, "disconnection_points": 0}
        )
        player.update(penalties=3, total_score=98)
        document["teams"]["A"].update(
            penalties=10,
            aggregate_awards=[{"gp_number": 1, "points": 6, "reason": "short_roster"}],
            total_score=94,
        )
        validate_committable_match(document)
        match_id = self.import_document(document)
        with self.SessionLocal() as session:
            detail = get_match_detail(match_id, session)
            self.assertEqual(detail["score_source"], "unaccounted")
            self.assertEqual(detail["entry_mode"], "gp")
            self.assertEqual(detail["tracks"], [])
            team = next(team for team in detail["teams"] if team["tag"] == "A")
            self.assertEqual(team["final_score"], 94)
            self.assertEqual(team["aggregate_awards"][0]["points"], 6)
            self.assertEqual(team["players"][0]["total"], 98)
            self.assertEqual(team["players"][0]["scores"], [])
            self.assertEqual(
                match_inventory(session, match_id)["records_deleted"]["unaccounted_team_awards"], 1
            )

    def test_correction_and_delete_remove_aggregate_owned_rows(self):
        match_id = self.import_document(aggregate_document())
        with self.SessionLocal.begin() as session:
            match = session.get(Match, match_id)
            from models import SourceFile

            source = session.get(SourceFile, match.source_file_id)
            replace_match(
                session,
                match_id,
                aggregate_document("totals"),
                approved_keys=set(),
                requested_player_identity_links={},
                requested_team_identity_resolutions={},
                expected_source_fingerprint=source.file_sha256,
            )
            session.flush()
            self.assertEqual(session.get(UnaccountedMatch, match_id).entry_mode, "totals")
            self.assertEqual(
                session.scalar(select(func.count()).select_from(UnaccountedPlayerScore)), 2
            )
            with patch("match_management.record_audit"):
                delete_match_from_database(
                    session, match_id, None, session.get(Match, match_id).match_label
                )
            session.flush()
            for model in (UnaccountedMatch, UnaccountedPlayerScore, UnaccountedTeamAward):
                self.assertEqual(session.scalar(select(func.count()).select_from(model)), 0)

    def test_accounted_correction_and_mixed_analytics_keep_race_facts_separate(self):
        match_id = self.import_document(aggregate_document())
        accounted = aggregate_document()
        accounted.update(
            score_source="accounted",
            tracks=["Recorded track"] * 12,
            match_label="M1 A vs B [Unaccounted · GP]",
        )
        accounted.pop("entry_mode")
        for index, team in enumerate(accounted["teams"].values()):
            for player in team["players"].values():
                player.pop("aggregate_scores")
                points = 15 if index == 0 else 12
                player.update(
                    race_scores=[points] * 12,
                    race_positions=[index + 1] * 12,
                    race_roles=["runner"] * 12,
                    total_score=points * 12,
                )
                team["total_score"] = player["total_score"]
        from import_json_to_db import detect_new_entries
        from models import SourceFile

        with self.SessionLocal.begin() as session:
            source = session.get(SourceFile, session.get(Match, match_id).source_file_id)
            approved = {entry["key"] for entry in detect_new_entries(session, accounted)}
            replace_match(
                session,
                match_id,
                accounted,
                approved_keys=approved,
                requested_player_identity_links={},
                requested_team_identity_resolutions={},
                expected_source_fingerprint=source.file_sha256,
            )
            session.flush()
            detail = get_match_detail(match_id, session)
            self.assertEqual(detail["score_source"], "accounted")
            self.assertNotIn("Unaccounted", detail["label"])
            self.assertEqual(len(detail["tracks"]), 12)
            self.assertEqual(
                session.scalar(select(func.count()).select_from(UnaccountedPlayerScore)), 0
            )
        self.import_document(aggregate_document("gp", 2))
        self.import_document(aggregate_document("totals", 3))
        with self.SessionLocal() as session:
            params = {"season": "s99", "division": "d1", "session": session}
            player = self.player_id(session)
            excluded = get_player_performance(player, **params)
            included = get_player_performance(player, include_unaccounted=True, **params)
            for key in ("by_race_number", "score_distribution", "placement_distribution"):
                self.assertEqual(excluded[key], included[key])
            self.assertEqual(included["metrics"]["total_points"], 420)
            self.assertEqual(
                included["by_gp_number"],
                [{"gp_number": gp, "average": 12.5, "races": 8} for gp in (1, 2, 3)],
            )
            tracks = get_player_tracks(player, **params)["tracks"]
            self.assertEqual(tracks[0]["scored_races"], 12)
            self.assertEqual(tracks[0]["total_points"], 180)
            self.assertEqual(included["metrics"]["wins"], excluded["metrics"]["wins"])

    def test_public_queue_does_not_publish_and_admin_acceptance_requires_auth(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = LocalArchiveStorage(Path(directory))
            with self.SessionLocal.begin() as session:
                submission = create_submission(
                    session,
                    storage,
                    aggregate_document(),
                    warnings_acknowledged=True,
                    original_filename="aggregate.json",
                    network_identifier="127.0.0.1",
                )
                self.assertIn("Unaccounted", submission.match_label)
                self.assertEqual(session.scalar(select(func.count()).select_from(Match)), 0)
                self.assertEqual(
                    session.scalar(select(func.count()).select_from(ReviewSubmission)), 1
                )
        client = app_module.app.test_client()
        self.assertEqual(
            client.post("/api/matches/commit", json={"match": aggregate_document()}).status_code,
            401,
        )

    def test_public_preview_rolls_back_aggregate_records(self):
        from import_json_to_db import detect_new_entries

        document = aggregate_document()
        with self.SessionLocal() as session:
            approved = [entry["key"] for entry in detect_new_entries(session, document)]
        with (
            patch.object(app_module.stats, "SessionLocal", self.SessionLocal),
            patch("import_json_to_db.lookup_mkc_player", return_value={"status": "not_found"}),
        ):
            response = app_module.app.test_client().post(
                "/api/matches/preview", json={"match": document, "approved_new_entries": approved}
            )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["match"]["score_source"], "unaccounted")
        with self.SessionLocal() as session:
            self.assertEqual(
                session.scalar(select(func.count()).select_from(UnaccountedPlayerScore)), 0
            )
            self.assertEqual(session.scalar(select(func.count()).select_from(Match)), 0)

    def test_acceptance_archives_and_is_idempotent(self):
        import acceptance_service
        from admin_auth import AdminActor
        from import_json_to_db import detect_new_entries
        from match_upload import prepare_upload_document
        from models import AdminUser

        document = aggregate_document()
        prepared = prepare_upload_document(document)
        with self.SessionLocal.begin() as session:
            session.add(
                AdminUser(
                    admin_user_id=1,
                    firebase_uid="test-owner",
                    email="owner@example.com",
                    normalized_email="owner@example.com",
                    role="owner",
                    status="active",
                )
            )
            approved = {entry["key"] for entry in detect_new_entries(session, document)}
        actor = AdminActor(1, "test-owner", "owner@example.com", "owner")
        with tempfile.TemporaryDirectory() as directory:
            storage = LocalArchiveStorage(Path(directory))
            with (
                patch.object(acceptance_service.stats, "SessionLocal", self.SessionLocal),
                patch("import_json_to_db.lookup_mkc_player", return_value={"status": "not_found"}),
            ):
                for attempt in range(2):
                    key = f"queue/aggregate-{attempt}.json"
                    storage.put_temporary(key, prepared.content)
                    result = acceptance_service.accept_match(
                        storage,
                        actor,
                        document,
                        approved_keys=approved,
                        expected_fingerprint=prepared.fingerprint,
                        temporary_key=key,
                    )
                self.assertEqual(result.payload["archive_status"], "complete")
                self.assertEqual(storage.read(result.payload["archive_path"]), prepared.content)
        with self.SessionLocal() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Match)), 1)
            self.assertEqual(
                session.scalar(select(func.count()).select_from(UnaccountedPlayerScore)), 6
            )
            self.assertFalse(
                any(
                    issue["key"] == "race-count-mismatch"
                    for issue in _match_and_result_issues(session)
                )
            )

    def test_aggregate_flag_forwarding_and_validation(self):
        client = app_module.app.test_client()
        for path, function in (
            ("/api/players/1/overview", "get_player_overview"),
            ("/api/players/1/performance", "get_player_performance"),
            ("/api/teams/1/overview", "get_team_overview"),
            ("/api/teams/1/roster", "get_team_roster"),
        ):
            with patch.object(app_module.dashboards, function, return_value={}) as mocked:
                self.assertEqual(client.get(path + "?include_unaccounted=true").status_code, 200)
                self.assertTrue(mocked.call_args.kwargs["include_unaccounted"])
                self.assertEqual(client.get(path + "?include_unaccounted=invalid").status_code, 400)

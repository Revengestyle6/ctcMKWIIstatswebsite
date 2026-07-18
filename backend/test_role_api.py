import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import app as app_module
import stats_db


class RoleApiTests(unittest.TestCase):
    def setUp(self):
        app_module.app.config.update(TESTING=True)
        app_module.cache.clear()
        self.client = app_module.app.test_client()

    def test_dashboard_role_defaults_to_runner_and_forwards(self):
        cases = (
            ("/api/players/7/overview", "get_player_overview"),
            ("/api/players/7/performance", "get_player_performance"),
            ("/api/players/7/tracks", "get_player_tracks"),
            ("/api/teams/4/roster", "get_team_roster"),
        )
        for path, function_name in cases:
            with self.subTest(path=path), patch.object(
                app_module.dashboards, function_name, return_value={"ok": True}
            ) as mocked:
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(mocked.call_args.kwargs["role"], "runner")

        with patch.object(
            app_module.dashboards, "get_player_performance", return_value={"ok": True}
        ) as mocked:
            response = self.client.get("/api/players/7/performance?role=+++")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(mocked.call_args.kwargs["role"], "runner")

    def test_bagger_forwards_on_every_player_derived_route_family(self):
        cases = (
            ("/api/player?name=Example&role=bagger", app_module.stats, "findtopplayertracks"),
            ("/api/player-avg?name=Example&role=bagger", app_module.stats, "findplayeravg"),
            ("/api/players/7/overview?role=bagger", app_module.dashboards, "get_player_overview"),
            ("/api/players/7/performance?role=bagger", app_module.dashboards, "get_player_performance"),
            ("/api/players/7/tracks?role=bagger", app_module.dashboards, "get_player_tracks"),
            ("/api/teams/4/roster?role=bagger", app_module.dashboards, "get_team_roster"),
            ("/api/top-team-players?team=a&role=bagger", app_module.stats, "findtopteamplayers"),
            ("/api/top-tracks?track=Test+Track&role=bagger", app_module.stats, "findtoptracks"),
        )
        for path, owner, function_name in cases:
            with self.subTest(path=path), patch.object(
                owner, function_name, return_value={"ok": True}
            ) as mocked:
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(mocked.call_args.kwargs["role"], "bagger")

    def test_legacy_role_defaults_to_runner_and_forwards(self):
        cases = (
            ("/api/player?name=DefaultRole", app_module.stats, "findtopplayertracks"),
            ("/api/player-avg?name=DefaultRole", app_module.stats, "findplayeravg"),
            ("/api/top-team-players?team=default-role", app_module.stats, "findtopteamplayers"),
            ("/api/top-tracks?track=Default+Role", app_module.stats, "findtoptracks"),
        )
        for path, owner, function_name in cases:
            with self.subTest(path=path), patch.object(
                owner, function_name, return_value=[]
            ) as mocked:
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(mocked.call_args.kwargs["role"], "runner")

    def test_invalid_role_returns_400_before_player_backend_is_called(self):
        cases = (
            ("/api/player?name=Example&role=all", app_module.stats, "findtopplayertracks"),
            ("/api/player-avg?name=Example&role=all", app_module.stats, "findplayeravg"),
            ("/api/players/7/overview?role=all", app_module.dashboards, "get_player_overview"),
            ("/api/players/7/performance?role=all", app_module.dashboards, "get_player_performance"),
            ("/api/players/7/tracks?role=all", app_module.dashboards, "get_player_tracks"),
            ("/api/teams/4/roster?role=all", app_module.dashboards, "get_team_roster"),
            ("/api/top-team-players?team=a&role=all", app_module.stats, "findtopteamplayers"),
            ("/api/top-tracks?track=Test+Track&role=all", app_module.stats, "findtoptracks"),
        )
        for path, owner, function_name in cases:
            with self.subTest(path=path), patch.object(owner, function_name) as mocked:
                response = self.client.get(path)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json(), {"error": "role must be runner or bagger."})
                mocked.assert_not_called()

    def test_invalid_role_on_printing_legacy_routes_is_quiet(self):
        with patch("builtins.print") as noisy_print:
            team_response = self.client.get("/api/top-team-players?team=a&role=all")
            track_response = self.client.get("/api/top-tracks?track=Test+Track&role=all")
        self.assertEqual(team_response.status_code, 400)
        self.assertEqual(track_response.status_code, 400)
        noisy_print.assert_not_called()

    def test_legacy_player_rankings_reject_invalid_minimum_races_before_backend_call(self):
        cases = (
            ("/api/top-team-players?team=a", app_module.stats, "findtopteamplayers"),
            ("/api/top-tracks?track=Test+Track", app_module.stats, "findtoptracks"),
        )
        invalid_values = ("0", "-1", "501", "not-a-number")
        for path, owner, function_name in cases:
            for invalid_value in invalid_values:
                with self.subTest(path=path, min_races=invalid_value), patch.object(
                    owner, function_name
                ) as mocked:
                    response = self.client.get(f"{path}&min_races={invalid_value}")
                    self.assertEqual(response.status_code, 400)
                    mocked.assert_not_called()

    def test_legacy_player_rankings_accept_minimum_race_bounds(self):
        cases = (
            ("/api/top-team-players?team=a", app_module.stats, "findtopteamplayers"),
            ("/api/top-tracks?track=Test+Track", app_module.stats, "findtoptracks"),
        )
        for path, owner, function_name in cases:
            for minimum in (1, 500):
                with self.subTest(path=path, min_races=minimum), patch.object(
                    owner, function_name, return_value=[]
                ) as mocked:
                    response = self.client.get(f"{path}&min_races={minimum}")
                    self.assertEqual(response.status_code, 200)
                    if function_name == "findtopteamplayers":
                        self.assertEqual(mocked.call_args.args[1], minimum)
                    else:
                        self.assertEqual(mocked.call_args.kwargs["min_races"], minimum)

    def test_team_overview_and_tracks_never_receive_role(self):
        cases = (
            ("/api/teams/4/overview?role=bagger", "get_team_overview"),
            ("/api/teams/4/tracks?role=bagger", "get_team_tracks"),
        )
        for path, function_name in cases:
            with self.subTest(path=path), patch.object(
                app_module.dashboards, function_name, return_value={"ok": True}
            ) as mocked:
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertNotIn("role", mocked.call_args.kwargs)

    def test_legacy_team_and_match_routes_remain_role_independent(self):
        cases = (
            ("/api/top-team-tracks?team=no-role&role=bagger", app_module.stats, "findtopteamtracks"),
            ("/api/top-teams-on-track?track=No+Role&role=bagger", app_module.stats, "findtopteamsontrack"),
            ("/api/matches?team=no-role&role=bagger", app_module.stats, "list_matches"),
            ("/api/matches/987654?role=bagger", app_module.stats, "get_match_detail"),
        )
        for path, owner, function_name in cases:
            with self.subTest(path=path), patch.object(
                owner, function_name, return_value={"unchanged": True}
            ) as mocked:
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json(), {"unchanged": True})
                self.assertNotIn("role", mocked.call_args.kwargs)

    def test_legacy_routes_return_structured_json(self):
        player_tracks = [
            {"track_id": 3, "name": "Test Track", "role": "runner", "total_points": 25}
        ]
        average = {
            "role": "runner",
            "player_id": 7,
            "player_name": "Example",
            "team_name": "a",
            "metrics": {"total_points": 25},
        }
        roster = [{"player_id": 7, "role": "runner", "metrics": {"total_points": 25}}]
        rankings = [{"player_id": 7, "role": "runner", "metrics": {"total_points": 25}}]
        cases = (
            ("/api/player?name=Example", app_module.stats, "findtopplayertracks", player_tracks,
             {"player": "Example", "role": "runner", "results": player_tracks}),
            ("/api/player-avg?name=Example", app_module.stats, "findplayeravg", average, average),
            ("/api/top-team-players?team=a", app_module.stats, "findtopteamplayers", roster, roster),
            ("/api/top-tracks?track=Test+Track", app_module.stats, "findtoptracks", rankings, rankings),
        )
        for path, owner, function_name, backend_value, expected in cases:
            with self.subTest(path=path), patch.object(owner, function_name, return_value=backend_value):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json(), expected)


class LegacyRoleDelegationTests(unittest.TestCase):
    def setUp(self):
        self.session = MagicMock()
        self.session_context = MagicMock()
        self.session_context.__enter__.return_value = self.session
        self.scope = SimpleNamespace(
            season_code="s2", division_code="d1", season_id=2, division_id=3
        )

    def _session_patches(self):
        return (
            patch.object(stats_db, "SessionLocal", return_value=self.session_context),
            patch.object(stats_db, "_get_scope", return_value=self.scope),
        )

    def test_player_legacy_functions_delegate_canonical_id_and_role(self):
        player = SimpleNamespace(player_id=7, display_name="Example", clan_tag="a")
        session_patch, scope_patch = self._session_patches()
        with session_patch, scope_patch, patch.object(
            stats_db, "_resolve_player", return_value=player
        ), patch.object(
            stats_db.dashboards,
            "get_player_tracks",
            return_value={"tracks": [{"track_id": 3, "role": "bagger"}]},
        ) as dashboard_tracks:
            rows = stats_db.top_player_tracks(
                "Alias", min_races=4, division="d1", season="s2", role=" BAGGER "
            )

        self.assertEqual(rows, [{"track_id": 3, "role": "bagger"}])
        dashboard_tracks.assert_called_once_with(
            7,
            season="s2",
            division="d1",
            min_races=4,
            role="bagger",
            session=self.session,
        )

    def test_team_and_track_legacy_rankings_delegate_canonical_ids(self):
        team = SimpleNamespace(team_id=4)
        track = SimpleNamespace(track_id=9)
        session_patch, scope_patch = self._session_patches()
        with session_patch, scope_patch, patch.object(
            stats_db, "_resolve_team", return_value=team
        ), patch.object(
            stats_db.dashboards, "get_team_roster", return_value={"players": [{"player_id": 7}]}
        ) as roster:
            players = stats_db.top_team_players("a", role="bagger")
        self.assertEqual(players, [{"player_id": 7, "role": "bagger"}])
        self.assertEqual(roster.call_args.args, (4,))
        self.assertEqual(roster.call_args.kwargs["role"], "bagger")

        session_patch, scope_patch = self._session_patches()
        with session_patch, scope_patch, patch.object(
            stats_db, "_resolve_track", return_value=track
        ), patch.object(
            stats_db.dashboards,
            "get_track_player_rankings",
            return_value={"players": [{"player_id": 8}]},
        ) as rankings:
            players = stats_db.top_track_players("Alias Track", role="runner")
        self.assertEqual(players, [{
            "player_id": 8,
            "name": None,
            "role": "runner",
            "races": None,
            "scored_races": None,
            "points_per_race": None,
            "twelve_race_pace": None,
            "bag_point_rate": None,
            "zero_point_rate": None,
            "average_placement": None,
            "total_points": None,
            "excluded_score_rows": None,
        }])
        self.assertEqual(rankings.call_args.args, (9,))
        self.assertEqual(rankings.call_args.kwargs["role"], "runner")


if __name__ == "__main__":
    unittest.main()

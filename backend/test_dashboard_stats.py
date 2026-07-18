import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from dashboard_stats import (
    get_player_overview,
    get_player_performance,
    get_player_tracks,
    get_team_overview,
    get_team_roster,
    get_team_tracks,
)
from database import Base
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


class DashboardOverviewTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:", future=True)
        Base.metadata.create_all(engine)
        self.session = sessionmaker(bind=engine, future=True)()
        self._seed()

    def tearDown(self):
        self.session.close()

    def _seed(self):
        s1 = Season(league_code="ctc", season_code="s1", season_number=1, name="Season 1")
        s2 = Season(league_code="ctc", season_code="s2", season_number=2, name="Season 2")
        self.session.add_all([s1, s2])
        self.session.flush()
        d1_s1 = Division(season_id=s1.season_id, division_code="d1", division_name="Division 1")
        d1_s2 = Division(season_id=s2.season_id, division_code="d1", division_name="Division 1")
        alpha = Team(canonical_name="Alpha", canonical_tag="a")
        beta = Team(canonical_name="Beta", canonical_tag="b")
        self.session.add_all([d1_s1, d1_s2, alpha, beta])
        self.session.flush()

        entries = {}
        for season, division in [(s1, d1_s1), (s2, d1_s2)]:
            for team in [alpha, beta]:
                entry = TeamSeasonEntry(
                    team_id=team.team_id,
                    season_id=season.season_id,
                    division_id=division.division_id,
                    display_name=team.canonical_name,
                    clan_tag=team.canonical_tag,
                    hex_color="#3366FF" if team == alpha else "#DD3344",
                )
                self.session.add(entry)
                self.session.flush()
                entries[(season.season_code, team.canonical_tag)] = entry

        player = Player(canonical_lounge_name="Runner", primary_friend_code="1111-2222-3333")
        self.session.add(player)
        self.session.flush()
        self.player_id = player.player_id
        self.alpha_id = alpha.team_id
        self.session.add_all([
            PlayerFriendCode(player_id=player.player_id, friend_code="1111-2222-3333"),
            PlayerFriendCode(player_id=player.player_id, friend_code="4444-5555-6666"),
            PlayerAlias(player_id=player.player_id, alias_type="mii_name", alias_value="a Runner"),
        ])

        track = Track(canonical_name="Test Track")
        self.session.add(track)
        self.session.flush()

        match_specs = [
            (s1, d1_s1, 1, [15, 12, 10, 8], 40, 5, 35, 30),
            (s2, d1_s2, 2, [32, 6, 5, 4], 22, 0, 22, 40),
        ]
        for season, division, week, scores, raw_score, penalty, final_score, opponent_score in match_specs:
            source = SourceFile(
                season_id=season.season_id,
                division_id=division.division_id,
                source_path=f"JSON/ctc/{season.season_code}/d1/w{week}.json",
                source_filename=f"w{week}.json",
                file_sha256=f"hash-{week}",
                json_shape="single",
            )
            self.session.add(source)
            self.session.flush()
            match = Match(
                season_id=season.season_id,
                division_id=division.division_id,
                source_file_id=source.source_file_id,
                week_number=week,
                match_label=f"Week {week}",
                format="5v5",
                races_played=4,
            )
            self.session.add(match)
            self.session.flush()
            alpha_match_team = MatchTeam(
                match_id=match.match_id,
                team_season_entry_id=entries[(season.season_code, "a")].team_season_entry_id,
                raw_team_key="a",
                raw_total_score=raw_score,
                team_penalty_points=penalty,
                final_score=final_score,
            )
            beta_match_team = MatchTeam(
                match_id=match.match_id,
                team_season_entry_id=entries[(season.season_code, "b")].team_season_entry_id,
                raw_team_key="b",
                raw_total_score=opponent_score,
                final_score=opponent_score,
            )
            self.session.add_all([alpha_match_team, beta_match_team])
            self.session.flush()
            player_entry = PlayerSeasonEntry(
                player_id=player.player_id,
                team_season_entry_id=entries[(season.season_code, "a")].team_season_entry_id,
                season_id=season.season_id,
                division_id=division.division_id,
                primary_lounge_name="Runner",
                primary_mii_name="a Runner",
                flag="us",
                first_seen_match_id=match.match_id,
                last_seen_match_id=match.match_id,
            )
            self.session.add(player_entry)
            self.session.flush()
            match_player = MatchPlayer(
                match_team_id=alpha_match_team.match_team_id,
                player_id=player.player_id,
                player_season_entry_id=player_entry.player_season_entry_id,
                friend_code_raw="1111-2222-3333",
                lounge_name_raw="Runner",
                mii_name_raw="a Runner",
                raw_total_score=sum(scores),
            )
            self.session.add(match_player)
            self.session.flush()
            for race_number, score in enumerate(scores, start=1):
                race = Race(
                    match_id=match.match_id,
                    race_number=race_number,
                    track_id=track.track_id,
                    track_name_raw="Test Track",
                )
                self.session.add(race)
                self.session.flush()
                role = "unknown" if season.season_code == "s2" and race_number in {1, 4} else "runner"
                position = 5 if season.season_code == "s2" and race_number == 1 else (10 if race_number == 4 else 16 - score)
                self.session.add(RacePlayerResult(
                    race_id=race.race_id,
                    match_player_id=match_player.match_player_id,
                    player_id=player.player_id,
                    match_team_id=alpha_match_team.match_team_id,
                    team_season_entry_id=entries[(season.season_code, "a")].team_season_entry_id,
                    score=score,
                    position=position,
                    role=role,
                    role_source="unknown" if role == "unknown" else "manual",
                ))
                if season.season_code == "s1" and race_number == 1:
                    self.session.add(RaceTeamResult(
                        race_id=race.race_id,
                        match_team_id=alpha_match_team.match_team_id,
                        score=3,
                        result_type="missing_player",
                        reason="short_roster",
                    ))
        self.session.add_all([
            TeamLogo(
                team_id=alpha.team_id,
                asset_path="images/team-logos/1/default.webp",
                alt_text="Alpha logo",
                priority=1,
            ),
            TeamLogo(
                team_id=alpha.team_id,
                season_id=s2.season_id,
                asset_path="images/team-logos/1/season-2.webp",
                alt_text="Alpha Season 2 logo",
                priority=10,
            ),
        ])
        self.session.commit()

    def test_player_career_and_season_scopes(self):
        career = get_player_overview(self.player_id, session=self.session)
        self.assertEqual(career["metrics"]["races"], 8)
        self.assertEqual(career["metrics"]["matches"], 2)
        self.assertEqual(career["metrics"]["seasons"], 2)
        self.assertEqual(career["metrics"]["total_points"], 60)
        self.assertEqual(career["metrics"]["excluded_score_rows"], 1)
        self.assertEqual(len(career["identity"]["friend_codes"]), 2)
        self.assertEqual(career["recent_matches"][0]["season"], "s2")

        season = get_player_overview(self.player_id, season="1", session=self.session)
        self.assertEqual(season["metrics"]["races"], 4)
        self.assertEqual(season["metrics"]["total_points"], 45)
        self.assertEqual(season["record"]["wins"], 1)

    def test_team_records_use_final_scores_and_logo_scope(self):
        career = get_team_overview(self.alpha_id, session=self.session)
        self.assertEqual(career["record"], {"wins": 1, "losses": 1, "ties": 0, "unknown": 0})
        self.assertEqual(career["metrics"]["total_penalties"], 5)
        self.assertEqual(career["identity"]["logo_url"], "/images/team-logos/1/default.webp")

        season = get_team_overview(self.alpha_id, season="s2", division="d1", session=self.session)
        self.assertEqual(season["record"]["losses"], 1)
        self.assertEqual(season["metrics"]["average_differential"], -18.0)
        self.assertEqual(season["identity"]["logo_url"], "/images/team-logos/1/season-2.webp")

    def test_runner_inference_and_player_track_threshold(self):
        performance = get_player_performance(self.player_id, session=self.session)
        self.assertEqual(performance["runner_metrics"]["races"], 7)
        self.assertEqual(performance["role_coverage"]["explicit_runner"], 6)
        self.assertEqual(performance["role_coverage"]["inferred_runner"], 1)
        self.assertEqual(performance["role_coverage"]["inferred_bagger"], 1)
        self.assertEqual(performance["runner_metrics"]["excluded_score_rows"], 1)

        tracks = get_player_tracks(self.player_id, min_races=8, session=self.session)
        self.assertEqual(tracks["tracks"], [])
        tracks = get_player_tracks(self.player_id, min_races=7, session=self.session)
        self.assertEqual(tracks["tracks"][0]["races"], 7)

    def test_team_roster_and_tracks_include_missing_player_points(self):
        roster = get_team_roster(self.alpha_id, min_races=1, session=self.session)
        self.assertEqual(len(roster["players"]), 1)
        self.assertEqual(roster["players"][0]["player_id"], self.player_id)
        self.assertEqual(roster["players"][0]["runner_races"], 7)

        tracks = get_team_tracks(self.alpha_id, min_races=1, session=self.session)
        self.assertEqual(len(tracks["tracks"]), 1)
        self.assertEqual(tracks["tracks"][0]["races"], 8)
        self.assertEqual(tracks["tracks"][0]["average_score"], 7.88)


if __name__ == "__main__":
    unittest.main()

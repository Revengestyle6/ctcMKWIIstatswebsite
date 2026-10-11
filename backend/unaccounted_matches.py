"""Aggregate match entry policy. No race facts are inferred from these documents."""

import re
from collections import defaultdict

from match_sets import apply_match_set
from models import (
    Division,
    Match,
    MatchPlayer,
    MatchTeam,
    Player,
    Season,
    Team,
    TeamSeasonEntry,
    UnaccountedMatch,
    UnaccountedPlayerScore,
    UnaccountedTeamAward,
)
from sqlalchemy import select


def is_unaccounted(document):
    source = document.get("score_source", "accounted")
    if source not in ("accounted", "unaccounted"):
        raise ValueError("Score source must be accounted or unaccounted.")
    if source == "accounted" and "entry_mode" in document:
        raise ValueError("Aggregate entry mode requires an unaccounted match.")
    return source == "unaccounted"


def period_races(document, gp_number):
    return (
        document["races_played"]
        if gp_number == 0
        else min(4, document["races_played"] - (gp_number - 1) * 4)
    )


def _integer(value, label, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{label} must be a whole number of at least {minimum}.")
    return value


def _period(document, value):
    gp = _integer(value, "GP number")
    if document["entry_mode"] == "totals":
        if gp != 0:
            raise ValueError("Total entry must use GP number 0.")
    elif not 1 <= gp <= (document["races_played"] + 3) // 4:
        raise ValueError("GP number is outside this match.")
    return gp


def validate_unaccounted_match(document):
    if not is_unaccounted(document):
        # Aggregate fields may never masquerade as an accounted source.
        for team in (document.get("teams") or {}).values():
            if "aggregate_awards" in team or any(
                "aggregate_scores" in player for player in (team.get("players") or {}).values()
            ):
                raise ValueError("Aggregate scores and awards require an unaccounted match.")
        return
    if document.get("result_type", "played") != "played":
        raise ValueError("Unaccounted matches must be played results.")
    if document.get("entry_mode") not in ("gp", "totals"):
        raise ValueError("Unaccounted entry mode must be gp or totals.")
    _integer(document.get("races_played"), "Races played", 1)
    if document.get("tracks") not in (None, []):
        raise ValueError("Unaccounted matches cannot contain tracks.")
    teams = document.get("teams")
    if not isinstance(teams, dict) or len(teams) != 2:
        raise ValueError("An unaccounted match requires exactly two teams.")
    format_match = re.fullmatch(r"(\d+)v(\d+)", str(document.get("format") or ""), re.I)
    if not format_match or min(map(int, format_match.groups())) < 1:
        raise ValueError("Unaccounted matches require a team format such as 5v5.")
    friend_codes = set()
    for index, (tag, team) in enumerate(teams.items()):
        if not str(tag).strip() or not isinstance(team, dict):
            raise ValueError("Every team needs a tag and an object.")
        if team.get("missing_player_scores") or team.get("missing_player_results"):
            raise ValueError("Use aggregate awards for unaccounted missing-player points.")
        penalty = _integer(team.get("penalties", 0), "Team penalty")
        players = team.get("players")
        if not isinstance(players, dict) or not players:
            raise ValueError("Every unaccounted team requires players.")
        team_total = 0
        attendance = defaultdict(int)
        for fc, player in players.items():
            if not re.fullmatch(r"\d{4}-\d{4}-\d{4}", fc) or fc in friend_codes:
                raise ValueError(f"Invalid or duplicate friend code: {fc}.")
            friend_codes.add(fc)
            if not isinstance(player, dict):
                raise ValueError("Every player must be an object.")
            if any(
                player.get(key)
                for key in ("race_scores", "race_positions", "race_roles", "gp_scores")
            ):
                raise ValueError(
                    "Unaccounted players cannot contain race data; use aggregate scores."
                )
            scores = player.get("aggregate_scores")
            if not isinstance(scores, list) or not scores:
                raise ValueError(f"Player {fc} requires aggregate role scores.")
            seen = set()
            participation = defaultdict(int)
            points = 0
            for score in scores:
                if not isinstance(score, dict):
                    raise ValueError("An aggregate score must be an object.")
                gp = _period(document, score.get("gp_number"))
                role = score.get("role")
                if role not in ("runner", "bagger") or (gp, role) in seen:
                    raise ValueError("Each period permits one score per runner/bagger role.")
                seen.add((gp, role))
                count = _integer(score.get("races"), "Role races")
                value = _integer(score.get("points"), "Role points")
                dc = _integer(score.get("disconnection_points", 0), "Disconnection points")
                if value > 15 * count or dc > value:
                    raise ValueError(
                        "Role points exceed 15 per race or disconnection points exceed role points."
                    )
                participation[gp] += count
                attendance[gp] += count
                if participation[gp] > period_races(document, gp):
                    raise ValueError(f"Player {fc} has more role races than this period contains.")
                points += value
            player_penalty = _integer(player.get("penalties", 0), "Player penalty")
            if (
                isinstance(player.get("total_score"), bool)
                or not isinstance(player.get("total_score"), int)
                or player.get("total_score") != points - player_penalty
            ):
                raise ValueError(
                    f"Player {fc} total must equal role points minus player penalties."
                )
            team_total += points - player_penalty
        team_size = int(format_match.group(index + 1))
        if any(count > team_size * period_races(document, gp) for gp, count in attendance.items()):
            raise ValueError("Team role races exceed the available player slots in a period.")
        awards = team.get("aggregate_awards", [])
        if not isinstance(awards, list):
            raise ValueError("Aggregate awards must be a list.")
        for award in awards:
            if not isinstance(award, dict):
                raise ValueError("An aggregate award must be an object.")
            _period(document, award.get("gp_number"))
            if award.get("reason") not in ("short_roster", "unreplaced_disconnect", "unknown"):
                raise ValueError("Invalid missing-player award reason.")
            team_total += _integer(award.get("points"), "Missing-player points")
        if (
            isinstance(team.get("total_score"), bool)
            or not isinstance(team.get("total_score"), int)
            or team.get("total_score") != team_total - penalty
        ):
            raise ValueError(
                f"Team {tag} total must equal player totals plus missing-player awards minus team penalties."
            )


def store_player_scores(session, match_player, player):
    for score in player["aggregate_scores"]:
        session.add(
            UnaccountedPlayerScore(
                match_player_id=match_player.match_player_id,
                **{
                    key: score.get(key, 0)
                    for key in ("gp_number", "role", "points", "races", "disconnection_points")
                },
            )
        )


def store_team_awards(session, match_team, team):
    for award in team.get("aggregate_awards", []):
        session.add(
            UnaccountedTeamAward(
                match_team_id=match_team.match_team_id,
                **{key: award[key] for key in ("gp_number", "points", "reason")},
            )
        )


def accounted_match_filter(statement, include_unaccounted=False):
    if include_unaccounted:
        return statement
    return statement.where(
        ~select(UnaccountedMatch.match_id)
        .where(UnaccountedMatch.match_id == Match.match_id)
        .exists()
    )


def aggregate_player_rows(
    session,
    scope,
    match_set="regular",
    player_id=None,
    team_id=None,
    match_ids=None,
    team_season_entry_id=None,
):
    statement = (
        select(
            UnaccountedPlayerScore,
            MatchPlayer.player_id,
            MatchPlayer.match_team_id,
            Match.match_id,
            Match.match_label,
            Match.match_number,
            Match.races_played,
            UnaccountedMatch.entry_mode,
            Season.season_id,
            Season.season_code,
            Season.season_number,
            Division.division_code,
            Team.team_id,
            Team.canonical_name.label("team_name"),
            TeamSeasonEntry.clan_tag,
            TeamSeasonEntry.team_season_entry_id,
            TeamSeasonEntry.competition_status,
            Player.canonical_name,
        )
        .join(MatchPlayer, MatchPlayer.match_player_id == UnaccountedPlayerScore.match_player_id)
        .join(Player, Player.player_id == MatchPlayer.player_id)
        .join(MatchTeam, MatchTeam.match_team_id == MatchPlayer.match_team_id)
        .join(Match, Match.match_id == MatchTeam.match_id)
        .join(UnaccountedMatch, UnaccountedMatch.match_id == Match.match_id)
        .join(Season, Season.season_id == Match.season_id)
        .join(Division, Division.division_id == Match.division_id)
        .join(
            TeamSeasonEntry, TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id
        )
        .join(Team, Team.team_id == TeamSeasonEntry.team_id)
    )
    if hasattr(scope, "league_code"):
        statement = statement.where(Season.league_code == scope.league_code)
    for column, value in (
        (Match.season_id, scope.season_id),
        (Match.division_id, scope.division_id),
        (MatchPlayer.player_id, player_id),
        (Team.team_id, team_id),
        (TeamSeasonEntry.team_season_entry_id, team_season_entry_id),
    ):
        if value is not None:
            statement = statement.where(column == value)
    if match_ids is not None:
        statement = statement.where(Match.match_id.in_(match_ids))
    return session.execute(
        apply_match_set(statement, match_set).order_by(
            Match.match_id, UnaccountedPlayerScore.gp_number
        )
    ).all()


def add_aggregate_metrics(metrics, rows, role):
    selected = [
        row.UnaccountedPlayerScore for row in rows if row.UnaccountedPlayerScore.role == role
    ]
    metrics["unaccounted_matches"] = len({row.match_id for row in rows})
    metrics["unaccounted_points"] = sum(row.points for row in selected)
    metrics["unaccounted_races"] = sum(row.races for row in selected)
    metrics["total_points"] += metrics["unaccounted_points"]
    metrics["races"] += metrics["unaccounted_races"]
    metrics["scored_races"] += metrics["unaccounted_races"]
    denominator = metrics["scored_races"]
    metrics["points_per_race"] = (
        round(metrics["total_points"] / denominator, 2) if denominator else None
    )
    if role == "runner":
        metrics["twelve_race_pace"] = (
            round(metrics["total_points"] / denominator * 12, 2) if denominator else None
        )
    # Placement, bag-point occurrence, and counterpart metrics keep their race-only denominators.
    return metrics

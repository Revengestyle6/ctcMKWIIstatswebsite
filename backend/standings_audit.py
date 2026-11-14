"""Explain one leaderboard entry using the same scope and role rules as standings."""

from collections import defaultdict

from analytics_eligibility import analytics_excluded_race_ids
from models import Match, MatchTeam, Race, RacePlayerResult, TeamSeasonEntry, Track
from player_role_analytics import (
    classify_role,
    confirmed_5v5_race_ids,
    valid_placement,
    valid_race_score,
)
from sqlalchemy import select
from standings_service import LEADERBOARD_ROLES, _player_leaderboard
from stats_queries import _get_scope
from unaccounted_matches import aggregate_player_rows


def _role_totals():
    return {role: {"points": 0, "races": 0} for role in LEADERBOARD_ROLES}


def _review_flags(*, room_size, dc, role, dominant_role):
    flags = []
    if room_size is not None and room_size <= 9:
        flags.append("small_room")
    if dc:
        flags.append("dc_award")
    if dominant_role and role in LEADERBOARD_ROLES and role != dominant_role:
        flags.append("unusual_role")
    if role == "unknown":
        flags.append("unknown_role")
    return flags


def get_standings_audit(session, *, league, season, division, player_id, team_season_entry_id):
    scope = _get_scope(session, season=season, division=division, league_code=league)
    leaderboard = _player_leaderboard(session, scope, {})
    player = next(
        (
            row
            for row in leaderboard
            if row["player_id"] == player_id and row["team_season_entry_id"] == team_season_entry_id
        ),
        None,
    )
    if player is None:
        raise ValueError("Player entry is not part of this division's leaderboard.")

    # Include the team's matches even when the selected player did not participate:
    # those races still contribute to the eligibility denominator.
    matches = session.scalars(
        select(Match)
        .join(MatchTeam, MatchTeam.match_id == Match.match_id)
        .where(
            Match.season_id == scope.season_id,
            Match.division_id == scope.division_id,
            Match.match_type == "regular",
            Match.result_type == "played",
            MatchTeam.team_season_entry_id == team_season_entry_id,
        )
        .order_by(Match.match_number, Match.match_id)
    ).all()
    match_ids = [match.match_id for match in matches]
    race_rows = session.execute(
        select(Race, Track.canonical_name)
        .join(Track, Track.track_id == Race.track_id)
        .where(Race.match_id.in_(match_ids))
        .order_by(Race.match_id, Race.race_number)
    ).all()
    race_ids = [race.race_id for race, _ in race_rows]
    results = session.scalars(
        select(RacePlayerResult).where(RacePlayerResult.race_id.in_(race_ids))
    ).all()
    by_race = defaultdict(list)
    for result in results:
        by_race[result.race_id].append(result)
    confirmed = confirmed_5v5_race_ids(session, results)
    excluded = analytics_excluded_race_ids(session)
    aggregates = aggregate_player_rows(session, scope, team_season_entry_id=team_season_entry_id)
    aggregate_by_match = defaultdict(list)
    for row in aggregates:
        aggregate_by_match[row.match_id].append(row)
    teams_by_match = defaultdict(list)
    for match_id, tag in session.execute(
        select(MatchTeam.match_id, TeamSeasonEntry.clan_tag)
        .join(
            TeamSeasonEntry, TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id
        )
        .where(MatchTeam.match_id.in_(match_ids))
    ):
        teams_by_match[match_id].append(tag)

    known_races = player["runner_races"] + player["bagger_races"]
    dominant_role = next(
        (
            role
            for role in LEADERBOARD_ROLES
            if known_races >= 12 and player[f"{role}_races"] / known_races >= 0.8
        ),
        None,
    )
    audit_matches = {}
    for match in matches:
        audit_matches[match.match_id] = {
            "match_id": match.match_id,
            "match_number": match.match_number,
            "label": match.match_label,
            "teams": teams_by_match[match.match_id],
            "source": "unaccounted" if match.match_id in aggregate_by_match else "accounted",
            "team_races": 0,
            "team_gps": 0,
            "roles": _role_totals(),
            "races": [],
            "aggregate_entries": [],
        }
    flagged_races = 0
    unknown_races = 0
    for race, track_name in race_rows:
        match = audit_matches[race.match_id]
        all_results = by_race[race.race_id]
        team_present = any(r.team_season_entry_id == team_season_entry_id for r in all_results)
        included = race.race_id not in excluded
        if included and team_present:
            match["team_races"] += 1
        selected_results = [
            r
            for r in all_results
            if r.player_id == player_id and r.team_season_entry_id == team_season_entry_id
        ]
        for result in selected_results:
            role, source = classify_role(result, confirmed)
            participated = result.position is not None or result.score is not None
            counted = included and participated
            # Position-less score awards do not establish the actual room size.
            room_size = (
                len({r.player_id for r in all_results if valid_placement(r.position)}) or None
            )
            dc = result.position is None and result.score is not None
            flags = (
                _review_flags(
                    room_size=room_size,
                    dc=dc,
                    role=role,
                    dominant_role=dominant_role,
                )
                if counted
                else []
            )
            if counted and result.score is not None and not valid_race_score(result.score):
                flags.append("invalid_score")
            if counted and role == "unknown":
                unknown_races += 1
            if flags:
                flagged_races += 1
            if included and role in LEADERBOARD_ROLES:
                if participated:
                    match["roles"][role]["races"] += 1
                if valid_race_score(result.score):
                    match["roles"][role]["points"] += int(result.score)
            match["races"].append(
                {
                    "race_id": race.race_id,
                    "race_number": race.race_number,
                    "gp_number": (race.race_number - 1) // 4 + 1,
                    "track": track_name,
                    "room_size": room_size,
                    "position": result.position,
                    "points": result.score,
                    "role": role,
                    "role_source": source,
                    "dc_award": dc,
                    "included": included,
                    "participated": participated,
                    "flags": flags,
                }
            )
    for match_id, match in audit_matches.items():
        rows = aggregate_by_match[match_id]
        if rows:
            match["team_races"] += rows[0].races_played
        match["team_gps"] = match["team_races"] / 4
        for row in rows:
            if row.player_id != player_id:
                continue
            score = row.UnaccountedPlayerScore
            match["roles"][score.role]["points"] += score.points
            match["roles"][score.role]["races"] += score.races
            match["aggregate_entries"].append(
                {
                    "gp_number": score.gp_number or None,
                    "role": score.role,
                    "races": score.races,
                    "points": score.points,
                    "disconnection_points": score.disconnection_points,
                }
            )

    totals = _role_totals()
    for match in audit_matches.values():
        for role in LEADERBOARD_ROLES:
            for field in ("points", "races"):
                totals[role][field] += match["roles"][role][field]
    return {
        "player": player,
        "team_races": sum(match["team_races"] for match in audit_matches.values()),
        "team_gps": player["team_gps"],
        "required_gps": player["required_gps"],
        "required_races": player["required_races"],
        "dominant_role": dominant_role,
        "role_history": {role: player[f"{role}_races"] for role in LEADERBOARD_ROLES},
        "flagged_races": flagged_races,
        "unknown_role_races": unknown_races,
        "reconciled": sum(match["team_gps"] for match in audit_matches.values())
        == player["team_gps"]
        and all(
            totals[role][field] == player[f"{role}_{field}"]
            for role in LEADERBOARD_ROLES
            for field in ("points", "races")
        ),
        "matches": list(audit_matches.values()),
    }

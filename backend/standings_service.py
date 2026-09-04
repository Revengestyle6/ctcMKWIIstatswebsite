import math
from collections import defaultdict

from analytics_eligibility import analytics_excluded_race_ids
from models import Match, MatchTeam, Player, Race, RacePlayerResult, Team, TeamSeasonEntry
from player_dashboard_stats import _team_logo_url
from player_display_names import _display_names_for_players
from player_role_analytics import confirmed_5v5_race_ids, role_coverage, valid_race_score
from sqlalchemy import select
from stats_queries import _get_scope, list_playoff_series

INACTIVE_STATUSES = frozenset({"dropped", "disqualified"})
LEADERBOARD_ROLES = ("runner", "bagger")


def _empty_record(entry, team, logo_url):
    return {
        "team_id": team.team_id,
        "team_season_entry_id": entry.team_season_entry_id,
        "name": entry.display_name or team.canonical_name,
        "tag": entry.clan_tag,
        "hex_color": entry.hex_color,
        "logo_url": logo_url,
        "status": entry.competition_status,
        "status_note": entry.competition_status_note,
        "played": 0,
        "wins": 0,
        "ties": 0,
        "losses": 0,
        "points_for": 0,
        "points_against": 0,
        "point_differential": 0,
        "standings_points": 0,
        "bonus_points": 0,
        "head_to_head_differential": 0,
    }


def _adjusted_match(team_rows, records, result_type):
    left, right = team_rows
    if result_type == "mutual_tie":
        return {left.team_season_entry_id: 0, right.team_season_entry_id: 0}, False, False
    left_inactive = records[left.team_season_entry_id]["status"] in INACTIVE_STATUSES
    right_inactive = records[right.team_season_entry_id]["status"] in INACTIVE_STATUSES
    if left_inactive and right_inactive:
        return {left.team_season_entry_id: 0, right.team_season_entry_id: 0}, True, True
    if left_inactive:
        return {left.team_season_entry_id: 0, right.team_season_entry_id: 150}, True, False
    if right_inactive:
        return {left.team_season_entry_id: 150, right.team_season_entry_id: 0}, True, False
    return (
        {
            left.team_season_entry_id: int(left.final_score or 0),
            right.team_season_entry_id: int(right.final_score or 0),
        },
        False,
        False,
    )


def _apply_result(records, team_rows, scores, both_inactive, result_type):
    left, right = team_rows
    left_id = left.team_season_entry_id
    right_id = right.team_season_entry_id
    left_record = records[left_id]
    right_record = records[right_id]
    for record, score_for, score_against in (
        (left_record, scores[left_id], scores[right_id]),
        (right_record, scores[right_id], scores[left_id]),
    ):
        record["played"] += 1
        record["points_for"] += score_for
        record["points_against"] += score_against

    if result_type == "mutual_tie":
        left_record["ties"] += 1
        right_record["ties"] += 1
        return {left_id: 0, right_id: 0}, {left_id: "tie", right_id: "tie"}
    if both_inactive:
        left_record["losses"] += 1
        right_record["losses"] += 1
        return {left_id: 0, right_id: 0}, {left_id: "loss", right_id: "loss"}
    if scores[left_id] == scores[right_id]:
        for record in (left_record, right_record):
            record["ties"] += 1
            record["standings_points"] += 2
        return {left_id: 2, right_id: 2}, {left_id: "tie", right_id: "tie"}

    winner_id, loser_id = (
        (left_id, right_id) if scores[left_id] > scores[right_id] else (right_id, left_id)
    )
    records[winner_id]["wins"] += 1
    records[winner_id]["standings_points"] += 3
    records[loser_id]["losses"] += 1
    awarded = {winner_id: 3, loser_id: 0}
    if scores[winner_id] - scores[loser_id] <= 20:
        records[loser_id]["bonus_points"] += 1
        records[loser_id]["standings_points"] += 1
        awarded[loser_id] = 1
    return awarded, {winner_id: "win", loser_id: "loss"}


def _rank_records(records, matches):
    for record in records.values():
        record["point_differential"] = record["points_for"] - record["points_against"]

    primary_groups = defaultdict(list)
    for entry_id, record in records.items():
        primary_groups[
            (
                record["standings_points"],
                record["wins"],
                record["ties"],
                record["losses"],
            )
        ].append(entry_id)
    for entry_ids in primary_groups.values():
        tied = set(entry_ids)
        for match in matches:
            ids = {team["team_season_entry_id"] for team in match["teams"]}
            if len(ids) != 2 or not ids.issubset(tied):
                continue
            for team in match["teams"]:
                records[team["team_season_entry_id"]]["head_to_head_differential"] += (
                    team["adjusted_score"] - team["adjusted_opponent_score"]
                )

    ordered = sorted(
        records.values(),
        key=lambda row: (
            -row["standings_points"],
            -row["wins"],
            -row["ties"],
            row["losses"],
            -row["head_to_head_differential"],
            -row["point_differential"],
            row["name"].casefold(),
        ),
    )
    prior_key = None
    rank = 0
    for index, record in enumerate(ordered, start=1):
        key = (
            record["standings_points"],
            record["wins"],
            record["ties"],
            record["losses"],
            record["head_to_head_differential"],
            record["point_differential"],
        )
        if key != prior_key:
            rank = index
            prior_key = key
        record["rank"] = rank
    return ordered


def _qualifying_role_gp_counts(team_gp_races, player_gp_roles):
    counts = {role: 0 for role in LEADERBOARD_ROLES}
    for gp_key, team_race_ids in team_gp_races.items():
        if not team_race_ids:
            continue
        roles_by_race = player_gp_roles.get(gp_key, {})
        required_role_races = math.ceil(len(team_race_ids) / 2)
        for role in LEADERBOARD_ROLES:
            role_races = sum(
                1
                for race_id, classified_role in roles_by_race.items()
                if race_id in team_race_ids and classified_role == role
            )
            if role_races >= required_role_races:
                counts[role] += 1
    return counts


def _role_eligibility(status, role, role_gp_count, required_gps):
    if status in INACTIVE_STATUSES:
        return False, f"Team {status}"
    if required_gps <= 0 or role_gp_count < required_gps:
        return (
            False,
            f"Completed {role_gp_count} of {required_gps} required GPs at least half as {role}",
        )
    return True, None


def _player_leaderboard(session, scope, records):
    excluded_races = analytics_excluded_race_ids(session)
    rows = session.execute(
        select(
            RacePlayerResult,
            Race.match_id,
            Race.race_number,
            TeamSeasonEntry.team_season_entry_id,
            TeamSeasonEntry.team_id,
            TeamSeasonEntry.clan_tag,
            TeamSeasonEntry.competition_status,
            Player.canonical_name,
        )
        .join(Race, Race.race_id == RacePlayerResult.race_id)
        .join(Match, Match.match_id == Race.match_id)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == RacePlayerResult.team_season_entry_id,
        )
        .join(Player, Player.player_id == RacePlayerResult.player_id)
        .where(
            Match.season_id == scope.season_id,
            Match.division_id == scope.division_id,
            Match.match_type == "regular",
            Match.result_type == "played",
        )
        .order_by(Race.match_id, Race.race_number)
    ).all()
    rows = [row for row in rows if row[0].race_id not in excluded_races]
    result_objects = [row[0] for row in rows]
    confirmed_ids = confirmed_5v5_race_ids(session, result_objects)
    _, classified = role_coverage(result_objects, confirmed_ids)
    classification = {row.race_player_result_id: role for row, role, _source in classified}

    team_gp_races = defaultdict(lambda: defaultdict(set))
    player_data = {}
    canonical_names = {}
    for row in rows:
        result = row[0]
        gp_key = (row.match_id, (row.race_number - 1) // 4 + 1)
        team_gp_races[row.team_season_entry_id][gp_key].add(result.race_id)
        key = (result.player_id, row.team_season_entry_id)
        data = player_data.setdefault(
            key,
            {
                "player_id": result.player_id,
                "team_id": row.team_id,
                "team_season_entry_id": row.team_season_entry_id,
                "team_tag": row.clan_tag,
                "team_status": row.competition_status,
                "gp_keys": set(),
                "roles_by_gp_race": defaultdict(dict),
                "runner_points": 0,
                "runner_races": 0,
                "bagger_points": 0,
                "bagger_races": 0,
            },
        )
        participated = result.position is not None or result.score is not None
        role = classification.get(result.race_player_result_id, "unknown")
        if participated:
            data["gp_keys"].add(gp_key)
            data["roles_by_gp_race"][gp_key][result.race_id] = role
        if role in {"runner", "bagger"} and valid_race_score(result.score):
            data[f"{role}_points"] += int(result.score)
            data[f"{role}_races"] += 1
        canonical_names[result.player_id] = row.canonical_name

    display_names = _display_names_for_players(session, canonical_names.keys(), canonical_names)
    leaderboard = []
    for data in player_data.values():
        entry_gp_races = team_gp_races[data["team_season_entry_id"]]
        team_gp_count = len(entry_gp_races)
        played_gps = len(data.pop("gp_keys"))
        role_gp_counts = _qualifying_role_gp_counts(entry_gp_races, data.pop("roles_by_gp_race"))
        required_gps = math.ceil(team_gp_count * 2 / 3)
        status_eligible = data["team_status"] not in INACTIVE_STATUSES
        participation_eligible = played_gps >= required_gps and required_gps > 0
        role_eligibility = {
            role: _role_eligibility(data["team_status"], role, role_gp_counts[role], required_gps)
            for role in LEADERBOARD_ROLES
        }
        data.update(
            {
                "name": display_names.get(data["player_id"], f"Player {data['player_id']}"),
                "team_gps": team_gp_count,
                "gps_played": played_gps,
                "required_gps": required_gps,
                "eligible": status_eligible and participation_eligible,
                "eligibility_reason": (
                    f"Team {data['team_status']}"
                    if not status_eligible
                    else None
                    if participation_eligible
                    else f"Played {played_gps} of {required_gps} required GPs"
                ),
                "runner_gps_played": role_gp_counts["runner"],
                "runner_eligible": role_eligibility["runner"][0],
                "runner_eligibility_reason": role_eligibility["runner"][1],
                "bagger_gps_played": role_gp_counts["bagger"],
                "bagger_eligible": role_eligibility["bagger"][0],
                "bagger_eligibility_reason": role_eligibility["bagger"][1],
                "runner_gp_average": (
                    round(data["runner_points"] / played_gps, 2) if played_gps else None
                ),
                "bagger_gp_average": (
                    round(data["bagger_points"] / played_gps, 2) if played_gps else None
                ),
            }
        )
        leaderboard.append(data)
    leaderboard.sort(
        key=lambda row: (
            -(row["runner_gp_average"] if row["runner_gp_average"] is not None else -1),
            -row["runner_points"],
            row["name"].casefold(),
        )
    )
    return leaderboard


def get_division_standings(session, *, league, season, division):
    scope = _get_scope(session, season=season, division=division, league_code=league)
    team_rows = session.execute(
        select(TeamSeasonEntry, Team)
        .join(Team, Team.team_id == TeamSeasonEntry.team_id)
        .where(
            TeamSeasonEntry.season_id == scope.season_id,
            TeamSeasonEntry.division_id == scope.division_id,
        )
        .order_by(TeamSeasonEntry.display_name, TeamSeasonEntry.clan_tag)
    ).all()
    records = {
        entry.team_season_entry_id: _empty_record(
            entry, team, _team_logo_url(session, team.team_id, scope.season_id)
        )
        for entry, team in team_rows
    }
    match_rows = session.execute(
        select(
            Match.match_id,
            Match.match_number,
            Match.match_label,
            Match.result_type,
            MatchTeam.match_team_id,
            MatchTeam.team_season_entry_id,
            MatchTeam.final_score,
        )
        .join(MatchTeam, MatchTeam.match_id == Match.match_id)
        .where(
            Match.season_id == scope.season_id,
            Match.division_id == scope.division_id,
            Match.match_type == "regular",
        )
        .order_by(Match.match_number, Match.match_id, MatchTeam.match_team_id)
    ).all()
    by_match = defaultdict(list)
    match_metadata = {}
    for row in match_rows:
        by_match[row.match_id].append(row)
        match_metadata[row.match_id] = row

    matches = []
    for match_id, teams in by_match.items():
        teams = [team for team in teams if team.team_season_entry_id in records]
        if len(teams) != 2:
            continue
        original_scores = {team.team_season_entry_id: int(team.final_score or 0) for team in teams}
        metadata = match_metadata[match_id]
        adjusted_scores, adjusted, both_inactive = _adjusted_match(
            teams, records, metadata.result_type
        )
        awarded, outcomes = _apply_result(
            records, teams, adjusted_scores, both_inactive, metadata.result_type
        )
        match_teams = []
        for team, opponent in ((teams[0], teams[1]), (teams[1], teams[0])):
            entry_id = team.team_season_entry_id
            opponent_id = opponent.team_season_entry_id
            record = records[entry_id]
            match_teams.append(
                {
                    "team_id": record["team_id"],
                    "team_season_entry_id": entry_id,
                    "tag": record["tag"],
                    "name": record["name"],
                    "status": record["status"],
                    "original_score": original_scores[entry_id],
                    "original_opponent_score": original_scores[opponent_id],
                    "adjusted_score": adjusted_scores[entry_id],
                    "adjusted_opponent_score": adjusted_scores[opponent_id],
                    "standings_points": awarded[entry_id],
                    "outcome": outcomes[entry_id],
                }
            )
        matches.append(
            {
                "match_id": match_id,
                "match_number": metadata.match_number,
                "label": metadata.match_label,
                "result_type": metadata.result_type,
                "standings_adjusted": adjusted,
                "teams": match_teams,
            }
        )

    ordered = _rank_records(records, matches)
    leaderboard = _player_leaderboard(session, scope, records)
    return {
        "league": league,
        "season": scope.season_code,
        "division": scope.division_code,
        "rules": {
            "win_points": 3,
            "tie_points": 2,
            "close_loss_points": 1,
            "close_loss_max_margin": 20,
            "eligibility_fraction": "2/3",
            "tiebreaks": [
                "overall_record",
                "head_to_head_point_differential",
                "overall_point_differential",
            ],
        },
        "standings": ordered,
        "matches": matches,
        "leaderboard": leaderboard,
        "playoffs": list_playoff_series(
            league_code=league,
            season=scope.season_code,
            division=scope.division_code,
            session=session,
        ),
    }

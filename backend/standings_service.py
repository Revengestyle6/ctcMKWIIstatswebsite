import math
from collections import defaultdict

from analytics_eligibility import analytics_excluded_race_ids
from models import (
    Division,
    DivisionConference,
    DivisionPlayoffConfig,
    Match,
    MatchTeam,
    Player,
    Race,
    RacePlayerResult,
    Team,
    TeamSeasonEntry,
)
from player_dashboard_stats import _team_logo_url
from player_display_names import _display_names_for_players
from player_role_analytics import confirmed_5v5_race_ids, role_coverage, valid_race_score
from sqlalchemy import select
from stats_queries import _get_scope, list_playoff_series

INACTIVE_STATUSES = frozenset({"dropped", "disqualified"})
LEADERBOARD_ROLES = ("runner", "bagger")


def _empty_record(entry, team, logo_url, conference=None):
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
        "conference": (
            {
                "id": conference.division_conference_id,
                "code": conference.conference_code,
                "name": conference.conference_name,
                "sort_order": conference.sort_order,
            }
            if conference
            else None
        ),
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


def _tied_match_metrics(entry_ids, matches, *, cross_conference):
    tied = set(entry_ids)
    metrics = {
        entry_id: {
            "points": 0,
            "wins": 0,
            "ties": 0,
            "losses": 0,
            "differential": 0,
            "series_wins": 0,
            "series_average_differential": 0.0,
        }
        for entry_id in entry_ids
    }
    series = defaultdict(lambda: defaultdict(lambda: {"differential": 0, "matches": 0}))
    for match in matches:
        teams = match["teams"]
        ids = {team["team_season_entry_id"] for team in teams}
        if len(ids) != 2 or not ids.issubset(tied):
            continue
        for team in teams:
            entry_id = team["team_season_entry_id"]
            opponent_id = next(
                candidate["team_season_entry_id"]
                for candidate in teams
                if candidate["team_season_entry_id"] != entry_id
            )
            metric = metrics[entry_id]
            metric["points"] += team["standings_points"]
            outcome_field = {"win": "wins", "tie": "ties", "loss": "losses"}[team["outcome"]]
            metric[outcome_field] += 1
            differential = team["adjusted_score"] - team["adjusted_opponent_score"]
            metric["differential"] += differential
            series[entry_id][opponent_id]["differential"] += differential
            series[entry_id][opponent_id]["matches"] += 1

    if cross_conference:
        for entry_id, opponents in series.items():
            for result in opponents.values():
                if result["differential"] > 0:
                    metrics[entry_id]["series_wins"] += 1
                metrics[entry_id]["series_average_differential"] += (
                    result["differential"] / result["matches"]
                )
    return metrics


def _rank_records(records, matches, *, rank_field="rank", force_general=False):
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
    tie_keys = {}
    for entry_ids in primary_groups.values():
        conference_ids = {
            records[entry_id]["conference"]["id"]
            for entry_id in entry_ids
            if records[entry_id]["conference"] is not None
        }
        cross_conference = not force_general and len(entry_ids) >= 3 and len(conference_ids) > 1
        metrics = _tied_match_metrics(entry_ids, matches, cross_conference=cross_conference)
        for entry_id in entry_ids:
            metric = metrics[entry_id]
            if rank_field == "rank":
                records[entry_id]["head_to_head_differential"] = metric["differential"]
            if cross_conference:
                tie_keys[entry_id] = (
                    metric["series_wins"],
                    metric["series_average_differential"],
                    records[entry_id]["point_differential"],
                )
            else:
                tie_keys[entry_id] = (
                    metric["points"],
                    metric["wins"],
                    metric["ties"],
                    -metric["losses"],
                    metric["differential"],
                    records[entry_id]["point_differential"],
                )
            if rank_field == "rank":
                records[entry_id]["tiebreak"] = {
                    "mode": "cross_conference_series" if cross_conference else "head_to_head",
                    **metric,
                }

    ordered = sorted(
        records.values(),
        key=lambda row: (
            -row["standings_points"],
            -row["wins"],
            -row["ties"],
            row["losses"],
            *(-value for value in tie_keys[row["team_season_entry_id"]]),
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
            tie_keys[record["team_season_entry_id"]],
        )
        if key != prior_key:
            rank = index
            prior_key = key
        record[rank_field] = rank
    return ordered


def _race_equivalent_gps(race_count):
    return race_count / 4


def _role_eligibility(status, role, role_gp_count, required_gps):
    if status in INACTIVE_STATUSES:
        return False, f"Team {status}"
    if required_gps <= 0 or role_gp_count < required_gps:
        return (
            False,
            f"Completed {role_gp_count:g} of {required_gps} required race-equivalent GPs as {role}",
        )
    return True, None


def _role_gp_average(points, role_race_count):
    role_gps = _race_equivalent_gps(role_race_count)
    return round(points / role_gps, 2) if role_gps else None


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
            if role in LEADERBOARD_ROLES:
                data[f"{role}_races"] += 1
        if role in {"runner", "bagger"} and valid_race_score(result.score):
            data[f"{role}_points"] += int(result.score)
        canonical_names[result.player_id] = row.canonical_name

    display_names = _display_names_for_players(session, canonical_names.keys(), canonical_names)
    leaderboard = []
    for data in player_data.values():
        entry_gp_races = team_gp_races[data["team_season_entry_id"]]
        team_gp_count = len(entry_gp_races)
        played_gps = len(data.pop("gp_keys"))
        role_gp_counts = {
            role: _race_equivalent_gps(data[f"{role}_races"]) for role in LEADERBOARD_ROLES
        }
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
                "runner_gp_average": _role_gp_average(data["runner_points"], data["runner_races"]),
                "bagger_gp_average": _role_gp_average(data["bagger_points"], data["bagger_races"]),
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
    division_record = session.get(Division, scope.division_id)
    conference_rows = session.scalars(
        select(DivisionConference)
        .where(DivisionConference.division_id == scope.division_id)
        .order_by(DivisionConference.sort_order)
    ).all()
    conferences_by_id = {
        conference.division_conference_id: conference for conference in conference_rows
    }
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
            entry,
            team,
            _team_logo_url(session, team.team_id, scope.season_id),
            conferences_by_id.get(entry.conference_id),
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
    conference_standings = []
    if division_record.is_conference_based:
        for conference in conference_rows:
            conference_records = {
                entry_id: record
                for entry_id, record in records.items()
                if record["conference"]
                and record["conference"]["id"] == conference.division_conference_id
            }
            ranked = _rank_records(
                conference_records, matches, rank_field="conference_rank", force_general=True
            )
            conference_standings.append(
                {
                    "id": conference.division_conference_id,
                    "code": conference.conference_code,
                    "name": conference.conference_name,
                    "standings": ranked,
                }
            )

    active_ordered = [record for record in ordered if record["status"] not in INACTIVE_STATUSES]
    playoff_config = session.get(DivisionPlayoffConfig, scope.division_id)
    playoff_team_count = playoff_config.playoff_team_count if playoff_config else None
    qualifiers = []
    if division_record.is_conference_based and len(conference_standings) == 2:
        winners = [
            conference["standings"][0]
            for conference in conference_standings
            if conference["standings"]
            and conference["standings"][0]["status"] not in INACTIVE_STATUSES
        ]
        winners = _rank_records(
            {record["team_season_entry_id"]: record for record in winners},
            matches,
            rank_field="playoff_seed_rank",
            force_general=True,
        )
        winner_ids = {record["team_season_entry_id"] for record in winners}
        wildcard_records = {
            record["team_season_entry_id"]: record
            for record in active_ordered
            if record["team_season_entry_id"] not in winner_ids
        }
        wildcards = _rank_records(wildcard_records, matches, rank_field="wildcard_rank")[:2]
        qualifiers = winners[:2] + wildcards
        playoff_team_count = 4
    elif playoff_team_count in {3, 4}:
        qualifiers = active_ordered[:playoff_team_count]
    elif len(active_ordered) in {5, 6}:
        playoff_team_count = 3
        qualifiers = active_ordered[:3]

    qualification = [
        {
            "seed": index,
            "team_id": record["team_id"],
            "team_season_entry_id": record["team_season_entry_id"],
            "tag": record["tag"],
            "name": record["name"],
            "qualification": (
                "conference_winner"
                if division_record.is_conference_based and index <= 2
                else "wild_card"
                if division_record.is_conference_based
                else "league_table"
            ),
        }
        for index, record in enumerate(qualifiers, start=1)
    ]
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
                "standings_points",
                "overall_wdl",
                "points_vs_tied_opponents",
                "wdl_vs_tied_opponents",
                "point_differential_vs_tied_opponents",
                "overall_point_differential",
            ],
            "cross_conference_tiebreaks": [
                "standings_points",
                "overall_wdl",
                "head_to_head_series_wins",
                "sum_of_average_series_differentials",
                "overall_point_differential",
            ],
        },
        "standings": ordered,
        "conferences": conference_standings,
        "conference_config": {
            "enabled": division_record.is_conference_based,
            "valid": (
                not division_record.is_conference_based
                or (
                    len(conference_standings) == 2
                    and len(records) == 8
                    and all(len(item["standings"]) == 4 for item in conference_standings)
                )
            ),
            "same_conference_matches": 2,
            "cross_conference_matches": 1,
        },
        "playoff_qualification": {
            "team_count": playoff_team_count,
            "seeds": qualification,
            "semifinals": (
                [[1, 4], [2, 3]]
                if playoff_team_count == 4
                else [[2, 3]]
                if playoff_team_count == 3
                else []
            ),
        },
        "matches": matches,
        "leaderboard": leaderboard,
        "playoffs": list_playoff_series(
            league_code=league,
            season=scope.season_code,
            division=scope.division_code,
            session=session,
        ),
    }

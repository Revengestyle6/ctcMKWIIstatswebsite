from collections import defaultdict

from analytics_eligibility import apply_analytics_race_filter
from database import get_session_factory
from match_sets import apply_match_set, normalize_match_set
from models import (
    Division,
    Match,
    MatchTeam,
    Player,
    PlayerFriendCode,
    Race,
    RacePlayerResult,
    RaceTeamResult,
    Season,
    Team,
    TeamSeasonEntry,
    Track,
    UnaccountedMatch,
)
from player_dashboard_stats import (
    DashboardError,
    DashboardNotFound,
    _final_score,
    _match_team_rows,
    _record_key,
    _resolve_scope,
    _result,
    _round,
    _scope_payload,
    _team_display_name,
    _team_logo_url,
)
from player_display_names import _display_names_for_players
from player_role_analytics import (
    confirmed_5v5_race_ids,
    normalize_role,
    role_coverage,
    summarize_role_rows,
    valid_race_score,
)
from sqlalchemy import select
from unaccounted_matches import accounted_match_filter, add_aggregate_metrics, aggregate_player_rows

SessionLocal = get_session_factory()
PLACEHOLDER_LOGO = "/media/shared/team-logo-placeholder.svg"


def _team_identity(session, team, scope):
    entry_rows = session.execute(
        select(
            Season.season_id,
            Season.season_code,
            Season.season_number,
            Division.division_code,
            TeamSeasonEntry.display_name,
            TeamSeasonEntry.clan_tag,
            TeamSeasonEntry.hex_color,
            TeamSeasonEntry.competition_status,
            TeamSeasonEntry.competition_status_note,
            TeamSeasonEntry.team_season_entry_id,
        )
        .join(Season, Season.season_id == TeamSeasonEntry.season_id)
        .join(Division, Division.division_id == TeamSeasonEntry.division_id)
        .where(TeamSeasonEntry.team_id == team.team_id)
        .where(Season.league_code == scope.league_code)
    ).all()
    entries = sorted(
        entry_rows,
        key=lambda row: (row.season_number or 0, row.team_season_entry_id),
        reverse=True,
    )
    scoped_entries = [
        row
        for row in entries
        if row.season_id == scope.season_id
        and (scope.division_code is None or row.division_code == scope.division_code)
    ]
    scoped_entry = scoped_entries[0] if len(scoped_entries) == 1 else None
    return {
        "team_id": team.team_id,
        "name": team.canonical_name,
        "tag": team.canonical_tag,
        "display_name": (
            _team_display_name(
                scoped_entry.display_name, scoped_entry.clan_tag, team.canonical_name
            )
            if scoped_entry
            else team.canonical_name
        ),
        "current_entries": [
            {
                "team_season_entry_id": row.team_season_entry_id,
                "name": row.display_name,
                "tag": row.clan_tag,
                "division": row.division_code,
            }
            for row in scoped_entries
        ],
        "current_entry": (
            {
                "season": scoped_entry.season_code,
                "division": scoped_entry.division_code,
                "name": _team_display_name(
                    scoped_entry.display_name, scoped_entry.clan_tag, team.canonical_name
                ),
                "tag": scoped_entry.clan_tag,
                "hex_color": scoped_entry.hex_color,
                "competition_status": scoped_entry.competition_status,
                "competition_status_note": scoped_entry.competition_status_note,
            }
            if scoped_entry
            else None
        ),
        "logo_url": _team_logo_url(
            session,
            team.team_id,
            scope.season_id,
            scoped_entry.team_season_entry_id if scoped_entry else None,
        ),
        "appearances": [
            {
                "team_season_entry_id": row.team_season_entry_id,
                "season": row.season_code,
                "division": row.division_code,
                "name": _team_display_name(row.display_name, row.clan_tag, team.canonical_name),
                "tag": row.clan_tag,
                "hex_color": row.hex_color,
                "competition_status": row.competition_status,
                "competition_status_note": row.competition_status_note,
                "logo_url": _team_logo_url(
                    session, team.team_id, row.season_id, row.team_season_entry_id
                ),
            }
            for row in entries
        ],
    }


def _team_match_rows(session, team_id, scope, match_set="regular", include_unaccounted=False):
    statement = (
        select(
            Match.match_id,
            Match.match_label,
            Match.match_number,
            Match.races_played,
            MatchTeam.match_team_id,
            MatchTeam.final_score,
            MatchTeam.raw_total_score,
            MatchTeam.team_penalty_points,
            Season.season_id,
            Season.season_code,
            Season.season_number,
            Division.division_code,
            TeamSeasonEntry.clan_tag,
            TeamSeasonEntry.team_season_entry_id,
        )
        .join(Match, Match.match_id == MatchTeam.match_id)
        .join(Season, Season.season_id == Match.season_id)
        .join(Division, Division.division_id == Match.division_id)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
        )
        .where(
            TeamSeasonEntry.team_id == team_id,
            Season.league_code == scope.league_code,
        )
    )
    if scope.season_id is not None:
        statement = statement.where(Match.season_id == scope.season_id)
    if scope.division_id is not None:
        statement = statement.where(Match.division_id == scope.division_id)
    statement = accounted_match_filter(apply_match_set(statement, match_set), include_unaccounted)
    return session.execute(statement.order_by(Match.match_id)).all()


def _team_ranking(
    session, team_id, scope, min_races, match_set="regular", include_unaccounted=False
):
    if scope.season_id is None or scope.division_id is None:
        return None
    statement = (
        select(
            Match.match_id,
            Match.races_played,
            MatchTeam.match_team_id,
            MatchTeam.final_score,
            MatchTeam.raw_total_score,
            MatchTeam.team_penalty_points,
            TeamSeasonEntry.team_id,
        )
        .join(MatchTeam, MatchTeam.match_id == Match.match_id)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
        )
        .where(Match.season_id == scope.season_id, Match.division_id == scope.division_id)
    )
    match_rows = session.execute(
        accounted_match_filter(apply_match_set(statement, match_set), include_unaccounted)
    ).all()
    by_match = defaultdict(list)
    for row in match_rows:
        by_match[row.match_id].append(row)
    totals = defaultdict(lambda: {"differential": 0, "races": 0})
    for teams in by_match.values():
        for row in teams:
            opponent_score = max(
                (
                    _final_score(opponent)
                    for opponent in teams
                    if opponent.match_team_id != row.match_team_id
                ),
                default=None,
            )
            if opponent_score is None:
                continue
            totals[row.team_id]["differential"] += _final_score(row) - opponent_score
            totals[row.team_id]["races"] += int(row.races_played or 0)
    values = {
        current_team_id: data["differential"] / data["races"]
        for current_team_id, data in totals.items()
        if data["races"] >= min_races
    }
    target = values.get(team_id)
    if target is None:
        return {"eligible": False, "minimum_races": min_races, "population": len(values)}
    rank = 1 + sum(1 for value in values.values() if value > target)
    return {
        "eligible": True,
        "rank": rank,
        "population": len(values),
        "minimum_races": min_races,
        "metric": "differential_per_race",
        "value": _round(target),
    }


def get_team_overview(
    team_id,
    league="ctc",
    season=None,
    division=None,
    opponent_team_id=None,
    min_races=12,
    match_set="regular",
    session=None,
    include_unaccounted=False,
):
    match_set = normalize_match_set(match_set)
    if session is None:
        with SessionLocal() as owned_session:
            return get_team_overview(
                team_id,
                league=league,
                season=season,
                division=division,
                opponent_team_id=opponent_team_id,
                min_races=min_races,
                match_set=match_set,
                session=owned_session,
                include_unaccounted=include_unaccounted,
            )

    team = session.get(Team, team_id)
    if not team:
        raise DashboardNotFound("Team not found.")
    scope = _resolve_scope(session, league=league, season=season, division=division)
    if opponent_team_id is not None:
        if not session.get(Team, opponent_team_id):
            raise DashboardError("Unknown opponent filter.")

    rows = _team_match_rows(session, team_id, scope, match_set, include_unaccounted)
    match_ids = [row.match_id for row in rows]
    unaccounted_ids = set(
        session.scalars(
            select(UnaccountedMatch.match_id).where(UnaccountedMatch.match_id.in_(match_ids))
        )
    )
    teams_by_match = defaultdict(list)
    for row in _match_team_rows(session, match_ids):
        teams_by_match[row.match_id].append(row)

    matches = []
    for row in rows:
        opponents = [
            candidate
            for candidate in teams_by_match[row.match_id]
            if candidate.match_team_id != row.match_team_id
        ]
        if opponent_team_id is not None and not any(
            candidate.team_id == opponent_team_id for candidate in opponents
        ):
            continue
        own_final = _final_score(row)
        opponent_final = max((_final_score(candidate) for candidate in opponents), default=None)
        match_result = _result(own_final, opponent_final)
        matches.append(
            {
                "match_id": row.match_id,
                "match_team_id": row.match_team_id,
                "team_season_entry_id": row.team_season_entry_id,
                "team_tag": row.clan_tag,
                "label": row.match_label,
                "score_source": "unaccounted" if row.match_id in unaccounted_ids else "accounted",
                "season": row.season_code,
                "season_number": row.season_number,
                "division": row.division_code,
                "match_number": row.match_number,
                "races": int(row.races_played or 0),
                "score": own_final,
                "opponent_score": opponent_final,
                "differential": own_final - opponent_final if opponent_final is not None else None,
                "penalties": int(row.team_penalty_points or 0),
                "result": match_result,
                "opponents": [
                    {
                        "team_id": candidate.team_id,
                        "team_season_entry_id": candidate.team_season_entry_id,
                        "name": _team_display_name(
                            candidate.display_name,
                            candidate.clan_tag,
                            candidate.canonical_name,
                        ),
                        "tag": candidate.clan_tag,
                        "score": _final_score(candidate),
                    }
                    for candidate in opponents
                ],
            }
        )
    matches.sort(
        key=lambda item: (
            item["season_number"] or 0,
            item["match_number"] or 0,
            item["match_id"],
        ),
        reverse=True,
    )

    record = {"wins": 0, "losses": 0, "ties": 0, "unknown": 0}
    for row in matches:
        record[_record_key(row["result"])] += 1
    scores = [row["score"] for row in matches if row["score"] is not None]
    differentials = [row["differential"] for row in matches if row["differential"] is not None]
    wins = [row for row in matches if row["result"] == "win"]
    losses = [row for row in matches if row["result"] == "loss"]
    resolved_matches = record["wins"] + record["losses"] + record["ties"]

    return {
        "identity": _team_identity(session, team, scope),
        "scope": {
            **_scope_payload(scope),
            "opponent_team_id": opponent_team_id,
            "match_set": match_set,
            "include_unaccounted": include_unaccounted,
        },
        "metrics": {
            "matches": len(matches),
            "unaccounted_matches": sum(row["match_id"] in unaccounted_ids for row in matches),
            "races": sum(row["races"] for row in matches),
            "average_final_score": _round(sum(scores) / len(scores)) if scores else None,
            "average_differential": _round(sum(differentials) / len(differentials))
            if differentials
            else None,
            "total_penalties": sum(row["penalties"] for row in matches),
            "penalties_per_match": _round(sum(row["penalties"] for row in matches) / len(matches))
            if matches
            else None,
            "win_rate": _round(record["wins"] / resolved_matches * 100)
            if resolved_matches
            else None,
            "best_win": max(wins, key=lambda item: item["differential"])["differential"]
            if wins
            else None,
            "closest_match": min(differentials, key=abs) if differentials else None,
            "largest_loss": min((row["differential"] for row in losses), default=None),
        },
        "record": record,
        "ranking": _team_ranking(
            session, team_id, scope, min_races, match_set, include_unaccounted
        ),
        "recent_matches": matches[:5],
        "score_trend": [
            {
                "match_id": row["match_id"],
                "match_team_id": row["match_team_id"],
                "team_tag": row["team_tag"],
                "label": row["label"],
                "differential": row["differential"],
            }
            for row in reversed(matches[:10])
        ],
    }


def _filtered_team_match_ids(
    session, team_id, scope, opponent_team_id=None, match_set="regular", include_unaccounted=False
):
    rows = _team_match_rows(session, team_id, scope, match_set, include_unaccounted)
    match_ids = list({row.match_id for row in rows})
    if opponent_team_id is None or not match_ids:
        return match_ids
    teams_by_match = defaultdict(list)
    for candidate in _match_team_rows(session, match_ids):
        teams_by_match[candidate.match_id].append(candidate)
    return list(
        {
            row.match_id
            for row in rows
            if any(
                candidate.match_team_id != row.match_team_id
                and candidate.team_id == opponent_team_id
                for candidate in teams_by_match[row.match_id]
            )
        }
    )


def _bulk_bagger_counterpart_summaries(session, classified_rows, confirmed_ids):
    candidate_players_by_race = defaultdict(set)
    for row, classified_role, _source in classified_rows:
        if classified_role == "bagger":
            candidate_players_by_race[row.race_id].add(row.player_id)

    empty_summary = {
        "counterpart_races": 0,
        "opponent_points_for": 0,
        "opponent_points_against": 0,
        "opponent_point_differential": 0,
    }
    player_ids = {
        player_id
        for race_players in candidate_players_by_race.values()
        for player_id in race_players
    }
    summaries = {player_id: dict(empty_summary) for player_id in player_ids}
    candidate_race_ids = set(candidate_players_by_race)
    if not candidate_race_ids:
        return summaries

    all_rows = list(
        session.scalars(
            select(RacePlayerResult).where(RacePlayerResult.race_id.in_(candidate_race_ids))
        )
    )
    _, all_classified = role_coverage(all_rows, confirmed_ids)
    by_race = defaultdict(list)
    for item in all_classified:
        by_race[item[0].race_id].append(item)

    for race_id, selected_player_ids in candidate_players_by_race.items():
        race_rows = by_race[race_id]
        if len({row.match_team_id for row, _role, _source in race_rows}) != 2:
            continue
        baggers_by_team = defaultdict(list)
        for row, classified_role, _source in race_rows:
            if classified_role == "bagger":
                baggers_by_team[row.match_team_id].append(row)
        if len(baggers_by_team) != 2 or any(
            len(team_baggers) != 1 for team_baggers in baggers_by_team.values()
        ):
            continue

        baggers = [team_baggers[0] for team_baggers in baggers_by_team.values()]
        for player_id in selected_player_ids:
            selected = [row for row in baggers if row.player_id == player_id]
            if len(selected) != 1:
                continue
            opponent = next(row for row in baggers if row is not selected[0])
            if not valid_race_score(selected[0].score) or not valid_race_score(opponent.score):
                continue
            summary = summaries[player_id]
            summary["counterpart_races"] += 1
            summary["opponent_points_for"] += selected[0].score
            summary["opponent_points_against"] += opponent.score

    for summary in summaries.values():
        summary["opponent_point_differential"] = (
            summary["opponent_points_for"] - summary["opponent_points_against"]
        )
    return summaries


def _roster_appearance(row):
    return {
        "match_id": row.match_id,
        "season": row.season_code,
        "division": row.division_code,
        "match_number": row.match_number,
        "score_source": "unaccounted" if getattr(row, "entry_mode", None) else "accounted",
    }


def get_team_roster(
    team_id,
    league="ctc",
    season=None,
    division=None,
    opponent_team_id=None,
    min_races=12,
    role="runner",
    match_set="regular",
    session=None,
    include_unaccounted=False,
    team_season_entry_id=None,
):
    role = normalize_role(role)
    match_set = normalize_match_set(match_set)
    if session is None:
        with SessionLocal() as owned_session:
            return get_team_roster(
                team_id,
                league=league,
                season=season,
                division=division,
                opponent_team_id=opponent_team_id,
                min_races=min_races,
                role=role,
                match_set=match_set,
                team_season_entry_id=team_season_entry_id,
                session=owned_session,
                include_unaccounted=include_unaccounted,
            )
    if not session.get(Team, team_id):
        raise DashboardNotFound("Team not found.")
    scope = _resolve_scope(session, league=league, season=season, division=division)
    if opponent_team_id is not None:
        if not session.get(Team, opponent_team_id):
            raise DashboardError("Unknown opponent filter.")
    match_ids = _filtered_team_match_ids(
        session, team_id, scope, opponent_team_id, match_set, include_unaccounted
    )
    if not match_ids:
        empty_coverage, _ = role_coverage([], set())
        return {
            "team_id": team_id,
            "role": role,
            "scope": {
                **_scope_payload(scope),
                "opponent_team_id": opponent_team_id,
                "match_set": match_set,
                "include_unaccounted": include_unaccounted,
            },
            "minimum_races": min_races,
            "role_coverage": empty_coverage,
            "players": [],
        }

    statement = (
        select(
            RacePlayerResult.player_id,
            RacePlayerResult.race_id,
            RacePlayerResult.match_team_id,
            RacePlayerResult.score,
            RacePlayerResult.position,
            RacePlayerResult.role,
            RacePlayerResult.role_source,
            Race.race_number,
            Match.match_id,
            Match.match_label,
            Match.format,
            Match.match_number,
            Season.season_code,
            Season.season_number,
            Division.division_code,
            Player.canonical_name,
        )
        .join(Race, Race.race_id == RacePlayerResult.race_id)
        .join(Match, Match.match_id == Race.match_id)
        .join(Season, Season.season_id == Match.season_id)
        .join(Division, Division.division_id == Match.division_id)
        .join(MatchTeam, MatchTeam.match_team_id == RacePlayerResult.match_team_id)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
        )
        .join(Player, Player.player_id == RacePlayerResult.player_id)
        .where(
            Match.match_id.in_(match_ids),
            TeamSeasonEntry.team_id == team_id,
        )
        .order_by(Season.season_number, Match.match_number, Match.match_id, Race.race_number)
    )
    if team_season_entry_id is not None:
        statement = statement.where(TeamSeasonEntry.team_season_entry_id == team_season_entry_id)
    statement = apply_analytics_race_filter(statement, session)
    rows = session.execute(statement).all()
    confirmed = confirmed_5v5_race_ids(session, rows)
    coverage, classified = role_coverage(rows, confirmed)
    all_by_player = defaultdict(list)
    by_player = defaultdict(lambda: {"classified": []})
    for item in classified:
        row, classified_role, _source = item
        all_by_player[row.player_id].append(item)
        if classified_role != role:
            continue
        by_player[row.player_id]["classified"].append(item)

    aggregates = (
        aggregate_player_rows(
            session,
            scope,
            match_set,
            team_id=team_id,
            match_ids=match_ids,
            team_season_entry_id=team_season_entry_id,
        )
        if include_unaccounted
        else []
    )
    aggregate_by_player = defaultdict(list)
    for row in aggregates:
        aggregate_by_player[row.player_id].append(row)
        if row.UnaccountedPlayerScore.role == role and row.UnaccountedPlayerScore.races:
            by_player[row.player_id]
    display_names = _display_names_for_players(
        session,
        by_player,
        {row.player_id: row.canonical_name for row in [*rows, *aggregates] if row.canonical_name},
    )

    counterpart_summaries = (
        _bulk_bagger_counterpart_summaries(session, classified, confirmed)
        if role == "bagger"
        else {}
    )

    player_ids = list(by_player)
    codes_by_player = defaultdict(list)
    for row in session.execute(
        select(PlayerFriendCode.player_id, PlayerFriendCode.friend_code)
        .where(PlayerFriendCode.player_id.in_(player_ids))
        .order_by(PlayerFriendCode.friend_code)
    ).all():
        codes_by_player[row.player_id].append(row.friend_code)

    players = []
    for player_id, data in by_player.items():
        player_rows = [row for row, _role, _source in data["classified"]]
        metrics = add_aggregate_metrics(
            summarize_role_rows(data["classified"], role), aggregate_by_player[player_id], role
        )
        if metrics["scored_races"] < min_races:
            continue
        if role == "bagger":
            metrics.update(
                counterpart_summaries.get(
                    player_id,
                    {
                        "counterpart_races": 0,
                        "opponent_points_for": 0,
                        "opponent_points_against": 0,
                        "opponent_point_differential": 0,
                    },
                )
            )
        player_coverage, _ = role_coverage(
            [item[0] for item in all_by_player[player_id]], confirmed
        )
        ordered = sorted(
            [*player_rows, *aggregate_by_player[player_id]],
            key=lambda row: (
                row.season_number or 0,
                row.match_number or 0,
                row.match_id,
                getattr(row, "race_number", 0),
            ),
        )
        first = ordered[0]
        last = ordered[-1]
        players.append(
            {
                "player_id": player_id,
                "name": display_names.get(player_id) or f"Player {player_id}",
                "friend_codes": codes_by_player[player_id],
                "matches": len(
                    {row.match_id for row in [*player_rows, *aggregate_by_player[player_id]]}
                ),
                "metrics": metrics,
                "role_coverage": player_coverage,
                "first_appearance": _roster_appearance(first),
                "last_appearance": _roster_appearance(last),
            }
        )
    sort_metric = "twelve_race_pace" if role == "runner" else "points_per_race"
    players.sort(
        key=lambda row: (
            row["metrics"][sort_metric] is None,
            -(row["metrics"][sort_metric] or 0),
            -row["metrics"]["races"],
            row["name"].lower(),
        )
    )
    return {
        "team_id": team_id,
        "role": role,
        "scope": {
            **_scope_payload(scope),
            "opponent_team_id": opponent_team_id,
            "match_set": match_set,
            "include_unaccounted": include_unaccounted,
        },
        "minimum_races": min_races,
        "role_coverage": coverage,
        "players": players,
    }


def get_team_tracks(
    team_id,
    league="ctc",
    season=None,
    division=None,
    opponent_team_id=None,
    min_races=12,
    match_set="regular",
    session=None,
):
    match_set = normalize_match_set(match_set)
    if session is None:
        with SessionLocal() as owned_session:
            return get_team_tracks(
                team_id,
                league=league,
                season=season,
                division=division,
                opponent_team_id=opponent_team_id,
                min_races=min_races,
                match_set=match_set,
                session=owned_session,
            )
    if not session.get(Team, team_id):
        raise DashboardNotFound("Team not found.")
    scope = _resolve_scope(session, league=league, season=season, division=division)
    if opponent_team_id is not None and not session.get(Team, opponent_team_id):
        raise DashboardError("Unknown opponent filter.")
    match_ids = _filtered_team_match_ids(session, team_id, scope, opponent_team_id, match_set)
    if not match_ids:
        return {
            "team_id": team_id,
            "scope": {
                **_scope_payload(scope),
                "opponent_team_id": opponent_team_id,
                "match_set": match_set,
            },
            "minimum_races": min_races,
            "tracks": [],
        }

    statement = (
        select(
            Race.race_id,
            Race.track_id,
            Track.canonical_name.label("track_name"),
            MatchTeam.match_team_id,
        )
        .join(Match, Match.match_id == Race.match_id)
        .join(Track, Track.track_id == Race.track_id)
        .join(MatchTeam, MatchTeam.match_id == Match.match_id)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
        )
        .where(Match.match_id.in_(match_ids), TeamSeasonEntry.team_id == team_id)
        .order_by(Race.race_id)
    )
    statement = apply_analytics_race_filter(statement, session)
    own_rows = session.execute(statement).all()
    race_ids = [row.race_id for row in own_rows]
    totals = defaultdict(int)
    for row in session.execute(
        select(
            RacePlayerResult.race_id,
            RacePlayerResult.match_team_id,
            RacePlayerResult.score,
        ).where(
            RacePlayerResult.race_id.in_(race_ids),
            RacePlayerResult.score.between(0, 15),
        )
    ).all():
        totals[(row.race_id, row.match_team_id)] += int(row.score)
    for row in session.execute(
        select(RaceTeamResult.race_id, RaceTeamResult.match_team_id, RaceTeamResult.score).where(
            RaceTeamResult.race_id.in_(race_ids)
        )
    ).all():
        totals[(row.race_id, row.match_team_id)] += int(row.score)

    match_teams_by_race = defaultdict(set)
    race_match_teams = session.execute(
        select(Race.race_id, MatchTeam.match_team_id)
        .join(MatchTeam, MatchTeam.match_id == Race.match_id)
        .where(Race.race_id.in_(race_ids))
    ).all()
    for row in race_match_teams:
        match_teams_by_race[row.race_id].add(row.match_team_id)

    tracks = defaultdict(lambda: {"name": "", "scores": [], "wins": 0, "ties": 0})
    for row in own_rows:
        own_score = totals[(row.race_id, row.match_team_id)]
        opponent_scores = [
            totals[(row.race_id, match_team_id)]
            for match_team_id in match_teams_by_race[row.race_id]
            if match_team_id != row.match_team_id
        ]
        opponent_score = max(opponent_scores, default=None)
        track = tracks[row.track_id]
        track["name"] = row.track_name
        track["scores"].append(own_score)
        if opponent_score is not None and own_score > opponent_score:
            track["wins"] += 1
        elif opponent_score is not None and own_score == opponent_score:
            track["ties"] += 1

    results = []
    for track_id, track in tracks.items():
        scores = track["scores"]
        if len(scores) < min_races:
            continue
        results.append(
            {
                "track_id": track_id,
                "name": track["name"],
                "races": len(scores),
                "average_score": _round(sum(scores) / len(scores)),
                "wins": track["wins"],
                "ties": track["ties"],
                "win_rate": _round(track["wins"] / len(scores) * 100),
            }
        )
    results.sort(key=lambda row: (-row["average_score"], -row["races"], row["name"].lower()))
    return {
        "team_id": team_id,
        "scope": {
            **_scope_payload(scope),
            "opponent_team_id": opponent_team_id,
            "match_set": match_set,
        },
        "minimum_races": min_races,
        "tracks": results,
    }

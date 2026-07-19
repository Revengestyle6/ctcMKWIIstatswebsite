from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import desc, select

from analytics_eligibility import apply_analytics_race_filter
from database import get_session_factory
from player_display_names import _display_names_for_players
from models import (
    Division,
    Match,
    MatchTeam,
    Player,
    PlayerAlias,
    PlayerFriendCode,
    PlayerSeasonEntry,
    Race,
    RacePlayerResult,
    RaceTeamResult,
    Season,
    Team,
    TeamLogo,
    TeamSeasonEntry,
    Track,
)
from player_role_analytics import (
    bagger_counterpart_summary,
    confirmed_5v5_race_ids,
    normalize_role,
    role_coverage,
    summarize_role_rows,
    valid_placement,
    valid_race_score,
)


SessionLocal = get_session_factory()
PLACEHOLDER_LOGO = "/images/team-logos/placeholder.webp"


class DashboardError(ValueError):
    status_code = 400


class DashboardNotFound(DashboardError):
    status_code = 404


@dataclass(frozen=True)
class DashboardScope:
    season_id: int | None
    season_code: str | None
    season_number: int | None
    division_id: int | None
    division_code: str | None


def _normalize_code(value, prefix):
    if value is None or str(value).strip() == "":
        return None
    code = str(value).strip().lower()
    return code if code.startswith(prefix) else f"{prefix}{code}"


def _resolve_scope(session, season=None, division=None):
    season_code = _normalize_code(season, "s")
    division_code = _normalize_code(division, "d")
    if division_code and not season_code:
        raise DashboardError("Division requires a season.")

    if not season_code:
        return DashboardScope(None, None, None, None, None)

    season_row = session.execute(
        select(Season.season_id, Season.season_code, Season.season_number).where(
            Season.league_code == "ctc",
            Season.season_code == season_code,
        )
    ).first()
    if not season_row:
        raise DashboardError(f"Unknown season: {season_code}")

    if not division_code:
        return DashboardScope(
            season_row.season_id,
            season_row.season_code,
            season_row.season_number,
            None,
            None,
        )

    division_row = session.execute(
        select(Division.division_id, Division.division_code).where(
            Division.season_id == season_row.season_id,
            Division.division_code == division_code,
        )
    ).first()
    if not division_row:
        raise DashboardError(f"Unknown division for {season_code}: {division_code}")

    return DashboardScope(
        season_row.season_id,
        season_row.season_code,
        season_row.season_number,
        division_row.division_id,
        division_row.division_code,
    )


def _scope_payload(scope):
    return {
        "season": scope.season_code,
        "division": scope.division_code,
    }


def _round(value, digits=2):
    return round(float(value), digits) if value is not None else None


def _result(own_score, opponent_score):
    if own_score is None or opponent_score is None:
        return "unknown"
    if own_score > opponent_score:
        return "win"
    if own_score < opponent_score:
        return "loss"
    return "tie"


def _record_key(result):
    return {
        "win": "wins",
        "loss": "losses",
        "tie": "ties",
        "unknown": "unknown",
    }[result]


def _asset_url(asset_path):
    normalized = (asset_path or "").strip().lstrip("/")
    if not normalized.startswith("images/team-logos/"):
        return PLACEHOLDER_LOGO
    return f"/{normalized}"


def _team_logo_url(session, team_id, season_id=None):
    base = select(TeamLogo.asset_path).where(
        TeamLogo.team_id == team_id,
        TeamLogo.is_active.is_(True),
    )
    if season_id is not None:
        season_asset = session.scalar(
            base.where(TeamLogo.season_id == season_id)
            .order_by(desc(TeamLogo.priority), desc(TeamLogo.team_logo_id))
            .limit(1)
        )
        if season_asset:
            return _asset_url(season_asset)

    default_asset = session.scalar(
        base.where(TeamLogo.season_id.is_(None))
        .order_by(desc(TeamLogo.priority), desc(TeamLogo.team_logo_id))
        .limit(1)
    )
    return _asset_url(default_asset) if default_asset else PLACEHOLDER_LOGO


def _player_identity(session, player):
    codes = list(session.scalars(
        select(PlayerFriendCode.friend_code)
        .where(PlayerFriendCode.player_id == player.player_id)
        .order_by(PlayerFriendCode.friend_code)
    ))
    alias_rows = session.execute(
        select(
            PlayerAlias.alias_type,
            PlayerAlias.alias_value,
            PlayerAlias.last_seen_match_id,
            PlayerAlias.player_alias_id,
        )
        .where(PlayerAlias.player_id == player.player_id)
        .order_by(PlayerAlias.alias_type, PlayerAlias.alias_value)
    ).all()
    aliases = defaultdict(list)
    for row in alias_rows:
        if row.alias_value not in aliases[row.alias_type]:
            aliases[row.alias_type].append(row.alias_value)

    entry_rows = session.execute(
        select(
            Season.season_id,
            Season.season_code,
            Season.season_number,
            Division.division_code,
            Team.team_id,
            Team.canonical_name,
            TeamSeasonEntry.display_name,
            TeamSeasonEntry.clan_tag,
            PlayerSeasonEntry.flag,
            PlayerSeasonEntry.first_seen_match_id,
            PlayerSeasonEntry.last_seen_match_id,
            PlayerSeasonEntry.player_season_entry_id,
        )
        .join(Season, Season.season_id == PlayerSeasonEntry.season_id)
        .join(Division, Division.division_id == PlayerSeasonEntry.division_id)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == PlayerSeasonEntry.team_season_entry_id,
        )
        .join(Team, Team.team_id == TeamSeasonEntry.team_id)
        .where(PlayerSeasonEntry.player_id == player.player_id)
    ).all()
    entries = sorted(
        entry_rows,
        key=lambda row: (
            row.season_number or 0,
            row.last_seen_match_id or 0,
            row.player_season_entry_id,
        ),
        reverse=True,
    )
    latest = entries[0] if entries else None

    recent_lounge_alias = max(
        (row for row in alias_rows if row.alias_type == "lounge_name"),
        key=lambda row: (row.last_seen_match_id or 0, row.player_alias_id),
        default=None,
    )
    display_name = (
        player.canonical_lounge_name
        or (recent_lounge_alias.alias_value if recent_lounge_alias else None)
        or next((row.alias_value for row in alias_rows if row.alias_type == "table_name"), None)
        or next((row.alias_value for row in alias_rows if row.alias_type == "mii_name"), None)
        or f"Player {player.player_id}"
    )

    return {
        "player_id": player.player_id,
        "name": display_name,
        "canonical_lounge_name": player.canonical_lounge_name,
        "primary_friend_code": player.primary_friend_code,
        "friend_codes": codes,
        "aliases": dict(aliases),
        "flag": latest.flag if latest else None,
        "current_team": (
            {
                "team_id": latest.team_id,
                "name": latest.display_name or latest.canonical_name,
                "tag": latest.clan_tag,
                "season": latest.season_code,
                "division": latest.division_code,
                "logo_url": _team_logo_url(session, latest.team_id, latest.season_id),
            }
            if latest
            else None
        ),
        "appearances": [
            {
                "season": row.season_code,
                "division": row.division_code,
                "team_id": row.team_id,
                "team_name": row.display_name or row.canonical_name,
                "team_tag": row.clan_tag,
                "first_seen_match_id": row.first_seen_match_id,
                "last_seen_match_id": row.last_seen_match_id,
            }
            for row in entries
        ],
    }


def _player_race_rows(session, player_id, scope, team_id=None):
    statement = (
        select(
            RacePlayerResult.race_id,
            RacePlayerResult.match_team_id,
            RacePlayerResult.score,
            RacePlayerResult.position,
            RacePlayerResult.role,
            RacePlayerResult.role_source,
            Race.race_number,
            Track.track_id,
            Track.canonical_name.label("track_name"),
            Match.match_id,
            Match.match_label,
            Match.format,
            Match.week_number,
            Match.races_played,
            Season.season_id,
            Season.season_code,
            Season.season_number,
            Division.division_code,
            Team.team_id,
            Team.canonical_name.label("team_name"),
            TeamSeasonEntry.clan_tag,
        )
        .join(Race, Race.race_id == RacePlayerResult.race_id)
        .join(Track, Track.track_id == Race.track_id)
        .join(Match, Match.match_id == Race.match_id)
        .join(Season, Season.season_id == Match.season_id)
        .join(Division, Division.division_id == Match.division_id)
        .join(MatchTeam, MatchTeam.match_team_id == RacePlayerResult.match_team_id)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
        )
        .join(Team, Team.team_id == TeamSeasonEntry.team_id)
        .where(RacePlayerResult.player_id == player_id)
    )
    if scope.season_id is not None:
        statement = statement.where(Match.season_id == scope.season_id)
    if scope.division_id is not None:
        statement = statement.where(Match.division_id == scope.division_id)
    if team_id is not None:
        statement = statement.where(Team.team_id == team_id)
    statement = apply_analytics_race_filter(statement, session)
    return session.execute(statement.order_by(Match.match_id, Race.race_number)).all()


def _match_team_rows(session, match_ids):
    if not match_ids:
        return []
    return session.execute(
        select(
            MatchTeam.match_id,
            MatchTeam.match_team_id,
            MatchTeam.final_score,
            MatchTeam.raw_total_score,
            MatchTeam.team_penalty_points,
            Team.team_id,
            Team.canonical_name,
            TeamSeasonEntry.display_name,
            TeamSeasonEntry.clan_tag,
        )
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
        )
        .join(Team, Team.team_id == TeamSeasonEntry.team_id)
        .where(MatchTeam.match_id.in_(match_ids))
        .order_by(MatchTeam.match_id, MatchTeam.match_team_id)
    ).all()


def _final_score(row):
    if row.final_score is not None:
        return int(row.final_score)
    return int(row.raw_total_score or 0) - int(row.team_penalty_points or 0)


def _player_ranking(session, player_id, scope, min_races, role, team_id=None):
    if scope.season_id is None or scope.division_id is None:
        return None
    statement = (
        select(
            RacePlayerResult.player_id,
            RacePlayerResult.race_id,
            RacePlayerResult.match_team_id,
            RacePlayerResult.score,
            RacePlayerResult.position,
            RacePlayerResult.role,
            RacePlayerResult.role_source,
        )
        .join(Race, Race.race_id == RacePlayerResult.race_id)
        .join(Match, Match.match_id == Race.match_id)
        .join(MatchTeam, MatchTeam.match_team_id == RacePlayerResult.match_team_id)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
        )
        .where(
            Match.season_id == scope.season_id,
            Match.division_id == scope.division_id,
        )
    )
    if team_id is not None:
        statement = statement.where(TeamSeasonEntry.team_id == team_id)
    statement = apply_analytics_race_filter(statement, session)
    rows = list(session.execute(statement).all())
    confirmed = confirmed_5v5_race_ids(session, rows)
    _, classified = role_coverage(rows, confirmed)
    by_player = defaultdict(list)
    for classified_row in classified:
        by_player[classified_row[0].player_id].append(classified_row)

    values = {}
    for current_player_id, player_rows in by_player.items():
        metrics = summarize_role_rows(player_rows, role)
        if metrics["scored_races"] < min_races:
            continue
        multiplier = 12 if role == "runner" else 1
        values[current_player_id] = (
            metrics["total_points"] / metrics["scored_races"] * multiplier
        )
    target = values.get(player_id)
    if target is None:
        return {"eligible": False, "minimum_races": min_races, "population": len(values)}
    rank = 1 + sum(1 for value in values.values() if value > target)
    return {
        "eligible": True,
        "rank": rank,
        "population": len(values),
        "minimum_races": min_races,
        "metric": "12_race_pace" if role == "runner" else "bagger_points_per_race",
        "value": _round(target),
    }


def get_player_overview(
    player_id,
    season=None,
    division=None,
    team_id=None,
    min_races=12,
    role="runner",
    session=None,
):
    role = normalize_role(role)
    if session is None:
        with SessionLocal() as owned_session:
            return get_player_overview(
                player_id,
                season=season,
                division=division,
                team_id=team_id,
                min_races=min_races,
                role=role,
                session=owned_session,
            )

    player = session.get(Player, player_id)
    if not player:
        raise DashboardNotFound("Player not found.")
    scope = _resolve_scope(session, season=season, division=division)
    if team_id is not None and not session.get(Team, team_id):
        raise DashboardError("Unknown team filter.")

    rows = _player_race_rows(session, player_id, scope, team_id=team_id)
    confirmed = confirmed_5v5_race_ids(session, rows)
    coverage, classified = role_coverage(rows, confirmed)
    selected = [item for item in classified if item[1] == role]
    metrics = summarize_role_rows(classified, role)
    if role == "bagger":
        metrics.update(bagger_counterpart_summary(session, player_id, classified))

    match_groups = defaultdict(list)
    for row in rows:
        match_groups[row.match_id].append(row)
    selected_by_match = defaultdict(list)
    for row, _classified_role, _source in selected:
        selected_by_match[row.match_id].append(row)
    match_ids = list(match_groups)
    teams_by_match = defaultdict(list)
    for row in _match_team_rows(session, match_ids):
        teams_by_match[row.match_id].append(row)

    recent_matches = []
    match_scores = []
    for match_id, match_rows in match_groups.items():
        first = match_rows[0]
        role_rows = selected_by_match[match_id]
        valid_scores = [row.score for row in role_rows if valid_race_score(row.score)]
        player_score = sum(valid_scores) if valid_scores else None
        excluded_score_rows = sum(
            1
            for row in role_rows
            if row.score is not None and not valid_race_score(row.score)
        )
        own_team = next(
            (team for team in teams_by_match[match_id] if team.match_team_id == first.match_team_id),
            None,
        )
        opponents = [team for team in teams_by_match[match_id] if not own_team or team.match_team_id != own_team.match_team_id]
        own_final = _final_score(own_team) if own_team else None
        opponent_final = max((_final_score(team) for team in opponents), default=None)
        match_result = _result(own_final, opponent_final)
        recent_matches.append({
            "match_id": match_id,
            "label": first.match_label,
            "season": first.season_code,
            "season_number": first.season_number,
            "division": first.division_code,
            "week": first.week_number,
            "team": {
                "team_id": first.team_id,
                "name": first.team_name,
                "tag": first.clan_tag,
                "score": own_final,
            },
            "opponents": [
                {
                    "team_id": team.team_id,
                    "name": team.display_name or team.canonical_name,
                    "tag": team.clan_tag,
                    "score": _final_score(team),
                }
                for team in opponents
            ],
            "result": match_result,
            "player_score": player_score,
            "role_races": len({row.race_id for row in role_rows}),
            "scored_role_races": len(valid_scores),
            "excluded_score_rows": excluded_score_rows,
        })
        if player_score is not None:
            match_scores.append(player_score)

    recent_matches.sort(
        key=lambda row: (row["season_number"] or 0, row["week"] or 0, row["match_id"]),
        reverse=True,
    )

    gp_scores = []
    for match_rows in selected_by_match.values():
        gp_groups = defaultdict(list)
        for row in match_rows:
            gp_groups[(int(row.race_number) - 1) // 4].append(row)
        for gp_index, gp_rows in gp_groups.items():
            expected = set(range(gp_index * 4 + 1, gp_index * 4 + 5))
            race_numbers = {int(row.race_number) for row in gp_rows if valid_race_score(row.score)}
            if race_numbers == expected:
                gp_scores.append(sum(row.score for row in gp_rows if valid_race_score(row.score)))

    record = {"wins": 0, "losses": 0, "ties": 0, "unknown": 0}
    for row in recent_matches:
        record[_record_key(row["result"])] += 1

    identity = _player_identity(session, player)
    metrics.update({
        "matches": len(match_groups),
        "seasons": len({row.season_id for row in rows}),
        "teams": len({row.team_id for row in rows}),
        "best_match_score": max(match_scores, default=None),
        "best_gp_score": max(gp_scores, default=None),
    })
    return {
        "identity": identity,
        "role": role,
        "scope": {**_scope_payload(scope), "team_id": team_id},
        "metrics": metrics,
        "role_coverage": coverage,
        "record": record,
        "ranking": _player_ranking(
            session, player_id, scope, min_races, role, team_id=team_id
        ),
        "recent_matches": recent_matches[:5],
        "score_trend": [
            {
                "match_id": row["match_id"],
                "label": row["label"],
                "score": row["player_score"],
                "role_races": row["role_races"],
                "scored_role_races": row["scored_role_races"],
                "excluded_score_rows": row["excluded_score_rows"],
            }
            for row in reversed(recent_matches[:10])
        ],
    }


def get_player_performance(
    player_id, season=None, division=None, team_id=None, role="runner", session=None
):
    role = normalize_role(role)
    if session is None:
        with SessionLocal() as owned_session:
            return get_player_performance(
                player_id,
                season=season,
                division=division,
                team_id=team_id,
                role=role,
                session=owned_session,
            )
    if not session.get(Player, player_id):
        raise DashboardNotFound("Player not found.")
    scope = _resolve_scope(session, season=season, division=division)
    if team_id is not None and not session.get(Team, team_id):
        raise DashboardError("Unknown team filter.")
    rows = _player_race_rows(session, player_id, scope, team_id=team_id)
    confirmed = confirmed_5v5_race_ids(session, rows)
    coverage, classified = role_coverage(rows, confirmed)
    selected_rows = [row for row, classified_role, _source in classified if classified_role == role]
    metrics = summarize_role_rows(classified, role)
    if role == "bagger":
        metrics.update(bagger_counterpart_summary(session, player_id, classified))

    score_distribution = defaultdict(int)
    placement_distribution = defaultdict(int)
    by_race_number = defaultdict(list)
    by_gp_number = defaultdict(list)
    for row in selected_rows:
        if valid_race_score(row.score):
            score_distribution[row.score] += 1
            by_race_number[int(row.race_number)].append(row.score)
            by_gp_number[((int(row.race_number) - 1) // 4) + 1].append(row.score)
        if valid_placement(row.position):
            placement_distribution[int(row.position)] += 1

    return {
        "player_id": player_id,
        "role": role,
        "scope": {**_scope_payload(scope), "team_id": team_id},
        "metrics": metrics,
        "role_coverage": coverage,
        "score_distribution": [
            {"score": score, "races": races}
            for score, races in sorted(score_distribution.items())
        ],
        "placement_distribution": [
            {"position": position, "races": races}
            for position, races in sorted(placement_distribution.items())
        ],
        "by_race_number": [
            {
                "race_number": race_number,
                "average": _round(sum(scores) / len(scores)),
                "races": len(scores),
            }
            for race_number, scores in sorted(by_race_number.items())
        ],
        "by_gp_number": [
            {
                "gp_number": gp_number,
                "average": _round(sum(scores) / len(scores)),
                "races": len(scores),
            }
            for gp_number, scores in sorted(by_gp_number.items())
        ],
    }


def get_player_tracks(
    player_id,
    season=None,
    division=None,
    team_id=None,
    min_races=12,
    role="runner",
    session=None,
):
    role = normalize_role(role)
    if session is None:
        with SessionLocal() as owned_session:
            return get_player_tracks(
                player_id,
                season=season,
                division=division,
                team_id=team_id,
                min_races=min_races,
                role=role,
                session=owned_session,
            )
    if not session.get(Player, player_id):
        raise DashboardNotFound("Player not found.")
    scope = _resolve_scope(session, season=season, division=division)
    if team_id is not None and not session.get(Team, team_id):
        raise DashboardError("Unknown team filter.")
    rows = _player_race_rows(session, player_id, scope, team_id=team_id)
    confirmed = confirmed_5v5_race_ids(session, rows)
    coverage, classified = role_coverage(rows, confirmed)
    tracks = defaultdict(list)
    names = {}
    for item in classified:
        row, classified_role, _source = item
        if classified_role != role:
            continue
        tracks[row.track_id].append(item)
        names[row.track_id] = row.track_name

    results = []
    for track_id, track_rows in tracks.items():
        track_metrics = summarize_role_rows(track_rows, role)
        if track_metrics["scored_races"] < min_races:
            continue
        track_metrics.pop("role")
        results.append({
            "track_id": track_id,
            "name": names[track_id],
            "role": role,
            **track_metrics,
        })
    results.sort(key=lambda row: (
        row["points_per_race"] is None,
        -(row["points_per_race"] or 0),
        -row["races"],
        row["name"].lower(),
    ))
    return {
        "player_id": player_id,
        "role": role,
        "scope": {**_scope_payload(scope), "team_id": team_id},
        "minimum_races": min_races,
        "role_coverage": coverage,
        "tracks": results,
    }


def get_track_player_rankings(
    track_id,
    season,
    division,
    role="runner",
    min_races=2,
    session=None,
):
    role = normalize_role(role)
    if session is None:
        with SessionLocal() as owned_session:
            return get_track_player_rankings(
                track_id,
                season=season,
                division=division,
                role=role,
                min_races=min_races,
                session=owned_session,
            )

    scope = _resolve_scope(session, season=season, division=division)
    if scope.season_id is None or scope.division_id is None:
        raise DashboardError("Track player rankings require season and division.")
    if not session.get(Track, track_id):
        raise DashboardNotFound("Track not found.")

    statement = (
        select(
            RacePlayerResult.player_id,
            RacePlayerResult.race_id,
            RacePlayerResult.match_team_id,
            RacePlayerResult.score,
            RacePlayerResult.position,
            RacePlayerResult.role,
            RacePlayerResult.role_source,
            Player.canonical_lounge_name,
        )
        .join(Race, Race.race_id == RacePlayerResult.race_id)
        .join(Match, Match.match_id == Race.match_id)
        .join(Player, Player.player_id == RacePlayerResult.player_id)
        .where(
            Race.track_id == track_id,
            Match.season_id == scope.season_id,
            Match.division_id == scope.division_id,
        )
        .order_by(RacePlayerResult.player_id, Race.race_id)
    )
    statement = apply_analytics_race_filter(statement, session)
    rows = list(session.execute(statement).all())
    confirmed = confirmed_5v5_race_ids(session, rows)
    _, classified = role_coverage(rows, confirmed)
    by_player = defaultdict(list)
    for item in classified:
        by_player[item[0].player_id].append(item)

    display_names = _display_names_for_players(
        session,
        by_player,
        {
            row.player_id: row.canonical_lounge_name
            for row in rows
            if row.canonical_lounge_name
        },
    )

    players = []
    exact_sort_values = {}
    for player_id, player_rows in by_player.items():
        metrics = summarize_role_rows(player_rows, role)
        if metrics["scored_races"] < min_races:
            continue
        coverage, _ = role_coverage([item[0] for item in player_rows], confirmed)
        name = display_names.get(player_id) or f"Player {player_id}"
        exact_sort_values[player_id] = (
            metrics["total_points"] / metrics["scored_races"]
            * (12 if role == "runner" else 1)
        )
        players.append({
            "player_id": player_id,
            "name": name,
            "role": role,
            "metrics": metrics,
            "role_coverage": coverage,
        })

    players.sort(key=lambda row: (
        -exact_sort_values[row["player_id"]],
        -row["metrics"]["races"],
        row["name"].lower(),
        row["player_id"],
    ))
    return {
        "role": role,
        "scope": _scope_payload(scope),
        "track_id": track_id,
        "minimum_races": min_races,
        "players": players,
    }


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
            TeamSeasonEntry.team_season_entry_id,
        )
        .join(Season, Season.season_id == TeamSeasonEntry.season_id)
        .join(Division, Division.division_id == TeamSeasonEntry.division_id)
        .where(TeamSeasonEntry.team_id == team.team_id)
    ).all()
    entries = sorted(
        entry_rows,
        key=lambda row: (row.season_number or 0, row.team_season_entry_id),
        reverse=True,
    )
    latest = entries[0] if entries else None
    return {
        "team_id": team.team_id,
        "name": team.canonical_name,
        "tag": team.canonical_tag,
        "display_name": latest.display_name if latest else team.canonical_name,
        "current_entry": (
            {
                "season": latest.season_code,
                "division": latest.division_code,
                "name": latest.display_name,
                "tag": latest.clan_tag,
                "hex_color": latest.hex_color,
            }
            if latest
            else None
        ),
        "logo_url": _team_logo_url(session, team.team_id, scope.season_id),
        "appearances": [
            {
                "season": row.season_code,
                "division": row.division_code,
                "name": row.display_name,
                "tag": row.clan_tag,
                "hex_color": row.hex_color,
                "logo_url": _team_logo_url(session, team.team_id, row.season_id),
            }
            for row in entries
        ],
    }


def _team_match_rows(session, team_id, scope):
    statement = (
        select(
            Match.match_id,
            Match.match_label,
            Match.week_number,
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
        )
        .join(Match, Match.match_id == MatchTeam.match_id)
        .join(Season, Season.season_id == Match.season_id)
        .join(Division, Division.division_id == Match.division_id)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
        )
        .where(TeamSeasonEntry.team_id == team_id)
    )
    if scope.season_id is not None:
        statement = statement.where(Match.season_id == scope.season_id)
    if scope.division_id is not None:
        statement = statement.where(Match.division_id == scope.division_id)
    return session.execute(statement.order_by(Match.match_id)).all()


def _team_ranking(session, team_id, scope, min_races):
    if scope.season_id is None or scope.division_id is None:
        return None
    match_rows = session.execute(
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
    ).all()
    by_match = defaultdict(list)
    for row in match_rows:
        by_match[row.match_id].append(row)
    totals = defaultdict(lambda: {"differential": 0, "races": 0})
    for teams in by_match.values():
        for row in teams:
            opponent_score = max(
                (_final_score(opponent) for opponent in teams if opponent.team_id != row.team_id),
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


def get_team_overview(team_id, season=None, division=None, opponent_team_id=None, min_races=12, session=None):
    if session is None:
        with SessionLocal() as owned_session:
            return get_team_overview(
                team_id,
                season=season,
                division=division,
                opponent_team_id=opponent_team_id,
                min_races=min_races,
                session=owned_session,
            )

    team = session.get(Team, team_id)
    if not team:
        raise DashboardNotFound("Team not found.")
    scope = _resolve_scope(session, season=season, division=division)
    if opponent_team_id is not None:
        if opponent_team_id == team_id:
            raise DashboardError("A team cannot be its own opponent filter.")
        if not session.get(Team, opponent_team_id):
            raise DashboardError("Unknown opponent filter.")

    rows = _team_match_rows(session, team_id, scope)
    match_ids = [row.match_id for row in rows]
    teams_by_match = defaultdict(list)
    for row in _match_team_rows(session, match_ids):
        teams_by_match[row.match_id].append(row)

    matches = []
    for row in rows:
        opponents = [candidate for candidate in teams_by_match[row.match_id] if candidate.team_id != team_id]
        if opponent_team_id is not None and not any(candidate.team_id == opponent_team_id for candidate in opponents):
            continue
        own_final = _final_score(row)
        opponent_final = max((_final_score(candidate) for candidate in opponents), default=None)
        match_result = _result(own_final, opponent_final)
        matches.append({
            "match_id": row.match_id,
            "label": row.match_label,
            "season": row.season_code,
            "season_number": row.season_number,
            "division": row.division_code,
            "week": row.week_number,
            "races": int(row.races_played or 0),
            "score": own_final,
            "opponent_score": opponent_final,
            "differential": own_final - opponent_final if opponent_final is not None else None,
            "penalties": int(row.team_penalty_points or 0),
            "result": match_result,
            "opponents": [
                {
                    "team_id": candidate.team_id,
                    "name": candidate.display_name or candidate.canonical_name,
                    "tag": candidate.clan_tag,
                    "score": _final_score(candidate),
                }
                for candidate in opponents
            ],
        })
    matches.sort(
        key=lambda item: (item["season_number"] or 0, item["week"] or 0, item["match_id"]),
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
        "scope": {**_scope_payload(scope), "opponent_team_id": opponent_team_id},
        "metrics": {
            "matches": len(matches),
            "races": sum(row["races"] for row in matches),
            "average_final_score": _round(sum(scores) / len(scores)) if scores else None,
            "average_differential": _round(sum(differentials) / len(differentials)) if differentials else None,
            "total_penalties": sum(row["penalties"] for row in matches),
            "penalties_per_match": _round(sum(row["penalties"] for row in matches) / len(matches)) if matches else None,
            "win_rate": _round(record["wins"] / resolved_matches * 100) if resolved_matches else None,
            "best_win": max(wins, key=lambda item: item["differential"])["differential"] if wins else None,
            "closest_match": min(differentials, key=abs) if differentials else None,
            "largest_loss": min((row["differential"] for row in losses), default=None),
        },
        "record": record,
        "ranking": _team_ranking(session, team_id, scope, min_races),
        "recent_matches": matches[:5],
        "score_trend": [
            {
                "match_id": row["match_id"],
                "label": row["label"],
                "differential": row["differential"],
            }
            for row in reversed(matches[:10])
        ],
    }


def _filtered_team_match_ids(session, team_id, scope, opponent_team_id=None):
    rows = _team_match_rows(session, team_id, scope)
    match_ids = [row.match_id for row in rows]
    if opponent_team_id is None or not match_ids:
        return match_ids
    teams_by_match = defaultdict(set)
    for row in _match_team_rows(session, match_ids):
        teams_by_match[row.match_id].add(row.team_id)
    return [
        match_id
        for match_id in match_ids
        if opponent_team_id in teams_by_match[match_id]
    ]


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
            select(RacePlayerResult).where(
                RacePlayerResult.race_id.in_(candidate_race_ids)
            )
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
            if not valid_race_score(selected[0].score) or not valid_race_score(
                opponent.score
            ):
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


def get_team_roster(
    team_id,
    season=None,
    division=None,
    opponent_team_id=None,
    min_races=12,
    role="runner",
    session=None,
):
    role = normalize_role(role)
    if session is None:
        with SessionLocal() as owned_session:
            return get_team_roster(
                team_id,
                season=season,
                division=division,
                opponent_team_id=opponent_team_id,
                min_races=min_races,
                role=role,
                session=owned_session,
            )
    if not session.get(Team, team_id):
        raise DashboardNotFound("Team not found.")
    scope = _resolve_scope(session, season=season, division=division)
    if opponent_team_id is not None:
        if opponent_team_id == team_id:
            raise DashboardError("A team cannot be its own opponent filter.")
        if not session.get(Team, opponent_team_id):
            raise DashboardError("Unknown opponent filter.")
    match_ids = _filtered_team_match_ids(session, team_id, scope, opponent_team_id)
    if not match_ids:
        empty_coverage, _ = role_coverage([], set())
        return {
            "team_id": team_id,
            "role": role,
            "scope": {**_scope_payload(scope), "opponent_team_id": opponent_team_id},
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
            Match.week_number,
            Season.season_code,
            Season.season_number,
            Division.division_code,
            Player.canonical_lounge_name,
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
        .order_by(Season.season_number, Match.week_number, Match.match_id, Race.race_number)
    )
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

    display_names = _display_names_for_players(
        session,
        by_player,
        {
            row.player_id: row.canonical_lounge_name
            for row in rows
            if row.canonical_lounge_name
        },
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
        metrics = summarize_role_rows(data["classified"], role)
        if metrics["scored_races"] < min_races:
            continue
        if role == "bagger":
            metrics.update(counterpart_summaries[player_id])
        player_coverage, _ = role_coverage(
            [item[0] for item in all_by_player[player_id]], confirmed
        )
        ordered = sorted(
            player_rows,
            key=lambda row: (row.season_number or 0, row.week_number or 0, row.match_id, row.race_number),
        )
        first = ordered[0]
        last = ordered[-1]
        players.append({
            "player_id": player_id,
            "name": display_names.get(player_id) or f"Player {player_id}",
            "friend_codes": codes_by_player[player_id],
            "matches": len({row.match_id for row in player_rows}),
            "metrics": metrics,
            "role_coverage": player_coverage,
            "first_appearance": {
                "match_id": first.match_id,
                "season": first.season_code,
                "division": first.division_code,
                "week": first.week_number,
            },
            "last_appearance": {
                "match_id": last.match_id,
                "season": last.season_code,
                "division": last.division_code,
                "week": last.week_number,
            },
        })
    sort_metric = "twelve_race_pace" if role == "runner" else "points_per_race"
    players.sort(key=lambda row: (
        row["metrics"][sort_metric] is None,
        -(row["metrics"][sort_metric] or 0),
        -row["metrics"]["races"],
        row["name"].lower(),
    ))
    return {
        "team_id": team_id,
        "role": role,
        "scope": {**_scope_payload(scope), "opponent_team_id": opponent_team_id},
        "minimum_races": min_races,
        "role_coverage": coverage,
        "players": players,
    }


def get_team_tracks(team_id, season=None, division=None, opponent_team_id=None, min_races=12, session=None):
    if session is None:
        with SessionLocal() as owned_session:
            return get_team_tracks(
                team_id,
                season=season,
                division=division,
                opponent_team_id=opponent_team_id,
                min_races=min_races,
                session=owned_session,
            )
    if not session.get(Team, team_id):
        raise DashboardNotFound("Team not found.")
    scope = _resolve_scope(session, season=season, division=division)
    if opponent_team_id is not None and not session.get(Team, opponent_team_id):
        raise DashboardError("Unknown opponent filter.")
    match_ids = _filtered_team_match_ids(session, team_id, scope, opponent_team_id)
    if not match_ids:
        return {
            "team_id": team_id,
            "scope": {**_scope_payload(scope), "opponent_team_id": opponent_team_id},
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
        select(RaceTeamResult.race_id, RaceTeamResult.match_team_id, RaceTeamResult.score)
        .where(RaceTeamResult.race_id.in_(race_ids))
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
        results.append({
            "track_id": track_id,
            "name": track["name"],
            "races": len(scores),
            "average_score": _round(sum(scores) / len(scores)),
            "wins": track["wins"],
            "ties": track["ties"],
            "win_rate": _round(track["wins"] / len(scores) * 100),
        })
    results.sort(key=lambda row: (-row["average_score"], -row["races"], row["name"].lower()))
    return {
        "team_id": team_id,
        "scope": {**_scope_payload(scope), "opponent_team_id": opponent_team_id},
        "minimum_races": min_races,
        "tracks": results,
    }

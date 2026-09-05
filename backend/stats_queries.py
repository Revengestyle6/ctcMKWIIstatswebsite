from dataclasses import dataclass

from database import get_session_factory
from match_sets import apply_match_set, normalize_match_set
from models import (
    Division,
    DivisionPlayoffConfig,
    Match,
    MatchPlayer,
    MatchTeam,
    Penalty,
    Player,
    PlayerAlias,
    PlayerFriendCode,
    PlayerSeasonEntry,
    PlayoffSeries,
    PlayoffSeriesParticipant,
    Race,
    RacePlayerResult,
    RaceTeamResult,
    Season,
    Team,
    TeamSeasonEntry,
    Track,
    TrackAlias,
)
from player_display_names import _display_names_for_players
from sqlalchemy import and_, desc, func, select

SessionLocal = get_session_factory()


class AnalyticsError(ValueError):
    pass


class AmbiguousPlayerError(AnalyticsError):
    def __init__(self, query, season_code, division_code, candidates):
        self.query = query
        self.season_code = season_code
        self.division_code = division_code
        self.candidates = candidates
        super().__init__(f"Ambiguous player alias: {query}")


@dataclass(frozen=True)
class Scope:
    season_id: int
    division_id: int
    season_code: str
    division_code: str


@dataclass(frozen=True)
class PlayerLookupRow:
    player_id: int
    canonical_name: str | None
    primary_friend_code: str | None
    primary_lounge_name: str | None
    primary_mii_name: str | None
    team_id: int
    clan_tag: str
    display_name: str


def normalize_season_code(value):
    if value is None or str(value).strip() == "":
        return None
    code = str(value).strip().lower()
    return code if code.startswith("s") else f"s{code}"


def normalize_division_code(value):
    if value is None or str(value).strip() == "":
        return None
    code = str(value).strip().lower()
    return code if code.startswith("d") else f"d{code}"


def _display_player(row):
    return (
        getattr(row, "display_name", None)
        or row.primary_lounge_name
        or row.canonical_name
        or row.primary_mii_name
        or ""
    )


def _score_filter():
    return and_(RacePlayerResult.score.is_not(None), RacePlayerResult.score <= 15)


def _get_scope(session, season=None, division=None, league_code="ctc"):
    season_code = normalize_season_code(season)
    division_code = normalize_division_code(division)

    if season_code is None:
        stmt = select(Season).where(Season.league_code == league_code)
        if division_code is not None:
            stmt = stmt.join(Division, Division.season_id == Season.season_id).where(
                Division.division_code == division_code
            )
        stmt = stmt.order_by(desc(Season.season_number), desc(Season.season_id)).limit(1)
        season_obj = session.execute(stmt).scalar_one_or_none()
    else:
        season_obj = session.execute(
            select(Season).where(
                Season.league_code == league_code,
                Season.season_code == season_code,
            )
        ).scalar_one_or_none()

    if season_obj is None:
        raise AnalyticsError("Invalid season")

    division_stmt = select(Division).where(Division.season_id == season_obj.season_id)
    if division_code is not None:
        division_stmt = division_stmt.where(Division.division_code == division_code)
    division_stmt = division_stmt.order_by(Division.division_code).limit(1)
    division_obj = session.execute(division_stmt).scalar_one_or_none()

    if division_obj is None:
        raise AnalyticsError(
            f"Invalid division for {season_obj.season_code}: {division_code or '(default)'}"
        )

    return Scope(
        season_id=season_obj.season_id,
        division_id=division_obj.division_id,
        season_code=season_obj.season_code,
        division_code=division_obj.division_code,
    )


def _valid_players(session, scope):
    rows = session.execute(
        select(
            Player.player_id,
            Player.canonical_name,
            Player.primary_friend_code,
            PlayerSeasonEntry.primary_lounge_name,
            PlayerSeasonEntry.primary_mii_name,
            Team.team_id,
            TeamSeasonEntry.clan_tag,
        )
        .join(PlayerSeasonEntry, PlayerSeasonEntry.player_id == Player.player_id)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == PlayerSeasonEntry.team_season_entry_id,
        )
        .join(Team, Team.team_id == TeamSeasonEntry.team_id)
        .where(
            PlayerSeasonEntry.season_id == scope.season_id,
            PlayerSeasonEntry.division_id == scope.division_id,
        )
    ).all()
    canonical_names = {row.player_id: row.canonical_name for row in rows}
    display_names = _display_names_for_players(session, canonical_names.keys(), canonical_names)
    return [
        PlayerLookupRow(
            player_id=row.player_id,
            canonical_name=row.canonical_name,
            primary_friend_code=row.primary_friend_code,
            primary_lounge_name=row.primary_lounge_name,
            primary_mii_name=row.primary_mii_name,
            team_id=row.team_id,
            clan_tag=row.clan_tag,
            display_name=display_names.get(row.player_id, ""),
        )
        for row in rows
    ]


def _player_candidate_dict(row):
    return {
        "player_id": row.player_id,
        "name": _display_player(row),
        "team": row.clan_tag,
        "friend_code": row.primary_friend_code,
    }


def _resolve_player(session, player, scope):
    query_text = player.strip()
    query = query_text.lower()
    if not query_text:
        raise AnalyticsError("Player name is required")

    direct_rows = _valid_players(session, scope)
    direct_matches = []
    for row in direct_rows:
        names = [
            row.display_name,
            row.primary_lounge_name,
            row.primary_mii_name,
            row.canonical_name,
        ]
        if any(name and name.lower() == query for name in names):
            direct_matches.append(row)

    alias_player_ids = {
        row[0]
        for row in session.execute(
            select(PlayerAlias.player_id).where(func.lower(PlayerAlias.alias_value) == query)
        ).all()
    }
    alias_matches = [row for row in direct_rows if row.player_id in alias_player_ids]

    matches_by_id = {row.player_id: row for row in direct_matches + alias_matches}
    matches = list(matches_by_id.values())

    if not matches:
        valid_names = sorted({_display_player(row) for row in direct_rows if _display_player(row)})
        raise AnalyticsError(f"Invalid Player Name, Valid Players: {valid_names}")
    if len(matches) > 1:
        raise AmbiguousPlayerError(
            player,
            scope.season_code,
            scope.division_code,
            [_player_candidate_dict(row) for row in matches],
        )
    return matches[0]


def _resolve_team(session, team, scope):
    if not team or not team.strip():
        raise AnalyticsError("Team is required")
    query = team.strip().lower()
    row = session.execute(
        select(
            Team.team_id,
            TeamSeasonEntry.team_season_entry_id,
            TeamSeasonEntry.clan_tag,
            TeamSeasonEntry.display_name,
            Team.canonical_name,
        )
        .join(Team, Team.team_id == TeamSeasonEntry.team_id)
        .where(
            TeamSeasonEntry.season_id == scope.season_id,
            TeamSeasonEntry.division_id == scope.division_id,
            func.lower(TeamSeasonEntry.clan_tag) == query,
        )
    ).first()
    if row is None:
        valid_teams = list_teams(season=scope.season_code, division=scope.division_code)
        raise AnalyticsError(f"Invalid Team Name, Valid Teams: {valid_teams}")
    return row


def _resolve_track(session, track, scope, match_set="regular", league_code="ctc"):
    if not track or not track.strip():
        raise AnalyticsError("Track name is required")
    query = track.strip().lower()
    statement = (
        select(Track.track_id, Track.canonical_name)
        .join(Race, Race.track_id == Track.track_id)
        .join(Match, Match.match_id == Race.match_id)
        .where(
            Match.season_id == scope.season_id,
            Match.division_id == scope.division_id,
            func.lower(Track.canonical_name) == query,
        )
        .group_by(Track.track_id)
    )
    row = session.execute(apply_match_set(statement, match_set)).first()
    if row is None:
        valid_tracks = list_tracks(
            league_code=league_code,
            season=scope.season_code,
            division=scope.division_code,
            match_set=match_set,
        )
        raise AnalyticsError(f"Invalid Track Name, Valid Tracks: {valid_tracks}")
    return row


def list_players(season=None, division=None, league_code="ctc"):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division, league_code=league_code)
        players = {}
        for row in _valid_players(session, scope):
            display_name = _display_player(row)
            if display_name:
                players[display_name.lower()] = display_name
        return sorted(players.values(), key=lambda name: name.lower())


def list_player_directory(season=None, division=None, league_code="ctc"):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division, league_code=league_code)
        players = {}
        for row in _valid_players(session, scope):
            display_name = _display_player(row)
            if not display_name:
                continue
            entry = players.setdefault(
                row.player_id,
                {
                    "player_id": row.player_id,
                    "name": display_name,
                    "primary_friend_code": row.primary_friend_code,
                    "teams": [],
                },
            )
            if not any(team["team_id"] == row.team_id for team in entry["teams"]):
                entry["teams"].append({"team_id": row.team_id, "tag": row.clan_tag})
        return sorted(players.values(), key=lambda entry: entry["name"].lower())


def find_player_identities(friend_code=None, query=None, limit=12):
    friend_code = (friend_code or "").strip()
    query = (query or "").strip()
    with SessionLocal() as session:
        player_ids = []
        reason = "none"
        if friend_code:
            player_ids = list(
                session.scalars(
                    select(PlayerFriendCode.player_id).where(
                        PlayerFriendCode.friend_code == friend_code
                    )
                )
            )
            reason = "exact_friend_code" if player_ids else "none"
        elif query:
            pattern = f"%{query.lower()}%"
            player_id_match = int(query) if query.isdigit() else None
            player_ids = list(
                session.scalars(
                    select(Player.player_id)
                    .outerjoin(PlayerAlias, PlayerAlias.player_id == Player.player_id)
                    .where(
                        (Player.player_id == player_id_match)
                        | func.lower(func.coalesce(Player.canonical_name, "")).like(pattern)
                        | func.lower(func.coalesce(PlayerAlias.alias_value, "")).like(pattern)
                    )
                    .distinct()
                    .order_by(Player.player_id)
                    .limit(limit)
                )
            )
            reason = "player_search" if player_ids else "none"

        if not player_ids:
            return {"reason": reason, "results": []}

        players = session.execute(
            select(Player.player_id, Player.canonical_name, Player.primary_friend_code).where(
                Player.player_id.in_(player_ids)
            )
        ).all()
        codes = session.execute(
            select(PlayerFriendCode.player_id, PlayerFriendCode.friend_code)
            .where(PlayerFriendCode.player_id.in_(player_ids))
            .order_by(PlayerFriendCode.friend_code)
        ).all()
        aliases = session.execute(
            select(PlayerAlias.player_id, PlayerAlias.alias_type, PlayerAlias.alias_value)
            .where(PlayerAlias.player_id.in_(player_ids))
            .order_by(PlayerAlias.alias_type, PlayerAlias.alias_value)
        ).all()
        codes_by_player = {}
        aliases_by_player = {}
        for row in codes:
            codes_by_player.setdefault(row.player_id, []).append(row.friend_code)
        for row in aliases:
            aliases_by_player.setdefault(row.player_id, []).append(
                {
                    "type": row.alias_type,
                    "value": row.alias_value,
                }
            )
        return {
            "reason": reason,
            "results": [
                {
                    "player_id": row.player_id,
                    "canonical_name": row.canonical_name,
                    "primary_friend_code": row.primary_friend_code,
                    "friend_codes": codes_by_player.get(row.player_id, []),
                    "aliases": aliases_by_player.get(row.player_id, []),
                }
                for row in players
            ],
        }


def search_tracks(query=None, limit=500, league_code="ctc", include_other_leagues=False):
    query = (query or "").strip().lower()
    with SessionLocal() as session:
        statement = select(Track.track_id, Track.canonical_name, Track.league_code).order_by(
            Track.canonical_name
        )
        if not include_other_leagues:
            statement = statement.where(func.lower(Track.league_code) == league_code.casefold())
        if query:
            pattern = f"%{query}%"
            matching_ids = select(TrackAlias.track_id).where(
                func.lower(TrackAlias.alias_value).like(pattern)
            )
            statement = statement.where(
                func.lower(Track.canonical_name).like(pattern) | Track.track_id.in_(matching_ids)
            )
        rows = session.execute(statement.limit(limit)).all()
        track_ids = [row.track_id for row in rows]
        aliases_by_track: dict[int, list[str]] = {track_id: [] for track_id in track_ids}
        if track_ids:
            for track_id, alias in session.execute(
                select(TrackAlias.track_id, TrackAlias.alias_value)
                .where(TrackAlias.track_id.in_(track_ids))
                .order_by(TrackAlias.track_id, TrackAlias.alias_value)
            ):
                aliases_by_track[track_id].append(alias)
        return [
            {
                "track_id": row.track_id,
                "name": row.canonical_name,
                "league": row.league_code,
                "aliases": aliases_by_track[row.track_id],
            }
            for row in rows
        ]


def list_seasons(league_code="ctc"):
    with SessionLocal() as session:
        rows = session.execute(
            select(
                Season.season_code,
                Season.season_number,
                Season.name,
                Season.status,
            )
            .where(Season.league_code == league_code)
            .order_by(desc(Season.season_number), desc(Season.season_id))
        ).all()
        return [
            {
                "season": row.season_code,
                "season_number": row.season_number,
                "name": row.name,
                "status": row.status,
            }
            for row in rows
        ]


def list_match_scopes():
    with SessionLocal() as session:
        rows = session.execute(
            select(
                Season.league_code,
                Season.season_code,
                Season.name,
                Division.division_code,
                Division.division_name,
            )
            .join(Division, Division.season_id == Season.season_id)
            .order_by(Season.league_code, Season.season_number, Division.division_code)
        ).all()
        return [
            {
                "league": row.league_code,
                "season": row.season_code,
                "season_name": row.name,
                "division": row.division_code,
                "division_name": row.division_name,
            }
            for row in rows
        ]


def list_team_scopes():
    with SessionLocal() as session:
        rows = session.execute(
            select(
                Season.league_code,
                Season.season_code,
                Division.division_code,
                Team.team_id,
                Team.canonical_name,
                Team.canonical_tag,
                TeamSeasonEntry.display_name,
                TeamSeasonEntry.clan_tag,
                TeamSeasonEntry.team_season_entry_id,
                TeamSeasonEntry.competition_status,
                TeamSeasonEntry.competition_status_note,
            )
            .join(Division, Division.season_id == Season.season_id)
            .join(TeamSeasonEntry, TeamSeasonEntry.division_id == Division.division_id)
            .join(Team, Team.team_id == TeamSeasonEntry.team_id)
            .order_by(
                Season.league_code,
                Season.season_number,
                Division.division_code,
                TeamSeasonEntry.clan_tag,
            )
        ).all()
        return [
            {
                "league": row.league_code,
                "season": row.season_code,
                "division": row.division_code,
                "team_id": row.team_id,
                "canonical_name": row.canonical_name,
                "canonical_tag": row.canonical_tag,
                "display_name": row.display_name,
                "clan_tag": row.clan_tag,
                "team_season_entry_id": row.team_season_entry_id,
                "competition_status": row.competition_status,
                "competition_status_note": row.competition_status_note,
            }
            for row in rows
        ]


def list_divisions(season=None, league_code="ctc"):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=None, league_code=league_code)
        rows = session.execute(
            select(Division.division_code, Division.division_name)
            .where(Division.season_id == scope.season_id)
            .order_by(Division.division_code)
        ).all()
        return [{"division": row.division_code, "name": row.division_name} for row in rows]


def list_teams(season=None, division=None, league_code="ctc"):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division, league_code=league_code)
        rows = session.execute(
            select(TeamSeasonEntry.clan_tag)
            .where(
                TeamSeasonEntry.season_id == scope.season_id,
                TeamSeasonEntry.division_id == scope.division_id,
            )
            .order_by(TeamSeasonEntry.clan_tag)
        ).scalars()
        return list(rows)


def list_tracks(season=None, division=None, match_set="regular", league_code="ctc"):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division, league_code=league_code)
        statement = (
            select(Track.canonical_name)
            .join(Race, Race.track_id == Track.track_id)
            .join(Match, Match.match_id == Race.match_id)
            .where(
                Match.season_id == scope.season_id,
                Match.division_id == scope.division_id,
            )
            .group_by(Track.track_id)
            .order_by(Track.canonical_name)
        )
        rows = session.execute(apply_match_set(statement, match_set)).scalars()
        return list(rows)


def _playoff_series_display_label(stage, series_number, config):
    if stage == "semifinals":
        if config is not None and config.semifinal_series_count == 1:
            return "Semifinals"
        return f"Semifinals Series {series_number}"
    if stage == "finals":
        return "Finals"
    return ""


def _playoff_match_display_label(
    stored_label,
    stage,
    series_number,
    series_match_number,
    config,
):
    series_label = _playoff_series_display_label(stage, series_number, config)
    if series_label and series_match_number:
        return f"{series_label} — Match {series_match_number}"
    return stored_label


def list_matches(season=None, division=None, team=None, match_set="regular", league_code="ctc"):
    with SessionLocal() as session:
        scope = _get_scope(session, season=season, division=division, league_code=league_code)
        match_set = normalize_match_set(match_set)
        playoff_config = session.get(DivisionPlayoffConfig, scope.division_id)
        statement = (
            select(
                Match.match_id,
                Match.match_type,
                Match.result_type,
                Match.match_number,
                Match.playoff_series_id,
                Match.series_match_number,
                PlayoffSeries.stage.label("playoff_stage"),
                PlayoffSeries.series_number.label("playoff_series_number"),
                Match.match_label,
                Match.races_played,
                Match.import_status,
                Match.review_notes,
            )
            .where(
                Match.season_id == scope.season_id,
                Match.division_id == scope.division_id,
            )
            .outerjoin(
                PlayoffSeries,
                PlayoffSeries.playoff_series_id == Match.playoff_series_id,
            )
            .order_by(
                Match.match_type,
                Match.match_number,
                PlayoffSeries.stage,
                PlayoffSeries.series_number,
                Match.series_match_number,
                Match.match_label,
                Match.match_id,
            )
        )
        match_rows = session.execute(apply_match_set(statement, match_set)).all()
        match_ids = [row.match_id for row in match_rows]

        team_rows = []
        if match_ids:
            team_rows = session.execute(
                select(
                    MatchTeam.match_id,
                    MatchTeam.final_score,
                    TeamSeasonEntry.clan_tag,
                    TeamSeasonEntry.competition_status,
                )
                .join(
                    TeamSeasonEntry,
                    TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
                )
                .where(MatchTeam.match_id.in_(match_ids))
                .order_by(
                    MatchTeam.match_id,
                    desc(func.coalesce(MatchTeam.final_score, -1)),
                    MatchTeam.match_team_id,
                )
            ).all()

        teams_by_match = {match_id: [] for match_id in match_ids}
        scores_by_match = {match_id: [] for match_id in match_ids}
        statuses_by_match = {match_id: [] for match_id in match_ids}
        for row in team_rows:
            teams_by_match.setdefault(row.match_id, []).append(row.clan_tag)
            scores_by_match.setdefault(row.match_id, []).append(str(row.final_score))
            statuses_by_match.setdefault(row.match_id, []).append(row.competition_status)

        team_query = team.strip().lower() if team else ""
        matches = [
            {
                "match_id": row.match_id,
                "match_type": row.match_type,
                "result_type": row.result_type,
                "match_number": row.match_number,
                "playoff_series_id": row.playoff_series_id,
                "series_match_number": row.series_match_number,
                "playoff_stage": row.playoff_stage,
                "playoff_series_number": row.playoff_series_number,
                "label": _playoff_match_display_label(
                    row.match_label,
                    row.playoff_stage,
                    row.playoff_series_number,
                    row.series_match_number,
                    playoff_config,
                ),
                "playoff_semifinal_series_count": (
                    playoff_config.semifinal_series_count
                    if row.match_type == "playoff" and playoff_config
                    else None
                ),
                "races": row.races_played,
                "teams": " vs ".join(teams_by_match.get(row.match_id, [])),
                "scores": " - ".join(scores_by_match.get(row.match_id, [])),
                "team_statuses": statuses_by_match.get(row.match_id, []),
                "import_status": row.import_status,
                "review_notes": row.review_notes,
            }
            for row in match_rows
            if not team_query
            or team_query in [tag.lower() for tag in teams_by_match.get(row.match_id, [])]
        ]
        return matches


def list_playoff_series(season=None, division=None, team=None, league_code="ctc", session=None):
    if session is None:
        with SessionLocal() as owned_session:
            return list_playoff_series(
                season=season,
                division=division,
                team=team,
                league_code=league_code,
                session=owned_session,
            )
    if session is not None:
        scope = _get_scope(session, season=season, division=division, league_code=league_code)
        config = session.get(DivisionPlayoffConfig, scope.division_id)
        series_rows = session.scalars(
            select(PlayoffSeries)
            .where(
                PlayoffSeries.season_id == scope.season_id,
                PlayoffSeries.division_id == scope.division_id,
            )
            .order_by(PlayoffSeries.stage.desc(), PlayoffSeries.series_number)
        ).all()
        output = []
        team_query = (team or "").strip().lower()
        for series in series_rows:
            participants = session.execute(
                select(
                    Team.team_id,
                    Team.canonical_name,
                    TeamSeasonEntry.clan_tag,
                    PlayoffSeriesParticipant.participant_slot,
                )
                .join(Team, Team.team_id == PlayoffSeriesParticipant.team_id)
                .join(
                    TeamSeasonEntry,
                    and_(
                        TeamSeasonEntry.team_id == Team.team_id,
                        TeamSeasonEntry.division_id == scope.division_id,
                    ),
                )
                .where(PlayoffSeriesParticipant.playoff_series_id == series.playoff_series_id)
                .order_by(PlayoffSeriesParticipant.participant_slot)
            ).all()
            if team_query and team_query not in {row.clan_tag.lower() for row in participants}:
                continue
            matches = session.execute(
                select(Match.match_id, Match.series_match_number, Match.match_label)
                .where(Match.playoff_series_id == series.playoff_series_id)
                .order_by(Match.series_match_number)
            ).all()
            score_rows = session.execute(
                select(Match.match_id, Team.team_id, MatchTeam.final_score)
                .join(MatchTeam, MatchTeam.match_id == Match.match_id)
                .join(
                    TeamSeasonEntry,
                    TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
                )
                .join(Team, Team.team_id == TeamSeasonEntry.team_id)
                .where(Match.playoff_series_id == series.playoff_series_id)
            ).all()
            scores_by_match = {}
            wins = {row.team_id: 0 for row in participants}
            for row in score_rows:
                scores_by_match.setdefault(row.match_id, []).append(row)
            for scores in scores_by_match.values():
                if len(scores) == 2 and scores[0].final_score != scores[1].final_score:
                    winner = max(scores, key=lambda row: row.final_score).team_id
                    wins[winner] += 1
            needed = series.best_of // 2 + 1
            winner_id = next(
                (participant_id for participant_id, count in wins.items() if count >= needed),
                None,
            )
            output.append(
                {
                    "playoff_series_id": series.playoff_series_id,
                    "stage": series.stage,
                    "series_number": series.series_number,
                    "label": _playoff_series_display_label(
                        series.stage,
                        series.series_number,
                        config,
                    ),
                    "best_of": series.best_of,
                    "wins_needed": needed,
                    "winner_team_id": winner_id,
                    "status": "complete" if winner_id is not None else "in_progress",
                    "participants": [
                        {
                            "team_id": row.team_id,
                            "name": row.canonical_name,
                            "tag": row.clan_tag,
                            "slot": row.participant_slot,
                            "wins": wins[row.team_id],
                        }
                        for row in participants
                    ],
                    "matches": [
                        {
                            "match_id": row.match_id,
                            "series_match_number": row.series_match_number,
                            "label": _playoff_match_display_label(
                                row.match_label,
                                series.stage,
                                series.series_number,
                                row.series_match_number,
                                config,
                            ),
                            "teams": [
                                {
                                    "team_id": score.team_id,
                                    "tag": next(
                                        (
                                            participant.clan_tag
                                            for participant in participants
                                            if participant.team_id == score.team_id
                                        ),
                                        "",
                                    ),
                                    "score": score.final_score,
                                }
                                for score in scores_by_match.get(row.match_id, [])
                            ],
                        }
                        for row in matches
                    ],
                }
            )
        return {
            "season": scope.season_code,
            "division": scope.division_code,
            "format": (
                {
                    "code": config.format_code,
                    "playoff_team_count": config.playoff_team_count,
                    "semifinal_series_count": config.semifinal_series_count,
                    "finals_bye_count": config.finals_bye_count,
                }
                if config
                else None
            ),
            "series": output,
        }


def _team_penalties(session, match_id):
    rows = session.execute(
        select(
            Penalty.match_team_id,
            Penalty.penalty_points,
            Penalty.raw_penalty_text,
        )
        .where(Penalty.match_id == match_id, Penalty.penalty_scope == "team")
        .order_by(Penalty.match_team_id, Penalty.penalty_id)
    ).all()
    penalties_by_team = {}
    for row in rows:
        penalty = penalties_by_team.setdefault(row.match_team_id, {"points": 0, "notes": []})
        penalty["points"] += int(row.penalty_points or 0)
        if row.raw_penalty_text:
            penalty["notes"].append(row.raw_penalty_text)
    return {
        team_id: {"points": penalty["points"], "notes": "; ".join(penalty["notes"])}
        for team_id, penalty in penalties_by_team.items()
    }


def get_match_detail(match_id, session=None):
    if session is None:
        with SessionLocal() as owned_session:
            return get_match_detail(match_id, session=owned_session)
    if session is not None:
        match = session.get(Match, match_id)
        if not match:
            raise AnalyticsError("Invalid match")

        season = session.get(Season, match.season_id)
        division = session.get(Division, match.division_id)
        playoff_series = (
            session.get(PlayoffSeries, match.playoff_series_id)
            if match.playoff_series_id is not None
            else None
        )
        playoff_config = (
            session.get(DivisionPlayoffConfig, match.division_id)
            if playoff_series is not None
            else None
        )
        race_rows = session.execute(
            select(Race.race_id, Race.race_number, Race.track_name_raw, Track.canonical_name)
            .join(Track, Track.track_id == Race.track_id)
            .where(Race.match_id == match.match_id)
            .order_by(Race.race_number)
        ).all()
        race_ids = [row.race_id for row in race_rows]
        race_index_by_id = {race_id: index for index, race_id in enumerate(race_ids)}

        match_teams = session.execute(
            select(
                MatchTeam.match_team_id,
                MatchTeam.team_season_entry_id,
                MatchTeam.raw_team_key,
                MatchTeam.raw_total_score,
                MatchTeam.team_penalty_points,
                MatchTeam.final_score,
                MatchTeam.hex_color,
                Team.team_id,
                TeamSeasonEntry.clan_tag,
                TeamSeasonEntry.display_name,
                TeamSeasonEntry.competition_status,
                TeamSeasonEntry.competition_status_note,
            )
            .join(
                TeamSeasonEntry,
                TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
            )
            .join(Team, Team.team_id == TeamSeasonEntry.team_id)
            .where(MatchTeam.match_id == match.match_id)
            .order_by(
                desc(func.coalesce(MatchTeam.final_score, -1)),
                MatchTeam.match_team_id,
            )
        ).all()
        team_penalties = _team_penalties(session, match.match_id)

        player_rows = session.execute(
            select(
                MatchPlayer.match_player_id,
                MatchPlayer.match_team_id,
                MatchPlayer.player_id,
                MatchPlayer.friend_code_raw,
                MatchPlayer.lounge_name_raw,
                MatchPlayer.mii_name_raw,
                MatchPlayer.table_name_raw,
                MatchPlayer.raw_total_score,
                MatchPlayer.player_penalty_points,
                MatchPlayer.subbed_out,
                Player.canonical_name,
            )
            .join(Player, Player.player_id == MatchPlayer.player_id)
            .join(MatchTeam, MatchTeam.match_team_id == MatchPlayer.match_team_id)
            .where(MatchTeam.match_id == match.match_id)
            .order_by(
                MatchPlayer.match_team_id,
                desc(MatchPlayer.raw_total_score),
                MatchPlayer.match_player_id,
            )
        ).all()
        display_names = _display_names_for_players(
            session,
            [row.player_id for row in player_rows],
            {row.player_id: row.canonical_name for row in player_rows},
        )

        scores_by_match_player = {
            row.match_player_id: [None for _ in race_rows] for row in player_rows
        }
        positions_by_match_player = {
            row.match_player_id: [None for _ in race_rows] for row in player_rows
        }
        result_rows = session.execute(
            select(
                RacePlayerResult.match_player_id,
                RacePlayerResult.race_id,
                RacePlayerResult.score,
                RacePlayerResult.position,
                RacePlayerResult.role,
            ).where(RacePlayerResult.race_id.in_(race_ids))
        ).all()
        roles_by_match_player = {
            row.match_player_id: ["unknown" for _ in race_rows] for row in player_rows
        }
        for row in result_rows:
            index = race_index_by_id.get(row.race_id)
            if index is None or row.match_player_id not in scores_by_match_player:
                continue
            scores_by_match_player[row.match_player_id][index] = row.score
            positions_by_match_player[row.match_player_id][index] = row.position
            roles_by_match_player[row.match_player_id][index] = row.role

        missing_scores_by_team = {
            row.match_team_id: [None for _ in race_rows] for row in match_teams
        }
        missing_reasons_by_team = {
            row.match_team_id: [[] for _ in race_rows] for row in match_teams
        }
        team_result_rows = session.execute(
            select(
                RaceTeamResult.match_team_id,
                RaceTeamResult.race_id,
                RaceTeamResult.score,
                RaceTeamResult.reason,
            ).where(
                RaceTeamResult.race_id.in_(race_ids),
                RaceTeamResult.result_type == "missing_player",
            )
        ).all()
        for result in team_result_rows:
            index = race_index_by_id.get(result.race_id)
            scores = missing_scores_by_team.get(result.match_team_id)
            reasons = missing_reasons_by_team.get(result.match_team_id)
            if index is None or scores is None or reasons is None:
                continue
            scores[index] = (scores[index] or 0) + result.score
            reasons[index].append(result.reason)

        players_by_team = {row.match_team_id: [] for row in match_teams}
        for row in player_rows:
            players_by_team.setdefault(row.match_team_id, []).append(
                {
                    "player_id": row.player_id,
                    "name": display_names.get(row.player_id)
                    or row.lounge_name_raw
                    or row.table_name_raw
                    or row.mii_name_raw
                    or "",
                    "friend_code": row.friend_code_raw,
                    "total": row.raw_total_score,
                    "penalties": row.player_penalty_points,
                    "subbed_out": row.subbed_out,
                    "scores": scores_by_match_player.get(row.match_player_id, []),
                    "positions": positions_by_match_player.get(row.match_player_id, []),
                    "roles": roles_by_match_player.get(row.match_player_id, []),
                }
            )

        teams = []
        for row in match_teams:
            team_players = sorted(
                players_by_team.get(row.match_team_id, []),
                key=lambda player: (-int(player["total"] or 0), player["name"].lower()),
            )
            teams.append(
                {
                    "team_season_entry_id": row.team_season_entry_id,
                    "team_id": row.team_id,
                    "tag": row.clan_tag,
                    "name": row.display_name,
                    "competition_status": row.competition_status,
                    "competition_status_note": row.competition_status_note,
                    "raw_team_key": row.raw_team_key,
                    "hex_color": row.hex_color or "#3b82f6",
                    "raw_total_score": row.raw_total_score,
                    "team_penalties": row.team_penalty_points,
                    "final_score": row.final_score,
                    "penalty": team_penalties.get(row.match_team_id, {"points": 0, "notes": ""}),
                    "missing_player": {
                        "scores": missing_scores_by_team.get(row.match_team_id, []),
                        "reasons": missing_reasons_by_team.get(row.match_team_id, []),
                        "total": sum(
                            score or 0
                            for score in missing_scores_by_team.get(row.match_team_id, [])
                        ),
                    },
                    "players": team_players,
                }
            )

        cumulative = []
        if len(teams) >= 2:
            running = 0
            for race_index in range(len(race_rows)):
                team_totals = []
                for team in teams[:2]:
                    player_total = sum(
                        player["scores"][race_index] or 0
                        for player in team["players"]
                        if race_index < len(player["scores"])
                    )
                    missing_scores = team["missing_player"]["scores"]
                    missing_total = (
                        missing_scores[race_index] or 0 if race_index < len(missing_scores) else 0
                    )
                    team_totals.append(player_total + missing_total)
                running += team_totals[0] - team_totals[1]
                cumulative.append(running)

        return {
            "match_id": match.match_id,
            "match_type": match.match_type,
            "result_type": match.result_type,
            "season": season.season_code if season else "",
            "division": division.division_code if division else "",
            "match_number": match.match_number,
            "playoff_series_id": match.playoff_series_id,
            "series_match_number": match.series_match_number,
            "playoff_stage": playoff_series.stage if playoff_series else None,
            "playoff_series_number": playoff_series.series_number if playoff_series else None,
            "label": _playoff_match_display_label(
                match.match_label,
                playoff_series.stage if playoff_series else None,
                playoff_series.series_number if playoff_series else None,
                match.series_match_number,
                playoff_config,
            ),
            "playoff_semifinal_series_count": (
                playoff_config.semifinal_series_count if playoff_config else None
            ),
            "format": match.format,
            "races_played": match.races_played,
            "import_status": match.import_status,
            "review_notes": match.review_notes,
            "last_update_at": (match.last_update_at.isoformat() if match.last_update_at else None),
            "tracks": [
                {
                    "race_number": row.race_number,
                    "name": row.canonical_name or row.track_name_raw,
                    "raw_name": row.track_name_raw,
                }
                for row in race_rows
            ],
            "teams": teams,
            "differential": cumulative,
        }

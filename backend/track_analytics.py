"""Race-level analytics for the track comparison and detail dashboards."""

from collections import defaultdict
from statistics import median, pstdev

from analytics_eligibility import apply_analytics_race_filter
from models import (
    Match,
    MatchTeam,
    Race,
    RacePlayerResult,
    RaceTeamResult,
    Team,
    TeamSeasonEntry,
    Track,
    TrackAlias,
)
from player_dashboard_stats import (
    DashboardError,
    DashboardNotFound,
    _resolve_scope,
    _scope_payload,
)
from sqlalchemy import func, select

EVEN_MARGIN = 5
BLOWOUT_MARGIN = 20
STANDOUT_MIN_RACES = 3
RACE_SLOTS = 12


def _round(value, digits=1):
    return round(float(value), digits) if value is not None else None


def _team_name(display_name, clan_tag, canonical_name):
    return (display_name or "").strip() or (canonical_name or "").strip() or clan_tag


def _load_rows(session, scope, team_id=None, track_id=None):
    if team_id is not None and (scope.season_id is None or scope.division_id is None):
        raise DashboardError("A team filter requires a specific season and division.")
    if (
        team_id is not None
        and session.scalar(
            select(TeamSeasonEntry.team_season_entry_id).where(
                TeamSeasonEntry.team_id == team_id,
                TeamSeasonEntry.season_id == scope.season_id,
                TeamSeasonEntry.division_id == scope.division_id,
            )
        )
        is None
    ):
        raise DashboardError("The selected team is not registered in this division.")

    player_scores = (
        select(
            RacePlayerResult.race_id.label("race_id"),
            RacePlayerResult.match_team_id.label("match_team_id"),
            func.sum(RacePlayerResult.score).label("score"),
        )
        .where(RacePlayerResult.score.between(0, 15))
        .group_by(RacePlayerResult.race_id, RacePlayerResult.match_team_id)
        .subquery()
    )
    awards = (
        select(
            RaceTeamResult.race_id.label("race_id"),
            RaceTeamResult.match_team_id.label("match_team_id"),
            func.sum(RaceTeamResult.score).label("score"),
        )
        .group_by(RaceTeamResult.race_id, RaceTeamResult.match_team_id)
        .subquery()
    )
    score = func.coalesce(player_scores.c.score, 0) + func.coalesce(awards.c.score, 0)
    statement = (
        select(
            Race.race_id,
            Race.race_number,
            Match.match_id,
            Match.match_number,
            Match.match_label,
            Track.track_id,
            Track.canonical_name.label("track_name"),
            Team.team_id,
            Team.canonical_name,
            TeamSeasonEntry.display_name,
            TeamSeasonEntry.clan_tag,
            score.label("score"),
        )
        .join(Match, Match.match_id == Race.match_id)
        .join(Track, Track.track_id == Race.track_id)
        .join(MatchTeam, MatchTeam.match_id == Match.match_id)
        .join(
            TeamSeasonEntry, TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id
        )
        .join(Team, Team.team_id == TeamSeasonEntry.team_id)
        .outerjoin(
            player_scores,
            (player_scores.c.race_id == Race.race_id)
            & (player_scores.c.match_team_id == MatchTeam.match_team_id),
        )
        .outerjoin(
            awards,
            (awards.c.race_id == Race.race_id)
            & (awards.c.match_team_id == MatchTeam.match_team_id),
        )
        .where(
            Match.match_type == "regular",
            Match.result_type == "played",
            Track.league_code == scope.league_code,
        )
    )
    if scope.season_id is not None:
        statement = statement.where(Match.season_id == scope.season_id)
    if scope.division_id is not None:
        statement = statement.where(Match.division_id == scope.division_id)
    if track_id is not None:
        statement = statement.where(Track.track_id == track_id)
    if team_id is not None:
        selected_matches = (
            select(MatchTeam.match_id)
            .join(
                TeamSeasonEntry,
                TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
            )
            .where(
                TeamSeasonEntry.team_id == team_id,
                TeamSeasonEntry.season_id == scope.season_id,
                TeamSeasonEntry.division_id == scope.division_id,
            )
        )
        statement = statement.where(Match.match_id.in_(selected_matches))
    return session.execute(
        apply_analytics_race_filter(statement, session).order_by(
            Match.match_id, Race.race_number, Team.team_id
        )
    ).all()


def _race_records(rows):
    grouped = defaultdict(list)
    for row in rows:
        grouped[row.race_id].append(row)
    records = []
    for race_rows in grouped.values():
        teams = list({row.team_id: row for row in race_rows}.values())
        if len(teams) != 2:
            continue
        first, second = teams
        records.append(
            {
                "race_id": first.race_id,
                "race_number": first.race_number,
                "match_id": first.match_id,
                "match_number": first.match_number,
                "match_label": first.match_label,
                "track_id": first.track_id,
                "track_name": first.track_name,
                "margin": abs(first.score - second.score),
                "teams": [
                    {
                        "team_id": first.team_id,
                        "team_name": _team_name(
                            first.display_name, first.clan_tag, first.canonical_name
                        ),
                        "team_tag": first.clan_tag,
                        "score": int(first.score),
                        "differential": int(first.score - second.score),
                    },
                    {
                        "team_id": second.team_id,
                        "team_name": _team_name(
                            second.display_name, second.clan_tag, second.canonical_name
                        ),
                        "team_tag": second.clan_tag,
                        "score": int(second.score),
                        "differential": int(second.score - first.score),
                    },
                ],
            }
        )
    return records


def _team_track_rows(races, selected_team_id=None):
    overall, by_track, identity = defaultdict(list), defaultdict(list), {}
    for race in races:
        for team in race["teams"]:
            if selected_team_id is not None and team["team_id"] != selected_team_id:
                continue
            identity[team["team_id"]] = team
            overall[team["team_id"]].append(team["differential"])
            by_track[(team["team_id"], race["track_id"])].append(
                (team["score"], team["differential"])
            )
    names = {race["track_id"]: race["track_name"] for race in races}
    results = []
    for (team_id, track_id), samples in by_track.items():
        scores, margins = zip(*samples)
        baseline = sum(overall[team_id]) / len(overall[team_id])
        average_margin = sum(margins) / len(margins)
        team = identity[team_id]
        results.append(
            {
                "team_id": team_id,
                "team_name": team["team_name"],
                "team_tag": team["team_tag"],
                "track_id": track_id,
                "track_name": names[track_id],
                "races": len(samples),
                "average_score": _round(sum(scores) / len(scores)),
                "average_margin": _round(average_margin),
                "win_rate": _round(100 * sum(value > 0 for value in margins) / len(margins)),
                "baseline_margin": _round(baseline),
                "lift": _round(average_margin - baseline),
                "sample_status": "established" if len(samples) >= STANDOUT_MIN_RACES else "early",
            }
        )
    return sorted(results, key=lambda row: (-row["lift"], -row["races"], row["track_name"]))


def _track_rows(races, team_rows, selected_team_id=None):
    grouped = defaultdict(list)
    for race in races:
        grouped[race["track_id"]].append(race)
    selected = {
        row["track_id"]: row
        for row in team_rows
        if selected_team_id is not None and row["team_id"] == selected_team_id
    }
    result = []
    for track_id, samples in grouped.items():
        margins = [race["margin"] for race in samples]
        race_numbers = [race["race_number"] for race in samples]
        timing = [0] * RACE_SLOTS
        for number in race_numbers:
            if 1 <= number <= RACE_SLOTS:
                timing[number - 1] += 1
        item = {
            "track_id": track_id,
            "track_name": samples[0]["track_name"],
            "appearances": len(samples),
            "unique_teams": len({team["team_id"] for race in samples for team in race["teams"]}),
            "average_race_number": _round(sum(race_numbers) / len(race_numbers)),
            "average_margin": _round(sum(margins) / len(margins)),
            "median_margin": _round(median(margins)),
            "margin_variation": _round(pstdev(margins)) if len(margins) > 1 else 0.0,
            "even_race_rate": _round(
                100 * sum(value <= EVEN_MARGIN for value in margins) / len(margins)
            ),
            "blowout_rate": _round(
                100 * sum(value >= BLOWOUT_MARGIN for value in margins) / len(margins)
            ),
            "timing_counts": timing,
        }
        if track_id in selected:
            item["selected_team"] = selected[track_id]
        result.append(item)
    return sorted(result, key=lambda row: (-row["appearances"], row["track_name"]))


def get_track_analytics(
    session, *, league="ctc", season=None, division=None, team_id=None, min_plays=2
):
    if min_plays < 1 or min_plays > 500:
        raise DashboardError("min_races must be between 1 and 500.")
    scope = _resolve_scope(session, league, season, division)
    races = _race_records(_load_rows(session, scope, team_id=team_id))
    team_rows = _team_track_rows(races, team_id)
    tracks = [
        row for row in _track_rows(races, team_rows, team_id) if row["appearances"] >= min_plays
    ]
    reliable = [row for row in team_rows if row["races"] >= min_plays]
    selected_team = next(
        (team for race in races for team in race["teams"] if team["team_id"] == team_id), None
    )
    if team_id is not None and selected_team is None:
        team_row = session.execute(
            select(TeamSeasonEntry.display_name, TeamSeasonEntry.clan_tag, Team.canonical_name)
            .join(Team, Team.team_id == TeamSeasonEntry.team_id)
            .where(
                TeamSeasonEntry.team_id == team_id,
                TeamSeasonEntry.season_id == scope.season_id,
                TeamSeasonEntry.division_id == scope.division_id,
            )
        ).first()
        if team_row:
            selected_team = {
                "team_name": _team_name(
                    team_row.display_name, team_row.clan_tag, team_row.canonical_name
                )
            }

    def extreme(key, reverse=False):
        return (
            sorted(
                tracks,
                key=lambda row: (row[key], row["appearances"]),
                reverse=reverse,
            )[0]
            if tracks
            else None
        )

    return {
        "scope": {
            **_scope_payload(scope),
            "team_id": team_id,
            "team_name": selected_team and selected_team["team_name"],
        },
        "definitions": {
            "even_margin": EVEN_MARGIN,
            "blowout_margin": BLOWOUT_MARGIN,
            "standout_min_races": min_plays,
            "minimum_plays": min_plays,
            "match_set": "regular",
        },
        "summary": {
            "races": len(races),
            "tracks": len(tracks),
            "teams": len({team["team_id"] for race in races for team in race["teams"]}),
            "most_played": tracks[0] if tracks else None,
            "widest_average": extreme("average_margin", True),
            "closest_average": extreme("average_margin"),
        },
        "tracks": tracks,
        "standouts": {
            "strengths": reliable[:8],
            "struggles": sorted(reliable, key=lambda row: (row["lift"], -row["races"]))[:8],
        },
    }


def get_track_dashboard(
    session, track_id, *, league="ctc", season=None, division=None, team_id=None, min_plays=2
):
    if min_plays < 1 or min_plays > 500:
        raise DashboardError("min_races must be between 1 and 500.")
    scope = _resolve_scope(session, league, season, division)
    track = session.execute(
        select(Track.track_id, Track.canonical_name).where(
            Track.track_id == track_id, Track.league_code == scope.league_code
        )
    ).first()
    if track is None:
        raise DashboardNotFound("Track not found.")
    all_races = _race_records(_load_rows(session, scope, team_id=team_id))
    races = [race for race in all_races if race["track_id"] == track_id]
    team_rows = [
        row
        for row in _team_track_rows(all_races, team_id)
        if row["track_id"] == track_id and row["races"] >= min_plays
    ]
    rows = _track_rows(races, team_rows, team_id)
    metrics = (
        rows[0]
        if rows
        else {
            "track_id": track_id,
            "track_name": track.canonical_name,
            "appearances": 0,
            "unique_teams": 0,
            "average_race_number": None,
            "average_margin": None,
            "median_margin": None,
            "margin_variation": None,
            "even_race_rate": None,
            "blowout_rate": None,
            "timing_counts": [0] * RACE_SLOTS,
        }
    )
    buckets = [
        {"label": "0–5", "count": sum(race["margin"] <= 5 for race in races)},
        {"label": "6–10", "count": sum(6 <= race["margin"] <= 10 for race in races)},
        {"label": "11–19", "count": sum(11 <= race["margin"] <= 19 for race in races)},
        {"label": "20+", "count": sum(race["margin"] >= 20 for race in races)},
    ]
    aliases = [
        alias
        for alias in session.scalars(
            select(TrackAlias.alias_value)
            .where(TrackAlias.track_id == track_id)
            .order_by(TrackAlias.alias_value)
        )
        if alias.casefold() != track.canonical_name.casefold()
    ]
    recent = sorted(
        races,
        key=lambda race: (race["match_number"] or -1, race["match_id"], race["race_number"]),
        reverse=True,
    )[:12]
    return {
        "scope": {**_scope_payload(scope), "team_id": team_id},
        "track": {
            "track_id": track.track_id,
            "track_name": track.canonical_name,
            "aliases": aliases,
        },
        "definitions": {
            "even_margin": EVEN_MARGIN,
            "blowout_margin": BLOWOUT_MARGIN,
            "minimum_plays": min_plays,
            "match_set": "regular",
        },
        "metrics": metrics,
        "margin_buckets": buckets,
        "teams": sorted(
            team_rows, key=lambda row: (-row["average_margin"], -row["races"], row["team_name"])
        ),
        "recent_races": recent,
    }

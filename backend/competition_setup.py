import re
from collections import defaultdict
from datetime import date

from models import (
    Division,
    DivisionConference,
    DivisionPlayoffConfig,
    PlayoffSeries,
    Season,
    Team,
    TeamLeagueIdentity,
    TeamSeasonEntry,
)
from sqlalchemy import desc, func, select
from team_identity_management import apply_canonical_identity_priority

SUPPORTED_LEAGUES = frozenset({"ctc", "gsc"})
SEASON_STATUSES = frozenset({"unknown", "upcoming", "active", "complete"})
HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def _required_text(payload, field, label, maximum=200):
    value = str(payload.get(field) or "").strip()
    if not value:
        raise ValueError(f"{label} is required.")
    if len(value) > maximum:
        raise ValueError(f"{label} must be {maximum} characters or fewer.")
    return value


def _league_code(value):
    league = str(value or "").strip().casefold()
    if league not in SUPPORTED_LEAGUES:
        raise ValueError("League must be CTC or GSC.")
    return league


def _positive_int(payload, field, label, *, required=True):
    raw = payload.get(field)
    if raw in (None, "") and not required:
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be a number.") from error
    if value < 1:
        raise ValueError(f"{label} must be at least 1.")
    return value


def _optional_date(payload, field, label):
    value = str(payload.get(field) or "").strip()
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"{label} must use YYYY-MM-DD format.") from error


def _boolean(payload, field, *, default=False):
    value = payload.get(field, default)
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be true or false.")
    return value


def _conference_names(payload):
    names = payload.get("conference_names") or {}
    if not isinstance(names, dict):
        raise ValueError("Conference names must be an object.")
    return {
        "a": str(names.get("a") or "Conference A").strip(),
        "b": str(names.get("b") or "Conference B").strip(),
    }


def _ensure_conferences(session, division, names):
    existing = {
        conference.conference_code: conference
        for conference in session.scalars(
            select(DivisionConference)
            .where(DivisionConference.division_id == division.division_id)
            .order_by(DivisionConference.sort_order)
        ).all()
    }
    result = []
    for order, code in enumerate(("a", "b"), start=1):
        name = names[code]
        if not name:
            raise ValueError("Both conference names are required.")
        conference = existing.get(code)
        if conference is None:
            conference = DivisionConference(
                division_id=division.division_id,
                conference_code=code,
                conference_name=name,
                sort_order=order,
            )
            session.add(conference)
        else:
            conference.conference_name = name
            conference.sort_order = order
        result.append(conference)
    session.flush()
    return result


def _configure_playoffs(session, division, team_count):
    if team_count not in {3, 4}:
        raise ValueError("Playoff team count must be 3 or 4.")
    format_code = "three_team" if team_count == 3 else "four_team"
    config = session.get(DivisionPlayoffConfig, division.division_id)
    if config is not None and config.playoff_team_count != team_count:
        has_series = session.scalar(
            select(PlayoffSeries.playoff_series_id)
            .where(PlayoffSeries.division_id == division.division_id)
            .limit(1)
        )
        if has_series is not None:
            raise ValueError("Playoff format cannot change after playoff series have started.")
    if config is None:
        config = DivisionPlayoffConfig(division_id=division.division_id)
        session.add(config)
    config.format_code = format_code
    config.playoff_team_count = team_count
    config.semifinal_series_count = 1 if team_count == 3 else 2
    config.finals_bye_count = 1 if team_count == 3 else 0
    session.flush()
    return config


def _season_metadata(payload):
    code = _required_text(payload, "code", "Season code", 32).casefold()
    name = _required_text(payload, "name", "Season name")
    number = _positive_int(payload, "number", "Season number", required=False)
    if number is None:
        match = re.fullmatch(r"s(\d+)", code)
        number = int(match.group(1)) if match else None
    status = str(payload.get("status") or "upcoming").strip().casefold()
    if status not in SEASON_STATUSES:
        raise ValueError("Season status must be unknown, upcoming, active, or complete.")
    starts_on = _optional_date(payload, "starts_on", "Start date")
    ends_on = _optional_date(payload, "ends_on", "End date")
    if starts_on is not None and ends_on is not None and ends_on < starts_on:
        raise ValueError("End date cannot be before the start date.")
    return code, name, number, status, starts_on, ends_on


def _conference_payload(conference):
    return {
        "id": conference.division_conference_id,
        "code": conference.conference_code,
        "name": conference.conference_name,
        "sort_order": conference.sort_order,
    }


def _division_payload(division, conferences=(), playoff_config=None):
    return {
        "id": division.division_id,
        "code": division.division_code,
        "name": division.division_name,
        "is_conference_based": division.is_conference_based,
        "conferences": [_conference_payload(conference) for conference in conferences],
        "playoff_team_count": playoff_config.playoff_team_count if playoff_config else None,
    }


def _season_payload(season, divisions=(), conferences_by_division=None, playoff_configs=None):
    conferences_by_division = conferences_by_division or {}
    playoff_configs = playoff_configs or {}
    return {
        "id": season.season_id,
        "league": season.league_code,
        "code": season.season_code,
        "number": season.season_number,
        "name": season.name,
        "status": season.status,
        "starts_on": season.starts_on.isoformat() if season.starts_on else None,
        "ends_on": season.ends_on.isoformat() if season.ends_on else None,
        "divisions": [
            _division_payload(
                division,
                conferences_by_division.get(division.division_id, ()),
                playoff_configs.get(division.division_id),
            )
            for division in divisions
        ],
    }


def _team_payload(team, identities=()):
    return {
        "id": team.team_id,
        "canonical_name": team.canonical_name,
        "canonical_tag": team.canonical_tag,
        "league_identities": [
            {"league": identity.league_code, "tag": identity.tag} for identity in identities
        ],
    }


def _entry_payload(entry, team, season, division, conference=None):
    return {
        "id": entry.team_season_entry_id,
        "team": _team_payload(team),
        "season": {
            "id": season.season_id,
            "code": season.season_code,
            "name": season.name,
        },
        "division": {
            "id": division.division_id,
            "code": division.division_code,
            "name": division.division_name,
        },
        "display_name": entry.display_name,
        "clan_tag": entry.clan_tag,
        "hex_color": entry.hex_color,
        "competition_status": entry.competition_status,
        "conference": _conference_payload(conference) if conference else None,
    }


def get_catalog(session, league):
    league_code = _league_code(league)
    seasons = session.scalars(
        select(Season)
        .where(Season.league_code == league_code)
        .order_by(desc(Season.season_number).nulls_last(), desc(Season.season_id))
    ).all()
    season_ids = [season.season_id for season in seasons]
    divisions_by_season = {season_id: [] for season_id in season_ids}
    conferences_by_division = {}
    playoff_configs = {}
    if season_ids:
        divisions = session.scalars(
            select(Division)
            .where(Division.season_id.in_(season_ids))
            .order_by(Division.division_code, Division.division_id)
        ).all()
        for division in divisions:
            divisions_by_season[division.season_id].append(division)
        division_ids = [division.division_id for division in divisions]
        conferences = session.scalars(
            select(DivisionConference)
            .where(DivisionConference.division_id.in_(division_ids))
            .order_by(DivisionConference.division_id, DivisionConference.sort_order)
        ).all()
        conferences_by_division = {division_id: [] for division_id in division_ids}
        for conference in conferences:
            conferences_by_division[conference.division_id].append(conference)
        playoff_configs = {
            config.division_id: config
            for config in session.scalars(
                select(DivisionPlayoffConfig).where(
                    DivisionPlayoffConfig.division_id.in_(division_ids)
                )
            ).all()
        }

    teams = session.scalars(
        select(Team).order_by(func.lower(Team.canonical_name), func.lower(Team.canonical_tag))
    ).all()
    team_ids = [team.team_id for team in teams]
    identities_by_team = {team_id: [] for team_id in team_ids}
    if team_ids:
        identities = session.scalars(
            select(TeamLeagueIdentity)
            .where(TeamLeagueIdentity.team_id.in_(team_ids))
            .order_by(TeamLeagueIdentity.league_code, func.lower(TeamLeagueIdentity.tag))
        ).all()
        for identity in identities:
            identities_by_team[identity.team_id].append(identity)

    entry_rows = session.execute(
        select(TeamSeasonEntry, Team, Season, Division, DivisionConference)
        .join(Team, Team.team_id == TeamSeasonEntry.team_id)
        .join(Season, Season.season_id == TeamSeasonEntry.season_id)
        .join(Division, Division.division_id == TeamSeasonEntry.division_id)
        .outerjoin(
            DivisionConference,
            DivisionConference.division_conference_id == TeamSeasonEntry.conference_id,
        )
        .where(Season.league_code == league_code)
        .order_by(
            desc(Season.season_number).nulls_last(),
            Division.division_code,
            func.lower(TeamSeasonEntry.display_name),
        )
    ).all()
    return {
        "league": league_code,
        "seasons": [
            _season_payload(
                season,
                divisions_by_season[season.season_id],
                conferences_by_division,
                playoff_configs,
            )
            for season in seasons
        ],
        "teams": [_team_payload(team, identities_by_team[team.team_id]) for team in teams],
        "entries": [
            _entry_payload(entry, team, season, division, conference)
            for entry, team, season, division, conference in entry_rows
        ],
    }


def create_season(session, payload):
    if not isinstance(payload, dict):
        raise ValueError("Season details must be a JSON object.")
    league = _league_code(payload.get("league"))
    code, name, number, status, starts_on, ends_on = _season_metadata(payload)
    existing = session.scalar(
        select(Season).where(
            func.lower(Season.league_code) == league,
            func.lower(Season.season_code) == code,
        )
    )
    if existing is not None:
        raise ValueError(f"{league.upper()} {code.upper()} already exists.")
    season = Season(
        league_code=league,
        season_code=code,
        season_number=number,
        name=name,
        status=status,
        starts_on=starts_on,
        ends_on=ends_on,
    )
    session.add(season)
    session.flush()
    return season


def update_season(session, season_id, payload):
    if not isinstance(payload, dict):
        raise ValueError("Season details must be a JSON object.")
    season = session.get(Season, season_id)
    if season is None:
        raise LookupError("Season not found.")
    code, name, number, status, starts_on, ends_on = _season_metadata(payload)
    existing = session.scalar(
        select(Season).where(
            Season.season_id != season_id,
            func.lower(Season.league_code) == season.league_code.casefold(),
            func.lower(Season.season_code) == code,
        )
    )
    if existing is not None:
        raise ValueError(f"{season.league_code.upper()} {code.upper()} already exists.")
    previous = _season_payload(season)
    season.season_code = code
    season.season_number = number
    season.name = name
    season.status = status
    season.starts_on = starts_on
    season.ends_on = ends_on
    session.flush()
    return season, previous


def create_division(session, payload):
    if not isinstance(payload, dict):
        raise ValueError("Division details must be a JSON object.")
    season_id = _positive_int(payload, "season_id", "Season")
    season = session.get(Season, season_id)
    if season is None:
        raise LookupError("Season not found.")
    code = _required_text(payload, "code", "Division code", 32).casefold()
    name = _required_text(payload, "name", "Division name")
    existing = session.scalar(
        select(Division).where(
            Division.season_id == season_id,
            func.lower(Division.division_code) == code,
        )
    )
    if existing is not None:
        raise ValueError(f"{code.upper()} already exists in {season.name}.")
    conference_based = _boolean(payload, "is_conference_based")
    division = Division(
        season_id=season_id,
        division_code=code,
        division_name=name,
        is_conference_based=conference_based,
    )
    session.add(division)
    session.flush()
    if conference_based:
        _ensure_conferences(session, division, _conference_names(payload))
        _configure_playoffs(session, division, 4)
    else:
        _configure_playoffs(
            session,
            division,
            _positive_int(
                payload,
                "playoff_team_count",
                "Playoff team count",
                required=False,
            )
            or 3,
        )
    return division


def update_division(session, division_id, payload):
    if not isinstance(payload, dict):
        raise ValueError("Division details must be a JSON object.")
    division = session.get(Division, division_id)
    if division is None:
        raise LookupError("Division not found.")
    code = _required_text(payload, "code", "Division code", 32).casefold()
    name = _required_text(payload, "name", "Division name")
    conference_based = _boolean(
        payload, "is_conference_based", default=division.is_conference_based
    )
    existing = session.scalar(
        select(Division).where(
            Division.division_id != division_id,
            Division.season_id == division.season_id,
            func.lower(Division.division_code) == code,
        )
    )
    if existing is not None:
        raise ValueError(f"{code.upper()} already exists in this season.")
    previous = {
        "id": division.division_id,
        "code": division.division_code,
        "name": division.division_name,
        "is_conference_based": division.is_conference_based,
    }
    division.division_code = code
    division.division_name = name
    division.is_conference_based = conference_based
    conferences = []
    if conference_based:
        conferences = _ensure_conferences(session, division, _conference_names(payload))
        _configure_playoffs(session, division, 4)
    elif "playoff_team_count" in payload and payload.get("playoff_team_count") not in (None, ""):
        _configure_playoffs(
            session,
            division,
            _positive_int(payload, "playoff_team_count", "Playoff team count"),
        )

    entries = session.scalars(
        select(TeamSeasonEntry).where(TeamSeasonEntry.division_id == division_id)
    ).all()
    if not conference_based:
        for entry in entries:
            entry.conference_id = None
    elif "conference_assignments" in payload:
        assignments = payload.get("conference_assignments")
        if not isinstance(assignments, dict):
            raise ValueError("Conference assignments must be an object.")
        conferences_by_code = {conference.conference_code: conference for conference in conferences}
        counts = defaultdict(int)
        for entry in entries:
            code_value = str(assignments.get(str(entry.team_season_entry_id)) or "").casefold()
            conference = conferences_by_code.get(code_value)
            if conference is None:
                raise ValueError("Every team must be assigned to Conference A or Conference B.")
            entry.conference_id = conference.division_conference_id
            counts[code_value] += 1
        if any(count > 4 for count in counts.values()):
            raise ValueError("A conference cannot contain more than 4 teams.")
        if len(entries) == 8 and counts != {"a": 4, "b": 4}:
            raise ValueError("An 8-team conference division must have 4 teams per conference.")
    session.flush()
    return division, previous


def create_team(session, payload):
    if not isinstance(payload, dict):
        raise ValueError("Team details must be a JSON object.")
    league = _league_code(payload.get("league"))
    name = _required_text(payload, "canonical_name", "Canonical team name")
    tag = _required_text(payload, "canonical_tag", "Canonical team tag", 64)
    existing_identity = session.scalar(
        select(TeamLeagueIdentity).where(
            func.lower(TeamLeagueIdentity.league_code) == league,
            func.lower(TeamLeagueIdentity.tag) == tag.casefold(),
        )
    )
    if existing_identity is not None:
        raise ValueError(f"{tag} is already linked to a team in {league.upper()}.")
    team = Team(canonical_name=name, canonical_tag=tag)
    session.add(team)
    session.flush()
    session.add(TeamLeagueIdentity(team_id=team.team_id, league_code=league, tag=tag))
    session.flush()
    return team


def create_team_season_entry(session, payload):
    if not isinstance(payload, dict):
        raise ValueError("Team registration details must be a JSON object.")
    team_id = _positive_int(payload, "team_id", "Team")
    season_id = _positive_int(payload, "season_id", "Season")
    division_id = _positive_int(payload, "division_id", "Division")
    team = session.get(Team, team_id)
    season = session.get(Season, season_id)
    division = session.get(Division, division_id)
    if team is None:
        raise LookupError("Team not found.")
    if season is None:
        raise LookupError("Season not found.")
    if division is None or division.season_id != season_id:
        raise ValueError("Division must belong to the selected season.")
    existing_membership = session.scalar(
        select(TeamSeasonEntry).where(
            TeamSeasonEntry.team_id == team_id,
            TeamSeasonEntry.season_id == season_id,
        )
    )
    if existing_membership is not None:
        raise ValueError(f"{team.canonical_name} is already registered for {season.name}.")
    conference_id = _positive_int(payload, "conference_id", "Conference", required=False)
    if division.is_conference_based:
        conference = session.get(DivisionConference, conference_id) if conference_id else None
        if conference is None or conference.division_id != division_id:
            raise ValueError("Choose a conference in the selected division.")
        conference_size = session.scalar(
            select(func.count(TeamSeasonEntry.team_season_entry_id)).where(
                TeamSeasonEntry.conference_id == conference_id
            )
        )
        if conference_size >= 4:
            raise ValueError("That conference already has 4 teams.")
    elif conference_id is not None:
        raise ValueError("This division does not use conferences.")
    display_name = _required_text(payload, "display_name", "Season team name")
    clan_tag = _required_text(payload, "clan_tag", "Season team tag", 64)
    hex_color = str(payload.get("hex_color") or "").strip() or None
    if hex_color is not None and not HEX_COLOR_PATTERN.fullmatch(hex_color):
        raise ValueError("Team color must use six-digit hex format, such as #3B82F6.")
    conflicting_tag = session.scalar(
        select(TeamSeasonEntry).where(
            TeamSeasonEntry.season_id == season_id,
            TeamSeasonEntry.division_id == division_id,
            func.lower(TeamSeasonEntry.clan_tag) == clan_tag.casefold(),
        )
    )
    if conflicting_tag is not None:
        raise ValueError(f"{clan_tag} is already used in {division.division_name}.")
    identity = session.scalar(
        select(TeamLeagueIdentity).where(
            func.lower(TeamLeagueIdentity.league_code) == season.league_code.casefold(),
            func.lower(TeamLeagueIdentity.tag) == clan_tag.casefold(),
        )
    )
    if identity is not None and identity.team_id != team_id:
        raise ValueError(
            f"{clan_tag} is already linked to another team in {season.league_code.upper()}."
        )
    if identity is None:
        session.add(
            TeamLeagueIdentity(
                team_id=team_id,
                league_code=season.league_code,
                tag=clan_tag,
            )
        )
    entry = TeamSeasonEntry(
        team_id=team_id,
        season_id=season_id,
        division_id=division_id,
        conference_id=conference_id,
        display_name=display_name,
        clan_tag=clan_tag,
        hex_color=hex_color,
        competition_status="active",
    )
    session.add(entry)
    session.flush()
    apply_canonical_identity_priority(session, team)
    session.flush()
    return entry, team, season, division

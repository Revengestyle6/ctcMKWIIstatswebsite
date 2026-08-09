from models import Division, Season, Team, TeamAlias, TeamSeasonEntry
from sqlalchemy import desc, func, select

MAX_TEAM_NAME_LENGTH = 200
MAX_TEAM_TAG_LENGTH = 64


def _required_text(payload, field, label, maximum):
    value = str(payload.get(field) or "").strip()
    if not value:
        raise ValueError(f"{label} is required.")
    if len(value) > maximum:
        raise ValueError(f"{label} must be {maximum} characters or fewer.")
    return value


def get_team_identity(session, team_id):
    team = session.get(Team, team_id)
    if team is None:
        raise LookupError("Team not found.")
    rows = session.execute(
        select(TeamSeasonEntry, Season, Division)
        .join(Season, Season.season_id == TeamSeasonEntry.season_id)
        .join(Division, Division.division_id == TeamSeasonEntry.division_id)
        .where(TeamSeasonEntry.team_id == team_id)
        .order_by(
            desc(Season.season_number),
            Season.season_code,
            Division.division_code,
            TeamSeasonEntry.team_season_entry_id,
        )
    ).all()
    return {
        "team": {
            "id": team.team_id,
            "canonical_name": team.canonical_name,
            "canonical_tag": team.canonical_tag,
        },
        "season_entries": [
            {
                "id": entry.team_season_entry_id,
                "season": {
                    "id": season.season_id,
                    "code": season.season_code,
                    "name": season.name,
                    "season_number": season.season_number,
                },
                "division": {
                    "id": division.division_id,
                    "code": division.division_code,
                    "name": division.division_name,
                },
                "display_name": entry.display_name,
                "clan_tag": entry.clan_tag,
            }
            for entry, season, division in rows
        ],
    }


def update_canonical_identity(session, team_id, payload):
    if not isinstance(payload, dict):
        raise ValueError("Team identity updates must be a JSON object.")
    team = session.get(Team, team_id)
    if team is None:
        raise LookupError("Team not found.")
    canonical_name = _required_text(
        payload, "canonical_name", "Conventional team name", MAX_TEAM_NAME_LENGTH
    )
    canonical_tag = _required_text(
        payload, "canonical_tag", "Canonical team tag", MAX_TEAM_TAG_LENGTH
    )
    conflicting_team = session.scalar(
        select(Team).where(
            Team.team_id != team_id,
            func.lower(Team.canonical_tag) == canonical_tag.casefold(),
        )
    )
    if conflicting_team is not None:
        raise ValueError("That canonical tag is already assigned to another team.")
    conflicting_alias = session.scalar(
        select(TeamAlias).where(func.lower(TeamAlias.alias_value) == canonical_tag.casefold())
    )
    if conflicting_alias is not None and conflicting_alias.team_id != team_id:
        raise ValueError("That tag is already an alias for another team.")

    previous = {
        "canonical_name": team.canonical_name,
        "canonical_tag": team.canonical_tag,
    }
    if conflicting_alias is not None:
        session.delete(conflicting_alias)
    previous_tag = team.canonical_tag
    team.canonical_name = canonical_name
    team.canonical_tag = canonical_tag
    if previous_tag.casefold() != canonical_tag.casefold():
        existing_previous_alias = session.scalar(
            select(TeamAlias).where(func.lower(TeamAlias.alias_value) == previous_tag.casefold())
        )
        if existing_previous_alias is None:
            session.add(TeamAlias(team_id=team_id, alias_value=previous_tag))
    session.flush()
    return get_team_identity(session, team_id), previous


def update_season_identity(session, team_id, entry_id, payload):
    if not isinstance(payload, dict):
        raise ValueError("Season identity updates must be a JSON object.")
    entry = session.get(TeamSeasonEntry, entry_id)
    if entry is None or entry.team_id != team_id:
        raise LookupError("Team season entry not found.")
    display_name = _required_text(payload, "display_name", "Season team name", MAX_TEAM_NAME_LENGTH)
    clan_tag = _required_text(payload, "clan_tag", "Season team tag", MAX_TEAM_TAG_LENGTH)
    conflicting_entry = session.scalar(
        select(TeamSeasonEntry).where(
            TeamSeasonEntry.team_season_entry_id != entry_id,
            TeamSeasonEntry.season_id == entry.season_id,
            TeamSeasonEntry.division_id == entry.division_id,
            func.lower(TeamSeasonEntry.clan_tag) == clan_tag.casefold(),
        )
    )
    if conflicting_entry is not None:
        raise ValueError("That tag is already used by another team in this season and division.")
    previous = {"display_name": entry.display_name, "clan_tag": entry.clan_tag}
    entry.display_name = display_name
    entry.clan_tag = clan_tag
    session.flush()
    return get_team_identity(session, team_id), previous

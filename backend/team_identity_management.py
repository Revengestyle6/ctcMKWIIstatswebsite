from models import (
    Division,
    Match,
    MatchPlayer,
    MatchTeam,
    PlayerSeasonEntry,
    PlayoffSeries,
    PlayoffSeriesParticipant,
    Season,
    Team,
    TeamAlias,
    TeamLeagueIdentity,
    TeamLogo,
    TeamSeasonEntry,
)
from sqlalchemy import desc, func, select, update

MAX_TEAM_NAME_LENGTH = 200
MAX_TEAM_TAG_LENGTH = 64
SUPPORTED_LEAGUES = {"ctc", "gsc"}


def _required_text(payload, field, label, maximum):
    value = str(payload.get(field) or "").strip()
    if not value:
        raise ValueError(f"{label} is required.")
    if len(value) > maximum:
        raise ValueError(f"{label} must be {maximum} characters or fewer.")
    return value


def _latest_season_identity(session, team_id, league_code=None):
    statement = (
        select(TeamSeasonEntry)
        .join(Season, Season.season_id == TeamSeasonEntry.season_id)
        .where(TeamSeasonEntry.team_id == team_id)
        .order_by(
            desc(Season.season_number).nulls_last(),
            desc(Season.season_id),
            desc(TeamSeasonEntry.team_season_entry_id),
        )
        .limit(1)
    )
    if league_code:
        statement = statement.where(func.lower(Season.league_code) == league_code.casefold())
    return session.scalar(statement)


def _preserve_team_tag(session, team_id, tag):
    value = str(tag or "").strip()
    if not value:
        return
    canonical_owner = session.scalar(
        select(Team.team_id).where(
            Team.team_id != team_id,
            func.lower(Team.canonical_tag) == value.casefold(),
        )
    )
    if canonical_owner is not None:
        return
    existing = session.scalar(
        select(TeamAlias).where(func.lower(TeamAlias.alias_value) == value.casefold())
    )
    if existing is None:
        session.add(TeamAlias(team_id=team_id, alias_value=value))


def _set_canonical_identity(session, team, canonical_name, canonical_tag):
    name = str(canonical_name or "").strip()
    tag = str(canonical_tag or "").strip()
    if not name or not tag:
        raise ValueError("Canonical team name and tag are required.")
    promoted_alias = session.scalar(
        select(TeamAlias).where(
            TeamAlias.team_id == team.team_id,
            func.lower(TeamAlias.alias_value) == tag.casefold(),
        )
    )
    if promoted_alias is not None:
        session.delete(promoted_alias)
    if team.canonical_tag.casefold() != tag.casefold():
        _preserve_team_tag(session, team.team_id, team.canonical_tag)
    team.canonical_name = name
    team.canonical_tag = tag


def apply_canonical_identity_priority(session, team):
    if team.canonical_identity_override:
        return None
    identity = _latest_season_identity(session, team.team_id, team.canonical_league_preference)
    if identity is None and team.canonical_league_preference:
        identity = _latest_season_identity(session, team.team_id)
    if identity is not None:
        _set_canonical_identity(session, team, identity.display_name, identity.clan_tag)
    return identity


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
    league_identities = session.scalars(
        select(TeamLeagueIdentity)
        .where(TeamLeagueIdentity.team_id == team_id)
        .order_by(TeamLeagueIdentity.league_code, func.lower(TeamLeagueIdentity.tag))
    ).all()
    aliases = session.scalars(
        select(TeamAlias)
        .where(TeamAlias.team_id == team_id)
        .order_by(func.lower(TeamAlias.alias_value))
    ).all()
    return {
        "team": {
            "id": team.team_id,
            "canonical_name": team.canonical_name,
            "canonical_tag": team.canonical_tag,
            "canonical_identity_override": team.canonical_identity_override,
            "canonical_league_preference": team.canonical_league_preference,
        },
        "league_identities": [
            {
                "id": identity.team_league_identity_id,
                "league": identity.league_code,
                "tag": identity.tag,
            }
            for identity in league_identities
        ],
        "aliases": [{"id": alias.team_alias_id, "value": alias.alias_value} for alias in aliases],
        "season_entries": [
            {
                "id": entry.team_season_entry_id,
                "season": {
                    "id": season.season_id,
                    "league": season.league_code,
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
                "competition_status": entry.competition_status,
                "competition_status_note": entry.competition_status_note,
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
    if not team.canonical_identity_override:
        raise ValueError(
            "Enable the canonical-identity override before manually editing this team."
        )
    canonical_name = _required_text(
        payload, "canonical_name", "Conventional team name", MAX_TEAM_NAME_LENGTH
    )
    canonical_tag = _required_text(
        payload, "canonical_tag", "Canonical team tag", MAX_TEAM_TAG_LENGTH
    )
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
    _set_canonical_identity(session, team, canonical_name, canonical_tag)
    session.flush()
    return get_team_identity(session, team_id), previous


def update_canonical_preference(session, team_id, payload):
    team = session.get(Team, team_id)
    if team is None:
        raise LookupError("Team not found.")
    raw_league = payload.get("league")
    league_code = str(raw_league or "").strip().casefold() or None
    if league_code is not None and league_code not in SUPPORTED_LEAGUES:
        raise ValueError("Canonical league preference must be CTC, GSC, or automatic.")
    previous = {
        "canonical_league_preference": team.canonical_league_preference,
        "canonical_name": team.canonical_name,
        "canonical_tag": team.canonical_tag,
    }
    team.canonical_league_preference = league_code
    apply_canonical_identity_priority(session, team)
    session.flush()
    return get_team_identity(session, team_id), previous


def update_canonical_override(session, team_id, payload):
    team = session.get(Team, team_id)
    if team is None:
        raise LookupError("Team not found.")
    enabled = payload.get("enabled")
    if not isinstance(enabled, bool):
        raise ValueError("Canonical-identity override must be true or false.")
    previous = {
        "enabled": team.canonical_identity_override,
        "canonical_name": team.canonical_name,
        "canonical_tag": team.canonical_tag,
    }
    team.canonical_identity_override = enabled
    if not enabled:
        apply_canonical_identity_priority(session, team)
    session.flush()
    return get_team_identity(session, team_id), previous


def add_league_identity(session, team_id, payload):
    team = session.get(Team, team_id)
    if team is None:
        raise LookupError("Team not found.")
    league_code = _required_text(payload, "league", "League", 32).casefold()
    tag = _required_text(payload, "tag", "League team tag", MAX_TEAM_TAG_LENGTH)
    existing = session.scalar(
        select(TeamLeagueIdentity).where(
            func.lower(TeamLeagueIdentity.league_code) == league_code,
            func.lower(TeamLeagueIdentity.tag) == tag.casefold(),
        )
    )
    if existing is not None:
        if existing.team_id == team_id:
            raise ValueError("That league tag is already linked to this team.")
        raise ValueError("That league tag is already linked to another team.")
    identity = TeamLeagueIdentity(team_id=team_id, league_code=league_code, tag=tag)
    session.add(identity)
    session.flush()
    return get_team_identity(session, team_id), identity


def delete_league_identity(session, team_id, identity_id):
    identity = session.scalar(
        select(TeamLeagueIdentity).where(
            TeamLeagueIdentity.team_league_identity_id == identity_id,
            TeamLeagueIdentity.team_id == team_id,
        )
    )
    if identity is None:
        raise LookupError("League identity not found.")
    deleted = {"league": identity.league_code, "tag": identity.tag}
    session.delete(identity)
    session.flush()
    return get_team_identity(session, team_id), deleted


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
    apply_canonical_identity_priority(session, session.get(Team, team_id))
    session.flush()
    return get_team_identity(session, team_id), previous


def _team_match_ids(session, team_id):
    return set(
        session.scalars(
            select(MatchTeam.match_id)
            .join(
                TeamSeasonEntry,
                TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
            )
            .where(TeamSeasonEntry.team_id == team_id)
        ).all()
    )


def _team_playoff_series_ids(session, team_id):
    return set(
        session.scalars(
            select(PlayoffSeriesParticipant.playoff_series_id).where(
                PlayoffSeriesParticipant.team_id == team_id
            )
        ).all()
    )


def _team_merge_state(session, source_team_id, target_team_id, *, lock=False):
    if source_team_id == target_team_id:
        raise ValueError("A team cannot be merged into itself.")
    statement = select(Team).where(Team.team_id.in_([source_team_id, target_team_id]))
    if lock:
        statement = statement.with_for_update()
    teams = session.scalars(statement).all()
    by_id = {team.team_id: team for team in teams}
    source = by_id.get(source_team_id)
    target = by_id.get(target_team_id)
    if source is None:
        raise LookupError("Team to merge was not found.")
    if target is None:
        raise LookupError("Destination team was not found.")

    overlapping_match_ids = sorted(
        _team_match_ids(session, source_team_id) & _team_match_ids(session, target_team_id)
    )
    overlapping_matches = []
    if overlapping_match_ids:
        overlapping_matches = [
            {"id": match.match_id, "label": match.match_label}
            for match in session.scalars(
                select(Match)
                .where(Match.match_id.in_(overlapping_match_ids))
                .order_by(Match.match_id)
            )
        ]
    overlapping_series_ids = sorted(
        _team_playoff_series_ids(session, source_team_id)
        & _team_playoff_series_ids(session, target_team_id)
    )
    overlapping_series = []
    if overlapping_series_ids:
        overlapping_series = [
            {
                "id": series.playoff_series_id,
                "label": series.display_label or f"{series.stage.title()} {series.series_number}",
            }
            for series in session.scalars(
                select(PlayoffSeries)
                .where(PlayoffSeries.playoff_series_id.in_(overlapping_series_ids))
                .order_by(PlayoffSeries.playoff_series_id)
            )
        ]
    return source, target, overlapping_matches, overlapping_series


def team_merge_comparison(session, source_team_id, target_team_id):
    _source, _target, overlapping_matches, overlapping_series = _team_merge_state(
        session, source_team_id, target_team_id
    )

    def count(model, team_id):
        return (
            session.scalar(select(func.count()).select_from(model).where(model.team_id == team_id))
            or 0
        )

    source_scopes = set(
        session.execute(
            select(TeamSeasonEntry.season_id, TeamSeasonEntry.division_id).where(
                TeamSeasonEntry.team_id == source_team_id
            )
        ).all()
    )
    target_scopes = set(
        session.execute(
            select(TeamSeasonEntry.season_id, TeamSeasonEntry.division_id).where(
                TeamSeasonEntry.team_id == target_team_id
            )
        ).all()
    )
    blockers = []
    if overlapping_matches:
        labels = ", ".join(
            f"{match['label']} (ID {match['id']})" for match in overlapping_matches[:5]
        )
        suffix = "" if len(overlapping_matches) <= 5 else " and more"
        blockers.append(
            "Both teams appear in the same match, so they cannot be safely merged: "
            f"{labels}{suffix}."
        )
    if overlapping_series:
        labels = ", ".join(
            f"{series['label']} (ID {series['id']})" for series in overlapping_series[:5]
        )
        suffix = "" if len(overlapping_series) <= 5 else " and more"
        blockers.append(
            f"Both teams are participants in the same playoff series: {labels}{suffix}."
        )
    source_match_appearances = session.scalar(
        select(func.count())
        .select_from(MatchTeam)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id,
        )
        .where(TeamSeasonEntry.team_id == source_team_id)
    )
    source_player_memberships = session.scalar(
        select(func.count())
        .select_from(PlayerSeasonEntry)
        .join(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == PlayerSeasonEntry.team_season_entry_id,
        )
        .where(TeamSeasonEntry.team_id == source_team_id)
    )
    return {
        "source": get_team_identity(session, source_team_id),
        "target": get_team_identity(session, target_team_id),
        "impact": {
            "aliases": count(TeamAlias, source_team_id),
            "league_identities": count(TeamLeagueIdentity, source_team_id),
            "season_entries": count(TeamSeasonEntry, source_team_id),
            "overlapping_season_entries": len(source_scopes & target_scopes),
            "logos": count(TeamLogo, source_team_id),
            "playoff_participants": count(PlayoffSeriesParticipant, source_team_id),
            "match_appearances": source_match_appearances or 0,
            "player_memberships": source_player_memberships or 0,
        },
        "overlapping_matches": overlapping_matches,
        "overlapping_series": overlapping_series,
        "blockers": blockers,
    }


def _minimum_optional(left, right):
    values = [value for value in (left, right) if value is not None]
    return min(values) if values else None


def _maximum_optional(left, right):
    values = [value for value in (left, right) if value is not None]
    return max(values) if values else None


def _merge_player_memberships(session, source_entry, target_entry):
    source_memberships = session.scalars(
        select(PlayerSeasonEntry).where(
            PlayerSeasonEntry.team_season_entry_id == source_entry.team_season_entry_id
        )
    ).all()
    target_memberships = {
        membership.player_id: membership
        for membership in session.scalars(
            select(PlayerSeasonEntry).where(
                PlayerSeasonEntry.team_season_entry_id == target_entry.team_season_entry_id
            )
        ).all()
    }
    consolidated = 0
    for membership in source_memberships:
        existing = target_memberships.get(membership.player_id)
        if existing is None:
            membership.team_season_entry_id = target_entry.team_season_entry_id
            target_memberships[membership.player_id] = membership
            continue
        session.execute(
            update(MatchPlayer)
            .where(MatchPlayer.player_season_entry_id == membership.player_season_entry_id)
            .values(player_season_entry_id=existing.player_season_entry_id)
        )
        existing.primary_lounge_name = (
            existing.primary_lounge_name or membership.primary_lounge_name
        )
        existing.primary_mii_name = existing.primary_mii_name or membership.primary_mii_name
        existing.flag = existing.flag or membership.flag
        existing.first_seen_match_id = _minimum_optional(
            existing.first_seen_match_id, membership.first_seen_match_id
        )
        existing.last_seen_match_id = _maximum_optional(
            existing.last_seen_match_id, membership.last_seen_match_id
        )
        session.delete(membership)
        consolidated += 1
    return consolidated


def merge_team(session, source_team_id, payload):
    try:
        target_team_id = int(payload.get("target_team_id"))
    except (TypeError, ValueError) as error:
        raise ValueError("Destination team is required.") from error
    source, target, overlapping_matches, overlapping_series = _team_merge_state(
        session, source_team_id, target_team_id, lock=True
    )
    if overlapping_matches or overlapping_series:
        raise ValueError("These team records have conflicting history and cannot be safely merged.")

    source_aliases = session.scalars(
        select(TeamAlias).where(TeamAlias.team_id == source_team_id)
    ).all()
    target_aliases = {
        alias.alias_value.casefold(): alias
        for alias in session.scalars(
            select(TeamAlias).where(TeamAlias.team_id == target_team_id)
        ).all()
    }
    aliases_moved = 0
    aliases_consolidated = 0
    for alias in source_aliases:
        if alias.alias_value.casefold() in target_aliases:
            session.delete(alias)
            aliases_consolidated += 1
        else:
            alias.team_id = target_team_id
            target_aliases[alias.alias_value.casefold()] = alias
            aliases_moved += 1
    if target.canonical_tag.casefold() != source.canonical_tag.casefold():
        _preserve_team_tag(session, target_team_id, source.canonical_tag)

    source_league_identities = session.scalars(
        select(TeamLeagueIdentity).where(TeamLeagueIdentity.team_id == source_team_id)
    ).all()
    target_league_keys = {
        (identity.league_code.casefold(), identity.tag.casefold())
        for identity in session.scalars(
            select(TeamLeagueIdentity).where(TeamLeagueIdentity.team_id == target_team_id)
        ).all()
    }
    league_identities_consolidated = 0
    for identity in source_league_identities:
        key = (identity.league_code.casefold(), identity.tag.casefold())
        if key in target_league_keys:
            session.delete(identity)
            league_identities_consolidated += 1
        else:
            identity.team_id = target_team_id
            target_league_keys.add(key)

    target_entries = {
        (entry.season_id, entry.division_id): entry
        for entry in session.scalars(
            select(TeamSeasonEntry).where(TeamSeasonEntry.team_id == target_team_id)
        ).all()
    }
    source_entries = session.scalars(
        select(TeamSeasonEntry).where(TeamSeasonEntry.team_id == source_team_id)
    ).all()
    source_player_membership_count = (
        session.scalar(
            select(func.count())
            .select_from(PlayerSeasonEntry)
            .where(
                PlayerSeasonEntry.team_season_entry_id.in_(
                    [entry.team_season_entry_id for entry in source_entries]
                )
            )
        )
        if source_entries
        else 0
    ) or 0
    season_entries_consolidated = 0
    player_memberships_consolidated = 0
    match_appearances_updated = 0
    for entry in source_entries:
        target_entry = target_entries.get((entry.season_id, entry.division_id))
        if target_entry is None:
            entry.team_id = target_team_id
            target_entries[(entry.season_id, entry.division_id)] = entry
            continue
        consolidated = _merge_player_memberships(session, entry, target_entry)
        player_memberships_consolidated += consolidated
        match_result = session.execute(
            update(MatchTeam)
            .where(MatchTeam.team_season_entry_id == entry.team_season_entry_id)
            .values(team_season_entry_id=target_entry.team_season_entry_id)
        )
        match_appearances_updated += match_result.rowcount
        session.delete(entry)
        season_entries_consolidated += 1

    source_logos = session.scalars(select(TeamLogo).where(TeamLogo.team_id == source_team_id)).all()
    target_logo_keys = {
        (logo.season_id, logo.asset_path): logo
        for logo in session.scalars(
            select(TeamLogo).where(TeamLogo.team_id == target_team_id)
        ).all()
    }
    logos_consolidated = 0
    for logo in source_logos:
        if (logo.season_id, logo.asset_path) in target_logo_keys:
            session.delete(logo)
            logos_consolidated += 1
        else:
            logo.team_id = target_team_id

    playoff_result = session.execute(
        update(PlayoffSeriesParticipant)
        .where(PlayoffSeriesParticipant.team_id == source_team_id)
        .values(team_id=target_team_id)
    )
    session.flush()
    apply_canonical_identity_priority(session, target)
    session.flush()

    merged = {
        "id": source.team_id,
        "canonical_name": source.canonical_name,
        "canonical_tag": source.canonical_tag,
    }
    session.delete(source)
    session.flush()
    return {
        "target": get_team_identity(session, target_team_id),
        "merged": merged,
        "aliases_moved": aliases_moved,
        "aliases_consolidated": aliases_consolidated,
        "league_identities_moved": len(source_league_identities) - league_identities_consolidated,
        "league_identities_consolidated": league_identities_consolidated,
        "season_entries_moved": len(source_entries) - season_entries_consolidated,
        "season_entries_consolidated": season_entries_consolidated,
        "player_memberships_moved": source_player_membership_count
        - player_memberships_consolidated,
        "player_memberships_consolidated": player_memberships_consolidated,
        "match_appearances_updated": match_appearances_updated,
        "logos_moved": len(source_logos) - logos_consolidated,
        "logos_consolidated": logos_consolidated,
        "playoff_participants_updated": playoff_result.rowcount,
    }

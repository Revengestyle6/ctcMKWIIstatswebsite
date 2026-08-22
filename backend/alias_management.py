from models import (
    Division,
    Player,
    PlayerAlias,
    PlayerFriendCode,
    PlayerSeasonEntry,
    Race,
    Season,
    Team,
    TeamAlias,
    TeamSeasonEntry,
    Track,
    TrackAlias,
)
from sqlalchemy import func, or_, select, update

ENTITY_TYPES = {"players", "teams", "tracks"}
PLAYER_ALIAS_TYPES = ("lounge_name", "table_name", "mii_name")


def _entity_model(entity_type):
    return {"players": Player, "teams": Team, "tracks": Track}.get(entity_type)


def _alias_model(entity_type):
    return {"players": PlayerAlias, "teams": TeamAlias, "tracks": TrackAlias}.get(entity_type)


def _identity_column(entity_type, model):
    attribute = {"players": "player_id", "teams": "team_id", "tracks": "track_id"}[entity_type]
    return getattr(model, attribute)


def _alias_identity_column(entity_type, model):
    return getattr(
        model,
        {"players": "player_id", "teams": "team_id", "tracks": "track_id"}[entity_type],
    )


def _label(entity_type, entity):
    if entity_type == "players":
        return entity.canonical_name or entity.primary_friend_code or f"Player {entity.player_id}"
    if entity_type == "teams":
        return f"{entity.canonical_tag} — {entity.canonical_name}"
    return entity.canonical_name


def _secondary(entity_type, entity):
    if entity_type == "players":
        return entity.primary_friend_code
    if entity_type == "teams":
        return entity.canonical_tag
    if entity_type == "tracks":
        return entity.league_code.upper()
    return None


def list_entities(session, entity_type, query="", limit=200, league_code=None):
    model = _entity_model(entity_type)
    alias_model = _alias_model(entity_type)
    if model is None:
        raise ValueError("Object type must be players, teams, or tracks.")
    identity = _identity_column(entity_type, model)
    alias_identity = _alias_identity_column(entity_type, alias_model)
    statement = (
        select(model, func.count(alias_model.alias_value).label("alias_count"))
        .outerjoin(alias_model, alias_identity == identity)
        .group_by(identity)
    )
    normalized_league = str(league_code or "").strip().casefold()
    if normalized_league:
        if entity_type != "tracks":
            raise ValueError("League filtering is available only for tracks.")
        statement = statement.where(func.lower(Track.league_code) == normalized_league)
    normalized_query = str(query or "").strip().casefold()
    if normalized_query:
        pattern = f"%{normalized_query}%"
        if entity_type == "players":
            predicate = or_(
                func.lower(func.coalesce(model.canonical_name, "")).like(pattern),
                func.lower(func.coalesce(model.primary_friend_code, "")).like(pattern),
                func.bool_or(func.lower(func.coalesce(alias_model.alias_value, "")).like(pattern)),
            )
        elif entity_type == "teams":
            predicate = or_(
                func.lower(model.canonical_name).like(pattern),
                func.lower(model.canonical_tag).like(pattern),
                func.bool_or(func.lower(func.coalesce(alias_model.alias_value, "")).like(pattern)),
            )
        else:
            predicate = or_(
                func.lower(model.canonical_name).like(pattern),
                func.bool_or(func.lower(func.coalesce(alias_model.alias_value, "")).like(pattern)),
            )
        statement = statement.having(predicate)
    rows = session.execute(
        statement.order_by(func.lower(_sort_column(entity_type, model))).limit(limit)
    )
    return [
        {
            "id": getattr(entity, identity.key),
            "label": _label(entity_type, entity),
            "secondary": _secondary(entity_type, entity),
            "alias_count": alias_count,
        }
        for entity, alias_count in rows
    ]


def _sort_column(entity_type, model):
    if entity_type == "players":
        return func.coalesce(model.canonical_name, model.primary_friend_code, "")
    if entity_type == "teams":
        return model.canonical_tag
    return model.canonical_name


def get_entity(session, entity_type, entity_id):
    model = _entity_model(entity_type)
    alias_model = _alias_model(entity_type)
    if model is None:
        raise ValueError("Object type must be players, teams, or tracks.")
    identity = _identity_column(entity_type, model)
    entity = session.scalar(select(model).where(identity == entity_id))
    if entity is None:
        raise LookupError("Alias object not found.")
    alias_identity = _alias_identity_column(entity_type, alias_model)
    order_columns = (
        (alias_model.alias_type, func.lower(alias_model.alias_value))
        if entity_type == "players"
        else (func.lower(alias_model.alias_value),)
    )
    aliases = session.scalars(
        select(alias_model).where(alias_identity == entity_id).order_by(*order_columns)
    ).all()
    serialized = []
    for alias in aliases:
        item = {
            "id": getattr(alias, f"{entity_type[:-1]}_alias_id"),
            "type": alias.alias_type if entity_type == "players" else "alias",
            "value": alias.alias_value,
        }
        if entity_type == "players":
            item["first_seen_match_id"] = alias.first_seen_match_id
            item["last_seen_match_id"] = alias.last_seen_match_id
        serialized.append(item)
    alias_types = list(PLAYER_ALIAS_TYPES)
    if entity_type == "players":
        alias_types.extend(
            alias_type
            for alias_type in sorted({alias["type"] for alias in serialized})
            if alias_type not in alias_types
        )
    else:
        alias_types = ["alias"]
    detail = {
        "id": entity_id,
        "label": _label(entity_type, entity),
        "canonical_name": entity.canonical_name if entity_type in {"players", "tracks"} else None,
        "secondary": _secondary(entity_type, entity),
        "alias_types": alias_types,
        "aliases": serialized,
        "friend_codes": [],
        "season_entries": [],
    }
    if entity_type == "tracks":
        detail["race_count"] = session.scalar(
            select(func.count(Race.race_id)).where(Race.track_id == entity_id)
        )
    if entity_type == "players":
        friend_codes = session.scalars(
            select(PlayerFriendCode)
            .where(PlayerFriendCode.player_id == entity_id)
            .order_by(PlayerFriendCode.friend_code)
        ).all()
        detail["friend_codes"] = [
            {
                "id": friend_code.player_friend_code_id,
                "value": friend_code.friend_code,
                "is_primary": friend_code.friend_code == entity.primary_friend_code,
                "first_seen_match_id": friend_code.first_seen_match_id,
                "last_seen_match_id": friend_code.last_seen_match_id,
            }
            for friend_code in friend_codes
        ]
        if entity.primary_friend_code and not any(
            item["value"] == entity.primary_friend_code for item in detail["friend_codes"]
        ):
            detail["friend_codes"].insert(
                0,
                {
                    "id": None,
                    "value": entity.primary_friend_code,
                    "is_primary": True,
                    "first_seen_match_id": None,
                    "last_seen_match_id": None,
                },
            )

        season_entries = session.execute(
            select(
                PlayerSeasonEntry,
                Season.league_code,
                Season.season_code,
                Division.division_code,
                Team.team_id,
                Team.canonical_name,
                TeamSeasonEntry.clan_tag,
                TeamSeasonEntry.display_name,
            )
            .join(Season, Season.season_id == PlayerSeasonEntry.season_id)
            .join(Division, Division.division_id == PlayerSeasonEntry.division_id)
            .join(
                TeamSeasonEntry,
                TeamSeasonEntry.team_season_entry_id == PlayerSeasonEntry.team_season_entry_id,
            )
            .join(Team, Team.team_id == TeamSeasonEntry.team_id)
            .where(PlayerSeasonEntry.player_id == entity_id)
            .order_by(
                Season.league_code,
                Season.season_number,
                Season.season_code,
                Division.division_code,
                TeamSeasonEntry.clan_tag,
            )
        ).all()
        detail["season_entries"] = [
            {
                "id": entry.player_season_entry_id,
                "league": league_code,
                "season": season_code,
                "division": division_code,
                "team": {
                    "id": team_id,
                    "canonical_name": canonical_name,
                    "clan_tag": clan_tag,
                    "display_name": display_name,
                },
                "primary_lounge_name": entry.primary_lounge_name,
                "primary_mii_name": entry.primary_mii_name,
                "flag": entry.flag,
                "first_seen_match_id": entry.first_seen_match_id,
                "last_seen_match_id": entry.last_seen_match_id,
            }
            for (
                entry,
                league_code,
                season_code,
                division_code,
                team_id,
                canonical_name,
                clan_tag,
                display_name,
            ) in season_entries
        ]
    return detail


def update_player_canonical_name(session, player_id, payload):
    player = session.get(Player, player_id)
    if player is None:
        raise LookupError("Player not found.")
    canonical_name = str(payload.get("canonical_name") or "").strip()
    if not canonical_name:
        raise ValueError("Canonical name is required.")
    previous_name = player.canonical_name
    player.canonical_name = canonical_name
    session.flush()
    return get_entity(session, "players", player_id), previous_name


def update_track_canonical_name(session, track_id, payload):
    track = session.get(Track, track_id)
    if track is None:
        raise LookupError("Track not found.")
    canonical_name = str(payload.get("canonical_name") or "").strip()
    if not canonical_name:
        raise ValueError("Canonical track name is required.")
    if len(canonical_name) > 200:
        raise ValueError("Canonical track name must be 200 characters or fewer.")

    conflicting_track = session.scalar(
        select(Track).where(
            Track.track_id != track_id,
            func.lower(Track.league_code) == track.league_code.casefold(),
            func.lower(Track.canonical_name) == canonical_name.casefold(),
        )
    )
    if conflicting_track is not None:
        raise ValueError(
            "That name belongs to another track in this league. Merge into it instead."
        )
    conflicting_alias = session.scalar(
        select(TrackAlias)
        .join(Track, Track.track_id == TrackAlias.track_id)
        .where(
            TrackAlias.track_id != track_id,
            func.lower(Track.league_code) == track.league_code.casefold(),
            func.lower(TrackAlias.alias_value) == canonical_name.casefold(),
        )
    )
    if conflicting_alias is not None:
        raise ValueError("That name is an alias for another track in this league.")

    previous_name = track.canonical_name
    promoted_alias = session.scalar(
        select(TrackAlias).where(
            TrackAlias.track_id == track_id,
            func.lower(TrackAlias.alias_value) == canonical_name.casefold(),
        )
    )
    if promoted_alias is not None:
        session.delete(promoted_alias)
    if previous_name.casefold() != canonical_name.casefold():
        previous_alias = session.scalar(
            select(TrackAlias).where(
                TrackAlias.track_id == track_id,
                func.lower(TrackAlias.alias_value) == previous_name.casefold(),
            )
        )
        if previous_alias is None:
            session.add(TrackAlias(track_id=track_id, alias_value=previous_name))

    track.canonical_name = canonical_name
    race_result = session.execute(
        update(Race).where(Race.track_id == track_id).values(track_name_raw=canonical_name)
    )
    session.flush()
    return get_entity(session, "tracks", track_id), {
        "previous_name": previous_name,
        "races_updated": race_result.rowcount,
    }


def merge_track(session, source_track_id, payload):
    try:
        target_track_id = int(payload.get("target_track_id"))
    except (TypeError, ValueError) as error:
        raise ValueError("Destination track is required.") from error
    if source_track_id == target_track_id:
        raise ValueError("A track cannot be merged into itself.")

    tracks = session.scalars(
        select(Track)
        .where(Track.track_id.in_([source_track_id, target_track_id]))
        .with_for_update()
    ).all()
    by_id = {track.track_id: track for track in tracks}
    source = by_id.get(source_track_id)
    target = by_id.get(target_track_id)
    if source is None:
        raise LookupError("Track to merge was not found.")
    if target is None:
        raise LookupError("Destination track was not found.")
    if source.league_code.casefold() != target.league_code.casefold():
        raise ValueError("Tracks can only be merged within the same league.")

    source_aliases = session.scalars(
        select(TrackAlias).where(TrackAlias.track_id == source_track_id)
    ).all()
    candidate_values = [source.canonical_name, *(alias.alias_value for alias in source_aliases)]
    target_alias_values = {
        value.casefold()
        for value in session.scalars(
            select(TrackAlias.alias_value).where(TrackAlias.track_id == target_track_id)
        )
    }
    aliases_moved = 0
    for value in candidate_values:
        normalized_value = value.casefold()
        if (
            normalized_value == target.canonical_name.casefold()
            or normalized_value in target_alias_values
        ):
            continue
        conflict = session.scalar(
            select(Track.track_id)
            .outerjoin(TrackAlias, TrackAlias.track_id == Track.track_id)
            .where(
                Track.track_id.notin_([source_track_id, target_track_id]),
                func.lower(Track.league_code) == source.league_code.casefold(),
                or_(
                    func.lower(Track.canonical_name) == normalized_value,
                    func.lower(TrackAlias.alias_value) == normalized_value,
                ),
            )
            .limit(1)
        )
        if conflict is not None:
            raise ValueError(
                f"Cannot preserve “{value}” because it is already assigned to another track."
            )
        session.add(TrackAlias(track_id=target_track_id, alias_value=value))
        target_alias_values.add(normalized_value)
        aliases_moved += 1

    race_result = session.execute(
        update(Race)
        .where(Race.track_id == source_track_id)
        .values(track_id=target_track_id, track_name_raw=target.canonical_name)
    )
    for alias in source_aliases:
        session.delete(alias)
    session.flush()
    session.delete(source)
    session.flush()
    return {
        "target": get_entity(session, "tracks", target_track_id),
        "merged": {
            "id": source_track_id,
            "canonical_name": source.canonical_name,
        },
        "races_updated": race_result.rowcount,
        "aliases_moved": aliases_moved,
    }


def add_alias(session, entity_type, entity_id, payload):
    detail = get_entity(session, entity_type, entity_id)
    value = str(payload.get("value") or "").strip()
    if not value:
        raise ValueError("Alias value is required.")
    alias_model = _alias_model(entity_type)
    alias_identity = _alias_identity_column(entity_type, alias_model)
    conditions = [
        alias_identity == entity_id,
        func.lower(alias_model.alias_value) == value.casefold(),
    ]
    alias_type = "alias"
    if entity_type == "players":
        alias_type = str(payload.get("type") or "").strip()
        if not alias_type:
            raise ValueError("Player alias type is required.")
        conditions.append(alias_model.alias_type == alias_type)
    existing = session.scalar(select(alias_model).where(*conditions))
    if existing is not None:
        raise ValueError("That alias is already assigned to this object.")
    if entity_type == "teams":
        conflicting = session.scalar(
            select(alias_model).where(func.lower(alias_model.alias_value) == value.casefold())
        )
        if conflicting is not None:
            raise ValueError("That alias is already assigned to another object.")
    elif entity_type == "tracks":
        track = session.get(Track, entity_id)
        conflicting = session.scalar(
            select(TrackAlias)
            .join(Track, Track.track_id == TrackAlias.track_id)
            .where(
                func.lower(Track.league_code) == track.league_code.casefold(),
                func.lower(TrackAlias.alias_value) == value.casefold(),
            )
        )
        if conflicting is not None:
            raise ValueError("That alias is already assigned to another track in this league.")
        canonical_track = session.scalar(
            select(Track).where(
                func.lower(Track.league_code) == track.league_code.casefold(),
                func.lower(Track.canonical_name) == value.casefold(),
            )
        )
        if canonical_track is not None:
            if canonical_track.track_id == entity_id:
                raise ValueError("That value is already this track's canonical name.")
            raise ValueError("That value is another track's canonical name in this league.")
    if entity_type == "teams":
        canonical_team = session.scalar(
            select(Team).where(func.lower(Team.canonical_tag) == value.casefold())
        )
        if canonical_team is not None:
            if canonical_team.team_id == entity_id:
                raise ValueError("That value is already this team's canonical tag.")
            raise ValueError("That value is another team's canonical tag.")
    values = {alias_identity.key: entity_id, "alias_value": value}
    if entity_type == "players":
        values["alias_type"] = alias_type
    alias = alias_model(**values)
    session.add(alias)
    session.flush()
    return get_entity(session, entity_type, detail["id"]), alias


def delete_alias(session, entity_type, entity_id, alias_id):
    detail = get_entity(session, entity_type, entity_id)
    alias_model = _alias_model(entity_type)
    alias_identity = _alias_identity_column(entity_type, alias_model)
    alias_pk = getattr(alias_model, f"{entity_type[:-1]}_alias_id")
    alias = session.scalar(
        select(alias_model).where(alias_pk == alias_id, alias_identity == entity_id)
    )
    if alias is None:
        raise LookupError("Alias not found.")
    deleted = {
        "id": alias_id,
        "type": getattr(alias, "alias_type", "alias"),
        "value": alias.alias_value,
    }
    session.delete(alias)
    session.flush()
    return get_entity(session, entity_type, detail["id"]), deleted

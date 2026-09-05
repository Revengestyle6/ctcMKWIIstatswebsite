import re

from models import Player, PlayerAlias, utc_now
from sqlalchemy import desc, select

MKC_ALIAS_TYPE = "mkc_name"
MKC_ID_ALIAS_TYPE = "mkc_id"
CANONICAL_HISTORY_ALIAS_TYPE = "canonical_name"
LOUNGE_ALIAS_TYPE = "lounge_name"


def add_player_alias(
    session,
    player_id: int,
    alias_type: str,
    alias_value: str,
    *,
    first_seen_match_id: int | None = None,
    last_seen_match_id: int | None = None,
    origin: str = "admin",
) -> tuple[PlayerAlias, bool]:
    value = str(alias_value or "").strip()
    if not value:
        raise ValueError("Alias value is required.")
    existing = session.scalar(
        select(PlayerAlias).where(
            PlayerAlias.player_id == player_id,
            PlayerAlias.alias_type == alias_type,
            PlayerAlias.alias_value == value,
        )
    )
    if existing is not None:
        if first_seen_match_id is not None and existing.first_seen_match_id is None:
            existing.first_seen_match_id = first_seen_match_id
        if last_seen_match_id is not None:
            existing.last_seen_match_id = last_seen_match_id
        existing.last_observed_at = utc_now()
        session.flush()
        return existing, False
    alias = PlayerAlias(
        player_id=player_id,
        alias_type=alias_type,
        alias_value=value,
        first_seen_match_id=first_seen_match_id,
        last_seen_match_id=last_seen_match_id,
        origin=origin,
    )
    session.add(alias)
    session.flush()
    return alias, True


def set_player_canonical_name(session, player, canonical_name: str) -> str | None:
    value = str(canonical_name or "").strip()
    if not value:
        raise ValueError("Canonical name is required.")
    previous = player.canonical_name
    if previous == value:
        return previous
    if previous:
        add_player_alias(
            session,
            player.player_id,
            CANONICAL_HISTORY_ALIAS_TYPE,
            previous,
        )
    player.canonical_name = value
    return previous


def latest_alias_value(session, player_id: int, alias_type: str) -> str | None:
    return session.scalar(
        select(PlayerAlias.alias_value)
        .where(
            PlayerAlias.player_id == player_id,
            PlayerAlias.alias_type == alias_type,
        )
        .order_by(desc(PlayerAlias.last_observed_at), desc(PlayerAlias.player_alias_id))
        .limit(1)
    )


def latest_mkc_name(session, player_id: int) -> str | None:
    return latest_alias_value(session, player_id, MKC_ALIAS_TYPE)


def latest_lounge_name(session, player_id: int) -> str | None:
    return latest_alias_value(session, player_id, LOUNGE_ALIAS_TYPE)


def _normalized_mkc_name(value: str | None) -> str:
    return " ".join(str(value or "").casefold().split())


def players_sharing_latest_mkc_name(session, mkc_name: str) -> list[int]:
    normalized_name = _normalized_mkc_name(mkc_name)
    if not normalized_name:
        return []
    player_ids = session.scalars(select(PlayerAlias.player_id).distinct()).all()
    return [
        player_id
        for player_id in player_ids
        if _normalized_mkc_name(latest_mkc_name(session, player_id)) == normalized_name
    ]


def _is_retained_combined_name_choice(canonical_name: str | None, mkc_name: str) -> bool:
    options = [name.strip() for name in re.split(r"[|/]", mkc_name) if name.strip()]
    return len(options) > 1 and canonical_name in [*options, mkc_name]


def apply_canonical_priority(session, player) -> str | None:
    if player.canonical_name_override:
        return player.canonical_name
    mkc_name = latest_mkc_name(session, player.player_id)
    if mkc_name:
        shared_player_ids = players_sharing_latest_mkc_name(session, mkc_name)
        lounge_name = latest_lounge_name(session, player.player_id)
        set_player_canonical_name(
            session,
            player,
            lounge_name
            if len(shared_player_ids) > 1 and lounge_name
            else player.canonical_name
            if _is_retained_combined_name_choice(player.canonical_name, mkc_name)
            else mkc_name,
        )
    return player.canonical_name


def apply_shared_mkc_name_priorities(session, mkc_name: str) -> list[int]:
    player_ids = players_sharing_latest_mkc_name(session, mkc_name)
    if len(player_ids) < 2:
        return []
    for player_id in player_ids:
        player = session.get(Player, player_id)
        if player is not None:
            apply_canonical_priority(session, player)
    return player_ids

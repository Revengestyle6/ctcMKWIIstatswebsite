from sqlalchemy import func, select

from models import PlayerAlias


def _ranked_alias_values(session, player_ids, alias_type, rank_by):
    if not player_ids:
        return {}

    rows = session.execute(
        select(
            PlayerAlias.player_id,
            PlayerAlias.alias_value,
            func.count(PlayerAlias.player_alias_id).label("uses"),
            func.max(PlayerAlias.last_seen_match_id).label("last_seen"),
            func.max(PlayerAlias.player_alias_id).label("alias_id"),
        )
        .where(
            PlayerAlias.player_id.in_(player_ids),
            PlayerAlias.alias_type == alias_type,
            PlayerAlias.alias_value.is_not(None),
            func.trim(PlayerAlias.alias_value) != "",
        )
        .group_by(PlayerAlias.player_id, PlayerAlias.alias_value)
    ).all()

    ranked = {}
    for row in rows:
        last_seen = row.last_seen or 0
        uses = row.uses or 0
        alias_id = row.alias_id or 0
        key = (
            (last_seen, uses, alias_id)
            if rank_by == "recent"
            else (uses, last_seen, alias_id)
        )
        current = ranked.get(row.player_id)
        if current is None or key > current[0]:
            ranked[row.player_id] = (key, row.alias_value)

    return {player_id: value for player_id, (_, value) in ranked.items()}


def _display_names_for_players(session, player_ids, canonical_names=None):
    player_ids = list(dict.fromkeys(player_ids))
    if not player_ids:
        return {}
    canonical_names = canonical_names or {}
    recent_lounge_names = _ranked_alias_values(
        session, player_ids, "lounge_name", "recent"
    )
    common_table_names = _ranked_alias_values(
        session, player_ids, "table_name", "common"
    )
    common_mii_names = _ranked_alias_values(
        session, player_ids, "mii_name", "common"
    )

    return {
        player_id: (
            recent_lounge_names.get(player_id)
            or canonical_names.get(player_id)
            or common_table_names.get(player_id)
            or common_mii_names.get(player_id)
            or ""
        )
        for player_id in player_ids
    }

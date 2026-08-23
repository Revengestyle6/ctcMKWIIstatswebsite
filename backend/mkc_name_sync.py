import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

from mkc_registry import lookup_mkc_player
from models import MkcRefreshPreview, Player, PlayerAlias, PlayerFriendCode
from player_naming import (
    MKC_ALIAS_TYPE,
    MKC_ID_ALIAS_TYPE,
    add_player_alias,
    apply_shared_mkc_name_priorities,
    latest_lounge_name,
    latest_mkc_name,
    set_player_canonical_name,
)
from sqlalchemy import desc, select


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def canonical_name_options(mkc_name: str) -> list[str]:
    """Return review choices without changing the raw MKCentral alias value."""
    raw_name = str(mkc_name or "").strip()
    separated_names = [name.strip() for name in re.split(r"[|/]", raw_name) if name.strip()]
    if len(separated_names) < 2:
        return [raw_name]
    options = []
    for name in [*separated_names, raw_name]:
        if name not in options:
            options.append(name)
    return options


def _player_snapshot(session, player_id: int | None = None) -> list[dict]:
    player_query = select(Player).order_by(Player.player_id)
    if player_id is not None:
        player_query = player_query.where(Player.player_id == player_id)
    players = session.scalars(player_query).all()
    if player_id is not None and not players:
        raise LookupError("Player not found.")
    player_ids = [player.player_id for player in players]
    codes = session.execute(
        select(
            PlayerFriendCode.player_id,
            PlayerFriendCode.friend_code,
            PlayerFriendCode.last_seen_match_id,
            PlayerFriendCode.player_friend_code_id,
        )
        .where(PlayerFriendCode.player_id.in_(player_ids))
        .order_by(
            PlayerFriendCode.player_id,
            desc(PlayerFriendCode.last_seen_match_id).nulls_last(),
            desc(PlayerFriendCode.player_friend_code_id),
        )
    ).all()
    mkc_aliases = session.execute(
        select(
            PlayerAlias.player_id,
            PlayerAlias.alias_value,
            PlayerAlias.created_at,
            PlayerAlias.last_observed_at,
            PlayerAlias.player_alias_id,
        )
        .where(
            PlayerAlias.player_id.in_(player_ids),
            PlayerAlias.alias_type == MKC_ALIAS_TYPE,
        )
        .order_by(
            PlayerAlias.player_id,
            desc(PlayerAlias.last_observed_at),
            desc(PlayerAlias.player_alias_id),
        )
    ).all()
    mkc_id_aliases = session.execute(
        select(PlayerAlias.player_id, PlayerAlias.alias_value)
        .where(
            PlayerAlias.player_id.in_(player_ids),
            PlayerAlias.alias_type == MKC_ID_ALIAS_TYPE,
        )
        .order_by(
            PlayerAlias.player_id,
            desc(PlayerAlias.last_observed_at),
            desc(PlayerAlias.player_alias_id),
        )
    ).all()
    codes_by_player: dict[int, list[str]] = {}
    aliases_by_player: dict[int, list[str]] = {}
    ids_by_player: dict[int, list[str]] = {}
    for row in codes:
        codes_by_player.setdefault(row.player_id, []).append(row.friend_code)
    for row in mkc_aliases:
        aliases_by_player.setdefault(row.player_id, []).append(row.alias_value)
    for row in mkc_id_aliases:
        ids_by_player.setdefault(row.player_id, []).append(row.alias_value)
    return [
        {
            "player_id": player.player_id,
            "canonical_name": player.canonical_name,
            "canonical_name_override": player.canonical_name_override,
            "friend_codes": codes_by_player.get(player.player_id, []),
            "mkc_aliases": aliases_by_player.get(player.player_id, []),
            "mkc_ids": ids_by_player.get(player.player_id, []),
            "lounge_name": latest_lounge_name(session, player.player_id),
        }
        for player in players
    ]


def _normalized_mkc_name(value: str | None) -> str:
    return " ".join(str(value or "").casefold().split())


def _decorate_shared_mkc_names(session, results: list[dict]) -> None:
    current_names = {
        player_id: latest_mkc_name(session, player_id)
        for player_id in session.scalars(select(Player.player_id))
    }
    for result in results:
        if result["status"] == "found":
            current_names[result["player_id"]] = result["mkc_name"]
    groups: dict[str, list[int]] = {}
    for player_id, name in current_names.items():
        normalized_name = _normalized_mkc_name(name)
        if normalized_name:
            groups.setdefault(normalized_name, []).append(player_id)
    for result in results:
        if result["status"] != "found":
            continue
        shared_ids = groups.get(_normalized_mkc_name(result["mkc_name"]), [])
        if len(shared_ids) < 2:
            continue
        result["shared_mkc_name_player_ids"] = sorted(shared_ids)
        if result["canonical_name_override"] or not result.get("lounge_name"):
            continue
        result["proposed_canonical_name"] = result["lounge_name"]
        result["canonical_will_change"] = result["lounge_name"] != result["canonical_name"]


def _lookup_player(snapshot: dict) -> dict:
    attempts = []
    found = None
    for friend_code in snapshot["friend_codes"]:
        result = lookup_mkc_player(friend_code)
        attempts.append(result)
        if result["status"] == "found":
            found = result
            break
    if found is None:
        statuses = {attempt["status"] for attempt in attempts}
        if not attempts:
            status = "no_friend_codes"
        elif "lookup_failed" in statuses:
            status = "lookup_failed"
        elif "ambiguous" in statuses:
            status = "ambiguous"
        else:
            status = "not_found"
        return {**snapshot, "status": status, "attempts": attempts}

    prior_names = snapshot["mkc_aliases"]
    if not prior_names:
        change = "new"
    elif prior_names[0] != found["mkc_name"]:
        change = "updated"
    else:
        change = "unchanged"
    options = canonical_name_options(found["mkc_name"])
    same_mkc_name = bool(prior_names and prior_names[0] == found["mkc_name"])
    retain_prior_choice = (
        same_mkc_name and len(options) > 1 and snapshot["canonical_name"] in options
    )
    proposed_canonical = (
        snapshot["canonical_name"]
        if snapshot["canonical_name_override"] or retain_prior_choice
        else found["mkc_name"]
    )
    return {
        **snapshot,
        **found,
        "status": "found",
        "change": change,
        "canonical_name_options": options,
        "proposed_canonical_name": proposed_canonical,
        "canonical_will_change": proposed_canonical != snapshot["canonical_name"],
        "attempts": attempts,
    }


def _summary(results: list[dict]) -> dict[str, int]:
    summary = {
        "total": len(results),
        "new": 0,
        "updated": 0,
        "unchanged": 0,
        "not_found": 0,
        "lookup_failed": 0,
        "ambiguous": 0,
        "no_friend_codes": 0,
        "canonical_changes": 0,
    }
    for result in results:
        key = result.get("change") if result["status"] == "found" else result["status"]
        summary[key] += 1
        if result.get("canonical_will_change"):
            summary["canonical_changes"] += 1
    return summary


def create_refresh_preview(session, actor, player_id: int | None = None) -> dict:
    snapshots = _player_snapshot(session, player_id)
    workers = min(max(int(os.environ.get("MKC_REFRESH_WORKERS", "8")), 1), 16)
    results = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_lookup_player, snapshot): snapshot for snapshot in snapshots}
        for future in as_completed(futures):
            results.append(future.result())
    results.sort(key=lambda result: result["player_id"])
    _decorate_shared_mkc_names(session, results)
    summary = _summary(results)
    now = _utc_now()
    preview = MkcRefreshPreview(
        scope="individual" if player_id is not None else "bulk",
        player_id=player_id,
        status="pending",
        requested_by_admin_user_id=actor.admin_user_id,
        results_json=json.dumps(results, ensure_ascii=False, separators=(",", ":")),
        summary_json=json.dumps(summary, separators=(",", ":")),
        created_at=now,
        expires_at=now + timedelta(hours=24),
    )
    session.add(preview)
    session.flush()
    return serialize_preview(preview)


def serialize_preview(preview: MkcRefreshPreview) -> dict:
    return {
        "preview_id": preview.preview_id,
        "scope": preview.scope,
        "player_id": preview.player_id,
        "status": preview.status,
        "summary": json.loads(preview.summary_json),
        "results": json.loads(preview.results_json),
        "created_at": preview.created_at.isoformat(),
        "expires_at": preview.expires_at.isoformat(),
    }


def apply_refresh_preview(
    session,
    preview_id: str,
    actor,
    canonical_name_selections: dict | None = None,
) -> dict:
    preview = session.scalar(
        select(MkcRefreshPreview)
        .where(MkcRefreshPreview.preview_id == preview_id)
        .with_for_update()
    )
    if preview is None:
        raise LookupError("MKCentral refresh preview not found.")
    if preview.status != "pending":
        raise ValueError(f"MKCentral refresh preview is already {preview.status}.")
    if preview.expires_at <= _utc_now():
        raise ValueError("MKCentral refresh preview has expired. Run the refresh again.")

    if canonical_name_selections is None:
        canonical_name_selections = {}
    if not isinstance(canonical_name_selections, dict):
        raise ValueError("Canonical-name selections must be an object keyed by player ID.")

    results = json.loads(preview.results_json)
    found_results = {
        str(result["player_id"]): result for result in results if result["status"] == "found"
    }
    unknown_selections = set(canonical_name_selections) - set(found_results)
    if unknown_selections:
        raise ValueError("A canonical-name selection does not belong to this refresh preview.")
    validated_selections = {}
    for player_key, selected_name in canonical_name_selections.items():
        value = str(selected_name or "").strip()
        valid_names = {
            *found_results[player_key]["canonical_name_options"],
            found_results[player_key]["proposed_canonical_name"],
        }
        if value not in valid_names:
            raise ValueError(
                f"The canonical-name selection for player {player_key} is not a valid option."
            )
        validated_selections[player_key] = value

    applied_aliases = 0
    canonical_names_before = {
        player.player_id: player.canonical_name for player in session.scalars(select(Player)).all()
    }
    applied_selections = {}
    refreshed_mkc_names = set()
    for result in results:
        player = session.get(Player, result["player_id"])
        if player is None:
            raise ValueError(f"Player {result['player_id']} changed after the refresh preview.")
        current_aliases = [
            value
            for value in session.scalars(
                select(PlayerAlias.alias_value)
                .where(
                    PlayerAlias.player_id == player.player_id,
                    PlayerAlias.alias_type == MKC_ALIAS_TYPE,
                )
                .order_by(desc(PlayerAlias.last_observed_at), desc(PlayerAlias.player_alias_id))
            )
        ]
        current_mkc_ids = [
            value
            for value in session.scalars(
                select(PlayerAlias.alias_value)
                .where(
                    PlayerAlias.player_id == player.player_id,
                    PlayerAlias.alias_type == MKC_ID_ALIAS_TYPE,
                )
                .order_by(desc(PlayerAlias.last_observed_at), desc(PlayerAlias.player_alias_id))
            )
        ]
        if (
            player.canonical_name != result["canonical_name"]
            or player.canonical_name_override != result["canonical_name_override"]
            or current_aliases != result["mkc_aliases"]
            or current_mkc_ids != result["mkc_ids"]
            or latest_lounge_name(session, player.player_id) != result["lounge_name"]
        ):
            raise ValueError(
                f"Player {player.player_id} changed after this preview. Run the refresh again."
            )
        if result["status"] != "found":
            continue
        _alias, created = add_player_alias(
            session, player.player_id, MKC_ALIAS_TYPE, result["mkc_name"]
        )
        applied_aliases += int(created)
        _id_alias, id_created = add_player_alias(
            session,
            player.player_id,
            MKC_ID_ALIAS_TYPE,
            str(result["mkc_player_id"]),
        )
        applied_aliases += int(id_created)
        refreshed_mkc_names.add(result["mkc_name"])
        selected_canonical = validated_selections.get(
            str(player.player_id), result["proposed_canonical_name"]
        )
        if not player.canonical_name_override:
            applied_selections[str(player.player_id)] = selected_canonical
        if not player.canonical_name_override and player.canonical_name != selected_canonical:
            set_player_canonical_name(session, player, selected_canonical)

    for mkc_name in refreshed_mkc_names:
        apply_shared_mkc_name_priorities(session, mkc_name)

    canonical_changes = sum(
        player.canonical_name != canonical_names_before.get(player.player_id)
        for player in session.scalars(select(Player)).all()
    )

    preview.status = "applied"
    preview.applied_by_admin_user_id = actor.admin_user_id
    preview.decided_at = _utc_now()
    session.flush()
    serialized = serialize_preview(preview)
    serialized["applied"] = {
        "aliases_created": applied_aliases,
        "canonical_names_changed": canonical_changes,
        "canonical_name_selections": applied_selections,
    }
    return serialized


def reject_refresh_preview(session, preview_id: str) -> dict:
    preview = session.scalar(
        select(MkcRefreshPreview)
        .where(MkcRefreshPreview.preview_id == preview_id)
        .with_for_update()
    )
    if preview is None:
        raise LookupError("MKCentral refresh preview not found.")
    if preview.status != "pending":
        raise ValueError(f"MKCentral refresh preview is already {preview.status}.")
    preview.status = "rejected"
    preview.decided_at = _utc_now()
    session.flush()
    return serialize_preview(preview)

"""Reviewed editing and deletion of imported match-owned records."""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import PurePosixPath

from admin_auth import record_audit
from import_json_to_db import detect_new_entries, import_editor_match
from match_upload import (
    AdditionCapture,
    find_match_conflict,
    prepare_upload_document,
    record_addition_logs,
    record_database_log,
    serialize_addition_log,
    validate_committable_match,
)
from models import (
    DatabaseAdditionLog,
    Division,
    Match,
    MatchPlayer,
    MatchTableRef,
    MatchTeam,
    Penalty,
    Player,
    PlayerAlias,
    PlayerFriendCode,
    PlayerSeasonEntry,
    Race,
    RacePlayerResult,
    RaceTeamResult,
    ReviewSubmission,
    Season,
    SourceFile,
    Team,
    TeamSeasonEntry,
    Track,
)
from routes.common import mkc_profiles_from_entries, unapproved_entries
from sqlalchemy import delete, func, select, update


def _json(value):
    return json.loads(value or "{}")


def _count(session, model, condition):
    return session.scalar(select(func.count()).select_from(model).where(condition)) or 0


def _ids(session, column, condition):
    return list(session.scalars(select(column).where(condition).order_by(column)).all())


def match_inventory(session, match_id: int) -> dict:
    match = session.get(Match, match_id)
    if match is None:
        raise LookupError("Match was not found.")
    source = session.get(SourceFile, match.source_file_id)
    source_match_count = _count(session, Match, Match.source_file_id == match.source_file_id)
    race_ids = select(Race.race_id).where(Race.match_id == match_id)
    team_ids = select(MatchTeam.match_team_id).where(MatchTeam.match_id == match_id)
    player_ids = select(MatchPlayer.match_player_id).where(MatchPlayer.match_team_id.in_(team_ids))
    counts = {
        "matches": 1,
        "match_table_refs": _count(session, MatchTableRef, MatchTableRef.match_id == match_id),
        "match_teams": _count(session, MatchTeam, MatchTeam.match_id == match_id),
        "match_players": _count(session, MatchPlayer, MatchPlayer.match_team_id.in_(team_ids)),
        "races": _count(session, Race, Race.match_id == match_id),
        "race_player_results": _count(
            session, RacePlayerResult, RacePlayerResult.race_id.in_(race_ids)
        ),
        "race_team_results": _count(session, RaceTeamResult, RaceTeamResult.race_id.in_(race_ids)),
        "penalties": _count(session, Penalty, Penalty.match_id == match_id),
    }
    record_ids = {
        "matches": [match_id],
        "match_table_refs": _ids(
            session, MatchTableRef.match_table_ref_id, MatchTableRef.match_id == match_id
        ),
        "match_teams": _ids(session, MatchTeam.match_team_id, MatchTeam.match_id == match_id),
        "match_players": _ids(
            session, MatchPlayer.match_player_id, MatchPlayer.match_team_id.in_(team_ids)
        ),
        "races": _ids(session, Race.race_id, Race.match_id == match_id),
        "race_player_results": _ids(
            session, RacePlayerResult.race_player_result_id, RacePlayerResult.race_id.in_(race_ids)
        ),
        "race_team_results": _ids(
            session, RaceTeamResult.race_team_result_id, RaceTeamResult.race_id.in_(race_ids)
        ),
        "penalties": _ids(session, Penalty.penalty_id, Penalty.match_id == match_id),
    }
    teams = session.execute(
        select(Team.team_id, Team.canonical_name, TeamSeasonEntry.clan_tag)
        .join(TeamSeasonEntry, TeamSeasonEntry.team_id == Team.team_id)
        .join(MatchTeam, MatchTeam.team_season_entry_id == TeamSeasonEntry.team_season_entry_id)
        .where(MatchTeam.match_id == match_id)
        .order_by(Team.team_id)
    ).all()
    players = session.execute(
        select(MatchPlayer.player_id, MatchPlayer.friend_code_raw, MatchPlayer.lounge_name_raw)
        .where(MatchPlayer.match_player_id.in_(player_ids))
        .order_by(MatchPlayer.player_id)
    ).all()
    tracks = session.execute(
        select(Track.track_id, Track.canonical_name, Race.race_number)
        .join(Race, Race.track_id == Track.track_id)
        .where(Race.match_id == match_id)
        .order_by(Race.race_number)
    ).all()
    additions = session.scalars(
        select(DatabaseAdditionLog)
        .where(DatabaseAdditionLog.match_id == match_id)
        .order_by(DatabaseAdditionLog.addition_log_id)
    ).all()
    references_updated = {
        "review_submissions": _ids(
            session,
            ReviewSubmission.submission_id,
            ReviewSubmission.accepted_match_id == match_id,
        ),
        "database_addition_logs": [row.addition_log_id for row in additions],
        "player_friend_codes_first_seen": _ids(
            session,
            PlayerFriendCode.player_friend_code_id,
            PlayerFriendCode.first_seen_match_id == match_id,
        ),
        "player_friend_codes_last_seen": _ids(
            session,
            PlayerFriendCode.player_friend_code_id,
            PlayerFriendCode.last_seen_match_id == match_id,
        ),
        "player_aliases_first_seen": _ids(
            session, PlayerAlias.player_alias_id, PlayerAlias.first_seen_match_id == match_id
        ),
        "player_aliases_last_seen": _ids(
            session, PlayerAlias.player_alias_id, PlayerAlias.last_seen_match_id == match_id
        ),
        "player_season_entries_first_seen": _ids(
            session,
            PlayerSeasonEntry.player_season_entry_id,
            PlayerSeasonEntry.first_seen_match_id == match_id,
        ),
        "player_season_entries_last_seen": _ids(
            session,
            PlayerSeasonEntry.player_season_entry_id,
            PlayerSeasonEntry.last_seen_match_id == match_id,
        ),
    }
    original_json = _json(match.raw_json)
    if match.review_notes and not str(original_json.get("review_notes") or "").strip():
        original_json["review_notes"] = match.review_notes
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "match": {
            "match_id": match.match_id,
            "label": match.match_label,
            "match_type": match.match_type,
            "result_type": match.result_type,
            "match_number": match.match_number,
            "series_match_number": match.series_match_number,
            "source_file_id": match.source_file_id,
        },
        "source": {
            "source_path": source.source_path,
            "original_source_path": source.original_source_path,
            "source_filename": source.source_filename,
            "fingerprint": source.file_sha256,
            "storage_provider": source.storage_provider,
            "storage_object_key": source.storage_object_key,
            "archive_status": source.archive_status,
            "match_count": source_match_count,
        },
        "records_deleted": counts,
        "record_ids_deleted": record_ids,
        "references_updated_not_deleted": references_updated,
        "shared_records_preserved": {
            "teams": [
                {"team_id": row.team_id, "name": row.canonical_name, "tag": row.clan_tag}
                for row in teams
            ],
            "players": [
                {
                    "player_id": row.player_id,
                    "friend_code": row.friend_code_raw,
                    "name": row.lounge_name_raw,
                }
                for row in players
            ],
            "tracks": [
                {"track_id": row.track_id, "name": row.canonical_name, "race": row.race_number}
                for row in tracks
            ],
        },
        "database_additions_from_upload": [
            {
                "id": row.addition_log_id,
                "operation_type": row.operation_type,
                "admin_email": row.admin_email,
                "entity_type": row.entity_type,
                "entity_id": row.entity_id,
                "summary": row.summary,
                "details": _json(row.details_json),
            }
            for row in additions
        ],
        "original_json": original_json,
    }


def _affected_provenance(session, match_id):
    team_ids = select(MatchTeam.match_team_id).where(MatchTeam.match_id == match_id)
    appearances = session.scalars(
        select(MatchPlayer).where(MatchPlayer.match_team_id.in_(team_ids))
    ).all()
    return {
        "player_ids": {row.player_id for row in appearances},
        "season_entry_ids": {
            row.player_season_entry_id for row in appearances if row.player_season_entry_id
        },
    }


def _detach_match_references(session, match_id):
    review_ids = session.scalars(
        select(ReviewSubmission.submission_id).where(ReviewSubmission.accepted_match_id == match_id)
    ).all()
    addition_ids = session.scalars(
        select(DatabaseAdditionLog.addition_log_id).where(DatabaseAdditionLog.match_id == match_id)
    ).all()
    session.execute(
        update(ReviewSubmission)
        .where(ReviewSubmission.accepted_match_id == match_id)
        .values(accepted_match_id=None)
    )
    session.execute(
        update(DatabaseAdditionLog)
        .where(DatabaseAdditionLog.match_id == match_id)
        .values(match_id=None)
    )
    for model in (PlayerFriendCode, PlayerAlias, PlayerSeasonEntry):
        session.execute(
            update(model)
            .where(model.first_seen_match_id == match_id)
            .values(first_seen_match_id=None)
        )
        session.execute(
            update(model)
            .where(model.last_seen_match_id == match_id)
            .values(last_seen_match_id=None)
        )
    return review_ids, addition_ids


def _delete_match_rows(session, match: Match):
    match_id = match.match_id
    race_ids = select(Race.race_id).where(Race.match_id == match_id)
    team_ids = select(MatchTeam.match_team_id).where(MatchTeam.match_id == match_id)
    session.execute(delete(RacePlayerResult).where(RacePlayerResult.race_id.in_(race_ids)))
    session.execute(delete(RaceTeamResult).where(RaceTeamResult.race_id.in_(race_ids)))
    session.execute(delete(Penalty).where(Penalty.match_id == match_id))
    session.execute(delete(MatchPlayer).where(MatchPlayer.match_team_id.in_(team_ids)))
    session.execute(delete(Race).where(Race.match_id == match_id))
    session.execute(delete(MatchTableRef).where(MatchTableRef.match_id == match_id))
    session.execute(delete(MatchTeam).where(MatchTeam.match_id == match_id))
    session.delete(match)
    session.flush()


def _restore_audit_links(session, match_id, review_ids, addition_ids):
    if review_ids:
        session.execute(
            update(ReviewSubmission)
            .where(ReviewSubmission.submission_id.in_(review_ids))
            .values(accepted_match_id=match_id)
        )
    if addition_ids:
        session.execute(
            update(DatabaseAdditionLog)
            .where(DatabaseAdditionLog.addition_log_id.in_(addition_ids))
            .values(match_id=match_id)
        )


def _recompute_provenance(session, affected):
    for player_id in affected["player_ids"]:
        player = session.get(Player, player_id)
        codes = session.scalars(
            select(PlayerFriendCode).where(PlayerFriendCode.player_id == player_id)
        ).all()
        retained_codes = []
        for code in codes:
            match_ids = session.scalars(
                select(MatchTeam.match_id)
                .join(MatchPlayer, MatchPlayer.match_team_id == MatchTeam.match_team_id)
                .where(
                    MatchPlayer.player_id == player_id,
                    MatchPlayer.friend_code_raw == code.friend_code,
                )
                .order_by(MatchTeam.match_id)
            ).all()
            code.first_seen_match_id = match_ids[0] if match_ids else None
            code.last_seen_match_id = match_ids[-1] if match_ids else None
            if not match_ids and code.origin == "match_import":
                session.delete(code)
            else:
                retained_codes.append(code)
        if player is not None and not any(
            code.friend_code == player.primary_friend_code for code in retained_codes
        ):
            preferred = max(
                retained_codes,
                key=lambda code: (
                    code.last_seen_match_id or 0,
                    code.player_friend_code_id or 0,
                ),
                default=None,
            )
            player.primary_friend_code = preferred.friend_code if preferred else None
        aliases = session.scalars(
            select(PlayerAlias).where(PlayerAlias.player_id == player_id)
        ).all()
        fields = {
            "lounge_name": MatchPlayer.lounge_name_raw,
            "mii_name": MatchPlayer.mii_name_raw,
            "table_name": MatchPlayer.table_name_raw,
        }
        for alias in aliases:
            field = fields.get(alias.alias_type)
            if field is None:
                continue
            match_ids = session.scalars(
                select(MatchTeam.match_id)
                .join(MatchPlayer, MatchPlayer.match_team_id == MatchTeam.match_team_id)
                .where(MatchPlayer.player_id == player_id, field == alias.alias_value)
                .order_by(MatchTeam.match_id)
            ).all()
            alias.first_seen_match_id = match_ids[0] if match_ids else None
            alias.last_seen_match_id = match_ids[-1] if match_ids else None
            if not match_ids and alias.origin == "match_import":
                session.delete(alias)
    for entry_id in affected["season_entry_ids"]:
        entry = session.get(PlayerSeasonEntry, entry_id)
        if entry is None:
            continue
        rows = session.execute(
            select(MatchTeam.match_id, MatchPlayer)
            .join(MatchPlayer, MatchPlayer.match_team_id == MatchTeam.match_team_id)
            .where(MatchPlayer.player_season_entry_id == entry_id)
            .order_by(MatchTeam.match_id)
        ).all()
        entry.first_seen_match_id = rows[0].match_id if rows else None
        entry.last_seen_match_id = rows[-1].match_id if rows else None
        if not rows:
            session.delete(entry)
            continue
        latest = rows[-1][1]
        entry.primary_lounge_name = latest.lounge_name_raw or latest.table_name_raw
        entry.primary_mii_name = latest.mii_name_raw
        entry.flag = latest.flag


def delete_match_from_database(
    session, match_id: int, actor, confirmation: str, archive_details: dict | None = None
) -> dict:
    match = session.scalar(select(Match).where(Match.match_id == match_id).with_for_update())
    if match is None:
        raise LookupError("Match was not found.")
    if confirmation.strip() != match.match_label:
        raise ValueError("Confirmation must exactly match the match label.")
    manifest = match_inventory(session, match_id)
    if archive_details:
        manifest["deleted_archive"] = archive_details
    affected = _affected_provenance(session, match_id)
    _detach_match_references(session, match_id)
    _delete_match_rows(session, match)
    _recompute_provenance(session, affected)
    record_audit(
        session,
        actor,
        "match.delete",
        target_type="match",
        target_id=match_id,
        details=manifest,
    )
    return manifest


def _changes(before, after, path=""):
    if isinstance(before, dict) and isinstance(after, dict):
        output = []
        for key in sorted(set(before) | set(after)):
            output.extend(_changes(before.get(key), after.get(key), f"{path}.{key}".lstrip(".")))
        return output
    if before == after:
        return []
    return [{"path": path or "$", "before": before, "after": after}]


def _normalized_for_edit_comparison(match_data: dict) -> dict:
    """Compare legacy week metadata using its current match_number name."""
    normalized = dict(match_data)
    legacy_week = normalized.pop("week", None)
    if "match_number" not in normalized and isinstance(legacy_week, (int, float)):
        normalized["match_number"] = legacy_week
    return normalized


def edit_preview_summary(summary: dict) -> dict:
    """Exclude transaction-only IDs that will not survive a rolled-back preview."""
    preview_summary = dict(summary)
    preview_summary.pop("record_ids_after", None)
    return preview_summary


def replace_match(
    session,
    match_id,
    match_data,
    *,
    approved_keys,
    requested_player_identity_links,
    requested_team_identity_resolutions,
    expected_source_fingerprint,
    actor=None,
):
    match = session.scalar(select(Match).where(Match.match_id == match_id).with_for_update())
    if match is None:
        raise LookupError("Match was not found.")
    source = session.get(SourceFile, match.source_file_id)
    if _count(session, Match, Match.source_file_id == source.source_file_id) != 1:
        raise ValueError(
            "This legacy source contains multiple matches and cannot be edited safely. "
            "Delete and re-upload this match as a single-match JSON file instead."
        )
    if not expected_source_fingerprint or source.file_sha256 != expected_source_fingerprint:
        raise ValueError("The match changed after it was loaded. Reload it before editing.")
    validate_committable_match(match_data)
    document = prepare_upload_document(match_data)
    before = _json(match.raw_json)
    original_created_at = match.created_at
    original_match_index = match.match_index_in_source
    before_inventory = match_inventory(session, match_id)
    affected = _affected_provenance(session, match_id)
    review_ids, addition_ids = _detach_match_references(session, match_id)
    _delete_match_rows(session, match)

    conflict = find_match_conflict(session, match_data)
    if conflict is not None:
        raise ValueError(f"This match conflicts with existing match {conflict.match_id}.")

    new_entries, unapproved, player_links, team_links = unapproved_entries(
        session,
        match_data,
        approved_keys,
        requested_player_identity_links,
        requested_team_identity_resolutions,
        lookup_mkc_profiles=True,
    )
    if unapproved:
        raise ValueError("Every new database entry must be approved before editing.")
    capture = AdditionCapture(session)
    source.source_path = document.source_path
    source.source_filename = document.filename
    source.file_sha256 = document.fingerprint
    source.archive_status = "pending"
    source.storage_generation = None
    source.archived_at = None
    source.last_archive_error_code = None
    new_match = import_editor_match(
        session,
        match_data,
        source_path=source.source_path,
        source_filename=document.filename,
        file_sha256=document.fingerprint,
        existing_source_file=source,
        match_id_override=match_id,
        player_identity_links=player_links,
        team_identity_links=team_links,
        player_mkc_profiles=mkc_profiles_from_entries(new_entries),
    )
    new_match.created_at = original_created_at
    new_match.match_index_in_source = original_match_index
    new_match.last_update_at = datetime.now(timezone.utc)
    session.flush()
    # Re-inserting the stable match ID is the replacement mechanism, not a catalog addition.
    additions = [addition for addition in capture.stop() if not isinstance(addition, Match)]
    addition_logs = record_addition_logs(
        session,
        additions,
        match_id,
        actor=actor,
    )
    _restore_audit_links(session, match_id, review_ids, addition_ids)
    affected["player_ids"].update(
        session.scalars(
            select(MatchPlayer.player_id)
            .join(MatchTeam, MatchTeam.match_team_id == MatchPlayer.match_team_id)
            .where(MatchTeam.match_id == match_id)
        ).all()
    )
    affected["season_entry_ids"].update(
        value
        for value in session.scalars(
            select(MatchPlayer.player_season_entry_id)
            .join(MatchTeam, MatchTeam.match_team_id == MatchPlayer.match_team_id)
            .where(MatchTeam.match_id == match_id)
        ).all()
        if value
    )
    _recompute_provenance(session, affected)
    after_inventory = match_inventory(session, match_id)
    summary = {
        "changes": _changes(
            _normalized_for_edit_comparison(before),
            _normalized_for_edit_comparison(match_data),
        ),
        "records_before": before_inventory["records_deleted"],
        "records_after": after_inventory["records_deleted"],
        "record_ids_before": before_inventory["record_ids_deleted"],
        "record_ids_after": after_inventory["record_ids_deleted"],
        "references_before": before_inventory["references_updated_not_deleted"],
        "references_after": after_inventory["references_updated_not_deleted"],
        "shared_records_preserved": after_inventory["shared_records_preserved"],
        "new_entries": new_entries,
        "additions": [serialize_addition_log(log) for log in addition_logs],
    }
    if actor is not None:
        edit_log = record_database_log(
            session,
            match_id=match_id,
            operation_type="edit",
            entity_type="match",
            entity_id=match_id,
            summary=f"Edited match {new_match.match_label}",
            details={
                "changes": summary["changes"],
                "records_before": summary["records_before"],
                "records_after": summary["records_after"],
                "source_fingerprint_before": expected_source_fingerprint,
                "source_fingerprint_after": document.fingerprint,
            },
            actor=actor,
        )
        summary["additions"].append(serialize_addition_log(edit_log))
        record_audit(
            session,
            actor,
            "match.edit",
            target_type="match",
            target_id=match_id,
            details={"before": before, "after": match_data, "summary": summary},
        )
    return new_match, document, summary


def detect_edit_entries(
    session,
    match_id: int,
    match_data: dict,
    *,
    requested_player_identity_links=None,
    requested_team_identity_resolutions=None,
) -> list[dict]:
    """Detect entries against the database state with the old match removed.

    The caller must roll back the surrounding transaction.
    """
    match = session.scalar(select(Match).where(Match.match_id == match_id).with_for_update())
    if match is None:
        raise LookupError("Match was not found.")
    source = session.get(SourceFile, match.source_file_id)
    if _count(session, Match, Match.source_file_id == source.source_file_id) != 1:
        raise ValueError(
            "This legacy source contains multiple matches and cannot be edited safely. "
            "Delete and re-upload this match as a single-match JSON file instead."
        )
    validate_committable_match(match_data)
    _detach_match_references(session, match_id)
    _delete_match_rows(session, match)
    return detect_new_entries(
        session,
        match_data,
        player_identity_links=requested_player_identity_links,
        team_identity_resolutions=requested_team_identity_resolutions,
        lookup_mkc_profiles=True,
    )


def list_matches(
    session,
    *,
    league_code="",
    season_code="",
    division_code="",
    query="",
    limit=500,
) -> list[dict]:
    statement = (
        select(Match, Season.league_code, Season.season_code, Division.division_code)
        .join(Season, Season.season_id == Match.season_id)
        .join(Division, Division.division_id == Match.division_id)
        .order_by(Match.match_id.desc())
        .limit(limit)
    )
    if league_code:
        statement = statement.where(Season.league_code == league_code.strip().lower())
    if season_code:
        statement = statement.where(Season.season_code == season_code.strip().lower())
    if division_code:
        statement = statement.where(Division.division_code == division_code.strip().lower())
    if query.strip():
        value = f"%{query.strip().lower()}%"
        statement = statement.where(func.lower(Match.match_label).like(value))
    return [
        {
            "match_id": match.match_id,
            "label": match.match_label,
            "league": league,
            "season": season,
            "division": division,
            "match_type": match.match_type,
            "result_type": match.result_type,
            "match_number": match.match_number,
            "series_match_number": match.series_match_number,
            "created_at": match.created_at.isoformat() if match.created_at else None,
            "last_update_at": (match.last_update_at.isoformat() if match.last_update_at else None),
        }
        for match, league, season, division in session.execute(statement).all()
    ]


def deleted_archive_key(match_id: int, source: dict) -> str:
    filename = PurePosixPath(source["source_filename"] or f"match-{match_id}.json").name
    return f"deleted/matches/{match_id}/{source['fingerprint'][:12]}-{filename}"


def replacement_archive_key(match_id: int, fingerprint: str, filename: str) -> str:
    safe_name = PurePosixPath(filename).name
    return f"replaced/matches/{match_id}/{fingerprint[:12]}-{safe_name}"


def content_fingerprint(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def delete_archive_best_effort(storage, object_key: str | None) -> str:
    """Remove an obsolete archive without invalidating an already-committed edit."""
    if not object_key:
        return "not_needed"
    try:
        storage.delete(object_key)
    except Exception:
        return "pending"
    return "complete"

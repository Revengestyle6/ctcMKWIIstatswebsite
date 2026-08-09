import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from database import BASE_DIR
from models import (
    DatabaseAdditionLog,
    Division,
    DivisionPlayoffConfig,
    Match,
    MatchTableRef,
    Player,
    PlayerAlias,
    PlayerFriendCode,
    PlayerSeasonEntry,
    PlayoffSeries,
    PlayoffSeriesParticipant,
    Season,
    SourceFile,
    Team,
    TeamSeasonEntry,
    Track,
    TrackAlias,
)
from playoff_service import validate_competition_metadata
from sqlalchemy import event, select

DEFAULT_JSON_ROOT = BASE_DIR / "JSON"
ARCHIVE_COMPONENT_RE = re.compile(r"^[A-Za-z0-9_-]+$")
UNSAFE_FILENAME_RE = re.compile(r"[^\w()[\] .+\-]+", re.UNICODE)


class ArchiveConflictError(ValueError):
    pass


@dataclass(frozen=True)
class UploadDocument:
    content: bytes
    fingerprint: str
    final_path: Path
    source_path: str
    filename: str

    @property
    def display_path(self) -> str:
        return f"backend/{self.source_path}"


def json_root() -> Path:
    configured = os.environ.get("MATCH_JSON_ROOT")
    return Path(configured).expanduser().resolve() if configured else DEFAULT_JSON_ROOT


def canonical_json_bytes(match_data: dict[str, Any]) -> bytes:
    return (json.dumps(match_data, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def match_fingerprint(match_data: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json_bytes(match_data)).hexdigest()


def _archive_component(value: Any, label: str) -> str:
    component = str(value or "").strip().lower()
    if not component or not ARCHIVE_COMPONENT_RE.fullmatch(component):
        raise ValueError(f"{label} must contain only letters, numbers, underscores, or hyphens.")
    return component


def _archive_filename(match_data: dict[str, Any], fingerprint: str) -> str:
    label = str(match_data.get("match_label") or "").strip()
    week = match_data.get("week")
    if str(match_data.get("match_type") or "regular").strip().lower() == "playoff":
        stage = str(match_data.get("playoff_stage") or "").strip().lower()
        series_number = match_data.get("playoff_series_number")
        match_number = match_data.get("series_match_number")
        stage_label = f"Semifinals Series {series_number}" if stage == "semifinals" else "Finals"
        label = f"{stage_label} - Match {match_number}"
    elif (
        isinstance(week, (int, float))
        and int(week) > 0
        and not re.match(r"^W\d+\b", label, re.IGNORECASE)
    ):
        label = f"W{int(week)} {label}".strip()
    label = label.removesuffix(".json").removesuffix(".txt")
    label = UNSAFE_FILENAME_RE.sub(" ", label).strip(" .")
    label = re.sub(r"\s+", " ", label)
    if not label:
        label = f"match-{fingerprint[:12]}"
    if len(label) > 140:
        label = label[:140].rstrip(" .")
    return f"{label}.json"


def prepare_upload_document(match_data: dict[str, Any]) -> UploadDocument:
    league = _archive_component(match_data.get("league") or "ctc", "League")
    season = _archive_component(match_data.get("season"), "Season")
    division = _archive_component(match_data.get("division"), "Division")
    content = canonical_json_bytes(match_data)
    fingerprint = hashlib.sha256(content).hexdigest()
    filename = _archive_filename(match_data, fingerprint)
    source_path = (Path("JSON") / league / season / division / filename).as_posix()
    final_path = json_root() / league / season / division / filename
    return UploadDocument(content, fingerprint, final_path, source_path, filename)


def validate_committable_match(match_data: dict[str, Any]) -> None:
    errors = []
    for field in ("league", "season", "division", "match_label"):
        if not str(match_data.get(field) or "").strip():
            errors.append(f"{field.replace('_', ' ').title()} is required.")
    try:
        validate_competition_metadata(match_data)
    except ValueError as error:
        errors.append(str(error))
    tracks = match_data.get("tracks") or []
    if not tracks:
        errors.append("At least one race track is required.")
    if any(not isinstance(track, str) or not track.strip() for track in tracks):
        errors.append("Every race must have a track name.")
    if match_data.get("races_played") != len(tracks):
        errors.append("Races played must equal the number of tracks.")

    teams = match_data.get("teams") or {}
    if (
        re.fullmatch(r"\d+v\d+", str(match_data.get("format") or ""), re.IGNORECASE)
        and len(teams) != 2
    ):
        errors.append("A team-format match must contain exactly two teams.")
    friend_codes = set()
    positions_by_race: list[set[int]] = [set() for _ in tracks]
    for team_tag, team_data in teams.items():
        if not str(team_tag).strip():
            errors.append("Every team needs a tag.")
        for friend_code, player_data in (team_data.get("players") or {}).items():
            if not re.fullmatch(r"\d{4}-\d{4}-\d{4}", friend_code):
                errors.append(f"Invalid friend code: {friend_code}.")
            if friend_code in friend_codes:
                errors.append(f"Friend code is configured more than once: {friend_code}.")
            friend_codes.add(friend_code)
            positions = player_data.get("race_positions") or []
            scores = player_data.get("race_scores") or []
            if len(positions) != len(tracks) or len(scores) != len(tracks):
                errors.append(
                    f"Player {friend_code} must have one position and score value per race."
                )
                continue
            for race_index, position in enumerate(positions):
                if position is None:
                    continue
                if not isinstance(position, int) or position < 1 or position > 12:
                    errors.append(
                        f"Player {friend_code} has an invalid position in race {race_index + 1}."
                    )
                elif position in positions_by_race[race_index]:
                    errors.append(
                        f"Race {race_index + 1} assigns position {position} more than once."
                    )
                else:
                    positions_by_race[race_index].add(position)
    if not friend_codes:
        errors.append("At least one player is required.")
    if errors:
        raise ValueError(" ".join(dict.fromkeys(errors)))


def stage_upload_document(document: UploadDocument) -> Path:
    document.final_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, raw_path = tempfile.mkstemp(
        dir=document.final_path.parent,
        prefix=".match-upload-",
        suffix=".tmp",
    )
    path = Path(raw_path)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(document.content)
            stream.flush()
            os.fsync(stream.fileno())
        return path
    except Exception:
        path.unlink(missing_ok=True)
        raise


def publish_staged_document(staged_path: Path, document: UploadDocument) -> None:
    linked = False
    try:
        os.link(staged_path, document.final_path)
        linked = True
        staged_path.unlink()
        directory_descriptor = os.open(document.final_path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    except FileExistsError as error:
        raise ArchiveConflictError(
            f"Archive file already exists: {document.display_path}"
        ) from error
    except Exception:
        if linked:
            document.final_path.unlink(missing_ok=True)
        raise


def source_archive_path(source_file: SourceFile) -> Path:
    relative = Path(source_file.source_path)
    if relative.parts and relative.parts[0] == "JSON":
        relative = Path(*relative.parts[1:])
    return json_root() / relative


TRACKED_ADDITION_MODELS = (
    Season,
    Division,
    DivisionPlayoffConfig,
    SourceFile,
    Team,
    TeamSeasonEntry,
    Player,
    PlayerFriendCode,
    PlayerAlias,
    PlayerSeasonEntry,
    Track,
    TrackAlias,
    Match,
    PlayoffSeries,
    PlayoffSeriesParticipant,
)


class AdditionCapture:
    def __init__(self, session):
        self.session = session
        self.objects: list[Any] = []
        self._seen: set[int] = set()
        self._listener = self._before_flush
        event.listen(session, "before_flush", self._listener)

    def _before_flush(self, session, _flush_context, _instances) -> None:
        for instance in session.new:
            identity = id(instance)
            if isinstance(instance, TRACKED_ADDITION_MODELS) and identity not in self._seen:
                self._seen.add(identity)
                self.objects.append(instance)

    def stop(self) -> list[Any]:
        event.remove(self.session, "before_flush", self._listener)
        return self.objects


def _addition_data(instance: Any) -> tuple[str, int, str, dict[str, Any]]:
    if isinstance(instance, Season):
        details = {"league": instance.league_code, "season": instance.season_code}
        return (
            "season",
            instance.season_id,
            f"Added {instance.league_code.upper()} season {instance.season_code}",
            details,
        )
    if isinstance(instance, Division):
        details = {"season_id": instance.season_id, "division": instance.division_code}
        return "division", instance.division_id, f"Added division {instance.division_code}", details
    if isinstance(instance, DivisionPlayoffConfig):
        details = {
            "division_id": instance.division_id,
            "format_code": instance.format_code,
            "playoff_team_count": instance.playoff_team_count,
            "semifinal_series_count": instance.semifinal_series_count,
            "finals_bye_count": instance.finals_bye_count,
        }
        return (
            "division_playoff_config",
            instance.division_id,
            f"Locked division playoff format as {instance.format_code}",
            details,
        )
    if isinstance(instance, PlayoffSeries):
        details = {
            "division_id": instance.division_id,
            "stage": instance.stage,
            "series_number": instance.series_number,
            "best_of": instance.best_of,
        }
        return (
            "playoff_series",
            instance.playoff_series_id,
            f"Added {instance.display_label}",
            details,
        )
    if isinstance(instance, PlayoffSeriesParticipant):
        details = {
            "playoff_series_id": instance.playoff_series_id,
            "team_id": instance.team_id,
            "participant_slot": instance.participant_slot,
        }
        return (
            "playoff_series_participant",
            instance.playoff_series_participant_id,
            f"Added team {instance.team_id} to playoff series {instance.playoff_series_id}",
            details,
        )
    if isinstance(instance, SourceFile):
        details = {"source_path": instance.source_path, "sha256": instance.file_sha256}
        return "source_file", instance.source_file_id, f"Archived {instance.source_path}", details
    if isinstance(instance, Team):
        details = {
            "canonical_tag": instance.canonical_tag,
            "canonical_name": instance.canonical_name,
        }
        return "team", instance.team_id, f"Added team {instance.canonical_tag}", details
    if isinstance(instance, TeamSeasonEntry):
        details = {
            "team_id": instance.team_id,
            "season_id": instance.season_id,
            "division_id": instance.division_id,
            "clan_tag": instance.clan_tag,
        }
        return (
            "team_season_entry",
            instance.team_season_entry_id,
            f"Added {instance.clan_tag} to a season/division",
            details,
        )
    if isinstance(instance, Player):
        details = {
            "name": instance.canonical_name,
            "primary_friend_code": instance.primary_friend_code,
        }
        return (
            "player",
            instance.player_id,
            f"Added player {instance.canonical_name or instance.player_id}",
            details,
        )
    if isinstance(instance, PlayerFriendCode):
        details = {"player_id": instance.player_id, "friend_code": instance.friend_code}
        return (
            "player_friend_code",
            instance.player_friend_code_id,
            f"Added friend code {instance.friend_code}",
            details,
        )
    if isinstance(instance, PlayerAlias):
        details = {
            "player_id": instance.player_id,
            "alias_type": instance.alias_type,
            "alias": instance.alias_value,
        }
        return (
            "player_alias",
            instance.player_alias_id,
            f"Added {instance.alias_type} alias {instance.alias_value}",
            details,
        )
    if isinstance(instance, PlayerSeasonEntry):
        details = {
            "player_id": instance.player_id,
            "team_season_entry_id": instance.team_season_entry_id,
            "season_id": instance.season_id,
            "division_id": instance.division_id,
        }
        return (
            "player_season_entry",
            instance.player_season_entry_id,
            f"Added season entry for player {instance.player_id}",
            details,
        )
    if isinstance(instance, Track):
        return (
            "track",
            instance.track_id,
            f"Added track {instance.canonical_name}",
            {"name": instance.canonical_name},
        )
    if isinstance(instance, TrackAlias):
        details = {"track_id": instance.track_id, "alias": instance.alias_value}
        return (
            "track_alias",
            instance.track_alias_id,
            f"Added track alias {instance.alias_value}",
            details,
        )
    if isinstance(instance, Match):
        details = {
            "label": instance.match_label,
            "season_id": instance.season_id,
            "division_id": instance.division_id,
        }
        return "match", instance.match_id, f"Committed match {instance.match_label}", details
    raise TypeError(f"Unsupported addition type: {type(instance).__name__}")


def record_addition_logs(session, additions: list[Any], match_id: int) -> list[DatabaseAdditionLog]:
    logs = []
    for instance in additions:
        entity_type, entity_id, summary, details = _addition_data(instance)
        log = DatabaseAdditionLog(
            match_id=match_id,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
            details_json=json.dumps(details, ensure_ascii=False, separators=(",", ":")),
        )
        session.add(log)
        logs.append(log)
    session.flush()
    return logs


def serialize_addition_log(log: DatabaseAdditionLog) -> dict[str, Any]:
    return {
        "id": log.addition_log_id,
        "match_id": log.match_id,
        "entity_type": log.entity_type,
        "entity_id": log.entity_id,
        "summary": log.summary,
        "details": json.loads(log.details_json or "{}"),
        "created_at": log.created_at.isoformat() if log.created_at else None,
    }


def find_duplicate_source(session, document: UploadDocument) -> SourceFile | None:
    return session.scalar(
        select(SourceFile).where(
            (SourceFile.file_sha256 == document.fingerprint)
            | (SourceFile.source_path == document.source_path)
        )
    )


def find_match_conflict(session, match_data: dict[str, Any]) -> Match | None:
    league = str(match_data.get("league") or "ctc").strip().lower()
    season_code = str(match_data.get("season") or "").strip().lower()
    division_code = str(match_data.get("division") or "").strip().lower()
    season = session.scalar(
        select(Season).where(Season.league_code == league, Season.season_code == season_code)
    )
    if not season:
        return None
    division = session.scalar(
        select(Division).where(
            Division.season_id == season.season_id, Division.division_code == division_code
        )
    )
    if not division:
        return None

    references = {str(value).strip() for value in match_data.get("rxx") or [] if str(value).strip()}
    if references:
        referenced_match = session.scalar(
            select(Match)
            .join(MatchTableRef, MatchTableRef.match_id == Match.match_id)
            .where(
                Match.season_id == season.season_id,
                Match.division_id == division.division_id,
                MatchTableRef.ref_value.in_(references),
            )
            .limit(1)
        )
        if referenced_match:
            return referenced_match
    return None


def reconcile_archive(session, root: Path | None = None) -> dict[str, list[dict[str, str]]]:
    from archive_storage import get_archive_storage

    root = (root or json_root()).resolve()
    storage = get_archive_storage()
    missing_files = []
    hash_mismatches = []
    known_paths = set()
    known_hashes = set()
    for source in session.scalars(select(SourceFile)).all():
        if source.source_path.startswith("preview/"):
            continue
        if source.storage_object_key and source.storage_object_key.startswith("accepted/"):
            try:
                content = storage.read(source.storage_object_key)
            except Exception:
                missing_files.append({"source_path": source.storage_object_key})
                continue
            actual_hash = hashlib.sha256(content).hexdigest()
            if actual_hash != source.file_sha256:
                hash_mismatches.append(
                    {
                        "source_path": source.storage_object_key,
                        "database": source.file_sha256,
                        "actual": actual_hash,
                    }
                )
            known_hashes.add(source.file_sha256)
            continue
        relative = Path(source.source_path)
        if relative.parts and relative.parts[0] == "JSON":
            relative = Path(*relative.parts[1:])
        path = root / relative
        known_paths.add(path.resolve())
        known_hashes.add(source.file_sha256)
        if not path.exists():
            missing_files.append({"source_path": source.source_path})
            continue
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_hash != source.file_sha256:
            hash_mismatches.append(
                {
                    "source_path": source.source_path,
                    "database": source.file_sha256,
                    "actual": actual_hash,
                }
            )

    archive_files = [
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in {".json", ".txt"}
    ]
    json_stems = {
        path.with_suffix("").resolve() for path in archive_files if path.suffix.lower() == ".json"
    }
    orphan_files = [
        {"path": path.relative_to(root).as_posix()}
        for path in archive_files
        if path.resolve() not in known_paths
        and not (path.suffix.lower() == ".txt" and path.with_suffix("").resolve() in json_stems)
        and hashlib.sha256(path.read_bytes()).hexdigest() not in known_hashes
    ]
    return {
        "missing_files": missing_files,
        "hash_mismatches": hash_mismatches,
        "orphan_files": orphan_files,
    }

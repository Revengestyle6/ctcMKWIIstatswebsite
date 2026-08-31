from datetime import datetime, timezone

from models import TeamSeasonEntry

VALID_COMPETITION_STATUSES = frozenset({"active", "dropped", "disqualified"})


def update_team_competition_status(session, team_season_entry_id, payload):
    entry = session.get(TeamSeasonEntry, team_season_entry_id)
    if entry is None:
        raise LookupError("Team season entry was not found.")
    status = str(payload.get("status") or "").strip().lower()
    if status not in VALID_COMPETITION_STATUSES:
        raise ValueError("Status must be active, dropped, or disqualified.")
    note = str(payload.get("note") or "").strip() or None
    previous = {
        "status": entry.competition_status,
        "note": entry.competition_status_note,
    }
    entry.competition_status = status
    entry.competition_status_note = note
    entry.competition_status_updated_at = datetime.now(timezone.utc)
    return {
        "team_season_entry_id": entry.team_season_entry_id,
        "team_id": entry.team_id,
        "status": entry.competition_status,
        "note": entry.competition_status_note,
        "updated_at": entry.competition_status_updated_at.isoformat(),
    }, previous

import hashlib
from io import BytesIO

from division_order import division_order
from media_storage import get_media_storage
from models import Division, Season, Team, TeamLogo, TeamSeasonEntry
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import and_, case, desc, func, select, update

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
MAX_OUTPUT_DIMENSION = 1024
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
UPLOADED_LOGO_PREFIX = "team-logos/"


def _season_payload(season):
    return {
        "id": season.season_id,
        "league": season.league_code,
        "season": season.season_code,
        "name": season.name,
        "season_number": season.season_number,
    }


def _entry_payload(entry, season, division):
    return {
        "id": entry.team_season_entry_id,
        "display_name": entry.display_name,
        "clan_tag": entry.clan_tag,
        "season": _season_payload(season),
        "division": {
            "id": division.division_id,
            "code": division.division_code,
            "name": division.division_name,
        },
    }


def _logo_payload(logo, season=None, entry=None, division=None):
    uploaded = logo.asset_path.startswith(UPLOADED_LOGO_PREFIX)
    return {
        "id": logo.team_logo_id,
        "team_id": logo.team_id,
        "season": _season_payload(season) if season else None,
        "team_season_entry": (
            _entry_payload(entry, season, division) if entry and season and division else None
        ),
        "alt_text": logo.alt_text,
        "priority": logo.priority,
        "is_active": logo.is_active,
        "source": "upload" if uploaded else "static",
        "url": (
            f"/api/team-logos/{logo.team_logo_id}/content"
            if uploaded
            else f"/{logo.asset_path.strip().lstrip('/')}"
        ),
        "created_at": logo.created_at.isoformat() if logo.created_at else None,
    }


def get_team_logo_detail(session, team_id):
    team = session.get(Team, team_id)
    if team is None:
        raise LookupError("Team not found.")
    rows = session.execute(
        select(TeamLogo, Season, TeamSeasonEntry, Division)
        .outerjoin(Season, Season.season_id == TeamLogo.season_id)
        .outerjoin(
            TeamSeasonEntry,
            TeamSeasonEntry.team_season_entry_id == TeamLogo.team_season_entry_id,
        )
        .outerjoin(Division, Division.division_id == TeamSeasonEntry.division_id)
        .where(TeamLogo.team_id == team_id)
        .order_by(
            case((TeamLogo.season_id.is_(None), 0), else_=1),
            desc(Season.season_number),
            *division_order(Division.division_code),
            desc(TeamLogo.priority),
            desc(TeamLogo.team_logo_id),
        )
    ).all()
    entry_rows = session.execute(
        select(TeamSeasonEntry, Season, Division)
        .join(Season, Season.season_id == TeamSeasonEntry.season_id)
        .join(Division, Division.division_id == TeamSeasonEntry.division_id)
        .where(TeamSeasonEntry.team_id == team_id)
        .order_by(
            desc(Season.season_number), Season.season_code, *division_order(Division.division_code)
        )
    ).all()
    seasons = []
    seen_season_ids = set()
    for _, season, _ in entry_rows:
        if season.season_id not in seen_season_ids:
            seen_season_ids.add(season.season_id)
            seasons.append(season)
    return {
        "team": {
            "id": team.team_id,
            "canonical_name": team.canonical_name,
            "canonical_tag": team.canonical_tag,
        },
        "seasons": [_season_payload(season) for season in seasons],
        "season_entries": [
            _entry_payload(entry, season, division) for entry, season, division in entry_rows
        ],
        "logos": [
            _logo_payload(logo, season, entry, division) for logo, season, entry, division in rows
        ],
    }


def _resolve_scope(session, team_id, season_id=None, team_season_entry_id=None):
    if season_id is not None and team_season_entry_id is not None:
        raise ValueError("Choose either a season-wide scope or a division entry, not both.")
    if team_season_entry_id is not None:
        entry = session.get(TeamSeasonEntry, team_season_entry_id)
        if entry is None or entry.team_id != team_id:
            raise ValueError("The selected team season and division entry is invalid.")
        return entry.season_id, entry.team_season_entry_id
    if season_id is not None:
        season = session.get(Season, season_id)
        if season is None:
            raise ValueError("The selected season does not exist.")
        membership = session.scalar(
            select(TeamSeasonEntry.team_season_entry_id)
            .where(
                TeamSeasonEntry.team_id == team_id,
                TeamSeasonEntry.season_id == season_id,
            )
            .limit(1)
        )
        if membership is None:
            raise ValueError("This team did not participate in the selected season.")
    return season_id, None


def _scope_filter(season_id, team_season_entry_id):
    if team_season_entry_id is not None:
        return TeamLogo.team_season_entry_id == team_season_entry_id
    if season_id is not None:
        return and_(
            TeamLogo.season_id == season_id,
            TeamLogo.team_season_entry_id.is_(None),
        )
    return and_(TeamLogo.season_id.is_(None), TeamLogo.team_season_entry_id.is_(None))


def normalize_logo(content):
    if not content:
        raise ValueError("Choose an image to upload.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("Logo images must be 5 MB or smaller.")
    try:
        Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
        with Image.open(BytesIO(content)) as source:
            if source.format not in ALLOWED_FORMATS:
                raise ValueError("Logo images must be PNG, JPEG, or WebP.")
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise ValueError("Logo images may contain at most 16 million pixels.")
            source.load()
            image = ImageOps.exif_transpose(source).convert("RGBA")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError("The uploaded file is not a valid supported image.") from error
    image.thumbnail((MAX_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION), Image.Resampling.LANCZOS)
    output = BytesIO()
    image.save(output, "WEBP", lossless=True, method=6)
    return output.getvalue()


def create_team_logo(
    session,
    team_id,
    content,
    season_id=None,
    team_season_entry_id=None,
    alt_text="",
):
    team = session.get(Team, team_id)
    if team is None:
        raise LookupError("Team not found.")
    season_id, team_season_entry_id = _resolve_scope(
        session, team_id, season_id, team_season_entry_id
    )
    normalized = normalize_logo(content)
    fingerprint = hashlib.sha256(normalized).hexdigest()
    key = f"team-logos/{team_id}/{fingerprint[:24]}.webp"
    get_media_storage().put(key, normalized, "image/webp")

    scope_filter = _scope_filter(season_id, team_season_entry_id)
    session.execute(
        update(TeamLogo)
        .where(TeamLogo.team_id == team_id, scope_filter, TeamLogo.is_active.is_(True))
        .values(is_active=False)
    )
    priority = session.scalar(
        select(func.coalesce(func.max(TeamLogo.priority), -1)).where(
            TeamLogo.team_id == team_id, scope_filter
        )
    )
    existing = session.scalar(
        select(TeamLogo).where(
            TeamLogo.team_id == team_id,
            scope_filter,
            TeamLogo.asset_path == key,
        )
    )
    if existing is not None:
        existing.alt_text = str(alt_text or "").strip() or f"{team.canonical_name} logo"
        existing.priority = int(priority) + 1
        existing.is_active = True
        session.flush()
        return get_team_logo_detail(session, team_id), existing
    logo = TeamLogo(
        team_id=team_id,
        season_id=season_id,
        team_season_entry_id=team_season_entry_id,
        asset_path=key,
        alt_text=str(alt_text or "").strip() or f"{team.canonical_name} logo",
        priority=int(priority) + 1,
        is_active=True,
    )
    session.add(logo)
    session.flush()
    return get_team_logo_detail(session, team_id), logo


def reuse_team_logo(
    session,
    team_id,
    source_logo_id,
    season_id=None,
    team_season_entry_id=None,
    alt_text="",
):
    team = session.get(Team, team_id)
    if team is None:
        raise LookupError("Team not found.")
    source = session.get(TeamLogo, source_logo_id)
    if source is None or source.team_id != team_id:
        raise LookupError("Team logo not found.")
    season_id, team_season_entry_id = _resolve_scope(
        session, team_id, season_id, team_season_entry_id
    )
    scope_filter = _scope_filter(season_id, team_season_entry_id)
    session.execute(
        update(TeamLogo)
        .where(TeamLogo.team_id == team_id, scope_filter, TeamLogo.is_active.is_(True))
        .values(is_active=False)
    )
    priority = session.scalar(
        select(func.coalesce(func.max(TeamLogo.priority), -1)).where(
            TeamLogo.team_id == team_id, scope_filter
        )
    )
    replacement_alt_text = str(alt_text or "").strip() or source.alt_text
    existing = session.scalar(
        select(TeamLogo).where(
            TeamLogo.team_id == team_id,
            scope_filter,
            TeamLogo.asset_path == source.asset_path,
        )
    )
    if existing is not None:
        existing.alt_text = replacement_alt_text
        existing.priority = int(priority) + 1
        existing.is_active = True
        session.flush()
        return get_team_logo_detail(session, team_id), existing

    logo = TeamLogo(
        team_id=team_id,
        season_id=season_id,
        team_season_entry_id=team_season_entry_id,
        asset_path=source.asset_path,
        alt_text=replacement_alt_text,
        priority=int(priority) + 1,
        is_active=True,
    )
    session.add(logo)
    session.flush()
    return get_team_logo_detail(session, team_id), logo


def update_team_logo(session, team_id, logo_id, payload):
    if not isinstance(payload, dict):
        raise ValueError("Team logo updates must be a JSON object.")
    logo = session.get(TeamLogo, logo_id)
    if logo is None or logo.team_id != team_id:
        raise LookupError("Team logo not found.")
    if "alt_text" in payload:
        alt_text = str(payload.get("alt_text") or "").strip()
        if not alt_text:
            raise ValueError("Logo alt text is required.")
        logo.alt_text = alt_text
    if "is_active" in payload:
        is_active = payload["is_active"]
        if not isinstance(is_active, bool):
            raise ValueError("is_active must be true or false.")
        if is_active:
            scope_filter = _scope_filter(logo.season_id, logo.team_season_entry_id)
            session.execute(
                update(TeamLogo)
                .where(
                    TeamLogo.team_id == team_id,
                    scope_filter,
                    TeamLogo.team_logo_id != logo_id,
                )
                .values(is_active=False)
            )
            maximum = session.scalar(
                select(func.coalesce(func.max(TeamLogo.priority), -1)).where(
                    TeamLogo.team_id == team_id, scope_filter
                )
            )
            logo.priority = int(maximum) + 1
        logo.is_active = is_active
    session.flush()
    return get_team_logo_detail(session, team_id), logo

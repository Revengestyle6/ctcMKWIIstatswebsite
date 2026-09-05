from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any

from models import (
    Division,
    DivisionPlayoffConfig,
    Match,
    MatchTeam,
    PlayoffSeries,
    PlayoffSeriesParticipant,
    TeamSeasonEntry,
)
from sqlalchemy import select


@dataclass(frozen=True)
class PlayoffFormatDefinition:
    code: str
    label: str
    playoff_team_count: int
    semifinal_series_count: int
    finals_bye_count: int


PLAYOFF_FORMATS = {
    "three_team": PlayoffFormatDefinition("three_team", "3-team playoff", 3, 1, 1),
    "four_team": PlayoffFormatDefinition("four_team", "4-team playoff", 4, 2, 0),
}


def match_type(match_data: dict[str, Any]) -> str:
    value = str(match_data.get("match_type") or "regular").strip().lower()
    if value not in {"regular", "playoff"}:
        raise ValueError("Match type must be regular or playoff.")
    return value


def automatic_match_label(match_data: dict[str, Any]) -> str:
    """Build the stable label used for new editor-created matches."""
    kind = match_type(match_data)
    if kind == "playoff":
        stage = str(match_data.get("playoff_stage") or "").strip().lower()
        series_number = match_data.get("playoff_series_number")
        series_match_number = match_data.get("series_match_number")
        if stage == "finals":
            series_label = "Finals"
        elif stage == "semifinals" and series_number:
            series_label = f"Semifinals Series {series_number}"
        else:
            series_label = "Playoff"
        return (
            f"{series_label} — Match {series_match_number}" if series_match_number else series_label
        )

    match_number = match_data.get("match_number", match_data.get("week"))
    number_label = (
        f"M{match_number}"
        if isinstance(match_number, int) and not isinstance(match_number, bool) and match_number > 0
        else ""
    )
    team_tags = []
    for team_key, team in (match_data.get("teams") or {}).items():
        raw_tag = team_key if "table_tag_str" not in team else team.get("table_tag_str")
        tag = str(raw_tag or "").strip()
        tag = re.sub(r"#[0-9a-f]{3,6}", "", tag, flags=re.IGNORECASE).strip()
        if tag:
            team_tags.append(tag)
    matchup = " vs ".join(team_tags[:2]) if team_tags else ""
    return " ".join(value for value in (number_label, matchup) if value).strip()


def ensure_match_label(match_data: dict[str, Any]) -> str:
    """Preserve an imported label, or add an automatic label for a new document."""
    existing = str(match_data.get("match_label") or "").strip()
    label = existing or automatic_match_label(match_data)
    if label:
        match_data["match_label"] = label
    return label


def _positive_int(value: Any, label: str, *, default: int | None = None) -> int:
    if value is None and default is not None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{label} must be a positive whole number.")
    return value


def validate_competition_metadata(match_data: dict[str, Any]) -> dict[str, Any]:
    kind = match_type(match_data)
    match_number = match_data.get("match_number", match_data.get("week"))
    if kind == "regular":
        _positive_int(match_number, "Match number")
        return {"match_type": kind, "match_number": match_number}

    if match_number is not None:
        raise ValueError("Playoff matches do not have a regular-season match number.")
    format_code = str(match_data.get("playoff_format") or "").strip().lower()
    definition = PLAYOFF_FORMATS.get(format_code)
    if definition is None:
        raise ValueError("Playoff format must be three_team or four_team.")
    stage = str(match_data.get("playoff_stage") or "").strip().lower()
    if stage not in {"semifinals", "finals"}:
        raise ValueError("Playoff stage must be semifinals or finals.")
    series_number = _positive_int(match_data.get("playoff_series_number"), "Series number")
    series_match_number = _positive_int(
        match_data.get("series_match_number"), "Series match number"
    )
    best_of = _positive_int(match_data.get("best_of"), "Best of", default=3)
    if best_of % 2 == 0:
        raise ValueError("Best of must be an odd number.")
    if series_match_number > best_of:
        raise ValueError("Series match number cannot be greater than best of.")
    if stage == "finals" and series_number != 1:
        raise ValueError("Finals must use series number 1.")
    if stage == "semifinals" and series_number > definition.semifinal_series_count:
        raise ValueError(
            f"{definition.label} supports {definition.semifinal_series_count} semifinal "
            f"series, so series {series_number} is invalid."
        )

    teams = match_data.get("teams") or {}
    if len(teams) != 2:
        raise ValueError("A playoff match must contain exactly two teams.")
    scores = [team.get("total_score") for team in teams.values()]
    if not all(
        isinstance(score, (int, float)) and not isinstance(score, bool) and math.isfinite(score)
        for score in scores
    ):
        raise ValueError("Each playoff team must have a numeric total score.")
    if scores[0] == scores[1]:
        raise ValueError("Playoff matches cannot end in a tie.")

    return {
        "match_type": kind,
        "match_number": None,
        "format": definition,
        "stage": stage,
        "series_number": series_number,
        "series_match_number": series_match_number,
        "best_of": best_of,
    }


def _series_team_ids(session, series_id: int) -> tuple[int, ...]:
    return tuple(
        session.scalars(
            select(PlayoffSeriesParticipant.team_id)
            .where(PlayoffSeriesParticipant.playoff_series_id == series_id)
            .order_by(PlayoffSeriesParticipant.participant_slot)
        ).all()
    )


def _series_wins(session, series: PlayoffSeries) -> dict[int, int]:
    wins = {team_id: 0 for team_id in _series_team_ids(session, series.playoff_series_id)}
    by_match: dict[int, list[tuple[int, int | None]]] = {}
    match_rows = session.execute(
        select(Match.match_id, TeamSeasonEntry.team_id, MatchTeam.final_score)
        .join(MatchTeam, MatchTeam.match_id == Match.match_id)
        .join(
            TeamSeasonEntry, TeamSeasonEntry.team_season_entry_id == MatchTeam.team_season_entry_id
        )
        .where(Match.playoff_series_id == series.playoff_series_id)
    )
    for existing_match_id, team_id, score in match_rows:
        by_match.setdefault(existing_match_id, []).append((team_id, score))
    for scores in by_match.values():
        if len(scores) == 2 and scores[0][1] != scores[1][1]:
            winner = max(scores, key=lambda item: item[1] if item[1] is not None else -1)[0]
            wins[winner] = wins.get(winner, 0) + 1
    return wins


def _series_winner(session, series: PlayoffSeries) -> int | None:
    wins = _series_wins(session, series)
    needed = series.best_of // 2 + 1
    return next((team_id for team_id, count in wins.items() if count >= needed), None)


def _validate_new_semifinal_participants(
    session, division_id: int, series_number: int, team_ids: set[int]
) -> None:
    rows = session.execute(
        select(PlayoffSeries.series_number, PlayoffSeriesParticipant.team_id)
        .join(
            PlayoffSeriesParticipant,
            PlayoffSeriesParticipant.playoff_series_id == PlayoffSeries.playoff_series_id,
        )
        .where(
            PlayoffSeries.division_id == division_id,
            PlayoffSeries.stage == "semifinals",
            PlayoffSeries.series_number != series_number,
            PlayoffSeriesParticipant.team_id.in_(team_ids),
        )
    ).all()
    if rows:
        occupied = ", ".join(
            f"team {team_id} in Semifinals Series {existing_number}"
            for existing_number, team_id in rows
        )
        raise ValueError(f"A semifinal team is already assigned to another series: {occupied}.")


def _validate_finals_participants(
    session,
    config: DivisionPlayoffConfig,
    team_ids: set[int],
) -> None:
    semifinals = session.scalars(
        select(PlayoffSeries)
        .where(
            PlayoffSeries.division_id == config.division_id,
            PlayoffSeries.stage == "semifinals",
        )
        .order_by(PlayoffSeries.series_number)
    ).all()
    if len(semifinals) != config.semifinal_series_count:
        raise ValueError("All configured semifinal series must be established before the finals.")
    winners = [_series_winner(session, series) for series in semifinals]
    if any(winner is None for winner in winners):
        raise ValueError("All semifinal series must be decided before the finals can be added.")
    if config.format_code == "four_team" and team_ids != set(winners):
        raise ValueError("The finals teams must be the winners of both semifinal series.")
    if config.format_code == "three_team":
        semifinal_team_ids = set(_series_team_ids(session, semifinals[0].playoff_series_id))
        semifinal_winner = winners[0]
        if semifinal_winner not in team_ids:
            raise ValueError("The winner of the semifinal series must appear in the finals.")
        other_finalists = team_ids - {semifinal_winner}
        if not other_finalists or other_finalists & semifinal_team_ids:
            raise ValueError(
                "The other finals team in a 3-team playoff must be the team that received the bye."
            )


def resolve_playoff_series(
    session,
    season_id: int,
    division: Division,
    match_data: dict[str, Any],
    team_ids: list[int],
) -> tuple[PlayoffSeries, dict[str, Any]]:
    metadata = validate_competition_metadata(match_data)
    if metadata["match_type"] != "playoff":
        raise ValueError("Cannot resolve a playoff series for a regular-season match.")
    if len(set(team_ids)) != 2:
        raise ValueError("A playoff match must resolve to exactly two distinct teams.")

    definition: PlayoffFormatDefinition = metadata["format"]
    config = session.get(DivisionPlayoffConfig, division.division_id)
    if config is None:
        config = DivisionPlayoffConfig(
            division_id=division.division_id,
            format_code=definition.code,
            playoff_team_count=definition.playoff_team_count,
            semifinal_series_count=definition.semifinal_series_count,
            finals_bye_count=definition.finals_bye_count,
        )
        session.add(config)
        session.flush()
    elif config.format_code != definition.code:
        raise ValueError(
            f"This division's playoff format is already locked as {config.format_code}."
        )

    series = session.scalar(
        select(PlayoffSeries)
        .where(
            PlayoffSeries.division_id == division.division_id,
            PlayoffSeries.stage == metadata["stage"],
            PlayoffSeries.series_number == metadata["series_number"],
        )
        .with_for_update()
    )
    submitted_team_ids = set(team_ids)
    if series is None:
        if metadata["stage"] == "semifinals":
            _validate_new_semifinal_participants(
                session, division.division_id, metadata["series_number"], submitted_team_ids
            )
        else:
            _validate_finals_participants(session, config, submitted_team_ids)
        label = (
            f"Semifinals Series {metadata['series_number']}"
            if metadata["stage"] == "semifinals"
            else "Finals"
        )
        series = PlayoffSeries(
            season_id=season_id,
            division_id=division.division_id,
            stage=metadata["stage"],
            series_number=metadata["series_number"],
            best_of=metadata["best_of"],
            display_label=label,
        )
        session.add(series)
        session.flush()
        for slot, team_id in enumerate(team_ids, start=1):
            session.add(
                PlayoffSeriesParticipant(
                    playoff_series_id=series.playoff_series_id,
                    team_id=team_id,
                    participant_slot=slot,
                )
            )
        session.flush()
    else:
        if series.best_of != metadata["best_of"]:
            raise ValueError(f"This series is already configured as best of {series.best_of}.")
        if set(_series_team_ids(session, series.playoff_series_id)) != submitted_team_ids:
            raise ValueError(
                "The teams do not match the teams already established for this series."
            )

    existing_numbers = set(
        session.scalars(
            select(Match.series_match_number).where(
                Match.playoff_series_id == series.playoff_series_id
            )
        ).all()
    )
    if metadata["series_match_number"] in existing_numbers:
        raise ValueError(
            f"Match {metadata['series_match_number']} already exists in this playoff series."
        )
    expected_number = next(
        number for number in range(1, metadata["best_of"] + 1) if number not in existing_numbers
    )
    if metadata["series_match_number"] != expected_number:
        raise ValueError(f"The next match in this series must be Match {expected_number}.")
    filling_earlier_gap = any(
        number > metadata["series_match_number"] for number in existing_numbers
    )
    if _series_winner(session, series) is not None and not filling_earlier_gap:
        raise ValueError("This playoff series has already been clinched.")
    return series, metadata


def validate_playoff_against_existing(
    session,
    division: Division | None,
    match_data: dict[str, Any],
    team_ids: list[int],
) -> None:
    metadata = validate_competition_metadata(match_data)
    if metadata["match_type"] != "playoff" or division is None:
        return
    config = session.get(DivisionPlayoffConfig, division.division_id)
    definition: PlayoffFormatDefinition = metadata["format"]
    if config is None:
        return
    if config.format_code != definition.code:
        raise ValueError(
            f"This division's playoff format is already locked as {config.format_code}."
        )
    if len(set(team_ids)) != 2:
        return
    submitted_team_ids = set(team_ids)
    series = session.scalar(
        select(PlayoffSeries).where(
            PlayoffSeries.division_id == division.division_id,
            PlayoffSeries.stage == metadata["stage"],
            PlayoffSeries.series_number == metadata["series_number"],
        )
    )
    if series is None:
        if metadata["stage"] == "semifinals":
            _validate_new_semifinal_participants(
                session, division.division_id, metadata["series_number"], submitted_team_ids
            )
        else:
            _validate_finals_participants(session, config, submitted_team_ids)
        return
    if series.best_of != metadata["best_of"]:
        raise ValueError(f"This series is already configured as best of {series.best_of}.")
    if set(_series_team_ids(session, series.playoff_series_id)) != submitted_team_ids:
        raise ValueError("The teams do not match the teams already established for this series.")
    existing_numbers = set(
        session.scalars(
            select(Match.series_match_number).where(
                Match.playoff_series_id == series.playoff_series_id
            )
        ).all()
    )
    if metadata["series_match_number"] in existing_numbers:
        raise ValueError(
            f"Match {metadata['series_match_number']} already exists in this playoff series."
        )
    expected_number = next(
        number for number in range(1, metadata["best_of"] + 1) if number not in existing_numbers
    )
    if metadata["series_match_number"] != expected_number:
        raise ValueError(f"The next match in this series must be Match {expected_number}.")
    filling_earlier_gap = any(
        number > metadata["series_match_number"] for number in existing_numbers
    )
    if _series_winner(session, series) is not None and not filling_earlier_gap:
        raise ValueError("This playoff series has already been clinched.")


def playoff_format_new_entry(match_data: dict[str, Any]) -> dict[str, Any] | None:
    metadata = validate_competition_metadata(match_data)
    if metadata["match_type"] != "playoff":
        return None
    definition: PlayoffFormatDefinition = metadata["format"]
    return {
        "format_code": definition.code,
        "format_label": definition.label,
        "playoff_team_count": definition.playoff_team_count,
        "semifinal_series_count": definition.semifinal_series_count,
        "finals_bye_count": definition.finals_bye_count,
    }

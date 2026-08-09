"""Canonical regular-season/playoff analytics filtering."""

from typing import Literal

from models import Match

MatchSet = Literal["regular", "playoffs", "all"]
MATCH_SETS = {"regular", "playoffs", "all"}


def normalize_match_set(value: str | None) -> MatchSet:
    normalized = (value or "regular").strip().lower()
    if normalized not in MATCH_SETS:
        raise ValueError("match_set must be regular, playoffs, or all.")
    return normalized  # type: ignore[return-value]


def apply_match_set(statement, match_set: str | None):
    normalized = normalize_match_set(match_set)
    if normalized == "regular":
        return statement.where(Match.match_type == "regular")
    if normalized == "playoffs":
        return statement.where(Match.match_type == "playoff")
    return statement

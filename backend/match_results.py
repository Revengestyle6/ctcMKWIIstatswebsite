import math
from typing import Any

RESULT_TYPES = frozenset({"played", "free_win", "mutual_tie"})
SPECIAL_RESULT_TYPES = frozenset({"free_win", "mutual_tie"})


def result_type(match_data: dict[str, Any]) -> str:
    value = str(match_data.get("result_type") or "played").strip().lower()
    if value not in RESULT_TYPES:
        raise ValueError("Result type must be played, free_win, or mutual_tie.")
    return value


def validate_result_metadata(match_data: dict[str, Any]) -> str:
    kind = result_type(match_data)
    if kind == "played":
        return kind

    if str(match_data.get("match_type") or "regular").strip().lower() != "regular":
        raise ValueError("Free wins and mutual ties must be regular-season matches.")
    teams = match_data.get("teams") or {}
    if not isinstance(teams, dict) or len(teams) != 2:
        raise ValueError("A free win or mutual tie must contain exactly two teams.")
    if match_data.get("tracks") not in (None, []):
        raise ValueError("A free win or mutual tie cannot contain race tracks.")
    if match_data.get("races_played") not in (None, 0):
        raise ValueError("A free win or mutual tie must have zero races played.")
    if any((team or {}).get("players") for team in teams.values()):
        raise ValueError("A free win or mutual tie cannot contain players.")
    if any(
        (team or {}).get("penalties") or str((team or {}).get("table_penalty_str") or "").strip()
        for team in teams.values()
    ):
        raise ValueError("A free win or mutual tie cannot contain penalties.")

    scores = [(team or {}).get("total_score") for team in teams.values()]
    if not all(
        isinstance(score, (int, float)) and not isinstance(score, bool) and math.isfinite(score)
        for score in scores
    ):
        raise ValueError("Each team in a special result must have a numeric score.")
    expected = sorted((0, 150) if kind == "free_win" else (0, 0))
    if sorted(int(score) for score in scores) != expected:
        label = "150-0" if kind == "free_win" else "0-0"
        raise ValueError(f"A {kind.replace('_', ' ')} must be scored {label}.")
    return kind

import math
from collections import defaultdict
from decimal import Decimal
from numbers import Real

from sqlalchemy import select

from models import RacePlayerResult


VALID_ROLES = frozenset({"runner", "bagger"})


def normalize_role(value):
    role = (
        "runner"
        if value is None or str(value).strip() == ""
        else str(value).strip().lower()
    )
    if role not in VALID_ROLES:
        raise ValueError("role must be runner or bagger.")
    return role


def _numeric_value(value):
    if isinstance(value, bool) or not isinstance(value, (Real, Decimal)):
        return None
    if not math.isfinite(float(value)):
        return None
    return value


def valid_race_score(score):
    numeric_score = _numeric_value(score)
    return numeric_score is not None and 0 <= numeric_score <= 15


def classify_role(row, confirmed_ids):
    if row.role in VALID_ROLES:
        source = "inferred" if row.role_source == "inferred" else "explicit"
        return row.role, source

    placement = _numeric_value(row.position)
    if row.race_id not in confirmed_ids or placement is None:
        return "unknown", "unknown"
    if 1 <= placement <= 8:
        return "runner", "inferred"
    if 9 <= placement <= 10:
        return "bagger", "inferred"
    return "unknown", "unknown"


def confirmed_5v5_race_ids(session, rows):
    candidate_ids = {row.race_id for row in rows}
    if not candidate_ids:
        return set()

    all_results = session.execute(
        select(RacePlayerResult).where(RacePlayerResult.race_id.in_(candidate_ids))
    ).scalars()
    by_race = defaultdict(list)
    for result in all_results:
        by_race[result.race_id].append(result)

    confirmed = set()
    for race_id, race_rows in by_race.items():
        if len(race_rows) != 10:
            continue
        by_team = defaultdict(list)
        for row in race_rows:
            by_team[row.match_team_id].append(row)
        if len(by_team) != 2:
            continue
        if all(
            len(team_rows) == 5
            and len({row.player_id for row in team_rows}) == 5
            for team_rows in by_team.values()
        ):
            confirmed.add(race_id)
    return confirmed


def role_coverage(rows, confirmed_ids):
    coverage = {
        "explicit_runner": 0,
        "inferred_runner": 0,
        "explicit_bagger": 0,
        "inferred_bagger": 0,
        "unknown": 0,
        "total": len(rows),
    }
    classified = []
    for row in rows:
        role, source = classify_role(row, confirmed_ids)
        key = "unknown" if role == "unknown" else f"{source}_{role}"
        coverage[key] += 1
        classified.append((row, role, source))

    known = coverage["total"] - coverage["unknown"]
    coverage["known_rate"] = (
        round(known / coverage["total"] * 100, 2) if coverage["total"] else None
    )
    return coverage, classified


def summarize_role_rows(classified_rows, role):
    role = normalize_role(role)
    selected_rows = [
        row
        for row, classified_role, _ in classified_rows
        if classified_role == role
    ]
    scores = [row.score for row in selected_rows if valid_race_score(row.score)]
    placements = [
        placement
        for row in selected_rows
        if (placement := _numeric_value(row.position)) is not None
    ]
    total_points = sum(scores)
    scored_races = len(scores)
    points_per_race = (
        round(total_points / scored_races, 2) if scored_races else None
    )

    summary = {
        "role": role,
        "races": len(selected_rows),
        "scored_races": scored_races,
        "total_points": total_points,
        "points_per_race": points_per_race,
        "average_placement": (
            round(sum(placements) / len(placements), 2) if placements else None
        ),
        "excluded_score_rows": sum(
            1
            for row in selected_rows
            if row.score is not None and not valid_race_score(row.score)
        ),
    }

    if role == "runner":
        wins = sum(1 for placement in placements if placement == 1)
        podiums = sum(1 for placement in placements if 1 <= placement <= 3)
        summary.update(
            {
                "twelve_race_pace": (
                    round(total_points / scored_races * 12, 2)
                    if scored_races
                    else None
                ),
                "wins": wins,
                "podiums": podiums,
                "podium_rate": (
                    round(podiums / scored_races * 100, 2)
                    if scored_races
                    else None
                ),
            }
        )
    else:
        bag_points = sum(1 for score in scores if score > 0)
        zero_points = sum(1 for score in scores if score == 0)
        summary.update(
            {
                "bag_points": bag_points,
                "bag_point_rate": (
                    round(bag_points / scored_races * 100, 2)
                    if scored_races
                    else None
                ),
                "zero_points": zero_points,
                "zero_point_rate": (
                    round(zero_points / scored_races * 100, 2)
                    if scored_races
                    else None
                ),
            }
        )
    return summary


def bagger_counterpart_summary(session, selected_player_id, classified_rows):
    candidate_ids = {
        row.race_id
        for row, role, _ in classified_rows
        if role == "bagger" and row.player_id == selected_player_id
    }
    empty_summary = {
        "counterpart_races": 0,
        "opponent_points_for": 0,
        "opponent_points_against": 0,
        "opponent_point_differential": 0,
    }
    if not candidate_ids:
        return empty_summary

    all_rows = list(
        session.execute(
            select(RacePlayerResult).where(
                RacePlayerResult.race_id.in_(candidate_ids)
            )
        ).scalars()
    )
    confirmed_ids = confirmed_5v5_race_ids(session, all_rows)
    _, all_classified = role_coverage(all_rows, confirmed_ids)
    by_race = defaultdict(list)
    for classified in all_classified:
        by_race[classified[0].race_id].append(classified)

    counterpart_races = 0
    points_for = 0
    points_against = 0
    for race_id in candidate_ids & confirmed_ids:
        baggers_by_team = defaultdict(list)
        for row, role, _ in by_race[race_id]:
            if role == "bagger":
                baggers_by_team[row.match_team_id].append(row)
        if len(baggers_by_team) != 2 or any(
            len(team_baggers) != 1 for team_baggers in baggers_by_team.values()
        ):
            continue

        baggers = [team_baggers[0] for team_baggers in baggers_by_team.values()]
        selected = next(
            (row for row in baggers if row.player_id == selected_player_id), None
        )
        if selected is None:
            continue
        opponent = next(row for row in baggers if row is not selected)
        if not valid_race_score(selected.score) or not valid_race_score(opponent.score):
            continue

        counterpart_races += 1
        points_for += selected.score
        points_against += opponent.score

    return {
        "counterpart_races": counterpart_races,
        "opponent_points_for": points_for,
        "opponent_points_against": points_against,
        "opponent_point_differential": points_for - points_against,
    }

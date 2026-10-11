import type { MatchJson, MatchPlayerJson, TeamJson } from "./matchJsonEditorModel";

export type AggregateScore = {
  gp_number: number;
  role: "runner" | "bagger";
  points: number;
  races: number;
  disconnection_points: number;
};
export type AggregateAward = {
  gp_number: number;
  points: number;
  reason: "short_roster" | "unreplaced_disconnect" | "unknown";
};

export function aggregatePeriods(match: MatchJson): number[] {
  return match.entry_mode === "totals"
    ? [0]
    : Array.from({ length: Math.ceil((match.races_played ?? 12) / 4) }, (_, index) => index + 1);
}

export function emptyAggregateScore(gp: number, role: AggregateScore["role"]): AggregateScore {
  return { gp_number: gp, role, points: 0, races: 0, disconnection_points: 0 };
}

export function aggregatePlayerTotal(player: MatchPlayerJson): number {
  return (
    (player.aggregate_scores ?? []).reduce((sum, score) => sum + score.points, 0) -
    (player.penalties ?? 0)
  );
}

export function aggregateTeamTotal(team: TeamJson): number {
  return (
    Object.values(team.players ?? {}).reduce(
      (sum, player) => sum + aggregatePlayerTotal(player),
      0
    ) +
    (team.aggregate_awards ?? []).reduce((sum, award) => sum + award.points, 0) -
    (team.penalties ?? 0)
  );
}

export function compileUnaccounted(match: MatchJson, label: string): MatchJson {
  return {
    ...match,
    match_label: label,
    tracks: [],
    title_str: `#title ${match.races_played ?? 12} races\n`,
    teams: Object.fromEntries(
      Object.entries(match.teams ?? {}).map(([key, team]) => {
        const {
          missing_player_scores: _scores,
          missing_player_results: _results,
          ...metadata
        } = team;
        return [
          key,
          {
            ...metadata,
            total_score: aggregateTeamTotal(team),
            players: Object.fromEntries(
              Object.entries(team.players ?? {}).map(([fc, player]) => {
                const {
                  race_scores: _scores,
                  race_positions: _positions,
                  race_roles: _roles,
                  gp_scores: _gps,
                  ...identity
                } = player;
                return [
                  fc,
                  {
                    ...identity,
                    aggregate_scores: player.aggregate_scores?.length
                      ? player.aggregate_scores
                      : aggregatePeriods(match).flatMap((gp) => [
                          emptyAggregateScore(gp, "runner"),
                          emptyAggregateScore(gp, "bagger"),
                        ]),
                    total_score: aggregatePlayerTotal(player),
                    had_penalties: (player.penalties ?? 0) !== 0,
                  },
                ];
              })
            ),
          },
        ];
      })
    ),
  };
}

export function aggregateIssues(match: MatchJson): string[] {
  const issues: string[] = [];
  const integer = (value: number) => Number.isInteger(value) && value >= 0;
  if (!Number.isInteger(match.races_played) || Number(match.races_played) < 1)
    issues.push("Races played must be a positive whole number.");
  if (Object.keys(match.teams ?? {}).length !== 2)
    issues.push("Unaccounted matches require exactly two teams.");
  const formatMatch = (match.format ?? "").match(/^(\d+)v(\d+)$/i);
  if (!formatMatch || Number(formatMatch[1]) < 1 || Number(formatMatch[2]) < 1)
    issues.push("Unaccounted matches require a team format.");
  if (match.entry_mode !== "gp" && match.entry_mode !== "totals")
    issues.push("Unaccounted entry mode must be GP or totals.");
  const periods = aggregatePeriods(match);
  let teamIndex = 0;
  for (const [tag, team] of Object.entries(match.teams ?? {})) {
    if (!Object.keys(team.players ?? {}).length) issues.push(`${tag} requires players.`);
    if (!integer(team.penalties ?? 0))
      issues.push(`${tag} penalty must be a non-negative whole number.`);
    const teamAttendance = new Map<number, number>();
    const teamSize = Number(formatMatch?.[++teamIndex] ?? 0);
    for (const [fc, player] of Object.entries(team.players ?? {})) {
      const attendance = new Map<number, number>();
      const seen = new Set<string>();
      for (const score of player.aggregate_scores ?? []) {
        const key = `${score.gp_number}:${score.role}`;
        if (
          !periods.includes(score.gp_number) ||
          seen.has(key) ||
          !["runner", "bagger"].includes(score.role)
        )
          issues.push(`${fc} has an invalid or duplicate period/role.`);
        seen.add(key);
        if (
          ![score.points, score.races, score.disconnection_points].every(integer) ||
          score.points > score.races * 15 ||
          score.disconnection_points > score.points
        )
          issues.push(`${fc} has invalid role points, race counts, or disconnection points.`);
        attendance.set(score.gp_number, (attendance.get(score.gp_number) ?? 0) + score.races);
        teamAttendance.set(
          score.gp_number,
          (teamAttendance.get(score.gp_number) ?? 0) + score.races
        );
      }
      for (const [gp, count] of Array.from(attendance)) {
        const available =
          gp === 0
            ? (match.races_played ?? 12)
            : Math.min(4, (match.races_played ?? 12) - (gp - 1) * 4);
        if (count > available) issues.push(`${fc} has more role races than the period contains.`);
      }
      if (!integer(player.penalties ?? 0))
        issues.push(`${fc} penalty must be a non-negative whole number.`);
    }
    for (const [gp, count] of Array.from(teamAttendance)) {
      const available =
        gp === 0
          ? (match.races_played ?? 12)
          : Math.min(4, (match.races_played ?? 12) - (gp - 1) * 4);
      if (count > teamSize * available)
        issues.push(`${tag} has more role races than the available player slots.`);
    }
    for (const award of team.aggregate_awards ?? [])
      if (
        !integer(award.points) ||
        !periods.includes(award.gp_number) ||
        !["short_roster", "unreplaced_disconnect", "unknown"].includes(award.reason)
      )
        issues.push(`${tag} has invalid missing player points.`);
  }
  return Array.from(new Set(issues));
}

export function resetScoreEntries(
  match: MatchJson,
  source: "accounted" | "unaccounted",
  mode: "gp" | "totals" = "gp"
): MatchJson {
  return {
    ...match,
    match_label: (match.match_label ?? "").replace(/ \[Unaccounted[^\]]*\]$/, ""),
    score_source: source,
    entry_mode: source === "unaccounted" ? mode : undefined,
    tracks: source === "unaccounted" ? [] : Array(match.races_played ?? 12).fill(""),
    teams: Object.fromEntries(
      Object.entries(match.teams ?? {}).map(([key, team]) => [
        key,
        {
          ...team,
          aggregate_awards: source === "unaccounted" ? [] : undefined,
          missing_player_scores: undefined,
          missing_player_results: undefined,
          players: Object.fromEntries(
            Object.entries(team.players ?? {}).map(([fc, player]) => [
              fc,
              {
                ...player,
                aggregate_scores: source === "unaccounted" ? [] : undefined,
                race_scores: undefined,
                race_positions: undefined,
                race_roles: undefined,
                gp_scores: undefined,
              },
            ])
          ),
        },
      ])
    ),
  };
}

export function hasAggregateScores(match: MatchJson): boolean {
  return Object.values(match.teams ?? {}).some(
    (team) =>
      team.aggregate_awards?.some((award) => award.points) ||
      Object.values(team.players ?? {}).some((player) =>
        player.aggregate_scores?.some(
          (score) => score.points || score.races || score.disconnection_points
        )
      )
  );
}

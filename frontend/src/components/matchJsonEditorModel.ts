export type RaceRole = "runner" | "bagger" | null;

export type MatchPlayerJson = {
  table_str?: string; mii_name?: string; lounge_name?: string; table_name?: string;
  tag?: string; total_score?: number; had_penalties?: boolean; penalties?: number;
  subbed_out?: boolean; race_scores?: Array<number | null>;
  race_positions?: Array<number | null>; gp_scores?: Array<Array<number | null>>;
  race_roles?: Array<string | null>; flag?: string; [key: string]: unknown;
};

export type TeamJson = {
  table_tag_str?: string; table_penalty_str?: string; total_score?: number;
  penalties?: number; hex_color?: string; players?: Record<string, MatchPlayerJson>;
  missing_player_scores?: Array<number | null>;
  missing_player_results?: TeamMissingPlayerResultJson[];
  [key: string]: unknown;
};

export type MissingPlayerReason = "short_roster" | "unreplaced_disconnect" | "unknown";
export type TeamMissingPlayerResultJson = {
  race_number: number;
  score: number;
  reason: MissingPlayerReason;
};

export type MatchJson = {
  title_str?: string; format?: string; races_played?: number; league?: string;
  season?: string; division?: string; week?: number; match_label?: string;
  rxx?: string[]; tracks?: string[]; teams?: Record<string, TeamJson>;
  review_notes?: string; [key: string]: unknown;
};

export type PlacementDraft = { playerKey: string; role: RaceRole };
export type UnplacedResultDraft = { playerKey: string; score: number; role: RaceRole };
export type MissingPlayerResultDraft = { teamKey: string; score: number; reason: MissingPlayerReason };
export type RaceDraft = {
  raceNumber: number;
  trackName: string;
  roomSize: number;
  placements: Array<PlacementDraft | null>;
  unplacedResults: UnplacedResultDraft[];
  missingPlayerResults: MissingPlayerResultDraft[];
};

export const SCORE_TABLES: Record<number, number[]> = {
  7: [15, 10, 7, 5, 3, 1, 0],
  8: [15, 11, 8, 6, 4, 2, 1, 0],
  9: [15, 11, 8, 6, 4, 3, 2, 1, 0],
  10: [15, 12, 10, 8, 6, 4, 3, 2, 1, 0],
  11: [15, 12, 10, 9, 8, 7, 6, 5, 4, 2, 1],
  12: [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
};

export function scoreForPosition(position: number, roomSize: number): number | null {
  return SCORE_TABLES[roomSize]?.[position - 1] ?? null;
}

export function expectedRoomSize(format = "5v5"): number {
  const teamMatch = format.match(/^(\d+)v(\d+)$/i);
  if (teamMatch) return Number(teamMatch[1]) + Number(teamMatch[2]);
  return format.toLowerCase() === "ffa" ? 12 : 10;
}

export function defaultRoleForPosition(format: string | undefined, position: number): RaceRole {
  if ((format ?? "").trim().toLowerCase() !== "5v5") return null;
  return position <= 8 ? "runner" : "bagger";
}

export function teamTag(teamKey: string, team: TeamJson): string {
  if (!("table_tag_str" in team)) return teamKey;
  return String(team.table_tag_str ?? "").replace(/#[0-9a-f]{3,6}/i, "").trim();
}

export function teamColor(team: TeamJson): string {
  if ("hex_color" in team) return String(team.hex_color ?? "");
  return (team.table_tag_str ?? "").match(/#[0-9a-f]{3,6}/i)?.[0].toUpperCase() || "#64748B";
}

export function playerLabel(player: MatchPlayerJson, friendCode: string): string {
  return player.mii_name || player.lounge_name || player.table_name || friendCode;
}

function isMissingPlayerPlaceholder(player: MatchPlayerJson): boolean {
  return [player.table_str, player.mii_name, player.lounge_name, player.table_name]
    .some((value) => String(value ?? "").toLowerCase().includes("missing player"));
}

export function allPlayers(match: MatchJson): Array<{ playerKey: string; friendCode: string; teamKey: string; player: MatchPlayerJson }> {
  return Object.entries(match.teams ?? {}).flatMap(([teamKey, team]) =>
    Object.entries(team.players ?? {}).map(([friendCode, player]) => ({
      playerKey: `${teamKey}::${friendCode}`, friendCode, teamKey, player,
    }))
  );
}

export function racesFromMatch(match: MatchJson): RaceDraft[] {
  const count = match.races_played ?? match.tracks?.length ?? 12;
  const players = allPlayers(match);
  const fallbackRoom = expectedRoomSize(match.format);
  return Array.from({ length: count }, (_, raceIndex) => {
    const byPosition = new Map<number, PlacementDraft>();
    const scorePairs: Array<{ position: number; score: number }> = [];
    const unplacedResults: UnplacedResultDraft[] = [];
    const missingPlayerResults = Object.entries(match.teams ?? {}).flatMap(([teamKey, team]) => {
      const explicitResults = (team.missing_player_results ?? [])
        .filter((result) => result.race_number === raceIndex + 1)
        .map((result) => ({ teamKey, score: result.score, reason: result.reason ?? "unknown" as MissingPlayerReason }));
      if (explicitResults.length > 0) return explicitResults;
      const legacyScore = team.missing_player_scores?.[raceIndex];
      return typeof legacyScore === "number"
        ? [{ teamKey, score: legacyScore, reason: "unknown" as MissingPlayerReason }]
        : [];
    });
    players.forEach(({ playerKey, teamKey, player }) => {
      const position = player.race_positions?.[raceIndex];
      const score = player.race_scores?.[raceIndex];
      if (typeof position === "number" && position > 0 && !byPosition.has(position)) {
        const rawRole = player.race_roles?.[raceIndex];
        const role: RaceRole = rawRole === "runner" || rawRole === "bagger"
          ? rawRole
          : defaultRoleForPosition(match.format, position);
        byPosition.set(position, { playerKey, role });
      }
      if ((position === null || position === undefined) && typeof score === "number" && score !== 0) {
        if (isMissingPlayerPlaceholder(player)) {
          if (!missingPlayerResults.some((result) => result.teamKey === teamKey)) {
            missingPlayerResults.push({ teamKey, score, reason: "unknown" });
          }
        } else {
          const rawRole = player.race_roles?.[raceIndex];
          unplacedResults.push({
            playerKey,
            score,
            role: rawRole === "runner" || rawRole === "bagger" ? rawRole : null,
          });
        }
      }
      if (typeof position === "number" && typeof score === "number") scorePairs.push({ position, score });
    });
    const largestPosition = Math.max(0, ...Array.from(byPosition.keys()));
    const candidates = Object.keys(SCORE_TABLES).map(Number).filter((size) => size >= largestPosition);
    const scoredCandidates = candidates.map((size) => ({
      size,
      matches: scorePairs.filter(({ position, score }) => scoreForPosition(position, size) === score).length,
    })).sort((left, right) => right.matches - left.matches || Math.abs(left.size - fallbackRoom) - Math.abs(right.size - fallbackRoom));
    const roomSize = scoredCandidates[0]?.matches ? scoredCandidates[0].size : (SCORE_TABLES[fallbackRoom] ? fallbackRoom : 10);
    return {
      raceNumber: raceIndex + 1,
      trackName: match.tracks?.[raceIndex] ?? "",
      roomSize,
      placements: Array.from({ length: roomSize }, (_, index) => byPosition.get(index + 1) ?? null),
      unplacedResults,
      missingPlayerResults,
    };
  });
}

function gpGroups(scores: Array<number | null>): Array<Array<number | null>> {
  const result: Array<Array<number | null>> = [];
  for (let index = 0; index < scores.length; index += 4) result.push(scores.slice(index, index + 4));
  return result;
}

export function compileMatch(match: MatchJson, races: RaceDraft[]): MatchJson {
  const orderedRaces = [...races].sort((left, right) => left.raceNumber - right.raceNumber);
  const teams = Object.fromEntries(Object.entries(match.teams ?? {}).map(([teamKey, team]) => {
    const tag = teamTag(teamKey, team);
    const color = teamColor(team);
    const players = Object.fromEntries(Object.entries(team.players ?? {}).map(([friendCode, player]) => {
      const key = `${teamKey}::${friendCode}`;
      const positions = orderedRaces.map((race) => {
        const index = race.placements.findIndex((placement) => placement?.playerKey === key);
        return index >= 0 ? index + 1 : null;
      });
      const scores = positions.map((position, index) => {
        if (position) return scoreForPosition(position, orderedRaces[index].roomSize);
        return orderedRaces[index].unplacedResults.find((result) => result.playerKey === key)?.score ?? null;
      });
      const roles = orderedRaces.map((race) =>
        race.placements.find((placement) => placement?.playerKey === key)?.role
        ?? race.unplacedResults.find((result) => result.playerKey === key)?.role
        ?? null
      );
      const total = scores.reduce<number>((sum, score) => sum + (score ?? 0), 0) - (player.penalties ?? 0);
      const played = positions.map((position, index) => position ? index : -1).filter((index) => index >= 0);
      const gpScores = gpGroups(scores);
      const gpTotals = gpScores.map((gp) => gp.reduce<number>((sum, score) => sum + (score ?? 0), 0));
      const name = player.table_name || player.lounge_name || player.mii_name || friendCode;
      return [friendCode, {
        ...player,
        table_str: `${name} ${gpTotals.join("|")}`,
        tag,
        total_score: total,
        had_penalties: (player.penalties ?? 0) !== 0,
        subbed_out: played.length > 0 && played[played.length - 1] < orderedRaces.length - 1,
        race_scores: scores,
        race_positions: positions,
        gp_scores: gpScores,
        race_roles: roles,
      }];
    }));
    const gross = Object.values(players).reduce<number>((sum, player) => sum + Number((player as MatchPlayerJson).total_score ?? 0), 0);
    const missingPlayerScores = orderedRaces.map((race) => {
      const scores = race.missingPlayerResults.filter((result) => result.teamKey === teamKey).map((result) => result.score);
      return scores.length ? scores.reduce((sum, score) => sum + score, 0) : null;
    });
    const missingPlayerTotal = missingPlayerScores.reduce<number>((sum, score) => sum + (score ?? 0), 0);
    const missingPlayerResults = orderedRaces.flatMap((race) => race.missingPlayerResults
      .filter((result) => result.teamKey === teamKey)
      .map((result) => ({
        race_number: race.raceNumber,
        score: result.score,
        reason: result.reason,
      })));
    const penalties = Number(team.penalties ?? 0);
    return [tag, {
      ...team,
      table_tag_str: `${tag} ${color}`,
      table_penalty_str: penalties ? `Penalty -${penalties}` : "",
      hex_color: color,
      total_score: gross + missingPlayerTotal - penalties,
      players,
      missing_player_scores: missingPlayerScores.some((score) => score !== null) ? missingPlayerScores : undefined,
      missing_player_results: missingPlayerResults.length ? missingPlayerResults : undefined,
    }];
  }));
  return {
    ...match,
    rxx: (match.rxx ?? []).map((code) => code.trim()).filter(Boolean),
    title_str: `#title ${orderedRaces.length} races\n`,
    races_played: orderedRaces.length,
    tracks: orderedRaces.map((race) => race.trackName),
    teams,
  };
}

export const blankMatch: MatchJson = {
  title_str: "#title 12 races\n", format: "5v5", races_played: 12, league: "ctc",
  season: "", division: "", match_label: "", rxx: [""],
  tracks: Array(12).fill(""), review_notes: "",
  teams: {
    TeamA: { table_tag_str: "TeamA #4F8CFF", hex_color: "#4F8CFF", penalties: 0, players: {} },
    TeamB: { table_tag_str: "TeamB #F45D8C", hex_color: "#F45D8C", penalties: 0, players: {} },
  },
};

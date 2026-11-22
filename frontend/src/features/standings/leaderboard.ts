import type { CompetitionStatus } from "../../api";
export type LeaderboardPlayer = {
  unaccounted_matches?: number;
  player_id: number;
  name: string;
  team_id: number;
  team_tag: string;
  team_season_entry_id: number;
  team_status: CompetitionStatus;
  gps_played: number;
  team_gps: number;
  required_gps: number;
  eligible: boolean;
  eligibility_reason: string | null;
  runner_gps_played: number;
  runner_eligible: boolean;
  runner_eligibility_reason: string | null;
  runner_points: number;
  runner_races: number;
  runner_gp_average: number | null;
  bagger_gps_played: number;
  bagger_eligible: boolean;
  bagger_eligibility_reason: string | null;
  bagger_points: number;
  bagger_races: number;
  bagger_gp_average: number | null;
};

export type LeaderboardRole = "runner" | "bagger";

export function rankLeaderboard(
  players: LeaderboardPlayer[],
  role: LeaderboardRole,
  eligibleOnly: boolean
) {
  const metric = role === "runner" ? "runner_gp_average" : "bagger_gp_average";
  const eligibility = role === "runner" ? "runner_eligible" : "bagger_eligible";
  return players
    .filter((player) => !eligibleOnly || player[eligibility])
    .toSorted(
      (left, right) =>
        (right[metric] ?? -1) - (left[metric] ?? -1) || left.name.localeCompare(right.name)
    );
}

// Qualification can be a repeating decimal. Keep its display exact in sixths.
export function formatQualification(teamGps: number, unit: "gps" | "races" = "gps") {
  const sixths = teamGps * 4 * (unit === "races" ? 4 : 1);
  const whole = Math.floor(sixths / 6);
  const fraction = ["", "⅙", "⅓", "½", "⅔", "⅚"][sixths % 6];
  return `${whole || !fraction ? whole : ""}${fraction}`;
}

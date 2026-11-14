export type LeaderboardPlayer = {
  unaccounted_matches?: number;
  player_id: number;
  name: string;
  team_id: number;
  team_tag: string;
  team_season_entry_id: number;
  team_status: "active" | "dropped" | "disqualified";
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

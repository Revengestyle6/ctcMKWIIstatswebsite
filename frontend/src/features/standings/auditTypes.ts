import type { LeaderboardPlayer, LeaderboardRole } from "./leaderboard";

export type ReviewFlag =
  | "small_room"
  | "dc_award"
  | "unusual_role"
  | "unknown_role"
  | "invalid_score";
export type AuditRace = {
  race_id: number;
  race_number: number;
  gp_number: number;
  track: string;
  room_size: number | null;
  position: number | null;
  points: number | null;
  role: LeaderboardRole | "unknown";
  role_source: string;
  dc_award: boolean;
  included: boolean;
  participated: boolean;
  flags: ReviewFlag[];
};
export type AuditMatch = {
  match_id: number;
  match_number: number;
  label: string;
  teams: string[];
  source: "accounted" | "unaccounted";
  team_races: number;
  team_gps: number;
  roles: Record<LeaderboardRole, { points: number; races: number }>;
  races: AuditRace[];
  aggregate_entries: {
    gp_number: number | null;
    role: LeaderboardRole;
    races: number;
    points: number;
    disconnection_points: number;
  }[];
};
export type StandingsAudit = {
  player: LeaderboardPlayer;
  team_races: number;
  team_gps: number;
  required_gps: number;
  required_races: number;
  dominant_role: LeaderboardRole | null;
  role_history: Record<LeaderboardRole, number>;
  flagged_races: number;
  unknown_role_races: number;
  reconciled: boolean;
  matches: AuditMatch[];
};
export const reviewLabels: Record<ReviewFlag, string> = {
  small_room: "9 or fewer players",
  dc_award: "DC points",
  unusual_role: "Unusual role",
  unknown_role: "Unknown role",
  invalid_score: "Invalid score",
};

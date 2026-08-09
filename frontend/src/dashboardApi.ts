import { fetchCachedJson } from "./api";
import type { MatchSet } from "./components/MatchSetToggle";

export type PlayerRoleMode = "runner" | "bagger";

export interface RoleCoverage {
  explicit_runner: number;
  inferred_runner: number;
  explicit_bagger: number;
  inferred_bagger: number;
  unknown: number;
  total: number;
  known_rate: number | null;
}

export interface BaseRoleMetrics {
  role: PlayerRoleMode;
  races: number;
  scored_races: number;
  total_points: number;
  points_per_race: number | null;
  average_placement: number | null;
  excluded_score_rows: number;
}

export interface RunnerMetrics extends BaseRoleMetrics {
  role: "runner";
  twelve_race_pace: number | null;
  wins: number;
  podiums: number;
  podium_rate: number | null;
}

export interface BaggerTrackMetrics extends BaseRoleMetrics {
  role: "bagger";
  bag_points: number;
  bag_point_rate: number | null;
  zero_points: number;
  zero_point_rate: number | null;
}

export interface BaggerMetrics extends BaggerTrackMetrics {
  counterpart_races: number;
  opponent_points_for: number;
  opponent_points_against: number;
  opponent_point_differential: number;
}

export type PlayerRoleMetrics = RunnerMetrics | BaggerMetrics;
export type PlayerTrackMetrics = RunnerMetrics | BaggerTrackMetrics;

export interface DashboardRanking {
  eligible: boolean;
  rank?: number;
  population: number;
  minimum_races: number;
  metric?: string;
  value?: number;
}

export interface DashboardRecord {
  wins: number;
  losses: number;
  ties: number;
  unknown: number;
}

export interface PlayerAppearance {
  season: string;
  division: string;
  team_id: number;
  team_name: string;
  team_tag: string;
  first_seen_match_id: number | null;
  last_seen_match_id: number | null;
}

export type PlayerOverviewMetrics = PlayerRoleMetrics & {
  matches: number;
  seasons: number;
  teams: number;
  best_match_score: number | null;
  best_gp_score: number | null;
};

export interface PlayerOverview {
  identity: {
    player_id: number;
    name: string;
    canonical_name: string | null;
    primary_friend_code: string | null;
    friend_codes: string[];
    aliases: Record<string, string[]>;
    flag: string | null;
    current_team: {
      team_id: number;
      name: string;
      tag: string;
      season: string;
      division: string;
      logo_url: string;
    } | null;
    appearances: PlayerAppearance[];
  };
  role: PlayerRoleMode;
  scope: {
    season: string | null;
    division: string | null;
    team_id: number | null;
    match_set: MatchSet;
  };
  metrics: PlayerOverviewMetrics;
  role_coverage: RoleCoverage;
  record: DashboardRecord;
  ranking: DashboardRanking | null;
  recent_matches: PlayerRecentMatch[];
  score_trend: Array<{
    match_id: number;
    label: string;
    score: number | null;
    role_races: number;
    scored_role_races: number;
    excluded_score_rows: number;
  }>;
}

export interface DashboardOpponent {
  team_id: number;
  name: string;
  tag: string;
  score: number;
}

export interface PlayerRecentMatch {
  match_id: number;
  label: string;
  season: string;
  season_number: number | null;
  division: string;
  week: number | null;
  team: DashboardOpponent;
  opponents: DashboardOpponent[];
  result: "win" | "loss" | "tie" | "unknown";
  player_score: number | null;
  role_races: number;
  scored_role_races: number;
  excluded_score_rows: number;
}

export interface TeamAppearance {
  season: string;
  division: string;
  name: string;
  tag: string;
  hex_color: string | null;
  logo_url: string;
}

export interface TeamRecentMatch {
  match_id: number;
  label: string;
  season: string;
  season_number: number | null;
  division: string;
  week: number | null;
  races: number;
  score: number;
  opponent_score: number | null;
  differential: number | null;
  penalties: number;
  result: "win" | "loss" | "tie" | "unknown";
  opponents: DashboardOpponent[];
}

export interface TeamOverview {
  identity: {
    team_id: number;
    name: string;
    tag: string;
    display_name: string;
    logo_url: string;
    current_entry: {
      season: string;
      division: string;
      name: string;
      tag: string;
      hex_color: string | null;
    } | null;
    appearances: TeamAppearance[];
  };
  scope: {
    season: string | null;
    division: string | null;
    opponent_team_id: number | null;
    match_set: MatchSet;
  };
  metrics: {
    matches: number;
    races: number;
    average_final_score: number | null;
    average_differential: number | null;
    total_penalties: number;
    penalties_per_match: number | null;
    win_rate: number | null;
    best_win: number | null;
    closest_match: number | null;
    largest_loss: number | null;
  };
  record: DashboardRecord;
  ranking: DashboardRanking | null;
  recent_matches: TeamRecentMatch[];
  score_trend: Array<{ match_id: number; label: string; differential: number | null }>;
}

export interface DashboardQuery extends Record<string, string | number | undefined> {
  season?: string;
  division?: string;
  team_id?: number;
  opponent_team_id?: number;
  min_races?: number;
  role?: PlayerRoleMode;
  match_set?: MatchSet;
}

export interface PlayerPerformance {
  player_id: number;
  role: PlayerRoleMode;
  scope: {
    season: string | null;
    division: string | null;
    team_id: number | null;
    match_set: MatchSet;
  };
  metrics: PlayerRoleMetrics;
  role_coverage: RoleCoverage;
  score_distribution: Array<{ score: number; races: number }>;
  placement_distribution: Array<{ position: number; races: number }>;
  by_race_number: Array<{ race_number: number; average: number; races: number }>;
  by_gp_number: Array<{ gp_number: number; average: number; races: number }>;
}

export type PlayerTrackRow = PlayerTrackMetrics & {
  track_id: number;
  name: string;
};

export interface PlayerTracks {
  player_id: number;
  role: PlayerRoleMode;
  scope: {
    season: string | null;
    division: string | null;
    team_id: number | null;
    match_set: MatchSet;
  };
  minimum_races: number;
  role_coverage: RoleCoverage;
  tracks: PlayerTrackRow[];
}

export interface TeamRosterPlayer {
  player_id: number;
  name: string;
  friend_codes: string[];
  matches: number;
  metrics: PlayerRoleMetrics;
  role_coverage: RoleCoverage;
  first_appearance: { match_id: number; season: string; division: string; week: number | null };
  last_appearance: { match_id: number; season: string; division: string; week: number | null };
}

export interface TeamRoster {
  team_id: number;
  role: PlayerRoleMode;
  scope: {
    season: string | null;
    division: string | null;
    opponent_team_id: number | null;
    match_set: MatchSet;
  };
  minimum_races: number;
  role_coverage: RoleCoverage;
  players: TeamRosterPlayer[];
}

export interface TeamTrackRow {
  track_id: number;
  name: string;
  races: number;
  average_score: number;
  wins: number;
  ties: number;
  win_rate: number;
}

export interface TeamTracks {
  team_id: number;
  scope: {
    season: string | null;
    division: string | null;
    opponent_team_id: number | null;
    match_set: MatchSet;
  };
  minimum_races: number;
  tracks: TeamTrackRow[];
}

export interface LegacyPlayerTracksResponse {
  player: string;
  role: PlayerRoleMode;
  results: PlayerTrackRow[];
}

export interface LegacyPlayerAverageResponse {
  role: PlayerRoleMode;
  player_id: number;
  player_name: string;
  team_name: string | null;
  metrics: PlayerRoleMetrics;
}

export type LegacyTeamRosterPlayer = TeamRosterPlayer & {
  role: PlayerRoleMode;
};

export interface LegacyTrackPlayerRow {
  player_id: number;
  name: string | null;
  role: PlayerRoleMode;
  races: number;
  scored_races: number;
  points_per_race: number | null;
  twelve_race_pace: number | null;
  bag_point_rate: number | null;
  zero_point_rate: number | null;
  average_placement: number | null;
  total_points: number;
  excluded_score_rows: number;
  role_coverage?: RoleCoverage;
}

export interface LegacyTeamTrackRow {
  track: string;
  average: number;
  races: number;
}

export interface LegacyTrackTeamRow {
  name: string;
  average: number;
  races: number;
}

export function fetchPlayerOverview(
  playerId: number,
  query: DashboardQuery
): Promise<PlayerOverview> {
  return fetchCachedJson(`/api/players/${playerId}/overview`, query);
}

export function fetchTeamOverview(teamId: number, query: DashboardQuery): Promise<TeamOverview> {
  return fetchCachedJson(`/api/teams/${teamId}/overview`, query);
}

export function fetchPlayerPerformance(
  playerId: number,
  query: DashboardQuery
): Promise<PlayerPerformance> {
  return fetchCachedJson(`/api/players/${playerId}/performance`, query);
}

export function fetchPlayerTracks(playerId: number, query: DashboardQuery): Promise<PlayerTracks> {
  return fetchCachedJson(`/api/players/${playerId}/tracks`, query);
}

export function fetchTeamRoster(teamId: number, query: DashboardQuery): Promise<TeamRoster> {
  return fetchCachedJson(`/api/teams/${teamId}/roster`, query);
}

export function fetchTeamTracks(teamId: number, query: DashboardQuery): Promise<TeamTracks> {
  return fetchCachedJson(`/api/teams/${teamId}/tracks`, query);
}

const MATCH_SETS: MatchSet[] = ["regular", "playoffs", "all"];

export function prefetchPlayerDashboardMatchSets(playerId: number, query: DashboardQuery): void {
  for (const matchSet of MATCH_SETS) {
    if (matchSet === query.match_set) continue;
    const scopedQuery = { ...query, match_set: matchSet };
    void Promise.allSettled([
      fetchPlayerOverview(playerId, scopedQuery),
      fetchPlayerPerformance(playerId, scopedQuery),
      fetchPlayerTracks(playerId, scopedQuery),
    ]);
  }
}

export function prefetchTeamDashboardMatchSets(teamId: number, query: DashboardQuery): void {
  for (const matchSet of MATCH_SETS) {
    if (matchSet === query.match_set) continue;
    const scopedQuery = { ...query, match_set: matchSet };
    void Promise.allSettled([
      fetchTeamOverview(teamId, scopedQuery),
      fetchTeamRoster(teamId, scopedQuery),
      fetchTeamTracks(teamId, scopedQuery),
    ]);
  }
}

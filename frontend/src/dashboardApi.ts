import { fetchJson } from "./api";

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

export interface PlayerOverview {
  identity: {
    player_id: number;
    name: string;
    canonical_lounge_name: string | null;
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
  scope: { season: string | null; division: string | null; team_id: number | null };
  metrics: {
    races: number;
    matches: number;
    seasons: number;
    teams: number;
    total_points: number;
    points_per_race: number | null;
    twelve_race_pace: number | null;
    best_match_score: number | null;
    best_gp_score: number | null;
    race_wins: number;
    podiums: number;
    top_three_rate: number | null;
    excluded_score_rows: number;
  };
  record: DashboardRecord;
  ranking: DashboardRanking | null;
  recent_matches: PlayerRecentMatch[];
  score_trend: Array<{ match_id: number; label: string; score: number; races: number }>;
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
  player_score: number;
  races: number;
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
  scope: { season: string | null; division: string | null; opponent_team_id: number | null };
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
}

export interface PlayerPerformance {
  player_id: number;
  runner_metrics: {
    races: number;
    scored_races: number;
    points_per_race: number | null;
    twelve_race_pace: number | null;
    average_placement: number | null;
    wins: number;
    podiums: number;
    podium_rate: number | null;
    excluded_score_rows: number;
  };
  role_coverage: {
    explicit_runner: number;
    inferred_runner: number;
    explicit_bagger: number;
    inferred_bagger: number;
    unknown: number;
    total: number;
    known_rate: number | null;
  };
  score_distribution: Array<{ score: number; races: number }>;
  placement_distribution: Array<{ position: number; races: number }>;
  by_race_number: Array<{ race_number: number; average: number; races: number }>;
  by_gp_number: Array<{ gp_number: number; average: number; races: number }>;
}

export interface PlayerTrackRow {
  track_id: number;
  name: string;
  races: number;
  average: number;
  runner_races: number;
  runner_average: number | null;
  wins: number;
  podiums: number;
  top_three_rate: number | null;
}

export interface PlayerTracks {
  player_id: number;
  minimum_races: number;
  tracks: PlayerTrackRow[];
}

export interface TeamRosterPlayer {
  player_id: number;
  name: string;
  friend_codes: string[];
  matches: number;
  races: number;
  points_per_race: number;
  twelve_race_pace: number;
  runner_races: number;
  runner_average: number | null;
  first_appearance: { match_id: number; season: string; division: string; week: number | null };
  last_appearance: { match_id: number; season: string; division: string; week: number | null };
}

export interface TeamRoster {
  team_id: number;
  minimum_races: number;
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
  minimum_races: number;
  tracks: TeamTrackRow[];
}

export function fetchPlayerOverview(playerId: number, query: DashboardQuery): Promise<PlayerOverview> {
  return fetchJson(`/api/players/${playerId}/overview`, query);
}

export function fetchTeamOverview(teamId: number, query: DashboardQuery): Promise<TeamOverview> {
  return fetchJson(`/api/teams/${teamId}/overview`, query);
}

export function fetchPlayerPerformance(playerId: number, query: DashboardQuery): Promise<PlayerPerformance> {
  return fetchJson(`/api/players/${playerId}/performance`, query);
}

export function fetchPlayerTracks(playerId: number, query: DashboardQuery): Promise<PlayerTracks> {
  return fetchJson(`/api/players/${playerId}/tracks`, query);
}

export function fetchTeamRoster(teamId: number, query: DashboardQuery): Promise<TeamRoster> {
  return fetchJson(`/api/teams/${teamId}/roster`, query);
}

export function fetchTeamTracks(teamId: number, query: DashboardQuery): Promise<TeamTracks> {
  return fetchJson(`/api/teams/${teamId}/tracks`, query);
}

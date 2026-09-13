import { fetchJson } from "./api";

export interface TeamTrackPerformance {
  team_id: number;
  team_name: string;
  team_tag: string;
  track_id: number;
  track_name: string;
  races: number;
  average_score: number;
  average_margin: number;
  win_rate: number;
  baseline_margin: number;
  lift: number;
  sample_status: "early" | "established";
}

export interface TrackAnalyticsRow {
  track_id: number;
  track_name: string;
  appearances: number;
  unique_teams: number;
  average_race_number: number;
  average_margin: number;
  median_margin: number;
  margin_variation: number;
  even_race_rate: number;
  blowout_rate: number;
  timing_counts: number[];
  selected_team?: TeamTrackPerformance;
}

interface Scope {
  league: string;
  season: string;
  division: string;
  team_id: number | null;
  team_name?: string | null;
}

export interface TrackAnalyticsResponse {
  scope: Scope;
  definitions: {
    even_margin: number;
    blowout_margin: number;
    standout_min_races: number;
    minimum_plays: number;
    match_set: "regular";
  };
  summary: {
    races: number;
    tracks: number;
    teams: number;
    most_played: TrackAnalyticsRow | null;
    widest_average: TrackAnalyticsRow | null;
    closest_average: TrackAnalyticsRow | null;
  };
  tracks: TrackAnalyticsRow[];
  standouts: { strengths: TeamTrackPerformance[]; struggles: TeamTrackPerformance[] };
}

export interface TrackRace {
  race_id: number;
  race_number: number;
  match_id: number;
  season: string;
  division: string;
  match_number: number | null;
  match_label: string;
  margin: number;
  teams: Array<{
    team_id: number;
    team_name: string;
    team_tag: string;
    score: number;
    differential: number;
  }>;
}

export interface TrackDashboardResponse {
  scope: Scope;
  track: { track_id: number; track_name: string; aliases: string[] };
  definitions: {
    even_margin: number;
    blowout_margin: number;
    minimum_plays: number;
    match_set: "regular";
  };
  metrics: TrackAnalyticsRow;
  margin_buckets: Array<{ label: string; count: number }>;
  teams: TeamTrackPerformance[];
  recent_races: TrackRace[];
}

export interface TrackAnalyticsQuery {
  league: string;
  season: string;
  division: string;
  team_id?: number;
  min_races?: number;
}

export function fetchTrackAnalytics(query: TrackAnalyticsQuery) {
  return fetchJson<TrackAnalyticsResponse>("/api/track-analytics", { ...query });
}

export function fetchTrackDashboard(trackId: number, query: TrackAnalyticsQuery) {
  return fetchJson<TrackDashboardResponse>(`/api/tracks/${trackId}/analytics`, { ...query });
}

import { getAdminAuthHeaders } from "./authClient";

export const API_URL = import.meta.env.VITE_API_URL || window.location.origin;

export interface SeasonOption {
  season: string;
  season_number: number | null;
  name: string;
  status: string;
}

export interface DivisionOption {
  division: string;
  name: string;
}

type QueryValue = string | number | undefined;

interface RequestOptions extends RequestInit {
  params?: Record<string, QueryValue>;
}

function apiUrl(path: string, params?: Record<string, QueryValue>): URL {
  const url = new URL(path, API_URL);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { params, ...requestOptions } = options;
  const authHeaders = await getAdminAuthHeaders();
  const response = await fetch(apiUrl(path, params), {
    ...requestOptions,
    headers: {
      ...authHeaders,
      ...Object.fromEntries(new Headers(requestOptions.headers).entries()),
    },
  });
  if (response.ok) {
    return response.json() as Promise<T>;
  }

  let message = response.statusText || "Request failed";
  try {
    const body = (await response.json()) as { error?: string };
    message = body.error ?? message;
  } catch {
    // The status text is the best available error for a non-JSON response.
  }
  throw new Error(message);
}

export async function fetchJson<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
  return requestJson<T>(path, { cache: "no-store", params });
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteJson<T>(path: string): Promise<T> {
  return requestJson<T>(path, { method: "DELETE" });
}

export function fetchSeasons(): Promise<SeasonOption[]> {
  return fetchJson<SeasonOption[]>("/api/seasons");
}

export function fetchDivisions(season: string): Promise<DivisionOption[]> {
  return fetchJson<DivisionOption[]>("/api/divisions", { season });
}

export function formatDivisionName(division: DivisionOption): string {
  return division.name || `Division ${division.division.replace(/^d/, "").replace("_", "-")}`;
}

export interface PlayerIdentity {
  player_id: number;
  canonical_name: string | null;
  primary_friend_code: string | null;
  friend_codes: string[];
  aliases: Array<{ type: string; value: string }>;
}

export function fetchPlayerIdentity(
  friendCode: string
): Promise<{ reason: string; results: PlayerIdentity[] }> {
  return fetchJson("/api/player-identities", { friend_code: friendCode });
}

export function searchPlayerIdentities(
  query: string
): Promise<{ reason: string; results: PlayerIdentity[] }> {
  return fetchJson("/api/player-identities", { query });
}

export interface PlayerDirectoryEntry {
  player_id: number;
  name: string;
  primary_friend_code: string | null;
  teams: Array<{ team_id: number; tag: string }>;
}

export function fetchPlayerDirectory(
  season: string,
  division: string
): Promise<PlayerDirectoryEntry[]> {
  return fetchJson("/api/player-directory", { season, division });
}

export function searchTracks(query = ""): Promise<Array<{ track_id: number; name: string }>> {
  return fetchJson("/api/track-search", { query });
}

export interface MatchScope {
  league: string;
  season: string;
  season_name: string;
  division: string;
  division_name: string;
}

export function fetchMatchScopes(): Promise<MatchScope[]> {
  return fetchJson("/api/match-scopes");
}

export interface TeamScope {
  league: string;
  season: string;
  division: string;
  team_id: number;
  canonical_name: string;
  canonical_tag: string;
  display_name: string;
  clan_tag: string;
}

export function fetchTeamScopes(): Promise<TeamScope[]> {
  return fetchJson("/api/team-scopes");
}

export interface TeamRosterPlayer {
  player_id: number;
  player_season_entry_id: number;
  canonical_name: string | null;
  friend_code: string | null;
  friend_codes: string[];
  lounge_name: string | null;
  mii_name: string | null;
  flag: string | null;
}

export function fetchTeamRosterPool(params: {
  league: string;
  season: string;
  division: string;
  team_id: number;
}): Promise<TeamRosterPlayer[]> {
  return fetchJson("/api/team-roster-pool", params);
}

export interface PlayerTeamMembership {
  player_id: number;
  teams: Array<{
    team_id: number;
    canonical_name: string;
    canonical_tag: string;
    display_name: string;
    clan_tag: string;
  }>;
}

export function fetchPlayerTeamMemberships(params: {
  league: string;
  season: string;
  division: string;
  player_ids: number[];
}): Promise<PlayerTeamMembership[]> {
  return fetchJson("/api/player-team-memberships", {
    league: params.league,
    season: params.season,
    division: params.division,
    player_ids: params.player_ids.join(","),
  });
}

export interface DatabaseAddition {
  id: number;
  match_id: number | null;
  entity_type: string;
  entity_id: number;
  summary: string;
  details: Record<string, unknown>;
  created_at: string | null;
}

export function fetchDatabaseAdditions(limit = 100): Promise<DatabaseAddition[]> {
  return fetchJson("/api/database-additions", { limit });
}

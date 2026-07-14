export const API_URL =
  import.meta.env.VITE_API_URL || "https://ctcmkwiistatswebsite.onrender.com";

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

export async function fetchJson<T>(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(path, API_URL);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    let message = "Request failed";
    try {
      const body = await response.json();
      message = body.error ?? message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(new URL(path, API_URL).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = "Request failed";
    try {
      const responseBody = await response.json();
      message = responseBody.error ?? message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
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
  canonical_lounge_name: string | null;
  primary_friend_code: string | null;
  friend_codes: string[];
  aliases: Array<{ type: string; value: string }>;
}

export function fetchPlayerIdentity(friendCode: string): Promise<{ reason: string; results: PlayerIdentity[] }> {
  return fetchJson("/api/player-identities", { friend_code: friendCode });
}

export function searchPlayerIdentities(query: string): Promise<{ reason: string; results: PlayerIdentity[] }> {
  return fetchJson("/api/player-identities", { query });
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

export function databaseAdditionStreamUrl(afterId = 0): string {
  const url = new URL("/api/database-additions/stream", API_URL);
  if (afterId > 0) url.searchParams.set("after_id", String(afterId));
  return url.toString();
}

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

  const response = await fetch(url.toString());
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

export function fetchSeasons(): Promise<SeasonOption[]> {
  return fetchJson<SeasonOption[]>("/api/seasons");
}

export function fetchDivisions(season: string): Promise<DivisionOption[]> {
  return fetchJson<DivisionOption[]>("/api/divisions", { season });
}

export function formatDivisionName(division: DivisionOption): string {
  return division.name || `Division ${division.division.replace(/^d/, "").replace("_", "-")}`;
}

export const MATCH_SETS = ["regular", "playoffs", "all"] as const;

export type MatchSet = (typeof MATCH_SETS)[number];

export function parseMatchSet(value: string | null): MatchSet {
  return value === "playoffs" || value === "all" ? value : "regular";
}

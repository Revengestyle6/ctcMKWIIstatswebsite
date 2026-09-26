import type { MatchSet } from "../../config/matchSets";

export type MatchHistoryLinkOptions = {
  season: string;
  division: string;
  matchId: number;
  matchSet?: MatchSet;
};

export function matchHistoryPath({
  season,
  division,
  matchId,
  matchSet = "regular",
}: MatchHistoryLinkOptions): string {
  const params = new URLSearchParams({
    season,
    division,
    match: String(matchId),
  });
  if (matchSet !== "regular") params.set("match_set", matchSet);
  return `/matches?${params.toString()}`;
}

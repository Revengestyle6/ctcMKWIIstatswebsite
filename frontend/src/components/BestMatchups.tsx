import React, { useEffect, useMemo, useState } from "react";
import { fetchJson } from "../api";
import { LegacyStatHeader } from "./LegacyStatHeader";
import SeasonDivisionSelector from "./SeasonDivisionSelector";
import { useSeasonDivision } from "../hooks/useSeasonDivision";

type TrackStat = {
  track: string;
  avg: number;
  races: number;
  text?: string;
};

const TRACK_STAT_PATTERN = /^(.*?)\s*-\s*([\d.]+)\s*pts\s*\((\d+)\s*races?\)/i;

function parseTrackString(entry: string): TrackStat | null {
  const match = entry.match(TRACK_STAT_PATTERN);
  if (!match) return null;
  const avg = Number.parseFloat(match[2]);
  const races = Number.parseInt(match[3], 10);
  if (!Number.isFinite(avg) || !Number.isFinite(races)) return null;
  return { track: match[1].trim(), avg, races, text: entry };
}

function normalizeTracks(raw: unknown): TrackStat[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return parseTrackString(item);
      if (item && typeof item === "object") {
        const maybe = item as {
          track?: unknown;
          avg?: unknown;
          average?: unknown;
          races?: unknown;
          text?: unknown;
        };
        const avgValue = maybe.avg ?? maybe.average;
        if (typeof maybe.track === "string" && typeof avgValue === "number") {
          const racesNum = typeof maybe.races === "number" ? maybe.races : Number(maybe.races ?? 0);
          return {
            track: maybe.track,
            avg: avgValue,
            races: Number.isFinite(racesNum) ? racesNum : 0,
            text: typeof maybe.text === "string" ? maybe.text : undefined,
          };
        }
      }
      return null;
    })
    .filter((track): track is TrackStat => Boolean(track && track.track));
}

export default function BestMatchups(): React.JSX.Element {
  const {
    seasons,
    divisions,
    season,
    division,
    loadingScope,
    scopeError,
    setSeason,
    setDivision,
  } = useSeasonDivision();
  const [teams, setTeams] = useState<string[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [selectedTeam2, setSelectedTeam2] = useState<string>("");
  const [team1Tracks, setTeam1Tracks] = useState<TrackStat[]>([]);
  const [team2Tracks, setTeam2Tracks] = useState<TrackStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function loadTeams() {
      if (!season || !division) return;
      setTeams([]);
      setSelectedTeam("");
      setSelectedTeam2("");
      setTeam1Tracks([]);
      setTeam2Tracks([]);
      setError("");
      try {
        const data = await fetchJson<string[]>("/api/teams", { season, division });
        if (cancelled) return;
        const sortedData = [...data].sort((a, b) =>
          a.toLowerCase().localeCompare(b.toLowerCase())
        );
        setTeams(sortedData);
        setSelectedTeam(sortedData[0] ?? "");
        setSelectedTeam2(sortedData[1] ?? "");
      } catch (err) {
        if (cancelled) return;
        console.error("Error fetching teams:", err);
        setError("Failed to load teams.");
      }
    }

    loadTeams();
    return () => {
      cancelled = true;
    };
  }, [season, division]);

  useEffect(() => {
    let cancelled = false;

    async function fetchTeamTracks(team: string): Promise<TrackStat[]> {
      const raw = await fetchJson<unknown>("/api/top-team-tracks", {
        team,
        season,
        division,
      });
      return normalizeTracks(raw);
    }

    async function fetchBothTeams() {
      if ((!selectedTeam && !selectedTeam2) || !season || !division) return;
      setLoading(true);
      setError("");
      try {
        const [team1Data, team2Data] = await Promise.all([
          selectedTeam ? fetchTeamTracks(selectedTeam) : Promise.resolve([]),
          selectedTeam2 ? fetchTeamTracks(selectedTeam2) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setTeam1Tracks(team1Data);
        setTeam2Tracks(team2Data);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError("Failed to fetch team data.");
        setTeam1Tracks([]);
        setTeam2Tracks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchBothTeams();
    return () => {
      cancelled = true;
    };
  }, [selectedTeam, selectedTeam2, season, division]);

  const comparisonRows = useMemo(() => {
    if (!selectedTeam || !selectedTeam2) return [];
    const team1Map = new Map(team1Tracks.map((track) => [track.track.toLowerCase(), track]));
    return team2Tracks
      .map((track) => {
        const opponent = team1Map.get(track.track.toLowerCase());
        const diff = opponent ? opponent.avg - track.avg : null;
        return {
          track: track.track,
          teamAvg: track.avg,
          opponentAvg: opponent?.avg ?? null,
          races: track.races,
          diff,
        };
      })
      .filter((row) => row.diff !== null)
      .sort((a, b) => {
        const aScore = a.diff ?? -Infinity;
        const bScore = b.diff ?? -Infinity;
        return bScore - aScore;
      });
  }, [selectedTeam, selectedTeam2, team1Tracks, team2Tracks]);

  const combinedError = scopeError || error;

  function swapTeams() {
    setSelectedTeam(selectedTeam2);
    setSelectedTeam2(selectedTeam);
  }

  return (
    <div className="relative min-h-screen p-6 font-sans text-white">
      <LegacyStatHeader title="Team Matchups" />

      <div className="mx-auto max-w-5xl pt-24">
        {combinedError && <p className="text-red-400 mb-4 text-center">{combinedError}</p>}

        <div className="mb-6 rounded-xl border border-white/15 bg-black/45 p-5 shadow-lg backdrop-blur-sm">
          <p className="mb-4 text-sm text-gray-300">Choose two teams to compare their averages on tracks they have both played.</p>
          <div className="flex flex-col flex-wrap gap-4 md:flex-row md:items-end">
            <SeasonDivisionSelector
              season={season}
              division={division}
              seasons={seasons}
              divisions={divisions}
              disabled={loadingScope}
              onSeasonChange={setSeason}
              onDivisionChange={setDivision}
            />

            <div>
              <label htmlFor="matchup-team-one" className="mb-1 block font-semibold">Team 1</label>
              <select
                id="matchup-team-one"
                className="min-w-40 rounded-md border border-gray-400 bg-white px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={selectedTeam}
                onChange={(event) => setSelectedTeam(event.target.value)}
                disabled={!division || teams.length === 0}
              >
                <option value="">Select a team</option>
                {teams.map((team) => (
                  <option key={team} value={team} disabled={team === selectedTeam2}>
                    {team}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="matchup-team-two" className="mb-1 block font-semibold">Team 2</label>
              <select
                id="matchup-team-two"
                className="min-w-40 rounded-md border border-gray-400 bg-white px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={selectedTeam2}
                onChange={(event) => setSelectedTeam2(event.target.value)}
                disabled={!division || teams.length === 0}
              >
                <option value="">Select a team</option>
                {teams.map((team) => (
                  <option key={team} value={team} disabled={team === selectedTeam}>
                    {team}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={swapTeams}
              disabled={!selectedTeam || !selectedTeam2}
              className="rounded-md border border-blue-300/50 bg-blue-950/60 px-4 py-2 font-semibold text-blue-100 transition hover:bg-blue-900/70 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Swap teams
            </button>
          </div>
        </div>

        {loading && (
          <div className="text-center">
            <div className="inline-block">
              <div className="animate-spin h-8 w-8 border-4 border-blue-400 border-t-transparent rounded-full"></div>
              <p className="mt-2 text-gray-300">Loading team data...</p>
            </div>
          </div>
        )}

        {!loading && selectedTeam && selectedTeam2 && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-4 text-center">
              Best tracks for {selectedTeam} vs {selectedTeam2}
            </h2>
            {comparisonRows.length === 0 ? (
              <p className="text-center text-gray-300">
                No overlapping track data for these teams.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/10 shadow-lg">
                <table className="min-w-full bg-black/70 text-sm tabular-nums backdrop-blur-sm">
                  <thead className="bg-black/90">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold text-white">#</th>
                      <th className="text-left px-4 py-2 font-semibold text-white">Track</th>
                      <th className="px-4 py-3 text-right font-semibold text-white">
                        {selectedTeam}
                      </th>
                      <th className="px-4 py-3 text-right font-semibold text-white">
                        {selectedTeam2}
                      </th>
                      <th className="px-4 py-3 text-right font-semibold text-white">
                        Difference
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map((row, index) => (
                      <tr
                        key={`${row.track}-${index}`}
                        className={`${index % 2 === 0 ? "bg-black/50" : "bg-black/70"} transition-colors hover:bg-blue-950/40`}
                      >
                        <td className="px-4 py-2 font-semibold text-blue-400">
                          {index + 1}
                        </td>
                        <td className="px-4 py-2 text-white">{row.track}</td>
                        <td className="px-4 py-3 text-right text-white">
                          {row.opponentAvg === null
                            ? "-"
                            : `${row.opponentAvg.toFixed(1)} pts`}
                        </td>
                        <td className="px-4 py-3 text-right text-white">
                          {row.teamAvg.toFixed(1)} pts
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${
                            row.diff !== null && row.diff >= 0
                              ? "text-green-300"
                              : "text-red-300"
                          }`}
                        >
                          {row.diff === null ? "-" : row.diff.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {!loading && (!selectedTeam || !selectedTeam2) && (
          <p className="text-center text-gray-400">
            Select two teams to compare their best tracks.
          </p>
        )}
      </div>
    </div>
  );
}

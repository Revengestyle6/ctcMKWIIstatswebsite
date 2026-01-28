import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

type TrackStat = {
  track: string;
  avg: number;
  races: number;
  text?: string;
};

const divisions = ["1_2", "3", "4"];

export default function BestMatchups(): React.JSX.Element {
  const [teams, setTeams] = useState<string[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [selectedTeam2, setSelectedTeam2] = useState<string>("");
  const [team1Tracks, setTeam1Tracks] = useState<TrackStat[]>([]);
  const [team2Tracks, setTeam2Tracks] = useState<TrackStat[]>([]);
  const [division, setDivision] = useState<string>("1_2");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const parseTrackString = (entry: string): TrackStat | null => {
    const match = entry.match(
      /^(.*?)\s*-\s*([\d.]+)\s*pts\s*\((\d+)\s*races?\)/i
    );
    if (!match) return null;
    const avg = Number.parseFloat(match[2]);
    const races = Number.parseInt(match[3], 10);
    if (!Number.isFinite(avg) || !Number.isFinite(races)) return null;
    return { track: match[1].trim(), avg, races, text: entry };
  };

  const normalizeTracks = useCallback((raw: unknown): TrackStat[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (typeof item === "string") return parseTrackString(item);
        if (item && typeof item === "object") {
          const maybe = item as {
            track?: unknown;
            avg?: unknown;
            races?: unknown;
            text?: unknown;
          };
          if (typeof maybe.track === "string" && typeof maybe.avg === "number") {
            const racesNum =
              typeof maybe.races === "number"
                ? maybe.races
                : Number(maybe.races ?? 0);
            return {
              track: maybe.track,
              avg: maybe.avg,
              races: Number.isFinite(racesNum) ? racesNum : 0,
              text: typeof maybe.text === "string" ? maybe.text : undefined,
            };
          }
        }
        return null;
      })
      .filter((t): t is TrackStat => Boolean(t && t.track));
  }, []);

  useEffect(() => {
    async function fetchTeams() {
      try {
        const res = await fetch(`${API_URL}/api/teams?division=${division}`);
        if (!res.ok) throw new Error("Failed to fetch teams");
        const data: string[] = await res.json();
        setTeams(data);
        if (data.length > 0) setSelectedTeam(data[0]);
        setError("");
      } catch (err) {
        console.error("Error fetching teams:", err);
        setError("Failed to load teams.");
        setTeams([]);
      }
    }
    fetchTeams();
  }, [division]);

  useEffect(() => {
    async function fetchTeamTracks(team: string): Promise<TrackStat[]> {
      const tracksRes = await fetch(
        `${API_URL}/api/top-team-tracks?team=${encodeURIComponent(team)}&division=${division}`
      );
      if (!tracksRes.ok) throw new Error("Failed to fetch top tracks");
      const raw = await tracksRes.json();
      return normalizeTracks(raw);
    }

    async function fetchBothTeams() {
      if (!selectedTeam && !selectedTeam2) return;
      setLoading(true);
      setError("");
      try {
        if (selectedTeam) {
          setTeam1Tracks(await fetchTeamTracks(selectedTeam));
        } else {
          setTeam1Tracks([]);
        }
        if (selectedTeam2) {
          setTeam2Tracks(await fetchTeamTracks(selectedTeam2));
        } else {
          setTeam2Tracks([]);
        }
      } catch (err) {
        console.error(err);
        setError("Failed to fetch team data.");
      } finally {
        setLoading(false);
      }
    }

    fetchBothTeams();
  }, [selectedTeam, selectedTeam2, division, normalizeTracks]);

  const comparisonRows = useMemo(() => {
    if (!selectedTeam || !selectedTeam2) return [];
    const team1Map = new Map(team1Tracks.map((t) => [t.track.toLowerCase(), t]));
    return team2Tracks
      .map((t) => {
        const opponent = team1Map.get(t.track.toLowerCase());
        const diff = opponent ? opponent.avg - t.avg : null;
        return {
          track: t.track,
          teamAvg: t.avg, // Team 2
          opponentAvg: opponent?.avg ?? null, // Team 1
          races: t.races,
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

  return (
    <div className="relative min-h-screen text-white font-sans p-6">
      <div className="fixed top-0 left-0 right-0 bg-black/40 backdrop-blur-sm p-4 z-50">
        <div className="flex justify-between items-center max-w-7xl mx-auto px-2">
          <Link
            to="/"
            className="text-blue-400 hover:text-blue-300 font-semibold"
          >
            ← Back to Home
          </Link>
          <img
            src="/images/CTC_LOGO/ctclogo.png"
            alt="Logo"
            className="w-12 h-12 rounded-lg"
          />
        </div>
      </div>

      <div className="pt-16">
        <h1 className="text-3xl font-bold mb-6 text-center">
          Team Matchups
        </h1>

        {error && <p className="text-red-400 mb-4 text-center">{error}</p>}

        <div className="flex flex-col md:flex-row md:items-end gap-4 mb-6 flex-wrap justify-center">
          <div>
            <label className="block font-semibold mb-1">Division</label>
            <select
              className="px-4 py-2 rounded-md border border-gray-400 bg-black/70 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={division}
              onChange={(e) => setDivision(e.target.value)}
            >
              {divisions.map((div) => (
                <option key={div} value={div} className="text-black">
                  Division {div.replace("_", "–")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-1">Team 1</label>
            <select
              className="px-4 py-2 rounded-md border border-gray-400 bg-black/70 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
            >
              <option value="">Select a team</option>
              {teams.map((team) => (
                <option key={team} value={team} className="text-black">
                  {team}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-1">Team 2</label>
            <select
              className="px-4 py-2 rounded-md border border-gray-400 bg-black/70 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedTeam2}
              onChange={(e) => setSelectedTeam2(e.target.value)}
            >
              <option value="">Select a team</option>
              {teams.map((team) => (
                <option key={team} value={team} className="text-black">
                  {team}
                </option>
              ))}
            </select>
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
              <div className="overflow-x-auto">
                <table className="min-w-full bg-black/70 backdrop-blur-sm shadow-md rounded-xl overflow-hidden">
                  <thead className="bg-black/90">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold text-white">
                        #
                      </th>
                      <th className="text-left px-4 py-2 font-semibold text-white">
                        Track
                      </th>
                      <th className="text-left px-4 py-2 font-semibold text-white">
                        {selectedTeam}
                      </th>
                      <th className="text-left px-4 py-2 font-semibold text-white">
                        {selectedTeam2}
                      </th>
                      <th className="text-left px-4 py-2 font-semibold text-white">
                        Diff ({selectedTeam} - {selectedTeam2})
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map((row, idx) => (
                      <tr
                        key={`${row.track}-${idx}`}
                        className={
                          idx % 2 === 0 ? "bg-black/50" : "bg-black/70"
                        }
                      >
                        <td className="px-4 py-2 font-semibold text-blue-400">
                          {idx + 1}
                        </td>
                        <td className="px-4 py-2 text-white">{row.track}</td>
                        <td className="px-4 py-2 text-white">
                          {row.opponentAvg === null
                            ? "—"
                            : `${row.opponentAvg.toFixed(1)} pts`}
                        </td>
                        <td className="px-4 py-2 text-white">
                          {row.teamAvg.toFixed(1)} pts
                        </td>
                        <td
                          className={`px-4 py-2 font-semibold ${
                            row.diff !== null && row.diff >= 0
                              ? "text-green-300"
                              : "text-red-300"
                          }`}
                        >
                          {row.diff === null ? "—" : row.diff.toFixed(1)}
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
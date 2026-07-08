import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import React from "react";
import { fetchJson } from "../api";
import SeasonDivisionSelector from "./SeasonDivisionSelector";
import { useSeasonDivision } from "../hooks/useSeasonDivision";

export default function TopTracks(): React.JSX.Element {
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
  const [tracks, setTracks] = useState<string[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<string>("");
  const [topPlayers, setTopPlayers] = useState<string[]>([]);
  const [topTeams, setTopTeams] = useState<string[]>([]);
  const [minRaces, setMinRaces] = useState<number>(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function loadTracks() {
      if (!season || !division) return;
      setTracks([]);
      setSelectedTrack("");
      setTopPlayers([]);
      setTopTeams([]);
      setError("");
      try {
        const data = await fetchJson<string[]>("/api/tracks", { season, division });
        if (cancelled) return;
        setTracks(data);
        setSelectedTrack(data[0] ?? "");
      } catch (err) {
        if (cancelled) return;
        console.error("Error fetching tracks:", err);
        setError("Failed to load tracks.");
      }
    }

    loadTracks();
    return () => {
      cancelled = true;
    };
  }, [season, division]);

  useEffect(() => {
    let cancelled = false;

    async function fetchTrackData() {
      if (!selectedTrack || !season || !division) return;
      setLoading(true);
      setError("");
      try {
        const playersData = await fetchJson<string[]>("/api/top-tracks", {
          track: selectedTrack,
          min_races: minRaces,
          season,
          division,
        });
        const teamsData = await fetchJson<string[]>("/api/top-teams-on-track", {
          track: selectedTrack,
          min_races: minRaces,
          season,
          division,
        });
        if (cancelled) return;
        setTopPlayers(playersData);
        setTopTeams(teamsData);
      } catch (err) {
        if (cancelled) return;
        console.error("Error fetching track data:", err);
        setError("Failed to fetch data for this track.");
        setTopPlayers([]);
        setTopTeams([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTrackData();
    return () => {
      cancelled = true;
    };
  }, [selectedTrack, season, division, minRaces]);

  const combinedError = scopeError || error;

  return (
    <div className="relative min-h-screen text-white font-sans p-6">
      <div className="fixed top-0 left-0 right-0 bg-black/40 backdrop-blur-sm p-4 z-50">
        <div className="flex justify-between items-center max-w-7xl mx-auto px-2">
          <Link to="/" className="text-blue-400 hover:text-blue-300 font-semibold">
            &lt; Back
          </Link>
          <h1 className="text-3xl font-bold text-center flex-1">Best Track Averages</h1>
          <div className="w-32"></div>
          <img
            src="/images/CTC_LOGO/ctclogo.webp"
            alt="Logo"
            className="w-12 h-12 rounded-lg"
            loading="lazy"
          />
        </div>
      </div>

      <div className="pt-24 max-w-4xl mx-auto">
        <div className="mb-8 space-y-4 bg-black/30 p-6 rounded-lg border border-white/20">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <SeasonDivisionSelector
              season={season}
              division={division}
              seasons={seasons}
              divisions={divisions}
              disabled={loadingScope}
              onSeasonChange={setSeason}
              onDivisionChange={setDivision}
              className="md:col-span-2"
            />

            <div>
              <label className="block text-sm font-semibold mb-2">Track</label>
              <select
                value={selectedTrack}
                onChange={(event) => setSelectedTrack(event.target.value)}
                disabled={!division || tracks.length === 0}
                className="w-full p-2 bg-white text-black border border-gray-600 rounded hover:border-gray-400 focus:outline-none focus:border-blue-400"
              >
                <option value="">Select a track</option>
                {tracks.map((track) => (
                  <option key={track} value={track}>
                    {track}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Min Races</label>
              <input
                type="number"
                min="1"
                value={minRaces}
                onChange={(event) => setMinRaces(Math.max(1, parseInt(event.target.value) || 1))}
                className="w-full p-2 bg-white text-black border border-gray-600 rounded hover:border-gray-400 focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>
        </div>

        {combinedError && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-600 rounded text-red-200">
            {combinedError}
          </div>
        )}

        {loading && <div className="text-center py-8 text-gray-300">Loading data...</div>}

        {!loading && (topPlayers.length > 0 || topTeams.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {topPlayers.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold mb-4 text-center">Top Players</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-black/70 backdrop-blur-sm shadow-md rounded-xl overflow-hidden">
                    <thead className="bg-black/90">
                      <tr>
                        <th className="text-left px-4 py-2 font-semibold text-white">#</th>
                        <th className="text-left px-4 py-2 font-semibold text-white">Player Stats</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topPlayers
                        .filter((player) => {
                          const scoreMatch = player.match(/(\d+(?:\.\d+)?)\s*pts/);
                          const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
                          return score >= 2;
                        })
                        .map((player, index) => (
                          <tr
                            key={index}
                            className={index % 2 === 0 ? "bg-black/50" : "bg-black/70"}
                          >
                            <td className="px-4 py-2 font-semibold text-blue-400">
                              {index + 1}
                            </td>
                            <td className="px-4 py-2 text-white">{player}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {topTeams.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold mb-4 text-center">Top Teams</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-black/70 backdrop-blur-sm shadow-md rounded-xl overflow-hidden">
                    <thead className="bg-black/90">
                      <tr>
                        <th className="text-left px-4 py-2 font-semibold text-white">#</th>
                        <th className="text-left px-4 py-2 font-semibold text-white">Team Stats</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topTeams
                        .filter((team) => {
                          const scoreMatch = team.match(/(\d+(?:\.\d+)?)\s*pts/);
                          const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
                          return score >= 2;
                        })
                        .map((team, index) => (
                          <tr
                            key={index}
                            className={index % 2 === 0 ? "bg-black/50" : "bg-black/70"}
                          >
                            <td className="px-4 py-2 font-semibold text-blue-400">
                              {index + 1}
                            </td>
                            <td className="px-4 py-2 text-white">{team}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

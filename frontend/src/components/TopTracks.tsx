import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import React from "react";

const API_URL = import.meta.env.VITE_API_URL || 'https://ctc-mkwii-api-production.up.railway.app';
const divisions = ["1_2", "3", "4"];

export default function TopTracks(): React.JSX.Element {
  const [tracks, setTracks] = useState<string[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<string>("");
  const [topPlayers, setTopPlayers] = useState<string[]>([]);
  const [topTeams, setTopTeams] = useState<string[]>([]);
  const [division, setDivision] = useState<string>("1_2");
  const [minRaces, setMinRaces] = useState<number>(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  // Fetch tracks when division changes
  useEffect(() => {
    async function fetchTracks() {
      try {
        const res = await fetch(`${API_URL}/api/tracks?division=${division}`);
        if (!res.ok) throw new Error("Failed to fetch tracks");
        const data: string[] = await res.json();
        setTracks(data);
        if (data.length > 0) setSelectedTrack(data[0]);
        setError("");
      } catch (err) {
        console.error("Error fetching tracks:", err);
        setError("Failed to load tracks.");
        setTracks([]);
      }
    }
    fetchTracks();
  }, [division]);

  // Fetch top players when track, division, or minRaces changes
  useEffect(() => {
    if (!selectedTrack) return;

    async function fetchTrackData() {
      setLoading(true);
      setError("");
      try {
        const playersRes = await fetch(
          `${API_URL}/api/top-tracks?track=${encodeURIComponent(
            selectedTrack
          )}&min_races=${minRaces}&division=${division}`
        );
        if (!playersRes.ok) throw new Error("Failed to fetch top players");
        const playersData: string[] = await playersRes.json();
        setTopPlayers(playersData);

        const teamsRes = await fetch(
          `${API_URL}/api/top-teams-on-track?track=${encodeURIComponent(
            selectedTrack
          )}&min_races=${minRaces}&division=${division}`
        );
        if (!teamsRes.ok) throw new Error("Failed to fetch top teams");
        const teamsData: string[] = await teamsRes.json();
        setTopTeams(teamsData);
      } catch (err) {
        console.error("Error fetching track data:", err);
        setError("Failed to fetch data for this track");
        setTopPlayers([]);
        setTopTeams([]);
      } finally {
        setLoading(false);
      }
    }

    fetchTrackData();
  }, [selectedTrack, division, minRaces]);

  return (
    <div className="relative min-h-screen text-white font-sans p-6">
      {/* Top bar with semi-transparent background */}
      <div className="fixed top-0 left-0 right-0 bg-black/40 backdrop-blur-sm p-4 z-50">
        <div className="flex justify-between items-center max-w-7xl mx-auto px-2">
          <Link to="/" className="text-blue-400 hover:text-blue-300 font-semibold">
            ← Back
          </Link>
          <h1 className="text-3xl font-bold text-center flex-1">Best Track Averages</h1>
          <div className="w-32"></div>
            <img 
            src="/images/CTC_LOGO/ctclogo.png" 
            alt="Logo" 
            className="w-12 h-12 rounded-lg"
            loading="lazy"
          />
        </div>
      </div>

      {/* Main content with top padding */}
      <div className="pt-24 max-w-4xl mx-auto">
        {/* Controls */}
        <div className="mb-8 space-y-4 bg-black/30 p-6 rounded-lg border border-white/20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Division Dropdown */}
            <div>
              <label className="block text-sm font-semibold mb-2">Division:</label>
              <select
                value={division}
                onChange={(e) => setDivision(e.target.value)}
                className="w-full p-2 bg-white text-black border border-gray-600 rounded hover:border-gray-400 focus:outline-none focus:border-blue-400"
              >
                {divisions.map((div) => (
                  <option key={div} value={div}>
                    Division {div}
                  </option>
                ))}
              </select>
            </div>

            {/* Track Dropdown */}
            <div>
              <label className="block text-sm font-semibold mb-2">Track:</label>
              <select
                value={selectedTrack}
                onChange={(e) => setSelectedTrack(e.target.value)}
                className="w-full p-2 bg-white text-black border border-gray-600 rounded hover:border-gray-400 focus:outline-none focus:border-blue-400"
              >
                {tracks.map((track) => (
                  <option key={track} value={track}>
                    {track}
                  </option>
                ))}
              </select>
            </div>

            {/* Min Races Input */}
            <div>
              <label className="block text-sm font-semibold mb-2">Min Races:</label>
              <input
                type="number"
                min="1"
                value={minRaces}
                onChange={(e) => setMinRaces(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full p-2 bg-white text-black border border-gray-600 rounded hover:border-gray-400 focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-600 rounded text-red-200">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8 text-gray-300">
            Loading data...
          </div>
        )}

        {/* Side-by-side results */}
        {!loading && (topPlayers.length > 0 || topTeams.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Players Column */}
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
                        .map((player, idx) => (
                          <tr
                            key={idx}
                            className={idx % 2 === 0 ? "bg-black/50" : "bg-black/70"}
                          >
                            <td className="px-4 py-2 font-semibold text-blue-400">
                              {idx + 1}
                            </td>
                            <td className="px-4 py-2 text-white">{player}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Teams Column */}
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
                        .map((team, idx) => (
                          <tr
                            key={idx}
                            className={idx % 2 === 0 ? "bg-black/50" : "bg-black/70"}
                          >
                            <td className="px-4 py-2 font-semibold text-blue-400">
                              {idx + 1}
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

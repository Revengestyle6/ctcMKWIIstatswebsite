import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import React from "react";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const divisions = ["1_2", "3", "4"];

export default function TopTeamPlayers(): React.JSX.Element {
  const [teams, setTeams] = useState<string[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [topPlayers, setTopPlayers] = useState<string[]>([]);
  const [topTracks, setTopTracks] = useState<string[]>([]);
  const [division, setDivision] = useState<string>("1_2");
  const [minRaces, setMinRaces] = useState<number>(12);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

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
    if (!selectedTeam) return;

    async function fetchTeamData() {
      setLoading(true);
      setError("");
      try {
        // Fetch top players
        const playersRes = await fetch(
          `${API_URL}/api/top-team-players?team=${encodeURIComponent(
            selectedTeam
          )}&min_races=${minRaces}&division=${division}`
        );
        if (!playersRes.ok) throw new Error("Failed to fetch top players");
        const playersData: string[] = await playersRes.json();
        setTopPlayers(playersData);

        // Fetch top tracks
        const tracksRes = await fetch(
          `${API_URL}/api/top-team-tracks?team=${encodeURIComponent(
            selectedTeam
          )}&division=${division}`
        );
        if (!tracksRes.ok) throw new Error("Failed to fetch top tracks");
        const tracksData: string[] = await tracksRes.json();
        setTopTracks(tracksData);
      } catch (err) {
        console.error("Error fetching team data:", err);
        setError("Failed to fetch team data");
        setTopPlayers([]);
        setTopTracks([]);
      } finally {
        setLoading(false);
      }
    }

    fetchTeamData();
  }, [selectedTeam, division, minRaces]);

  return (
    <div className="relative min-h-screen text-white font-sans p-6">
      {/* Top bar with semi-transparent background */}
      <div className="fixed top-0 left-0 right-0 bg-black/40 backdrop-blur-sm p-4 z-50">
        <div className="flex justify-between items-center max-w-7xl mx-auto px-2">
          <Link to="/" className="text-blue-400 hover:text-blue-300 font-semibold">
            ← Back
          </Link>
          <h1 className="text-3xl font-bold text-center flex-1">Best Team Averages</h1>
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


        {error && <p className="text-red-400 mb-4 text-center">{error}</p>}

        <div className="flex flex-col md:flex-row md:items-end gap-4 mb-6 flex-wrap justify-center">
          {/* Division dropdown */}
          <div>
            <label className="block font-semibold mb-1">Division</label>
            <select
              className="px-4 py-2 rounded-md border border-gray-400 bg-white text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={division}
              onChange={(e) => setDivision(e.target.value)}
            >
              {divisions.map((div) => (
                <option key={div} value={div}>
                  Division {div.replace("_", "–")}
                </option>
              ))}
            </select>
          </div>

          {/* Team dropdown */}
          <div>
            <label className="block font-semibold mb-1">Team</label>
            <select
              className="px-4 py-2 rounded-md border border-gray-400 bg-white text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
            >
              <option value="">Select a team</option>
              {teams.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </select>
          </div>

          {/* Min races slider */}
          <div>
            <label className="block font-semibold mb-1">
              Min Races: {minRaces}
            </label>
            <input
              type="range"
              min={1}
              max={30}
              value={minRaces}
              onChange={(e) => setMinRaces(parseInt(e.target.value))}
              className="w-48"
            />
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="text-center">
            <div className="inline-block">
              <div className="animate-spin h-8 w-8 border-4 border-blue-400 border-t-transparent rounded-full"></div>
              <p className="mt-2 text-gray-300">Loading team data...</p>
            </div>
          </div>
        )}

        {/* Top players table */}
        {!loading && topPlayers.length > 0 && (
          <div className="mb-8">
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
                  {topPlayers.map((player, idx) => (
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

        {/* Top tracks table */}
        {!loading && topTracks.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-4 text-center">Top Tracks</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full bg-black/70 backdrop-blur-sm shadow-md rounded-xl overflow-hidden">
                <thead className="bg-black/90">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-white">#</th>
                    <th className="text-left px-4 py-2 font-semibold text-white">Track Stats</th>
                  </tr>
                </thead>
                <tbody>
                  {topTracks.map((track, idx) => (
                    <tr
                      key={idx}
                      className={idx % 2 === 0 ? "bg-black/50" : "bg-black/70"}
                    >
                      <td className="px-4 py-2 font-semibold text-blue-400">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-2 text-white">{track}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && topPlayers.length === 0 && topTracks.length === 0 && selectedTeam && (
          <p className="text-center text-gray-300">No data available for this team.</p>
        )}

        {!loading && topPlayers.length === 0 && topTracks.length === 0 && !selectedTeam && (
          <p className="text-center text-gray-400">Select a team to view data.</p>
        )}
      </div>
    </div>
  );
}
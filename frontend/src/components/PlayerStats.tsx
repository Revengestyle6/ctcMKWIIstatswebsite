import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import axios, { AxiosError } from "axios";

const API_URL = import.meta.env.VITE_API_URL || 'https://ctc-mkwii-api-production.up.railway.app';

interface PlayerResponse {
  results: string[];
}

interface PlayerAvgResponse {
  avg: number;
  player_name: string;
  team_name: string;
  races: number;
}

export default function PlayerStats() {
  const [players, setPlayers] = useState<string[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<string>("");
  const [results, setResults] = useState<string[]>([]);
  const [playerAvg, setPlayerAvg] = useState<PlayerAvgResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [division, setDivision] = useState<string>("1_2");
  const [loading, setLoading] = useState(false);
  const [avgLoading, setAvgLoading] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch players whenever division changes
  useEffect(() => {
    async function fetchPlayers() {
      try {
        const res = await fetch(`${API_URL}/api/players?division=${division}`);
        if (!res.ok) throw new Error("Failed to fetch players");
        const data: string[] = await res.json();
        // Sort players alphabetically (case-insensitive)
        const sortedData = data.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        setPlayers(sortedData);
        if (sortedData.length > 0) setSelectedPlayer(sortedData[0]);
        setError("");
      } catch (err) {
        console.error("Error fetching players:", err);
        setError("Failed to load players.");
        setPlayers([]);
      }
    }
    fetchPlayers();
  }, [division]);

  // Fetch player stats and average whenever selected player changes
  useEffect(() => {
    if (!selectedPlayer) return;

    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce API call by 300ms
    debounceTimerRef.current = setTimeout(() => {
      async function fetchPlayerStats() {
        setLoading(true);
        setAvgLoading(true);
        setError("");
        try {
          // Fetch best tracks
          const tracksResponse = await axios.get<PlayerResponse>(
            `${API_URL}/api/player`,
            { params: { name: selectedPlayer, division } }
          );
          setResults(tracksResponse.data.results);

          // Fetch player average
          const avgResponse = await axios.get<PlayerAvgResponse>(
            `${API_URL}/api/player-avg`,
            { params: { name: selectedPlayer, division } }
          );
          setPlayerAvg(avgResponse.data);
        } catch (err: unknown) {
          if (err instanceof AxiosError) {
            setError(err.response?.data?.error ?? "Server error");
          } else {
            setError("Unexpected error occurred");
          }
          setResults([]);
          setPlayerAvg(null);
        } finally {
          setLoading(false);
          setAvgLoading(false);
        }
      }

      fetchPlayerStats();
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [selectedPlayer, division]);

  return (
    <div className="relative min-h-screen text-white font-sans p-6">
      {/* Top bar with semi-transparent background */}
      <div className="fixed top-0 left-0 right-0 bg-black/40 backdrop-blur-sm p-4 z-50">
        <div className="flex justify-between items-center max-w-7xl mx-auto px-2">
          <Link to="/" className="text-blue-400 hover:text-blue-300 font-semibold">
            ← Back
          </Link>
          <h1 className="text-3xl font-bold text-center flex-1">Player Statistics</h1>
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

        <div className="flex flex-col md:flex-row md:items-end gap-4 mb-6 flex-wrap">
          {/* Division dropdown */}
          <div>
            <label className="block font-semibold mb-1">Division</label>
            <select
              className="px-4 py-2 rounded-md border border-gray-400 bg-white text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={division}
              onChange={(e) => setDivision(e.target.value)}
            >
              <option value="1_2">Division 1–2</option>
              <option value="3">Division 3</option>
              <option value="4">Division 4</option>
            </select>
          </div>

          {/* Player dropdown */}
          <div>
            <label className="block font-semibold mb-1">Player</label>
            <select
              className="px-4 py-2 rounded-md border border-gray-400 bg-white text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedPlayer}
              onChange={(e) => setSelectedPlayer(e.target.value)}
            >
              <option value="">Select a player</option>
              {players.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Player Average Box */}
        {!avgLoading && playerAvg && (
          <div className="mt-6 bg-black/70 backdrop-blur-sm p-6 rounded-xl shadow-md border border-blue-400/50">
            <h2 className="text-2xl font-bold text-blue-400 mb-2">
              {playerAvg.player_name} <span className="text-gray-400 text-lg">({playerAvg.team_name})</span>
            </h2>
            <p className="text-lg text-gray-200">
              Average: <span className="text-yellow-400 font-semibold">{playerAvg.avg.toFixed(1)} pts</span>
            </p>
            <p className="text-sm text-gray-400">
              Total races: {playerAvg.races}
            </p>
          </div>
        )}

        {loading && (
          <div className="mt-6 text-center">
            <div className="inline-block">
              <div className="animate-spin h-8 w-8 border-4 border-blue-400 border-t-transparent rounded-full"></div>
              <p className="mt-2 text-gray-300">Loading player stats...</p>
            </div>
          </div>
        )}

        {error && <p className="mt-4 text-red-400 text-center">{error}</p>}

        {!loading && results.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full bg-black/70 backdrop-blur-sm shadow-md rounded-xl overflow-hidden">
              <thead className="bg-black/90">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-white">#</th>
                  <th className="text-left px-4 py-2 font-semibold text-white">Track Stats</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, idx) => (
                  <tr
                    key={idx}
                    className={idx % 2 === 0 ? "bg-black/50" : "bg-black/70"}
                  >
                    <td className="px-4 py-2 font-semibold text-blue-400">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2 text-white">{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && results.length === 0 && selectedPlayer && (
          <p className="mt-4 text-center text-gray-300">No results found.</p>
        )}

        {!loading && results.length === 0 && !selectedPlayer && (
          <p className="mt-4 text-center text-gray-400">Select a player to view stats.</p>
        )}
      </div>
    </div>
  );
}
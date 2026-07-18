import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import axios, { AxiosError } from "axios";
import { API_URL, fetchPlayerDirectory, type PlayerDirectoryEntry } from "../api";
import SeasonDivisionSelector from "./SeasonDivisionSelector";
import { useSeasonDivision } from "../hooks/useSeasonDivision";

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
  const [players, setPlayers] = useState<string[]>([]);
  const [playerDirectory, setPlayerDirectory] = useState<PlayerDirectoryEntry[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<string>("");
  const [results, setResults] = useState<string[]>([]);
  const [playerAvg, setPlayerAvg] = useState<PlayerAvgResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [avgLoading, setAvgLoading] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPlayers() {
      if (!season || !division) return;
      setPlayers([]);
      setSelectedPlayer("");
      setResults([]);
      setPlayerAvg(null);
      setError("");
      try {
        const directory = await fetchPlayerDirectory(season, division);
        if (cancelled) return;
        const sortedData = directory.map((entry) => entry.name).sort((a, b) =>
          a.toLowerCase().localeCompare(b.toLowerCase())
        );
        setPlayerDirectory(directory);
        setPlayers(sortedData);
        setSelectedPlayer(sortedData[0] ?? "");
      } catch (err) {
        if (cancelled) return;
        console.error("Error fetching players:", err);
        setError("Failed to load players.");
      }
    }

    loadPlayers();
    return () => {
      cancelled = true;
    };
  }, [season, division]);

  useEffect(() => {
    if (!selectedPlayer || !season || !division) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      async function fetchPlayerStats() {
        setLoading(true);
        setAvgLoading(true);
        setError("");
        try {
          const tracksResponse = await axios.get<PlayerResponse>(
            `${API_URL}/api/player`,
            { params: { name: selectedPlayer, season, division } }
          );
          setResults(tracksResponse.data.results);

          const avgResponse = await axios.get<PlayerAvgResponse>(
            `${API_URL}/api/player-avg`,
            { params: { name: selectedPlayer, season, division } }
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
  }, [selectedPlayer, season, division]);

  const combinedError = scopeError || error;
  const selectedPlayerId = playerDirectory.find((entry) => entry.name === selectedPlayer)?.player_id;

  return (
    <div className="relative min-h-screen text-white font-sans p-6">
      <div className="fixed top-0 left-0 right-0 bg-black/40 backdrop-blur-sm p-4 z-50">
        <div className="flex justify-between items-center max-w-7xl mx-auto px-2">
          <Link to="/" className="text-blue-400 hover:text-blue-300 font-semibold">
            &lt; Back
          </Link>
          <h1 className="text-3xl font-bold text-center flex-1">Player Statistics</h1>
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
        <div className="flex flex-col md:flex-row md:items-end gap-4 mb-6 flex-wrap">
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
            <label className="block font-semibold mb-1">Player</label>
            <select
              className="px-4 py-2 rounded-md border border-gray-400 bg-white text-black focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-48"
              value={selectedPlayer}
              onChange={(event) => setSelectedPlayer(event.target.value)}
              disabled={!division || players.length === 0}
            >
              <option value="">Select a player</option>
              {players.map((player) => (
                <option key={player} value={player}>
                  {player}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!avgLoading && playerAvg && (
          <div className="mt-6 bg-black/70 backdrop-blur-sm p-6 rounded-xl shadow-md border border-blue-400/50">
            <h2 className="text-2xl font-bold text-blue-400 mb-2">
              {playerAvg.player_name}{" "}
              <span className="text-gray-400 text-lg">({playerAvg.team_name})</span>
            </h2>
            <p className="text-lg text-gray-200">
              Average:{" "}
              <span className="text-yellow-400 font-semibold">
                {playerAvg.avg.toFixed(1)} pts
              </span>
            </p>
            <p className="text-sm text-gray-400">Total races: {playerAvg.races}</p>
            {selectedPlayerId && (
              <Link
                to={`/players/${selectedPlayerId}?season=${season}&division=${division}`}
                className="mt-4 inline-block font-semibold text-blue-300 hover:text-blue-200"
              >
                Open player dashboard &rarr;
              </Link>
            )}
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

        {combinedError && <p className="mt-4 text-red-400 text-center">{combinedError}</p>}

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
                {results.map((result, index) => (
                  <tr
                    key={index}
                    className={index % 2 === 0 ? "bg-black/50" : "bg-black/70"}
                  >
                    <td className="px-4 py-2 font-semibold text-blue-400">{index + 1}</td>
                    <td className="px-4 py-2 text-white">{result}</td>
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

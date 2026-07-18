import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import React from "react";
import { fetchJson, fetchTeamScopes } from "../api";
import SeasonDivisionSelector from "./SeasonDivisionSelector";
import { useSeasonDivision } from "../hooks/useSeasonDivision";

export default function TopTeamPlayers(): React.JSX.Element {
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
  const [teamIds, setTeamIds] = useState<Record<string, number>>({});
  const [topPlayers, setTopPlayers] = useState<string[]>([]);
  const [topTracks, setTopTracks] = useState<string[]>([]);
  const [minRaces, setMinRaces] = useState<number>(12);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function loadTeams() {
      if (!season || !division) return;
      setTeams([]);
      setSelectedTeam("");
      setTopPlayers([]);
      setTopTracks([]);
      setError("");
      try {
        const [data, scopes] = await Promise.all([
          fetchJson<string[]>("/api/teams", { season, division }),
          fetchTeamScopes(),
        ]);
        if (cancelled) return;
        const sortedData = [...data].sort((a, b) =>
          a.toLowerCase().localeCompare(b.toLowerCase())
        );
        setTeams(sortedData);
        setTeamIds(Object.fromEntries(
          scopes
            .filter((scope) => scope.season === season && scope.division === division)
            .map((scope) => [scope.clan_tag, scope.team_id])
        ));
        setSelectedTeam(sortedData[0] ?? "");
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

    async function fetchTeamData() {
      if (!selectedTeam || !season || !division) return;
      setLoading(true);
      setError("");
      try {
        const playersData = await fetchJson<string[]>("/api/top-team-players", {
          team: selectedTeam,
          min_races: minRaces,
          season,
          division,
        });
        const tracksData = await fetchJson<string[]>("/api/top-team-tracks", {
          team: selectedTeam,
          season,
          division,
        });
        if (cancelled) return;
        setTopPlayers(playersData);
        setTopTracks(tracksData);
      } catch (err) {
        if (cancelled) return;
        console.error("Error fetching team data:", err);
        setError("Failed to fetch team data.");
        setTopPlayers([]);
        setTopTracks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTeamData();
    return () => {
      cancelled = true;
    };
  }, [selectedTeam, season, division, minRaces]);

  const combinedError = scopeError || error;

  return (
    <div className="relative min-h-screen text-white font-sans p-6">
      <div className="fixed top-0 left-0 right-0 bg-black/40 backdrop-blur-sm p-4 z-50">
        <div className="flex justify-between items-center max-w-7xl mx-auto px-2">
          <Link to="/" className="text-blue-400 hover:text-blue-300 font-semibold">
            &lt; Back
          </Link>
          <h1 className="text-3xl font-bold text-center flex-1">Best Team Averages</h1>
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
        {combinedError && <p className="text-red-400 mb-4 text-center">{combinedError}</p>}

        <div className="flex flex-col md:flex-row md:items-end gap-4 mb-6 flex-wrap justify-center">
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
            <label className="block font-semibold mb-1">Team</label>
            <select
              className="px-4 py-2 rounded-md border border-gray-400 bg-white text-black focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-40"
              value={selectedTeam}
              onChange={(event) => setSelectedTeam(event.target.value)}
              disabled={!division || teams.length === 0}
            >
              <option value="">Select a team</option>
              {teams.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-1">Min Races: {minRaces}</label>
            <input
              type="range"
              min={1}
              max={30}
              value={minRaces}
              onChange={(event) => setMinRaces(parseInt(event.target.value))}
              className="w-48"
            />
          </div>
        </div>

        {selectedTeam && teamIds[selectedTeam] && (
          <div className="mb-6 text-center">
            <Link
              to={`/teams/${teamIds[selectedTeam]}?season=${season}&division=${division}`}
              className="font-semibold text-blue-300 hover:text-blue-200"
            >
              Open team dashboard &rarr;
            </Link>
          </div>
        )}

        {loading && (
          <div className="text-center">
            <div className="inline-block">
              <div className="animate-spin h-8 w-8 border-4 border-blue-400 border-t-transparent rounded-full"></div>
              <p className="mt-2 text-gray-300">Loading team data...</p>
            </div>
          </div>
        )}

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
                  {topPlayers.map((player, index) => (
                    <tr
                      key={index}
                      className={index % 2 === 0 ? "bg-black/50" : "bg-black/70"}
                    >
                      <td className="px-4 py-2 font-semibold text-blue-400">{index + 1}</td>
                      <td className="px-4 py-2 text-white">{player}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
                  {topTracks.map((track, index) => (
                    <tr
                      key={index}
                      className={index % 2 === 0 ? "bg-black/50" : "bg-black/70"}
                    >
                      <td className="px-4 py-2 font-semibold text-blue-400">{index + 1}</td>
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

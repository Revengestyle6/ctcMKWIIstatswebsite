import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchJson, fetchPlayerDirectory, type PlayerDirectoryEntry } from "../api";
import {
  type LegacyPlayerAverageResponse,
  type LegacyPlayerTracksResponse,
  type PlayerRoleMode,
  type PlayerTrackRow,
} from "../dashboardApi";
import { useSeasonDivision } from "../hooks/useSeasonDivision";
import { RoleModeToggle } from "./RoleModeToggle";
import SeasonDivisionSelector from "./SeasonDivisionSelector";

function value(value: number | null, suffix = ""): string {
  return value === null ? "-" : `${value}${suffix}`;
}

export default function PlayerStats() {
  const {
    seasons, divisions, season, division, loadingScope, scopeError, setSeason, setDivision,
  } = useSeasonDivision();
  const [searchParams, setSearchParams] = useSearchParams();
  const role: PlayerRoleMode = searchParams.get("role") === "bagger" ? "bagger" : "runner";
  const [playerDirectory, setPlayerDirectory] = useState<PlayerDirectoryEntry[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [stats, setStats] = useState<{
    key: string;
    tracks: LegacyPlayerTracksResponse;
    average: LegacyPlayerAverageResponse;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const queryKey = JSON.stringify([selectedPlayer, season, division, role]);
  const currentStats = stats?.key === queryKey ? stats : null;

  useEffect(() => {
    let cancelled = false;
    if (!season || !division) {
      setPlayerDirectory([]);
      setSelectedPlayer("");
      setStats(null);
      setLoading(false);
      setError("");
      return;
    }
    setPlayerDirectory([]);
    setSelectedPlayer("");
    setStats(null);
    setLoading(false);
    setError("");
    fetchPlayerDirectory(season, division)
      .then((directory) => {
        if (cancelled) return;
        const sorted = [...directory].sort((a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        );
        setPlayerDirectory(sorted);
        setSelectedPlayer(sorted[0]?.name ?? "");
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Failed to load players.");
      });
    return () => { cancelled = true; };
  }, [season, division]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedPlayer || !season || !division) {
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    Promise.all([
      fetchJson<LegacyPlayerTracksResponse>("/api/player", {
        name: selectedPlayer, season, division, role,
      }),
      fetchJson<LegacyPlayerAverageResponse>("/api/player-avg", {
        name: selectedPlayer, season, division, role,
      }),
    ])
      .then(([tracks, average]) => {
        if (!cancelled) setStats({ key: queryKey, tracks, average });
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Failed to load player statistics.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedPlayer, season, division, role, queryKey]);

  function updateRole(nextRole: PlayerRoleMode) {
    const next = new URLSearchParams(searchParams);
    if (nextRole === "runner") next.delete("role");
    else next.set("role", nextRole);
    setSearchParams(next, { replace: true });
  }

  const selectedPlayerId = useMemo(
    () => playerDirectory.find((entry) => entry.name === selectedPlayer)?.player_id,
    [playerDirectory, selectedPlayer]
  );
  const metrics = currentStats?.average.metrics;
  const tracks = currentStats?.tracks.results ?? [];

  return (
    <div className="relative min-h-screen p-6 font-sans text-white">
      <div className="fixed inset-x-0 top-0 z-50 bg-black/40 p-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-2">
          <Link to="/" className="font-semibold text-blue-400 hover:text-blue-300">&lt; Back</Link>
          <h1 className="flex-1 text-center text-3xl font-bold">Player Statistics</h1>
          <div className="w-32" />
          <img src="/images/CTC_LOGO/ctclogo.webp" alt="Logo" className="h-12 w-12 rounded-lg" loading="lazy" />
        </div>
      </div>

      <div className="mx-auto max-w-5xl pt-24">
        <div className="mb-6 flex flex-col flex-wrap gap-4 md:flex-row md:items-end">
          <SeasonDivisionSelector
            season={season} division={division} seasons={seasons} divisions={divisions}
            disabled={loadingScope} onSeasonChange={setSeason} onDivisionChange={setDivision}
          />
          <div>
            <label className="mb-1 block font-semibold">Player</label>
            <select
              className="min-w-48 rounded-md border border-gray-400 bg-white px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedPlayer}
              onChange={(event) => setSelectedPlayer(event.target.value)}
              disabled={!division || playerDirectory.length === 0}
            >
              <option value="">Select a player</option>
              {playerDirectory.map((player) => <option key={player.player_id} value={player.name}>{player.name}</option>)}
            </select>
          </div>
          <RoleModeToggle value={role} onChange={updateRole} disabled={loading} />
        </div>

        {role === "bagger" && <BaggerDisclosure />}

        {(scopeError || error) && <p className="mt-4 text-center text-red-400">{scopeError || error}</p>}
        {loading && <p className="mt-6 text-center text-gray-300">Loading player statistics...</p>}

        {!loading && currentStats && metrics && (
          <>
            <section className="mt-6 rounded-lg border border-blue-400/50 bg-black/70 p-6 shadow-md backdrop-blur-sm">
              <h2 className="mb-4 text-2xl font-bold text-blue-400">
                {currentStats.average.player_name}{" "}
                {currentStats.average.team_name && <span className="text-lg text-gray-400">({currentStats.average.team_name})</span>}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {metrics.role === "runner" ? (
                  <>
                    <Metric label="12-race pace" value={value(metrics.twelve_race_pace)} />
                    <Metric label="Points per race" value={value(metrics.points_per_race)} />
                    <Metric label="Runner races" value={`${metrics.races} (${metrics.scored_races} scored)`} />
                    <Metric label="Wins / podiums" value={`${metrics.wins} / ${metrics.podiums}`} />
                  </>
                ) : (
                  <>
                    <Metric label="Bagging points" value={String(metrics.total_points)} />
                    <Metric label="Bagging points per race" value={value(metrics.points_per_race)} />
                    <Metric label="Bag-point rate" value={value(metrics.bag_point_rate, "%")} />
                    <Metric label="Zero-point rate" value={value(metrics.zero_point_rate, "%")} />
                    <Metric label="Bagger races" value={`${metrics.races} (${metrics.scored_races} scored)`} />
                    <Metric label="Average place" value={value(metrics.average_placement)} />
                    <Metric
                      label="Opponent point diff"
                      value={metrics.counterpart_races > 0 ? value(metrics.opponent_point_differential) : "-"}
                    />
                  </>
                )}
              </div>
              {selectedPlayerId && (
                <Link
                  to={`/players/${selectedPlayerId}?season=${season}&division=${division}&role=${role}`}
                  className="mt-5 inline-block font-semibold text-blue-300 hover:text-blue-200"
                >Open player dashboard &rarr;</Link>
              )}
            </section>

            <TrackTable tracks={tracks} role={role} />
          </>
        )}

        {!loading && selectedPlayer && !currentStats && !error && (
          <p className="mt-4 text-center text-gray-300">No results found.</p>
        )}
        {!loading && !selectedPlayer && <p className="mt-4 text-center text-gray-400">Select a player to view statistics.</p>}
      </div>
    </div>
  );
}

function Metric({ label, value: metricValue }: { label: string; value: string }) {
  return <div><p className="text-xs font-semibold uppercase text-gray-400">{label}</p><p className="mt-1 text-lg font-bold text-white">{metricValue}</p></div>;
}

function BaggerDisclosure() {
  return (
    <p className="mb-5 rounded-md border border-amber-300/25 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
      Bagger statistics report scoring outcomes only. Shock acquisition is not recorded, and points do not measure overall bagging effectiveness.
    </p>
  );
}

function TrackTable({ tracks, role }: { tracks: PlayerTrackRow[]; role: PlayerRoleMode }) {
  if (tracks.length === 0) return <p className="mt-6 text-center text-gray-300">No qualifying track results.</p>;
  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-white/10">
      <table className="min-w-full bg-black/70 text-sm backdrop-blur-sm">
        <thead className="bg-black/90">
          <tr>
            <th scope="col" className="px-4 py-3 text-left">Track</th>
            <th scope="col" className="px-4 py-3 text-right">Races</th>
            <th scope="col" className="px-4 py-3 text-right">Scored</th>
            {role === "runner" ? <>
              <th scope="col" className="px-4 py-3 text-right">12-race pace</th>
              <th scope="col" className="px-4 py-3 text-right">PPR</th>
              <th scope="col" className="px-4 py-3 text-right">Wins</th>
              <th scope="col" className="px-4 py-3 text-right">Podiums</th>
            </> : <>
              <th scope="col" className="px-4 py-3 text-right">Bag PPR</th>
              <th scope="col" className="px-4 py-3 text-right">Bag-point rate</th>
              <th scope="col" className="px-4 py-3 text-right">Zero-point rate</th>
              <th scope="col" className="px-4 py-3 text-right">Avg place</th>
            </>}
          </tr>
        </thead>
        <tbody>
          {tracks.map((track, index) => (
            <tr key={track.track_id} className={index % 2 === 0 ? "bg-black/50" : "bg-black/70"}>
              <td className="whitespace-nowrap px-4 py-3 font-semibold text-blue-200">{track.name}</td>
              <td className="px-4 py-3 text-right">{track.races}</td>
              <td className="px-4 py-3 text-right">{track.scored_races}</td>
              {track.role === "runner" ? <>
                <td className="px-4 py-3 text-right font-semibold">{value(track.twelve_race_pace)}</td>
                <td className="px-4 py-3 text-right">{value(track.points_per_race)}</td>
                <td className="px-4 py-3 text-right">{track.wins}</td>
                <td className="px-4 py-3 text-right">{track.podiums}</td>
              </> : <>
                <td className="px-4 py-3 text-right font-semibold">{value(track.points_per_race)}</td>
                <td className="px-4 py-3 text-right">{value(track.bag_point_rate, "%")}</td>
                <td className="px-4 py-3 text-right">{value(track.zero_point_rate, "%")}</td>
                <td className="px-4 py-3 text-right">{value(track.average_placement)}</td>
              </>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

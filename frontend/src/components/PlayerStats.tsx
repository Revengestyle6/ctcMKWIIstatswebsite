import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchCachedJson,
  fetchPlayerDirectory,
  type PlayerDirectoryEntry,
  prefetchMatchSetVariants,
} from "../api";
import type {
  LegacyPlayerAverageResponse,
  LegacyPlayerTracksResponse,
  PlayerRoleMode,
  PlayerTrackRow,
} from "../dashboardApi";
import { useSeasonDivision } from "../hooks/useSeasonDivision";
import { LegacyStatHeader } from "./LegacyStatHeader";
import { type MatchSet, MatchSetToggle } from "./MatchSetToggle";
import { RoleModeToggle } from "./RoleModeToggle";
import SeasonDivisionSelector from "./SeasonDivisionSelector";

function value(value: number | null, suffix = ""): string {
  return value === null ? "-" : `${value}${suffix}`;
}

export default function PlayerStats() {
  const { seasons, divisions, season, division, loadingScope, scopeError, setSeason, setDivision } =
    useSeasonDivision();
  const [searchParams, setSearchParams] = useSearchParams();
  const role: PlayerRoleMode = searchParams.get("role") === "bagger" ? "bagger" : "runner";
  const matchSet: MatchSet =
    searchParams.get("match_set") === "playoffs"
      ? "playoffs"
      : searchParams.get("match_set") === "all"
        ? "all"
        : "regular";
  const [playerDirectory, setPlayerDirectory] = useState<PlayerDirectoryEntry[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [stats, setStats] = useState<{
    key: string;
    tracks: LegacyPlayerTracksResponse;
    average: LegacyPlayerAverageResponse;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const queryKey = JSON.stringify([selectedPlayer, season, division, role, matchSet]);
  const currentStats = stats?.key === queryKey ? stats : null;

  useEffect(() => {
    let cancelled = false;
    if (!season || !division) {
      setPlayerDirectory([]);
      setSelectedPlayer("");
      setPlayerSearch("");
      setStats(null);
      setLoading(false);
      setError("");
      return;
    }
    setPlayerDirectory([]);
    setSelectedPlayer("");
    setPlayerSearch("");
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
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setError(
            requestError instanceof Error ? requestError.message : "Failed to load players."
          );
      });
    return () => {
      cancelled = true;
    };
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
      fetchCachedJson<LegacyPlayerTracksResponse>("/api/player", {
        name: selectedPlayer,
        season,
        division,
        role,
        match_set: matchSet,
      }),
      fetchCachedJson<LegacyPlayerAverageResponse>("/api/player-avg", {
        name: selectedPlayer,
        season,
        division,
        role,
        match_set: matchSet,
      }),
    ])
      .then(([tracks, average]) => {
        if (!cancelled) setStats({ key: queryKey, tracks, average });
        const params = { name: selectedPlayer, season, division, role };
        prefetchMatchSetVariants("/api/player", params, matchSet);
        prefetchMatchSetVariants("/api/player-avg", params, matchSet);
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Failed to load player statistics."
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlayer, season, division, role, matchSet, queryKey]);

  function updateRole(nextRole: PlayerRoleMode) {
    const next = new URLSearchParams(searchParams);
    if (nextRole === "runner") next.delete("role");
    else next.set("role", nextRole);
    setSearchParams(next, { replace: true });
  }

  function updateMatchSet(value: MatchSet) {
    const next = new URLSearchParams(searchParams);
    if (value === "regular") next.delete("match_set");
    else next.set("match_set", value);
    setSearchParams(next, { replace: true });
  }

  function updatePlayerSearch(nextSearch: string) {
    setPlayerSearch(nextSearch);
    setSelectedPlayer("");
  }

  const normalizedPlayerSearch = playerSearch.trim().toLocaleLowerCase();
  const filteredPlayers = useMemo(
    () =>
      normalizedPlayerSearch
        ? playerDirectory.filter((entry) =>
            entry.name.toLocaleLowerCase().includes(normalizedPlayerSearch)
          )
        : playerDirectory,
    [playerDirectory, normalizedPlayerSearch]
  );
  const selectedPlayerId = useMemo(
    () => playerDirectory.find((entry) => entry.name === selectedPlayer)?.player_id,
    [playerDirectory, selectedPlayer]
  );
  const metrics = currentStats?.average.metrics;
  const tracks = currentStats?.tracks.results ?? [];

  return (
    <div className="relative min-h-screen p-6 font-sans text-white">
      <LegacyStatHeader title="Player Statistics" />

      <div className="mx-auto max-w-5xl pt-24">
        <div className="mb-6 rounded-xl border border-white/15 bg-black/45 p-5 shadow-lg backdrop-blur-sm">
          <p className="mb-4 text-sm text-gray-300">
            Choose a season and division, then search for a player by name.
          </p>
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
            <div className="min-w-64">
              <label htmlFor="legacy-player-search" className="mb-1 block font-semibold">
                Search players
              </label>
              <input
                id="legacy-player-search"
                type="search"
                className="w-full rounded-t-md border border-gray-400 bg-white px-4 py-2 text-black placeholder:text-gray-500 focus:relative focus:z-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={playerSearch}
                onChange={(event) => updatePlayerSearch(event.target.value)}
                disabled={!division || playerDirectory.length === 0}
                placeholder={
                  playerDirectory.length > 0 ? "Search players..." : "No players available"
                }
                autoComplete="off"
              />
              <label htmlFor="legacy-player-select" className="sr-only">
                Matching players
              </label>
              <select
                id="legacy-player-select"
                className="w-full rounded-b-md border border-t-0 border-gray-400 bg-white px-4 py-2 text-black focus:relative focus:z-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={selectedPlayer}
                onChange={(event) => setSelectedPlayer(event.target.value)}
                disabled={!division || filteredPlayers.length === 0}
              >
                <option value="">
                  {filteredPlayers.length === 0
                    ? "No matching players"
                    : `Select a player (${filteredPlayers.length})`}
                </option>
                {filteredPlayers.map((player) => (
                  <option key={player.player_id} value={player.name}>
                    {player.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                Showing {filteredPlayers.length} of {playerDirectory.length} players
              </p>
            </div>
            <RoleModeToggle value={role} onChange={updateRole} disabled={loading} />
            <MatchSetToggle value={matchSet} onChange={updateMatchSet} disabled={loading} />
          </div>
        </div>

        {role === "bagger" && <BaggerDisclosure />}

        {(scopeError || error) && (
          <p className="mt-4 text-center text-red-400">{scopeError || error}</p>
        )}
        {loading && <p className="mt-6 text-center text-gray-300">Loading player statistics...</p>}

        {!loading && currentStats && metrics && (
          <>
            <section className="mt-6 rounded-lg border border-blue-400/50 bg-black/70 p-6 shadow-md backdrop-blur-sm">
              <h2 className="mb-4 text-2xl font-bold text-blue-400">
                {currentStats.average.player_name}{" "}
                {currentStats.average.team_name && (
                  <span className="text-lg text-gray-400">({currentStats.average.team_name})</span>
                )}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {metrics.role === "runner" ? (
                  <>
                    <Metric label="12-race pace" value={value(metrics.twelve_race_pace)} />
                    <Metric label="Points per race" value={value(metrics.points_per_race)} />
                    <Metric
                      label="Runner races"
                      value={`${metrics.races} (${metrics.scored_races} scored)`}
                    />
                    <Metric label="Wins / podiums" value={`${metrics.wins} / ${metrics.podiums}`} />
                  </>
                ) : (
                  <>
                    <Metric label="Bagging points" value={String(metrics.total_points)} />
                    <Metric
                      label="Bagging points per race"
                      value={value(metrics.points_per_race)}
                    />
                    <Metric label="Bag-point rate" value={value(metrics.bag_point_rate, "%")} />
                    <Metric label="Zero-point rate" value={value(metrics.zero_point_rate, "%")} />
                    <Metric
                      label="Bagger races"
                      value={`${metrics.races} (${metrics.scored_races} scored)`}
                    />
                    <Metric label="Average place" value={value(metrics.average_placement)} />
                    <Metric
                      label="Opponent point diff"
                      value={
                        metrics.counterpart_races > 0
                          ? value(metrics.opponent_point_differential)
                          : "-"
                      }
                    />
                  </>
                )}
              </div>
              {selectedPlayerId && (
                <Link
                  to={`/players/${selectedPlayerId}?season=${season}&division=${division}&role=${role}&match_set=${matchSet}`}
                  className="mt-5 inline-block font-semibold text-blue-300 hover:text-blue-200"
                >
                  Open player dashboard &rarr;
                </Link>
              )}
            </section>

            <TrackTable tracks={tracks} role={role} />
          </>
        )}

        {!loading && selectedPlayer && !currentStats && !error && (
          <p className="mt-4 text-center text-gray-300">No results found.</p>
        )}
        {!loading && !selectedPlayer && playerDirectory.length > 0 && (
          <p className="mt-4 text-center text-gray-400">
            Search for and select a player to view statistics.
          </p>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value: metricValue }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-bold text-white">{metricValue}</p>
    </div>
  );
}

function BaggerDisclosure() {
  return (
    <p className="mb-5 rounded-md border border-amber-300/25 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
      Bagger statistics report scoring outcomes only. Shock acquisition is not recorded, and points
      do not measure overall bagging effectiveness.
    </p>
  );
}

function TrackTable({ tracks, role }: { tracks: PlayerTrackRow[]; role: PlayerRoleMode }) {
  if (tracks.length === 0)
    return <p className="mt-6 text-center text-gray-300">No qualifying track results.</p>;
  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-white/10 shadow-lg">
      <table className="min-w-full bg-black/70 text-sm tabular-nums backdrop-blur-sm">
        <thead className="bg-black/90">
          <tr>
            <th scope="col" className="px-4 py-3 text-left">
              Track
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Races
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Scored
            </th>
            {role === "runner" ? (
              <>
                <th scope="col" className="px-4 py-3 text-right">
                  12-race pace
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  PPR
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Wins
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Podiums
                </th>
              </>
            ) : (
              <>
                <th scope="col" className="px-4 py-3 text-right">
                  Bag PPR
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Bag-point rate
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Zero-point rate
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Avg place
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {tracks.map((track, index) => (
            <tr
              key={track.track_id}
              className={`${index % 2 === 0 ? "bg-black/50" : "bg-black/70"} transition-colors hover:bg-blue-950/40`}
            >
              <td className="whitespace-nowrap px-4 py-3 font-semibold text-blue-200">
                {track.name}
              </td>
              <td className="px-4 py-3 text-right">{track.races}</td>
              <td className="px-4 py-3 text-right">{track.scored_races}</td>
              {track.role === "runner" ? (
                <>
                  <td className="px-4 py-3 text-right font-semibold">
                    {value(track.twelve_race_pace)}
                  </td>
                  <td className="px-4 py-3 text-right">{value(track.points_per_race)}</td>
                  <td className="px-4 py-3 text-right">{track.wins}</td>
                  <td className="px-4 py-3 text-right">{track.podiums}</td>
                </>
              ) : (
                <>
                  <td className="px-4 py-3 text-right font-semibold">
                    {value(track.points_per_race)}
                  </td>
                  <td className="px-4 py-3 text-right">{value(track.bag_point_rate, "%")}</td>
                  <td className="px-4 py-3 text-right">{value(track.zero_point_rate, "%")}</td>
                  <td className="px-4 py-3 text-right">{value(track.average_placement)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

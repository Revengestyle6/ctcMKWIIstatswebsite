import type React from "react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchJson, fetchTeamScopes } from "../api";
import type { LegacyTeamRosterPlayer, LegacyTeamTrackRow, PlayerRoleMode } from "../dashboardApi";
import { useSeasonDivision } from "../hooks/useSeasonDivision";
import { LegacyStatHeader } from "./LegacyStatHeader";
import { RoleModeToggle } from "./RoleModeToggle";
import SeasonDivisionSelector from "./SeasonDivisionSelector";

function value(valueToFormat: number | null, suffix = ""): string {
  return valueToFormat === null ? "-" : `${valueToFormat}${suffix}`;
}

export default function TopTeamPlayers(): React.JSX.Element {
  const { seasons, divisions, season, division, loadingScope, scopeError, setSeason, setDivision } =
    useSeasonDivision();
  const [searchParams, setSearchParams] = useSearchParams();
  const role: PlayerRoleMode = searchParams.get("role") === "bagger" ? "bagger" : "runner";
  const [teams, setTeams] = useState<string[]>([]);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [teamIds, setTeamIds] = useState<Record<string, number>>({});
  const [playerResult, setPlayerResult] = useState<{
    key: string;
    rows: LegacyTeamRosterPlayer[];
  } | null>(null);
  const [trackResult, setTrackResult] = useState<{
    key: string;
    rows: LegacyTeamTrackRow[];
  } | null>(null);
  const [minRaces, setMinRaces] = useState(12);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [playersError, setPlayersError] = useState("");
  const [tracksError, setTracksError] = useState("");
  const playerKey = JSON.stringify([selectedTeam, season, division, minRaces, role]);
  const trackKey = JSON.stringify([selectedTeam, season, division]);
  const topPlayers = playerResult?.key === playerKey ? playerResult.rows : [];
  const topTracks = trackResult?.key === trackKey ? trackResult.rows : [];

  useEffect(() => {
    let cancelled = false;
    if (!season || !division) {
      setTeams([]);
      setSelectedTeam("");
      setTeamIds({});
      setPlayerResult(null);
      setTrackResult(null);
      setPlayersLoading(false);
      setTracksLoading(false);
      setPlayersError("");
      setTracksError("");
      return;
    }
    setTeams([]);
    setSelectedTeam("");
    setTeamIds({});
    setPlayerResult(null);
    setTrackResult(null);
    setPlayersLoading(false);
    setTracksLoading(false);
    setPlayersError("");
    setTracksError("");
    Promise.all([fetchJson<string[]>("/api/teams", { season, division }), fetchTeamScopes()])
      .then(([data, scopes]) => {
        if (cancelled) return;
        const sorted = [...data].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        setTeams(sorted);
        setTeamIds(
          Object.fromEntries(
            scopes
              .filter((scope) => scope.season === season && scope.division === division)
              .map((scope) => [scope.clan_tag, scope.team_id])
          )
        );
        setSelectedTeam(sorted[0] ?? "");
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setPlayersError(
            requestError instanceof Error ? requestError.message : "Failed to load teams."
          );
      });
    return () => {
      cancelled = true;
    };
  }, [season, division]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTeam || !season || !division) {
      setPlayersLoading(false);
      setPlayersError("");
      return;
    }
    setPlayersLoading(true);
    setPlayersError("");
    fetchJson<LegacyTeamRosterPlayer[]>("/api/top-team-players", {
      team: selectedTeam,
      min_races: minRaces,
      season,
      division,
      role,
    })
      .then((rows) => {
        if (!cancelled) setPlayerResult({ key: playerKey, rows });
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setPlayersError(
            requestError instanceof Error ? requestError.message : "Failed to load player rankings."
          );
      })
      .finally(() => {
        if (!cancelled) setPlayersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTeam, season, division, minRaces, role, playerKey]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTeam || !season || !division) {
      setTracksLoading(false);
      setTracksError("");
      return;
    }
    setTracksLoading(true);
    setTracksError("");
    fetchJson<LegacyTeamTrackRow[]>("/api/top-team-tracks", {
      team: selectedTeam,
      season,
      division,
    })
      .then((rows) => {
        if (!cancelled) setTrackResult({ key: trackKey, rows });
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setTracksError(
            requestError instanceof Error ? requestError.message : "Failed to load team tracks."
          );
      })
      .finally(() => {
        if (!cancelled) setTracksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTeam, season, division, trackKey]);

  function updateRole(nextRole: PlayerRoleMode) {
    const next = new URLSearchParams(searchParams);
    if (nextRole === "runner") next.delete("role");
    else next.set("role", nextRole);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="relative min-h-screen p-6 font-sans text-white">
      <LegacyStatHeader title="Team Statistics" />

      <div className="mx-auto max-w-6xl pt-24">
        {(scopeError || playersError || tracksError) && (
          <p className="mb-4 text-center text-red-400">
            {scopeError || playersError || tracksError}
          </p>
        )}
        <div className="mb-6 rounded-xl border border-white/15 bg-black/45 p-5 shadow-lg backdrop-blur-sm">
          <p className="mb-4 text-sm text-gray-300">
            Compare a team&apos;s player production and strongest tracks.
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
            <div>
              <label htmlFor="team-player-team" className="mb-1 block font-semibold">
                Team
              </label>
              <select
                id="team-player-team"
                className="min-w-40 rounded-md border border-gray-400 bg-white px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <label htmlFor="team-player-min-races" className="mb-1 block font-semibold">
                Min races: {minRaces}
              </label>
              <input
                id="team-player-min-races"
                type="range"
                min={1}
                max={30}
                value={minRaces}
                onChange={(event) => setMinRaces(Number(event.target.value))}
                className="w-48"
              />
            </div>
            <RoleModeToggle value={role} onChange={updateRole} disabled={playersLoading} />
          </div>
        </div>

        {role === "bagger" && <BaggerDisclosure />}

        {selectedTeam && teamIds[selectedTeam] && (
          <div className="mb-6 text-center">
            <Link
              to={`/teams/${teamIds[selectedTeam]}?season=${season}&division=${division}&tab=roster&role=${role}`}
              className="font-semibold text-blue-300 hover:text-blue-200"
            >
              Open team roster dashboard &rarr;
            </Link>
          </div>
        )}

        {playersLoading && (
          <p className="py-4 text-center text-gray-300">Loading {role} rankings...</p>
        )}
        {!playersLoading && topPlayers.length > 0 && (
          <PlayerTable
            rows={topPlayers}
            role={role}
            season={season}
            division={division}
            teamId={teamIds[selectedTeam]}
          />
        )}
        {!playersLoading && selectedTeam && topPlayers.length === 0 && !playersError && (
          <p className="mb-8 text-center text-gray-300">
            No qualifying {role} results for this team.
          </p>
        )}

        {tracksLoading && <p className="py-4 text-center text-gray-300">Loading team tracks...</p>}
        {!tracksLoading && topTracks.length > 0 && <TeamTrackTable rows={topTracks} />}
        {!playersLoading && !tracksLoading && !selectedTeam && (
          <p className="text-center text-gray-400">Select a team to view data.</p>
        )}
      </div>
    </div>
  );
}

function PlayerTable({
  rows,
  role,
  season,
  division,
  teamId,
}: {
  rows: LegacyTeamRosterPlayer[];
  role: PlayerRoleMode;
  season: string;
  division: string;
  teamId?: number;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-4 text-center text-2xl font-bold">
        Top {role === "runner" ? "Runners" : "Baggers"}
      </h2>
      <div className="overflow-x-auto rounded-lg border border-white/10 shadow-lg">
        <table className="min-w-full bg-black/70 text-sm tabular-nums backdrop-blur-sm">
          <thead className="bg-black/90">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">
                Player
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Matches
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
                    Opponent diff
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const metrics = row.metrics;
              const query = new URLSearchParams({ season, division, role });
              if (teamId) query.set("team_id", String(teamId));
              return (
                <tr
                  key={row.player_id}
                  className={`${index % 2 === 0 ? "bg-black/50" : "bg-black/70"} transition-colors hover:bg-blue-950/40`}
                >
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">
                    <Link
                      to={`/players/${row.player_id}?${query}`}
                      className="text-blue-200 hover:text-blue-100"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">{row.matches}</td>
                  <td className="px-4 py-3 text-right">{metrics.races}</td>
                  <td className="px-4 py-3 text-right">{metrics.scored_races}</td>
                  {metrics.role === "runner" ? (
                    <>
                      <td className="px-4 py-3 text-right font-semibold">
                        {value(metrics.twelve_race_pace)}
                      </td>
                      <td className="px-4 py-3 text-right">{value(metrics.points_per_race)}</td>
                      <td className="px-4 py-3 text-right">{metrics.wins}</td>
                      <td className="px-4 py-3 text-right">{metrics.podiums}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-right font-semibold">
                        {value(metrics.points_per_race)}
                      </td>
                      <td className="px-4 py-3 text-right">{value(metrics.bag_point_rate, "%")}</td>
                      <td className="px-4 py-3 text-right">
                        {value(metrics.zero_point_rate, "%")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {metrics.counterpart_races > 0
                          ? value(metrics.opponent_point_differential)
                          : "-"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TeamTrackTable({ rows }: { rows: LegacyTeamTrackRow[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-4 text-center text-2xl font-bold">Top Team Tracks</h2>
      <div className="overflow-x-auto rounded-lg border border-white/10 shadow-lg">
        <table className="min-w-full bg-black/70 text-sm tabular-nums backdrop-blur-sm">
          <thead className="bg-black/90">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">
                Track
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Average team score
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Races
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.track}
                className={`${index % 2 === 0 ? "bg-black/50" : "bg-black/70"} transition-colors hover:bg-blue-950/40`}
              >
                <td className="px-4 py-3 font-semibold text-blue-200">{row.track}</td>
                <td className="px-4 py-3 text-right">{value(row.average)}</td>
                <td className="px-4 py-3 text-right">{row.races}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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

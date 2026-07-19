import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import React from "react";
import { fetchJson } from "../api";
import {
  type LegacyTrackPlayerRow,
  type LegacyTrackTeamRow,
  type PlayerRoleMode,
} from "../dashboardApi";
import { useSeasonDivision } from "../hooks/useSeasonDivision";
import { RoleModeToggle } from "./RoleModeToggle";
import { LegacyStatHeader } from "./LegacyStatHeader";
import SeasonDivisionSelector from "./SeasonDivisionSelector";

function value(valueToFormat: number | null, suffix = ""): string {
  return valueToFormat === null ? "-" : `${valueToFormat}${suffix}`;
}

export default function TopTracks(): React.JSX.Element {
  const {
    seasons, divisions, season, division, loadingScope, scopeError, setSeason, setDivision,
  } = useSeasonDivision();
  const [searchParams, setSearchParams] = useSearchParams();
  const role: PlayerRoleMode = searchParams.get("role") === "bagger" ? "bagger" : "runner";
  const [tracks, setTracks] = useState<string[]>([]);
  const [selectedTrack, setSelectedTrack] = useState("");
  const [playerResult, setPlayerResult] = useState<{ key: string; rows: LegacyTrackPlayerRow[] } | null>(null);
  const [teamResult, setTeamResult] = useState<{ key: string; rows: LegacyTrackTeamRow[] } | null>(null);
  const [minRaces, setMinRaces] = useState(2);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [playersError, setPlayersError] = useState("");
  const [teamsError, setTeamsError] = useState("");
  const playerKey = JSON.stringify([selectedTrack, season, division, minRaces, role]);
  const teamKey = JSON.stringify([selectedTrack, season, division, minRaces]);
  const topPlayers = playerResult?.key === playerKey ? playerResult.rows : [];
  const topTeams = teamResult?.key === teamKey ? teamResult.rows : [];

  useEffect(() => {
    let cancelled = false;
    if (!season || !division) {
      setTracks([]);
      setSelectedTrack("");
      setPlayerResult(null);
      setTeamResult(null);
      setPlayersLoading(false);
      setTeamsLoading(false);
      setPlayersError("");
      setTeamsError("");
      return;
    }
    setTracks([]);
    setSelectedTrack("");
    setPlayerResult(null);
    setTeamResult(null);
    setPlayersLoading(false);
    setTeamsLoading(false);
    setPlayersError("");
    setTeamsError("");
    fetchJson<string[]>("/api/tracks", { season, division })
      .then((data) => {
        if (cancelled) return;
        setTracks(data);
        setSelectedTrack(data[0] ?? "");
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setPlayersError(requestError instanceof Error ? requestError.message : "Failed to load tracks.");
      });
    return () => { cancelled = true; };
  }, [season, division]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTrack || !season || !division) {
      setPlayersLoading(false);
      setPlayersError("");
      return;
    }
    setPlayersLoading(true);
    setPlayersError("");
    fetchJson<LegacyTrackPlayerRow[]>("/api/top-tracks", {
      track: selectedTrack, min_races: minRaces, season, division, role,
    })
      .then((rows) => { if (!cancelled) setPlayerResult({ key: playerKey, rows }); })
      .catch((requestError: unknown) => {
        if (!cancelled) setPlayersError(requestError instanceof Error ? requestError.message : "Failed to load player rankings.");
      })
      .finally(() => { if (!cancelled) setPlayersLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTrack, season, division, minRaces, role, playerKey]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTrack || !season || !division) {
      setTeamsLoading(false);
      setTeamsError("");
      return;
    }
    setTeamsLoading(true);
    setTeamsError("");
    fetchJson<LegacyTrackTeamRow[]>("/api/top-teams-on-track", {
      track: selectedTrack, min_races: minRaces, season, division,
    })
      .then((rows) => { if (!cancelled) setTeamResult({ key: teamKey, rows }); })
      .catch((requestError: unknown) => {
        if (!cancelled) setTeamsError(requestError instanceof Error ? requestError.message : "Failed to load team rankings.");
      })
      .finally(() => { if (!cancelled) setTeamsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTrack, season, division, minRaces, teamKey]);

  function updateRole(nextRole: PlayerRoleMode) {
    const next = new URLSearchParams(searchParams);
    if (nextRole === "runner") next.delete("role");
    else next.set("role", nextRole);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="relative min-h-screen p-6 font-sans text-white">
      <LegacyStatHeader title="Track Averages" />

      <div className="mx-auto max-w-7xl pt-24">
        <div className="mb-8 rounded-xl border border-white/15 bg-black/45 p-5 shadow-lg backdrop-blur-sm">
          <p className="mb-4 text-sm text-gray-300">Compare player and team performance on a selected track.</p>
          <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-2 lg:grid-cols-5">
            <SeasonDivisionSelector
              season={season} division={division} seasons={seasons} divisions={divisions}
              disabled={loadingScope} onSeasonChange={setSeason} onDivisionChange={setDivision}
              className="md:col-span-2"
            />
            <div>
              <label className="mb-2 block text-sm font-semibold">Track</label>
              <select value={selectedTrack} onChange={(event) => setSelectedTrack(event.target.value)}
                disabled={!division || tracks.length === 0}
                className="w-full rounded border border-gray-600 bg-white p-2 text-black hover:border-gray-400 focus:border-blue-400 focus:outline-none">
                <option value="">Select a track</option>
                {tracks.map((track) => <option key={track} value={track}>{track}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold">Min races</label>
              <input type="number" min="1" value={minRaces}
                onChange={(event) => setMinRaces(Math.max(1, Number(event.target.value) || 1))}
                className="w-full rounded border border-gray-600 bg-white p-2 text-black hover:border-gray-400 focus:border-blue-400 focus:outline-none" />
            </div>
            <RoleModeToggle value={role} onChange={updateRole} disabled={playersLoading} />
          </div>
        </div>

        {role === "bagger" && <BaggerDisclosure />}

        {(scopeError || playersError || teamsError) && (
          <div className="mb-6 rounded border border-red-600 bg-red-900/50 p-4 text-red-200">
            {scopeError || playersError || teamsError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section>
            <h2 className="mb-4 text-center text-2xl font-bold">Top {role === "runner" ? "Runners" : "Baggers"}</h2>
            {playersLoading ? <p className="py-8 text-center text-gray-300">Loading player rankings...</p> : (
              topPlayers.length > 0 ? <PlayerRankingTable rows={topPlayers} role={role} season={season} division={division} />
                : selectedTrack && !playersError ? <p className="py-8 text-center text-gray-300">No qualifying {role} results.</p> : null
            )}
          </section>
          <section>
            <h2 className="mb-4 text-center text-2xl font-bold">Top Teams</h2>
            {teamsLoading ? <p className="py-8 text-center text-gray-300">Loading team rankings...</p> : (
              topTeams.length > 0 ? <TeamRankingTable rows={topTeams} />
                : selectedTrack && !teamsError ? <p className="py-8 text-center text-gray-300">No qualifying team results.</p> : null
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function PlayerRankingTable({ rows, role, season, division }: {
  rows: LegacyTrackPlayerRow[]; role: PlayerRoleMode; season: string; division: string;
}) {
  return <div className="overflow-x-auto rounded-lg border border-white/10 shadow-lg">
    <table className="min-w-full bg-black/70 text-sm tabular-nums backdrop-blur-sm">
      <thead className="bg-black/90"><tr>
        <th scope="col" className="px-4 py-3 text-left">Player</th>
        <th scope="col" className="px-4 py-3 text-right">Races</th>
        <th scope="col" className="px-4 py-3 text-right">Scored</th>
        {role === "runner" ? <>
          <th scope="col" className="px-4 py-3 text-right">12-race pace</th>
          <th scope="col" className="px-4 py-3 text-right">PPR</th>
          <th scope="col" className="px-4 py-3 text-right">Avg place</th>
        </> : <>
          <th scope="col" className="px-4 py-3 text-right">Bag PPR</th>
          <th scope="col" className="px-4 py-3 text-right">Bag-point rate</th>
          <th scope="col" className="px-4 py-3 text-right">Zero-point rate</th>
          <th scope="col" className="px-4 py-3 text-right">Avg place</th>
        </>}
      </tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.player_id} className={`${index % 2 === 0 ? "bg-black/50" : "bg-black/70"} transition-colors hover:bg-blue-950/40`}>
        <td className="whitespace-nowrap px-4 py-3 font-semibold">
          <Link to={`/players/${row.player_id}?season=${season}&division=${division}&role=${role}`} className="text-blue-200 hover:text-blue-100">
            {row.name ?? `Player ${row.player_id}`}
          </Link>
        </td>
        <td className="px-4 py-3 text-right">{row.races}</td>
        <td className="px-4 py-3 text-right">{row.scored_races}</td>
        {role === "runner" ? <>
          <td className="px-4 py-3 text-right font-semibold">{value(row.twelve_race_pace)}</td>
          <td className="px-4 py-3 text-right">{value(row.points_per_race)}</td>
          <td className="px-4 py-3 text-right">{value(row.average_placement)}</td>
        </> : <>
          <td className="px-4 py-3 text-right font-semibold">{value(row.points_per_race)}</td>
          <td className="px-4 py-3 text-right">{value(row.bag_point_rate, "%")}</td>
          <td className="px-4 py-3 text-right">{value(row.zero_point_rate, "%")}</td>
          <td className="px-4 py-3 text-right">{value(row.average_placement)}</td>
        </>}
      </tr>)}</tbody>
    </table>
  </div>;
}

function TeamRankingTable({ rows }: { rows: LegacyTrackTeamRow[] }) {
  return <div className="overflow-x-auto rounded-lg border border-white/10 shadow-lg">
    <table className="min-w-full bg-black/70 text-sm tabular-nums backdrop-blur-sm">
      <thead className="bg-black/90"><tr>
        <th scope="col" className="px-4 py-3 text-left">Team</th>
        <th scope="col" className="px-4 py-3 text-right">Average</th>
        <th scope="col" className="px-4 py-3 text-right">Races</th>
      </tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.name} className={`${index % 2 === 0 ? "bg-black/50" : "bg-black/70"} transition-colors hover:bg-blue-950/40`}>
        <td className="px-4 py-3 font-semibold text-blue-200">{row.name}</td>
        <td className="px-4 py-3 text-right">{value(row.average)}</td>
        <td className="px-4 py-3 text-right">{row.races}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function BaggerDisclosure() {
  return (
    <p className="mb-5 rounded-md border border-amber-300/25 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
      Bagger statistics report scoring outcomes only. Shock acquisition is not recorded, and points do not measure overall bagging effectiveness.
    </p>
  );
}

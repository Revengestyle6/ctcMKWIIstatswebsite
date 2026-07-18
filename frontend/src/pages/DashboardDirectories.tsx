import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchPlayerDirectory,
  fetchTeamScopes,
  type PlayerDirectoryEntry,
  type TeamScope,
} from "../api";
import SeasonDivisionSelector from "../components/SeasonDivisionSelector";
import { DashboardShell } from "../components/dashboard/DashboardPrimitives";
import { useSeasonDivision } from "../hooks/useSeasonDivision";

function DirectoryTable({
  title,
  loading,
  error,
  count,
  controls,
  children,
}: {
  title: string;
  loading: boolean;
  error: string;
  count: number;
  controls: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <DashboardShell
      title={title}
      identity={<div><h2 className="text-3xl font-bold">{title}</h2><p className="mt-1 text-sm text-gray-400">{count} entries in the selected scope</p></div>}
      controls={controls}
    >
      {error && <div className="mb-5 rounded-md border border-rose-400/40 bg-rose-950/80 px-4 py-3 text-rose-100">{error}</div>}
      {loading ? <div className="h-64 animate-pulse rounded-md border border-white/10 bg-white/5" /> : children}
    </DashboardShell>
  );
}

export function PlayerDirectory() {
  const scope = useSeasonDivision();
  const [players, setPlayers] = useState<PlayerDirectoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!scope.season || !scope.division) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchPlayerDirectory(scope.season, scope.division)
      .then((data) => {
        if (!cancelled) setPlayers(data);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Failed to load players.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope.season, scope.division]);

  const filtered = players.filter((player) =>
    player.name.toLowerCase().includes(query.toLowerCase())
    || (player.primary_friend_code ?? "").includes(query)
    || player.teams.some((team) => team.tag.toLowerCase().includes(query.toLowerCase()))
  );
  const controls = <div className="flex flex-col gap-3 md:flex-row md:items-end"><SeasonDivisionSelector season={scope.season} division={scope.division} seasons={scope.seasons} divisions={scope.divisions} disabled={scope.loadingScope} onSeasonChange={scope.setSeason} onDivisionChange={scope.setDivision} /><label className="flex flex-1 flex-col gap-1 text-sm font-semibold text-gray-300">Search<input className="min-h-10 rounded-md border border-white/20 bg-zinc-950 px-3 text-white" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>;

  return (
    <DirectoryTable title="Player Directory" loading={loading} error={scope.scopeError || error} count={filtered.length} controls={controls}>
      <section className="overflow-hidden rounded-md border border-white/10 bg-black/70">
        {filtered.length === 0 ? <p className="p-8 text-center text-gray-400">No players found.</p> : <div className="overflow-x-auto"><table className="min-w-[640px] w-full text-sm"><thead className="bg-black/70 text-left text-gray-400"><tr><th className="px-4 py-3">Player</th><th className="px-4 py-3">Teams</th><th className="px-4 py-3">Primary friend code</th><th className="px-4 py-3 text-right">Dashboard</th></tr></thead><tbody>{filtered.map((player) => <tr key={player.player_id} className="border-t border-white/10"><td className="px-4 py-3 font-semibold">{player.name}</td><td className="px-4 py-3">{player.teams.map((team) => <Link key={team.team_id} to={`/teams/${team.team_id}?season=${scope.season}&division=${scope.division}`} className="mr-3 text-blue-300 hover:text-blue-200">{team.tag}</Link>)}</td><td className="px-4 py-3 text-gray-400">{player.primary_friend_code ?? "-"}</td><td className="px-4 py-3 text-right"><Link to={`/players/${player.player_id}?season=${scope.season}&division=${scope.division}`} className="font-semibold text-blue-300 hover:text-blue-200">Open &rarr;</Link></td></tr>)}</tbody></table></div>}
      </section>
    </DirectoryTable>
  );
}

export function TeamDirectory() {
  const scope = useSeasonDivision();
  const [allTeams, setAllTeams] = useState<TeamScope[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchTeamScopes()
      .then(setAllTeams)
      .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : "Failed to load teams."))
      .finally(() => setLoading(false));
  }, []);

  const teams = useMemo(() => allTeams.filter((team) =>
    team.season === scope.season
    && team.division === scope.division
    && (team.clan_tag.toLowerCase().includes(query.toLowerCase()) || team.display_name.toLowerCase().includes(query.toLowerCase()))
  ), [allTeams, scope.season, scope.division, query]);
  const controls = <div className="flex flex-col gap-3 md:flex-row md:items-end"><SeasonDivisionSelector season={scope.season} division={scope.division} seasons={scope.seasons} divisions={scope.divisions} disabled={scope.loadingScope} onSeasonChange={scope.setSeason} onDivisionChange={scope.setDivision} /><label className="flex flex-1 flex-col gap-1 text-sm font-semibold text-gray-300">Search<input className="min-h-10 rounded-md border border-white/20 bg-zinc-950 px-3 text-white" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>;

  return (
    <DirectoryTable title="Team Directory" loading={loading} error={scope.scopeError || error} count={teams.length} controls={controls}>
      <section className="overflow-hidden rounded-md border border-white/10 bg-black/70">
        {teams.length === 0 ? <p className="p-8 text-center text-gray-400">No teams found.</p> : <div className="overflow-x-auto"><table className="min-w-[560px] w-full text-sm"><thead className="bg-black/70 text-left text-gray-400"><tr><th className="px-4 py-3">Tag</th><th className="px-4 py-3">Team</th><th className="px-4 py-3 text-right">Dashboard</th></tr></thead><tbody>{teams.map((team) => <tr key={team.team_id} className="border-t border-white/10"><td className="px-4 py-3 text-xl font-bold text-blue-300">{team.clan_tag}</td><td className="px-4 py-3 font-semibold">{team.display_name}</td><td className="px-4 py-3 text-right"><Link to={`/teams/${team.team_id}?season=${scope.season}&division=${scope.division}`} className="font-semibold text-blue-300 hover:text-blue-200">Open &rarr;</Link></td></tr>)}</tbody></table></div>}
      </section>
    </DirectoryTable>
  );
}

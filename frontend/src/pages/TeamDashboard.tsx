import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { fetchTeamScopes } from "../api";
import {
  fetchTeamOverview,
  fetchTeamRoster,
  fetchTeamTracks,
  type TeamOverview,
  type TeamRoster,
  type TeamTracks,
} from "../dashboardApi";
import {
  DashboardScopeControls,
  DashboardShell,
  DashboardTabs,
  MetricGrid,
  RankingSummary,
  ResultBadge,
  TeamLogo,
  TrendRows,
  type ScopeEntityOption,
} from "../components/dashboard/DashboardPrimitives";
import { TabState, TeamRosterView, TeamTracksView } from "../components/dashboard/DashboardTabViews";

function numberValue(value: number | null, suffix = ""): string {
  return value === null ? "-" : `${value}${suffix}`;
}

function signedValue(value: number | null): string {
  if (value === null) return "-";
  return value > 0 ? `+${value}` : String(value);
}

export default function TeamDashboard() {
  const { teamId = "" } = useParams();
  const numericTeamId = Number(teamId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<TeamOverview | null>(null);
  const [opponentOptions, setOpponentOptions] = useState<ScopeEntityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [roster, setRoster] = useState<TeamRoster | null>(null);
  const [tracks, setTracks] = useState<TeamTracks | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState("");
  const season = searchParams.get("season") ?? "";
  const division = searchParams.get("division") ?? "";
  const opponentId = searchParams.get("opponent_team_id") ?? "";
  const minRaces = Math.min(500, Math.max(1, Number(searchParams.get("min_races")) || 12));
  const requestedTab = searchParams.get("tab") ?? "overview";
  const activeTab = ["overview", "roster", "tracks"].includes(requestedTab) ? requestedTab : "overview";

  useEffect(() => {
    fetchTeamScopes()
      .then((scopes) => {
        setOpponentOptions(scopes
          .filter((scope) => scope.team_id !== numericTeamId)
          .map((scope) => ({
            id: scope.team_id,
            label: `${scope.clan_tag} - ${scope.display_name}`,
            season: scope.season,
            division: scope.division,
          })));
      })
      .catch(() => setOpponentOptions([]));
  }, [numericTeamId]);

  useEffect(() => {
    if (!Number.isInteger(numericTeamId) || numericTeamId < 1) {
      setError("Team not found.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchTeamOverview(numericTeamId, {
      season: season || undefined,
      division: division || undefined,
      opponent_team_id: opponentId ? Number(opponentId) : undefined,
      min_races: minRaces,
    })
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Failed to load team dashboard.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [numericTeamId, season, division, opponentId, minRaces]);

  useEffect(() => {
    if (activeTab === "overview" || !Number.isInteger(numericTeamId) || numericTeamId < 1) return;
    let cancelled = false;
    setTabLoading(true);
    setTabError("");
    const query = {
      season: season || undefined,
      division: division || undefined,
      opponent_team_id: opponentId ? Number(opponentId) : undefined,
      min_races: minRaces,
    };
    const request = activeTab === "roster"
      ? fetchTeamRoster(numericTeamId, query)
      : fetchTeamTracks(numericTeamId, query);
    request
      .then((response) => {
        if (cancelled) return;
        if (activeTab === "roster") setRoster(response as TeamRoster);
        else setTracks(response as TeamTracks);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setTabError(requestError instanceof Error ? requestError.message : "Failed to load dashboard tab.");
      })
      .finally(() => {
        if (!cancelled) setTabLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, numericTeamId, season, division, opponentId, minRaces]);

  function updateQuery(name: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === "season") next.delete("division");
    setSearchParams(next, { replace: true });
  }

  const appearances = data?.identity.appearances ?? [];
  if (!data) {
    return (
      <DashboardShell title="Team Dashboard" identity={<div className="h-24 animate-pulse rounded-md bg-white/5" />} controls={<div className="h-16 animate-pulse rounded-md bg-white/5" />}>
        <div className="rounded-md border border-white/10 bg-black/70 p-8 text-center text-gray-300">
          {error || "Loading team dashboard..."}
        </div>
      </DashboardShell>
    );
  }

  const { identity, metrics, record } = data;
  const currentEntry = identity.current_entry;
  const metricItems = [
    { label: "Record", value: `${record.wins}-${record.losses}-${record.ties}`, detail: numberValue(metrics.win_rate, "% win rate") },
    { label: "Matches", value: String(metrics.matches), detail: `${metrics.races} races` },
    { label: "Average score", value: numberValue(metrics.average_final_score), detail: "After penalties" },
    { label: "Average diff", value: signedValue(metrics.average_differential), detail: "Per match" },
    { label: "Best win", value: signedValue(metrics.best_win), detail: "Final differential" },
    { label: "Penalties", value: String(metrics.total_penalties), detail: `${numberValue(metrics.penalties_per_match)} per match` },
  ];

  return (
    <DashboardShell
      title="Team Dashboard"
      identity={
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <TeamLogo src={identity.logo_url} alt={`${identity.name} logo`} className="h-24 w-24" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-3xl font-bold text-white">{identity.display_name}</h2>
              <span className="text-xl font-bold text-blue-300">{identity.tag}</span>
            </div>
            {currentEntry && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-300">
                <span>{currentEntry.season.toUpperCase()} {currentEntry.division.toUpperCase()}</span>
                {currentEntry.hex_color && <span className="h-4 w-4 border border-white/20" style={{ backgroundColor: currentEntry.hex_color }} title={currentEntry.hex_color} />}
                <span>{appearances.length} season/division entries</span>
              </div>
            )}
            <details className="mt-3 text-sm text-gray-300">
              <summary className="cursor-pointer font-semibold text-gray-200">Team history</summary>
              <div className="mt-2 flex flex-wrap gap-2 border-l border-white/15 pl-3">
                {appearances.map((entry) => (
                  <span key={`${entry.season}-${entry.division}`} className="border-r border-white/15 pr-2">
                    {entry.season.toUpperCase()} {entry.division.toUpperCase()}: {entry.tag}
                  </span>
                ))}
              </div>
            </details>
          </div>
        </div>
      }
      controls={
        <DashboardScopeControls
          appearances={appearances}
          season={season}
          division={division}
          entityLabel="Opponent"
          entityId={opponentId}
          entityOptions={opponentOptions}
          minRaces={minRaces}
          disabled={loading}
          onSeasonChange={(value) => updateQuery("season", value)}
          onDivisionChange={(value) => updateQuery("division", value)}
          onEntityChange={(value) => updateQuery("opponent_team_id", value)}
          onMinRacesChange={(value) => updateQuery("min_races", String(value))}
        />
      }
    >
      {error && <div className="mb-5 rounded-md border border-rose-400/40 bg-rose-950/80 px-4 py-3 text-rose-100">{error}</div>}
      <DashboardTabs
        tabs={[{ id: "overview", label: "Overview" }, { id: "roster", label: "Roster" }, { id: "tracks", label: "Tracks" }]}
        active={activeTab}
        onChange={(tab) => updateQuery("tab", tab === "overview" ? "" : tab)}
      />

      {activeTab === "overview" && <>
        <MetricGrid items={metricItems} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-md border border-white/10 bg-black/70 p-5 backdrop-blur-sm">
          <h3 className="text-lg font-bold">Match record</h3>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div><p className="text-2xl font-bold text-emerald-300">{record.wins}</p><p className="text-xs text-gray-400">Wins</p></div>
            <div><p className="text-2xl font-bold text-rose-300">{record.losses}</p><p className="text-xs text-gray-400">Losses</p></div>
            <div><p className="text-2xl font-bold text-gray-200">{record.ties}</p><p className="text-xs text-gray-400">Ties</p></div>
          </div>
          {data.ranking && (
            <div className="mt-6">
              <RankingSummary rank={data.ranking.rank} population={data.ranking.population} minimum={data.ranking.minimum_races} />
            </div>
          )}
        </section>

        <section className="rounded-md border border-white/10 bg-black/70 p-5 backdrop-blur-sm">
          <h3 className="mb-4 text-lg font-bold">Recent differential</h3>
          <TrendRows signed values={data.score_trend.map((item) => ({ id: item.match_id, label: item.label, value: item.differential }))} />
        </section>
      </div>

      <section className="mt-6 overflow-hidden rounded-md border border-white/10 bg-black/70 backdrop-blur-sm">
        <div className="border-b border-white/10 px-5 py-4">
          <h3 className="text-lg font-bold">Recent matches</h3>
        </div>
        {data.recent_matches.length === 0 ? (
          <p className="px-5 py-8 text-center text-gray-400">No matches found in this scope.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead className="bg-black/70 text-left text-gray-400">
                <tr><th className="px-4 py-3">Scope</th><th className="px-4 py-3">Match</th><th className="px-4 py-3">Opponent</th><th className="px-4 py-3 text-right">Score</th><th className="px-4 py-3 text-right">Diff</th><th className="px-4 py-3 text-center">Result</th></tr>
              </thead>
              <tbody>
                {data.recent_matches.map((match) => (
                  <tr key={match.match_id} className="border-t border-white/10">
                    <td className="px-4 py-3 text-gray-300">{match.season.toUpperCase()} {match.division.toUpperCase()} {match.week ? `W${match.week}` : ""}</td>
                    <td className="px-4 py-3"><Link to={`/matches?season=${match.season}&division=${match.division}&match=${match.match_id}`} className="font-semibold text-blue-300 hover:text-blue-200">{match.label}</Link></td>
                    <td className="px-4 py-3">{match.opponents.map((opponent) => <Link key={opponent.team_id} to={`/teams/${opponent.team_id}`} className="mr-2 hover:text-blue-200">{opponent.tag}</Link>)}</td>
                    <td className="px-4 py-3 text-right font-bold">{match.score}-{match.opponent_score ?? "-"}</td>
                    <td className={`px-4 py-3 text-right font-bold ${match.differential !== null && match.differential > 0 ? "text-emerald-300" : match.differential !== null && match.differential < 0 ? "text-rose-300" : "text-gray-300"}`}>{signedValue(match.differential)}</td>
                    <td className="px-4 py-3 text-center"><ResultBadge result={match.result} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </>}
      {activeTab !== "overview" && <TabState loading={tabLoading} error={tabError} />}
      {activeTab === "roster" && !tabLoading && !tabError && roster && <TeamRosterView data={roster} />}
      {activeTab === "tracks" && !tabLoading && !tabError && tracks && <TeamTracksView data={tracks} />}
    </DashboardShell>
  );
}

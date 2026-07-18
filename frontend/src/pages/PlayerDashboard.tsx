import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  fetchPlayerOverview,
  fetchPlayerPerformance,
  fetchPlayerTracks,
  type PlayerOverview,
  type PlayerPerformance,
  type PlayerTracks,
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
import { PlayerPerformanceView, PlayerTracksView, TabState } from "../components/dashboard/DashboardTabViews";

function numberValue(value: number | null, suffix = ""): string {
  return value === null ? "-" : `${value}${suffix}`;
}

export default function PlayerDashboard() {
  const { playerId = "" } = useParams();
  const numericPlayerId = Number(playerId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<PlayerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [performance, setPerformance] = useState<PlayerPerformance | null>(null);
  const [tracks, setTracks] = useState<PlayerTracks | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState("");
  const season = searchParams.get("season") ?? "";
  const division = searchParams.get("division") ?? "";
  const teamId = searchParams.get("team_id") ?? "";
  const minRaces = Math.min(500, Math.max(1, Number(searchParams.get("min_races")) || 12));
  const requestedTab = searchParams.get("tab") ?? "overview";
  const activeTab = ["overview", "performance", "tracks"].includes(requestedTab) ? requestedTab : "overview";

  useEffect(() => {
    if (!Number.isInteger(numericPlayerId) || numericPlayerId < 1) {
      setError("Player not found.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchPlayerOverview(numericPlayerId, {
      season: season || undefined,
      division: division || undefined,
      team_id: teamId ? Number(teamId) : undefined,
      min_races: minRaces,
    })
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Failed to load player dashboard.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [numericPlayerId, season, division, teamId, minRaces]);

  useEffect(() => {
    if (activeTab === "overview" || !Number.isInteger(numericPlayerId) || numericPlayerId < 1) return;
    let cancelled = false;
    setTabLoading(true);
    setTabError("");
    const query = {
      season: season || undefined,
      division: division || undefined,
      team_id: teamId ? Number(teamId) : undefined,
      min_races: minRaces,
    };
    const request = activeTab === "performance"
      ? fetchPlayerPerformance(numericPlayerId, query)
      : fetchPlayerTracks(numericPlayerId, query);
    request
      .then((response) => {
        if (cancelled) return;
        if (activeTab === "performance") setPerformance(response as PlayerPerformance);
        else setTracks(response as PlayerTracks);
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
  }, [activeTab, numericPlayerId, season, division, teamId, minRaces]);

  function updateQuery(name: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === "season") next.delete("division");
    setSearchParams(next, { replace: true });
  }

  const teamOptions = useMemo<ScopeEntityOption[]>(() => (
    data?.identity.appearances.map((entry) => ({
      id: entry.team_id,
      label: `${entry.team_tag} - ${entry.team_name}`,
      season: entry.season,
      division: entry.division,
    })) ?? []
  ), [data]);

  if (!data) {
    return (
      <DashboardShell title="Player Dashboard" identity={<div className="h-24 animate-pulse rounded-md bg-white/5" />} controls={<div className="h-16 animate-pulse rounded-md bg-white/5" />}>
        <div className="rounded-md border border-white/10 bg-black/70 p-8 text-center text-gray-300">
          {error || "Loading player dashboard..."}
        </div>
      </DashboardShell>
    );
  }

  const { identity, metrics, record } = data;
  const currentTeam = identity.current_team;
  const metricItems = [
    { label: "12-race pace", value: numberValue(metrics.twelve_race_pace), detail: metrics.excluded_score_rows ? `${metrics.excluded_score_rows} invalid score rows excluded` : `${numberValue(metrics.points_per_race)} points per race` },
    { label: "Races", value: String(metrics.races), detail: `${metrics.matches} matches` },
    { label: "Race wins", value: String(metrics.race_wins), detail: `${metrics.podiums} podiums` },
    { label: "Top-three rate", value: numberValue(metrics.top_three_rate, "%"), detail: "Placed races" },
    { label: "Best match", value: numberValue(metrics.best_match_score), detail: "Player points" },
    { label: "Best GP", value: numberValue(metrics.best_gp_score), detail: "Complete 4-race GP" },
  ];

  return (
    <DashboardShell
      title="Player Dashboard"
      identity={
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {currentTeam ? (
            <TeamLogo src={currentTeam.logo_url} alt={`${currentTeam.name} logo`} />
          ) : (
            <TeamLogo src="/images/team-logos/placeholder.webp" alt="Team logo unavailable" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-3xl font-bold text-white">{identity.name}</h2>
              {identity.flag && <span className="text-sm font-semibold text-gray-400">{identity.flag.toUpperCase()}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-300">
              {currentTeam && (
                <Link to={`/teams/${currentTeam.team_id}`} className="font-semibold text-blue-300 hover:text-blue-200">
                  {currentTeam.tag} - {currentTeam.name}
                </Link>
              )}
              <span>{metrics.seasons} seasons</span>
              <span>{metrics.teams} teams</span>
            </div>
            <details className="mt-3 text-sm text-gray-300">
              <summary className="cursor-pointer font-semibold text-gray-200">Identity history</summary>
              <div className="mt-2 grid gap-2 border-l border-white/15 pl-3 md:grid-cols-2">
                <p><span className="text-gray-500">Friend codes:</span> {identity.friend_codes.join(", ") || "None recorded"}</p>
                <p><span className="text-gray-500">Mii names:</span> {(identity.aliases.mii_name ?? []).join(", ") || "None recorded"}</p>
                <p><span className="text-gray-500">Table names:</span> {(identity.aliases.table_name ?? []).join(", ") || "None recorded"}</p>
                <p><span className="text-gray-500">Lounge names:</span> {(identity.aliases.lounge_name ?? []).join(", ") || "None recorded"}</p>
              </div>
            </details>
          </div>
        </div>
      }
      controls={
        <DashboardScopeControls
          appearances={identity.appearances}
          season={season}
          division={division}
          entityLabel="Team"
          entityId={teamId}
          entityOptions={teamOptions}
          minRaces={minRaces}
          disabled={loading}
          onSeasonChange={(value) => updateQuery("season", value)}
          onDivisionChange={(value) => updateQuery("division", value)}
          onEntityChange={(value) => updateQuery("team_id", value)}
          onMinRacesChange={(value) => updateQuery("min_races", String(value))}
        />
      }
    >
      {error && <div className="mb-5 rounded-md border border-rose-400/40 bg-rose-950/80 px-4 py-3 text-rose-100">{error}</div>}
      <DashboardTabs
        tabs={[{ id: "overview", label: "Overview" }, { id: "performance", label: "Performance" }, { id: "tracks", label: "Tracks" }]}
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
          <h3 className="mb-4 text-lg font-bold">Recent scoring</h3>
          <TrendRows values={data.score_trend.map((item) => ({ id: item.match_id, label: item.label, value: item.score }))} />
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
                <tr><th className="px-4 py-3">Scope</th><th className="px-4 py-3">Match</th><th className="px-4 py-3">Team</th><th className="px-4 py-3">Opponent</th><th className="px-4 py-3 text-right">Score</th><th className="px-4 py-3 text-center">Result</th></tr>
              </thead>
              <tbody>
                {data.recent_matches.map((match) => (
                  <tr key={match.match_id} className="border-t border-white/10">
                    <td className="px-4 py-3 text-gray-300">{match.season.toUpperCase()} {match.division.toUpperCase()} {match.week ? `W${match.week}` : ""}</td>
                    <td className="px-4 py-3"><Link to={`/matches?season=${match.season}&division=${match.division}&match=${match.match_id}`} className="font-semibold text-blue-300 hover:text-blue-200">{match.label}</Link></td>
                    <td className="px-4 py-3"><Link to={`/teams/${match.team.team_id}`} className="hover:text-blue-200">{match.team.tag}</Link></td>
                    <td className="px-4 py-3">{match.opponents.map((opponent) => <Link key={opponent.team_id} to={`/teams/${opponent.team_id}`} className="mr-2 hover:text-blue-200">{opponent.tag}</Link>)}</td>
                    <td className="px-4 py-3 text-right font-bold">{match.player_score}</td>
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
      {activeTab === "performance" && !tabLoading && !tabError && performance && <PlayerPerformanceView data={performance} />}
      {activeTab === "tracks" && !tabLoading && !tabError && tracks && <PlayerTracksView data={tracks} />}
    </DashboardShell>
  );
}

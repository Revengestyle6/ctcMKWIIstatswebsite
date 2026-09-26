import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchTeamScopes, searchTracks, type TeamScope, type TrackOption } from "../api";
import {
  type CsvColumn,
  csvFilename,
  downloadCsv,
  TablePaginationControls,
  usePaginatedRows,
} from "../components/analytics/TablePagination";
import {
  DashboardEntityNavigator,
  DashboardShell,
  MetricGrid,
} from "../components/dashboard/DashboardPrimitives";
import { useLeague } from "../context/LeagueContext";
import { matchHistoryPath } from "../features/match-history/matchHistoryLinks";
import { useSeasonDivision } from "../hooks/useSeasonDivision";
import {
  fetchTrackDashboard,
  type TeamTrackPerformance,
  type TrackDashboardResponse,
  type TrackMarginBucket,
  type TrackPlayerPerformance,
} from "../trackAnalyticsApi";

const panel = "rounded-lg border border-white/10 bg-black/75 p-4 shadow-lg backdrop-blur-sm sm:p-5";
const selectClass =
  "min-h-11 rounded-md border border-white/20 bg-zinc-950 px-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-400";

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function MarginHistogram({ rows, split }: { rows: TrackMarginBucket[]; split: boolean }) {
  let max = 1;
  for (const row of rows) max = Math.max(max, row.count);
  const midpoint = Math.ceil(max / 2);
  const barColor = (outcome: TrackMarginBucket["outcome"]) => {
    if (outcome === "loss") return "bg-rose-500/85";
    if (outcome === "win") return "bg-emerald-500/85";
    if (outcome === "draw") return "bg-gray-400/80";
    return "bg-blue-500/80";
  };

  return (
    <div className="mt-5 overflow-x-auto pb-1">
      <div className={split ? "min-w-[520px]" : "min-w-[360px]"}>
        <div className="grid grid-cols-[24px_30px_minmax(0,1fr)] gap-x-2">
          <div
            className="flex h-48 items-center justify-center text-[10px] font-bold uppercase tracking-[.16em] text-gray-400"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Races
          </div>
          <div className="relative h-48 text-[10px] tabular-nums text-gray-500" aria-hidden="true">
            <span className="absolute right-0 top-0 -translate-y-1/2">{max}</span>
            {midpoint < max && (
              <span className="absolute right-0 top-1/2 -translate-y-1/2">{midpoint}</span>
            )}
            <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
          </div>
          <div
            className="relative h-48 border-b border-l border-white/25"
            role="img"
            aria-label={
              split
                ? "Selected team race margin histogram. Red bars are losses and green bars are wins."
                : "Race margin histogram"
            }
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-white/10" />
            <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-white/10" />
            {split && (
              <span
                className="pointer-events-none absolute inset-y-0 left-1/2 z-20 border-l-2 border-dotted border-white/70"
                title="Zero team margin"
              />
            )}
            <div
              className="absolute inset-0 grid items-end gap-2 px-2"
              style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}
            >
              {rows.map((row) => (
                <div key={row.label} className="flex h-full flex-col items-center justify-end">
                  <strong className="mb-1 text-[11px] tabular-nums text-white">
                    {row.count || ""}
                  </strong>
                  <span
                    title={`${row.label}: ${row.count} races`}
                    className={`w-full rounded-t ${barColor(row.outcome)}`}
                    style={{
                      height: row.count ? `${Math.max(7, (85 * row.count) / max)}%` : "0%",
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div
            className="col-start-3 mt-2 grid gap-2 px-2 text-center text-[10px] leading-tight text-gray-400"
            style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}
          >
            {rows.map((row) => (
              <span key={row.label}>{row.label}</span>
            ))}
          </div>
        </div>
        <p className="ml-[62px] mt-2 text-center text-xs font-semibold text-gray-400">
          {split ? "Team race margin (loss ← 0 → win)" : "Race margin (points)"}
        </p>
        {split && (
          <div className="ml-[62px] mt-2 flex justify-center gap-4 text-xs text-gray-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-rose-500/85" /> Loss
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-gray-400/80" /> Draw
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/85" /> Win
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TrackDashboard() {
  const { trackId = "" } = useParams();
  const numericTrackId = Number(trackId);
  const { league, leaguePath, config } = useLeague();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { seasons, divisions, season, division, setSeason, setDivision, loadingScope, scopeError } =
    useSeasonDivision({
      initialSeason: params.get("season") ?? "",
      initialDivision: params.get("division") ?? "",
      allowAllSeasons: true,
      allowAllDivisions: true,
    });
  const [teamId, setTeamId] = useState(params.get("team_id") ?? "");
  const [teamScopes, setTeamScopes] = useState<TeamScope[]>([]);
  const [teamScopesLoaded, setTeamScopesLoaded] = useState(false);
  const [trackChoices, setTrackChoices] = useState<TrackOption[]>([]);
  const [trackChoicesLoading, setTrackChoicesLoading] = useState(true);
  const [data, setData] = useState<TrackDashboardResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [minPlays, setMinPlays] = useState(() =>
    Math.min(500, Math.max(1, Number(params.get("min_races")) || 2))
  );

  useEffect(() => {
    fetchTeamScopes()
      .then(setTeamScopes)
      .catch(() => setTeamScopes([]))
      .finally(() => setTeamScopesLoaded(true));
  }, []);
  useEffect(() => {
    let cancelled = false;
    setTrackChoicesLoading(true);
    searchTracks(league)
      .then((tracks) => {
        if (!cancelled) setTrackChoices(tracks.filter((track) => track.league === league));
      })
      .catch(() => {
        if (!cancelled) setTrackChoices([]);
      })
      .finally(() => {
        if (!cancelled) setTrackChoicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [league]);
  const teams = useMemo(
    () =>
      teamScopes.filter(
        (team) => team.league === league && team.season === season && team.division === division
      ),
    [teamScopes, league, season, division]
  );
  useEffect(() => {
    if (teamScopesLoaded && teamId && !teams.some((team) => String(team.team_id) === teamId))
      setTeamId("");
  }, [teamScopesLoaded, teams, teamId]);
  useEffect(() => {
    if (loadingScope || !Number.isInteger(numericTrackId)) return;
    const next = new URLSearchParams({
      league,
      season: season || "all",
      division: season ? division || "all" : "all",
    });
    if (teamId) next.set("team_id", teamId);
    next.set("min_races", String(minPlays));
    setParams(next, { replace: true });
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchTrackDashboard(numericTrackId, {
      league,
      season,
      division,
      team_id: teamId ? Number(teamId) : undefined,
      min_races: minPlays,
    })
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setData(null);
          setError(reason instanceof Error ? reason.message : "Failed to load this track.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [numericTrackId, league, season, division, teamId, minPlays, loadingScope, setParams]);

  const controls = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-sm font-semibold text-gray-300">
        Season
        <select
          className={selectClass}
          value={season}
          disabled={loadingScope}
          onChange={(event) => {
            setSeason(event.target.value);
            setTeamId("");
          }}
        >
          <option value="">All seasons</option>
          {seasons.map((item) => (
            <option key={item.season} value={item.season}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold text-gray-300">
        Division
        <select
          className={selectClass}
          value={division}
          disabled={!season || loadingScope}
          onChange={(event) => {
            setDivision(event.target.value);
            setTeamId("");
          }}
        >
          <option value="">All divisions</option>
          {divisions.map((item) => (
            <option key={item.division} value={item.division}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold text-gray-300">
        Team
        <select
          className={selectClass}
          value={teamId}
          disabled={!season || !division}
          onChange={(event) => setTeamId(event.target.value)}
        >
          <option value="">All teams</option>
          {teams.map((team) => (
            <option key={team.team_id} value={team.team_id}>
              {team.clan_tag} — {team.display_name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold text-gray-300">
        Minimum plays
        <input
          className={`${selectClass} w-full text-center`}
          type="number"
          min={1}
          max={500}
          value={minPlays}
          onChange={(event) =>
            setMinPlays(Math.min(500, Math.max(1, Number(event.target.value) || 1)))
          }
        />
      </label>
    </div>
  );
  const comparisonQuery = new URLSearchParams({
    season: season || "all",
    division: season ? division || "all" : "all",
  });
  if (teamId) comparisonQuery.set("team_id", teamId);
  comparisonQuery.set("min_races", String(minPlays));
  const navigatorScope = [config.shortName, season.toUpperCase(), division.toUpperCase()]
    .filter(Boolean)
    .join(" · ");
  const metrics = data?.metrics;
  const maxTiming = Math.max(1, ...(metrics?.timing_counts ?? []));
  const paginationKey = `${numericTrackId}:${league}:${season}:${division}:${teamId}:${minPlays}`;
  const playerRows = data?.players ?? [];
  const teamRows = data?.teams ?? [];
  const playerPager = usePaginatedRows(playerRows, paginationKey);
  const teamPager = usePaginatedRows(teamRows, paginationKey);
  const exportScope = [
    data?.track.track_name ?? `track-${numericTrackId}`,
    league,
    season || "all-seasons",
    division || "all-divisions",
  ];

  const exportPlayers = () => {
    const columns: CsvColumn<TrackPlayerPerformance>[] = [
      { header: "Rank", value: (_row, index) => index + 1 },
      { header: "Player", value: (row) => row.name },
      { header: "Average score", value: (row) => row.average_score },
      { header: "Plays", value: (row) => row.races },
      { header: "Team wins", value: (row) => row.team_wins },
      { header: "Average team margin", value: (row) => row.average_team_margin },
    ];
    downloadCsv(csvFilename(...exportScope, "player-leaderboard"), columns, playerRows);
  };

  const exportTeams = () => {
    const columns: CsvColumn<TeamTrackPerformance>[] = [
      { header: "Rank", value: (_row, index) => index + 1 },
      { header: "Team tag", value: (row) => row.team_tag },
      { header: "Team name", value: (row) => row.team_name },
      { header: "Races", value: (row) => row.races },
      { header: "Average score", value: (row) => row.average_score },
      { header: "Average margin", value: (row) => row.average_margin },
      { header: "Win rate (%)", value: (row) => row.win_rate },
      { header: "Lift", value: (row) => row.lift },
      { header: "Sample", value: (row) => row.sample_status },
    ];
    downloadCsv(csvFilename(...exportScope, "team-performance"), columns, teamRows);
  };

  return (
    <DashboardShell
      title={data?.track.track_name ?? "Track Dashboard"}
      identity={
        <div>
          <Link
            to={leaguePath(`/tracks?${comparisonQuery}`)}
            className="text-sm font-semibold text-blue-300 hover:text-blue-100"
          >
            ← All track analytics
          </Link>
          <h2 className="mt-2 text-2xl font-bold">
            {data?.track.track_name ?? "Track performance"}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">
            How this track plays, when it appears, and which teams consistently outperform their own
            baseline.
          </p>
          {data?.track.aliases.length ? (
            <p className="mt-2 text-xs text-gray-500">Known as: {data.track.aliases.join(", ")}</p>
          ) : null}
        </div>
      }
      navigator={
        <DashboardEntityNavigator
          entityLabel="Track"
          currentId={numericTrackId}
          options={trackChoices.map((track) => ({
            id: track.track_id,
            label: track.name,
            searchText: track.aliases.join(" "),
          }))}
          scopeLabel={navigatorScope}
          loading={trackChoicesLoading}
          onNavigate={(id) => navigate(leaguePath(`/tracks/${id}?${params.toString()}`))}
        />
      }
      controls={controls}
    >
      {(scopeError || error) && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-rose-400/40 bg-rose-950/80 p-4 text-rose-100"
        >
          {scopeError || error}
        </div>
      )}
      {loading && !data ? (
        <div className={`${panel} text-center text-gray-300`}>Analyzing this track…</div>
      ) : (
        data &&
        metrics && (
          <div className={`space-y-5 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            <MetricGrid
              items={[
                {
                  label: "Times played",
                  value: String(metrics.appearances),
                  detail: "Regular season",
                },
                { label: "Teams represented", value: String(metrics.unique_teams) },
                {
                  label: "Average race #",
                  value: metrics.average_race_number?.toFixed(1) ?? "—",
                  detail: "1 = opener, 12 = closer",
                },
                {
                  label: "Average margin",
                  value: metrics.average_margin?.toFixed(1) ?? "—",
                  detail: "Team points",
                },
                {
                  label: "Even races",
                  value: metrics.even_race_rate == null ? "—" : `${metrics.even_race_rate}%`,
                  detail: `Margin ≤ ${data.definitions.even_margin}`,
                },
                {
                  label: "High-swing races",
                  value: metrics.blowout_rate == null ? "—" : `${metrics.blowout_rate}%`,
                  detail: `Margin ≥ ${data.definitions.blowout_margin}`,
                },
              ]}
            />
            <div className="grid gap-5 lg:grid-cols-2">
              <section className={panel}>
                <h2 className="text-lg font-bold">Race-slot distribution</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Exactly where the track appeared within 12-race wars.
                </p>
                <div className="mt-5 grid grid-cols-12 items-end gap-1.5" style={{ height: 190 }}>
                  {metrics.timing_counts.map((count, index) => (
                    <div
                      key={index}
                      className="flex h-full flex-col items-center justify-end gap-2"
                    >
                      <span className="text-xs font-bold">{count || ""}</span>
                      <span
                        className="w-full rounded-t bg-blue-500/80"
                        style={{ height: `${Math.max(count ? 8 : 2, (100 * count) / maxTiming)}%` }}
                      />
                      <span className="text-xs text-gray-400">{index + 1}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className={panel}>
                <h2 className="text-lg font-bold">Race margin distribution</h2>
                <p className="mt-1 text-sm text-gray-400">
                  {teamId
                    ? "Signed margins for the selected team, split into losses, draws, and wins."
                    : "See whether the average is typical or driven by a few extreme races."}
                </p>
                <MarginHistogram rows={data.margin_buckets} split={Boolean(teamId)} />
              </section>
            </div>
            <section className={panel}>
              <h2 className="text-lg font-bold">Player leaderboard</h2>
              <p className="mt-1 text-sm text-gray-400">
                Ranked by average individual score. Team margin is the signed average race margin
                while that player was in the lineup. Players shown have at least {minPlays} plays.
              </p>
              <div className="mt-4">
                <TablePaginationControls
                  label="player leaderboard"
                  total={playerRows.length}
                  page={playerPager.page}
                  pageCount={playerPager.pageCount}
                  firstIndex={playerPager.firstIndex}
                  onPageChange={playerPager.setPage}
                  onExport={exportPlayers}
                />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm tabular-nums">
                  <thead className="border-y border-white/15 bg-white/5 text-xs uppercase text-gray-300">
                    <tr>
                      <th className="w-12 px-3 py-3 text-right">#</th>
                      <th className="px-3 py-3 text-left">Player</th>
                      <th className="px-3 py-3 text-center">Avg score</th>
                      <th className="px-3 py-3 text-center">Plays</th>
                      <th className="px-3 py-3 text-center">Team wins</th>
                      <th className="px-3 py-3 text-center">Avg team margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {playerPager.rows.map((row, index) => {
                      const playerQuery = new URLSearchParams();
                      if (season) playerQuery.set("season", season);
                      if (division) playerQuery.set("division", division);
                      return (
                        <tr key={row.player_id}>
                          <td className="px-3 py-3 text-right text-gray-500">
                            {playerPager.firstIndex + index + 1}
                          </td>
                          <td className="px-3 py-3 font-semibold">
                            <Link
                              to={leaguePath(
                                `/players/${row.player_id}${playerQuery.size ? `?${playerQuery}` : ""}`
                              )}
                              className="text-blue-200 hover:text-blue-100 hover:underline"
                            >
                              {row.name}
                            </Link>
                          </td>
                          <td className="px-3 py-3 text-center font-bold">
                            {row.average_score?.toFixed(1) ?? "—"}
                          </td>
                          <td className="px-3 py-3 text-center">{row.races}</td>
                          <td className="px-3 py-3 text-center">{row.team_wins}</td>
                          <td
                            className={`px-3 py-3 text-center font-mono font-bold ${row.average_team_margin > 0 ? "text-emerald-300" : row.average_team_margin < 0 ? "text-rose-300" : "text-gray-300"}`}
                          >
                            {signed(row.average_team_margin)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!data.players.length && (
                  <p className="py-8 text-center text-gray-400">
                    No players meet the current minimum of {minPlays} plays.
                  </p>
                )}
              </div>
              <div className="mt-3">
                <TablePaginationControls
                  label="player leaderboard"
                  total={playerRows.length}
                  page={playerPager.page}
                  pageCount={playerPager.pageCount}
                  firstIndex={playerPager.firstIndex}
                  onPageChange={playerPager.setPage}
                />
              </div>
            </section>
            <section className={panel}>
              <h2 className="text-lg font-bold">Team performance</h2>
              <p className="mt-1 text-sm text-gray-400">
                Lift compares a team&apos;s margin here with its normal race margin in this filtered
                view. Teams shown have at least {minPlays} plays.
              </p>
              <div className="mt-4">
                <TablePaginationControls
                  label="team performance"
                  total={teamRows.length}
                  page={teamPager.page}
                  pageCount={teamPager.pageCount}
                  firstIndex={teamPager.firstIndex}
                  onPageChange={teamPager.setPage}
                  onExport={exportTeams}
                />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="border-y border-white/15 bg-white/5 text-xs uppercase text-gray-300">
                    <tr>
                      <th className="w-12 px-3 py-3 text-right">#</th>
                      <th className="px-3 py-3 text-left">Team</th>
                      <th className="px-3 py-3 text-center">Races</th>
                      <th className="px-3 py-3 text-center">Avg score</th>
                      <th className="px-3 py-3 text-center">Avg margin</th>
                      <th className="px-3 py-3 text-center">Win rate</th>
                      <th className="px-3 py-3 text-center">Lift</th>
                      <th className="px-3 py-3 text-center">Sample</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {teamPager.rows.map((row, index) => (
                      <tr key={row.team_id}>
                        <td className="px-3 py-3 text-right text-gray-500">
                          {teamPager.firstIndex + index + 1}
                        </td>
                        <td className="px-3 py-3 font-semibold">
                          {row.team_tag}{" "}
                          <span className="font-normal text-gray-400">{row.team_name}</span>
                        </td>
                        <td className="px-3 py-3 text-center">{row.races}</td>
                        <td className="px-3 py-3 text-center">{row.average_score}</td>
                        <td className="px-3 py-3 text-center">{signed(row.average_margin)}</td>
                        <td className="px-3 py-3 text-center">{row.win_rate}%</td>
                        <td
                          className={`px-3 py-3 text-center font-mono font-bold ${row.lift >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                        >
                          {signed(row.lift)}
                        </td>
                        <td className="px-3 py-3 text-center text-xs text-gray-400">
                          {row.sample_status === "established" ? "Established" : "Early signal"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.teams.length && (
                  <p className="py-8 text-center text-gray-400">No team results are available.</p>
                )}
              </div>
              <div className="mt-3">
                <TablePaginationControls
                  label="team performance"
                  total={teamRows.length}
                  page={teamPager.page}
                  pageCount={teamPager.pageCount}
                  firstIndex={teamPager.firstIndex}
                  onPageChange={teamPager.setPage}
                />
              </div>
            </section>
            <section className={panel}>
              <h2 className="text-lg font-bold">Recent races</h2>
              <p className="mt-1 text-sm text-gray-400">
                Open the source match to inspect the full table and race context.
              </p>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {data.recent_races.map((race) => (
                  <Link
                    key={race.race_id}
                    to={leaguePath(
                      matchHistoryPath({
                        season: race.season,
                        division: race.division,
                        matchId: race.match_id,
                      })
                    )}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border border-white/10 bg-white/5 p-3 hover:border-blue-400/50 hover:bg-white/10"
                  >
                    <div>
                      <p className="font-semibold">
                        {race.teams.map((team) => team.team_tag).join(" vs ")}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        {race.match_label} · Race {race.race_number}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-bold">
                        {race.teams.map((team) => team.score).join("–")}
                      </p>
                      <p className="text-xs text-gray-400">margin {race.margin}</p>
                    </div>
                  </Link>
                ))}
              </div>
              {!data.recent_races.length && (
                <p className="py-8 text-center text-gray-400">
                  No races are available for this scope.
                </p>
              )}
            </section>
          </div>
        )
      )}
    </DashboardShell>
  );
}

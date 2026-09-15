import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchTeamScopes, type TeamScope } from "../api";
import {
  type CsvColumn,
  csvFilename,
  downloadCsv,
  TablePaginationControls,
  usePaginatedRows,
} from "../components/analytics/TablePagination";
import { DashboardShell, MetricGrid } from "../components/dashboard/DashboardPrimitives";
import { useLeague } from "../context/LeagueContext";
import { useSeasonDivision } from "../hooks/useSeasonDivision";
import {
  fetchTrackAnalytics,
  type TeamTrackPerformance,
  type TrackAnalyticsResponse,
  type TrackAnalyticsRow,
} from "../trackAnalyticsApi";

type MetricSortKey =
  | "appearances"
  | "unique_teams"
  | "average_margin"
  | "even_race_rate"
  | "average_race_number"
  | "lift"
  | "alphabetical";
type RaceSortKey = `race_${number}`;
type SortKey = MetricSortKey | RaceSortKey;

const trackSortOptions: Array<{ label: string; teamOnly?: boolean; value: SortKey }> = [
  { value: "appearances", label: "Most played" },
  { value: "average_margin", label: "Highest average margin" },
  { value: "even_race_rate", label: "Highest even-race rate" },
  { value: "average_race_number", label: "Latest average appearance" },
  { value: "unique_teams", label: "Most unique teams" },
  { value: "lift", label: "Best team lift", teamOnly: true },
  { value: "alphabetical", label: "Track name (A–Z)" },
];
const raceSortOptions = Array.from(
  { length: 12 },
  (_, index): { label: string; value: RaceSortKey } => ({
    value: `race_${index + 1}`,
    label: `Race ${index + 1} playcount`,
  })
);

const panel = "rounded-lg border border-white/10 bg-black/75 p-4 shadow-lg backdrop-blur-sm sm:p-5";
const selectClass =
  "min-h-11 rounded-md border border-white/20 bg-zinc-950 px-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-400";

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function trackPath(
  trackId: number,
  season: string,
  division: string,
  teamId: string,
  minPlays: number
) {
  const query = new URLSearchParams({
    season: season || "all",
    division: season ? division || "all" : "all",
  });
  if (teamId) query.set("team_id", teamId);
  query.set("min_races", String(minPlays));
  return `/tracks/${trackId}?${query}`;
}

function sortTracks(rows: TrackAnalyticsRow[], sort: SortKey) {
  return [...rows].sort((a, b) => {
    if (sort === "alphabetical") return a.track_name.localeCompare(b.track_name);
    if (sort.startsWith("race_")) {
      const raceIndex = Number.parseInt(sort.slice(5), 10) - 1;
      const difference = (b.timing_counts[raceIndex] ?? 0) - (a.timing_counts[raceIndex] ?? 0);
      return difference || a.track_name.localeCompare(b.track_name);
    }
    const metricSort = sort as Exclude<MetricSortKey, "alphabetical">;
    const av = metricSort === "lift" ? (a.selected_team?.lift ?? -Infinity) : a[metricSort];
    const bv = metricSort === "lift" ? (b.selected_team?.lift ?? -Infinity) : b[metricSort];
    return bv - av || a.track_name.localeCompare(b.track_name);
  });
}

function TrackSortSelect({
  value,
  onChange,
  includeTeamLift,
  includeRaceCounts = false,
  compact = false,
}: {
  value: SortKey;
  onChange: (value: SortKey) => void;
  includeTeamLift: boolean;
  includeRaceCounts?: boolean;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "block" : "grid gap-1 text-xs font-semibold text-gray-400"}>
      <span className={compact ? "sr-only" : undefined}>Sort by</span>
      <select
        className={
          compact
            ? "h-10 rounded-md border border-white/20 bg-zinc-950 px-3 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            : `${selectClass} min-h-9 py-1`
        }
        value={value}
        onChange={(event) => onChange(event.target.value as SortKey)}
      >
        {trackSortOptions.map((option) =>
          option.teamOnly && !includeTeamLift ? null : (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          )
        )}
        {includeRaceCounts && (
          <optgroup label="Race playcount">
            {raceSortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

function StandoutList({
  title,
  rows,
  positive,
  href,
  minimum,
  resetKey,
}: {
  title: string;
  rows: TeamTrackPerformance[];
  positive: boolean;
  href: (id: number) => string;
  minimum: number;
  resetKey: string;
}) {
  const pager = usePaginatedRows(rows, resetKey, 6);

  return (
    <section className={`${panel} flex flex-col`}>
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-gray-400">
        Difference from each team&apos;s normal race margin; minimum {minimum} plays.
      </p>
      <ol className="mt-3 grid h-96 flex-none grid-rows-6 divide-y divide-white/10">
        {pager.rows.map((row) => (
          <li
            key={`${row.team_id}-${row.track_id}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2.5"
          >
            <div className="min-w-0">
              <Link
                className="block truncate font-semibold text-white hover:text-blue-300"
                to={href(row.track_id)}
              >
                {row.track_name}
              </Link>
              <p className="truncate text-sm text-gray-400">
                {row.team_tag} · {row.races} races
              </p>
            </div>
            <span
              className={`self-center font-mono text-sm font-bold ${positive ? "text-emerald-300" : "text-rose-300"}`}
            >
              {signed(row.lift)}
            </span>
          </li>
        ))}
        {!rows.length && (
          <li className="py-5 text-sm text-gray-400">
            {positive ? "No nonnegative differences in this scope." : "No negative differences."}
          </li>
        )}
      </ol>
      <nav
        className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3"
        aria-label={`${title} pages`}
      >
        <button
          type="button"
          className="min-h-9 rounded border border-white/15 bg-white/5 px-2.5 text-xs font-semibold hover:border-blue-300/60 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={pager.page === 1}
          onClick={() => pager.setPage(pager.page - 1)}
          aria-label={`Previous ${title.toLowerCase()} page`}
        >
          ← Prev
        </button>
        <span className="text-center text-xs text-gray-400">
          Page <strong className="text-white">{pager.page}</strong> of {pager.pageCount}
        </span>
        <button
          type="button"
          className="min-h-9 rounded border border-white/15 bg-white/5 px-2.5 text-xs font-semibold hover:border-blue-300/60 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={pager.page === pager.pageCount}
          onClick={() => pager.setPage(pager.page + 1)}
          aria-label={`Next ${title.toLowerCase()} page`}
        >
          Next →
        </button>
      </nav>
    </section>
  );
}

function FrequencyMarginPlot({
  tracks,
  href,
}: {
  tracks: TrackAnalyticsRow[];
  href: (id: number) => string;
}) {
  const width = 720,
    height = 260,
    left = 42,
    bottom = 28;
  const maxX = Math.max(1, ...tracks.map((row) => row.appearances));
  const maxY = Math.max(1, ...tracks.map((row) => row.average_margin));
  return (
    <section className={panel}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Frequency vs. race margin</h2>
          <p className="mt-1 text-sm text-gray-400">
            Frequent tracks move right; higher-swing tracks move up.
          </p>
        </div>
        <span className="text-xs text-gray-500">Circle size = teams represented</span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[600px]"
          role="img"
          aria-label="Track frequency plotted against average race margin"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
            <line
              key={tick}
              x1={left}
              x2={width - 12}
              y1={12 + tick * (height - bottom - 12)}
              y2={12 + tick * (height - bottom - 12)}
              stroke="rgba(255,255,255,.1)"
            />
          ))}
          <text x={left} y={height - 7} fill="#9ca3af" fontSize="11">
            less played
          </text>
          <text x={width - 72} y={height - 7} fill="#9ca3af" fontSize="11">
            more played
          </text>
          <text x="5" y="20" fill="#9ca3af" fontSize="11">
            wide
          </text>
          <text x="5" y={height - bottom} fill="#9ca3af" fontSize="11">
            even
          </text>
          {tracks.map((row) => {
            const x = left + (row.appearances / maxX) * (width - left - 20);
            const y = height - bottom - (row.average_margin / maxY) * (height - bottom - 20);
            const radius = 4 + Math.min(8, row.unique_teams * 0.7);
            return (
              <Link
                key={row.track_id}
                to={href(row.track_id)}
                aria-label={`${row.track_name}: ${row.appearances} races, ${row.average_margin} average margin`}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={radius}
                  className="fill-blue-400/70 stroke-blue-100 hover:fill-yellow-300"
                  strokeWidth="1"
                >
                  <title>
                    {row.track_name} · {row.appearances} races · {row.average_margin} avg margin
                  </title>
                </circle>
              </Link>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

export default function TrackAnalyticsPage() {
  const { league, leaguePath } = useLeague();
  const [params, setParams] = useSearchParams();
  const initialSeason = params.get("season") ?? "";
  const initialDivision = params.get("division") ?? "";
  const { seasons, divisions, season, division, setSeason, setDivision, loadingScope, scopeError } =
    useSeasonDivision({
      initialSeason,
      initialDivision,
      allowAllSeasons: true,
      allowAllDivisions: true,
    });
  const [teamId, setTeamId] = useState(params.get("team_id") ?? "");
  const [teamScopes, setTeamScopes] = useState<TeamScope[]>([]);
  const [data, setData] = useState<TrackAnalyticsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortKey>("appearances");
  const [timingSort, setTimingSort] = useState<SortKey>("appearances");
  const [minPlays, setMinPlays] = useState(() =>
    Math.min(500, Math.max(1, Number(params.get("min_races")) || 2))
  );

  useEffect(() => {
    fetchTeamScopes()
      .then(setTeamScopes)
      .catch(() => setTeamScopes([]));
  }, []);
  useEffect(() => {
    if (loadingScope) return;
    const next = new URLSearchParams({
      league,
      season: season || "all",
      division: season ? division || "all" : "all",
    });
    if (teamId) next.set("team_id", teamId);
    next.set("min_races", String(minPlays));
    setParams(next, { replace: true });
  }, [league, season, division, teamId, minPlays, loadingScope, setParams]);
  useEffect(() => {
    if (loadingScope) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchTrackAnalytics({
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
          setError(reason instanceof Error ? reason.message : "Failed to load track analytics.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [league, season, division, teamId, minPlays, loadingScope]);

  const teams = useMemo(
    () =>
      teamScopes.filter(
        (team) => team.league === league && team.season === season && team.division === division
      ),
    [teamScopes, league, season, division]
  );
  useEffect(() => {
    if (teamId && !teams.some((team) => String(team.team_id) === teamId)) setTeamId("");
  }, [teams, teamId]);
  useEffect(() => {
    if (teamId) return;
    if (sort === "lift") setSort("appearances");
    if (timingSort === "lift") setTimingSort("appearances");
  }, [teamId, sort, timingSort]);
  const rows = useMemo(() => sortTracks(data?.tracks ?? [], sort), [data, sort]);
  const timingRows = useMemo(() => sortTracks(data?.tracks ?? [], timingSort), [data, timingSort]);
  const timingScaleMax = useMemo(() => {
    let maximum = 1;
    for (const row of data?.tracks ?? []) {
      for (const count of row.timing_counts) maximum = Math.max(maximum, count);
    }
    return maximum;
  }, [data]);
  const paginationKey = `${league}:${season}:${division}:${teamId}:${minPlays}:${sort}`;
  const trackPager = usePaginatedRows(rows, paginationKey);
  const timingPager = usePaginatedRows(
    timingRows,
    `${league}:${season}:${division}:${teamId}:${minPlays}:${timingSort}`
  );
  const href = (id: number) => leaguePath(trackPath(id, season, division, teamId, minPlays));
  const summary = data?.summary;
  const exportScope = [league, season || "all-seasons", division || "all-divisions"];

  const exportTrackRankings = () => {
    const columns: CsvColumn<TrackAnalyticsRow>[] = [
      { header: "Rank", value: (_row, index) => index + 1 },
      { header: "Track", value: (row) => row.track_name },
      { header: "Played", value: (row) => row.appearances },
      { header: "Teams", value: (row) => row.unique_teams },
      { header: "Average race number", value: (row) => row.average_race_number },
      { header: "Average margin", value: (row) => row.average_margin },
      { header: "Even races (%)", value: (row) => row.even_race_rate },
    ];
    if (teamId) {
      columns.push({ header: "Team lift", value: (row) => row.selected_team?.lift });
    }
    downloadCsv(csvFilename("track-rankings", ...exportScope), columns, rows);
  };

  const exportTrackTiming = () => {
    const columns: CsvColumn<TrackAnalyticsRow>[] = [
      { header: "Rank", value: (_row, index) => index + 1 },
      { header: "Track", value: (row) => row.track_name },
      ...Array.from({ length: 12 }, (_, index) => ({
        header: `Race ${index + 1}`,
        value: (row: TrackAnalyticsRow) => row.timing_counts[index] ?? 0,
      })),
    ];
    downloadCsv(csvFilename("track-timing", ...exportScope), columns, timingRows);
  };

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

  return (
    <DashboardShell
      title="Track Analytics"
      identity={
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-300">
            Regular-season race intelligence
          </p>
          <h2 className="mt-1 text-2xl font-bold">Compare every track at a glance</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">
            Frequency, scoring margin, timing, reach, and team-specific performance—with every row
            opening a focused track dashboard.
          </p>
        </div>
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
        <div className={`${panel} text-center text-gray-300`}>Analyzing races…</div>
      ) : (
        data && (
          <div className={`space-y-5 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            <MetricGrid
              items={[
                {
                  label: "Races analyzed",
                  value: String(summary?.races ?? 0),
                  detail: "Regular season",
                },
                {
                  label: "Tracks shown",
                  value: String(summary?.tracks ?? 0),
                  detail: `At least ${minPlays} plays · ${summary?.teams ?? 0} teams`,
                },
                {
                  label: "Most played",
                  value: summary?.most_played?.track_name ?? "—",
                  detail: summary?.most_played
                    ? `${summary.most_played.appearances} races`
                    : undefined,
                },
                {
                  label: "Highest swing",
                  value: summary?.widest_average?.track_name ?? "—",
                  detail: summary?.widest_average
                    ? `${summary.widest_average.average_margin} avg margin`
                    : undefined,
                },
                {
                  label: "Most even",
                  value: summary?.closest_average?.track_name ?? "—",
                  detail: summary?.closest_average
                    ? `${summary.closest_average.average_margin} avg margin`
                    : undefined,
                },
                {
                  label: "Team filter",
                  value: data.scope.team_name ?? "All teams",
                  detail: data.scope.team_name ? "Matches involving this team" : "Division-wide",
                },
              ]}
            />
            <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-[minmax(0,1.05fr)_minmax(276px,.575fr)_minmax(276px,.575fr)]">
              <div className="md:col-span-2 xl:col-span-1">
                <FrequencyMarginPlot tracks={data.tracks} href={href} />
              </div>
              <StandoutList
                title={teamId ? "Track strengths" : "Team–track strengths"}
                rows={data.standouts.strengths}
                positive
                href={href}
                minimum={minPlays}
                resetKey={paginationKey}
              />
              <StandoutList
                title={teamId ? "Track struggles" : "Team–track struggles"}
                rows={data.standouts.struggles}
                positive={false}
                href={href}
                minimum={minPlays}
                resetKey={paginationKey}
              />
            </div>
            <section className={panel}>
              <h2 className="text-lg font-bold">All tracks</h2>
              <p className="mt-1 text-sm text-gray-400">
                Tracks meeting the selected play minimum. Select one for its full detail.
              </p>
              <div className="mt-4">
                <TablePaginationControls
                  label="track rankings"
                  total={rows.length}
                  page={trackPager.page}
                  pageCount={trackPager.pageCount}
                  firstIndex={trackPager.firstIndex}
                  onPageChange={trackPager.setPage}
                  onExport={exportTrackRankings}
                  beforeActions={
                    <TrackSortSelect
                      value={sort}
                      onChange={setSort}
                      includeTeamLift={Boolean(teamId)}
                      compact
                    />
                  }
                />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="border-y border-white/15 bg-white/5 text-xs uppercase tracking-wide text-gray-300">
                    <tr>
                      <th className="w-12 px-3 py-3 text-right">#</th>
                      <th className="px-3 py-3 text-left">Track</th>
                      <th className="px-3 py-3 text-center">Played</th>
                      <th className="px-3 py-3 text-center">Teams</th>
                      <th className="px-3 py-3 text-center">Avg race #</th>
                      <th className="px-3 py-3 text-center">Avg margin</th>
                      <th className="px-3 py-3 text-center">Even races</th>
                      {teamId && <th className="px-3 py-3 text-center">Team lift</th>}
                      <th>
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {trackPager.rows.map((row, index) => (
                      <tr key={row.track_id} className="hover:bg-white/5">
                        <td className="px-3 py-3 text-right text-gray-500">
                          {trackPager.firstIndex + index + 1}
                        </td>
                        <td className="px-3 py-3 font-semibold">
                          <Link className="hover:text-blue-300" to={href(row.track_id)}>
                            {row.track_name}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-center">{row.appearances}</td>
                        <td className="px-3 py-3 text-center">{row.unique_teams}</td>
                        <td className="px-3 py-3 text-center">{row.average_race_number}</td>
                        <td className="px-3 py-3 text-center">{row.average_margin}</td>
                        <td className="px-3 py-3 text-center">{row.even_race_rate}%</td>
                        {teamId && (
                          <td
                            className={`px-3 py-3 text-center font-mono font-bold ${(row.selected_team?.lift ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                          >
                            {row.selected_team ? signed(row.selected_team.lift) : "—"}
                          </td>
                        )}
                        <td className="px-3 text-right">
                          <Link
                            to={href(row.track_id)}
                            aria-label={`Open ${row.track_name}`}
                            className="text-blue-300 hover:text-blue-100"
                          >
                            →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && (
                  <p className="py-8 text-center text-gray-400">
                    No races are available for this scope.
                  </p>
                )}
              </div>
              <div className="mt-3">
                <TablePaginationControls
                  label="track rankings"
                  total={rows.length}
                  page={trackPager.page}
                  pageCount={trackPager.pageCount}
                  firstIndex={trackPager.firstIndex}
                  onPageChange={trackPager.setPage}
                />
              </div>
            </section>
            <section className={panel}>
              <h2 className="text-lg font-bold">When tracks appear</h2>
              <p className="mt-1 text-sm text-gray-400">
                Darker cells mean more appearances in that race slot. Equal counts use the same
                color across the chart. This reflects when a track was played; pick ownership is not
                recorded.
              </p>
              <p className="mt-1 text-xs font-semibold text-blue-200">
                Click a numbered race header to rank tracks by playcount in that race.
              </p>
              <div className="mt-4">
                <TablePaginationControls
                  label="track timing"
                  total={timingRows.length}
                  page={timingPager.page}
                  pageCount={timingPager.pageCount}
                  firstIndex={timingPager.firstIndex}
                  onPageChange={timingPager.setPage}
                  onExport={exportTrackTiming}
                  beforeActions={
                    <TrackSortSelect
                      value={timingSort}
                      onChange={setTimingSort}
                      includeTeamLift={Boolean(teamId)}
                      includeRaceCounts
                      compact
                    />
                  }
                />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead>
                    <tr>
                      <th className="w-10 pb-2 pr-2 text-right">#</th>
                      <th className="pb-2 text-left">Track</th>
                      {raceSortOptions.map((option, index) => {
                        const active = timingSort === option.value;
                        return (
                          <th
                            key={option.value}
                            scope="col"
                            aria-sort={active ? "descending" : "none"}
                            className="pb-2 text-center"
                          >
                            <button
                              type="button"
                              title={`Sort by ${option.label}`}
                              aria-label={`Sort tracks by ${option.label}`}
                              className={`mx-auto flex min-h-8 min-w-8 items-center justify-center rounded border px-1.5 font-bold transition focus:outline-none focus:ring-2 focus:ring-blue-300 ${
                                active
                                  ? "border-blue-300 bg-blue-500/30 text-blue-100"
                                  : "border-white/15 bg-white/5 text-gray-300 hover:border-blue-300/70 hover:bg-blue-500/20 hover:text-white"
                              }`}
                              onClick={() => setTimingSort(option.value)}
                            >
                              {index + 1}
                              {active && (
                                <span className="ml-0.5" aria-hidden="true">
                                  ↓
                                </span>
                              )}
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {timingPager.rows.map((row, rowIndex) => {
                      return (
                        <tr
                          key={row.track_id}
                          className="transition-colors hover:bg-blue-400/15 focus-within:bg-blue-400/15"
                        >
                          <td className="py-1.5 pr-2 text-right text-gray-500">
                            {timingPager.firstIndex + rowIndex + 1}
                          </td>
                          <th className="max-w-48 truncate py-1.5 pr-3 text-left font-medium">
                            <Link to={href(row.track_id)}>{row.track_name}</Link>
                          </th>
                          {row.timing_counts.map((count, index) => (
                            <td key={index} className="p-1">
                              <span
                                title={`${count} appearances`}
                                className="flex h-7 min-w-7 items-center justify-center rounded text-white"
                                style={{
                                  backgroundColor: `rgba(59, 130, 246, ${count ? 0.2 + (0.8 * count) / timingScaleMax : 0.05})`,
                                }}
                              >
                                {count || ""}
                              </span>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3">
                <TablePaginationControls
                  label="track timing"
                  total={timingRows.length}
                  page={timingPager.page}
                  pageCount={timingPager.pageCount}
                  firstIndex={timingPager.firstIndex}
                  onPageChange={timingPager.setPage}
                />
              </div>
            </section>
          </div>
        )
      )}
    </DashboardShell>
  );
}

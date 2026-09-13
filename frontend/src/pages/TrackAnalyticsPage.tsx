import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchTeamScopes, type TeamScope } from "../api";
import { DashboardShell, MetricGrid } from "../components/dashboard/DashboardPrimitives";
import { useLeague } from "../context/LeagueContext";
import { useSeasonDivision } from "../hooks/useSeasonDivision";
import {
  fetchTrackAnalytics,
  type TeamTrackPerformance,
  type TrackAnalyticsResponse,
  type TrackAnalyticsRow,
} from "../trackAnalyticsApi";

type SortKey =
  | "appearances"
  | "unique_teams"
  | "average_margin"
  | "even_race_rate"
  | "average_race_number"
  | "lift";

const panel = "rounded-lg border border-white/10 bg-black/75 p-4 shadow-lg backdrop-blur-sm sm:p-5";
const selectClass =
  "min-h-11 rounded-md border border-white/20 bg-zinc-950 px-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-400";

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
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

function StandoutList({
  title,
  rows,
  positive,
  href,
  minimum,
}: {
  title: string;
  rows: TeamTrackPerformance[];
  positive: boolean;
  href: (id: number) => string;
  minimum: number;
}) {
  return (
    <section className={panel}>
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-gray-400">
        Difference from each team&apos;s normal race margin; minimum {minimum} plays.
      </p>
      <ol className="mt-3 divide-y divide-white/10">
        {rows.slice(0, 6).map((row) => (
          <li
            key={`${row.team_id}-${row.track_id}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2.5"
          >
            <div className="min-w-0">
              <Link
                className="font-semibold text-white hover:text-blue-300"
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
          <li className="py-5 text-sm text-gray-400">Not enough repeat plays yet.</li>
        )}
      </ol>
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
  const rows = useMemo(
    () =>
      [...(data?.tracks ?? [])].sort((a, b) => {
        const av = sort === "lift" ? (a.selected_team?.lift ?? -Infinity) : a[sort];
        const bv = sort === "lift" ? (b.selected_team?.lift ?? -Infinity) : b[sort];
        return bv - av || a.track_name.localeCompare(b.track_name);
      }),
    [data, sort]
  );
  const href = (id: number) => leaguePath(trackPath(id, season, division, teamId, minPlays));
  const summary = data?.summary;

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
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,.8fr)]">
              <FrequencyMarginPlot tracks={data.tracks} href={href} />
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
                <StandoutList
                  title={teamId ? "Track strengths" : "Team–track strengths"}
                  rows={data.standouts.strengths}
                  positive
                  href={href}
                  minimum={minPlays}
                />
                <StandoutList
                  title={teamId ? "Track struggles" : "Team–track struggles"}
                  rows={data.standouts.struggles}
                  positive={false}
                  href={href}
                  minimum={minPlays}
                />
              </div>
            </div>
            <section className={panel}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">All tracks</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    Tracks meeting the selected play minimum. Select one for its full detail.
                  </p>
                </div>
                <label className="grid gap-1 text-xs font-semibold text-gray-400">
                  Sort by
                  <select
                    className={`${selectClass} min-h-9 py-1`}
                    value={sort}
                    onChange={(event) => setSort(event.target.value as SortKey)}
                  >
                    <option value="appearances">Most played</option>
                    <option value="average_margin">Highest average margin</option>
                    <option value="even_race_rate">Highest even-race rate</option>
                    <option value="average_race_number">Latest average appearance</option>
                    <option value="unique_teams">Most unique teams</option>
                    {teamId && <option value="lift">Best team lift</option>}
                  </select>
                </label>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="border-y border-white/15 bg-white/5 text-xs uppercase tracking-wide text-gray-300">
                    <tr>
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
                    {rows.map((row) => (
                      <tr key={row.track_id} className="hover:bg-white/5">
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
            </section>
            <section className={panel}>
              <h2 className="text-lg font-bold">When tracks appear</h2>
              <p className="mt-1 text-sm text-gray-400">
                Darker cells mean more appearances in that race slot. This reflects when a track was
                played; pick ownership is not recorded.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead>
                    <tr>
                      <th className="pb-2 text-left">Track</th>
                      {Array.from({ length: 12 }, (_, index) => (
                        <th key={index} className="pb-2 text-center">
                          {index + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 16).map((row) => {
                      const max = Math.max(1, ...row.timing_counts);
                      return (
                        <tr key={row.track_id}>
                          <th className="max-w-48 truncate py-1.5 pr-3 text-left font-medium">
                            <Link to={href(row.track_id)}>{row.track_name}</Link>
                          </th>
                          {row.timing_counts.map((count, index) => (
                            <td key={index} className="p-1">
                              <span
                                title={`${count} appearances`}
                                className="flex h-7 min-w-7 items-center justify-center rounded text-white"
                                style={{
                                  backgroundColor: `rgba(59, 130, 246, ${count ? 0.2 + (0.8 * count) / max : 0.05})`,
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
            </section>
          </div>
        )
      )}
    </DashboardShell>
  );
}

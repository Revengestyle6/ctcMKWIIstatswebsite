import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { fetchTeamScopes, type TeamScope } from "../api";
import { DashboardShell, MetricGrid } from "../components/dashboard/DashboardPrimitives";
import { useLeague } from "../context/LeagueContext";
import { useSeasonDivision } from "../hooks/useSeasonDivision";
import { matchHistoryPath } from "../matchHistoryLinks";
import { fetchTrackDashboard, type TrackDashboardResponse } from "../trackAnalyticsApi";

const panel = "rounded-lg border border-white/10 bg-black/75 p-4 shadow-lg backdrop-blur-sm sm:p-5";
const selectClass =
  "min-h-11 rounded-md border border-white/20 bg-zinc-950 px-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-400";

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function BarRows({ rows }: { rows: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="mt-4 space-y-3">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[42px_minmax(0,1fr)_32px] items-center gap-3 text-sm"
        >
          <span className="text-gray-300">{row.label}</span>
          <span className="h-6 overflow-hidden rounded bg-white/5">
            <span
              className="block h-full rounded bg-blue-500/75"
              style={{ width: `${(100 * row.count) / max}%` }}
            />
          </span>
          <strong className="text-right">{row.count}</strong>
        </div>
      ))}
    </div>
  );
}

export default function TrackDashboard() {
  const { trackId = "" } = useParams();
  const numericTrackId = Number(trackId);
  const { league, leaguePath } = useLeague();
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
  const [data, setData] = useState<TrackDashboardResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [minPlays, setMinPlays] = useState(() =>
    Math.min(500, Math.max(1, Number(params.get("min_races")) || 2))
  );

  useEffect(() => {
    fetchTeamScopes()
      .then(setTeamScopes)
      .catch(() => setTeamScopes([]));
  }, []);
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
  const metrics = data?.metrics;
  const maxTiming = Math.max(1, ...(metrics?.timing_counts ?? []));

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
                  See whether the average is typical or driven by a few extreme races.
                </p>
                <BarRows rows={data.margin_buckets} />
              </section>
            </div>
            <section className={panel}>
              <h2 className="text-lg font-bold">Team performance</h2>
              <p className="mt-1 text-sm text-gray-400">
                Lift compares a team&apos;s margin here with its normal race margin in this filtered
                view. Teams shown have at least {minPlays} plays.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="border-y border-white/15 bg-white/5 text-xs uppercase text-gray-300">
                    <tr>
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
                    {data.teams.map((row) => (
                      <tr key={row.team_id}>
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

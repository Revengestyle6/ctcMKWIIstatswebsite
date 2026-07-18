import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  PlayerPerformance,
  PlayerTracks,
  TeamRoster,
  TeamTracks,
} from "../../dashboardApi";
import { MetricGrid, TrendRows } from "./DashboardPrimitives";

function value(value: number | null, suffix = ""): string {
  return value === null ? "-" : `${value}${suffix}`;
}

export function TabState({ loading, error }: { loading: boolean; error: string }) {
  if (error) return <div className="rounded-md border border-rose-400/40 bg-rose-950/80 px-4 py-5 text-rose-100">{error}</div>;
  if (loading) return <div className="h-48 animate-pulse rounded-md border border-white/10 bg-white/5" />;
  return null;
}

export function PlayerPerformanceView({ data }: { data: PlayerPerformance }) {
  const metrics = data.runner_metrics;
  const coverage = data.role_coverage;
  return (
    <div className="space-y-6">
      <MetricGrid items={[
        { label: "Runner pace", value: value(metrics.twelve_race_pace), detail: metrics.excluded_score_rows ? `${metrics.excluded_score_rows} invalid score rows excluded` : `${value(metrics.points_per_race)} points per race` },
        { label: "Runner races", value: String(metrics.races), detail: `${metrics.scored_races} scored` },
        { label: "Average place", value: value(metrics.average_placement), detail: "Runner placements" },
        { label: "Race wins", value: String(metrics.wins), detail: `${metrics.podiums} podiums` },
        { label: "Podium rate", value: value(metrics.podium_rate, "%"), detail: "Runner races" },
        { label: "Role coverage", value: value(coverage.known_rate, "%"), detail: `${coverage.unknown} unknown races` },
      ]} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-white/10 bg-black/70 p-5">
          <h3 className="text-lg font-bold">Role coverage</h3>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div className="flex justify-between border-b border-white/10 pb-2"><dt className="text-gray-400">Explicit runner</dt><dd className="font-bold">{coverage.explicit_runner}</dd></div>
            <div className="flex justify-between border-b border-white/10 pb-2"><dt className="text-gray-400">Inferred runner</dt><dd className="font-bold">{coverage.inferred_runner}</dd></div>
            <div className="flex justify-between border-b border-white/10 pb-2"><dt className="text-gray-400">Explicit bagger</dt><dd className="font-bold">{coverage.explicit_bagger}</dd></div>
            <div className="flex justify-between border-b border-white/10 pb-2"><dt className="text-gray-400">Inferred bagger</dt><dd className="font-bold">{coverage.inferred_bagger}</dd></div>
            <div className="flex justify-between border-b border-white/10 pb-2"><dt className="text-gray-400">Unknown</dt><dd className="font-bold">{coverage.unknown}</dd></div>
            <div className="flex justify-between border-b border-white/10 pb-2"><dt className="text-gray-400">Total</dt><dd className="font-bold">{coverage.total}</dd></div>
          </dl>
          <details className="mt-4 text-sm text-gray-300">
            <summary className="cursor-pointer font-semibold text-blue-300">Runner calculation</summary>
            <p className="mt-2 leading-6">Explicit roles take precedence. Unknown roles are inferred only for confirmed 5v5 races: positions 1-8 are runners and positions 9-10 are baggers. Awarded points without a placement remain unknown.</p>
          </details>
        </section>

        <section className="rounded-md border border-white/10 bg-black/70 p-5">
          <h3 className="mb-4 text-lg font-bold">Runner score distribution</h3>
          <TrendRows values={data.score_distribution.map((item) => ({ id: item.score, label: `${item.score} pts`, value: item.races }))} />
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-md border border-white/10 bg-black/70">
          <h3 className="border-b border-white/10 px-5 py-4 text-lg font-bold">By race number</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><thead className="bg-black/60 text-gray-400"><tr><th className="px-4 py-3 text-left">Race</th><th className="px-4 py-3 text-right">Average</th><th className="px-4 py-3 text-right">Races</th></tr></thead><tbody>{data.by_race_number.map((row) => <tr key={row.race_number} className="border-t border-white/10"><td className="px-4 py-3">R{row.race_number}</td><td className="px-4 py-3 text-right font-bold">{row.average}</td><td className="px-4 py-3 text-right text-gray-300">{row.races}</td></tr>)}</tbody></table>
          </div>
        </section>
        <section className="overflow-hidden rounded-md border border-white/10 bg-black/70">
          <h3 className="border-b border-white/10 px-5 py-4 text-lg font-bold">By GP</h3>
          <table className="w-full text-sm"><thead className="bg-black/60 text-gray-400"><tr><th className="px-4 py-3 text-left">GP</th><th className="px-4 py-3 text-right">Average</th><th className="px-4 py-3 text-right">Races</th></tr></thead><tbody>{data.by_gp_number.map((row) => <tr key={row.gp_number} className="border-t border-white/10"><td className="px-4 py-3">GP {row.gp_number}</td><td className="px-4 py-3 text-right font-bold">{row.average}</td><td className="px-4 py-3 text-right text-gray-300">{row.races}</td></tr>)}</tbody></table>
        </section>
      </div>
    </div>
  );
}

export function PlayerTracksView({ data }: { data: PlayerTracks }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("best");
  const rows = useMemo(() => {
    const filtered = data.tracks.filter((track) => track.name.toLowerCase().includes(query.toLowerCase()));
    return [...filtered].sort((a, b) => {
      if (sort === "worst") return a.average - b.average || b.races - a.races;
      if (sort === "races") return b.races - a.races || b.average - a.average;
      if (sort === "name") return a.name.localeCompare(b.name);
      return b.average - a.average || b.races - a.races;
    });
  }, [data.tracks, query, sort]);
  return (
    <section className="overflow-hidden rounded-md border border-white/10 bg-black/70">
      <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row">
        <input className="min-h-10 flex-1 rounded-md border border-white/20 bg-zinc-950 px-3 text-white" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tracks" />
        <select className="min-h-10 rounded-md border border-white/20 bg-zinc-950 px-3 text-white" value={sort} onChange={(event) => setSort(event.target.value)}><option value="best">Best average</option><option value="worst">Lowest average</option><option value="races">Most played</option><option value="name">Track name</option></select>
      </div>
      {rows.length === 0 ? <p className="p-8 text-center text-gray-400">No tracks meet the current minimum of {data.minimum_races} races.</p> : <div className="overflow-x-auto"><table className="min-w-[760px] w-full text-sm"><thead className="bg-black/70 text-left text-gray-400"><tr><th className="px-4 py-3">Track</th><th className="px-4 py-3 text-right">Average</th><th className="px-4 py-3 text-right">Races</th><th className="px-4 py-3 text-right">Runner avg</th><th className="px-4 py-3 text-right">Wins</th><th className="px-4 py-3 text-right">Podiums</th><th className="px-4 py-3 text-right">Top 3</th></tr></thead><tbody>{rows.map((row) => <tr key={row.track_id} className="border-t border-white/10"><td className="px-4 py-3 font-semibold">{row.name}</td><td className="px-4 py-3 text-right font-bold">{row.average}</td><td className="px-4 py-3 text-right">{row.races}</td><td className="px-4 py-3 text-right">{value(row.runner_average)} <span className="text-xs text-gray-500">({row.runner_races})</span></td><td className="px-4 py-3 text-right">{row.wins}</td><td className="px-4 py-3 text-right">{row.podiums}</td><td className="px-4 py-3 text-right">{value(row.top_three_rate, "%")}</td></tr>)}</tbody></table></div>}
    </section>
  );
}

export function TeamRosterView({ data }: { data: TeamRoster }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("pace");
  const rows = useMemo(() => {
    const filtered = data.players.filter((player) => player.name.toLowerCase().includes(query.toLowerCase()) || player.friend_codes.some((code) => code.includes(query)));
    return [...filtered].sort((a, b) => sort === "races" ? b.races - a.races : sort === "name" ? a.name.localeCompare(b.name) : b.twelve_race_pace - a.twelve_race_pace);
  }, [data.players, query, sort]);
  return (
    <section className="overflow-hidden rounded-md border border-white/10 bg-black/70">
      <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row">
        <input className="min-h-10 flex-1 rounded-md border border-white/20 bg-zinc-950 px-3 text-white" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search roster" />
        <select className="min-h-10 rounded-md border border-white/20 bg-zinc-950 px-3 text-white" value={sort} onChange={(event) => setSort(event.target.value)}><option value="pace">12-race pace</option><option value="races">Most races</option><option value="name">Player name</option></select>
      </div>
      {rows.length === 0 ? <p className="p-8 text-center text-gray-400">No players meet the current minimum of {data.minimum_races} races.</p> : <div className="overflow-x-auto"><table className="min-w-[920px] w-full text-sm"><thead className="bg-black/70 text-left text-gray-400"><tr><th className="px-4 py-3">Player</th><th className="px-4 py-3">Friend codes</th><th className="px-4 py-3 text-right">Matches</th><th className="px-4 py-3 text-right">Races</th><th className="px-4 py-3 text-right">12-race pace</th><th className="px-4 py-3 text-right">Runner avg</th><th className="px-4 py-3">Last seen</th></tr></thead><tbody>{rows.map((row) => <tr key={row.player_id} className="border-t border-white/10"><td className="px-4 py-3"><Link to={`/players/${row.player_id}`} className="font-semibold text-blue-300 hover:text-blue-200">{row.name}</Link></td><td className="px-4 py-3 text-gray-400">{row.friend_codes.join(", ")}</td><td className="px-4 py-3 text-right">{row.matches}</td><td className="px-4 py-3 text-right">{row.races}</td><td className="px-4 py-3 text-right font-bold">{row.twelve_race_pace}</td><td className="px-4 py-3 text-right">{value(row.runner_average)} <span className="text-xs text-gray-500">({row.runner_races})</span></td><td className="px-4 py-3">{row.last_appearance.season.toUpperCase()} {row.last_appearance.division.toUpperCase()} {row.last_appearance.week ? `W${row.last_appearance.week}` : ""}</td></tr>)}</tbody></table></div>}
    </section>
  );
}

export function TeamTracksView({ data }: { data: TeamTracks }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("best");
  const rows = useMemo(() => {
    const filtered = data.tracks.filter((track) => track.name.toLowerCase().includes(query.toLowerCase()));
    return [...filtered].sort((a, b) => sort === "worst" ? a.average_score - b.average_score : sort === "races" ? b.races - a.races : sort === "name" ? a.name.localeCompare(b.name) : b.average_score - a.average_score);
  }, [data.tracks, query, sort]);
  return (
    <section className="overflow-hidden rounded-md border border-white/10 bg-black/70">
      <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row">
        <input className="min-h-10 flex-1 rounded-md border border-white/20 bg-zinc-950 px-3 text-white" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tracks" />
        <select className="min-h-10 rounded-md border border-white/20 bg-zinc-950 px-3 text-white" value={sort} onChange={(event) => setSort(event.target.value)}><option value="best">Best score</option><option value="worst">Lowest score</option><option value="races">Most played</option><option value="name">Track name</option></select>
      </div>
      {rows.length === 0 ? <p className="p-8 text-center text-gray-400">No tracks meet the current minimum of {data.minimum_races} races.</p> : <div className="overflow-x-auto"><table className="min-w-[640px] w-full text-sm"><thead className="bg-black/70 text-left text-gray-400"><tr><th className="px-4 py-3">Track</th><th className="px-4 py-3 text-right">Team average</th><th className="px-4 py-3 text-right">Races</th><th className="px-4 py-3 text-right">Wins</th><th className="px-4 py-3 text-right">Ties</th><th className="px-4 py-3 text-right">Win rate</th></tr></thead><tbody>{rows.map((row) => <tr key={row.track_id} className="border-t border-white/10"><td className="px-4 py-3 font-semibold">{row.name}</td><td className="px-4 py-3 text-right font-bold">{row.average_score}</td><td className="px-4 py-3 text-right">{row.races}</td><td className="px-4 py-3 text-right">{row.wins}</td><td className="px-4 py-3 text-right">{row.ties}</td><td className="px-4 py-3 text-right">{row.win_rate}%</td></tr>)}</tbody></table></div>}
    </section>
  );
}

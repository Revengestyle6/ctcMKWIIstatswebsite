import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PlayerPerformance, PlayerTracks, TeamRoster, TeamTracks } from "../../dashboardApi";
import { MetricGrid, TrendRows } from "./DashboardPrimitives";

function value(value: number | null, suffix = ""): string {
  return value === null ? "-" : `${value}${suffix}`;
}

export function TabState({ loading, error }: { loading: boolean; error: string }) {
  if (error)
    return (
      <div className="rounded-md border border-rose-400/40 bg-rose-950/80 px-4 py-5 text-rose-100">
        {error}
      </div>
    );
  if (loading)
    return <div className="h-48 animate-pulse rounded-md border border-white/10 bg-white/5" />;
  return null;
}

export function PlayerPerformanceView({ data }: { data: PlayerPerformance }) {
  const metrics = data.metrics;
  const coverage = data.role_coverage;
  const isRunner = metrics.role === "runner";
  const metricItems = isRunner
    ? [
        {
          label: "12-race pace",
          value: value(metrics.twelve_race_pace),
          detail: metrics.excluded_score_rows
            ? `${metrics.excluded_score_rows} invalid score rows excluded`
            : "Runner scoring",
        },
        {
          label: "Runner races",
          value: String(metrics.races),
          detail: `${metrics.scored_races} scored`,
        },
        { label: "Points per race", value: value(metrics.points_per_race), detail: "Runner races" },
        { label: "Race wins", value: String(metrics.wins), detail: "Runner races" },
        {
          label: "Podiums",
          value: String(metrics.podiums),
          detail: `${value(metrics.podium_rate, "%")} podium rate`,
        },
        {
          label: "Average place",
          value: value(metrics.average_placement),
          detail: "Runner placements",
        },
      ]
    : [
        {
          label: "Bagging points",
          value: String(metrics.total_points),
          detail: `${value(metrics.points_per_race)} per bagging race`,
        },
        {
          label: "Bagger races",
          value: String(metrics.races),
          detail: `${metrics.scored_races} scored`,
        },
        {
          label: "Bag-point rate",
          value: value(metrics.bag_point_rate, "%"),
          detail: `${metrics.bag_points} races with points`,
        },
        {
          label: "Zero-point rate",
          value: value(metrics.zero_point_rate, "%"),
          detail: `${metrics.zero_points} zero-point races`,
        },
        {
          label: "Average place",
          value: value(metrics.average_placement),
          detail: "Recorded bagger placements",
        },
        {
          label: "Opponent point diff",
          value:
            metrics.counterpart_races === 0
              ? "-"
              : metrics.opponent_point_differential > 0
                ? `+${metrics.opponent_point_differential}`
                : String(metrics.opponent_point_differential),
          detail: `${metrics.counterpart_races} comparable races`,
        },
      ];
  return (
    <div className="space-y-6">
      <MetricGrid items={metricItems} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-white/10 bg-black/70 p-5">
          <h3 className="text-lg font-bold">Role coverage</h3>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div className="flex justify-between border-b border-white/10 pb-2">
              <dt className="text-gray-400">Explicit runner</dt>
              <dd className="font-bold">{coverage.explicit_runner}</dd>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <dt className="text-gray-400">Inferred runner</dt>
              <dd className="font-bold">{coverage.inferred_runner}</dd>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <dt className="text-gray-400">Explicit bagger</dt>
              <dd className="font-bold">{coverage.explicit_bagger}</dd>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <dt className="text-gray-400">Inferred bagger</dt>
              <dd className="font-bold">{coverage.inferred_bagger}</dd>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <dt className="text-gray-400">Unknown</dt>
              <dd className="font-bold">{coverage.unknown}</dd>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <dt className="text-gray-400">Total</dt>
              <dd className="font-bold">{coverage.total}</dd>
            </div>
          </dl>
          <details className="mt-4 text-sm text-gray-300">
            <summary className="cursor-pointer font-semibold text-blue-300">
              {isRunner ? "Runner calculation" : "Bagger methodology"}
            </summary>
            <p className="mt-2 leading-6">
              {isRunner
                ? "Explicit roles take precedence. Unknown roles are inferred only for confirmed 5v5 races: positions 1-8 are runners and positions 9-10 are baggers. Awarded points without a placement remain unknown."
                : "Bagging statistics report scoring outcomes only. A bag point is any race with more than zero points. Shock acquisition is not recorded, so these values do not measure complete bagging effectiveness."}
            </p>
          </details>
        </section>

        <section className="rounded-md border border-white/10 bg-black/70 p-5">
          <h3 className="mb-4 text-lg font-bold">
            {isRunner ? "Runner" : "Bagger"} score distribution
          </h3>
          <TrendRows
            values={data.score_distribution.map((item) => ({
              id: item.score,
              label: `${item.score} pts`,
              value: item.races,
            }))}
          />
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-md border border-white/10 bg-black/70">
          <h3 className="border-b border-white/10 px-5 py-4 text-lg font-bold">
            {isRunner ? "Runner" : "Bagger"} scoring by race number
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="bg-black/60 text-gray-400">
                <tr>
                  <th className="px-4 py-3 text-left">Race</th>
                  <th className="px-4 py-3 text-right">Points/race</th>
                  <th className="px-4 py-3 text-right">Scored races</th>
                </tr>
              </thead>
              <tbody>
                {data.by_race_number.map((row) => (
                  <tr key={row.race_number} className="border-t border-white/10">
                    <td className="px-4 py-3">R{row.race_number}</td>
                    <td className="px-4 py-3 text-right font-bold">{row.average}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{row.races}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="overflow-hidden rounded-md border border-white/10 bg-black/70">
          <h3 className="border-b border-white/10 px-5 py-4 text-lg font-bold">
            {isRunner ? "Runner" : "Bagger"} scoring by GP
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="bg-black/60 text-gray-400">
                <tr>
                  <th className="px-4 py-3 text-left">GP</th>
                  <th className="px-4 py-3 text-right">Points/race</th>
                  <th className="px-4 py-3 text-right">Scored races</th>
                </tr>
              </thead>
              <tbody>
                {data.by_gp_number.map((row) => (
                  <tr key={row.gp_number} className="border-t border-white/10">
                    <td className="px-4 py-3">GP {row.gp_number}</td>
                    <td className="px-4 py-3 text-right font-bold">{row.average}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{row.races}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

export function PlayerTracksView({ data }: { data: PlayerTracks }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("best");
  const rows = useMemo(() => {
    const filtered = data.tracks.filter((track) =>
      track.name.toLowerCase().includes(query.toLowerCase())
    );
    return [...filtered].sort((a, b) => {
      const aPoints = a.points_per_race;
      const bPoints = b.points_per_race;
      const unavailableOrder =
        aPoints === null && bPoints === null
          ? 0
          : aPoints === null
            ? 1
            : bPoints === null
              ? -1
              : null;
      const bestPoints = unavailableOrder ?? (bPoints ?? 0) - (aPoints ?? 0);
      const worstPoints = unavailableOrder ?? (aPoints ?? 0) - (bPoints ?? 0);
      if (sort === "worst") return worstPoints || b.races - a.races || a.name.localeCompare(b.name);
      if (sort === "races") return b.races - a.races || bestPoints || a.name.localeCompare(b.name);
      if (sort === "name") return a.name.localeCompare(b.name);
      return bestPoints || b.races - a.races || a.name.localeCompare(b.name);
    });
  }, [data.tracks, query, sort]);
  const isRunner = data.role === "runner";
  return (
    <section className="overflow-hidden rounded-md border border-white/10 bg-black/70">
      <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row">
        <input
          className="min-h-10 flex-1 rounded-md border border-white/20 bg-zinc-950 px-3 text-white"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tracks"
        />
        <select
          className="min-h-10 rounded-md border border-white/20 bg-zinc-950 px-3 text-white"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="best">Best {isRunner ? "runner" : "bagger"} scoring</option>
          <option value="worst">Lowest {isRunner ? "runner" : "bagger"} scoring</option>
          <option value="races">Most role races</option>
          <option value="name">Track name</option>
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-gray-400">
          No {isRunner ? "runner" : "bagger"} tracks meet the current minimum of{" "}
          {data.minimum_races} scored races.
        </p>
      ) : (
        <div className="overflow-x-auto">
          {isRunner ? (
            <table className="min-w-[820px] w-full text-sm">
              <thead className="bg-black/70 text-left text-gray-400">
                <tr>
                  <th className="px-4 py-3">Track</th>
                  <th className="px-4 py-3 text-right">Points/race</th>
                  <th className="px-4 py-3 text-right">Runner races/scored</th>
                  <th className="px-4 py-3 text-right">Avg place</th>
                  <th className="px-4 py-3 text-right">Wins</th>
                  <th className="px-4 py-3 text-right">Podiums</th>
                  <th className="px-4 py-3 text-right">Podium rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(
                  (row) =>
                    row.role === "runner" && (
                      <tr key={row.track_id} className="border-t border-white/10">
                        <td className="px-4 py-3 font-semibold">{row.name}</td>
                        <td className="px-4 py-3 text-right font-bold">
                          {value(row.points_per_race)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.races} / {row.scored_races}
                        </td>
                        <td className="px-4 py-3 text-right">{value(row.average_placement)}</td>
                        <td className="px-4 py-3 text-right">{row.wins}</td>
                        <td className="px-4 py-3 text-right">{row.podiums}</td>
                        <td className="px-4 py-3 text-right">{value(row.podium_rate, "%")}</td>
                      </tr>
                    )
                )}
              </tbody>
            </table>
          ) : (
            <table className="min-w-[880px] w-full text-sm">
              <thead className="bg-black/70 text-left text-gray-400">
                <tr>
                  <th className="px-4 py-3">Track</th>
                  <th className="px-4 py-3 text-right">Points/bagging race</th>
                  <th className="px-4 py-3 text-right">Bagger races/scored</th>
                  <th className="px-4 py-3 text-right">Total bagging points</th>
                  <th className="px-4 py-3 text-right">Bag-point rate</th>
                  <th className="px-4 py-3 text-right">Zero-point rate</th>
                  <th className="px-4 py-3 text-right">Avg place</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(
                  (row) =>
                    row.role === "bagger" && (
                      <tr key={row.track_id} className="border-t border-white/10">
                        <td className="px-4 py-3 font-semibold">{row.name}</td>
                        <td className="px-4 py-3 text-right font-bold">
                          {value(row.points_per_race)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.races} / {row.scored_races}
                        </td>
                        <td className="px-4 py-3 text-right">{row.total_points}</td>
                        <td className="px-4 py-3 text-right">{value(row.bag_point_rate, "%")}</td>
                        <td className="px-4 py-3 text-right">{value(row.zero_point_rate, "%")}</td>
                        <td className="px-4 py-3 text-right">{value(row.average_placement)}</td>
                      </tr>
                    )
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

export function TeamRosterView({ data, teamId }: { data: TeamRoster; teamId: number }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(data.role === "runner" ? "pace" : "points");
  const isRunner = data.role === "runner";
  const roleLabel = isRunner ? "Runner" : "Bagger";
  const selectedRoleRows = isRunner
    ? data.role_coverage.explicit_runner + data.role_coverage.inferred_runner
    : data.role_coverage.explicit_bagger + data.role_coverage.inferred_bagger;

  const rows = useMemo(() => {
    const normalizedQuery = query.toLowerCase();
    const filtered = data.players.filter(
      (player) =>
        player.metrics.role === data.role &&
        (player.name.toLowerCase().includes(normalizedQuery) ||
          player.friend_codes.some((code) => code.includes(query)))
    );
    const nullableDescending = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    };
    return [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "matches") return b.matches - a.matches || a.name.localeCompare(b.name);
      if (sort === "races")
        return b.metrics.races - a.metrics.races || a.name.localeCompare(b.name);
      if (sort === "bag-point-rate") {
        const aRate = a.metrics.role === "bagger" ? a.metrics.bag_point_rate : null;
        const bRate = b.metrics.role === "bagger" ? b.metrics.bag_point_rate : null;
        return nullableDescending(aRate, bRate) || a.name.localeCompare(b.name);
      }
      if (sort === "points") {
        return (
          nullableDescending(a.metrics.points_per_race, b.metrics.points_per_race) ||
          a.name.localeCompare(b.name)
        );
      }
      const aPace = a.metrics.role === "runner" ? a.metrics.twelve_race_pace : null;
      const bPace = b.metrics.role === "runner" ? b.metrics.twelve_race_pace : null;
      return nullableDescending(aPace, bPace) || a.name.localeCompare(b.name);
    });
  }, [data.players, data.role, query, sort]);

  const playerLink = (playerId: number) => {
    const params = new URLSearchParams({
      role: data.role,
      team_id: String(teamId),
      min_races: String(data.minimum_races),
    });
    if (data.scope.season) params.set("season", data.scope.season);
    if (data.scope.division) params.set("division", data.scope.division);
    return `/players/${playerId}?${params.toString()}`;
  };

  return (
    <section className="overflow-hidden rounded-md border border-white/10 bg-black/70">
      <div className="border-b border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-gray-300">
        <p>
          <span className="font-semibold text-white">{roleLabel} role coverage:</span>{" "}
          {selectedRoleRows} selected-role assignments across {data.role_coverage.total} roster race
          assignments.
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {data.role_coverage.explicit_runner} explicit runner, {data.role_coverage.inferred_runner}{" "}
          inferred runner, {data.role_coverage.explicit_bagger} explicit bagger,{" "}
          {data.role_coverage.inferred_bagger} inferred bagger, {data.role_coverage.unknown} unknown
          {data.role_coverage.known_rate === null
            ? ""
            : ` (${data.role_coverage.known_rate}% known)`}
          .
        </p>
      </div>
      <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row">
        <input
          className="min-h-10 flex-1 rounded-md border border-white/20 bg-zinc-950 px-3 text-white"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search roster"
        />
        <select
          className="min-h-10 rounded-md border border-white/20 bg-zinc-950 px-3 text-white"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          {isRunner ? (
            <option value="pace">12-race pace</option>
          ) : (
            <option value="points">Points per race</option>
          )}
          {!isRunner && <option value="bag-point-rate">Bag-point rate</option>}
          <option value="races">Most role races</option>
          <option value="matches">Most matches</option>
          <option value="name">Player name</option>
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-gray-400">
          No {roleLabel.toLowerCase()} players meet the current minimum of {data.minimum_races}{" "}
          scored races.
        </p>
      ) : isRunner ? (
        <div className="overflow-x-auto">
          <table className="min-w-[940px] w-full text-sm">
            <thead className="bg-black/70 text-left text-gray-400">
              <tr>
                <th className="px-4 py-3">Player</th>
                <th className="px-4 py-3">Friend codes</th>
                <th className="px-4 py-3 text-right">Matches</th>
                <th className="px-4 py-3 text-right">Runner races/scored</th>
                <th className="px-4 py-3 text-right">12-race pace</th>
                <th className="px-4 py-3 text-right">Points/race</th>
                <th className="px-4 py-3">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(
                (row) =>
                  row.metrics.role === "runner" && (
                    <tr key={row.player_id} className="border-t border-white/10">
                      <td className="px-4 py-3">
                        <Link
                          to={playerLink(row.player_id)}
                          className="font-semibold text-blue-300 hover:text-blue-200"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {row.friend_codes.join(", ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-right">{row.matches}</td>
                      <td className="px-4 py-3 text-right">
                        {row.metrics.races} / {row.metrics.scored_races}
                      </td>
                      <td className="px-4 py-3 text-right font-bold">
                        {value(row.metrics.twelve_race_pace)}
                      </td>
                      <td className="px-4 py-3 text-right">{value(row.metrics.points_per_race)}</td>
                      <td className="px-4 py-3">
                        {row.last_appearance.season.toUpperCase()}{" "}
                        {row.last_appearance.division.toUpperCase()}{" "}
                        {row.last_appearance.match_number
                          ? `M${row.last_appearance.match_number}`
                          : ""}
                      </td>
                    </tr>
                  )
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[1160px] w-full text-sm">
            <thead className="bg-black/70 text-left text-gray-400">
              <tr>
                <th className="px-4 py-3">Player</th>
                <th className="px-4 py-3">Friend codes</th>
                <th className="px-4 py-3 text-right">Matches</th>
                <th className="px-4 py-3 text-right">Bagger races/scored</th>
                <th className="px-4 py-3 text-right">Points/race</th>
                <th className="px-4 py-3 text-right">Bag-point rate</th>
                <th className="px-4 py-3 text-right">Zero-point rate</th>
                <th className="px-4 py-3 text-right">Opponent point diff</th>
                <th className="px-4 py-3">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(
                (row) =>
                  row.metrics.role === "bagger" && (
                    <tr key={row.player_id} className="border-t border-white/10">
                      <td className="px-4 py-3">
                        <Link
                          to={playerLink(row.player_id)}
                          className="font-semibold text-blue-300 hover:text-blue-200"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {row.friend_codes.join(", ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-right">{row.matches}</td>
                      <td className="px-4 py-3 text-right">
                        {row.metrics.races} / {row.metrics.scored_races}
                      </td>
                      <td className="px-4 py-3 text-right font-bold">
                        {value(row.metrics.points_per_race)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {value(row.metrics.bag_point_rate, "%")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {value(row.metrics.zero_point_rate, "%")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.metrics.counterpart_races === 0
                          ? "-"
                          : row.metrics.opponent_point_differential > 0
                            ? `+${row.metrics.opponent_point_differential}`
                            : row.metrics.opponent_point_differential}
                      </td>
                      <td className="px-4 py-3">
                        {row.last_appearance.season.toUpperCase()}{" "}
                        {row.last_appearance.division.toUpperCase()}{" "}
                        {row.last_appearance.match_number
                          ? `M${row.last_appearance.match_number}`
                          : ""}
                      </td>
                    </tr>
                  )
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function TeamTracksView({ data }: { data: TeamTracks }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("best");
  const rows = useMemo(() => {
    const filtered = data.tracks.filter((track) =>
      track.name.toLowerCase().includes(query.toLowerCase())
    );
    return [...filtered].sort((a, b) =>
      sort === "worst"
        ? a.average_score - b.average_score
        : sort === "races"
          ? b.races - a.races
          : sort === "name"
            ? a.name.localeCompare(b.name)
            : b.average_score - a.average_score
    );
  }, [data.tracks, query, sort]);
  return (
    <section className="overflow-hidden rounded-md border border-white/10 bg-black/70">
      <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row">
        <input
          className="min-h-10 flex-1 rounded-md border border-white/20 bg-zinc-950 px-3 text-white"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tracks"
        />
        <select
          className="min-h-10 rounded-md border border-white/20 bg-zinc-950 px-3 text-white"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="best">Best score</option>
          <option value="worst">Lowest score</option>
          <option value="races">Most played</option>
          <option value="name">Track name</option>
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-gray-400">
          No tracks meet the current minimum of {data.minimum_races} races.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[640px] w-full text-sm">
            <thead className="bg-black/70 text-left text-gray-400">
              <tr>
                <th className="px-4 py-3">Track</th>
                <th className="px-4 py-3 text-right">Team average</th>
                <th className="px-4 py-3 text-right">Races</th>
                <th className="px-4 py-3 text-right">Wins</th>
                <th className="px-4 py-3 text-right">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.track_id} className="border-t border-white/10">
                  <td className="px-4 py-3 font-semibold">{row.name}</td>
                  <td className="px-4 py-3 text-right font-bold">{row.average_score}</td>
                  <td className="px-4 py-3 text-right">{row.races}</td>
                  <td className="px-4 py-3 text-right">{row.wins}</td>
                  <td className="px-4 py-3 text-right">{row.win_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

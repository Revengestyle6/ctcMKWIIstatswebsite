import type { MatchJson, MatchPlayerJson, TeamJson } from "./matchJsonEditorModel";
import {
  type AggregateScore,
  aggregatePeriods,
  aggregatePlayerTotal,
  aggregateTeamTotal,
  emptyAggregateScore,
} from "./unaccountedMatchModel";

const inputClass = "mt-1 w-full rounded border border-white/20 bg-black/40 p-2 text-white";
const scoreInputClass =
  "h-9 w-full min-w-0 rounded border border-white/20 bg-black/40 px-1 text-center text-sm tabular-nums text-white outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const roles = ["runner", "bagger"] as const;

function roleSummary(scores: AggregateScore[], role: AggregateScore["role"]) {
  return scores.reduce(
    (total, score) =>
      score.role === role
        ? { points: total.points + score.points, races: total.races + score.races }
        : total,
    { points: 0, races: 0 }
  );
}

export function UnaccountedScoreEntry({
  match,
  team,
  updatePlayer,
  updateTeam,
}: {
  match: MatchJson;
  team: TeamJson;
  updatePlayer: (friendCode: string, update: (player: MatchPlayerJson) => MatchPlayerJson) => void;
  updateTeam: (update: (team: TeamJson) => TeamJson) => void;
}) {
  const periods = aggregatePeriods(match);
  function updateScore(
    fc: string,
    gp: number,
    role: AggregateScore["role"],
    field: "points" | "races" | "disconnection_points",
    value: number
  ) {
    updatePlayer(fc, (player) => {
      const scores = player.aggregate_scores ?? [];
      const score =
        scores.find((row) => row.gp_number === gp && row.role === role) ??
        emptyAggregateScore(gp, role);
      return {
        ...player,
        aggregate_scores: [
          ...scores.filter((row) => row.gp_number !== gp || row.role !== role),
          { ...score, [field]: value },
        ],
      };
    });
  }
  return (
    <div className="mt-4 space-y-4 border-t border-amber-400/30 pt-4">
      <p className="text-sm text-gray-300">
        Enter {match.entry_mode === "totals" ? "match" : "GP"} points and races for each role.
      </p>
      {Object.entries(team.players ?? {}).map(([fc, player]) => {
        const playerName = player.lounge_name || player.table_name || fc;
        const scores = player.aggregate_scores ?? [];
        const dcTotal = scores.reduce((sum, score) => sum + score.disconnection_points, 0);
        const gpSummaries = periods.map((gp) => {
          const gpScores = scores.filter((score) => score.gp_number === gp);
          const run = roleSummary(gpScores, "runner").points;
          const bag = roleSummary(gpScores, "bagger").points;
          return { gp, run, bag, total: run + bag };
        });
        return (
          <details
            key={fc}
            aria-label={`${playerName} points`}
            className="group min-w-0 rounded border border-white/10"
          >
            <summary className="cursor-pointer list-none rounded px-3 py-2 text-sm hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 12 12"
                  className="h-3 w-3 shrink-0 fill-current text-gray-400 group-open:rotate-90"
                >
                  <path d="M4 2 8 6 4 10Z" />
                </svg>
                <span className="min-w-0 break-words font-semibold">{playerName}</span>
                <span className="ml-auto shrink-0 font-semibold tabular-nums">
                  Total {aggregatePlayerTotal(player)}
                </span>
              </span>
              <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 pl-5 text-xs tabular-nums text-gray-400">
                {roles.map((role) => {
                  const total = roleSummary(scores, role);
                  return (
                    <span key={role} className="whitespace-nowrap">
                      <span className="font-medium text-gray-200">
                        {role === "runner" ? "Run" : "Bag"} {total.points} pts
                      </span>{" "}
                      · {total.races} {total.races === 1 ? "race" : "races"}
                    </span>
                  );
                })}
              </span>
              {match.entry_mode !== "totals" ? (
                <span className="mt-2 grid grid-cols-3 gap-x-2 gap-y-2 border-t border-white/10 pt-2 text-xs tabular-nums sm:grid-cols-[repeat(auto-fit,minmax(5rem,1fr))]">
                  {gpSummaries.map(({ gp, run, bag, total }) => (
                    <span key={gp} className="min-w-0">
                      <span className="block font-medium text-gray-200">
                        GP {gp} · {total}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-x-1 text-[11px] text-gray-400">
                        <span className="whitespace-nowrap">Run {run}</span>
                        <span className="whitespace-nowrap">Bag {bag}</span>
                      </span>
                    </span>
                  ))}
                </span>
              ) : null}
              {(player.penalties ?? 0) > 0 ? (
                <span className="mt-1 block text-xs text-amber-300">
                  Includes −{player.penalties} legacy player penalty
                </span>
              ) : null}
            </summary>
            <div className="border-t border-white/15 p-2 sm:p-3">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-12" />
                  <col span={4} />
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2} scope="col" className="text-left text-xs text-gray-400">
                      {match.entry_mode === "totals" ? "" : "GP"}
                    </th>
                    <th colSpan={2} scope="colgroup" className="pb-1 font-medium text-gray-200">
                      Runner
                    </th>
                    <th
                      colSpan={2}
                      scope="colgroup"
                      className="border-l border-white/10 pb-1 font-medium text-gray-200"
                    >
                      Bagger
                    </th>
                  </tr>
                  <tr className="text-xs text-gray-400">
                    {roles.flatMap((role) =>
                      (["Points", "Races"] as const).map((field) => (
                        <th
                          key={`${role}-${field}`}
                          scope="col"
                          className={`pb-1 font-normal ${role === "bagger" && field === "Points" ? "border-l border-white/10" : ""}`}
                        >
                          {field}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {periods.map((gp) => (
                    <tr key={gp}>
                      <th scope="row" className="text-left font-medium text-gray-300">
                        {gp || "Total"}
                      </th>
                      {roles.flatMap((role) => {
                        const score =
                          player.aggregate_scores?.find(
                            (row) => row.gp_number === gp && row.role === role
                          ) ?? emptyAggregateScore(gp, role);
                        return (["points", "races"] as const).map((field) => (
                          <td
                            key={`${role}-${field}`}
                            className={`p-1 ${role === "bagger" && field === "points" ? "border-l border-white/10" : ""}`}
                          >
                            <input
                              type="number"
                              min={0}
                              step={1}
                              aria-label={`${fc} ${gp ? `GP ${gp}` : "total"} ${role} ${field}`}
                              value={score[field]}
                              className={scoreInputClass}
                              onFocus={(event) => event.currentTarget.select()}
                              onChange={(event) =>
                                updateScore(fc, gp, role, field, Number(event.target.value))
                              }
                            />
                          </td>
                        ));
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <details className="mt-2 border-t border-white/10 pt-2">
                <summary className="cursor-pointer text-xs text-gray-300 hover:text-white">
                  DC points (optional)
                  {dcTotal > 0 ? <span className="ml-1">· {dcTotal} included</span> : null}
                </summary>
                <p className="mb-2 mt-2 text-xs text-gray-400">
                  DC awards are already included in the points above. Record their portion here, or
                  leave blank if none. Race counts include races with DC awards.
                </p>
                <table className="w-full table-fixed border-collapse text-sm">
                  <colgroup>
                    <col className="w-12" />
                    <col span={2} />
                  </colgroup>
                  <thead>
                    <tr className="text-xs text-gray-400">
                      <th scope="col" className="text-left font-normal">
                        {match.entry_mode === "totals" ? "" : "GP"}
                      </th>
                      <th scope="col" className="font-normal">
                        Runner DC
                      </th>
                      <th scope="col" className="font-normal">
                        Bagger DC
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((gp) => (
                      <tr key={gp}>
                        <th scope="row" className="text-left font-medium text-gray-300">
                          {gp || "Total"}
                        </th>
                        {roles.map((role) => {
                          const score = player.aggregate_scores?.find(
                            (row) => row.gp_number === gp && row.role === role
                          );
                          return (
                            <td key={role} className="p-1">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                aria-label={`${fc} ${gp ? `GP ${gp}` : "total"} ${role} disconnection_points`}
                                value={score?.disconnection_points || ""}
                                placeholder="0"
                                className={scoreInputClass}
                                onFocus={(event) => event.currentTarget.select()}
                                onChange={(event) =>
                                  updateScore(
                                    fc,
                                    gp,
                                    role,
                                    "disconnection_points",
                                    Number(event.target.value)
                                  )
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          </details>
        );
      })}
      <div className="space-y-2">
        <h3 className="font-semibold">Missing player points</h3>
        {(team.aggregate_awards ?? []).map((award, index) => (
          <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-gray-300">
              Period
              <select
                className={inputClass}
                value={award.gp_number}
                onChange={(event) =>
                  updateTeam((current) => ({
                    ...current,
                    aggregate_awards: current.aggregate_awards?.map((row, i) =>
                      i === index ? { ...row, gp_number: Number(event.target.value) } : row
                    ),
                  }))
                }
              >
                {periods.map((gp) => (
                  <option key={gp} value={gp}>
                    {gp ? `GP ${gp}` : "Match total"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-300">
              Points
              <input
                type="number"
                min={0}
                value={award.points}
                className={inputClass}
                onChange={(event) =>
                  updateTeam((current) => ({
                    ...current,
                    aggregate_awards: current.aggregate_awards?.map((row, i) =>
                      i === index ? { ...row, points: Number(event.target.value) } : row
                    ),
                  }))
                }
              />
            </label>
            <label className="text-xs text-gray-300">
              Reason
              <select
                className={inputClass}
                value={award.reason}
                onChange={(event) =>
                  updateTeam((current) => ({
                    ...current,
                    aggregate_awards: current.aggregate_awards?.map((row, i) =>
                      i === index
                        ? { ...row, reason: event.target.value as typeof row.reason }
                        : row
                    ),
                  }))
                }
              >
                <option value="unknown">Unknown</option>
                <option value="short_roster">Short roster</option>
                <option value="unreplaced_disconnect">Unreplaced disconnect</option>
              </select>
            </label>
            <button
              type="button"
              className="text-red-300"
              onClick={() =>
                updateTeam((current) => ({
                  ...current,
                  aggregate_awards: current.aggregate_awards?.filter((_, i) => i !== index),
                }))
              }
            >
              Remove points
            </button>
          </div>
        ))}
        <button
          type="button"
          className="rounded border border-white/20 p-2 text-sm"
          onClick={() =>
            updateTeam((current) => ({
              ...current,
              aggregate_awards: [
                ...(current.aggregate_awards ?? []),
                { gp_number: periods[0], points: 0, reason: "unknown" },
              ],
            }))
          }
        >
          Add missing player points
        </button>
      </div>
      <p className="font-semibold">Final team score: {aggregateTeamTotal(team)}</p>
    </div>
  );
}

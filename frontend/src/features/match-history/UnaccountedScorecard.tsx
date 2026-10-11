import { Link } from "react-router-dom";
import type { MatchDetail, TeamColors } from "./matchHistoryViews";

export function UnaccountedScorecard({
  match,
  teamColors,
}: {
  match: MatchDetail;
  teamColors: TeamColors;
}) {
  const periods =
    match.entry_mode === "gp"
      ? Array.from({ length: Math.ceil(match.races_played / 4) }, (_, i) => i + 1)
      : [];
  return (
    <div className="space-y-3">
      <p className="rounded border border-amber-400/40 bg-amber-950/30 p-3 text-amber-200">
        Unaccounted match · {match.entry_mode === "gp" ? "GP scores" : "Total scores only"}. Race
        positions and tracks are unavailable.
      </p>
      <div className="overflow-x-auto rounded border border-white/15">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-black/70">
            <tr>
              <th className="p-3 text-left">Team / Player</th>
              {periods.map((gp) => (
                <th key={gp} className="p-3">
                  GP {gp}
                </th>
              ))}
              <th className="p-3">Run total</th>
              <th className="p-3">Bag total</th>
              <th className="p-3">Penalty</th>
              <th className="p-3">Final total</th>
            </tr>
          </thead>
          <tbody>
            {match.teams.map((team) => (
              <TeamRows
                key={team.team_id}
                team={team}
                periods={periods}
                color={teamColors[team.team_id] || team.hex_color}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamRows({
  team,
  periods,
  color,
}: {
  team: MatchDetail["teams"][number];
  periods: number[];
  color: string;
}) {
  const awards = team.aggregate_awards ?? [];
  return (
    <>
      <tr style={{ backgroundColor: `${color}70` }}>
        <th className="p-3 text-left">
          <Link to={`/teams/${team.team_id}`}>{team.tag}</Link>
        </th>
        <td colSpan={periods.length + 2} className="p-3">
          {team.name}
        </td>
        <td className="p-3 text-center">{team.team_penalties || "–"}</td>
        <td className="p-3 text-center text-lg font-bold">{team.final_score}</td>
      </tr>
      {team.players.map((player) => {
        const scores = player.aggregate_scores ?? [];
        return (
          <tr key={player.player_id} className="border-b border-white/10 bg-black/40">
            <th className="p-3 text-left">
              <Link to={`/players/${player.player_id}`}>{player.name}</Link>
            </th>
            {periods.map((gp) => {
              const rows = scores.filter((row) => row.gp_number === gp);
              const dc = rows.reduce((sum, row) => sum + row.disconnection_points, 0);
              return (
                <td key={gp} className="p-3 text-center">
                  {rows.reduce((sum, row) => sum + row.points, 0)}
                  {dc ? (
                    <span
                      className="ml-1 text-xs text-amber-300"
                      title={`${dc} disconnection points included`}
                    >
                      DC {dc}
                    </span>
                  ) : null}
                </td>
              );
            })}
            {(["runner", "bagger"] as const).map((role) => {
              const rows = scores.filter((row) => row.role === role);
              const points = rows.reduce((sum, row) => sum + row.points, 0);
              const races = rows.reduce((sum, row) => sum + row.races, 0);
              const dc = rows.reduce((sum, row) => sum + row.disconnection_points, 0);
              return (
                <td key={role} className="p-3 text-center">
                  {points}
                  <span className="block text-xs text-gray-400">
                    {races} races{dc ? ` · DC ${dc}` : ""}
                  </span>
                </td>
              );
            })}
            <td className="p-3 text-center">{player.penalties || "–"}</td>
            <td className="p-3 text-center font-bold">{player.total}</td>
          </tr>
        );
      })}
      {awards.length ? (
        <tr className="bg-amber-950/20 text-amber-200">
          <th className="p-3 text-left">Missing player points</th>
          {periods.map((gp) => (
            <td
              key={gp}
              className="p-3 text-center"
              title={awards
                .filter((award) => award.gp_number === gp)
                .map((award) => award.reason.replaceAll("_", " "))
                .join(", ")}
            >
              {awards
                .filter((award) => award.gp_number === gp)
                .reduce((sum, award) => sum + award.points, 0)}
            </td>
          ))}
          <td colSpan={3} />
          <td className="p-3 text-center">
            {awards.reduce((sum, award) => sum + award.points, 0)}
          </td>
        </tr>
      ) : null}
    </>
  );
}

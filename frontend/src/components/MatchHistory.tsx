import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import React from "react";
import { fetchJson } from "../api";
import SeasonDivisionSelector from "./SeasonDivisionSelector";
import { useSeasonDivision } from "../hooks/useSeasonDivision";

type MatchSummary = {
  match_id: number;
  week: number | null;
  label: string;
  races: number;
  teams: string;
  scores: string;
  import_status: string;
  review_notes: string | null;
};

type Track = {
  race_number: number;
  name: string;
  raw_name: string;
};

type MatchPlayer = {
  match_player_id: number;
  player_id: number;
  name: string;
  friend_code: string;
  total: number;
  penalties: number;
  subbed_out: boolean;
  scores: Array<number | null>;
  positions: Array<number | null>;
  roles: string[];
};

type MatchTeam = {
  match_team_id: number;
  tag: string;
  name: string;
  hex_color: string;
  raw_total_score: number;
  team_penalties: number;
  final_score: number;
  penalty: {
    points: number;
    notes: string;
  };
  players: MatchPlayer[];
};

type MatchDetail = {
  match_id: number;
  season: string;
  division: string;
  week: number | null;
  label: string;
  format: string | null;
  races_played: number;
  import_status: string;
  review_notes: string | null;
  tracks: Track[];
  teams: MatchTeam[];
  differential: number[];
};

type TableMode = "traditional" | "vertical";
type ChartMode = "cumulative" | "perRace";
type TeamColors = Record<number, string>;
type ScoreColumn = {
  key: string;
  label: string;
  indexes: number[];
};

function scoreValue(score: number | null): string {
  return score === null || score === undefined ? "-" : String(score);
}

function signedValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value > 0 ? `+${value}` : String(value);
}

function diffTextClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-gray-300";
  return value > 0 ? "text-emerald-300" : "text-rose-300";
}

function medalLabel(index: number): string {
  if (index === 0) return "1st";
  if (index === 1) return "2nd";
  if (index === 2) return "3rd";
  return `${index + 1}th`;
}

function medalTextClass(place: number | null): string {
  if (place === 1) return "text-[#FFE66D] drop-shadow-[0_0_5px_rgba(255,215,0,0.75)]";
  if (place === 2) return "text-[#E5F0FF] drop-shadow-[0_0_5px_rgba(147,197,253,0.8)]";
  if (place === 3) return "text-[#F6A04D] drop-shadow-[0_0_5px_rgba(246,160,77,0.7)]";
  return "text-white";
}

function teamShade(hexColor: string, fallback: string): string {
  return hexColor || fallback;
}

function teamColor(team: MatchTeam, teamColors: TeamColors, fallback: string): string {
  return teamColors[team.match_team_id] || teamShade(team.hex_color, fallback);
}

function normalizeHexColor(value: string): string | null {
  const cleaned = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return `#${cleaned.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return `#${cleaned.split("").map((char) => char + char).join("").toUpperCase()}`;
  }
  return null;
}

function scoreColumnValue(player: MatchPlayer, column: ScoreColumn): number | null {
  const scores = column.indexes
    .map((index) => player.scores[index])
    .filter((score): score is number => score !== null && score !== undefined);
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0);
}

function groupedScoreClass(match: MatchDetail, column: ScoreColumn, value: number | null): string {
  if (value === null || value === undefined) return "text-gray-500";
  const distinctScores = Array.from(
    new Set(
      match.teams
        .flatMap((team) => team.players)
        .map((player) => scoreColumnValue(player, column))
        .filter((score): score is number => score !== null && score !== undefined)
    )
  ).sort((a, b) => b - a);
  const place = distinctScores.indexOf(value) + 1;
  return medalTextClass(place || null);
}

function racePositionClass(position: number | null | undefined): string {
  if (position === null || position === undefined) return "text-gray-500";
  return medalTextClass(position);
}

function buildScoreColumns(match: MatchDetail, groupByGp: boolean): ScoreColumn[] {
  if (!groupByGp) {
    return match.tracks.map((track, index) => ({
      key: `race-${track.race_number}`,
      label: `R${track.race_number}`,
      indexes: [index],
    }));
  }

  const columns: ScoreColumn[] = [];
  for (let index = 0; index < match.tracks.length; index += 4) {
    const gpTracks = match.tracks.slice(index, index + 4);
    if (gpTracks.length === 0) continue;
    const firstRace = gpTracks[0].race_number;
    const lastRace = gpTracks[gpTracks.length - 1].race_number;
    columns.push({
      key: `gp-${columns.length + 1}`,
      label: `GP${columns.length + 1} (${firstRace}-${lastRace})`,
      indexes: gpTracks.map((_, offset) => index + offset),
    });
  }
  return columns;
}

function diffChartScale(values: number[], adjustedValues: number[]): { maxAbs: number; guides: number[] } {
  const observedMax = Math.max(
    1,
    ...values.map((value) => Math.abs(value)),
    ...adjustedValues.map((value) => Math.abs(value))
  );
  const maxAbs = Math.max(6, observedMax * 1.12);
  const guides: number[] = [];
  for (let value = 10; value <= Math.floor(maxAbs / 10) * 10; value += 10) {
    guides.push(value);
  }
  return { maxAbs, guides };
}

function chartDifferentialValues(values: number[], chartMode: ChartMode): number[] {
  if (chartMode === "cumulative") return values;
  return values.map((value, index) => index === 0 ? value : value - values[index - 1]);
}

function DifferentialLineChart({
  values,
  teams,
  chartMode,
  finalDifferential,
}: {
  values: number[];
  teams: MatchTeam[];
  chartMode: ChartMode;
  finalDifferential: number;
}): React.JSX.Element {
  const width = 840;
  const height = 166;
  const paddingX = 8;
  const paddingY = 28;
  const penaltyOffset = chartMode === "cumulative" && teams.length >= 2 ? teams[1].team_penalties - teams[0].team_penalties : 0;
  const adjustedValues = values.map((value) => value + penaltyOffset);
  const hasNetPenalties = penaltyOffset !== 0;
  const { maxAbs, guides } = diffChartScale(values, adjustedValues);
  const yForValue = (value: number) => height / 2 - (value / maxAbs) * (height / 2 - paddingY);
  const makePoints = (series: number[]) => series.map((value, index) => {
    const x = values.length <= 1
      ? width / 2
      : paddingX + (index * (width - paddingX * 2)) / (values.length - 1);
    const y = yForValue(value);
    return `${x},${y}`;
  });
  const points = makePoints(values);
  const penaltyPoints = makePoints(adjustedValues);
  const positiveTeam = teams[0]?.tag || "Team 1";
  const negativeTeam = teams[1]?.tag || "Team 2";

  return (
    <div className="rounded-md border border-white/10 bg-black/40 p-3">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-gray-300">
        <span>{chartMode === "cumulative" ? "Race differential" : "Per-race differential"}</span>
        <span>Final {finalDifferential > 0 ? "+" : ""}{finalDifferential}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img">
        {guides.flatMap((value) => [
          <line
            key={`positive-${value}`}
            x1={paddingX}
            y1={yForValue(value)}
            x2={width - paddingX}
            y2={yForValue(value)}
            stroke="rgba(255,255,255,.16)"
            strokeDasharray="4 6"
          />,
          <line
            key={`negative-${value}`}
            x1={paddingX}
            y1={yForValue(-value)}
            x2={width - paddingX}
            y2={yForValue(-value)}
            stroke="rgba(255,255,255,.16)"
            strokeDasharray="4 6"
          />,
        ])}
        <line x1={paddingX} y1={height / 2} x2={width - paddingX} y2={height / 2} stroke="rgba(255,255,255,.35)" />
        <text x={paddingX} y={18} fontSize="18" fontWeight="700" fill="rgba(255,255,255,.82)" style={{ textTransform: "none" }}>{positiveTeam}</text>
        <text x={paddingX} y={height - 4} fontSize="18" fontWeight="700" fill="rgba(255,255,255,.82)" style={{ textTransform: "none" }}>{negativeTeam}</text>
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="#60a5fa"
          strokeWidth="4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hasNetPenalties && (
          <polyline
            points={penaltyPoints.join(" ")}
            fill="none"
            stroke="#f87171"
            strokeWidth="3"
            strokeDasharray="6 6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {values.map((value, index) => {
          const [x, y] = points[index].split(",").map(Number);
          return (
            <g key={index}>
              <circle cx={x} cy={y} r="4" fill="#dbeafe" />
              <text x={x} y={value >= 0 ? y - 8 : y + 18} textAnchor="middle" fontSize="11" fill="white">
                {value > 0 ? `+${value}` : value}
              </text>
            </g>
          );
        })}
      </svg>
      {hasNetPenalties && (
        <div className="mt-2 flex items-center gap-2 text-xs text-rose-200">
          <span className="inline-block h-px w-8 border-t-2 border-dashed border-rose-300" />
          <span>Penalty adjusted net: {penaltyOffset > 0 ? "+" : ""}{penaltyOffset}</span>
        </div>
      )}
    </div>
  );
}

function TrackList({ tracks }: { tracks: Track[] }): React.JSX.Element {
  const gps: Track[][] = [];
  for (let index = 0; index < tracks.length; index += 4) {
    gps.push(tracks.slice(index, index + 4));
  }

  return (
    <div className="rounded-md border border-white/10 bg-black/45 p-4">
      <h2 className="mb-3 text-lg font-semibold text-white">Tracks</h2>
      <div className="grid gap-3 text-sm text-gray-200 sm:grid-cols-2 lg:grid-cols-3">
        {gps.map((gpTracks, gpIndex) => (
          <ol key={gpIndex} className="space-y-2">
            {gpTracks.map((track) => (
              <li key={track.race_number} className="flex gap-2 rounded bg-white/5 px-3 py-2">
                <span className="font-semibold text-blue-300">R{track.race_number}</span>
                <span>{track.name}</span>
              </li>
            ))}
          </ol>
        ))}
      </div>
    </div>
  );
}

function VerticalPlayerHeader({
  player,
  rank,
}: {
  player: MatchPlayer;
  rank: number;
}): React.JSX.Element {
  return (
    <th className="h-16 w-[4.5rem] min-w-[4.5rem] max-w-[4.5rem] px-1 pb-2 pt-1 text-center align-top">
      <span className="mt-0.5 block text-[10px] font-semibold text-blue-300">{medalLabel(rank - 1)}</span>
      <span
        className="flex h-10 w-full items-center justify-center break-words text-center text-[11px] font-semibold leading-tight text-gray-100"
        title={player.name}
      >
        {player.name}
      </span>
    </th>
  );
}

function TraditionalTable({
  match,
  groupByGp,
  teamColors,
  chartMode,
}: {
  match: MatchDetail;
  groupByGp: boolean;
  teamColors: TeamColors;
  chartMode: ChartMode;
}): React.JSX.Element {
  const columns = buildScoreColumns(match, groupByGp);
  const chartValues = chartDifferentialValues(match.differential, chartMode);
  const chartFinalPenaltyOffset = match.teams.length >= 2 ? match.teams[1].team_penalties - match.teams[0].team_penalties : 0;
  const chartFinalDifferential = (match.differential.at(-1) ?? 0) + chartFinalPenaltyOffset;
  const raceColumnClass = groupByGp ? "w-28 min-w-28 max-w-28" : "w-12 min-w-12 max-w-12";
  const counterpartDiff = (teamIndex: number, playerIndex: number): number | null => {
    const team = match.teams[teamIndex];
    const opponent = match.teams[teamIndex === 0 ? 1 : 0];
    const player = team?.players[playerIndex];
    const counterpart = opponent?.players[playerIndex];
    if (!player || !counterpart) return null;
    return player.total - counterpart.total;
  };
  const teamDiff = (teamIndex: number): number | null => {
    const team = match.teams[teamIndex];
    const opponent = match.teams[teamIndex === 0 ? 1 : 0];
    if (!team || !opponent) return null;
    return team.final_score - opponent.final_score;
  };

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded-md border border-white/10 bg-black/70">
        <table className="min-w-[980px] w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="bg-black/80 text-gray-200">
              <th className="sticky left-0 z-10 w-56 bg-black/90 px-3 py-3 text-left">Team / Player</th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`${raceColumnClass} border-l border-white/10 px-2 py-3 text-center`}
                >
                  {column.label}
                </th>
              ))}
              <th className="w-20 border-l border-white/20 px-3 py-3 text-center">Total</th>
              <th className="w-16 px-3 py-3 text-center">Diff</th>
            </tr>
          </thead>
          <tbody>
            {match.teams.map((team, teamIndex) => {
              const color = teamColor(team, teamColors, teamIndex === 0 ? "#1d4ed8" : "#be185d");
              return (
              <React.Fragment key={team.match_team_id}>
                <tr style={{ backgroundColor: `${color}80` }}>
                  <td
                    className="sticky left-0 z-10 px-3 py-3 text-[1.6rem] font-bold leading-none text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
                    style={{ background: `linear-gradient(rgba(0,0,0,.28), rgba(0,0,0,.28)), ${color}` }}
                  >
                    {team.tag}
                  </td>
                  <td colSpan={columns.length} className="px-3 py-3 text-white">
                    {team.name}
                    {team.team_penalties ? <span className="ml-3 text-sm text-rose-100">Penalty -{team.team_penalties}</span> : null}
                  </td>
                  <td className="px-3 py-3 text-center text-2xl font-bold text-white">{team.final_score}</td>
                  <td className={`px-3 py-3 text-center text-sm font-bold ${diffTextClass(teamDiff(teamIndex))}`}>
                    {signedValue(teamDiff(teamIndex))}
                  </td>
                </tr>
                {team.players.map((player, playerIndex) => {
                  const playerDiff = counterpartDiff(teamIndex, playerIndex);
                  return (
                  <tr key={player.match_player_id} className={playerIndex % 2 === 0 ? "bg-white/5" : "bg-white/[.025]"}>
                    <th className="sticky left-0 z-10 bg-zinc-950 px-3 py-2 text-left font-semibold text-white">
                      <span className="mr-2 text-xs text-blue-300">{medalLabel(playerIndex)}</span>
                      {player.name}
                    </th>
                    {columns.map((column) => {
                      const value = scoreColumnValue(player, column);
                      const textClass = groupByGp
                        ? groupedScoreClass(match, column, value)
                        : racePositionClass(player.positions[column.indexes[0]]);
                      return (
                      <td
                        key={`${player.match_player_id}-${column.key}`}
                        className={`${raceColumnClass} border-l border-white/10 px-2 py-2 text-center text-[1.05rem] font-semibold ${textClass}`}
                      >
                        {scoreValue(value)}
                      </td>
                    )})}
                    <td className="border-l border-white/20 px-3 py-2 text-center text-lg font-bold text-white">{player.total}</td>
                    <td className={`px-3 py-2 text-center text-sm font-bold ${diffTextClass(playerDiff)}`}>
                      {signedValue(playerDiff)}
                    </td>
                  </tr>
                )})}
              </React.Fragment>
            )})}
          </tbody>
        </table>
      </div>
      <DifferentialLineChart
        values={chartValues}
        teams={match.teams}
        chartMode={chartMode}
        finalDifferential={chartFinalDifferential}
      />
    </div>
  );
}

function VerticalDifferentialChart({
  values,
  leftTeam,
  rightTeam,
  chartMode,
}: {
  values: number[];
  leftTeam: MatchTeam;
  rightTeam: MatchTeam;
  chartMode: ChartMode;
}): React.JSX.Element {
  const width = 224;
  const rowHeight = 40;
  const height = Math.max(140, values.length * rowHeight);
  const paddingX = 6;
  const paddingY = rowHeight / 2;
  const penaltyOffset = chartMode === "cumulative" ? rightTeam.team_penalties - leftTeam.team_penalties : 0;
  const adjustedValues = values.map((value) => value + penaltyOffset);
  const hasNetPenalties = penaltyOffset !== 0;
  const { maxAbs, guides } = diffChartScale(values, adjustedValues);
  const xForValue = (value: number) => width / 2 - (value / maxAbs) * (width / 2 - paddingX);
  const makePoints = (series: number[]) => series.map((value, index) => {
    const x = xForValue(value);
    const y = values.length <= 1
      ? height / 2
      : paddingY + (index * (height - paddingY * 2)) / (values.length - 1);
    return `${x},${y}`;
  });
  const points = makePoints(values);
  const penaltyPoints = makePoints(adjustedValues);

  return (
    <div className="flex min-w-56 flex-col items-center">
      <div className="mb-1 grid w-full grid-cols-3 px-2 text-xs font-bold tracking-wide text-gray-200">
        <span className="truncate text-left">{leftTeam.tag}</span>
        <span className="text-center">0</span>
        <span className="truncate text-right">{rightTeam.tag}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-56 overflow-visible" style={{ height }} role="img">
        {guides.flatMap((value) => [
          <line
            key={`left-${value}`}
            x1={xForValue(value)}
            y1={paddingY}
            x2={xForValue(value)}
            y2={height - paddingY}
            stroke="rgba(255,255,255,.16)"
            strokeDasharray="4 6"
          />,
          <line
            key={`right-${value}`}
            x1={xForValue(-value)}
            y1={paddingY}
            x2={xForValue(-value)}
            y2={height - paddingY}
            stroke="rgba(255,255,255,.16)"
            strokeDasharray="4 6"
          />,
        ])}
        <line x1={width / 2} y1={paddingY} x2={width / 2} y2={height - paddingY} stroke="rgba(255,255,255,.35)" />
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="#60a5fa"
          strokeWidth="4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hasNetPenalties && (
          <polyline
            points={penaltyPoints.join(" ")}
            fill="none"
            stroke="#f87171"
            strokeWidth="3"
            strokeDasharray="6 6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {values.map((value, index) => {
          const [x, y] = points[index].split(",").map(Number);
          const nearLeftEdge = x < 28;
          const nearRightEdge = x > width - 28;
          const labelAnchor = nearLeftEdge ? "start" : nearRightEdge ? "end" : value > 0 ? "end" : value < 0 ? "start" : "middle";
          const labelX = nearLeftEdge ? x + 7 : nearRightEdge ? x - 7 : value > 0 ? x - 7 : value < 0 ? x + 7 : x;
          return (
            <g key={index}>
              <circle cx={x} cy={y} r="4" fill="#dbeafe" />
              <text x={labelX} y={y + 4} textAnchor={labelAnchor} fontSize="10" fill="white">
                {value > 0 ? `+${value}` : value}
              </text>
            </g>
          );
        })}
      </svg>
      {hasNetPenalties && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-rose-200">
          <span className="inline-block h-px w-5 border-t-2 border-dashed border-rose-300" />
          <span>{penaltyOffset > 0 ? "+" : ""}{penaltyOffset}</span>
        </div>
      )}
    </div>
  );
}

function VerticalScorecard({
  match,
  teamColors,
  chartMode,
}: {
  match: MatchDetail;
  teamColors: TeamColors;
  chartMode: ChartMode;
}): React.JSX.Element {
  const leftTeam = match.teams[0];
  const rightTeam = match.teams[1];
  if (!leftTeam || !rightTeam) return <p className="text-gray-300">Match table requires two teams.</p>;

  const leftPlayers = [...leftTeam.players].sort((a, b) => b.total - a.total);
  const rightPlayers = [...rightTeam.players].sort((a, b) => b.total - a.total);
  const finalDiff = leftTeam.final_score - rightTeam.final_score;
  const leftColor = teamColor(leftTeam, teamColors, "#1d4ed8");
  const rightColor = teamColor(rightTeam, teamColors, "#be185d");
  const chartValues = chartDifferentialValues(match.differential, chartMode);
  const leftPlayerDiff = (playerIndex: number): number | null => {
    const player = leftPlayers[playerIndex];
    const counterpart = rightPlayers[playerIndex];
    if (!player || !counterpart) return null;
    return player.total - counterpart.total;
  };
  const rightPlayerDiff = (playerIndex: number): number | null => {
    const player = rightPlayers[playerIndex];
    const counterpart = leftPlayers[playerIndex];
    if (!player || !counterpart) return null;
    return player.total - counterpart.total;
  };

  return (
    <div className="overflow-x-auto rounded-md border border-white/10 bg-black/70">
      <table className="min-w-[1100px] w-full border-collapse text-sm">
        <thead>
          <tr className="bg-black/80 text-white">
            <th className="px-3 py-3 text-left">Track</th>
            <th colSpan={leftPlayers.length} className="px-3 py-3 text-center text-[1.6rem] font-bold leading-none" style={{ backgroundColor: `${leftColor}aa` }}>
              {leftTeam.tag}
            </th>
            <th className="px-3 py-3 text-center">Diff</th>
            <th colSpan={rightPlayers.length} className="px-3 py-3 text-center text-[1.6rem] font-bold leading-none" style={{ backgroundColor: `${rightColor}aa` }}>
              {rightTeam.tag}
            </th>
          </tr>
          <tr className="bg-zinc-950 text-xs text-gray-200">
            <th className="px-3 py-2"></th>
            {leftPlayers.map((player, playerIndex) => (
              <VerticalPlayerHeader
                key={player.match_player_id}
                player={player}
                rank={playerIndex + 1}
              />
            ))}
            <th className="px-2 py-2"></th>
            {rightPlayers.map((player, playerIndex) => (
              <VerticalPlayerHeader
                key={player.match_player_id}
                player={player}
                rank={playerIndex + 1}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {match.tracks.map((track, raceIndex) => (
            <tr key={track.race_number}>
              <th className="max-w-56 px-3 py-2 text-left text-[15px] font-semibold text-gray-100">
                <span className="mr-2 text-blue-300">R{track.race_number}</span>
                {track.name}
              </th>
              {leftPlayers.map((player, playerIndex) => (
                <td
                  key={`${player.match_player_id}-${track.race_number}`}
                  className={`w-[4.5rem] min-w-[4.5rem] max-w-[4.5rem] border-l border-white/10 px-2 py-2 text-center text-[1.05rem] font-semibold ${racePositionClass(player.positions[raceIndex])} ${playerIndex % 2 === 0 ? "bg-white/5" : "bg-white/[.025]"}`}
                >
                  {scoreValue(player.scores[raceIndex])}
                </td>
              ))}
              {raceIndex === 0 && (
                <td rowSpan={match.tracks.length} className="w-56 min-w-56 border-x border-white/20 bg-black/25 px-1 py-1 align-top">
                  <VerticalDifferentialChart values={chartValues} leftTeam={leftTeam} rightTeam={rightTeam} chartMode={chartMode} />
                </td>
              )}
              {rightPlayers.map((player, playerIndex) => (
                <td
                  key={`${player.match_player_id}-${track.race_number}`}
                  className={`w-[4.5rem] min-w-[4.5rem] max-w-[4.5rem] border-l border-white/10 px-2 py-2 text-center text-[1.05rem] font-semibold ${racePositionClass(player.positions[raceIndex])} ${playerIndex % 2 === 0 ? "bg-white/5" : "bg-white/[.025]"}`}
                >
                  {scoreValue(player.scores[raceIndex])}
                </td>
              ))}
            </tr>
          ))}
          <tr className="bg-black/90 text-white">
            <th className="px-3 py-3 text-left">Final</th>
            {leftPlayers.map((player) => (
              <td key={player.match_player_id} className="px-2 py-3 text-center font-bold">{player.total}</td>
            ))}
            <td className="px-2 py-3 text-center font-bold">{signedValue(finalDiff)}</td>
            {rightPlayers.map((player) => (
              <td key={player.match_player_id} className="px-2 py-3 text-center font-bold">{player.total}</td>
            ))}
          </tr>
          <tr className="bg-black/85 text-white">
            <th className="px-3 py-2.5 text-left text-xs uppercase tracking-wide text-gray-300">Player diff</th>
            {leftPlayers.map((player, playerIndex) => {
              const diff = leftPlayerDiff(playerIndex);
              return (
                <td key={player.match_player_id} className={`px-2 py-2.5 text-center text-sm font-bold ${diffTextClass(diff)}`}>
                  {signedValue(diff)}
                </td>
              );
            })}
            <td className="px-2 py-2.5"></td>
            {rightPlayers.map((player, playerIndex) => {
              const diff = rightPlayerDiff(playerIndex);
              return (
                <td key={player.match_player_id} className={`px-2 py-2.5 text-center text-sm font-bold ${diffTextClass(diff)}`}>
                  {signedValue(diff)}
                </td>
              );
            })}
          </tr>
          <tr className="bg-black/80 text-white">
            <th className="px-3 py-2.5 text-left">Team total</th>
            <td colSpan={leftPlayers.length} className="px-3 py-2.5 text-center text-2xl font-bold">
              {leftTeam.final_score}
              <span className={`ml-3 text-sm ${diffTextClass(finalDiff)}`}>{signedValue(finalDiff)}</span>
            </td>
            <td className="px-3 py-2.5"></td>
            <td colSpan={rightPlayers.length} className="px-3 py-2.5 text-center text-2xl font-bold">
              {rightTeam.final_score}
              <span className={`ml-3 text-sm ${diffTextClass(-finalDiff)}`}>{signedValue(-finalDiff)}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function MatchHistory(): React.JSX.Element {
  const {
    seasons,
    divisions,
    season,
    division,
    loadingScope,
    scopeError,
    setSeason,
    setDivision,
  } = useSeasonDivision();
  const [teams, setTeams] = useState<string[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [matchDetail, setMatchDetail] = useState<MatchDetail | null>(null);
  const [tableMode, setTableMode] = useState<TableMode>("traditional");
  const [chartMode, setChartMode] = useState<ChartMode>("cumulative");
  const [groupByGp, setGroupByGp] = useState(true);
  const [teamColors, setTeamColors] = useState<TeamColors>({});
  const [teamColorInputs, setTeamColorInputs] = useState<Record<number, string>>({});
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadTeams() {
      if (!season || !division) return;
      setTeams([]);
      setSelectedTeam("");
      try {
        const data = await fetchJson<string[]>("/api/teams", { season, division });
        if (cancelled) return;
        setTeams([...data].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
      } catch (err) {
        if (!cancelled) setError("Failed to load teams.");
      }
    }
    loadTeams();
    return () => {
      cancelled = true;
    };
  }, [season, division]);

  useEffect(() => {
    let cancelled = false;
    async function loadMatches() {
      if (!season || !division) return;
      setLoadingMatches(true);
      setError("");
      setMatches([]);
      setSelectedMatchId(null);
      setMatchDetail(null);
      try {
        const data = await fetchJson<MatchSummary[]>("/api/matches", {
          season,
          division,
          team: selectedTeam || undefined,
        });
        if (cancelled) return;
        setMatches(data);
        setSelectedMatchId(data[0]?.match_id ?? null);
      } catch (err) {
        if (!cancelled) setError("Failed to load matches.");
      } finally {
        if (!cancelled) setLoadingMatches(false);
      }
    }
    loadMatches();
    return () => {
      cancelled = true;
    };
  }, [season, division, selectedTeam]);

  useEffect(() => {
    let cancelled = false;
    async function loadDetail() {
      if (!selectedMatchId) return;
      setLoadingDetail(true);
      setError("");
      try {
        const data = await fetchJson<MatchDetail>(`/api/matches/${selectedMatchId}`);
        if (!cancelled) setMatchDetail(data);
      } catch (err) {
        if (!cancelled) setError("Failed to load match.");
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    }
    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedMatchId]);

  const selectedSummary = useMemo(
    () => matches.find((match) => match.match_id === selectedMatchId) ?? null,
    [matches, selectedMatchId]
  );
  const combinedError = scopeError || error;

  return (
    <div className="relative min-h-screen text-white font-sans p-6">
      <div className="fixed top-0 left-0 right-0 bg-black/40 backdrop-blur-sm p-4 z-50">
        <div className="flex justify-between items-center max-w-7xl mx-auto px-2">
          <Link to="/" className="text-blue-400 hover:text-blue-300 font-semibold">
            &lt; Back
          </Link>
          <h1 className="text-3xl font-bold text-center flex-1">Match History</h1>
          <div className="w-32"></div>
          <img
            src="/images/CTC_LOGO/ctclogo.webp"
            alt="Logo"
            className="w-12 h-12 rounded-lg"
            loading="lazy"
          />
        </div>
      </div>

      <div className="pt-24 max-w-7xl mx-auto">
        {combinedError && <p className="mb-4 text-center text-red-300">{combinedError}</p>}

        <div className="mb-6 flex flex-col gap-4 rounded-md border border-white/10 bg-black/55 p-4 md:flex-row md:items-end">
          <SeasonDivisionSelector
            season={season}
            division={division}
            seasons={seasons}
            divisions={divisions}
            disabled={loadingScope}
            onSeasonChange={setSeason}
            onDivisionChange={setDivision}
          />

          <div>
            <label className="block font-semibold mb-1">Team</label>
            <select
              className="min-w-40 rounded-md border border-gray-400 bg-white px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedTeam}
              onChange={(event) => setSelectedTeam(event.target.value)}
              disabled={!division || teams.length === 0}
            >
              <option value="">All teams</option>
              {teams.map((team) => (
                <option key={team} value={team}>{team}</option>
              ))}
            </select>
          </div>

          <div className="min-w-72 flex-1">
            <label className="block font-semibold mb-1">Match</label>
            <select
              className="w-full rounded-md border border-gray-400 bg-white px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedMatchId ?? ""}
              onChange={(event) => setSelectedMatchId(Number(event.target.value))}
              disabled={loadingMatches || matches.length === 0}
            >
              {matches.map((match) => (
                <option key={match.match_id} value={match.match_id}>
                  {match.week ? `W${match.week} - ` : ""}{match.teams} ({match.scores})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-1">Format</label>
            <div className="inline-flex overflow-hidden rounded-md border border-white/20 bg-black/40">
              <button
                type="button"
                className={`px-4 py-2 text-sm font-semibold ${tableMode === "traditional" ? "bg-blue-500 text-white" : "text-gray-200 hover:bg-white/10"}`}
                onClick={() => setTableMode("traditional")}
              >
                Traditional
              </button>
              <button
                type="button"
                className={`px-4 py-2 text-sm font-semibold ${tableMode === "vertical" ? "bg-blue-500 text-white" : "text-gray-200 hover:bg-white/10"}`}
                onClick={() => setTableMode("vertical")}
              >
                Vertical
              </button>
            </div>
          </div>

          {matchDetail && (
            <details className="min-w-[10.25rem] w-max max-w-full rounded-md border border-white/15 bg-black/35 px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold text-gray-100">Colors</summary>
              <div className="mt-3 grid grid-cols-[max-content_2.5rem_5.5rem] items-center gap-x-2 gap-y-2">
                {matchDetail.teams.map((team, teamIndex) => {
                  const fallback = teamIndex === 0 ? "#1d4ed8" : "#be185d";
                  const color = teamColor(team, teamColors, fallback);
                  const colorInput = teamColorInputs[team.match_team_id] ?? color;
                  return (
                    <label key={team.match_team_id} className="contents text-sm text-gray-200">
                      <span className="max-w-48 justify-self-end whitespace-normal break-words text-right text-sm text-gray-200">{team.tag}</span>
                      <input
                        type="color"
                        className="h-8 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
                        value={color}
                        onChange={(event) => {
                          const nextColor = event.target.value.toUpperCase();
                          setTeamColorInputs((current) => ({
                            ...current,
                            [team.match_team_id]: nextColor,
                          }));
                          setTeamColors((current) => ({
                            ...current,
                            [team.match_team_id]: nextColor,
                          }));
                        }}
                      />
                      <input
                        type="text"
                        className="w-full rounded border border-white/20 bg-black/45 px-2 py-1 text-center font-mono text-xs text-white outline-none focus:border-blue-300"
                        value={colorInput}
                        onChange={(event) => {
                          const nextValue = event.target.value.toUpperCase();
                          setTeamColorInputs((current) => ({
                            ...current,
                            [team.match_team_id]: nextValue,
                          }));
                          const normalized = normalizeHexColor(nextValue);
                          if (!normalized) return;
                          setTeamColors((current) => ({
                            ...current,
                            [team.match_team_id]: normalized,
                          }));
                        }}
                        onBlur={() => {
                          const normalized = normalizeHexColor(colorInput) ?? color;
                          setTeamColorInputs((current) => ({
                            ...current,
                            [team.match_team_id]: normalized,
                          }));
                        }}
                        aria-label={`${team.tag} hex color`}
                      />
                    </label>
                  );
                })}
              </div>
            </details>
          )}
        </div>

        {loadingDetail && (
          <div className="text-center">
            <div className="inline-block">
              <div className="animate-spin h-8 w-8 border-4 border-blue-400 border-t-transparent rounded-full"></div>
              <p className="mt-2 text-gray-300">Loading match...</p>
            </div>
          </div>
        )}

        {!loadingDetail && matchDetail && (
          <div className="space-y-6">
            <section className="rounded-md border border-white/10 bg-black/60 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-wide text-blue-200">
                    {matchDetail.season.toUpperCase()} / {matchDetail.division.toUpperCase()}
                    {matchDetail.week ? ` / Week ${matchDetail.week}` : ""}
                  </p>
                  <h2 className="mt-1 text-3xl font-bold">{selectedSummary?.teams || matchDetail.label}</h2>
                  <p className="mt-1 text-gray-300">
                    {matchDetail.races_played} races
                    {matchDetail.format ? ` / ${matchDetail.format}` : ""}
                    {selectedSummary?.scores ? ` / ${selectedSummary.scores}` : ""}
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-300">Diff chart</label>
                    <div className="inline-flex overflow-hidden rounded-md border border-white/20 bg-black/40">
                      <button
                        type="button"
                        className={`px-3 py-1.5 text-sm font-semibold ${chartMode === "cumulative" ? "bg-blue-500 text-white" : "text-gray-200 hover:bg-white/10"}`}
                        onClick={() => setChartMode("cumulative")}
                      >
                        Cumulative
                      </button>
                      <button
                        type="button"
                        className={`px-3 py-1.5 text-sm font-semibold ${chartMode === "perRace" ? "bg-blue-500 text-white" : "text-gray-200 hover:bg-white/10"}`}
                        onClick={() => setChartMode("perRace")}
                      >
                        Per race
                      </button>
                    </div>
                  </div>
                  {tableMode === "traditional" && (
                    <label className="inline-flex items-center gap-2 text-sm text-gray-200 sm:mt-5">
                      <input
                        type="checkbox"
                        checked={groupByGp}
                        onChange={(event) => setGroupByGp(event.target.checked)}
                      />
                      GP grouping
                    </label>
                  )}
                </div>
              </div>
            </section>

            {tableMode === "traditional" ? (
              <TraditionalTable match={matchDetail} groupByGp={groupByGp} teamColors={teamColors} chartMode={chartMode} />
            ) : (
              <VerticalScorecard match={matchDetail} teamColors={teamColors} chartMode={chartMode} />
            )}

            <TrackList tracks={matchDetail.tracks} />
          </div>
        )}

        {!loadingMatches && matches.length === 0 && (
          <p className="text-center text-gray-300">No matches found.</p>
        )}
      </div>
    </div>
  );
}

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

function scoreValue(score: number | null): string {
  return score === null || score === undefined ? "-" : String(score);
}

function medalLabel(index: number): string {
  if (index === 0) return "1st";
  if (index === 1) return "2nd";
  if (index === 2) return "3rd";
  return `${index + 1}th`;
}

function scoreClass(score: number | null): string {
  if (score === null || score === undefined) return "text-gray-500";
  if (score >= 12) return "text-emerald-300";
  if (score <= 1) return "text-rose-300";
  return "text-white";
}

function teamShade(hexColor: string, fallback: string): string {
  return hexColor || fallback;
}

function DifferentialLineChart({ values }: { values: number[] }): React.JSX.Element {
  const width = 720;
  const height = 150;
  const padding = 18;
  const finalDiff = values.at(-1) ?? 0;
  const maxAbs = Math.max(10, ...values.map((value) => Math.abs(value)));
  const points = values.map((value, index) => {
    const x = values.length <= 1
      ? width / 2
      : padding + (index * (width - padding * 2)) / (values.length - 1);
    const y = height / 2 - (value / maxAbs) * (height / 2 - padding);
    return `${x},${y}`;
  });

  return (
    <div className="rounded-md border border-white/10 bg-black/40 p-3">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-gray-300">
        <span>Race differential</span>
        <span>Final {finalDiff > 0 ? "+" : ""}{finalDiff}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full" role="img">
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="rgba(255,255,255,.35)" />
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="#60a5fa"
          strokeWidth="4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
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
    </div>
  );
}

function TrackList({ tracks }: { tracks: Track[] }): React.JSX.Element {
  return (
    <div className="rounded-md border border-white/10 bg-black/45 p-4">
      <h2 className="mb-3 text-lg font-semibold text-white">Tracks</h2>
      <ol className="grid gap-2 text-sm text-gray-200 sm:grid-cols-2 lg:grid-cols-3">
        {tracks.map((track) => (
          <li key={track.race_number} className="flex gap-2 rounded bg-white/5 px-3 py-2">
            <span className="font-semibold text-blue-300">R{track.race_number}</span>
            <span>{track.name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TraditionalTable({ match, groupByGp }: { match: MatchDetail; groupByGp: boolean }): React.JSX.Element {
  const raceNumbers = match.tracks.map((track) => track.race_number);
  const leadingTeam = match.teams[0];
  const trailingTeam = match.teams[1];
  const finalDiff = leadingTeam && trailingTeam ? leadingTeam.final_score - trailingTeam.final_score : 0;

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded-md border border-white/10 bg-black/70">
        <table className="min-w-[980px] w-full border-collapse text-sm">
          <thead>
            <tr className="bg-black/80 text-gray-200">
              <th className="sticky left-0 z-10 bg-black/90 px-3 py-3 text-left">Team / Player</th>
              {raceNumbers.map((raceNumber, index) => (
                <th
                  key={raceNumber}
                  className={`px-2 py-3 text-center ${groupByGp && index > 0 && index % 4 === 0 ? "border-l-4 border-white/30" : "border-l border-white/10"}`}
                >
                  R{raceNumber}
                </th>
              ))}
              <th className="border-l border-white/20 px-3 py-3 text-center">Total</th>
              <th className="px-3 py-3 text-center">Rank</th>
            </tr>
          </thead>
          <tbody>
            {match.teams.map((team) => (
              <React.Fragment key={team.match_team_id}>
                <tr style={{ backgroundColor: `${teamShade(team.hex_color, "#1d4ed8")}99` }}>
                  <td className="sticky left-0 z-10 px-3 py-3 text-lg font-bold text-white" style={{ backgroundColor: teamShade(team.hex_color, "#1d4ed8") }}>
                    {team.tag}
                  </td>
                  <td colSpan={raceNumbers.length} className="px-3 py-3 text-white">
                    {team.name}
                    {team.team_penalties ? <span className="ml-3 text-sm text-rose-100">Penalty -{team.team_penalties}</span> : null}
                  </td>
                  <td className="px-3 py-3 text-center text-2xl font-bold text-white">{team.final_score}</td>
                  <td className="px-3 py-3 text-center text-sm text-white">
                    {team === leadingTeam && finalDiff !== 0 ? `${finalDiff > 0 ? "+" : ""}${finalDiff}` : ""}
                  </td>
                </tr>
                {team.players.map((player, playerIndex) => (
                  <tr key={player.match_player_id} className={playerIndex % 2 === 0 ? "bg-white/5" : "bg-white/[.025]"}>
                    <th className="sticky left-0 z-10 bg-zinc-950 px-3 py-2 text-left font-semibold text-white">
                      <span className="mr-2 text-xs text-blue-300">{medalLabel(playerIndex)}</span>
                      {player.name}
                    </th>
                    {raceNumbers.map((raceNumber, index) => (
                      <td
                        key={`${player.match_player_id}-${raceNumber}`}
                        className={`px-2 py-2 text-center font-semibold ${scoreClass(player.scores[index])} ${groupByGp && index > 0 && index % 4 === 0 ? "border-l-4 border-white/30" : "border-l border-white/10"}`}
                      >
                        {scoreValue(player.scores[index])}
                      </td>
                    ))}
                    <td className="border-l border-white/20 px-3 py-2 text-center text-lg font-bold text-white">{player.total}</td>
                    <td className="px-3 py-2 text-center text-xs text-gray-300">{player.subbed_out ? "sub" : ""}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <DifferentialLineChart values={match.differential} />
    </div>
  );
}

function RaceDiffCell({ value }: { value: number }): React.JSX.Element {
  const max = Math.max(30, Math.abs(value));
  const width = Math.min(48, Math.round((Math.abs(value) / max) * 48));
  return (
    <div className="relative h-9 min-w-28">
      <div className="absolute left-1/2 top-0 h-full w-px bg-white/40" />
      <div
        className={`absolute top-3 h-3 rounded ${value >= 0 ? "left-1/2 bg-blue-400" : "right-1/2 bg-rose-400"}`}
        style={{ width }}
      />
      <span className="absolute left-0 right-0 top-0 text-center text-xs font-semibold text-white">
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
  );
}

function VerticalScorecard({ match }: { match: MatchDetail }): React.JSX.Element {
  const leftTeam = match.teams[0];
  const rightTeam = match.teams[1];
  if (!leftTeam || !rightTeam) return <p className="text-gray-300">Match table requires two teams.</p>;

  const leftPlayers = [...leftTeam.players].sort((a, b) => b.total - a.total);
  const rightPlayers = [...rightTeam.players].sort((a, b) => a.total - b.total);
  const finalDiff = leftTeam.final_score - rightTeam.final_score;

  return (
    <div className="overflow-x-auto rounded-md border border-white/10 bg-black/70">
      <table className="min-w-[1100px] w-full border-collapse text-sm">
        <thead>
          <tr className="bg-black/80 text-white">
            <th className="px-3 py-3 text-left">Track</th>
            <th colSpan={leftPlayers.length} className="px-3 py-3 text-center" style={{ backgroundColor: `${leftTeam.hex_color}aa` }}>
              {leftTeam.tag}
            </th>
            <th className="px-3 py-3 text-center">Diff</th>
            <th colSpan={rightPlayers.length} className="px-3 py-3 text-center" style={{ backgroundColor: `${rightTeam.hex_color}aa` }}>
              {rightTeam.tag}
            </th>
          </tr>
          <tr className="bg-zinc-950 text-xs text-gray-200">
            <th className="px-3 py-2"></th>
            {leftPlayers.map((player) => (
              <th key={player.match_player_id} className="h-28 w-12 px-1 py-2 align-bottom">
                <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{player.name}</span>
              </th>
            ))}
            <th className="px-2 py-2"></th>
            {rightPlayers.map((player) => (
              <th key={player.match_player_id} className="h-28 w-12 px-1 py-2 align-bottom">
                <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{player.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {match.tracks.map((track, raceIndex) => (
            <tr key={track.race_number} className={raceIndex % 2 === 0 ? "bg-white/5" : "bg-white/[.025]"}>
              <th className="max-w-56 px-3 py-2 text-left text-xs font-semibold text-gray-100">
                <span className="mr-2 text-blue-300">R{track.race_number}</span>
                {track.name}
              </th>
              {leftPlayers.map((player) => (
                <td key={`${player.match_player_id}-${track.race_number}`} className={`border-l border-white/10 px-2 py-2 text-center font-semibold ${scoreClass(player.scores[raceIndex])}`}>
                  {scoreValue(player.scores[raceIndex])}
                </td>
              ))}
              <td className="border-x border-white/20 px-2 py-1">
                <RaceDiffCell value={match.differential[raceIndex] ?? 0} />
              </td>
              {rightPlayers.map((player) => (
                <td key={`${player.match_player_id}-${track.race_number}`} className={`border-l border-white/10 px-2 py-2 text-center font-semibold ${scoreClass(player.scores[raceIndex])}`}>
                  {scoreValue(player.scores[raceIndex])}
                </td>
              ))}
            </tr>
          ))}
          <tr className="bg-black/90 text-white">
            <th className="px-3 py-4 text-left">Final</th>
            {leftPlayers.map((player) => (
              <td key={player.match_player_id} className="px-2 py-4 text-center font-bold">{player.total}</td>
            ))}
            <td className="px-2 py-4 text-center font-bold">{finalDiff > 0 ? `+${finalDiff}` : finalDiff}</td>
            {rightPlayers.map((player) => (
              <td key={player.match_player_id} className="px-2 py-4 text-center font-bold">{player.total}</td>
            ))}
          </tr>
          <tr className="bg-black/80 text-white">
            <th className="px-3 py-3 text-left">Team total</th>
            <td colSpan={leftPlayers.length} className="px-3 py-3 text-center text-2xl font-bold">{leftTeam.final_score}</td>
            <td className="px-3 py-3 text-center text-xs text-gray-300">0</td>
            <td colSpan={rightPlayers.length} className="px-3 py-3 text-center text-2xl font-bold">{rightTeam.final_score}</td>
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
  const [groupByGp, setGroupByGp] = useState(true);
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
                {tableMode === "traditional" && (
                  <label className="inline-flex items-center gap-2 text-sm text-gray-200">
                    <input
                      type="checkbox"
                      checked={groupByGp}
                      onChange={(event) => setGroupByGp(event.target.checked)}
                    />
                    GP grouping
                  </label>
                )}
              </div>
            </section>

            {tableMode === "traditional" ? (
              <TraditionalTable match={matchDetail} groupByGp={groupByGp} />
            ) : (
              <VerticalScorecard match={matchDetail} />
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

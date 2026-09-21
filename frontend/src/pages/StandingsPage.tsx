import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchJson, resolveAssetUrl, type TeamScope } from "../api";
import { BackToHomeLink } from "../components/BackToHomeLink";
import { LeagueHeaderControls } from "../components/LeagueHeaderControls";
import SeasonDivisionSelector from "../components/SeasonDivisionSelector";
import TeamCompetitionStatusManager from "../components/TeamCompetitionStatusManager";
import { useLeague } from "../context/LeagueContext";
import { useAdminSession } from "../hooks/useAdminSession";
import { useSeasonDivision } from "../hooks/useSeasonDivision";
import { matchHistoryPath } from "../matchHistoryLinks";

type CompetitionStatus = "active" | "dropped" | "disqualified";
type Standing = {
  rank: number;
  conference_rank?: number;
  team_id: number;
  team_season_entry_id: number;
  name: string;
  tag: string;
  logo_url: string;
  hex_color: string | null;
  status: CompetitionStatus;
  status_note: string | null;
  played: number;
  wins: number;
  ties: number;
  losses: number;
  points_for: number;
  points_against: number;
  point_differential: number;
  standings_points: number;
  bonus_points: number;
  head_to_head_differential: number;
  conference: { id: number; code: string; name: string; sort_order: number } | null;
};
type MatchResult = {
  match_id: number;
  match_number: number;
  label: string;
  result_type: "played" | "free_win" | "mutual_tie";
  standings_adjusted: boolean;
  teams: Array<{
    team_id: number;
    team_season_entry_id: number;
    tag: string;
    adjusted_score: number;
    adjusted_opponent_score: number;
    original_score: number;
    original_opponent_score: number;
    standings_points: number;
    outcome: "win" | "tie" | "loss";
  }>;
};
type LeaderboardPlayer = {
  player_id: number;
  name: string;
  team_id: number;
  team_tag: string;
  team_status: CompetitionStatus;
  gps_played: number;
  team_gps: number;
  required_gps: number;
  eligible: boolean;
  eligibility_reason: string | null;
  runner_gps_played: number;
  runner_eligible: boolean;
  runner_eligibility_reason: string | null;
  runner_points: number;
  runner_races: number;
  runner_gp_average: number | null;
  bagger_gps_played: number;
  bagger_eligible: boolean;
  bagger_eligibility_reason: string | null;
  bagger_points: number;
  bagger_races: number;
  bagger_gp_average: number | null;
};
type PlayoffSeries = {
  playoff_series_id: number;
  stage: "semifinals" | "finals";
  label: string;
  best_of: number;
  status: "in_progress" | "complete";
  winner_team_id: number | null;
  participants: Array<{ team_id: number; tag: string; name: string; wins: number }>;
  matches: Array<{
    match_id: number;
    label: string;
    teams: Array<{ team_id: number; tag: string; score: number }>;
  }>;
};
type StandingsResponse = {
  league: string;
  season: string;
  division: string;
  standings: Standing[];
  conferences: Array<{
    id: number;
    code: string;
    name: string;
    standings: Standing[];
  }>;
  conference_config: { enabled: boolean; valid: boolean };
  playoff_qualification: {
    team_count: number | null;
    seeds: Array<{
      seed: number;
      team_id: number;
      tag: string;
      name: string;
      qualification: "conference_winner" | "wild_card" | "league_table";
    }>;
  };
  matches: MatchResult[];
  leaderboard: LeaderboardPlayer[];
  playoffs: { format: unknown; series: PlayoffSeries[] };
};

const DEFAULT_PAGE_SIZE = 20;
const FALLBACK_LEADERBOARD_ROW_HEIGHT = 37;
const MAX_LEADERBOARD_TEXT_SIZE = 14;
const ELIGIBILITY_OPTIONS = [
  { value: true, label: "Eligible players" },
  { value: false, label: "All players" },
] as const;
const POINT_TYPE_OPTIONS = [
  { value: "runner", label: "Running points" },
  { value: "bagger", label: "Bagging points" },
] as const;

function leaderboardRankClass(rank: number): string {
  if (rank === 1)
    return "border-amber-300/30 bg-amber-950/35 text-[#FFE66D] drop-shadow-[0_0_5px_rgba(255,215,0,0.55)]";
  if (rank === 2)
    return "border-slate-200/25 bg-slate-700/30 text-[#E5F0FF] drop-shadow-[0_0_5px_rgba(147,197,253,0.55)]";
  if (rank === 3)
    return "border-orange-300/25 bg-orange-950/30 text-[#F6A04D] drop-shadow-[0_0_5px_rgba(246,160,77,0.5)]";
  return "border-white/10 bg-black/45 text-white odd:bg-white/[0.04]";
}

function AutoFitLeaderboardText({ text }: { text: string }): React.JSX.Element {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = textRef.current;
    if (!container || !content || content.textContent !== text) return;

    let animationFrame = 0;
    let active = true;
    const fit = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        content.style.fontSize = `${MAX_LEADERBOARD_TEXT_SIZE}px`;
        const availableWidth = Math.max(0, container.clientWidth - 2);
        const naturalWidth = content.getBoundingClientRect().width;
        if (!availableWidth || naturalWidth <= availableWidth) return;

        const fittedSize = Math.max(1, MAX_LEADERBOARD_TEXT_SIZE * (availableWidth / naturalWidth));
        content.style.fontSize = `${fittedSize}px`;
      });
    };

    const observer = new ResizeObserver(fit);
    observer.observe(container);
    document.fonts.ready.then(() => {
      if (active) fit();
    });
    fit();
    return () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [text]);

  return (
    <span
      ref={containerRef}
      data-fit-text={text}
      className="block w-full min-w-0 overflow-hidden text-center"
    >
      <span
        ref={textRef}
        data-fit-content="true"
        className="inline-block whitespace-nowrap align-middle"
        style={{ fontSize: MAX_LEADERBOARD_TEXT_SIZE }}
      >
        {text}
      </span>
    </span>
  );
}

function StatusBadge({ status, note }: { status: CompetitionStatus; note?: string | null }) {
  if (status === "active") return null;
  return (
    <span
      title={note || undefined}
      className={`ml-2 inline-flex rounded-full border px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${
        status === "disqualified"
          ? "border-red-300/40 bg-red-950/70 text-red-200"
          : "border-amber-300/40 bg-amber-950/70 text-amber-200"
      }`}
    >
      {status === "disqualified" ? "DQ" : "Dropped"}
    </span>
  );
}

function TeamIdentity({
  team,
  centered = false,
  truncateName = true,
}: {
  team: Standing;
  centered?: boolean;
  truncateName?: boolean;
}) {
  const { leaguePath } = useLeague();
  return (
    <Link
      to={leaguePath(`/teams/${team.team_id}`)}
      className={`flex items-center gap-2 font-semibold text-white hover:underline ${truncateName ? "min-w-0" : "w-max min-w-full whitespace-nowrap"} ${centered ? "justify-center" : ""}`}
    >
      <img
        src={resolveAssetUrl(team.logo_url)}
        alt=""
        className="h-8 w-8 shrink-0 rounded-full bg-black/35 object-contain"
      />
      <span className={truncateName ? "truncate" : "whitespace-nowrap"}>{team.name}</span>
      <span className="shrink-0 text-xs text-gray-400">{team.tag}</span>
      <StatusBadge status={team.status} note={team.status_note} />
    </Link>
  );
}

function StandingsTable({ standings }: { standings: Standing[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead className="league-accent-bg text-black">
          <tr>
            <th className="px-3 py-3 text-center">#</th>
            <th className="border-l border-black/20 px-3 py-3 text-center">Team</th>
            {[
              ["P", "Played"],
              ["W", "Wins"],
              ["T", "Ties"],
              ["L", "Losses"],
              ["F", "Points for"],
              ["A", "Points against"],
              ["+/−", "Point differential"],
              ["Pts", "Standings points"],
            ].map(([label, title]) => (
              <th
                key={label}
                title={title}
                className="border-l border-black/20 px-3 py-3 text-center"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.map((team) => (
            <tr
              key={team.team_season_entry_id}
              className="border-b border-white/10 bg-black/45 odd:bg-white/[0.04]"
            >
              <td className="px-3 py-3 text-center text-gray-300">
                {team.conference_rank ?? team.rank}
              </td>
              <td className="min-w-64 border-l border-white/[0.08] px-3 py-3 text-center">
                <TeamIdentity team={team} centered />
              </td>
              <td className="border-l border-white/[0.08] px-3 py-3 text-center">{team.played}</td>
              <td className="border-l border-white/[0.08] px-3 py-3 text-center">{team.wins}</td>
              <td className="border-l border-white/[0.08] px-3 py-3 text-center">{team.ties}</td>
              <td className="border-l border-white/[0.08] px-3 py-3 text-center">{team.losses}</td>
              <td className="border-l border-white/[0.08] px-3 py-3 text-center">
                {team.points_for}
              </td>
              <td className="border-l border-white/[0.08] px-3 py-3 text-center">
                {team.points_against}
              </td>
              <td
                className={`border-l border-white/[0.08] px-3 py-3 text-center font-semibold ${team.point_differential > 0 ? "text-emerald-300" : team.point_differential < 0 ? "text-red-300" : ""}`}
              >
                {team.point_differential > 0 ? "+" : ""}
                {team.point_differential}
              </td>
              <td className="border-l border-white/[0.08] px-3 py-3 text-center text-lg font-black league-accent-text">
                {team.standings_points}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchupMatrix({
  standings,
  matches,
  season,
  division,
}: {
  standings: Standing[];
  matches: MatchResult[];
  season: string;
  division: string;
}) {
  const { leaguePath } = useLeague();
  const cells = useMemo(() => {
    const result = new Map<
      string,
      Array<MatchResult & { perspective: MatchResult["teams"][number] }>
    >();
    for (const match of matches) {
      for (const team of match.teams) {
        const opponent = match.teams.find(
          (candidate) => candidate.team_season_entry_id !== team.team_season_entry_id
        );
        if (!opponent) continue;
        const key = `${team.team_season_entry_id}:${opponent.team_season_entry_id}`;
        const list = result.get(key) ?? [];
        list.push({ ...match, perspective: team });
        result.set(key, list);
      }
    }
    return result;
  }, [matches]);

  return (
    <div className="overflow-x-auto">
      <table
        className="matchup-matrix w-full table-fixed border-collapse text-center text-xs"
        style={
          {
            "--matchup-team-column-width": "17rem",
            "--matchup-mobile-min-width": `${17 + standings.length * 5.5}rem`,
          } as CSSProperties
        }
      >
        <colgroup>
          <col style={{ width: "var(--matchup-team-column-width)" }} />
          {standings.map((team) => (
            <col
              key={team.team_season_entry_id}
              style={{
                width: `calc((100% - var(--matchup-team-column-width)) / ${standings.length})`,
              }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 whitespace-nowrap bg-zinc-950 px-3 py-2 text-left">
              Team
            </th>
            {standings.map((team) => (
              <th
                key={team.team_season_entry_id}
                className="border border-white/10 bg-black/70 px-1 py-2"
              >
                {team.tag}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.map((team) => (
            <tr key={team.team_season_entry_id}>
              <th className="sticky left-0 z-10 overflow-hidden border border-white/10 bg-zinc-950 py-3 pl-3 pr-4 text-left">
                <TeamIdentity team={team} truncateName={false} />
              </th>
              {standings.map((opponent) => {
                if (team.team_season_entry_id === opponent.team_season_entry_id)
                  return (
                    <td
                      key={opponent.team_season_entry_id}
                      className="overflow-hidden border border-white/10 bg-black/80 p-1"
                    >
                      <div className="mx-auto h-16 w-16 overflow-hidden">
                        <img
                          src={resolveAssetUrl(team.logo_url)}
                          alt=""
                          data-diagonal-logo="true"
                          className="h-full w-full object-cover opacity-70"
                        />
                      </div>
                    </td>
                  );
                const results =
                  cells.get(`${team.team_season_entry_id}:${opponent.team_season_entry_id}`) ?? [];
                return (
                  <td
                    key={opponent.team_season_entry_id}
                    className="border border-white/10 bg-black/40 p-2"
                  >
                    {results.length ? (
                      <div className="space-y-1">
                        {results.map((result) => (
                          <Link
                            key={result.match_id}
                            to={leaguePath(
                              matchHistoryPath({
                                season,
                                division,
                                matchId: result.match_id,
                              })
                            )}
                            title={
                              result.standings_adjusted
                                ? `Original score ${result.perspective.original_score}–${result.perspective.original_opponent_score}`
                                : result.label
                            }
                            className={`block rounded px-1.5 py-1 font-bold hover:ring-1 league-focus-ring ${
                              result.perspective.outcome === "win"
                                ? "bg-emerald-950/80 text-emerald-200"
                                : result.perspective.outcome === "tie"
                                  ? "bg-amber-950/80 text-amber-200"
                                  : "bg-red-950/70 text-red-200"
                            }`}
                          >
                            {result.perspective.adjusted_score}–
                            {result.perspective.adjusted_opponent_score}
                            <span className="ml-1 text-[0.6rem] opacity-75">
                              {`(${
                                result.result_type === "mutual_tie"
                                  ? 0
                                  : result.perspective.standings_points
                              } pts)`}
                            </span>
                            {result.standings_adjusted ? <span className="ml-1">*</span> : null}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-400">
        * Standings-adjusted result; open the match to see its preserved original score.
      </p>
    </div>
  );
}

function PlayerLeaderboard({
  players,
  season,
  division,
}: {
  players: LeaderboardPlayer[];
  season: string;
  division: string;
}) {
  const { leaguePath } = useLeague();
  const [eligibleOnly, setEligibleOnly] = useState(true);
  const [role, setRole] = useState<"runner" | "bagger">("runner");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const tableHeaderRef = useRef<HTMLTableRowElement>(null);
  const firstRowRef = useRef<HTMLTableRowElement>(null);
  const paginationRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const ranked = useMemo(() => {
    const metric = role === "runner" ? "runner_gp_average" : "bagger_gp_average";
    const eligibilityMetric = role === "runner" ? "runner_eligible" : "bagger_eligible";
    return players
      .filter((player) => !eligibleOnly || player[eligibilityMetric])
      .toSorted(
        (left, right) =>
          (right[metric] ?? -1) - (left[metric] ?? -1) || left.name.localeCompare(right.name)
      );
  }, [eligibleOnly, players, role]);
  const pageCount = Math.max(1, Math.ceil(ranked.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = ranked.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const metric = role === "runner" ? "runner_gp_average" : "bagger_gp_average";
  const eligibilityMetric = role === "runner" ? "runner_eligible" : "bagger_eligible";
  const eligibilityReasonMetric =
    role === "runner" ? "runner_eligibility_reason" : "bagger_eligibility_reason";
  const roleGpsMetric = role === "runner" ? "runner_gps_played" : "bagger_gps_played";

  useLayoutEffect(() => {
    const container = containerRef.current;
    const controls = controlsRef.current;
    const tableHeader = tableHeaderRef.current;
    const pagination = paginationRef.current;
    const note = noteRef.current;
    if (!container || !controls || !tableHeader || !pagination || !note) return;

    let animationFrame = 0;
    const measure = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const gap = Number.parseFloat(window.getComputedStyle(container).rowGap) || 0;
        const fixedHeight =
          controls.getBoundingClientRect().height +
          tableHeader.getBoundingClientRect().height +
          pagination.getBoundingClientRect().height +
          note.getBoundingClientRect().height +
          gap * 3;
        const rowHeight =
          firstRowRef.current?.getBoundingClientRect().height ?? FALLBACK_LEADERBOARD_ROW_HEIGHT;
        const availableHeight = Math.max(0, container.clientHeight - fixedHeight);
        const nextPageSize = Math.max(1, Math.floor(availableHeight / rowHeight));
        setPageSize((current) => (current === nextPageSize ? current : nextPageSize));
      });
    };

    const observer = new ResizeObserver(measure);
    for (const element of [container, controls, tableHeader, pagination, note]) {
      observer.observe(element);
    }
    measure();
    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col gap-3">
      <div ref={controlsRef} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-xs font-semibold text-gray-300">Players shown</legend>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-white/20 bg-black/40">
            {ELIGIBILITY_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={eligibleOnly === option.value}
                onClick={() => {
                  setEligibleOnly(option.value);
                  setPage(0);
                }}
                className={`px-2 py-2 text-xs font-semibold transition-colors focus:z-10 focus:outline-none league-focus-ring ${eligibleOnly === option.value ? "league-accent-bg text-black" : "text-gray-300 hover:bg-white/10 hover:text-white"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-xs font-semibold text-gray-300">Point type</legend>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-white/20 bg-black/40">
            {POINT_TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={role === option.value}
                onClick={() => {
                  setRole(option.value);
                  setPage(0);
                }}
                className={`px-2 py-2 text-xs font-semibold transition-colors focus:z-10 focus:outline-none league-focus-ring ${role === option.value ? "league-accent-bg text-black" : "text-gray-300 hover:bg-white/10 hover:text-white"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="overflow-hidden rounded-md border border-white/10">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[10%]" />
            <col className="w-[32%]" />
            <col className="w-[16%]" />
            <col className="w-[22%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead className="league-accent-bg text-black">
            <tr ref={tableHeaderRef}>
              <th className="px-1 py-2">#</th>
              <th className="border-l border-black/20 px-1 py-2 text-center">Player</th>
              <th className="border-l border-black/20 px-1 py-2">Team</th>
              <th
                className="border-l border-black/20 px-1 py-2"
                title="Player GPs played / team GPs played"
              >
                GPs
              </th>
              <th className="border-l border-black/20 px-1 py-2 text-center" title="GP Average">
                GP Avg
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((player, index) => {
              const rank = currentPage * pageSize + index + 1;
              const roleEligible = player[eligibilityMetric];
              const eligibilityReason = player[eligibilityReasonMetric];
              const roleGpsPlayed = player[roleGpsMetric];
              return (
                <tr
                  ref={index === 0 ? firstRowRef : undefined}
                  key={`${player.player_id}:${player.team_id}`}
                  className={`border-b ${leaderboardRankClass(rank)}`}
                >
                  <td className="px-1 py-2 text-center font-black">{rank}</td>
                  <td className="min-w-0 border-l border-white/[0.08] px-1 py-2 text-center">
                    <Link
                      to={leaguePath(
                        `/players/${player.player_id}?season=${season}&division=${division}&role=${role}`
                      )}
                      title={player.name}
                      className="block w-full font-semibold text-white hover:underline"
                    >
                      <AutoFitLeaderboardText text={player.name} />
                    </Link>
                    {!roleEligible ? (
                      <span
                        title={eligibilityReason || undefined}
                        className="ml-1 text-xs font-normal text-gray-500"
                      >
                        ineligible
                      </span>
                    ) : null}
                  </td>
                  <td
                    title={player.team_tag}
                    className="border-l border-white/[0.08] px-1 py-2 text-center text-gray-300"
                  >
                    <AutoFitLeaderboardText text={player.team_tag} />
                  </td>
                  <td
                    className="whitespace-nowrap border-l border-white/[0.08] px-1 py-2 text-center text-[0.7rem] text-gray-200"
                    title={`${roleGpsPlayed} race-equivalent GPs as ${role} (4 races = 1 GP); ${player.required_gps} required for eligibility`}
                  >
                    <span className="font-bold text-white">{roleGpsPlayed}</span>
                    <span className="text-gray-500">/{player.team_gps}</span>
                  </td>
                  <td
                    className={`border-l border-white/[0.08] px-1 py-2 text-center text-sm font-black ${rank > 3 ? "league-accent-text" : ""}`}
                  >
                    {player[metric]?.toFixed(1) ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div ref={paginationRef} className="flex items-center justify-between text-xs text-gray-300">
        <button
          type="button"
          disabled={currentPage === 0}
          onClick={() => setPage((value) => value - 1)}
          className="rounded border border-white/15 px-3 py-1 disabled:opacity-30"
        >
          Previous
        </button>
        <span>
          Page {currentPage + 1} of {pageCount}
        </span>
        <button
          type="button"
          disabled={currentPage + 1 >= pageCount}
          onClick={() => setPage((value) => value + 1)}
          className="rounded border border-white/15 px-3 py-1 disabled:opacity-30"
        >
          Next
        </button>
      </div>
      <p ref={noteRef} className="text-xs leading-5 text-gray-400">
        Four races in the selected role count as one GP, with partial GPs included. Eligibility
        requires race-equivalent GPs in at least two-thirds of an active team’s total GPs.
      </p>
    </div>
  );
}

function PlayoffBracket({
  series,
  season,
  division,
}: {
  series: PlayoffSeries[];
  season: string;
  division: string;
}) {
  const { leaguePath } = useLeague();
  if (!series.length)
    return (
      <p className="text-sm text-gray-400">
        No playoff series have been recorded for this division.
      </p>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {series.map((item) => (
        <article
          key={item.playoff_series_id}
          className={`rounded-lg border bg-black/45 p-4 ${item.stage === "finals" ? "league-accent-border" : "border-white/10"}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider league-accent-text">
                {item.label}
              </p>
              <h3 className="mt-1 font-bold">Best of {item.best_of}</h3>
            </div>
            <span className="rounded-full bg-white/10 px-2 py-1 text-[0.65rem] uppercase">
              {item.status.replace("_", " ")}
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {item.participants.map((team) => (
              <div
                key={team.team_id}
                className={`flex items-center justify-between rounded border px-3 py-2 ${item.winner_team_id === team.team_id ? "border-emerald-300/50 bg-emerald-950/35" : "border-white/10"}`}
              >
                <span className="font-semibold">
                  {team.name} <span className="text-xs text-gray-400">{team.tag}</span>
                </span>
                <span className="text-lg font-black">{team.wins}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {item.matches.map((match) => (
              <Link
                key={match.match_id}
                to={leaguePath(
                  matchHistoryPath({
                    season,
                    division,
                    matchId: match.match_id,
                    matchSet: "playoffs",
                  })
                )}
                className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
              >
                {match.teams.map((team) => team.score).join("–") || match.label}
              </Link>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

export default function StandingsPage(): React.JSX.Element {
  const { league, config } = useLeague();
  const auth = useAdminSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = useSeasonDivision({
    initialSeason: searchParams.get("season") ?? "",
    initialDivision: searchParams.get("division") ?? "",
  });
  const [data, setData] = useState<StandingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    if (!scope.season || !scope.division) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchJson<StandingsResponse>("/api/standings", {
      league,
      season: scope.season,
      division: scope.division,
      _refresh: refreshVersion || undefined,
    })
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((caught) => {
        if (!cancelled) {
          setData(null);
          setError(caught instanceof Error ? caught.message : "Could not load standings.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [league, refreshVersion, scope.division, scope.season]);

  const statusTeams = useMemo<TeamScope[]>(() => {
    if (!data) return [];
    return data.standings.map((team) => ({
      league: data.league,
      season: data.season,
      division: data.division,
      team_id: team.team_id,
      canonical_name: team.name,
      canonical_tag: team.tag,
      display_name: team.name,
      clan_tag: team.tag,
      team_season_entry_id: team.team_season_entry_id,
      competition_status: team.status,
      competition_status_note: team.status_note,
    }));
  }, [data]);

  function updateScope(nextSeason: string, nextDivision: string): void {
    const params = new URLSearchParams(searchParams);
    params.set("league", league);
    if (nextSeason) params.set("season", nextSeason);
    else params.delete("season");
    if (nextDivision) params.set("division", nextDivision);
    else params.delete("division");
    setSearchParams(params);
  }

  return (
    <main className="relative min-h-screen px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-[96rem]">
        <header className="mb-5 rounded-xl border border-white/10 bg-black/70 p-5 shadow-2xl backdrop-blur-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <BackToHomeLink className="-ml-2" />
              <p className="mt-3 text-xs font-bold uppercase tracking-[0.25em] league-accent-text">
                {config.shortName} competition
              </p>
              <h1 className="mt-1 text-3xl font-black sm:text-4xl">Divisional Standings</h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-300">
                League table, head-to-head score grid, eligible GP averages, and playoff progress in
                one view.
              </p>
            </div>
            <LeagueHeaderControls logoClassName="h-16 w-16" />
          </div>
          <div className="mt-5 max-w-xl">
            <SeasonDivisionSelector
              season={scope.season}
              division={scope.division}
              seasons={scope.seasons}
              divisions={scope.divisions}
              disabled={scope.loadingScope}
              onSeasonChange={(season) => {
                scope.setSeason(season);
                scope.setDivision("");
                updateScope(season, "");
              }}
              onDivisionChange={(division) => {
                scope.setDivision(division);
                updateScope(scope.season, division);
              }}
            />
          </div>
        </header>
        {error || scope.scopeError ? (
          <p className="mb-5 rounded-lg border border-red-300/30 bg-red-950/70 p-4 text-red-100">
            {error || scope.scopeError}
          </p>
        ) : null}
        {loading && !data ? (
          <p className="rounded-lg bg-black/60 p-6 text-center text-gray-300">
            Calculating standings…
          </p>
        ) : null}
        {data ? (
          <div className={`space-y-5 transition-opacity ${loading ? "opacity-60" : "opacity-100"}`}>
            {auth.session?.authenticated && statusTeams.length > 0 ? (
              <TeamCompetitionStatusManager
                key={`${data.league}:${data.season}:${data.division}`}
                teams={statusTeams}
                onUpdated={() => setRefreshVersion((version) => version + 1)}
              />
            ) : null}
            <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(18.5rem,1fr)]">
              <div className="flex min-w-0 flex-col gap-5">
                {data.conference_config.enabled ? (
                  <div className="space-y-5">
                    {!data.conference_config.valid ? (
                      <p className="rounded-lg border border-amber-300/30 bg-amber-950/40 p-3 text-sm text-amber-100">
                        Conference setup is incomplete. Assign exactly four teams to each conference
                        in Competition Setup.
                      </p>
                    ) : null}
                    {data.conferences.map((conference) => (
                      <section
                        key={conference.id}
                        className="overflow-hidden rounded-xl border border-white/10 bg-zinc-950/90 shadow-2xl"
                      >
                        <div className="border-b border-white/10 px-5 py-4">
                          <p className="text-xs font-bold uppercase tracking-widest league-accent-text">
                            League Table
                          </p>
                          <h2 className="mt-1 text-xl font-bold">{conference.name}</h2>
                          <p className="mt-1 text-xs text-gray-400">
                            3 for a win · 2 for a tie · 1 for a loss by 20 or fewer
                          </p>
                        </div>
                        <StandingsTable standings={conference.standings} />
                      </section>
                    ))}
                  </div>
                ) : (
                  <section className="overflow-hidden rounded-xl border border-white/10 bg-zinc-950/90 shadow-2xl">
                    <div className="border-b border-white/10 px-5 py-4">
                      <h2 className="text-xl font-bold">League Table</h2>
                      <p className="mt-1 text-xs text-gray-400">
                        3 for a win · 2 for a tie · 1 for a loss by 20 or fewer
                      </p>
                    </div>
                    <StandingsTable standings={data.standings} />
                  </section>
                )}
                <section className="flex flex-1 flex-col rounded-xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl">
                  <div className="mb-4">
                    <h2 className="text-xl font-bold">Head-to-Head Results</h2>
                    <p className="mt-1 text-xs text-gray-400">
                      Scores are shown from the row team’s perspective.
                    </p>
                  </div>
                  <div className="flex-1">
                    <MatchupMatrix
                      standings={data.standings}
                      matches={data.matches}
                      season={data.season}
                      division={data.division}
                    />
                  </div>
                </section>
              </div>
              <section className="flex min-w-0 flex-col rounded-xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl">
                <div className="mb-4">
                  <h2 className="text-xl font-bold">Player GP Average</h2>
                </div>
                <PlayerLeaderboard
                  players={data.leaderboard}
                  season={data.season}
                  division={data.division}
                />
              </section>
            </div>
            <section className="rounded-xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl">
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-widest league-accent-text">
                  Postseason
                </p>
                <h2 className="text-xl font-bold">Playoff Bracket</h2>
              </div>
              {data.playoff_qualification.seeds.length ? (
                <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {data.playoff_qualification.seeds.map((team) => (
                    <div
                      key={team.team_id}
                      className="rounded border border-white/10 bg-black/30 p-3"
                    >
                      <p className="text-xs uppercase tracking-wide text-gray-400">
                        Seed {team.seed} · {team.qualification.replace("_", " ")}
                      </p>
                      <p className="mt-1 font-bold">
                        {team.tag} — {team.name}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              <PlayoffBracket
                series={data.playoffs.series}
                season={data.season}
                division={data.division}
              />
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

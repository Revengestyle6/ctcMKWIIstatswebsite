import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../../context/LeagueContext";
import { matchHistoryPath } from "../match-history/matchHistoryLinks";
import {
  type AuditMatch,
  type AuditRace,
  type ReviewFlag,
  reviewLabels,
  type StandingsAudit,
} from "./auditTypes";
import { formatQualification, type LeaderboardRole } from "./leaderboard";

const format = (value: number) => value.toLocaleString("en-US");
const roles = ["runner", "bagger"] as const;

function RoleBadge({ role }: { role: AuditRace["role"] }) {
  return (
    <span
      className={`inline-block rounded px-2 py-1 text-xs capitalize ${role === "runner" ? "bg-blue-500 text-white" : role === "bagger" ? "bg-amber-500 text-black" : "bg-white/10 text-gray-300"}`}
    >
      {role}
    </span>
  );
}

function Flags({ flags }: { flags: ReviewFlag[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <span
          key={flag}
          className="rounded border border-amber-300/25 bg-amber-300/10 px-1.5 py-0.5 text-[0.65rem] font-medium text-amber-200"
        >
          {reviewLabels[flag]}
        </span>
      ))}
    </span>
  );
}

function RaceTable({ races, focusedRace }: { races: AuditRace[]; focusedRace: number | null }) {
  const showReview = races.some((race) => race.flags.length > 0);
  const sharedSource =
    races.length > 0 && races.every((race) => race.role_source === races[0].role_source);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="bg-white/5 text-gray-400">
          <tr>
            {[
              "Race",
              "Track",
              "Player count",
              "Position",
              "Points",
              sharedSource ? "Role" : "Role / source",
              ...(showReview ? ["Review"] : []),
            ].map((label) => (
              <th key={label} scope="col" className="px-3 py-2 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {races.map((race) => (
            <tr
              key={race.race_id}
              id={`audit-race-${race.race_id}`}
              tabIndex={-1}
              className={`scroll-mt-6 border-t border-white/10 ${focusedRace === race.race_id ? "bg-amber-300/10 ring-1 ring-inset ring-amber-300/40" : ""} ${!race.included || !race.participated ? "text-gray-500" : "text-gray-200"}`}
            >
              <td className="whitespace-nowrap px-3 py-2">
                <span className="font-semibold">{race.race_number}</span>
              </td>
              <td className="min-w-32 px-3 py-2">
                {race.track}
                {!race.included ? (
                  <span className="block text-[0.65rem] text-gray-500">
                    Excluded from analytics
                  </span>
                ) : !race.participated ? (
                  <span className="block text-[0.65rem] text-gray-500">Did not participate</span>
                ) : null}
              </td>
              <td className="px-3 py-2 tabular-nums">{race.room_size ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums">
                {race.position ?? (race.dc_award ? "DC" : "—")}
              </td>
              <td className="px-3 py-2 font-semibold tabular-nums">{race.points ?? "—"}</td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <RoleBadge role={race.role} />
                  {!sharedSource ? (
                    <span className="text-[0.65rem] text-gray-500">
                      {race.role_source === "explicit"
                        ? "Manual"
                        : race.role_source === "inferred"
                          ? "Inferred"
                          : "Unclassified"}
                    </span>
                  ) : null}
                </span>
              </td>
              {showReview ? (
                <td className="px-3 py-2">
                  <Flags flags={race.flags} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchAudit({
  match,
  season,
  division,
  focusedRace,
  canEdit,
  selectedGp,
  onGpChange,
}: {
  match: AuditMatch;
  season: string;
  division: string;
  focusedRace: number | null;
  canEdit: boolean;
  selectedGp: number | null;
  onGpChange: (gp: number) => void;
}) {
  const { leaguePath } = useLeague();
  const gpPanelId = useId();
  const gps = Array.from(
    new Set([
      ...match.races.map((race) => race.gp_number),
      ...match.aggregate_entries.flatMap((entry) =>
        entry.gp_number === null ? [] : [entry.gp_number]
      ),
    ])
  ).toSorted((left, right) => left - right);
  const gpIndex = Math.max(0, gps.indexOf(selectedGp ?? -1));
  const currentGp = gps[gpIndex];
  const races = match.races.filter((race) => race.gp_number === currentGp);
  const aggregateEntries = match.aggregate_entries.filter(
    (entry) => entry.gp_number === null || entry.gp_number === currentGp
  );
  const gpTotals = roles.map((role) => {
    const roleRaces = races.filter((race) => race.included && race.role === role);
    const entries = aggregateEntries.filter(
      (entry) => entry.gp_number === currentGp && entry.role === role
    );
    return {
      role,
      points:
        roleRaces.reduce(
          (total, race) =>
            total +
            (race.points !== null && race.points >= 0 && race.points <= 15 ? race.points : 0),
          0
        ) + entries.reduce((total, entry) => total + entry.points, 0),
      races:
        roleRaces.filter((race) => race.participated).length +
        entries.reduce((total, entry) => total + entry.races, 0),
    };
  });
  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-black/20">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-white/10 px-3 py-2">
        <p className="text-xs text-gray-400">
          Team: {match.team_races} races · {match.team_gps} GPs
          {match.source === "unaccounted" ? " · Aggregate record" : ""}
        </p>
        <div className="flex flex-wrap gap-4 text-xs">
          <Link
            className="league-accent-text hover:underline"
            to={leaguePath(
              matchHistoryPath({ season, division, matchId: match.match_id, matchSet: "regular" })
            )}
          >
            View full match ↗
          </Link>
          {canEdit ? (
            <Link
              className="text-gray-300 hover:underline"
              to={leaguePath(
                `/json-editor?season=${season}&division=${division}&edit_match=${match.match_id}`
              )}
            >
              Open in JSON editor ↗
            </Link>
          ) : null}
        </div>
      </div>
      {gps.length ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 px-3 py-2">
          <div
            role="tablist"
            aria-label="Grand Prix"
            className="flex min-w-0 max-w-full flex-1 gap-1 overflow-x-auto"
          >
            {gps.map((gp, index) => (
              <button
                key={gp}
                id={`${gpPanelId}-tab-${gp}`}
                type="button"
                role="tab"
                aria-selected={gp === currentGp}
                aria-controls={gpPanelId}
                tabIndex={gp === currentGp ? 0 : -1}
                onClick={() => onGpChange(gp)}
                onKeyDown={(event) => {
                  let next = index;
                  if (event.key === "ArrowRight") next = (index + 1) % gps.length;
                  else if (event.key === "ArrowLeft") next = (index - 1 + gps.length) % gps.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = gps.length - 1;
                  else return;
                  event.preventDefault();
                  onGpChange(gps[next]);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                    [next]?.focus();
                }}
                className={`shrink-0 rounded px-3 py-1.5 text-xs font-semibold focus:outline-none league-focus-ring ${gp === currentGp ? "league-accent-bg text-black" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}
              >
                GP {gp}
              </button>
            ))}
          </div>
          {races.length > 0 && races.every((race) => race.role_source === races[0].role_source) ? (
            <p className="text-[0.65rem] text-gray-500">
              {races[0].role_source === "explicit"
                ? "All roles manually recorded"
                : races[0].role_source === "inferred"
                  ? "All roles inferred"
                  : "All roles unclassified"}
            </p>
          ) : null}
        </div>
      ) : null}
      <section
        id={gpPanelId}
        role={currentGp !== undefined ? "tabpanel" : undefined}
        aria-labelledby={currentGp !== undefined ? `${gpPanelId}-tab-${currentGp}` : undefined}
      >
        {races.length ? <RaceTable races={races} focusedRace={focusedRace} /> : null}
        {aggregateEntries.length ? (
          <div className="border-t border-white/10 p-4">
            <p className="mb-3 text-xs text-gray-400">
              Race details are unavailable for this match. These recorded role totals contribute to
              the leaderboard.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-gray-400">
                  <tr>
                    {["Period", "Role", "Races", "Points", "DC points included"].map((label) => (
                      <th key={label} className="pb-2 pr-3 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aggregateEntries.map((entry) => (
                    <tr
                      key={`${entry.gp_number}:${entry.role}`}
                      className="border-t border-white/10"
                    >
                      <td className="py-2 pr-3">
                        {entry.gp_number ? `GP ${entry.gp_number}` : "Whole match"}
                      </td>
                      <td className="pr-3">
                        <RoleBadge role={entry.role} />
                      </td>
                      <td className="pr-3">{entry.races}</td>
                      <td className="pr-3">{format(entry.points)}</td>
                      <td>{entry.disconnection_points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {currentGp !== undefined ? (
          <section
            aria-label="Selected GP totals"
            className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-white/10 bg-white/[0.03] px-3 py-2 text-xs"
          >
            <p className="font-medium text-gray-200">
              GP {currentGp}:{" "}
              <strong className="tabular-nums text-white">
                {format(gpTotals.reduce((total, item) => total + item.points, 0))} pts
              </strong>
            </p>
            {gpTotals.map((item) => (
              <p key={item.role} className="whitespace-nowrap text-gray-400">
                <span className={item.role === "runner" ? "text-blue-300" : "text-amber-300"}>
                  {item.role === "runner" ? "Runner" : "Bagger"}
                </span>{" "}
                {format(item.points)} pts · {item.races} {item.races === 1 ? "race" : "races"}
              </p>
            ))}
            {races.some(
              (race) =>
                !race.included || race.role === "unknown" || race.flags.includes("invalid_score")
            ) ? (
              <p className="basis-full text-[0.65rem] text-gray-500">
                Leaderboard contributions only; excluded races, unclassified roles, and invalid
                scores do not contribute points.
              </p>
            ) : null}
          </section>
        ) : null}
        {!match.races.length && !match.aggregate_entries.length ? (
          <p className="border-t border-white/10 p-4 text-xs text-gray-400">
            No recorded participation for this player. This match contributes only to the team’s
            eligibility denominator.
          </p>
        ) : null}
      </section>
      <section
        aria-label="Match totals"
        className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-white/10 px-3 py-2 text-[0.7rem] text-gray-500"
      >
        <p>
          Match:{" "}
          <span className="tabular-nums">
            {format(roles.reduce((total, role) => total + match.roles[role].points, 0))} pts
          </span>
        </p>
        {roles.map((role) => (
          <p key={role} className="whitespace-nowrap">
            <span className="capitalize">{role}</span> {format(match.roles[role].points)} pts ·{" "}
            {match.roles[role].races} {match.roles[role].races === 1 ? "race" : "races"}
          </p>
        ))}
      </section>
    </article>
  );
}

export function PlayerAudit({
  audit,
  season,
  division,
  role,
  canEdit,
}: {
  audit: StandingsAudit;
  season: string;
  division: string;
  role: LeaderboardRole;
  canEdit: boolean;
}) {
  const [filter, setFilter] = useState<ReviewFlag | "all">("all");
  const matchSelectId = useId();
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [selectedGp, setSelectedGp] = useState<number | null>(null);
  const selectedMatchIndex = Math.max(
    0,
    audit.matches.findIndex((match) => match.match_id === selectedMatchId)
  );
  const selectedMatch = audit.matches[selectedMatchIndex];
  const [focusedRace, setFocusedRace] = useState<{ id: number } | null>(null);
  const [reviewLimit, setReviewLimit] = useState(8);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const reviewControlsId = useId();
  const reviewRaces = useMemo(
    () =>
      audit.matches.flatMap((match) =>
        match.races.filter((race) => race.flags.length > 0).map((race) => ({ match, race }))
      ),
    [audit.matches]
  );
  const visibleReview = reviewRaces.filter(
    ({ race }) => filter === "all" || race.flags.includes(filter)
  );
  useEffect(() => {
    if (focusedRace === null) return;
    const row = document.getElementById(`audit-race-${focusedRace.id}`);
    row?.scrollIntoView({ block: "center", behavior: "instant" });
    row?.focus({ preventScroll: true });
  }, [focusedRace]);
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="break-words text-xl font-bold">{audit.player.name}</h2>
        <p className="text-xs text-gray-400">
          {audit.player.team_tag} · {season.toUpperCase()} · {division.toUpperCase()} · Regular
          season
        </p>
      </header>
      <section
        aria-label="Participation and qualification"
        className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400"
      >
        <p>
          Team:{" "}
          <span className="tabular-nums text-gray-200">
            {audit.team_gps} GPs / {audit.team_races} races
          </span>
        </p>
        <p>
          Qualification per role:{" "}
          <span className="tabular-nums text-gray-200">
            {formatQualification(audit.team_gps)} GPs /{" "}
            {formatQualification(audit.team_gps, "races")} races
          </span>
        </p>
      </section>
      <section
        aria-label="Role calculations"
        className="overflow-x-auto rounded-lg border border-white/10"
      >
        <table className="w-full min-w-[480px] text-left text-xs">
          <thead className="bg-white/5 text-gray-400">
            <tr>
              {["Role", "Points", "Races", "GPs", "Calculation", "Eligibility"].map((label) => (
                <th key={label} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((item) => {
              const eligible = audit.player[`${item}_eligible`];
              const races = audit.player[`${item}_races`];
              const gps = audit.player[`${item}_gps_played`];
              const points = audit.player[`${item}_points`];
              const status = eligible
                ? "Eligible"
                : audit.player.team_status !== "active"
                  ? `Team ${audit.player.team_status}`
                  : audit.required_gps <= 0
                    ? "No qualifying team GPs"
                    : "Below ⅔ of team races";
              return (
                <tr
                  key={item}
                  className={`border-t border-white/10 ${item === role ? "bg-white/[0.06]" : ""}`}
                >
                  <th
                    scope="row"
                    className={`border-l-2 px-3 py-2 font-normal ${item === role ? "league-accent-border" : "border-transparent"}`}
                  >
                    <RoleBadge role={item} />
                  </th>
                  <td className="px-3 py-2 tabular-nums text-gray-200">{format(points)}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-200">{races}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-200">{gps}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {gps > 0 ? (
                      <>
                        <span className="text-gray-400">
                          {format(points)} ÷ {gps} ={" "}
                        </span>
                        <strong className="text-white">
                          {audit.player[`${item}_gp_average`]?.toFixed(2) ?? "—"}
                        </strong>
                      </>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td
                    title={audit.player[`${item}_eligibility_reason`] ?? undefined}
                    className={`whitespace-nowrap px-3 py-2 ${eligible ? "text-emerald-300" : "text-gray-400"}`}
                  >
                    {status}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p
          role="status"
          className={`text-xs ${audit.reconciled ? "text-gray-400" : "rounded border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-amber-200"}`}
        >
          {audit.reconciled ? (
            <>
              <span aria-hidden="true">✓ </span>Match totals agree with leaderboard
            </>
          ) : (
            "Match totals do not agree with leaderboard. Review the underlying records."
          )}
          {audit.unknown_role_races > 0
            ? ` · ${audit.unknown_role_races} races with unclassified roles`
            : ""}
        </p>
        <details className="text-xs text-gray-400 open:basis-full">
          <summary className="cursor-pointer rounded hover:text-white focus-visible:outline-none league-focus-ring">
            Calculation rules
          </summary>
          <div className="mt-2 space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 leading-5">
            <p>
              Required GPs = team GPs × ⅔, with no rounding. Eligibility requires playing the role
              in at least ⅔ of the team’s actual races. Both team and individual role GPs equal
              races ÷ 4: 10 races = 2.5 GPs; 7 races = 1.75 GPs. Dropped or disqualified teams are
              ineligible. Races with unclassified roles contribute to neither role.
            </p>
            <p>
              Reconciliation confirms that match totals account for the leaderboard. Entry accuracy
              still needs checking against the source. Review flags are prompts, not confirmed
              errors; unflagged races can also contain errors. Player count is based on recorded
              positions; a DC award does not establish the original room size.
            </p>
            <p>
              A typical role requires at least 12 classified races, with 80% or more in one role,
              using only this team, season, and division.{" "}
              {audit.dominant_role
                ? `This player is typically a ${audit.dominant_role}: ${audit.role_history.runner} runner races and ${audit.role_history.bagger} bagger races.`
                : "This player has no dominant role under that rule."}{" "}
              Legitimate all-run races and tactical role changes may be flagged.
            </p>
          </div>
        </details>
      </div>
      <section
        aria-labelledby="review-heading"
        className={`overflow-hidden rounded-lg border ${reviewRaces.length ? "border-amber-300/20" : "border-white/10"}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
          <h3 id="review-heading" className="text-sm font-semibold">
            Races to review{" "}
            <span
              className={`ml-2 text-xs font-normal ${reviewRaces.length ? "text-amber-200" : "text-gray-500"}`}
            >
              · {audit.flagged_races} flagged
            </span>
          </h3>
          {reviewRaces.length ? (
            <button
              type="button"
              aria-expanded={reviewExpanded}
              aria-controls={reviewControlsId}
              onClick={() => {
                setReviewExpanded((current) => !current);
                setFilter("all");
                setReviewLimit(8);
              }}
              className="rounded text-xs text-gray-400 hover:text-white focus-visible:outline-none league-focus-ring"
            >
              {reviewExpanded ? "Collapse review" : "Expand review"}
            </button>
          ) : (
            <p className="text-xs text-gray-500">No races flagged by these checks.</p>
          )}
        </div>
        {reviewRaces.length ? (
          <>
            <div
              id={reviewControlsId}
              className={`${reviewExpanded ? "flex" : "hidden"} flex-wrap gap-1.5 border-t border-white/10 px-3 py-2`}
            >
              {(
                [
                  "all",
                  "small_room",
                  "dc_award",
                  "unusual_role",
                  "unknown_role",
                  "invalid_score",
                ] as const
              ).map((value) => {
                const count =
                  value === "all"
                    ? reviewRaces.length
                    : reviewRaces.filter(({ race }) => race.flags.includes(value)).length;
                return value !== "all" && count === 0 ? null : (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => {
                      setFilter(value);
                      setReviewLimit(8);
                    }}
                    className={`rounded-full border px-2 py-1 text-xs focus:outline-none league-focus-ring ${filter === value ? "border-amber-300/40 bg-amber-300/15 text-amber-100" : "border-white/10 text-gray-400 hover:text-white"}`}
                  >
                    {value === "all" ? "All flags" : reviewLabels[value]} · {count}
                  </button>
                );
              })}
            </div>
            {visibleReview.length ? (
              <div className="divide-y divide-white/10 border-t border-white/10">
                {visibleReview.slice(0, reviewExpanded ? reviewLimit : 3).map(({ match, race }) => (
                  <button
                    key={race.race_id}
                    type="button"
                    onClick={() => {
                      setSelectedMatchId(match.match_id);
                      setSelectedGp(race.gp_number);
                      setFocusedRace({ id: race.race_id });
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/5 focus:outline-none league-focus-ring"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-medium">
                        {race.track}
                        <span className="ml-2 font-normal text-gray-500">
                          Match {match.match_number} · Race {race.race_number} · {race.role} ·{" "}
                          {race.points ?? "—"} pts
                        </span>
                      </span>
                      <span className="mt-1 block">
                        <Flags flags={race.flags} />
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">Inspect ↓</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="border-t border-white/10 px-3 py-2 text-xs text-gray-500">
                No races match this filter.
              </p>
            )}
            {!reviewExpanded && reviewRaces.length > 3 ? (
              <button
                type="button"
                onClick={() => setReviewExpanded(true)}
                className="w-full border-t border-white/10 py-2 text-xs text-gray-400 hover:text-white"
              >
                {reviewRaces.length - 3} more flagged races · Expand review
              </button>
            ) : null}
            {reviewExpanded && visibleReview.length > reviewLimit ? (
              <button
                type="button"
                onClick={() => setReviewLimit((current) => current + 20)}
                className="w-full border-t border-white/10 py-2 text-xs text-gray-300 hover:bg-white/5"
              >
                Show more ({visibleReview.length - reviewLimit} remaining)
              </button>
            ) : null}
          </>
        ) : null}
      </section>
      <section aria-labelledby="audit-matches-heading">
        <h3 id="audit-matches-heading" className="mb-2 font-semibold">
          Match breakdown
        </h3>
        {selectedMatch ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor={matchSelectId} className="sr-only">
                  Match
                </label>
                <select
                  id={matchSelectId}
                  value={selectedMatch.match_id}
                  onChange={(event) => {
                    setSelectedMatchId(Number(event.target.value));
                    setSelectedGp(null);
                    setFocusedRace(null);
                  }}
                  className="w-full min-w-0 rounded-md border border-white/20 bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none league-focus-ring"
                >
                  {audit.matches.map((match) => {
                    const flags = match.races.filter((race) => race.flags.length > 0).length;
                    return (
                      <option key={match.match_id} value={match.match_id}>
                        {match.label || `Match ${match.match_number} · ${match.teams.join(" vs ")}`}
                        {flags ? ` · ${flags} to review` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              {audit.matches.length > 1 ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    aria-label="Previous match"
                    disabled={selectedMatchIndex === 0}
                    onClick={() => {
                      setSelectedMatchId(audit.matches[selectedMatchIndex - 1].match_id);
                      setSelectedGp(null);
                      setFocusedRace(null);
                    }}
                    className="rounded-md border border-white/20 px-2 py-2 text-xs text-gray-200 hover:bg-white/10 focus:outline-none league-focus-ring disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <span aria-hidden="true">←</span>
                  </button>
                  <span
                    aria-live="polite"
                    aria-atomic="true"
                    className="whitespace-nowrap text-xs tabular-nums text-gray-400"
                  >
                    {selectedMatchIndex + 1} of {audit.matches.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Next match"
                    disabled={selectedMatchIndex === audit.matches.length - 1}
                    onClick={() => {
                      setSelectedMatchId(audit.matches[selectedMatchIndex + 1].match_id);
                      setSelectedGp(null);
                      setFocusedRace(null);
                    }}
                    className="rounded-md border border-white/20 px-2 py-2 text-xs text-gray-200 hover:bg-white/10 focus:outline-none league-focus-ring disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              ) : null}
            </div>
            <MatchAudit
              key={selectedMatch.match_id}
              match={selectedMatch}
              season={season}
              division={division}
              focusedRace={focusedRace?.id ?? null}
              canEdit={canEdit}
              selectedGp={selectedGp}
              onGpChange={(gp) => {
                setSelectedGp(gp);
                setFocusedRace(null);
              }}
            />
          </>
        ) : (
          <p className="text-sm text-gray-400">No contributing matches for this player’s team.</p>
        )}
      </section>
    </div>
  );
}

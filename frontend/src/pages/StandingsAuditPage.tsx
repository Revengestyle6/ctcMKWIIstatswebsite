import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchJson } from "../api";
import { BackToHomeLink } from "../components/BackToHomeLink";
import { LeagueHeaderControls } from "../components/LeagueHeaderControls";
import SeasonDivisionSelector from "../components/SeasonDivisionSelector";
import { useLeague } from "../context/LeagueContext";
import type { StandingsAudit } from "../features/standings/auditTypes";
import {
  type LeaderboardPlayer,
  type LeaderboardRole,
  rankLeaderboard,
} from "../features/standings/leaderboard";
import { PlayerAudit } from "../features/standings/PlayerAudit";
import { useAuditLeaderboardLayout } from "../features/standings/useAuditLeaderboardLayout";
import { useAdminSession } from "../hooks/useAdminSession";
import { useSeasonDivision } from "../hooks/useSeasonDivision";

const keyFor = (player: LeaderboardPlayer) => `${player.player_id}:${player.team_season_entry_id}`;

export default function StandingsAuditPage() {
  const { league, leaguePath } = useLeague();
  const auth = useAdminSession();
  const canEdit =
    !auth.loading &&
    auth.session?.authenticated === true &&
    (auth.session.admin?.role === "admin" || auth.session.admin?.role === "owner");
  const [params, setParams] = useSearchParams();
  const scope = useSeasonDivision({
    initialSeason: params.get("season") ?? "",
    initialDivision: params.get("division") ?? "",
  });
  const role: LeaderboardRole = params.get("role") === "bagger" ? "bagger" : "runner";
  const eligibleOnly = params.get("eligible") !== "all";
  const [search, setSearch] = useState("");
  const [players, setPlayers] = useState<{ key: string; rows: LeaderboardPlayer[] } | null>(null);
  const [audit, setAudit] = useState<{ key: string; data: StandingsAudit } | null>(null);
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [retry, setRetry] = useState(0);
  const [pageAnchor, setPageAnchor] = useState({ key: "", index: 0 });
  const scopeKey = `${league}:${scope.season}:${scope.division}`;
  const currentPlayers = players?.key === scopeKey ? players.rows : null;
  const ranked = useMemo(
    () => rankLeaderboard(currentPlayers ?? [], role, eligibleOnly),
    [currentPlayers, role, eligibleOnly]
  );
  const filtered = ranked
    .map((player, index) => ({ player, rank: index + 1 }))
    .filter(({ player }) =>
      `${player.name} ${player.team_tag}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase())
    );
  const selected =
    filtered.find(
      ({ player }) =>
        String(player.player_id) === params.get("player") &&
        String(player.team_season_entry_id) === params.get("entry")
    )?.player ?? filtered[0]?.player;
  const selectedKey = selected ? `${scopeKey}:${keyFor(selected)}` : "";
  const currentAudit = audit?.key === selectedKey ? audit.data : null;

  const filterKey = `${scopeKey}:${role}:${eligibleOnly}:${search.trim().toLocaleLowerCase()}`;
  const layout = useAuditLeaderboardLayout(
    currentPlayers !== null && !(scope.scopeError || error),
    filterKey
  );
  const { auditPanelRef } = layout;
  const selectedIndex = selected
    ? filtered.findIndex(({ player }) => keyFor(player) === keyFor(selected))
    : 0;
  const anchor = pageAnchor.key === filterKey ? pageAnchor.index : Math.max(0, selectedIndex);
  const pageCount = Math.max(1, Math.ceil(filtered.length / layout.pageSize));
  const currentPage = Math.min(Math.floor(anchor / layout.pageSize), pageCount - 1);
  const visible = filtered.slice(
    currentPage * layout.pageSize,
    (currentPage + 1) * layout.pageSize
  );
  const auditPending = Boolean(selected && !currentAudit && !auditError);

  useEffect(() => {
    if (!scope.season || !scope.division || scope.loadingScope) return;
    let cancelled = false;
    setError("");
    fetchJson<{ leaderboard: LeaderboardPlayer[] }>("/api/standings", {
      league,
      season: scope.season,
      division: scope.division,
      _refresh: retry || undefined,
    })
      .then((data) => {
        if (!cancelled) setPlayers({ key: scopeKey, rows: data.leaderboard });
      })
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : "Could not load leaderboard.");
      });
    return () => {
      cancelled = true;
    };
  }, [league, scope.season, scope.division, scope.loadingScope, scopeKey, retry]);

  const playerId = selected?.player_id;
  const entryId = selected?.team_season_entry_id;
  useEffect(() => {
    if (!playerId || !entryId) return;
    let cancelled = false;
    setAuditError("");
    fetchJson<StandingsAudit>("/api/standings/audit", {
      league,
      season: scope.season,
      division: scope.division,
      player_id: playerId,
      team_season_entry_id: entryId,
      _refresh: retry || undefined,
    })
      .then((data) => {
        if (!cancelled) setAudit({ key: selectedKey, data });
      })
      .catch((caught) => {
        if (!cancelled)
          setAuditError(caught instanceof Error ? caught.message : "Could not load this audit.");
      });
    return () => {
      cancelled = true;
    };
  }, [league, scope.season, scope.division, playerId, entryId, selectedKey, retry]);

  function update(values: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    next.set("league", league);
    if (scope.season) next.set("season", scope.season);
    if (scope.division) next.set("division", scope.division);
    for (const [key, value] of Object.entries(values)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  }
  function select(player: LeaderboardPlayer) {
    setPageAnchor({
      key: filterKey,
      index: Math.max(
        0,
        filtered.findIndex((row) => keyFor(row.player) === keyFor(player))
      ),
    });
    update({ player: String(player.player_id), entry: String(player.team_season_entry_id) });
    if (window.matchMedia("(max-width: 1279px)").matches) {
      requestAnimationFrame(() => auditPanelRef.current?.scrollIntoView({ block: "start" }));
    }
  }
  const metric = role === "runner" ? "runner_gp_average" : "bagger_gp_average";
  const roleGps = role === "runner" ? "runner_gps_played" : "bagger_gps_played";
  const rolePoints = role === "runner" ? "runner_points" : "bagger_points";
  const errorMessage = scope.scopeError || error;
  return (
    <main className="relative min-h-screen px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-[100rem]">
        <header className="mb-5 rounded-xl border border-white/10 bg-black/75 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4">
            <BackToHomeLink className="-ml-2" />
            <LeagueHeaderControls />
          </div>
          <div>
            <p className="mt-3 text-xs font-semibold uppercase tracking-widest league-accent-text">
              Standings · Data review
            </p>
            <h1 className="mt-1 text-3xl font-black">GP Average Audit</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-300">
              Trace a player’s leaderboard entry back to each match and race. Start with a player,
              then inspect the records behind their totals.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <SeasonDivisionSelector
              season={scope.season}
              division={scope.division}
              seasons={scope.seasons}
              divisions={scope.divisions}
              disabled={scope.loadingScope}
              onSeasonChange={(season) => {
                setSearch("");
                setPlayers(null);
                update({ season, division: null, player: null, entry: null });
              }}
              onDivisionChange={(division) => {
                setSearch("");
                setPlayers(null);
                update({ division, player: null, entry: null });
              }}
            />
            <Link
              className="rounded border border-white/20 px-3 py-2 text-xs text-gray-300 hover:bg-white/10"
              to={leaguePath(`/standings?season=${scope.season}&division=${scope.division}`)}
            >
              Back to standings
            </Link>
          </div>
        </header>
        {errorMessage ? (
          <div
            role="alert"
            className="rounded-xl border border-red-300/30 bg-black/80 p-5 text-red-200"
          >
            {errorMessage}
            <button
              type="button"
              onClick={() => setRetry((current) => current + 1)}
              className="ml-3 underline"
            >
              Try again
            </button>
          </div>
        ) : !currentPlayers ? (
          <p role="status" className="rounded-xl bg-black/80 p-5 text-gray-300">
            Loading leaderboard…
          </p>
        ) : (
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(25rem,0.85fr)_minmax(0,1.65fr)]">
            <section
              ref={layout.leaderboardRef}
              aria-labelledby="audit-leaderboard-heading"
              style={{ height: layout.height }}
              className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95"
            >
              <div ref={layout.controlsRef} className="shrink-0 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="audit-leaderboard-heading" className="text-lg font-bold">
                    Player GP Average
                  </h2>
                  <span className="text-xs text-gray-500">{filtered.length} players</span>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Select a row to inspect its calculation.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {[
                    {
                      legend: "Players shown",
                      options: [
                        { label: "Eligible players", active: eligibleOnly, value: "eligible" },
                        { label: "All players", active: !eligibleOnly, value: "all" },
                      ],
                      onChange: (value: string) => update({ eligible: value }),
                    },
                    {
                      legend: "Point type",
                      options: [
                        { label: "Running points", active: role === "runner", value: "runner" },
                        { label: "Bagging points", active: role === "bagger", value: "bagger" },
                      ],
                      onChange: (value: string) => update({ role: value }),
                    },
                  ].map((group) => (
                    <fieldset key={group.legend}>
                      <legend className="mb-1.5 text-xs font-semibold text-gray-400">
                        {group.legend}
                      </legend>
                      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-white/20">
                        {group.options.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={option.active}
                            onClick={() => group.onChange(option.value)}
                            className={`px-2 py-2 text-xs font-semibold focus:z-10 focus:outline-none league-focus-ring ${option.active ? "league-accent-bg text-black" : "text-gray-300 hover:bg-white/10"}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
                <label className="mt-3 block">
                  <span className="sr-only">Find player or team</span>
                  <input
                    type="search"
                    placeholder="Find player or team…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none league-focus-ring"
                  />
                </label>
              </div>
              <div
                ref={layout.tableViewportRef}
                className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
              >
                <table className="w-full text-left text-xs">
                  <thead ref={layout.tableHeaderRef} className="league-accent-bg text-black">
                    <tr>
                      {["#", "Player", "Team", "GPs", "Points", "GP Avg"].map((label) => (
                        <th
                          key={label}
                          scope="col"
                          title={
                            label === "GPs" ? "Player GPs played / team GPs played" : undefined
                          }
                          className="whitespace-nowrap px-2 py-3 text-center font-bold"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody ref={layout.tableBodyRef}>
                    {visible.map(({ player, rank }) => {
                      const active = keyFor(player) === (selected ? keyFor(selected) : "");
                      return (
                        <tr
                          key={keyFor(player)}
                          aria-selected={active}
                          tabIndex={0}
                          onClick={() => select(player)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              select(player);
                            }
                          }}
                          className={`cursor-pointer border-b border-white/[0.06] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 ${active ? "bg-white/10 ring-1 ring-inset ring-white/20" : "hover:bg-white/[0.07]"}`}
                        >
                          <td
                            className={`border-l-[3px] px-2 py-3 text-center text-gray-500 ${active ? "league-accent-border" : "border-transparent"}`}
                          >
                            {rank}
                          </td>
                          <td
                            className={`max-w-40 break-words px-2 py-3 font-semibold ${active ? "league-accent-text" : "text-gray-100"}`}
                          >
                            {player.name}
                            {!player[role === "runner" ? "runner_eligible" : "bagger_eligible"] ? (
                              <span className="block text-[0.65rem] font-normal text-gray-500">
                                ineligible
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-3 text-center text-gray-400">{player.team_tag}</td>
                          <td className="whitespace-nowrap px-2 py-3 text-center tabular-nums">
                            {player[roleGps]}
                            <span className="text-gray-500">/{player.team_gps}</span>
                          </td>
                          <td className="px-2 py-3 text-center tabular-nums">
                            {player[rolePoints].toLocaleString("en-US")}
                          </td>
                          <td className="px-2 py-3 text-center font-bold tabular-nums">
                            {player[metric]?.toFixed(1) ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!filtered.length ? (
                  <p ref={layout.emptyRef} className="p-4 text-sm text-gray-400">
                    {search
                      ? "No players match this search."
                      : "No players qualify for these filters. Try All players."}
                  </p>
                ) : null}
              </div>
              <nav
                ref={layout.paginationRef}
                aria-label="Leaderboard pages"
                className="flex shrink-0 items-center justify-between gap-2 border-t border-white/10 p-3 text-xs text-gray-300"
              >
                <button
                  type="button"
                  aria-label="Previous players"
                  disabled={currentPage === 0}
                  onClick={() =>
                    setPageAnchor({ key: filterKey, index: (currentPage - 1) * layout.pageSize })
                  }
                  className="rounded border border-white/15 px-3 py-1 hover:bg-white/5 focus:outline-none league-focus-ring disabled:opacity-30"
                >
                  Previous
                </button>
                <span aria-live="polite" aria-atomic="true">
                  Page {currentPage + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  aria-label="Next players"
                  disabled={currentPage === pageCount - 1}
                  onClick={() =>
                    setPageAnchor({ key: filterKey, index: (currentPage + 1) * layout.pageSize })
                  }
                  className="rounded border border-white/15 px-3 py-1 hover:bg-white/5 focus:outline-none league-focus-ring disabled:opacity-30"
                >
                  Next
                </button>
              </nav>
            </section>
            <section
              ref={auditPanelRef}
              aria-label="Selected player audit"
              aria-busy={auditPending}
              style={{
                minHeight:
                  auditPending && layout.height !== undefined
                    ? Math.max(layout.minimumHeight, layout.height)
                    : layout.minimumHeight,
              }}
              className="min-w-0 scroll-mt-5 rounded-xl border border-white/10 bg-zinc-950/95 p-4 sm:p-5"
            >
              {!selected ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  Choose a player to inspect their calculation.
                </p>
              ) : auditError ? (
                <p role="alert" className="text-red-200">
                  {auditError}
                  <button
                    type="button"
                    onClick={() => setRetry((current) => current + 1)}
                    className="ml-3 underline"
                  >
                    Try again
                  </button>
                </p>
              ) : currentAudit ? (
                <PlayerAudit
                  key={selectedKey}
                  audit={currentAudit}
                  season={scope.season}
                  division={scope.division}
                  role={role}
                  canEdit={canEdit}
                />
              ) : (
                <p role="status" className="py-8 text-sm text-gray-400">
                  Loading audit for {selected.name}…
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

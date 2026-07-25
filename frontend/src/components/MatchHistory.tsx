import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchJson } from "../api";
import { useSeasonDivision } from "../hooks/useSeasonDivision";
import {
  type ChartMode,
  type MatchDetail,
  type MatchSummary,
  normalizeHexColor,
  type TableMode,
  type TeamColors,
  TrackList,
  TraditionalTable,
  teamColor,
  VerticalScorecard,
} from "./matchHistoryViews";
import SeasonDivisionSelector from "./SeasonDivisionSelector";

export {
  type ChartMode,
  type MatchDetail,
  TrackList,
  TraditionalTable,
  VerticalScorecard,
} from "./matchHistoryViews";

export default function MatchHistory(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const requestedSeason = searchParams.get("season") ?? "";
  const requestedDivision = searchParams.get("division") ?? "";
  const requestedMatchId = Number(searchParams.get("match")) || null;
  const { seasons, divisions, season, division, loadingScope, scopeError, setSeason, setDivision } =
    useSeasonDivision({ initialSeason: requestedSeason, initialDivision: requestedDivision });
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
      } catch (_err) {
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
        setSelectedMatchId(
          requestedMatchId && data.some((match) => match.match_id === requestedMatchId)
            ? requestedMatchId
            : (data[0]?.match_id ?? null)
        );
      } catch (_err) {
        if (!cancelled) setError("Failed to load matches.");
      } finally {
        if (!cancelled) setLoadingMatches(false);
      }
    }
    loadMatches();
    return () => {
      cancelled = true;
    };
  }, [season, division, selectedTeam, requestedMatchId]);

  useEffect(() => {
    let cancelled = false;
    async function loadDetail() {
      if (!selectedMatchId) return;
      setLoadingDetail(true);
      setError("");
      try {
        const data = await fetchJson<MatchDetail>(`/api/matches/${selectedMatchId}`);
        if (!cancelled) setMatchDetail(data);
      } catch (_err) {
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
            <label htmlFor="match-team" className="block font-semibold mb-1">
              Team
            </label>
            <select
              id="match-team"
              className="min-w-40 rounded-md border border-gray-400 bg-white px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedTeam}
              onChange={(event) => setSelectedTeam(event.target.value)}
              disabled={!division || teams.length === 0}
            >
              <option value="">All teams</option>
              {teams.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-72 flex-1">
            <label htmlFor="match-selection" className="block font-semibold mb-1">
              Match
            </label>
            <select
              id="match-selection"
              className="w-full rounded-md border border-gray-400 bg-white px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedMatchId ?? ""}
              onChange={(event) => setSelectedMatchId(Number(event.target.value))}
              disabled={loadingMatches || matches.length === 0}
            >
              {matches.map((match) => (
                <option key={match.match_id} value={match.match_id}>
                  {match.week ? `W${match.week} - ` : ""}
                  {match.teams} ({match.scores})
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="block font-semibold mb-1">Format</span>
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
              <summary className="cursor-pointer text-sm font-semibold text-gray-100">
                Colors
              </summary>
              <div className="mt-3 grid grid-cols-[max-content_2.5rem_5.5rem] items-center gap-x-2 gap-y-2">
                {matchDetail.teams.map((team, teamIndex) => {
                  const fallback = teamIndex === 0 ? "#1d4ed8" : "#be185d";
                  const color = teamColor(team, teamColors, fallback);
                  const colorInput = teamColorInputs[team.match_team_id] ?? color;
                  return (
                    <label key={team.match_team_id} className="contents text-sm text-gray-200">
                      <span className="max-w-48 justify-self-end whitespace-normal break-words text-right text-sm text-gray-200">
                        {team.tag}
                      </span>
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
                  <h2 className="mt-1 text-3xl font-bold">
                    {selectedSummary?.teams || matchDetail.label}
                  </h2>
                  <p className="mt-1 text-gray-300">
                    {matchDetail.races_played} races
                    {matchDetail.format ? ` / ${matchDetail.format}` : ""}
                    {selectedSummary?.scores ? ` / ${selectedSummary.scores}` : ""}
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div>
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-300">
                      Diff chart
                    </span>
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
              <TraditionalTable
                match={matchDetail}
                groupByGp={groupByGp}
                teamColors={teamColors}
                chartMode={chartMode}
              />
            ) : (
              <VerticalScorecard
                match={matchDetail}
                teamColors={teamColors}
                chartMode={chartMode}
              />
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

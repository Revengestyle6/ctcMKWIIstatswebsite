import React, { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

type MatchPlayerJson = {
  table_str?: string;
  mii_name?: string;
  lounge_name?: string;
  table_name?: string;
  tag?: string;
  total_score?: number;
  had_penalties?: boolean;
  penalties?: number;
  subbed_out?: boolean;
  race_scores?: Array<number | null>;
  race_positions?: Array<number | null>;
  gp_scores?: Array<Array<number | null>>;
  race_roles?: string[];
  flag?: string;
  [key: string]: unknown;
};

type TeamJson = {
  table_tag_str?: string;
  table_penalty_str?: string;
  total_score?: number;
  penalties?: number;
  players?: Record<string, MatchPlayerJson>;
  [key: string]: unknown;
};

type MatchJson = {
  title_str?: string;
  format?: string;
  races_played?: number;
  league?: string;
  season?: string;
  division?: string;
  week?: number;
  match_label?: string;
  rxx?: string[];
  tracks?: string[];
  teams?: Record<string, TeamJson>;
  review_notes?: string;
  [key: string]: unknown;
};

type ValidationIssue = {
  level: "error" | "warning";
  message: string;
};

const blankMatch: MatchJson = {
  title_str: "#title 12 races\n",
  format: "5v5",
  races_played: 12,
  league: "ctc",
  season: "",
  division: "",
  week: undefined,
  match_label: "",
  rxx: ["", "", ""],
  tracks: Array.from({ length: 12 }, () => ""),
  teams: {
    TeamA: {
      table_tag_str: "TeamA #4F8CFF",
      table_penalty_str: "",
      total_score: 0,
      penalties: 0,
      players: {},
    },
    TeamB: {
      table_tag_str: "TeamB #F45D8C",
      table_penalty_str: "",
      total_score: 0,
      penalties: 0,
      players: {},
    },
  },
  review_notes: "",
};

function cloneMatch(match: MatchJson): MatchJson {
  return JSON.parse(JSON.stringify(match)) as MatchJson;
}

function asNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asNullableNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberInputValue(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function friendCodeIsValid(friendCode: string): boolean {
  return /^\d{4}-\d{4}-\d{4}$/.test(friendCode);
}

function teamHexColor(team: TeamJson): string {
  const match = (team.table_tag_str ?? "").match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/);
  return match ? match[0].toUpperCase() : "";
}

function teamDisplayTag(teamKey: string, team: TeamJson): string {
  const tableTag = (team.table_tag_str ?? "").replace(/#[0-9a-fA-F]{3,6}/, "").trim();
  return tableTag || teamKey;
}

function setTeamTagString(team: TeamJson, tag: string, color: string): TeamJson {
  return {
    ...team,
    table_tag_str: color ? `${tag} ${color.toUpperCase()}` : tag,
  };
}

function ensureArrayLength<T>(values: T[] | undefined, length: number, fallback: T): T[] {
  const next = Array.isArray(values) ? [...values] : [];
  while (next.length < length) next.push(fallback);
  if (next.length > length) next.length = length;
  return next;
}

function rebuildGpScores(scores: Array<number | null>): Array<Array<number | null>> {
  const gps: Array<Array<number | null>> = [];
  for (let index = 0; index < scores.length; index += 4) {
    gps.push(scores.slice(index, index + 4));
  }
  return gps;
}

function playerTotal(player: MatchPlayerJson): number {
  const scoreTotal = (player.race_scores ?? []).reduce<number>((sum, score) => sum + (score ?? 0), 0);
  return scoreTotal - (player.penalties ?? 0);
}

function validateMatch(match: MatchJson): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const races = match.races_played ?? 0;
  const tracks = match.tracks ?? [];
  const teams = match.teams ?? {};
  const friendCodeOwners = new Map<string, string[]>();

  if (!match.format?.trim()) issues.push({ level: "error", message: "Format is missing." });
  if (!races || races < 1) issues.push({ level: "error", message: "Race count must be at least 1." });
  if (tracks.length !== races) {
    issues.push({ level: "error", message: `Track count is ${tracks.length}, but races_played is ${races}.` });
  }
  tracks.forEach((track, index) => {
    if (!track.trim()) issues.push({ level: "warning", message: `Race ${index + 1} is missing a track name.` });
  });

  const teamEntries = Object.entries(teams);
  if (teamEntries.length !== 2) {
    issues.push({ level: "warning", message: `This editor currently expects 2 teams; found ${teamEntries.length}.` });
  }

  teamEntries.forEach(([teamKey, team]) => {
    const tag = teamDisplayTag(teamKey, team);
    const players = Object.entries(team.players ?? {});
    if (!tag.trim()) issues.push({ level: "error", message: `Team ${teamKey} is missing a tag.` });
    if (players.length === 0) issues.push({ level: "warning", message: `${tag} has no players.` });

    const sumPlayers = players.reduce((sum, [, player]) => sum + (player.total_score ?? 0), 0);
    const teamFinal = sumPlayers - (team.penalties ?? 0);
    if ((team.total_score ?? 0) !== teamFinal) {
      issues.push({
        level: "warning",
        message: `${tag} total_score is ${team.total_score ?? 0}; player totals minus team penalties equal ${teamFinal}.`,
      });
    }

    players.forEach(([friendCode, player]) => {
      const name = player.lounge_name || player.table_name || friendCode;
      if (!friendCodeIsValid(friendCode)) {
        issues.push({ level: "error", message: `${name} has malformed friend code ${friendCode}.` });
      }
      friendCodeOwners.set(friendCode, [...(friendCodeOwners.get(friendCode) ?? []), `${tag} / ${name}`]);

      const scores = player.race_scores ?? [];
      const positions = player.race_positions ?? [];
      const roles = player.race_roles ?? [];
      if (scores.length !== races) {
        issues.push({ level: "error", message: `${name} has ${scores.length} race scores; expected ${races}.` });
      }
      if (positions.length !== races) {
        issues.push({ level: "warning", message: `${name} has ${positions.length} race positions; expected ${races}.` });
      }
      if (roles.length > 0 && roles.length !== races) {
        issues.push({ level: "warning", message: `${name} has ${roles.length} race roles; expected ${races}.` });
      }
      const expectedTotal = playerTotal(player);
      if ((player.total_score ?? 0) !== expectedTotal) {
        issues.push({
          level: "warning",
          message: `${name} total_score is ${player.total_score ?? 0}; race scores minus penalties equal ${expectedTotal}.`,
        });
      }
    });
  });

  friendCodeOwners.forEach((owners, friendCode) => {
    if (owners.length > 1) {
      issues.push({
        level: "error",
        message: `Duplicate friend code ${friendCode}: ${owners.join(", ")}.`,
      });
    }
  });

  return issues;
}

function downloadJson(match: MatchJson): void {
  const filenameParts = [match.match_label || match.title_str?.replace("#title", "").trim() || "match"]
    .join(" ")
    .replace(/[^\w()[\] -]+/g, "")
    .trim();
  const blob = new Blob([`${JSON.stringify(match, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filenameParts || "match"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function MatchJsonEditor(): React.JSX.Element {
  const [match, setMatch] = useState<MatchJson>(() => cloneMatch(blankMatch));
  const [fileName, setFileName] = useState<string>("New match JSON");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTeam, setActiveTeam] = useState<string>(() => Object.keys(blankMatch.teams ?? {})[0]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const races = match.races_played ?? 0;
  const tracks = ensureArrayLength(match.tracks, races, "");
  const teams = match.teams ?? {};
  const teamEntries = Object.entries(teams);
  const selectedTeamKey = teams[activeTeam] ? activeTeam : teamEntries[0]?.[0] ?? "";
  const selectedTeam = selectedTeamKey ? teams[selectedTeamKey] : undefined;
  const issues = useMemo(() => validateMatch(match), [match]);
  const errorCount = issues.filter((issue) => issue.level === "error").length;
  const warningCount = issues.length - errorCount;

  function updateMatch(patch: Partial<MatchJson>): void {
    setMatch((current) => ({ ...current, ...patch }));
  }

  function updateTracks(nextRaces: number): void {
    setMatch((current) => ({
      ...current,
      races_played: nextRaces,
      tracks: ensureArrayLength(current.tracks, nextRaces, ""),
      rxx: ensureArrayLength(current.rxx, Math.max(1, Math.ceil(nextRaces / 4)), ""),
      teams: Object.fromEntries(
        Object.entries(current.teams ?? {}).map(([teamKey, team]) => [
          teamKey,
          {
            ...team,
            players: Object.fromEntries(
              Object.entries(team.players ?? {}).map(([friendCode, player]) => {
                const scores = ensureArrayLength(player.race_scores, nextRaces, null);
                return [
                  friendCode,
                  {
                    ...player,
                    race_scores: scores,
                    race_positions: ensureArrayLength(player.race_positions, nextRaces, null),
                    race_roles: ensureArrayLength(player.race_roles, nextRaces, ""),
                    gp_scores: rebuildGpScores(scores),
                  },
                ];
              })
            ),
          },
        ])
      ),
    }));
  }

  function updateTrack(index: number, value: string): void {
    setMatch((current) => {
      const nextTracks = ensureArrayLength(current.tracks, current.races_played ?? 0, "");
      nextTracks[index] = value;
      return { ...current, tracks: nextTracks };
    });
  }

  function updateRxx(index: number, value: string): void {
    setMatch((current) => {
      const nextRxx = ensureArrayLength(current.rxx, Math.max(1, Math.ceil((current.races_played ?? 0) / 4)), "");
      nextRxx[index] = value;
      return { ...current, rxx: nextRxx };
    });
  }

  function updateTeam(teamKey: string, updater: (team: TeamJson) => TeamJson): void {
    setMatch((current) => ({
      ...current,
      teams: {
        ...(current.teams ?? {}),
        [teamKey]: updater((current.teams ?? {})[teamKey] ?? { players: {} }),
      },
    }));
  }

  function renameTeam(oldKey: string, nextKey: string): void {
    if (!nextKey.trim()) return;
    setMatch((current) => {
      const currentTeams = current.teams ?? {};
      const team = currentTeams[oldKey];
      if (!team || oldKey === nextKey) return current;
      const nextTeams: Record<string, TeamJson> = {};
      Object.entries(currentTeams).forEach(([key, value]) => {
        if (key === oldKey) {
          nextTeams[nextKey] = {
            ...value,
            players: Object.fromEntries(
              Object.entries(value.players ?? {}).map(([friendCode, player]) => [
                friendCode,
                { ...player, tag: nextKey },
              ])
            ),
          };
        } else {
          nextTeams[key] = value;
        }
      });
      setActiveTeam(nextKey);
      return { ...current, teams: nextTeams };
    });
  }

  function addPlayer(teamKey: string): void {
    const placeholderCode = `0000-0000-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
    updateTeam(teamKey, (team) => {
      const scores = Array.from({ length: races }, () => null);
      return {
        ...team,
        players: {
          ...(team.players ?? {}),
          [placeholderCode]: {
            table_str: "New Player",
            mii_name: "",
            lounge_name: "New Player",
            table_name: "New Player",
            tag: teamKey,
            total_score: 0,
            had_penalties: false,
            penalties: 0,
            subbed_out: false,
            race_scores: scores,
            race_positions: Array.from({ length: races }, () => null),
            gp_scores: rebuildGpScores(scores),
            race_roles: Array.from({ length: races }, () => ""),
            flag: "",
          },
        },
      };
    });
  }

  function updatePlayer(teamKey: string, friendCode: string, updater: (player: MatchPlayerJson) => MatchPlayerJson): void {
    updateTeam(teamKey, (team) => ({
      ...team,
      players: {
        ...(team.players ?? {}),
        [friendCode]: updater((team.players ?? {})[friendCode] ?? {}),
      },
    }));
  }

  function renamePlayer(teamKey: string, oldFriendCode: string, nextFriendCode: string): void {
    if (!nextFriendCode.trim()) return;
    updateTeam(teamKey, (team) => {
      const players = team.players ?? {};
      const player = players[oldFriendCode];
      if (!player || oldFriendCode === nextFriendCode) return team;
      const nextPlayers: Record<string, MatchPlayerJson> = {};
      Object.entries(players).forEach(([friendCode, value]) => {
        if (friendCode === oldFriendCode) nextPlayers[nextFriendCode] = value;
        else nextPlayers[friendCode] = value;
      });
      return { ...team, players: nextPlayers };
    });
  }

  function updateRaceValue(
    teamKey: string,
    friendCode: string,
    field: "race_scores" | "race_positions",
    raceIndex: number,
    value: string
  ): void {
    updatePlayer(teamKey, friendCode, (player) => {
      const nextValues = ensureArrayLength(player[field], races, null);
      nextValues[raceIndex] = asNullableNumber(value);
      const nextPlayer = { ...player, [field]: nextValues };
      if (field === "race_scores") {
        const scores = nextValues as Array<number | null>;
        nextPlayer.gp_scores = rebuildGpScores(scores);
        nextPlayer.total_score = scores.reduce<number>((sum, score) => sum + (score ?? 0), 0) - (player.penalties ?? 0);
      }
      return nextPlayer;
    });
  }

  function updateRaceRole(teamKey: string, friendCode: string, raceIndex: number, value: string): void {
    updatePlayer(teamKey, friendCode, (player) => {
      const roles = ensureArrayLength(player.race_roles, races, "");
      roles[raceIndex] = value;
      return { ...player, race_roles: roles };
    });
  }

  function loadFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as MatchJson;
        const normalized: MatchJson = {
          ...parsed,
          races_played: parsed.races_played ?? parsed.tracks?.length ?? 12,
          tracks: ensureArrayLength(parsed.tracks, parsed.races_played ?? parsed.tracks?.length ?? 12, ""),
          teams: parsed.teams ?? {},
        };
        setMatch(normalized);
        setFileName(file.name);
        setLoadError(null);
        setActiveTeam(Object.keys(normalized.teams ?? {})[0] ?? "");
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not parse JSON.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <main className="relative min-h-screen px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/" className="text-sm font-semibold text-blue-200 hover:text-white">
              Back home
            </Link>
            <h1 className="mt-2 text-3xl font-bold">Match JSON Editor</h1>
            <p className="mt-1 text-sm text-gray-300">{fileName}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) loadFile(file);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
            >
              Upload JSON
            </button>
            <button
              type="button"
              onClick={() => {
                setMatch(cloneMatch(blankMatch));
                setFileName("New match JSON");
                setActiveTeam("TeamA");
                setLoadError(null);
              }}
              className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
            >
              New Blank
            </button>
            <button
              type="button"
              onClick={() => downloadJson(match)}
              className="rounded-md bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-400"
            >
              Download JSON
            </button>
          </div>
        </div>

        {loadError && (
          <div className="mb-4 rounded-md border border-red-400/40 bg-red-950/70 px-4 py-3 text-sm text-red-100">
            {loadError}
          </div>
        )}

        <section className="mb-5 rounded-lg border border-white/10 bg-zinc-950/80 p-4 shadow-2xl">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-sm font-semibold text-gray-200">
              League
              <input
                value={match.league ?? ""}
                onChange={(event) => updateMatch({ league: event.target.value })}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300"
              />
            </label>
            <label className="text-sm font-semibold text-gray-200">
              Season
              <input
                value={match.season ?? ""}
                onChange={(event) => updateMatch({ season: event.target.value })}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300"
              />
            </label>
            <label className="text-sm font-semibold text-gray-200">
              Division
              <input
                value={match.division ?? ""}
                onChange={(event) => updateMatch({ division: event.target.value })}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300"
              />
            </label>
            <label className="text-sm font-semibold text-gray-200">
              Week
              <input
                type="number"
                value={numberInputValue(match.week)}
                onChange={(event) => updateMatch({ week: asNumber(event.target.value) })}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300"
              />
            </label>
            <label className="text-sm font-semibold text-gray-200 md:col-span-2">
              Match Label
              <input
                value={match.match_label ?? ""}
                onChange={(event) => updateMatch({ match_label: event.target.value })}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300"
              />
            </label>
            <label className="text-sm font-semibold text-gray-200">
              Format
              <input
                value={match.format ?? ""}
                onChange={(event) => updateMatch({ format: event.target.value })}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300"
              />
            </label>
            <label className="text-sm font-semibold text-gray-200">
              Races
              <input
                type="number"
                min={1}
                value={numberInputValue(match.races_played)}
                onChange={(event) => updateTracks(asNumber(event.target.value) ?? 0)}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300"
              />
            </label>
          </div>
        </section>

        <section className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold">Tracks and Room Codes</h2>
              <span className="text-sm text-gray-300">{tracks.length} races</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {tracks.map((track, index) => (
                <label key={`track-${index}`} className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Race {index + 1}
                  <input
                    value={track}
                    onChange={(event) => updateTrack(index, event.target.value)}
                    className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-blue-300"
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {ensureArrayLength(match.rxx, Math.max(1, Math.ceil(races / 4)), "").map((code, index) => (
                <label key={`rxx-${index}`} className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  GP {index + 1} room code
                  <input
                    value={code}
                    onChange={(event) => updateRxx(index, event.target.value)}
                    className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-blue-300"
                  />
                </label>
              ))}
            </div>
          </div>

          <aside className="rounded-lg border border-white/10 bg-zinc-950/80 p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold">Validation</h2>
              <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold">
                {errorCount} errors / {warningCount} warnings
              </span>
            </div>
            <div className="max-h-80 space-y-2 overflow-auto pr-1">
              {issues.length === 0 ? (
                <p className="rounded-md border border-emerald-400/30 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-100">
                  No structural issues found.
                </p>
              ) : (
                issues.map((issue, index) => (
                  <p
                    key={`${issue.message}-${index}`}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      issue.level === "error"
                        ? "border-red-400/30 bg-red-950/50 text-red-100"
                        : "border-amber-300/30 bg-amber-950/40 text-amber-100"
                    }`}
                  >
                    <span className="mr-2 font-bold uppercase">{issue.level}</span>
                    {issue.message}
                  </p>
                ))
              )}
            </div>
          </aside>
        </section>

        <section className="mb-5 rounded-lg border border-white/10 bg-zinc-950/80 p-4 shadow-2xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Teams and Players</h2>
            <div className="flex flex-wrap gap-2">
              {teamEntries.map(([teamKey, team]) => (
                <button
                  key={teamKey}
                  type="button"
                  onClick={() => setActiveTeam(teamKey)}
                  className={`rounded-md px-4 py-2 text-sm font-bold ${
                    selectedTeamKey === teamKey ? "bg-blue-500 text-white" : "bg-white/10 text-gray-200 hover:bg-white/15"
                  }`}
                >
                  {teamDisplayTag(teamKey, team)}
                </button>
              ))}
            </div>
          </div>

          {selectedTeam && (
            <div>
              <div className="grid gap-3 md:grid-cols-[11rem_11rem_9rem_9rem_minmax(0,1fr)]">
                <label className="text-sm font-semibold text-gray-200">
                  Team Key
                  <input
                    key={selectedTeamKey}
                    onBlur={(event) => renameTeam(selectedTeamKey, event.target.value.trim())}
                    className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300"
                    defaultValue={selectedTeamKey}
                  />
                </label>
                <label className="text-sm font-semibold text-gray-200">
                  Display Tag
                  <input
                    value={teamDisplayTag(selectedTeamKey, selectedTeam)}
                    onChange={(event) => {
                      updateTeam(selectedTeamKey, (team) => setTeamTagString(team, event.target.value, teamHexColor(team)));
                    }}
                    className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300"
                  />
                </label>
                <label className="text-sm font-semibold text-gray-200">
                  Color
                  <input
                    value={teamHexColor(selectedTeam)}
                    onChange={(event) => {
                      updateTeam(selectedTeamKey, (team) => setTeamTagString(team, teamDisplayTag(selectedTeamKey, team), event.target.value.toUpperCase()));
                    }}
                    className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-center uppercase text-white outline-none focus:border-blue-300"
                    placeholder="#FFFFFF"
                  />
                </label>
                <label className="text-sm font-semibold text-gray-200">
                  Team Penalty
                  <input
                    type="number"
                    value={numberInputValue(selectedTeam.penalties)}
                    onChange={(event) => updateTeam(selectedTeamKey, (team) => ({ ...team, penalties: asNumber(event.target.value) ?? 0 }))}
                    className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300"
                  />
                </label>
                <label className="text-sm font-semibold text-gray-200">
                  Penalty Text
                  <input
                    value={selectedTeam.table_penalty_str ?? ""}
                    onChange={(event) => updateTeam(selectedTeamKey, (team) => ({ ...team, table_penalty_str: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300"
                  />
                </label>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => addPlayer(selectedTeamKey)}
                  className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
                >
                  Add Player
                </button>
              </div>

              <div className="mt-4 space-y-5">
                {Object.entries(selectedTeam.players ?? {}).map(([friendCode, player]) => {
                  const scores = ensureArrayLength(player.race_scores, races, null);
                  const positions = ensureArrayLength(player.race_positions, races, null);
                  const roles = ensureArrayLength(player.race_roles, races, "");
                  return (
                    <article key={friendCode} className="rounded-lg border border-white/10 bg-black/30 p-3">
                      <div className="grid gap-3 md:grid-cols-[12rem_repeat(4,minmax(0,1fr))_7rem_7rem]">
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Friend Code
                          <input
                            defaultValue={friendCode}
                            onBlur={(event) => renamePlayer(selectedTeamKey, friendCode, event.target.value.trim())}
                            className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-blue-300"
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Lounge
                          <input
                            value={player.lounge_name ?? ""}
                            onChange={(event) => updatePlayer(selectedTeamKey, friendCode, (current) => ({ ...current, lounge_name: event.target.value }))}
                            className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-blue-300"
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Table
                          <input
                            value={player.table_name ?? ""}
                            onChange={(event) => updatePlayer(selectedTeamKey, friendCode, (current) => ({ ...current, table_name: event.target.value }))}
                            className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-blue-300"
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Mii
                          <input
                            value={player.mii_name ?? ""}
                            onChange={(event) => updatePlayer(selectedTeamKey, friendCode, (current) => ({ ...current, mii_name: event.target.value }))}
                            className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-blue-300"
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Flag
                          <input
                            value={player.flag ?? ""}
                            onChange={(event) => updatePlayer(selectedTeamKey, friendCode, (current) => ({ ...current, flag: event.target.value }))}
                            className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-blue-300"
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Penalty
                          <input
                            type="number"
                            value={numberInputValue(player.penalties)}
                            onChange={(event) => updatePlayer(selectedTeamKey, friendCode, (current) => {
                              const penalties = asNumber(event.target.value) ?? 0;
                              return {
                                ...current,
                                penalties,
                                had_penalties: penalties !== 0,
                                total_score: (current.race_scores ?? []).reduce<number>((sum, score) => sum + (score ?? 0), 0) - penalties,
                              };
                            })}
                            className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-blue-300"
                          />
                        </label>
                        <label className="flex items-end gap-2 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                          <input
                            type="checkbox"
                            checked={Boolean(player.subbed_out)}
                            onChange={(event) => updatePlayer(selectedTeamKey, friendCode, (current) => ({ ...current, subbed_out: event.target.checked }))}
                            className="h-4 w-4 accent-blue-400"
                          />
                          Subbed
                        </label>
                      </div>

                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full border-collapse text-sm">
                          <thead>
                            <tr className="text-xs uppercase tracking-wide text-gray-400">
                              <th className="sticky left-0 bg-zinc-950 px-2 py-2 text-left">Field</th>
                              {tracks.map((_, raceIndex) => (
                                <th key={`race-head-${raceIndex}`} className="min-w-[4.5rem] border-l border-white/10 px-2 py-2 text-center">
                                  R{raceIndex + 1}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <th className="sticky left-0 bg-zinc-950 px-2 py-2 text-left text-gray-300">Score</th>
                              {scores.map((score, raceIndex) => (
                                <td key={`score-${raceIndex}`} className="border-l border-white/10 px-1 py-1">
                                  <input
                                    type="number"
                                    value={numberInputValue(score)}
                                    onChange={(event) => updateRaceValue(selectedTeamKey, friendCode, "race_scores", raceIndex, event.target.value)}
                                    className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-center text-white outline-none focus:border-blue-300"
                                  />
                                </td>
                              ))}
                            </tr>
                            <tr>
                              <th className="sticky left-0 bg-zinc-950 px-2 py-2 text-left text-gray-300">Place</th>
                              {positions.map((position, raceIndex) => (
                                <td key={`position-${raceIndex}`} className="border-l border-white/10 px-1 py-1">
                                  <input
                                    type="number"
                                    value={numberInputValue(position)}
                                    onChange={(event) => updateRaceValue(selectedTeamKey, friendCode, "race_positions", raceIndex, event.target.value)}
                                    className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-center text-white outline-none focus:border-blue-300"
                                  />
                                </td>
                              ))}
                            </tr>
                            <tr>
                              <th className="sticky left-0 bg-zinc-950 px-2 py-2 text-left text-gray-300">Role</th>
                              {roles.map((role, raceIndex) => (
                                <td key={`role-${raceIndex}`} className="border-l border-white/10 px-1 py-1">
                                  <input
                                    value={role}
                                    onChange={(event) => updateRaceRole(selectedTeamKey, friendCode, raceIndex, event.target.value)}
                                    className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-center text-white outline-none focus:border-blue-300"
                                    placeholder="-"
                                  />
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-white/10 bg-zinc-950/80 p-4 shadow-2xl">
          <label className="text-sm font-semibold text-gray-200">
            Review Notes
            <textarea
              value={match.review_notes ?? ""}
              onChange={(event) => updateMatch({ review_notes: event.target.value })}
              className="mt-1 h-24 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300"
            />
          </label>
        </section>
      </div>
    </main>
  );
}

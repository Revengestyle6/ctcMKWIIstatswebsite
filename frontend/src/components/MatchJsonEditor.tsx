import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  type DatabaseAddition,
  databaseAdditionStreamUrl,
  fetchDatabaseAdditions,
  fetchMatchScopes,
  fetchPlayerIdentity,
  fetchTeamScopes,
  type MatchScope,
  postJson,
  searchTracks,
  type TeamScope,
} from "../api";
import {
  type ChartMode,
  type MatchDetail,
  TrackList,
  TraditionalTable,
  VerticalScorecard,
} from "./MatchHistory";
import {
  allPlayers,
  blankMatch,
  compileMatch,
  defaultRoleForPosition,
  expectedRoomSize,
  type MatchJson,
  type MatchPlayerJson,
  type RaceDraft,
  racesFromMatch,
  SCORE_TABLES,
  scoreForPosition,
  type TeamJson,
  teamColor,
  teamTag,
} from "./matchJsonEditorModel";

import {
  type ApprovalDecision,
  type CommitResult,
  clone,
  download,
  type IdentityState,
  isFfa,
  metadataValue,
  type NewEntry,
  newEntryDescription,
  normalized,
  numberValue,
  type PreviewMetadata,
  type PreviewResponse,
  validation,
  validFriendCode,
} from "./matchJsonEditorValidation";

const inputClass =
  "mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300";
const smallLabel = "text-xs font-semibold uppercase text-gray-400";

export default function MatchJsonEditor(): React.JSX.Element {
  const initial = clone(blankMatch);
  const [match, setMatch] = useState<MatchJson>(initial);
  const [races, setRaces] = useState<RaceDraft[]>(() => racesFromMatch(initial));
  const [fileName, setFileName] = useState("New match JSON");
  const [identityStates, setIdentityStates] = useState<Record<string, IdentityState>>({});
  const [trackOptions, setTrackOptions] = useState<Array<{ track_id: number; name: string }>>([]);
  const [tracksLoaded, setTracksLoaded] = useState(false);
  const [matchScopes, setMatchScopes] = useState<MatchScope[]>([]);
  const [scopesLoaded, setScopesLoaded] = useState(false);
  const [teamScopes, setTeamScopes] = useState<TeamScope[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [raceView, setRaceView] = useState<"one" | "all">("one");
  const [activeRace, setActiveRace] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draggedPlayer, setDraggedPlayer] = useState<string | null>(null);
  const [tablePreview, setTablePreview] = useState<MatchDetail | null>(null);
  const [previewMetadata, setPreviewMetadata] = useState<PreviewMetadata | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTableMode, setPreviewTableMode] = useState<"traditional" | "vertical">(
    "traditional"
  );
  const [previewChartMode, setPreviewChartMode] = useState<ChartMode>("cumulative");
  const [previewGroupByGp, setPreviewGroupByGp] = useState(true);
  const [newEntries, setNewEntries] = useState<NewEntry[]>([]);
  const [approvalDecisions, setApprovalDecisions] = useState<Record<string, ApprovalDecision>>({});
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [additionLogs, setAdditionLogs] = useState<DatabaseAddition[]>([]);
  const [additionStreamStatus, setAdditionStreamStatus] = useState<
    "connecting" | "live" | "reconnecting"
  >("connecting");
  const fileInput = useRef<HTMLInputElement>(null);
  const previewSection = useRef<HTMLElement>(null);
  const scrollToPreviewAfterReview = useRef(false);
  const queriedTrackNames = useRef(new Set<string>());

  const players = useMemo(() => allPlayers(match), [match]);
  const playerMap = useMemo(
    () => new Map(players.map((entry) => [entry.playerKey, entry])),
    [players]
  );
  const duplicateMiiNames = useMemo(() => {
    const counts = new Map<string, number>();
    players.forEach(({ player }) => {
      const key = (player.mii_name || "").trim().toLowerCase();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [players]);
  const issues = useMemo(
    () =>
      validation(
        match,
        races,
        identityStates,
        matchScopes,
        scopesLoaded,
        teamScopes,
        teamsLoaded,
        trackOptions,
        tracksLoaded,
        newEntries,
        approvalDecisions
      ),
    [
      match,
      races,
      identityStates,
      matchScopes,
      scopesLoaded,
      teamScopes,
      teamsLoaded,
      trackOptions,
      tracksLoaded,
      newEntries,
      approvalDecisions,
    ]
  );
  const compiled = useMemo(() => compileMatch(match, races), [match, races]);

  useEffect(() => {
    setTablePreview(null);
    setPreviewMetadata(null);
    setPreviewError(null);
    setCommitError(null);
    setCommitResult(null);
    setNewEntries([]);
    setApprovalModalOpen(false);
  }, []);

  useEffect(() => {
    if (!tablePreview || !scrollToPreviewAfterReview.current) return;
    scrollToPreviewAfterReview.current = false;
    requestAnimationFrame(() =>
      previewSection.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }, [tablePreview]);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    const mergeLogs = (incoming: DatabaseAddition[]) =>
      setAdditionLogs((current) => {
        const byId = new Map(current.map((entry) => [entry.id, entry]));
        incoming.forEach((entry) => {
          byId.set(entry.id, entry);
        });
        return Array.from(byId.values())
          .sort((left, right) => right.id - left.id)
          .slice(0, 100);
      });
    const startStream = (afterId: number) => {
      if (cancelled) return;
      source = new EventSource(databaseAdditionStreamUrl(afterId));
      source.onopen = () => setAdditionStreamStatus("live");
      source.onerror = () => setAdditionStreamStatus("reconnecting");
      source.addEventListener("addition", (event) => {
        try {
          mergeLogs([JSON.parse((event as MessageEvent<string>).data) as DatabaseAddition]);
        } catch {
          /* Ignore malformed stream events. */
        }
      });
    };
    fetchDatabaseAdditions(100)
      .then((history) => {
        if (cancelled) return;
        mergeLogs(history);
        const afterId = history.reduce((maximum, entry) => Math.max(maximum, entry.id), 0);
        startStream(afterId);
      })
      .catch(() => {
        if (!cancelled) {
          setAdditionStreamStatus("reconnecting");
          startStream(0);
        }
      });
    return () => {
      cancelled = true;
      source?.close();
    };
  }, []);

  useEffect(() => {
    searchTracks()
      .then((tracks) => {
        setTrackOptions(tracks);
        setTracksLoaded(true);
      })
      .catch(() => {
        setTrackOptions([]);
        setTracksLoaded(false);
      });
  }, []);
  useEffect(() => {
    const knownNames = new Set(trackOptions.map((track) => normalized(track.name)));
    races.forEach((race) => {
      const key = normalized(race.trackName);
      if (!key || knownNames.has(key) || queriedTrackNames.current.has(key)) return;
      queriedTrackNames.current.add(key);
      searchTracks(race.trackName)
        .then((matches) => {
          setTrackOptions((current) => {
            const ids = new Set(current.map((track) => track.track_id));
            return [...current, ...matches.filter((track) => !ids.has(track.track_id))];
          });
        })
        .catch(() => undefined);
    });
  }, [races, trackOptions]);
  useEffect(() => {
    fetchMatchScopes()
      .then((scopes) => {
        setMatchScopes(scopes);
        setScopesLoaded(true);
      })
      .catch(() => {
        setMatchScopes([]);
        setScopesLoaded(false);
      });
  }, []);
  useEffect(() => {
    fetchTeamScopes()
      .then((scopes) => {
        setTeamScopes(scopes);
        setTeamsLoaded(true);
      })
      .catch(() => {
        setTeamScopes([]);
        setTeamsLoaded(false);
      });
  }, []);

  useEffect(() => {
    const pending = players.filter(
      ({ playerKey, friendCode }) => validFriendCode(friendCode) && !identityStates[playerKey]
    );
    if (pending.length === 0) return;

    setIdentityStates((current) => ({
      ...current,
      ...Object.fromEntries(
        pending.map(({ playerKey }) => [playerKey, { status: "checking" as const }])
      ),
    }));

    pending.forEach(({ playerKey, friendCode }) => {
      fetchPlayerIdentity(friendCode)
        .then((result) => {
          const nextState: IdentityState =
            result.results.length === 1
              ? { status: "confirmed", identity: result.results[0] }
              : result.results.length === 0
                ? { status: "new", message: "Not found in database" }
                : { status: "conflict", message: "Multiple matches" };
          setIdentityStates((current) => ({ ...current, [playerKey]: nextState }));
        })
        .catch((error) => {
          setIdentityStates((current) => ({
            ...current,
            [playerKey]: {
              status: "conflict",
              message: error instanceof Error ? error.message : "Lookup failed",
            },
          }));
        });
    });
  }, [players, identityStates]);

  function updateMatch(patch: Partial<MatchJson>): void {
    setMatch((current) => ({ ...current, ...patch }));
  }
  function updateTeam(teamKey: string, updater: (team: TeamJson) => TeamJson): void {
    setMatch((current) => ({
      ...current,
      teams: { ...current.teams, [teamKey]: updater(current.teams?.[teamKey] ?? { players: {} }) },
    }));
  }
  function updatePlayer(
    teamKey: string,
    code: string,
    updater: (player: MatchPlayerJson) => MatchPlayerJson
  ): void {
    updateTeam(teamKey, (team) => ({
      ...team,
      players: { ...team.players, [code]: updater(team.players?.[code] ?? {}) },
    }));
  }
  function setRace(index: number, updater: (race: RaceDraft) => RaceDraft): void {
    setRaces((current) =>
      current.map((race, raceIndex) => (raceIndex === index ? updater(race) : race))
    );
  }
  function resizeRaces(count: number): void {
    const safeCount = Math.max(1, Math.min(99, count));
    setRaces((current) => {
      const highestNumber = Math.max(0, ...current.map((race) => race.raceNumber));
      return Array.from(
        { length: safeCount },
        (_, index) =>
          current[index] ?? {
            raceNumber: highestNumber + index - current.length + 1,
            trackName: "",
            roomSize: expectedRoomSize(match.format),
            placements: Array(expectedRoomSize(match.format)).fill(null),
            unplacedResults: [],
            missingPlayerResults: [],
          }
      );
    });
    updateMatch({ races_played: safeCount });
    setActiveRace((current) => Math.min(current, safeCount - 1));
  }
  function insertRace(raceIndex: number, side: "before" | "after"): void {
    const currentRace = races[raceIndex];
    if (!currentRace) return;
    const raceNumber = currentRace.raceNumber + (side === "after" ? 1 : 0);
    const insertIndex = raceIndex + (side === "after" ? 1 : 0);
    const roomSize = expectedRoomSize(match.format);
    setRaces((current) => {
      const shifted = current.map((race) =>
        race.raceNumber >= raceNumber ? { ...race, raceNumber: race.raceNumber + 1 } : race
      );
      shifted.splice(insertIndex, 0, {
        raceNumber,
        trackName: "",
        roomSize,
        placements: Array(roomSize).fill(null),
        unplacedResults: [],
        missingPlayerResults: [],
      });
      return shifted;
    });
    setMatch((current) => ({
      ...current,
      races_played: races.length + 1,
    }));
    setActiveRace(insertIndex);
  }
  function deleteRace(raceIndex: number): void {
    const race = races[raceIndex];
    if (!race || races.length <= 1) return;
    const hasData = Boolean(
      race.trackName.trim() ||
        race.placements.some(Boolean) ||
        race.unplacedResults.length ||
        race.missingPlayerResults.length
    );
    const message = hasData
      ? `Delete Race ${race.raceNumber}? Its track and all race results will be removed.`
      : `Delete Race ${race.raceNumber}?`;
    if (!window.confirm(message)) return;

    setRaces((current) =>
      current
        .filter((_, index) => index !== raceIndex)
        .map((entry) =>
          entry.raceNumber > race.raceNumber
            ? { ...entry, raceNumber: entry.raceNumber - 1 }
            : entry
        )
    );
    setMatch((current) => ({ ...current, races_played: races.length - 1 }));
    setActiveRace((current) =>
      current > raceIndex ? current - 1 : Math.min(current, races.length - 2)
    );
  }
  function updateRoomCode(index: number, value: string): void {
    const codes = match.rxx?.length ? [...match.rxx] : [""];
    codes[index] = value;
    updateMatch({ rxx: codes });
  }
  function addRoomCode(): void {
    updateMatch({ rxx: [...(match.rxx ?? []), ""] });
  }
  function removeRoomCode(index: number): void {
    const codes = (match.rxx ?? []).filter((_, codeIndex) => codeIndex !== index);
    updateMatch({ rxx: codes.length ? codes : [""] });
  }
  function addPlayer(teamKey: string): void {
    let index = 1;
    let code = `NEW-${index}`;
    const existing = new Set(players.map((player) => player.friendCode));
    while (existing.has(code)) code = `NEW-${++index}`;
    updateTeam(teamKey, (team) => ({
      ...team,
      players: {
        ...team.players,
        [code]: {
          lounge_name: "",
          table_name: "",
          mii_name: "",
          flag: "",
          penalties: 0,
          tag: teamKey,
        },
      },
    }));
  }
  function renamePlayer(teamKey: string, oldCode: string, newCode: string): void {
    if (!newCode || oldCode === newCode || match.teams?.[teamKey]?.players?.[newCode]) return;
    const oldKey = `${teamKey}::${oldCode}`;
    const newKey = `${teamKey}::${newCode}`;
    updateTeam(teamKey, (team) => {
      const next = { ...team.players };
      const player = next[oldCode];
      delete next[oldCode];
      next[newCode] = player;
      return { ...team, players: next };
    });
    setRaces((current) =>
      current.map((race) => ({
        ...race,
        placements: race.placements.map((placement) =>
          placement?.playerKey === oldKey ? { ...placement, playerKey: newKey } : placement
        ),
      }))
    );
    setIdentityStates((current) => {
      const next = { ...current };
      delete next[oldKey];
      return next;
    });
  }
  function removePlayer(teamKey: string, code: string): void {
    const key = `${teamKey}::${code}`;
    updateTeam(teamKey, (team) => {
      const next = { ...team.players };
      delete next[code];
      return { ...team, players: next };
    });
    setRaces((current) =>
      current.map((race) => ({
        ...race,
        placements: race.placements.map((placement) =>
          placement?.playerKey === key ? null : placement
        ),
        unplacedResults: race.unplacedResults.filter((result) => result.playerKey !== key),
      }))
    );
  }
  async function checkIdentity(playerKey: string, friendCode: string): Promise<void> {
    if (!validFriendCode(friendCode)) {
      setIdentityStates((s) => ({
        ...s,
        [playerKey]: { status: "conflict", message: "Invalid friend code" },
      }));
      return;
    }
    setIdentityStates((s) => ({ ...s, [playerKey]: { status: "checking" } }));
    try {
      const result = await fetchPlayerIdentity(friendCode);
      setIdentityStates((s) => ({
        ...s,
        [playerKey]:
          result.results.length === 1
            ? { status: "confirmed", identity: result.results[0] }
            : result.results.length === 0
              ? { status: "new", message: "Not found in database" }
              : { status: "conflict", message: "Multiple matches" },
      }));
    } catch (error) {
      setIdentityStates((s) => ({
        ...s,
        [playerKey]: {
          status: "conflict",
          message: error instanceof Error ? error.message : "Lookup failed",
        },
      }));
    }
  }
  function assignPlayer(raceIndex: number, positionIndex: number, playerKey: string): void {
    if (!playerKey) return;
    setRace(raceIndex, (race) => {
      const next = [...race.placements];
      const prior = next.findIndex((placement) => placement?.playerKey === playerKey);
      const displaced = next[positionIndex];
      if (prior >= 0) next[prior] = displaced;
      next[positionIndex] = {
        playerKey,
        role:
          prior >= 0
            ? (race.placements[prior]?.role ??
              defaultRoleForPosition(match.format, positionIndex + 1))
            : defaultRoleForPosition(match.format, positionIndex + 1),
      };
      return { ...race, placements: next };
    });
  }
  function removePlayerFromRace(raceIndex: number, playerKey: string): void {
    setRace(raceIndex, (race) => ({
      ...race,
      placements: race.placements.map((placement) =>
        placement?.playerKey === playerKey ? null : placement
      ),
    }));
  }
  function releaseUnplacedResult(raceIndex: number, playerKey: string): void {
    setRace(raceIndex, (race) => ({
      ...race,
      unplacedResults: race.unplacedResults.filter((result) => result.playerKey !== playerKey),
    }));
  }
  function addDisconnectedPlayerResult(raceIndex: number, playerKey: string): void {
    if (!playerKey) return;
    setRace(raceIndex, (race) => ({
      ...race,
      placements: race.placements.map((placement) =>
        placement?.playerKey === playerKey ? null : placement
      ),
      unplacedResults: race.unplacedResults.some((result) => result.playerKey === playerKey)
        ? race.unplacedResults
        : [...race.unplacedResults, { playerKey, score: 3, role: null }],
    }));
  }
  function updateDisconnectedPlayerResult(
    raceIndex: number,
    playerKey: string,
    score: number
  ): void {
    setRace(raceIndex, (race) => ({
      ...race,
      unplacedResults: race.unplacedResults.map((result) =>
        result.playerKey === playerKey ? { ...result, score } : result
      ),
    }));
  }
  function addMissingPlayerResult(raceIndex: number): void {
    const teamKey = Object.keys(match.teams ?? {})[0] ?? "";
    setRace(raceIndex, (race) => ({
      ...race,
      missingPlayerResults: [
        ...race.missingPlayerResults,
        { teamKey, score: 0, reason: "short_roster" },
      ],
    }));
  }
  function updateMissingPlayerResult(
    raceIndex: number,
    resultIndex: number,
    patch: Partial<RaceDraft["missingPlayerResults"][number]>
  ): void {
    setRace(raceIndex, (race) => ({
      ...race,
      missingPlayerResults: race.missingPlayerResults.map((result, index) =>
        index === resultIndex ? { ...result, ...patch } : result
      ),
    }));
  }
  function removeMissingPlayerResult(raceIndex: number, resultIndex: number): void {
    setRace(raceIndex, (race) => ({
      ...race,
      missingPlayerResults: race.missingPlayerResults.filter((_, index) => index !== resultIndex),
    }));
  }
  function applyMissingPlayerResult(
    raceIndex: number,
    resultIndex: number,
    scope: "all" | "remaining"
  ): void {
    const source = races[raceIndex]?.missingPlayerResults[resultIndex];
    if (!source) return;
    setRaces((current) =>
      current.map((race, index) => {
        if (scope === "remaining" && index < raceIndex) return race;
        const withoutSameTeam = race.missingPlayerResults.filter(
          (result) => result.teamKey !== source.teamKey
        );
        return { ...race, missingPlayerResults: [...withoutSameTeam, { ...source }] };
      })
    );
  }
  function setRoomSize(raceIndex: number, size: number): void {
    if (!SCORE_TABLES[size]) return;
    setRace(raceIndex, (race) => ({
      ...race,
      roomSize: size,
      placements: Array.from({ length: size }, (_, index) => race.placements[index] ?? null),
    }));
  }
  function displayName(key: string): string {
    const entry = playerMap.get(key);
    if (!entry) return key;
    const mii = entry.player.mii_name || entry.player.lounge_name || entry.friendCode;
    return (duplicateMiiNames.get((entry.player.mii_name || "").trim().toLowerCase()) ?? 0) > 1 &&
      entry.player.lounge_name
      ? `${mii} (${entry.player.lounge_name})`
      : mii;
  }
  function loadFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as MatchJson;
        setMatch(parsed);
        setRaces(racesFromMatch(parsed));
        setFileName(file.name);
        setIdentityStates({});
        setActiveRace(0);
        setLoadError(null);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not parse JSON");
      }
    };
    reader.readAsText(file);
  }
  async function generateTablePreview(entries: NewEntry[]): Promise<void> {
    setPreviewLoading(true);
    setPreviewError(null);
    setCommitError(null);
    try {
      const response = await postJson<PreviewResponse>("/api/matches/preview", {
        match: compiled,
        approved_new_entries: entries
          .filter((entry) => approvalDecisions[entry.key] === "approved")
          .map((entry) => entry.key),
      });
      setTablePreview(response.match);
      setPreviewMetadata(response.preview);
    } catch (error) {
      scrollToPreviewAfterReview.current = false;
      setTablePreview(null);
      setPreviewMetadata(null);
      setPreviewError(error instanceof Error ? error.message : "Could not generate table preview.");
    } finally {
      setPreviewLoading(false);
    }
  }
  async function confirmUpload(): Promise<void> {
    if (!previewMetadata || commitLoading) return;
    if (!window.confirm(`Upload this match and archive it at ${previewMetadata.archive_path}?`))
      return;
    setCommitLoading(true);
    setCommitError(null);
    try {
      const result = await postJson<CommitResult>("/api/matches/commit", {
        match: compiled,
        approved_new_entries: newEntries
          .filter((entry) => approvalDecisions[entry.key] === "approved")
          .map((entry) => entry.key),
        expected_preview_fingerprint: previewMetadata.fingerprint,
      });
      setCommitResult(result);
      if (result.match) setTablePreview(result.match);
      fetchMatchScopes()
        .then((scopes) => {
          setMatchScopes(scopes);
          setScopesLoaded(true);
        })
        .catch(() => undefined);
      fetchTeamScopes()
        .then((scopes) => {
          setTeamScopes(scopes);
          setTeamsLoaded(true);
        })
        .catch(() => undefined);
      searchTracks()
        .then((tracks) => {
          setTrackOptions(tracks);
          setTracksLoaded(true);
        })
        .catch(() => undefined);
      setAdditionLogs((current) => {
        const byId = new Map(current.map((entry) => [entry.id, entry]));
        result.additions.forEach((entry) => {
          byId.set(entry.id, entry);
        });
        return Array.from(byId.values())
          .sort((left, right) => right.id - left.id)
          .slice(0, 100);
      });
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : "Could not upload this match.");
    } finally {
      setCommitLoading(false);
    }
  }
  function discardPreview(): void {
    setTablePreview(null);
    setPreviewMetadata(null);
    setPreviewError(null);
    setCommitError(null);
  }
  async function requestTablePreview(): Promise<void> {
    scrollToPreviewAfterReview.current = true;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await postJson<{ new_entries: NewEntry[] }>("/api/matches/new-entries", {
        match: compiled,
      });
      setNewEntries(result.new_entries);
      if (result.new_entries.some((entry) => approvalDecisions[entry.key] !== "approved")) {
        setApprovalModalOpen(true);
        return;
      }
      await generateTablePreview(result.new_entries);
    } catch (error) {
      scrollToPreviewAfterReview.current = false;
      setPreviewError(
        error instanceof Error ? error.message : "Could not check new database entries."
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  const raceIndexes = raceView === "all" ? races.map((_, index) => index) : [activeRace];
  const errorCount = issues.filter((issue) => issue.level === "error").length;
  const leagueValid =
    scopesLoaded &&
    matchScopes.some((scope) => normalized(scope.league) === normalized(match.league));
  const seasonValid =
    scopesLoaded &&
    matchScopes.some(
      (scope) =>
        normalized(scope.league) === normalized(match.league) &&
        normalized(scope.season) === normalized(match.season)
    );
  const divisionValid =
    scopesLoaded &&
    matchScopes.some(
      (scope) =>
        normalized(scope.league) === normalized(match.league) &&
        normalized(scope.season) === normalized(match.season) &&
        normalized(scope.division) === normalized(match.division)
    );
  const availableTeams = teamScopes.filter(
    (scope) =>
      normalized(scope.league) === normalized(match.league) &&
      normalized(scope.season) === normalized(match.season) &&
      normalized(scope.division) === normalized(match.division)
  );
  const isApprovedNewEntry = (type: NewEntry["type"], predicate: (entry: NewEntry) => boolean) =>
    newEntries.some(
      (entry) =>
        entry.type === type && predicate(entry) && approvalDecisions[entry.key] === "approved"
    );

  return (
    <main className="relative min-h-screen px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-[92rem]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link to="/" className="text-blue-400 hover:text-blue-300 font-semibold">
              &lt; Back
            </Link>
            <h1 className="mt-2 text-3xl font-bold">Match JSON Editor</h1>
            <p className="text-sm text-gray-300">{fileName}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".json,.txt,application/json,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) loadFile(file);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="rounded-md border border-white/20 bg-white/10 px-4 py-2 font-semibold"
            >
              Upload JSON
            </button>
            <button
              type="button"
              onClick={() => {
                const next = clone(blankMatch);
                setMatch(next);
                setRaces(racesFromMatch(next));
                setFileName("New match JSON");
                setIdentityStates({});
              }}
              className="rounded-md border border-white/20 bg-white/10 px-4 py-2 font-semibold"
            >
              New Blank
            </button>
            <button
              type="button"
              onClick={() => download(compiled)}
              className="rounded-md bg-blue-500 px-4 py-2 font-bold hover:bg-blue-400"
            >
              Download JSON
            </button>
            <button
              type="button"
              disabled={previewLoading || errorCount > 0 || Boolean(commitResult)}
              onClick={requestTablePreview}
              className="rounded-md bg-emerald-500 px-4 py-2 font-bold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {commitResult
                ? "Uploaded"
                : previewLoading
                  ? "Preparing review..."
                  : "Review & Upload"}
            </button>
          </div>
        </header>
        {loadError && (
          <p className="mb-4 rounded-md border border-red-400/40 bg-red-950/70 p-3 text-red-100">
            {loadError}
          </p>
        )}

        <section className="mb-5 rounded-lg border border-white/10 bg-zinc-950/85 p-4 shadow-2xl">
          <h2 className="mb-3 text-xl font-bold">Additional Metadata</h2>
          <div className="grid gap-3 md:grid-cols-4">
            {(["league", "season", "division", "match_label"] as const).map((field) => {
              const valid =
                field === "league"
                  ? leagueValid
                  : field === "season"
                    ? seasonValid
                    : field === "division"
                      ? divisionValid
                      : null;
              const approved =
                field === "league" || field === "season"
                  ? isApprovedNewEntry(
                      "season",
                      (entry) => normalized(entry.value) === normalized(match.season)
                    )
                  : field === "division"
                    ? isApprovedNewEntry(
                        "division",
                        (entry) => normalized(entry.value) === normalized(match.division)
                      )
                    : false;
              const listId = field === "match_label" ? undefined : `${field}-options`;
              return (
                <label key={field} className="text-sm font-semibold capitalize text-gray-200">
                  {field.replace("_", " ")}
                  <input
                    list={listId}
                    value={String(match[field] ?? "")}
                    onChange={(e) => updateMatch({ [field]: metadataValue(field, e.target.value) })}
                    className={`${inputClass} ${valid === true ? "border-emerald-400/70" : approved ? "border-amber-300/70" : valid === false && scopesLoaded ? "border-red-400/70" : ""}`}
                  />
                  {valid !== null && (
                    <span
                      className={`mt-1 block text-xs ${valid ? "text-emerald-300" : approved ? "text-amber-300" : scopesLoaded ? "text-red-300" : "text-gray-400"}`}
                    >
                      {valid
                        ? "Confirmed in database"
                        : approved
                          ? "Approved as a new database entry"
                          : scopesLoaded
                            ? "No matching database record"
                            : "Checking database..."}
                    </span>
                  )}
                </label>
              );
            })}
            <datalist id="league-options">
              {Array.from(new Set(matchScopes.map((scope) => scope.league))).map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <datalist id="season-options">
              {Array.from(
                new Set(
                  matchScopes
                    .filter((scope) => normalized(scope.league) === normalized(match.league))
                    .map((scope) => scope.season)
                )
              ).map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <datalist id="division-options">
              {Array.from(
                new Set(
                  matchScopes
                    .filter(
                      (scope) =>
                        normalized(scope.league) === normalized(match.league) &&
                        normalized(scope.season) === normalized(match.season)
                    )
                    .map((scope) => scope.division)
                )
              ).map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <label className="text-sm font-semibold text-gray-200">
              Week
              <input
                type="number"
                min={1}
                step={1}
                value={numberValue(match.week)}
                onChange={(e) =>
                  updateMatch({ week: e.target.value ? Number(e.target.value) : undefined })
                }
                className={`${inputClass} ${!Number.isInteger(match.week) || Number(match.week) < 1 ? "border-red-400/70" : ""}`}
              />
            </label>
            <label className="text-sm font-semibold text-gray-200">
              Format
              <select
                value={match.format ?? "5v5"}
                onChange={(e) => updateMatch({ format: e.target.value })}
                className={inputClass}
              >
                <option>5v5</option>
                <option>4v4</option>
                <option>FFA</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-gray-200">
              Races
              <input
                type="number"
                min={1}
                value={races.length}
                onChange={(e) => resizeRaces(Number(e.target.value))}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-semibold text-gray-200">
              Review Notes
              <input
                value={match.review_notes ?? ""}
                onChange={(e) => updateMatch({ review_notes: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold">Room Codes</h3>
              <button
                type="button"
                onClick={addRoomCode}
                className="rounded-md border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/15"
              >
                Add room code
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {(match.rxx?.length ? match.rxx : [""]).map((code, index) => (
                <div key={index} className="grid grid-cols-[1fr_auto] items-end gap-2">
                  <label className={smallLabel}>
                    Room code {index + 1}
                    <input
                      value={code}
                      onChange={(e) => updateRoomCode(index, e.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <button
                    type="button"
                    title="Remove room code"
                    onClick={() => removeRoomCode(index)}
                    className="mb-0.5 h-10 px-3 text-red-300 hover:bg-red-950/40"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Add a code only when the room resets or changes host. Codes are kept in chronological
              order.
            </p>
          </div>
        </section>

        <section className="mb-5 rounded-lg border border-white/10 bg-zinc-950/85 p-4 shadow-2xl">
          <h2 className="mb-4 text-xl font-bold">Teams And Players</h2>
          <div className="grid gap-5 xl:grid-cols-2">
            {Object.entries(match.teams ?? {}).map(([teamKey, team]) => {
              const currentTag = teamTag(teamKey, team);
              const resolvedTeam = availableTeams.find(
                (scope) =>
                  normalized(scope.clan_tag) === normalized(currentTag) ||
                  normalized(scope.canonical_tag) === normalized(currentTag)
              );
              const proposedTeamEntry = newEntries.find(
                (entry) =>
                  entry.type === "team" && normalized(entry.value) === normalized(currentTag)
              );
              const approvedTeam =
                proposedTeamEntry && approvalDecisions[proposedTeamEntry.key] === "approved";
              return (
                <article key={teamKey} className="border border-white/10 bg-black/25 p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem]">
                    <label className={smallLabel}>
                      Team tag
                      <input
                        list="team-scope-options"
                        value={currentTag}
                        onChange={(e) =>
                          updateTeam(teamKey, (current) => ({
                            ...current,
                            table_tag_str: `${e.target.value} ${teamColor(current)}`,
                          }))
                        }
                        className={`${inputClass} ${resolvedTeam ? "border-emerald-400/70" : approvedTeam ? "border-amber-300/70" : teamsLoaded ? "border-red-400/70" : ""}`}
                      />
                      <span
                        className={`mt-1 block text-xs ${resolvedTeam ? "text-emerald-300" : approvedTeam ? "text-amber-300" : teamsLoaded ? "text-red-300" : "text-gray-400"}`}
                      >
                        {resolvedTeam ? (
                          <>
                            Confirmed:{" "}
                            <span className="normal-case">
                              {resolvedTeam.display_name || resolvedTeam.canonical_name}
                            </span>
                          </>
                        ) : approvedTeam ? (
                          proposedTeamEntry?.kind === "existing_team_new_scope" ? (
                            `Existing team; approved for ${match.season} ${match.division}`
                          ) : (
                            "Approved as a completely new team"
                          )
                        ) : teamsLoaded ? (
                          "Not found in selected league/season/division"
                        ) : (
                          "Checking database..."
                        )}
                      </span>
                    </label>
                    <label className={smallLabel}>
                      Color
                      <input
                        value={teamColor(team)}
                        onChange={(e) =>
                          updateTeam(teamKey, (current) => ({
                            ...current,
                            hex_color: e.target.value.toUpperCase(),
                            table_tag_str: `${teamTag(teamKey, current)} ${e.target.value.toUpperCase()}`,
                          }))
                        }
                        className={`${inputClass} text-center uppercase`}
                      />
                    </label>
                    <label className={smallLabel}>
                      Penalty
                      <input
                        type="number"
                        value={team.penalties ?? 0}
                        onChange={(e) =>
                          updateTeam(teamKey, (current) => ({
                            ...current,
                            penalties: Number(e.target.value) || 0,
                          }))
                        }
                        className={inputClass}
                      />
                    </label>
                  </div>
                  <div className="mt-4 space-y-3">
                    {Object.entries(team.players ?? {}).map(([code, player]) => {
                      const key = `${teamKey}::${code}`;
                      const state = identityStates[key];
                      const proposedPlayerEntry = newEntries.find(
                        (entry) => entry.type === "player" && entry.friend_code === code
                      );
                      const approvedPlayerEntry =
                        proposedPlayerEntry &&
                        approvalDecisions[proposedPlayerEntry.key] === "approved";
                      return (
                        <div key={key} className="border-t border-white/10 pt-3">
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[11rem_repeat(4,minmax(0,1fr))_auto]">
                            <label className={smallLabel}>
                              Friend code
                              <input
                                defaultValue={code.startsWith("NEW-") ? "" : code}
                                onBlur={(e) => renamePlayer(teamKey, code, e.target.value.trim())}
                                className={inputClass}
                                placeholder="0000-0000-0000"
                              />
                            </label>
                            {(["lounge_name", "table_name", "mii_name", "flag"] as const).map(
                              (field) => (
                                <label key={field} className={smallLabel}>
                                  {field.replace("_", " ")}
                                  <input
                                    value={String(player[field] ?? "")}
                                    onChange={(e) =>
                                      updatePlayer(teamKey, code, (current) => ({
                                        ...current,
                                        [field]: e.target.value,
                                      }))
                                    }
                                    className={inputClass}
                                  />
                                </label>
                              )
                            )}
                            <button
                              type="button"
                              title="Remove player"
                              onClick={() => removePlayer(teamKey, code)}
                              className="mt-5 h-10 px-3 text-red-300 hover:bg-red-950/40"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                            <button
                              type="button"
                              disabled={!validFriendCode(code) || state?.status === "checking"}
                              onClick={() => checkIdentity(key, code)}
                              className="rounded-md border border-white/15 bg-white/10 px-3 py-1.5 disabled:opacity-40"
                            >
                              {state?.status === "checking" ? "Checking..." : "Check database"}
                            </button>
                            {state?.status === "confirmed" && (
                              <span className="text-emerald-300">
                                Confirmed:{" "}
                                {state.identity?.canonical_lounge_name ||
                                  `Player ${state.identity?.player_id}`}
                              </span>
                            )}
                            {state?.status === "new" && (
                              <span className="text-amber-300">
                                {approvedPlayerEntry
                                  ? proposedPlayerEntry.kind === "existing_player_new_friend_code"
                                    ? `Approved for player ID ${proposedPlayerEntry.proposed_player_id}`
                                    : "Approved as a new player"
                                  : "New friend code: approval required"}
                              </span>
                            )}
                            {state?.status === "conflict" && (
                              <span className="text-red-300">{state.message}</span>
                            )}
                            {isFfa(match.format) && (
                              <label className="flex items-center gap-2">
                                Player penalty
                                <input
                                  type="number"
                                  value={player.penalties ?? 0}
                                  onChange={(e) =>
                                    updatePlayer(teamKey, code, (current) => ({
                                      ...current,
                                      penalties: Number(e.target.value) || 0,
                                    }))
                                  }
                                  className="w-20 rounded border border-white/15 bg-black/40 p-1"
                                />
                              </label>
                            )}
                            {!isFfa(match.format) && (player.penalties ?? 0) !== 0 && (
                              <span className="text-amber-300">
                                Legacy player penalty: {player.penalties}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => addPlayer(teamKey)}
                    className="mt-4 rounded-md border border-white/20 bg-white/10 px-4 py-2 font-semibold"
                  >
                    Add Player
                  </button>
                </article>
              );
            })}
          </div>
          <datalist id="team-scope-options">
            {availableTeams.map((team) => (
              <option key={`${team.team_id}-${team.clan_tag}`} value={team.clan_tag}>
                {team.display_name || team.canonical_name}
              </option>
            ))}
          </datalist>
        </section>

        <section className="mb-5 rounded-lg border border-white/10 bg-zinc-950/85 p-4 shadow-2xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Race Entry</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRaceView("one")}
                className={`rounded px-3 py-2 ${raceView === "one" ? "bg-blue-500" : "bg-white/10"}`}
              >
                One Race
              </button>
              <button
                type="button"
                onClick={() => setRaceView("all")}
                className={`rounded px-3 py-2 ${raceView === "all" ? "bg-blue-500" : "bg-white/10"}`}
              >
                All Races
              </button>
            </div>
          </div>
          {raceView === "one" && (
            <div className="mb-4 flex items-center justify-between">
              <button
                type="button"
                disabled={activeRace === 0}
                onClick={() => setActiveRace((r) => r - 1)}
                className="rounded bg-white/10 px-3 py-2 disabled:opacity-30"
              >
                Previous
              </button>
              <select
                value={activeRace}
                onChange={(e) => setActiveRace(Number(e.target.value))}
                className="rounded border border-white/15 bg-zinc-900 px-4 py-2"
              >
                {races.map((race, index) => (
                  <option key={index} value={index}>
                    Race {race.raceNumber}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={activeRace === races.length - 1}
                onClick={() => setActiveRace((r) => r + 1)}
                className="rounded bg-white/10 px-3 py-2 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
          <datalist id="track-options">
            {trackOptions.map((track) => (
              <option key={track.track_id} value={track.name} />
            ))}
          </datalist>
          <div className="space-y-5">
            {raceIndexes.map((raceIndex) => {
              const race = races[raceIndex];
              const assigned = new Set([
                ...race.placements.flatMap((placement) => (placement ? [placement.playerKey] : [])),
                ...race.unplacedResults.map((result) => result.playerKey),
              ]);
              const resolvedTrack = trackOptions.find(
                (track) => normalized(track.name) === normalized(race.trackName)
              );
              const approvedTrack = isApprovedNewEntry(
                "track",
                (entry) => normalized(entry.value) === normalized(race.trackName)
              );
              return (
                <article key={raceIndex} className="border border-white/10 bg-black/25 p-4">
                  <div className="mb-4 grid gap-3 sm:grid-cols-[7rem_minmax(15rem,1fr)_10rem_auto_auto]">
                    <label className={smallLabel}>
                      Race number
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={race.raceNumber}
                        onChange={(e) =>
                          setRace(raceIndex, (current) => ({
                            ...current,
                            raceNumber: Number(e.target.value),
                          }))
                        }
                        className={inputClass}
                      />
                    </label>
                    <label className={smallLabel}>
                      Race {race.raceNumber} track
                      <input
                        list="track-options"
                        value={race.trackName}
                        onChange={(e) =>
                          setRace(raceIndex, (current) => ({
                            ...current,
                            trackName: e.target.value,
                          }))
                        }
                        className={`${inputClass} ${resolvedTrack ? "border-emerald-400/70" : approvedTrack ? "border-amber-300/70" : tracksLoaded ? "border-red-400/70" : ""}`}
                      />
                      <span
                        className={`mt-1 block text-xs normal-case ${resolvedTrack ? "text-emerald-300" : approvedTrack ? "text-amber-300" : tracksLoaded ? "text-red-300" : "text-gray-400"}`}
                      >
                        {resolvedTrack
                          ? "Confirmed in database"
                          : approvedTrack
                            ? "Approved as a new track"
                            : tracksLoaded
                              ? "No matching database track"
                              : "Checking database..."}
                      </span>
                    </label>
                    <label className={smallLabel}>
                      Room size
                      <select
                        value={race.roomSize}
                        onChange={(e) => setRoomSize(raceIndex, Number(e.target.value))}
                        className={inputClass}
                      >
                        {Object.keys(SCORE_TABLES).map((size) => (
                          <option key={size}>{size}</option>
                        ))}
                      </select>
                    </label>
                    <span className="self-end pb-2 text-sm text-gray-300">
                      {race.placements.filter(Boolean).length} / {race.roomSize} placed
                      {race.unplacedResults.length
                        ? `; ${race.unplacedResults.length} DC award`
                        : ""}
                      {race.missingPlayerResults.length
                        ? `; ${race.missingPlayerResults.length} team missing`
                        : ""}
                    </span>
                    <button
                      type="button"
                      disabled={!race.placements.some(Boolean)}
                      onClick={() =>
                        setRace(raceIndex, (current) => ({
                          ...current,
                          placements: Array(current.roomSize).fill(null),
                        }))
                      }
                      className="self-end rounded-md border border-red-400/30 bg-red-950/30 px-3 py-2 text-sm font-semibold text-red-200 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Clear all positions
                    </button>
                  </div>
                  <div className="mb-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => insertRace(raceIndex, "before")}
                      className="rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15"
                    >
                      Insert race before
                    </button>
                    <button
                      type="button"
                      onClick={() => insertRace(raceIndex, "after")}
                      className="rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15"
                    >
                      Insert race after
                    </button>
                    <button
                      type="button"
                      disabled={races.length <= 1}
                      onClick={() => deleteRace(raceIndex)}
                      className="rounded-md border border-red-400/30 bg-red-950/30 px-3 py-2 text-sm font-semibold text-red-200 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Delete race
                    </button>
                    <span className="self-center text-xs text-gray-400">
                      Subsequent race numbers will shift automatically.
                    </span>
                  </div>
                  <div className="mb-4 border border-amber-400/30 bg-amber-950/25 p-3">
                    <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase text-amber-200">
                          Player Disconnect: Points Without Placement
                        </p>
                        <p className="mt-1 text-xs text-amber-100/80">
                          Use this when a configured player misses the finish but receives
                          disconnection points.
                        </p>
                      </div>
                      <label className={smallLabel}>
                        Add disconnected player
                        <select
                          value=""
                          onChange={(event) =>
                            addDisconnectedPlayerResult(raceIndex, event.target.value)
                          }
                          className={inputClass}
                        >
                          <option value="">Select player</option>
                          {players
                            .filter((player) => !assigned.has(player.playerKey))
                            .map((player) => (
                              <option key={player.playerKey} value={player.playerKey}>
                                {displayName(player.playerKey)}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    {race.unplacedResults.length > 0 && (
                      <div className="space-y-2">
                        {race.unplacedResults.map((result) => (
                          <div
                            key={result.playerKey}
                            className="grid gap-2 border border-amber-300/20 bg-black/20 px-3 py-2 text-sm sm:grid-cols-[minmax(12rem,1fr)_8rem_auto]"
                          >
                            <span className="self-center">
                              <strong>{displayName(result.playerKey)}</strong> has no finishing
                              position.
                            </span>
                            <label className={smallLabel}>
                              DC points
                              <input
                                type="number"
                                min={0}
                                max={15}
                                value={result.score}
                                onChange={(event) =>
                                  updateDisconnectedPlayerResult(
                                    raceIndex,
                                    result.playerKey,
                                    Number(event.target.value)
                                  )
                                }
                                className={inputClass}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => releaseUnplacedResult(raceIndex, result.playerKey)}
                              className="self-end rounded-md border border-amber-300/30 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-900/30"
                            >
                              Release to player pool
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mb-4 border border-white/10 bg-black/20 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase text-gray-300">
                          Team Missing Player
                        </p>
                        <p className="mt-1 text-xs text-gray-400">
                          Use this when a team starts short or continues short after an unreplaced
                          disconnect. This result does not occupy a finishing position.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addMissingPlayerResult(raceIndex)}
                        className="rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15"
                      >
                        Add missing player points
                      </button>
                    </div>
                    {race.missingPlayerResults.length > 0 && (
                      <div className="space-y-2">
                        {race.missingPlayerResults.map((result, resultIndex) => (
                          <div
                            key={resultIndex}
                            className="grid gap-2 border border-white/10 bg-zinc-900/60 p-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(13rem,1fr)_8rem_auto]"
                          >
                            <label className={smallLabel}>
                              Team
                              <select
                                value={result.teamKey}
                                onChange={(event) =>
                                  updateMissingPlayerResult(raceIndex, resultIndex, {
                                    teamKey: event.target.value,
                                  })
                                }
                                className={inputClass}
                              >
                                {Object.entries(match.teams ?? {}).map(([teamKey, team]) => (
                                  <option key={teamKey} value={teamKey}>
                                    {teamTag(teamKey, team)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className={smallLabel}>
                              Reason
                              <select
                                value={result.reason}
                                onChange={(event) =>
                                  updateMissingPlayerResult(raceIndex, resultIndex, {
                                    reason: event.target
                                      .value as RaceDraft["missingPlayerResults"][number]["reason"],
                                  })
                                }
                                className={inputClass}
                              >
                                <option value="short_roster">Started with four players</option>
                                <option value="unreplaced_disconnect">
                                  Disconnect/sub not replaced
                                </option>
                                <option value="unknown">Unknown / legacy source</option>
                              </select>
                            </label>
                            <label className={smallLabel}>
                              Points
                              <input
                                type="number"
                                min={0}
                                value={result.score}
                                onChange={(event) =>
                                  updateMissingPlayerResult(raceIndex, resultIndex, {
                                    score: Number(event.target.value),
                                  })
                                }
                                className={inputClass}
                              />
                            </label>
                            <div className="flex flex-wrap items-end gap-1 sm:col-span-4">
                              <button
                                type="button"
                                onClick={() =>
                                  applyMissingPlayerResult(raceIndex, resultIndex, "all")
                                }
                                className="rounded border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
                              >
                                Apply to all races
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  applyMissingPlayerResult(raceIndex, resultIndex, "remaining")
                                }
                                className="rounded border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
                              >
                                Apply from this race onward
                              </button>
                              <button
                                type="button"
                                onClick={() => removeMissingPlayerResult(raceIndex, resultIndex)}
                                className="ml-auto px-3 py-2 text-sm text-red-300 hover:bg-red-950/40"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggedPlayer) removePlayerFromRace(raceIndex, draggedPlayer);
                      setDraggedPlayer(null);
                    }}
                    className="mb-4 min-h-[6rem] border border-dashed border-white/20 bg-black/20 p-3"
                  >
                    <p className="mb-2 text-xs font-semibold uppercase text-gray-400">
                      Player Pool
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {players
                        .filter((player) => !assigned.has(player.playerKey))
                        .map(({ playerKey, teamKey }) => (
                          <button
                            key={playerKey}
                            type="button"
                            draggable
                            onDragStart={() => setDraggedPlayer(playerKey)}
                            onDragEnd={() => setDraggedPlayer(null)}
                            onClick={() => {
                              const empty = race.placements.findIndex((slot) => !slot);
                              if (empty >= 0) assignPlayer(raceIndex, empty, playerKey);
                            }}
                            style={{ borderColor: teamColor(match.teams?.[teamKey] ?? {}) }}
                            className="min-w-[8rem] cursor-grab rounded border-2 bg-zinc-900 px-3 py-2 text-center text-sm active:cursor-grabbing"
                          >
                            {displayName(playerKey)}
                          </button>
                        ))}
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {race.placements.map((placement, positionIndex) => (
                      <div
                        key={positionIndex}
                        draggable={Boolean(placement)}
                        onDragStart={() => {
                          if (placement) setDraggedPlayer(placement.playerKey);
                        }}
                        onDragEnd={() => setDraggedPlayer(null)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedPlayer) assignPlayer(raceIndex, positionIndex, draggedPlayer);
                          setDraggedPlayer(null);
                        }}
                        className={`grid min-h-[7.5rem] grid-cols-[3rem_1fr] border border-white/10 bg-zinc-900/70 ${placement ? "cursor-grab active:cursor-grabbing" : ""}`}
                      >
                        <div className="flex flex-col items-center justify-center border-r border-white/10">
                          <strong>{positionIndex + 1}</strong>
                          <span className="text-sm text-blue-300">
                            {scoreForPosition(positionIndex + 1, race.roomSize)} pts
                          </span>
                        </div>
                        <div className="p-2">
                          <select
                            value={placement?.playerKey ?? ""}
                            onChange={(e) =>
                              e.target.value
                                ? assignPlayer(raceIndex, positionIndex, e.target.value)
                                : setRace(raceIndex, (current) => ({
                                    ...current,
                                    placements: current.placements.map((slot, index) =>
                                      index === positionIndex ? null : slot
                                    ),
                                  }))
                            }
                            className="w-full rounded border border-white/15 bg-black/40 p-2 text-sm"
                          >
                            <option value="">Select player</option>
                            {players
                              .filter(
                                (player) =>
                                  !assigned.has(player.playerKey) ||
                                  player.playerKey === placement?.playerKey
                              )
                              .map((player) => (
                                <option key={player.playerKey} value={player.playerKey}>
                                  {displayName(player.playerKey)}
                                </option>
                              ))}
                          </select>
                          {placement && (
                            <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setRace(raceIndex, (current) => ({
                                    ...current,
                                    placements: current.placements.map((slot, index) =>
                                      index === positionIndex && slot
                                        ? { ...slot, role: "runner" }
                                        : slot
                                    ),
                                  }))
                                }
                                className={`rounded px-2 py-1 text-xs ${placement.role === "runner" ? "bg-blue-500" : "bg-white/10"}`}
                              >
                                Runner
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setRace(raceIndex, (current) => ({
                                    ...current,
                                    placements: current.placements.map((slot, index) =>
                                      index === positionIndex && slot
                                        ? { ...slot, role: "bagger" }
                                        : slot
                                    ),
                                  }))
                                }
                                className={`rounded px-2 py-1 text-xs ${placement.role === "bagger" ? "bg-amber-500 text-black" : "bg-white/10"}`}
                              >
                                Bagger
                              </button>
                              <button
                                type="button"
                                title="Clear position"
                                onClick={() =>
                                  setRace(raceIndex, (current) => ({
                                    ...current,
                                    placements: current.placements.map((slot, index) =>
                                      index === positionIndex ? null : slot
                                    ),
                                  }))
                                }
                                className="px-2 text-red-300"
                              >
                                Clear
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-zinc-950/85 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Validation</h2>
                <p className="mt-1 text-sm text-gray-300">
                  {errorCount} errors / {issues.length - errorCount} warnings
                </p>
              </div>
              <button
                type="button"
                disabled={previewLoading || errorCount > 0 || Boolean(commitResult)}
                onClick={requestTablePreview}
                className="rounded-md bg-emerald-500 px-4 py-2 font-bold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {commitResult
                  ? "Uploaded"
                  : previewLoading
                    ? "Preparing review..."
                    : "Review & Upload"}
              </button>
            </div>
            {errorCount > 0 && (
              <p className="mb-3 text-sm font-semibold text-red-300">
                Resolve all errors before reviewing this match for upload.
              </p>
            )}
            <div className="max-h-96 space-y-2 overflow-auto">
              {issues.length === 0 ? (
                <p className="text-emerald-300">Ready to review and upload.</p>
              ) : (
                issues.map((issue, index) => (
                  <p
                    key={index}
                    className={`border p-2 text-sm ${issue.level === "error" ? "border-red-500/30 bg-red-950/30 text-red-200" : "border-amber-500/30 bg-amber-950/30 text-amber-200"}`}
                  >
                    <strong className="uppercase">{issue.level}</strong> {issue.message}
                  </p>
                ))
              )}
            </div>
          </div>
          <details className="rounded-lg border border-white/10 bg-zinc-950/85 p-4">
            <summary className="cursor-pointer text-xl font-bold">Generated JSON Preview</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-gray-300">
              {JSON.stringify(compiled, null, 2)}
            </pre>
          </details>
        </section>

        {(tablePreview || previewError) && (
          <section
            ref={previewSection}
            className="mt-5 scroll-mt-4 rounded-lg border border-white/10 bg-zinc-950/85 p-4 shadow-2xl"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Match Table Preview</h2>
                {tablePreview?.review_notes && (
                  <p className="mt-1 text-sm text-amber-300">{tablePreview.review_notes}</p>
                )}
                {previewMetadata && (
                  <p className="mt-1 break-all text-sm text-gray-300">
                    Archive destination:{" "}
                    <strong className="text-white">{previewMetadata.archive_path}</strong>
                  </p>
                )}
              </div>
              {tablePreview && (
                <div className="flex flex-wrap gap-2">
                  <div className="inline-flex overflow-hidden rounded-md border border-white/20 bg-black/40">
                    <button
                      type="button"
                      onClick={() => setPreviewTableMode("traditional")}
                      className={`px-3 py-2 text-sm font-semibold ${previewTableMode === "traditional" ? "bg-blue-500" : "hover:bg-white/10"}`}
                    >
                      Traditional
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewTableMode("vertical")}
                      className={`px-3 py-2 text-sm font-semibold ${previewTableMode === "vertical" ? "bg-blue-500" : "hover:bg-white/10"}`}
                    >
                      Vertical
                    </button>
                  </div>
                  <div className="inline-flex overflow-hidden rounded-md border border-white/20 bg-black/40">
                    <button
                      type="button"
                      onClick={() => setPreviewChartMode("cumulative")}
                      className={`px-3 py-2 text-sm font-semibold ${previewChartMode === "cumulative" ? "bg-blue-500" : "hover:bg-white/10"}`}
                    >
                      Cumulative
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewChartMode("perRace")}
                      className={`px-3 py-2 text-sm font-semibold ${previewChartMode === "perRace" ? "bg-blue-500" : "hover:bg-white/10"}`}
                    >
                      Per race
                    </button>
                  </div>
                  {previewTableMode === "traditional" && (
                    <label className="flex items-center gap-2 rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm font-semibold">
                      <input
                        type="checkbox"
                        checked={previewGroupByGp}
                        onChange={(event) => setPreviewGroupByGp(event.target.checked)}
                      />
                      Group by GP
                    </label>
                  )}
                </div>
              )}
            </div>
            {previewError && (
              <p className="border border-red-500/30 bg-red-950/30 p-3 text-red-200">
                {previewError}
              </p>
            )}
            {commitError && (
              <p className="mb-4 border border-red-500/30 bg-red-950/30 p-3 text-red-200">
                {commitError}
              </p>
            )}
            {commitResult && (
              <div className="mb-4 border border-emerald-400/35 bg-emerald-950/25 p-3 text-emerald-100">
                <p className="font-bold">{commitResult.message}</p>
                <p className="mt-1 text-sm">
                  Match ID {commitResult.match_id} · {commitResult.archive_path}
                </p>
              </div>
            )}
            {tablePreview && previewMetadata && !commitResult && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-white/10 py-3">
                <div>
                  <p className="font-semibold">
                    Preview complete; its database transaction has been rolled back.
                  </p>
                  <p className="text-sm text-gray-400">
                    Confirming reruns validation and commits both the archive file and database
                    records.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={discardPreview}
                    className="rounded border border-white/15 px-4 py-2 font-semibold hover:bg-white/10"
                  >
                    Discard preview
                  </button>
                  <button
                    type="button"
                    disabled={commitLoading || errorCount > 0}
                    onClick={confirmUpload}
                    className="rounded bg-emerald-500 px-4 py-2 font-bold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {commitLoading ? "Uploading..." : "Confirm upload"}
                  </button>
                </div>
                {errorCount > 0 && (
                  <p className="w-full text-sm text-red-300">
                    Resolve all validation errors before uploading.
                  </p>
                )}
              </div>
            )}
            {tablePreview && (
              <div className="space-y-5">
                {previewTableMode === "traditional" ? (
                  <TraditionalTable
                    match={tablePreview}
                    groupByGp={previewGroupByGp}
                    teamColors={{}}
                    chartMode={previewChartMode}
                  />
                ) : (
                  <VerticalScorecard
                    match={tablePreview}
                    teamColors={{}}
                    chartMode={previewChartMode}
                  />
                )}
                <TrackList tracks={tablePreview.tracks} />
              </div>
            )}
          </section>
        )}

        <section className="mt-5 border border-white/10 bg-zinc-950/85 p-4 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Database Addition Log</h2>
              <p className="mt-1 text-sm text-gray-400">
                Committed catalog additions only; previews and failed uploads never appear.
              </p>
            </div>
            <span
              className={`text-sm font-semibold ${additionStreamStatus === "live" ? "text-emerald-300" : "text-amber-300"}`}
            >
              {additionStreamStatus === "live"
                ? "Live"
                : additionStreamStatus === "connecting"
                  ? "Connecting"
                  : "Reconnecting"}
            </span>
          </div>
          <div className="mt-4 max-h-80 overflow-auto border-t border-white/10">
            {additionLogs.length === 0 ? (
              <p className="py-4 text-sm text-gray-400">No committed additions recorded yet.</p>
            ) : (
              additionLogs.map((entry) => (
                <div
                  key={entry.id}
                  className="grid gap-1 border-b border-white/10 py-2 text-sm sm:grid-cols-[10rem_1fr_auto] sm:items-center"
                >
                  <span className="font-semibold text-blue-300">
                    {entry.entity_type.replaceAll("_", " ")}
                  </span>
                  <span>{entry.summary}</span>
                  <span className="text-xs text-gray-500">
                    {entry.created_at
                      ? new Date(entry.created_at).toLocaleString()
                      : `#${entry.id}`}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {approvalModalOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-entry-title"
          >
            <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-md border border-white/15 bg-zinc-950 p-5 shadow-2xl">
              <h2 id="new-entry-title" className="text-xl font-bold">
                Review New Database Entries
              </h2>
              <p className="mt-2 text-sm text-gray-300">
                Every new entry must be approved before this match can proceed to database preview
                or final upload.
              </p>
              <div className="mt-4 space-y-3">
                {newEntries.map((entry) => {
                  const decision = approvalDecisions[entry.key];
                  const description = newEntryDescription(entry);
                  const identityConflict = entry.kind === "player_identity_conflict";
                  const approveLabel =
                    entry.kind === "existing_player_new_friend_code"
                      ? "Approve link"
                      : entry.kind === "new_player_identity"
                        ? "Create player"
                        : "Approve";
                  return (
                    <div
                      key={entry.key}
                      className={`border p-3 ${identityConflict ? "border-red-400/40 bg-red-950/20" : decision === "approved" ? "border-emerald-400/40 bg-emerald-950/20" : decision === "rejected" ? "border-red-400/40 bg-red-950/20" : "border-white/15 bg-black/30"}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{description.heading}</p>
                        <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-semibold uppercase text-gray-300">
                          {entry.type}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-300">{description.detail}</p>
                      {description.caution && (
                        <p className="mt-2 text-sm font-semibold text-amber-300">
                          {description.caution}
                        </p>
                      )}
                      <div className="mt-3 flex gap-2">
                        {!identityConflict && (
                          <button
                            type="button"
                            onClick={() =>
                              setApprovalDecisions((current) => ({
                                ...current,
                                [entry.key]: "approved",
                              }))
                            }
                            className={`rounded px-3 py-1.5 text-sm font-semibold ${decision === "approved" ? "bg-emerald-500 text-black" : "border border-emerald-400/40 text-emerald-200 hover:bg-emerald-950/40"}`}
                          >
                            {approveLabel}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setApprovalDecisions((current) => ({
                              ...current,
                              [entry.key]: "rejected",
                            }))
                          }
                          className={`rounded px-3 py-1.5 text-sm font-semibold ${decision === "rejected" ? "bg-red-500 text-white" : "border border-red-400/40 text-red-200 hover:bg-red-950/40"}`}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    scrollToPreviewAfterReview.current = false;
                    setApprovalModalOpen(false);
                  }}
                  className="rounded border border-white/15 px-4 py-2 font-semibold hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    previewLoading ||
                    newEntries.length === 0 ||
                    newEntries.some(
                      (entry) =>
                        entry.kind === "player_identity_conflict" ||
                        approvalDecisions[entry.key] !== "approved"
                    )
                  }
                  onClick={async () => {
                    setApprovalModalOpen(false);
                    await generateTablePreview(newEntries);
                  }}
                  className="rounded bg-blue-500 px-4 py-2 font-bold hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {previewLoading ? "Generating preview..." : "Continue to preview"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

import type { DatabaseAddition, MatchScope, PlayerIdentity, TeamScope } from "../api";
import type { MatchDetail } from "./MatchHistory";
import {
  allPlayers,
  type MatchJson,
  type RaceDraft,
  SCORE_TABLES,
  teamTag,
} from "./matchJsonEditorModel";

export type IdentityState = {
  status: "idle" | "checking" | "confirmed" | "new" | "conflict";
  identity?: PlayerIdentity;
  message?: string;
};
export type Issue = { level: "error" | "warning"; message: string };
export type NewEntry = {
  key: string;
  type: "season" | "division" | "team" | "player" | "track";
  value: string;
  kind:
    | "new_season"
    | "new_division"
    | "existing_team_new_scope"
    | "new_team"
    | "new_player_identity"
    | "existing_player_new_friend_code"
    | "player_identity_conflict"
    | "new_track";
  league?: string;
  season?: string;
  division?: string;
  input_tag?: string;
  team_id?: number | null;
  canonical_name?: string | null;
  friend_code?: string;
  lounge_name?: string | null;
  proposed_player_id?: number;
  proposed_player?: PlayerIdentitySummary;
  candidates?: PlayerIdentitySummary[];
  match_reason?: string;
  existing_seasons?: string[];
};
export type PlayerIdentitySummary = {
  player_id: number;
  canonical_name: string | null;
  friend_codes: string[];
};
export type ApprovalDecision = "approved" | "rejected";
export type PreviewMetadata = {
  fingerprint: string;
  archive_path: string;
  new_entries: NewEntry[];
};
export type PreviewResponse = { match: MatchDetail; preview: PreviewMetadata };
export type CommitResult = {
  status: "committed" | "duplicate";
  match_id: number;
  archive_path: string;
  fingerprint: string;
  additions: DatabaseAddition[];
  message: string;
  match?: MatchDetail;
  archive_status?: "pending" | "complete" | "repair_required";
};
export type ReviewSubmissionReceipt = {
  receipt: string;
  status: string;
  submitted_at: string;
  updated_at: string;
  expires_at: string;
};

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function validFriendCode(value: string): boolean {
  return /^\d{4}-\d{4}-\d{4}$/.test(value);
}
export function numberValue(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}
export function isFfa(format = ""): boolean {
  return format.trim().toLowerCase() === "ffa";
}
export function metadataValue(
  field: "league" | "season" | "division" | "match_label",
  value: string
): string {
  if (field === "season" && /^\d+$/.test(value)) return `s${value}`;
  if (field === "division" && /^\d+$/.test(value)) return `d${value}`;
  return value;
}

export function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function newEntryDescription(entry: NewEntry): {
  heading: string;
  detail: string;
  caution?: string;
} {
  if (entry.kind === "existing_team_new_scope") {
    const name =
      entry.canonical_name && normalized(entry.canonical_name) !== normalized(entry.value)
        ? `${entry.canonical_name} (${entry.value})`
        : entry.value;
    return {
      heading: `${name} is an existing team`,
      detail: `Team ID ${entry.team_id} has not appeared in ${entry.season} ${entry.division}. Approval adds a new season/division entry linked to the existing team; it does not create a duplicate team.`,
    };
  }
  if (entry.kind === "new_team") {
    const inputNote =
      entry.input_tag && normalized(entry.input_tag) !== normalized(entry.value)
        ? ` (entered as ${entry.input_tag})`
        : "";
    return {
      heading: `${entry.value}${inputNote} does not match an existing team`,
      detail: `Approval creates a new global team and adds it to ${entry.season} ${entry.division}.`,
      caution: "Reject this if the tag is an alternate name for a team already in the database.",
    };
  }
  if (entry.kind === "new_division") {
    const elsewhere = entry.existing_seasons?.length
      ? ` The code exists in ${entry.existing_seasons.join(", ")}, but divisions are season-specific.`
      : "";
    return {
      heading: `${entry.value} is new for ${entry.season}`,
      detail: `Approval creates a new division under ${entry.league?.toUpperCase()} ${entry.season}.${elsewhere}`,
    };
  }
  if (entry.kind === "new_season")
    return {
      heading: `${entry.value} is a new ${entry.league?.toUpperCase()} season`,
      detail:
        "Approval creates the season record. Its divisions and team memberships are reviewed separately below.",
    };
  if (entry.kind === "new_player_identity")
    return {
      heading: `${entry.value} has an unknown friend code`,
      detail: "Approval creates a new player identity and assigns this friend code to it.",
      caution:
        "Create a player only if this person has never appeared before. Otherwise, map the new name and friend code to an existing player.",
    };
  if (entry.kind === "existing_player_new_friend_code") {
    const proposed = entry.proposed_player;
    const knownCodes = proposed?.friend_codes.length
      ? proposed.friend_codes.join(", ")
      : "none recorded";
    return {
      heading: `${proposed?.canonical_name || entry.lounge_name || entry.value} matches an existing player`,
      detail: `Approval links ${entry.friend_code} to player ID ${proposed?.player_id ?? entry.proposed_player_id} (${proposed?.canonical_name || entry.lounge_name}). Existing friend codes: ${knownCodes}.`,
      caution: `Matched by ${entry.match_reason || "exact lounge name"}. This keeps all match analytics under one player identity.`,
    };
  }
  if (entry.kind === "player_identity_conflict") {
    const candidates = (entry.candidates ?? [])
      .map((candidate) => `ID ${candidate.player_id} (${candidate.canonical_name || "unnamed"})`)
      .join(", ");
    return {
      heading: `${entry.lounge_name || entry.value} has conflicting identity matches`,
      detail: `The exact lounge name resolves to multiple historical players: ${candidates || "unknown candidates"}.`,
      caution:
        "Upload is blocked until you search for and select the correct existing player entity.",
    };
  }
  return {
    heading: `${entry.value} is a new track`,
    detail:
      "Approval creates a canonical track record because the name matches neither an existing track nor a known track alias.",
  };
}

export function validation(
  match: MatchJson,
  races: RaceDraft[],
  identities: Record<string, IdentityState>,
  scopes: MatchScope[],
  scopesLoaded: boolean,
  teamScopes: TeamScope[],
  teamsLoaded: boolean,
  trackOptions: Array<{ track_id: number; name: string }>,
  tracksLoaded: boolean,
  newEntries: NewEntry[],
  approvalDecisions: Record<string, ApprovalDecision>
): Issue[] {
  const issues: Issue[] = [];
  const players = allPlayers(match);
  const playersByKey = new Map(players.map((player) => [player.playerKey, player]));
  const friendCodes = new Map<string, string>();
  const playerIds = new Map<number, string>();
  const playerName = (playerKey: string) => {
    const entry = playersByKey.get(playerKey);
    return (
      entry?.player.lounge_name ||
      entry?.player.table_name ||
      entry?.player.mii_name ||
      entry?.friendCode ||
      "unknown player"
    );
  };
  const duplicateIdentityMessage = (
    priorPlayerKey: string,
    currentPlayerKey: string,
    playerId: number
  ) => {
    const prior = playersByKey.get(priorPlayerKey);
    const current = playersByKey.get(currentPlayerKey);
    return `Friend codes ${prior?.friendCode} (${playerName(priorPlayerKey)}) and ${
      current?.friendCode
    } (${playerName(currentPlayerKey)}) both resolve to player ID ${playerId}.`;
  };
  const approvedEntry = (type: NewEntry["type"], predicate: (entry: NewEntry) => boolean) =>
    newEntries.some(
      (entry) =>
        entry.type === type && predicate(entry) && approvalDecisions[entry.key] === "approved"
    );
  const newEntryIssue = (approved: boolean, pendingMessage: string, approvedMessage: string) =>
    issues.push({ level: "warning", message: approved ? approvedMessage : pendingMessage });
  if (!match.league) issues.push({ level: "error", message: "League is missing." });
  if (!match.season) issues.push({ level: "error", message: "Season is missing." });
  if (!match.division) issues.push({ level: "error", message: "Division is missing." });
  if (!match.match_label?.trim())
    issues.push({ level: "error", message: "Match label is missing." });
  if (!Number.isInteger(match.week) || Number(match.week) < 1)
    issues.push({
      level: "error",
      message: "Week is required and must be a positive whole number.",
    });
  if (races.length !== 12)
    issues.push({
      level: "warning",
      message: `This match contains ${races.length} races instead of the usual 12.`,
    });
  const teamCount = Object.keys(match.teams ?? {}).length;
  if (normalized(match.format) === "5v5" && teamCount > 2)
    issues.push({
      level: "error",
      message: `5v5 matches cannot have more than 2 teams (found ${teamCount}).`,
    });
  if (
    scopesLoaded &&
    match.league &&
    !scopes.some((scope) => normalized(scope.league) === normalized(match.league))
  ) {
    const approved = approvedEntry(
      "season",
      (entry) => normalized(entry.value) === normalized(match.season)
    );
    newEntryIssue(
      approved,
      `League ${match.league} does not exist in the database. Review the new season entry.`,
      `League ${match.league} will be created with season ${match.season}.`
    );
  }
  const seasonScopes = scopes.filter(
    (scope) =>
      normalized(scope.league) === normalized(match.league) &&
      normalized(scope.season) === normalized(match.season)
  );
  if (scopesLoaded && match.league && match.season && seasonScopes.length === 0) {
    const approved = approvedEntry(
      "season",
      (entry) => normalized(entry.value) === normalized(match.season)
    );
    newEntryIssue(
      approved,
      `Season ${match.season} does not exist for league ${match.league}.`,
      `New season ${match.season} is approved for database insertion.`
    );
  }
  if (
    scopesLoaded &&
    seasonScopes.length > 0 &&
    match.division &&
    !seasonScopes.some((scope) => normalized(scope.division) === normalized(match.division))
  ) {
    const approved = approvedEntry(
      "division",
      (entry) => normalized(entry.value) === normalized(match.division)
    );
    newEntryIssue(
      approved,
      `Division ${match.division} does not exist in ${match.league} ${match.season}.`,
      `New division ${match.division} is approved for database insertion.`
    );
  }
  const selectedTeamScope = teamScopes.filter(
    (scope) =>
      normalized(scope.league) === normalized(match.league) &&
      normalized(scope.season) === normalized(match.season) &&
      normalized(scope.division) === normalized(match.division)
  );
  const resolvedTeamIds = new Map<number, string>();
  const configuredTeamTags = new Map<string, string>();
  Object.entries(match.teams ?? {}).forEach(([teamKey, team]) => {
    const tag = teamTag(teamKey, team);
    const normalizedTag = normalized(tag);
    if (!normalizedTag) {
      issues.push({ level: "error", message: "Every team needs a tag." });
      return;
    }
    const prior = configuredTeamTags.get(normalizedTag);
    if (prior && prior !== teamKey)
      issues.push({ level: "error", message: `Team tag ${tag} is configured more than once.` });
    configuredTeamTags.set(normalizedTag, teamKey);
  });
  if (teamsLoaded) {
    Object.entries(match.teams ?? {}).forEach(([teamKey, team]) => {
      const tag = teamTag(teamKey, team);
      const resolved = selectedTeamScope.find(
        (scope) =>
          normalized(scope.clan_tag) === normalized(tag) ||
          normalized(scope.canonical_tag) === normalized(tag)
      );
      if (!resolved) {
        const proposal = newEntries.find(
          (entry) => entry.type === "team" && normalized(entry.value) === normalized(tag)
        );
        const approved = Boolean(proposal && approvalDecisions[proposal.key] === "approved");
        const approvedMessage =
          proposal?.kind === "existing_team_new_scope"
            ? `Existing team ${tag} is approved for a new ${match.season} ${match.division} entry.`
            : `Completely new team ${tag} is approved for database insertion.`;
        newEntryIssue(
          approved,
          `Team ${tag} does not belong to ${match.league || "the selected league"} ${match.season || "season"} ${match.division || "division"}.`,
          approvedMessage
        );
      } else {
        const prior = resolvedTeamIds.get(resolved.team_id);
        if (prior)
          issues.push({
            level: "error",
            message: `Teams ${prior} and ${tag} resolve to the same database team.`,
          });
        resolvedTeamIds.set(resolved.team_id, tag);
      }
    });
  }
  const raceNumberCounts = new Map<number, number>();
  races.forEach((race) => {
    raceNumberCounts.set(race.raceNumber, (raceNumberCounts.get(race.raceNumber) ?? 0) + 1);
  });
  raceNumberCounts.forEach((count, raceNumber) => {
    if (count > 1)
      issues.push({ level: "error", message: `Race number ${raceNumber} is used more than once.` });
  });
  players.forEach(({ playerKey, friendCode, player }) => {
    const name = player.lounge_name || player.mii_name || friendCode;
    const identity = identities[playerKey];
    if (!validFriendCode(friendCode))
      issues.push({
        level: "error",
        message:
          identity?.status === "conflict" && identity.message
            ? identity.message
            : `${name} needs a valid friend code.`,
      });
    const priorFriendCodePlayer = friendCodes.get(friendCode);
    if (priorFriendCodePlayer)
      issues.push({
        level: "error",
        message: `Friend code ${friendCode} is duplicated between ${playerName(
          priorFriendCodePlayer
        )} and ${name}.`,
      });
    friendCodes.set(friendCode, playerKey);
    if (
      validFriendCode(friendCode) &&
      identity?.status !== "confirmed" &&
      identity?.status !== "new"
    ) {
      issues.push({
        level: "warning",
        message: `${name} has not been checked against the database.`,
      });
    }
    if (identity?.identity) {
      const prior = playerIds.get(identity.identity.player_id);
      if (prior && prior !== playerKey)
        issues.push({
          level: "error",
          message: duplicateIdentityMessage(prior, playerKey, identity.identity.player_id),
        });
      playerIds.set(identity.identity.player_id, playerKey);
    }
    if (identity?.status === "new") {
      const proposal = newEntries.find(
        (entry) => entry.type === "player" && entry.friend_code === friendCode
      );
      const approved = Boolean(proposal && approvalDecisions[proposal.key] === "approved");
      if (
        proposal?.kind === "existing_player_new_friend_code" &&
        proposal.proposed_player_id !== undefined
      ) {
        const prior = playerIds.get(proposal.proposed_player_id);
        if (prior && prior !== playerKey)
          issues.push({
            level: "error",
            message: duplicateIdentityMessage(prior, playerKey, proposal.proposed_player_id),
          });
        playerIds.set(proposal.proposed_player_id, playerKey);
      }
      const approvedMessage =
        proposal?.kind === "existing_player_new_friend_code"
          ? `${friendCode} is approved for linking to existing player ID ${proposal.proposed_player_id}.`
          : `New player ${name} is approved for database insertion.`;
      newEntryIssue(
        approved,
        `${name} is not in the database and requires approval.`,
        approvedMessage
      );
    }
    if (!isFfa(match.format) && (player.penalties ?? 0) !== 0) {
      issues.push({
        level: "warning",
        message: `${name} has a legacy player penalty in a team match.`,
      });
    }
  });
  races.forEach((race) => {
    const label =
      Number.isInteger(race.raceNumber) && race.raceNumber > 0
        ? `Race ${race.raceNumber}`
        : "A race with an invalid number";
    if (!Number.isInteger(race.raceNumber) || race.raceNumber < 1)
      issues.push({
        level: "error",
        message: "Every race number must be a positive whole number.",
      });
    if (!SCORE_TABLES[race.roomSize])
      issues.push({
        level: "error",
        message: `${label} has unsupported room size ${race.roomSize}.`,
      });
    if (!race.trackName.trim()) issues.push({ level: "error", message: `${label} needs a track.` });
    else if (
      tracksLoaded &&
      !trackOptions.some((track) => normalized(track.name) === normalized(race.trackName))
    ) {
      const approved = approvedEntry(
        "track",
        (entry) => normalized(entry.value) === normalized(race.trackName)
      );
      newEntryIssue(
        approved,
        `${label} track ${race.trackName} does not exist in the database.`,
        `${label} uses new track ${race.trackName}, which is approved for database insertion.`
      );
    }
    const assigned = race.placements.filter(Boolean);
    if (assigned.length !== race.roomSize)
      issues.push({
        level: "error",
        message: `${label} has ${assigned.length} placements for a ${race.roomSize}-player room. Disconnection and missing-player awards do not occupy placement slots.`,
      });
    const keys = assigned.map((placement) => placement?.playerKey);
    if (new Set(keys).size !== keys.length)
      issues.push({ level: "error", message: `${label} contains a player more than once.` });
    if (assigned.some((placement) => !placement?.role))
      issues.push({ level: "warning", message: `${label} has unconfirmed roles.` });
    race.unplacedResults.forEach((result) => {
      const player = players.find((entry) => entry.playerKey === result.playerKey);
      const name = player
        ? player.player.lounge_name || player.player.mii_name || player.friendCode
        : result.playerKey;
      if (!Number.isFinite(result.score) || result.score < 0 || result.score > 15)
        issues.push({
          level: "error",
          message: `${label} has an invalid disconnected-player score for ${name}.`,
        });
      else
        issues.push({
          level: "warning",
          message: `${label} gives ${name} ${result.score} disconnection points without a placement.`,
        });
    });
    race.missingPlayerResults.forEach((result) => {
      const tag = match.teams?.[result.teamKey]
        ? teamTag(result.teamKey, match.teams[result.teamKey])
        : result.teamKey;
      if (!match.teams?.[result.teamKey])
        issues.push({
          level: "error",
          message: `${label} assigns missing-player points to an unknown team.`,
        });
      if (!Number.isFinite(result.score) || result.score < 0)
        issues.push({
          level: "error",
          message: `${label} has an invalid missing-player score for ${tag}.`,
        });
      else
        issues.push({
          level: "warning",
          message: `${label} assigns ${result.score} missing-player points to ${tag} (${result.reason.replaceAll("_", " ")}).`,
        });
    });
  });
  return issues;
}

export function download(match: MatchJson): void {
  const name = (match.match_label || "match").replace(/[^\w()[\] -]+/g, "").trim() || "match";
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(match, null, 2)}\n`], { type: "application/json" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

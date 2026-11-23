import type { TeamScope } from "../../api";
import { identityTextKey } from "../../identityText";
import {
  allPlayers,
  type MatchJson,
  type MatchPlayerJson,
  type TeamJson,
  teamColor,
  teamTag,
} from "./matchJsonEditorModel";
import { findTeamScope, isFfa } from "./matchJsonEditorValidation";

export type RosterPlayer = {
  friendCode: string;
  miiName: string;
  loungeName?: string;
};

const friendCodePattern = /^(?:\[)?(\d{4}-\d{4}-\d{4})(?!\d)(?=$|\]|\s)/;
const roomRolePattern = /^\d+\.\s*(?:\*\*)?(?:host|guest)\b/i;
const splitColumns = /\t| {2,}/;
const markdownEscape = /\\([\\\x60*_[\]{}()#+.!|>~-])/g;
const discordHeader = /^\s*#\\?\.\s+Lounge Name\s+Mii Name\s+FC\s*$/i;
const discordRow = /^\s*\d+\\?\.\s/;
const finalFriendCode = /\s(\d{4}-\d{4}-\d{4})$/;
const roomHeading = /^(?:\|\s*)?private room\b|^-\s+room\s/i;

function tableCells(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
  if (line.startsWith("|")) {
    return line
      .replace(/^\||(?<!\\)\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim());
  }
  return line.split(splitColumns);
}

function readDiscordRow(line: string, miiColumn: number): RosterPlayer | undefined {
  const row = line.replace(/\\$/, "").trimEnd();
  const code = finalFriendCode.exec(row);
  if (!code || !discordRow.test(row)) return undefined;

  const columns = row.trim().split(/\t+| {2,}/);
  if (columns.length === 4 && columns[3] === code[1]) {
    return { friendCode: code[1], loungeName: columns[1], miiName: columns[2] };
  }
  const nameStart = discordRow.exec(row)?.[0].length ?? 0;
  const loungeName = row.slice(nameStart, miiColumn).trim();
  const miiName = row.slice(miiColumn, code.index).trim();
  if (loungeName && miiName && !row.includes("\t")) {
    return { friendCode: code[1], loungeName, miiName };
  }
}

export function parseRoster(text: string): {
  players: RosterPlayer[];
  duplicates: number;
  conflicts: number;
  incomplete: number;
} {
  let wiimmfi: { friendCode: number; miiName: number; width: number } | undefined;
  let discordMiiColumn = -1;
  let nextTable = false;
  const players = new Map<string, RosterPlayer>();
  const conflicts = new Set<string>();
  let duplicates = 0;
  let incomplete = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (roomHeading.test(line)) {
      nextTable ||= players.size > 0 || conflicts.size > 0;
      wiimmfi = undefined;
      discordMiiColumn = -1;
      continue;
    }
    const cells = tableCells(rawLine.includes("\t") ? rawLine : line);
    const headings = cells.map((cell) => cell.toLowerCase());
    const friendCodeColumn = headings.indexOf("friend code");
    const miiNameColumn = headings.indexOf("mii name");

    if (friendCodeColumn >= 0 && miiNameColumn >= 0) {
      nextTable ||= players.size > 0 || conflicts.size > 0;
      wiimmfi = { friendCode: friendCodeColumn, miiName: miiNameColumn, width: cells.length };
      discordMiiColumn = -1;
      continue;
    }
    if (discordHeader.test(line.replace(/\\$/, "").trimEnd())) {
      nextTable ||= players.size > 0 || conflicts.size > 0;
      discordMiiColumn = line.toLowerCase().indexOf("mii name");
      wiimmfi = undefined;
      continue;
    }

    let player: RosterPlayer | undefined;
    if (discordMiiColumn >= 0) {
      player = readDiscordRow(line, discordMiiColumn);
    } else {
      // Browser-copied table headings can wrap onto multiple lines. The role
      // identifies Wiimmfi player rows even when the header is missing.
      const codeCell = cells[wiimmfi?.friendCode ?? 0] ?? "";
      const code = friendCodePattern.exec(codeCell)?.[1];
      const name = wiimmfi
        ? wiimmfi.width === cells.length
          ? cells[wiimmfi.miiName]
          : undefined
        : cells.length >= 3 && roomRolePattern.test(cells[1])
          ? cells.at(-1)
          : undefined;
      const miiName = line.startsWith("|") ? name?.replace(markdownEscape, "$1") : name;
      if (code && miiName) player = { friendCode: code, miiName };
      else if (code && (wiimmfi || roomRolePattern.test(cells[1] ?? ""))) incomplete += 1;
    }
    if (!player) continue;
    if (nextTable) throw new Error("Paste one Wiimmfi or Table Bot room at a time.");
    if (conflicts.has(player.friendCode)) continue;

    const existing = players.get(player.friendCode);
    if (!existing) {
      players.set(player.friendCode, player);
    } else if (existing.miiName === player.miiName && existing.loungeName === player.loungeName) {
      duplicates += 1;
    } else {
      players.delete(player.friendCode);
      conflicts.add(player.friendCode);
    }
  }

  if (players.size === 0 && conflicts.size === 0) {
    throw new Error(
      "No players found. Copy the Wiimmfi room table or the full Table Bot VR output."
    );
  }
  return {
    players: Array.from(players.values()),
    duplicates,
    conflicts: conflicts.size,
    incomplete,
  };
}

function tagKey(value: string): string {
  return value
    .trim()
    .normalize("NFC")
    .replace(/^\[([^\]]+)\]$/, "$1");
}

const wordCharacters = "[\\p{L}\\p{M}\\p{N}]";
const wordCharacter = new RegExp(wordCharacters, "u");
const nameWords = new RegExp(`${wordCharacters}+`, "gu");

// Tags often sit at the start or end of a Mii name. Include bracketed tags
// followed immediately by a name, and preserve the original spelling for display.
function nameTags(name: string): string[] {
  const words = Array.from(name.matchAll(nameWords));
  return [
    name.match(/^\[([^\]]+)\]/)?.[1],
    words[0]?.index === 0 ? words[0][0] : undefined,
    words.at(-1)?.[0],
  ].filter((value): value is string => Boolean(value));
}

function nameMatchesTag(name: string, tag: string): boolean {
  if (!tag) return false;
  if (nameTags(name).some((candidate) => tagKey(candidate) === tag)) return true;
  const key = tagKey(name);
  return (
    (key.startsWith(tag) &&
      (!wordCharacter.test(tag.at(-1) ?? "") || !wordCharacter.test(key[tag.length] ?? ""))) ||
    (key.endsWith(tag) &&
      (!wordCharacter.test(tag[0]) || !wordCharacter.test(key[key.length - tag.length - 1] ?? "")))
  );
}

type ScopedRoster = {
  teams: TeamScope[];
  memberships: Record<string, number[]>;
};

type SuggestedTags = Array<string | undefined>;

function isEditableRosterTag(key: string, team: TeamJson): boolean {
  const tag = teamTag(key, team);
  return (
    (key === "TeamA" || key === "TeamB") &&
    (!tag || tag === key) &&
    Object.keys(team.players ?? {}).length === 0
  );
}

export function rosterTeamSuggestions(
  match: MatchJson,
  players: RosterPlayer[],
  scope?: ScopedRoster,
  lockedTags?: SuggestedTags,
  tagEdits: Record<string, string> = {}
) {
  const teams = Object.entries(match.teams ?? {});
  const seasonTeams = scope?.teams ?? [];
  const seasonTeamsById = new Map(seasonTeams.map((team) => [team.team_season_entry_id, team]));
  const resolveTag = (tag: string) => {
    const resolved = findTeamScope(seasonTeams, tag);
    if (resolved) return resolved;
    const key = identityTextKey(tagKey(tag));
    const equivalent = seasonTeams.filter((team) => identityTextKey(tagKey(team.clan_tag)) === key);
    return equivalent.length === 1 ? equivalent[0] : undefined;
  };
  const votes = new Map<number, number>();
  const evidence = new Map(
    players.map(({ friendCode, miiName }) => {
      const rosterTeams = (scope?.memberships[friendCode] ?? []).filter((id) =>
        seasonTeamsById.has(id)
      );
      const namedTeams = seasonTeams.filter(
        ({ clan_tag, canonical_tag }) =>
          nameMatchesTag(miiName, tagKey(clan_tag)) ||
          nameMatchesTag(miiName, tagKey(canonical_tag))
      );
      const namedId = namedTeams.length === 1 ? namedTeams[0].team_season_entry_id : undefined;
      const rosterId = rosterTeams.length === 1 ? rosterTeams[0] : undefined;
      const conflict =
        rosterTeams.length > 1 ||
        (rosterId !== undefined && namedId !== undefined && namedId !== rosterId);
      const id = conflict ? undefined : (rosterId ?? namedId);
      if (id !== undefined) votes.set(id, (votes.get(id) ?? 0) + 1);
      return [friendCode, { id, rosterTeams, conflict }];
    })
  );
  const ffa = isFfa(match.format);
  const editableSlots = teams.map(([key, team]) => !ffa && isEditableRosterTag(key, team));
  const scopedPair = Array.from(votes).filter(([, count]) => count >= 2);
  let inferred: SuggestedTags = lockedTags ?? [];
  if (!lockedTags && teams.length === 2 && scopedPair.length === 2) {
    const unfilledSlots = teams.map(
      ([key], index) => editableSlots[index] && tagEdits[key] === undefined
    );
    const selectedIds = teams.map(
      ([key, team], index) =>
        resolveTag(editableSlots[index] ? (tagEdits[key]?.trim() ?? "") : teamTag(key, team))
          ?.team_season_entry_id
    );
    const available = scopedPair.filter(([id]) => !selectedIds.includes(id));
    if (available.length === unfilledSlots.filter(Boolean).length) {
      const tags = available.map(([id]) => seasonTeamsById.get(id)?.clan_tag);
      inferred = unfilledSlots.map((unfilled) => (unfilled ? tags.shift() : undefined));
    }
  }
  const teamOptions = teams.map(([key, team], index) => {
    const editable = editableSlots[index];
    const edited = editable ? tagEdits[key] : undefined;
    const newTag = editable
      ? edited === undefined
        ? inferred[index]
        : edited.trim() || undefined
      : undefined;
    return {
      key,
      label: newTag ?? (teamTag(key, team) || key),
      editable,
      newTag,
      manual: Boolean(edited?.trim()),
    };
  });
  const established = teamOptions.map(({ editable, newTag }) => !editable || Boolean(newTag));
  const tagKeys = teamOptions.map(({ label }, index) => (established[index] ? tagKey(label) : ""));
  const literalTags = teamOptions.map(({ label }) => label.normalize("NFC"));
  const duplicateTags = new Set(literalTags.map(identityTextKey)).size !== literalTags.length;
  const optionIds = teamOptions.map(({ label }, index) =>
    established[index] ? resolveTag(label)?.team_season_entry_id : undefined
  );
  const manualTagKeys = teamOptions.some(({ manual }) => manual)
    ? literalTags.map((tag, index) => (established[index] ? tag : ""))
    : [];
  const ffaTeam = ffa && teamOptions.length === 1 ? teamOptions[0] : undefined;
  const rosterHints: Record<string, string> = {};
  const overlappingTags = new Set<string>();
  const assignments = Object.fromEntries(
    players.map((player) => {
      if (ffaTeam) return [player.friendCode, ffaTeam.key];
      const matched = teamOptions.filter(
        ({ manual }, index) => !manual && nameMatchesTag(player.miiName, tagKeys[index])
      );
      const playerEvidence = evidence.get(player.friendCode);
      const supported = teamOptions.filter(
        (_, index) => playerEvidence?.id !== undefined && optionIds[index] === playerEvidence.id
      );
      const name = manualTagKeys.length ? player.miiName.normalize("NFC") : "";
      const tagMatches = manualTagKeys.flatMap((tag, index) => {
        const position = tag ? name.indexOf(tag) : -1;
        return position >= 0 ? [{ team: teamOptions[index], position, length: tag.length }] : [];
      });
      let manualTeam: (typeof teamOptions)[number] | undefined;
      if (tagMatches.some(({ team }) => team.manual)) {
        if (tagMatches.length > 1) overlappingTags.add(player.friendCode);
        tagMatches.sort(
          (left, right) => left.position - right.position || right.length - left.length
        );
        manualTeam = tagMatches[0].team;
      }
      if (playerEvidence?.rosterTeams.length) {
        const agreesWithTag = manualTeam
          ? manualTeam === supported[0]
          : matched.length === 0 || (matched.length === 1 && matched[0] === supported[0]);
        if (!playerEvidence.conflict && supported.length === 1 && agreesWithTag) {
          return [player.friendCode, supported[0].key];
        }
        rosterHints[player.friendCode] = playerEvidence.rosterTeams
          .map((id) => seasonTeamsById.get(id)?.clan_tag)
          .join(", ");
        return [player.friendCode, manualTeam?.key ?? ""];
      }
      if (manualTeam) return [player.friendCode, manualTeam.key];
      const automatic = supported.filter(({ manual }) => !manual);
      const suggested = automatic.length > 0 ? automatic : matched;
      return [player.friendCode, suggested.length === 1 ? suggested[0].key : ""];
    })
  );
  return { teamOptions, assignments, inferred, rosterHints, overlappingTags, duplicateTags };
}

export type RosterAssignment = RosterPlayer & { teamKey: string };

export function addPastedRoster(
  match: MatchJson,
  assignments: RosterAssignment[],
  newTags: Record<string, string>
): MatchJson {
  if (match.result_type === "free_win" || match.result_type === "mutual_tie") return match;
  const teams = { ...match.teams };
  for (const [key, team] of Object.entries(teams)) {
    const tag = newTags[key] ?? (teamTag(key, team) ? undefined : key);
    if (tag && isEditableRosterTag(key, team)) {
      teams[key] = { ...team, table_tag_str: `${tag} ${teamColor(team)}` };
    }
  }
  const labels = Object.entries(teams).map(([key, team]) =>
    identityTextKey(teamTag(key, team).normalize("NFC"))
  );
  if (new Set(labels).size !== labels.length) return match;

  const existingCodes = new Set(allPlayers(match).map(({ friendCode }) => friendCode));
  const additions = new Map<string, Record<string, MatchPlayerJson>>();
  for (const { friendCode, miiName, loungeName, teamKey } of assignments) {
    const team = teams[teamKey];
    if (!team || existingCodes.has(friendCode)) continue;
    const group = additions.get(teamKey) ?? {};
    group[friendCode] = {
      mii_name: miiName,
      ...(loungeName ? { lounge_name: loungeName } : {}),
      tag: teamTag(teamKey, team) || teamKey,
    };
    additions.set(teamKey, group);
    existingCodes.add(friendCode);
  }
  if (additions.size === 0) return match;

  additions.forEach((players, key) => {
    const team = teams[key];
    teams[key] = {
      ...team,
      players: { ...team.players, ...players },
    };
  });
  return { ...match, teams };
}

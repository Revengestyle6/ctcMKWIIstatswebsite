import { defaultRoleForPosition, type RaceDraft } from "./matchJsonEditorModel";

export type ResultsRosterPlayer = { key: string; miiName: string; label?: string };

export type RecognizedResultRow = {
  position: number | null;
  name: string;
  suggestions: number[];
};

export type PlacementSelection = { position: number | null; playerKey: string };

// biome-ignore lint/complexity/useRegexLiterals: TypeScript targets ES5 and rejects the u flag in literals.
const suggestionPunctuation = new RegExp("[^\\p{L}\\p{N}]", "gu");

function exactKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

const shapeVariants = [
  "★☆",
  "◆◇",
  "■□",
  "●○",
  "▪▫",
  "◼◻",
  "◾◽",
  "⬛⬜",
  "⚫⚪",
  "⬝⬞",
  "⬥⬦",
  "✦✧",
  "⭑⭒",
  "▬▭",
  "▮▯",
  "▰▱",
  "⬟⬠",
  "⭓⭔",
  "⬢⬡",
  "⬧⬨",
  "⬪⬫",
  "▲△",
  "▼▽",
  "◀◁",
  "▶▷",
  "▴▵",
  "▾▿",
  "◂◃",
  "▸▹",
  "♥♡",
  "♦♢",
  "♠♤",
  "♣♧",
].map((pair) => {
  const [filled, outlined] = Array.from(pair);
  return { pattern: new RegExp(`[${filled}${outlined}][\uFE0E\uFE0F]?`, "gu"), outlined };
});

function nameKey(name: string): string {
  return shapeVariants.reduce(
    (key, { pattern, outlined }) => key.replace(pattern, outlined),
    exactKey(name)
  );
}

// biome-ignore lint/complexity/useRegexLiterals: TypeScript targets ES5 and rejects the u flag in literals.
const nonDigits = new RegExp("[^\\p{Nd}]", "gu");

function approximateKey(name: string): string {
  return exactKey(name.normalize("NFKC"));
}

function suggestionKey(name: string): string {
  return name.normalize("NFKD").toLowerCase().replace(suggestionPunctuation, "");
}

function editDistance(first: string, second: string): number {
  const firstCharacters = Array.from(first);
  const secondCharacters = Array.from(second);
  let previous = Array.from({ length: secondCharacters.length + 1 }, (_, index) => index);
  for (let i = 0; i < firstCharacters.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < secondCharacters.length; j++) {
      current.push(
        Math.min(
          current[j] + 1,
          previous[j + 1] + 1,
          previous[j] + Number(firstCharacters[i] !== secondCharacters[j])
        )
      );
    }
    previous = current;
  }
  return previous[secondCharacters.length];
}

export function reviewResultsRows(
  rows: readonly RecognizedResultRow[],
  roster: readonly ResultsRosterPlayer[],
  roomSize: number
) {
  const rosterByName = new Map<string, ResultsRosterPlayer[]>();
  const approximateRoster = roster.flatMap((player) => {
    const key = nameKey(player.miiName);
    if (!key) return [];
    rosterByName.set(key, [...(rosterByName.get(key) ?? []), player]);
    const text = approximateKey(key);
    return Array.from(text.replace(suggestionPunctuation, "")).length >= 4
      ? [{ player, text, digits: text.replace(nonDigits, "") }]
      : [];
  });
  const names = rows.map(({ name }) => nameKey(name));
  const matches = names.map((name) => {
    const exact = rosterByName.get(name) ?? [];
    if (exact.length) return { exact, close: [] };

    const text = approximateKey(name);
    if (Array.from(text.replace(suggestionPunctuation, "")).length < 4) {
      return { exact, close: [] };
    }
    const digits = text.replace(nonDigits, "");
    const close = approximateRoster
      .filter((candidate) => candidate.digits === digits && editDistance(text, candidate.text) <= 1)
      .map(({ player }) => player);
    return { exact, close };
  });
  const candidateRows = new Map<string, number>();
  for (const { exact, close } of matches) {
    for (const { key } of [...exact, ...close]) {
      candidateRows.set(key, (candidateRows.get(key) ?? 0) + 1);
    }
  }
  const positions = rows.map(({ position }) => position);
  return rows.map((row, index) => {
    const name = names[index];
    const { exact, close } = matches[index];
    const safePosition =
      row.position !== null &&
      row.position <= roomSize &&
      positions.indexOf(row.position) === positions.lastIndexOf(row.position);
    const ambiguousName = exact.length > 1 || names.indexOf(name) !== names.lastIndexOf(name);
    const selected =
      exact.length === 1
        ? exact[0]
        : close.length === 1 && candidateRows.get(close[0].key) === 1
          ? close[0]
          : undefined;
    const playerKey = safePosition && !ambiguousName ? (selected?.key ?? "") : "";
    const simplified = suggestionKey(row.name);
    const nearby = exact.length
      ? exact
      : roster
          .map((player) => ({
            player,
            distance: editDistance(simplified, suggestionKey(player.miiName)),
          }))
          .filter(
            ({ player, distance }) =>
              simplified.length >= 3 &&
              player.miiName &&
              distance <= (simplified.length >= 7 ? 2 : 1)
          )
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 3)
          .map(({ player }) => player);
    const modelSuggestions = row.suggestions.flatMap((id) => {
      const player = roster[id];
      return player ? (rosterByName.get(nameKey(player.miiName)) ?? []) : [];
    });
    const suggestions = exact.length
      ? exact
      : Array.from(
          new Map(
            [...close, ...modelSuggestions, ...nearby].map((player) => [player.key, player])
          ).values()
        );
    return {
      position: safePosition ? row.position : null,
      playerKey,
      suggestions,
      ambiguousName: Boolean(name) && ambiguousName,
    };
  });
}

export function planExtractedResults(
  race: RaceDraft,
  format: string | undefined,
  rows: readonly RecognizedResultRow[],
  roster: readonly ResultsRosterPlayer[]
) {
  const review = reviewResultsRows(rows, roster, race.roomSize);
  const usedPlayers = new Set([
    ...race.placements.flatMap((placement) => (placement ? [placement.playerKey] : [])),
    ...race.unplacedResults.map(({ playerKey }) => playerKey),
    ...review.flatMap(({ playerKey }) => (playerKey ? [playerKey] : [])),
  ]);
  const remaining = roster.filter(({ key }) => !usedPlayers.has(key));
  const completeTable = review.filter(({ position }) => position !== null).length === race.roomSize;
  const guesses = review.map(({ position, playerKey, ambiguousName, suggestions }) => {
    if (position === null || race.placements[position - 1] || playerKey || ambiguousName) {
      return undefined;
    }
    return (
      suggestions.find(({ key }) => !usedPlayers.has(key)) ??
      (completeTable && remaining.length === 1 ? remaining[0] : undefined)
    )?.key;
  });
  const counts = new Map<string, number>();
  for (const guess of guesses) {
    if (guess) counts.set(guess, (counts.get(guess) ?? 0) + 1);
  }
  return planResultsImport(
    race,
    format,
    review.map(({ position, playerKey }, index) => {
      const guess = guesses[index];
      return { position, playerKey: guess && counts.get(guess) === 1 ? guess : playerKey };
    }),
    false
  );
}

export function planResultsImport(
  race: RaceDraft,
  format: string | undefined,
  selections: readonly PlacementSelection[],
  replace: boolean
) {
  const complete = selections.flatMap(({ position, playerKey }) =>
    position !== null && playerKey ? [{ position, playerKey }] : []
  );
  const positions = new Set<number>();
  const players = new Set<string>();
  const issues = new Map<number, string>();
  let valid = true;
  const applicable = complete.filter(({ position, playerKey }) => {
    if (
      !Number.isInteger(position) ||
      position < 1 ||
      position > race.roomSize ||
      positions.has(position) ||
      players.has(playerKey)
    ) {
      valid = false;
      return false;
    }
    positions.add(position);
    players.add(playerKey);
    if (race.unplacedResults.some((result) => result.playerKey === playerKey)) {
      issues.set(position, "This player has a disconnect award. Resolve it in Race Entry.");
      return false;
    }
    const previous = race.placements.findIndex((placement) => placement?.playerKey === playerKey);
    const occupied = race.placements[position - 1];
    if (!replace && previous !== position - 1 && (occupied || previous >= 0)) {
      issues.set(position, "This selection conflicts with a current placement.");
      return false;
    }
    return true;
  });

  const placements = [...race.placements];
  const byPlayer = new Map(applicable.map(({ position, playerKey }) => [playerKey, position]));
  race.placements.forEach((previous, index) => {
    if (!previous) return;
    const position = byPlayer.get(previous.playerKey);
    if (position !== undefined && position !== index + 1) placements[index] = null;
  });

  for (const { position, playerKey } of applicable) {
    if (race.placements[position - 1]?.playerKey === playerKey) continue;
    const previous = race.placements.find((placement) => placement?.playerKey === playerKey);
    placements[position - 1] = {
      playerKey,
      role: previous ? previous.role : defaultRoleForPosition(format, position),
    };
  }

  const changes = placements.flatMap((after, index) => {
    const before = race.placements[index];
    return before?.playerKey === after?.playerKey ? [] : [{ position: index + 1, before, after }];
  });
  return { placements, changes, issues, valid };
}

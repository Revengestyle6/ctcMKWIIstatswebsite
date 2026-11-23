import { useEffect, useState } from "react";
import { fetchPlayerIdentities, fetchPlayerTeamMemberships, type TeamScope } from "../../api";
import { allPlayers, type MatchJson } from "./matchJsonEditorModel";
import { parseRoster, type RosterAssignment, rosterTeamSuggestions } from "./rosterImport";

type Props = {
  match: MatchJson;
  scopeValid: boolean;
  seasonTeams: TeamScope[];
  disabled: boolean;
  onApply: (assignments: RosterAssignment[], newTags: Record<string, string>) => void;
  onClose: () => void;
};

const inputClass =
  "rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-blue-300";
const primaryButton =
  "rounded-md bg-blue-500 px-4 py-2 font-semibold hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-white/20 px-4 py-2 font-semibold text-gray-200 hover:bg-white/10";

type RosterLookup = {
  key: string;
  memberships: Record<string, number[]>;
  failed: boolean;
};

export default function PasteRosterPanel({
  match,
  scopeValid,
  seasonTeams,
  disabled,
  onApply,
  onClose,
}: Props) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof parseRoster> | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [tagEdits, setTagEdits] = useState<Record<string, string>>({});
  const [lockedTags, setLockedTags] = useState<Array<string | undefined>>();
  const [lookup, setLookup] = useState<RosterLookup>();
  const [error, setError] = useState("");
  const existingCodes = new Set(allPlayers(match).map(({ friendCode }) => friendCode));
  const newPlayers =
    preview?.players.filter(({ friendCode }) => !existingCodes.has(friendCode)) ?? [];
  const existingCount = (preview?.players.length ?? 0) - newPlayers.length;
  const { league, season, division } = match;
  const friendCodes = newPlayers.map(({ friendCode }) => friendCode).join(",");
  const lookupKey =
    scopeValid && league && season && division && friendCodes
      ? JSON.stringify([league, season, division, friendCodes])
      : "";
  const currentLookup = lookup?.key === lookupKey ? lookup : undefined;
  const { teamOptions, assignments, inferred, rosterHints, overlappingTags, duplicateTags } =
    rosterTeamSuggestions(
      match,
      newPlayers,
      scopeValid
        ? { teams: seasonTeams, memberships: currentLookup?.memberships ?? {} }
        : undefined,
      lockedTags,
      tagEdits
    );
  const selected = newPlayers.flatMap((player) => {
    const team = teamOptions.find(
      ({ key }) => key === (overrides[player.friendCode] ?? assignments[player.friendCode])
    );
    return team ? [{ ...player, teamKey: team.key }] : [];
  });

  useEffect(() => {
    if (!preview || !lookupKey || !league || !season || !division) return;
    let cancelled = false;
    async function loadMemberships(scope: { league: string; season: string; division: string }) {
      const results = await fetchPlayerIdentities(friendCodes.split(","));
      if (cancelled) return;

      const idsByCode = Object.entries(results).flatMap(([code, { results: identities }]) =>
        identities.length === 1 ? [{ code, id: identities[0].player_id }] : []
      );
      const ids = Array.from(new Set(idsByCode.map(({ id }) => id)));
      const membershipsById = new Map<number, number[]>();
      for (let offset = 0; offset < ids.length && !cancelled; offset += 100) {
        const batch = await fetchPlayerTeamMemberships({
          ...scope,
          player_ids: ids.slice(offset, offset + 100),
        });
        for (const { player_id, teams } of batch) {
          membershipsById.set(
            player_id,
            teams.map((team) => team.team_season_entry_id)
          );
        }
      }
      if (cancelled) return;
      setLookup({
        key: lookupKey,
        memberships: Object.fromEntries(
          idsByCode.map(({ code, id }) => [code, membershipsById.get(id) ?? []])
        ),
        failed: false,
      });
    }
    loadMemberships({ league, season, division }).catch(() => {
      if (!cancelled) setLookup({ key: lookupKey, memberships: {}, failed: true });
    });
    return () => {
      cancelled = true;
    };
  }, [preview, lookupKey, league, season, division, friendCodes]);

  function readRoster() {
    try {
      setPreview(parseRoster(text));
      setLookup(undefined);
      setError("");
    } catch (error) {
      setPreview(null);
      setError(error instanceof Error ? error.message : "Could not read the pasted roster.");
    }
  }

  return (
    <section
      id="paste-roster-panel"
      aria-label="Paste roster"
      className="mb-4 rounded-lg border border-blue-300/25 bg-zinc-950/90 p-4"
    >
      <label htmlFor="roster-text" className="text-sm font-semibold text-gray-200">
        Roster text
      </label>
      <p id="roster-paste-help" className="mt-1 text-xs text-gray-400">
        Copy one Wiimmfi room table or the Table Bot VR output, including the column headings.
      </p>
      <textarea
        id="roster-text"
        aria-describedby="roster-paste-help"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setPreview(null);
          setOverrides({});
          setLockedTags(undefined);
          setLookup(undefined);
          setError("");
        }}
        disabled={disabled}
        spellCheck={false}
        rows={5}
        className={`mt-1 w-full resize-y font-mono text-xs ${inputClass}`}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={readRoster}
          disabled={disabled || !text.trim()}
          className={primaryButton}
        >
          Read roster
        </button>
        <button type="button" onClick={onClose} className={secondaryButton}>
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {preview ? (
        <div className="mt-4 space-y-3">
          <div role="status" className="space-y-1 text-sm text-gray-300">
            {existingCount ? <p>Already in this match ({existingCount})</p> : null}
            {preview.duplicates ? <p>Duplicate rows skipped ({preview.duplicates})</p> : null}
            {preview.conflicts ? (
              <p className="text-amber-300">
                Friend codes with conflicting names skipped ({preview.conflicts}). Copy those rows
                again or add them manually.
              </p>
            ) : null}
            {preview.incomplete ? (
              <p className="text-amber-300">
                Rows missing a Mii name skipped ({preview.incomplete}).
              </p>
            ) : null}
            {newPlayers.length > 0 ? (
              <p>Review the suggested teams and choose where to add each player.</p>
            ) : null}
            {lookupKey && !currentLookup ? <p>Checking season rosters…</p> : null}
            {currentLookup?.failed ? (
              <p>Season rosters could not be checked. You can still assign players.</p>
            ) : null}
            {!scopeValid && newPlayers.length > 0 ? (
              <p>Set the league, season, and division for season roster suggestions.</p>
            ) : null}
          </div>
          {newPlayers.length > 0 ? (
            <>
              {teamOptions.some(({ editable }) => editable) ? (
                <fieldset className="rounded-md border border-white/15 px-3 pb-3">
                  <legend className="px-1 text-sm font-semibold text-gray-200">
                    Available teams
                  </legend>
                  <p className="mb-2 text-xs text-gray-400">
                    Copy a tag from a Mii name below. Assignments update as you type.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {teamOptions.map(({ key, label, editable }) => (
                      <label key={key} className="text-xs font-semibold text-gray-300">
                        {editable ? `${key} tag` : "Team tag"}
                        <input
                          value={editable ? (tagEdits[key] ?? label) : label}
                          onChange={(event) => {
                            const value = event.target.value;
                            setTagEdits((current) => ({ ...current, [key]: value }));
                          }}
                          readOnly={!editable}
                          disabled={disabled}
                          spellCheck={false}
                          className={`mt-1 w-full ${inputClass}`}
                        />
                      </label>
                    ))}
                  </div>
                  {duplicateTags ? (
                    <p className="mt-2 text-xs text-amber-300">
                      Enter a different tag for each team.
                    </p>
                  ) : null}
                </fieldset>
              ) : null}
              <ul className="space-y-1">
                {newPlayers.map(({ friendCode, miiName, loungeName }) => (
                  <li
                    key={friendCode}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,auto)] items-center gap-x-3 border-t border-white/10 py-1.5 text-sm sm:grid-cols-[minmax(0,1fr)_9rem_10rem]"
                  >
                    <div className="min-w-0 break-words">
                      <span className="select-text font-semibold">{miiName}</span>
                      {loungeName && loungeName !== miiName ? (
                        <span className="ml-2 text-xs text-gray-400">{loungeName}</span>
                      ) : null}
                      {rosterHints[friendCode] ? (
                        <p className="text-xs text-amber-300">
                          Season roster · {rosterHints[friendCode]}
                        </p>
                      ) : null}
                      {overlappingTags.has(friendCode) ? (
                        <p className="text-xs text-amber-300">
                          Multiple tags in this Mii name. Review the assignment.
                        </p>
                      ) : null}
                    </div>
                    <span className="col-start-1 font-mono text-xs text-gray-400 sm:col-start-2">
                      {friendCode}
                    </span>
                    <select
                      aria-label={`Team for ${miiName} (${friendCode})`}
                      value={overrides[friendCode] ?? assignments[friendCode]}
                      onChange={(event) => {
                        const key = event.target.value;
                        setOverrides((current) => ({ ...current, [friendCode]: key }));
                        // Keep the team labels behind a manual selection stable when lookup finishes.
                        if (key && lockedTags === undefined) setLockedTags(inferred);
                      }}
                      disabled={disabled}
                      className={`col-start-2 row-span-2 row-start-1 bg-zinc-900 sm:col-start-3 sm:row-span-1 ${inputClass}`}
                    >
                      <option value="">Skip player</option>
                      {teamOptions.map(({ key, label }) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() =>
                  onApply(
                    selected,
                    Object.fromEntries(
                      teamOptions.flatMap(({ key, newTag }) => (newTag ? [[key, newTag]] : []))
                    )
                  )
                }
                disabled={disabled || duplicateTags || selected.length === 0}
                className={primaryButton}
              >
                Add {selected.length} {selected.length === 1 ? "player" : "players"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

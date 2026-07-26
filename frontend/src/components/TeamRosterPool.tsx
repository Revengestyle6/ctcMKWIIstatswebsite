import { useMemo, useState } from "react";

import { fetchTeamRosterPool, type TeamRosterPlayer } from "../api";

type Props = {
  league: string;
  season: string;
  division: string;
  teamId: number;
  currentFriendCodes: string[];
  currentPlayerIds: number[];
  onAdd: (player: TeamRosterPlayer) => void;
};

export default function TeamRosterPool({
  league,
  season,
  division,
  teamId,
  currentFriendCodes,
  currentPlayerIds,
  onAdd,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState<TeamRosterPlayer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const configuredCodes = useMemo(() => new Set(currentFriendCodes), [currentFriendCodes]);
  const configuredPlayers = useMemo(() => new Set(currentPlayerIds), [currentPlayerIds]);
  const visiblePlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return players ?? [];
    return (players ?? []).filter((player) =>
      [
        player.canonical_name,
        player.lounge_name,
        player.mii_name,
        player.friend_code,
        String(player.player_id),
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    );
  }, [players, query]);

  const toggle = async () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || players !== null || loading) return;
    setLoading(true);
    setError("");
    try {
      setPlayers(await fetchTeamRosterPool({ league, season, division, team_id: teamId }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this roster.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 border border-blue-300/20 bg-blue-950/15 p-3">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex w-full items-center justify-between gap-3 text-left font-semibold text-blue-200"
        aria-expanded={open}
      >
        <span>Team roster pool</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="mt-3">
          <p className="text-xs text-gray-400">
            Add a player previously recorded for this team in the selected season and division.
          </p>
          {players && players.length > 6 ? (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter roster"
              className="mt-3 w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-sm"
            />
          ) : null}
          {loading ? <p className="py-4 text-sm text-gray-400">Loading roster…</p> : null}
          {error ? <p className="py-3 text-sm text-red-300">{error}</p> : null}
          {!loading && players?.length === 0 ? (
            <p className="py-4 text-sm text-gray-400">No prior roster entries were found.</p>
          ) : null}
          <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
            {visiblePlayers.map((player) => {
              const configured =
                configuredPlayers.has(player.player_id) ||
                Boolean(player.friend_code && configuredCodes.has(player.friend_code));
              return (
                <div
                  key={player.player_season_entry_id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-2"
                >
                  <div>
                    <p className="font-semibold">
                      {player.canonical_name || player.lounge_name || `Player ${player.player_id}`}
                    </p>
                    <p className="text-xs text-gray-400">
                      ID {player.player_id} · {player.friend_code || "No friend code"}
                      {player.mii_name ? ` · Mii: ${player.mii_name}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={configured || !player.friend_code}
                    onClick={() => onAdd(player)}
                    className="rounded border border-blue-300/40 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-950/50 disabled:opacity-40"
                  >
                    {configured ? "In match" : "Add to lineup"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

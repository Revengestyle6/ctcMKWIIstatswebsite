import { useEffect, useState } from "react";

import { type PlayerIdentity, searchPlayerIdentities } from "../api";

type Props = {
  initialQuery?: string;
  onSelect: (player: PlayerIdentity) => void;
};

export default function ExistingPlayerPicker({
  initialQuery = "",
  onSelect,
}: Props): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<PlayerIdentity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setResults([]);
      setError("");
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError("");
      searchPlayerIdentities(normalizedQuery)
        .then((response) => {
          if (!cancelled) setResults(response.results);
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setResults([]);
            setError(caught instanceof Error ? caught.message : "Player search failed.");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query]);

  return (
    <div className="mt-3 border border-blue-300/20 bg-black/30 p-3">
      <label className="block text-xs font-semibold uppercase text-gray-300">
        Search canonical name or player ID
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or ID"
          className="mt-2 w-full rounded border border-white/15 bg-black/50 px-3 py-2 text-sm normal-case text-white"
        />
      </label>
      {loading ? <p className="py-3 text-sm text-gray-400">Searching…</p> : null}
      {error ? <p className="py-3 text-sm text-red-300">{error}</p> : null}
      {!loading && query.trim() && !error && results.length === 0 ? (
        <p className="py-3 text-sm text-gray-400">No matching players found.</p>
      ) : null}
      <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
        {results.map((player) => (
          <button
            key={player.player_id}
            type="button"
            onClick={() => onSelect(player)}
            className="block w-full rounded border border-white/10 bg-white/5 p-2 text-left hover:border-blue-300/40 hover:bg-blue-950/30"
          >
            <span className="block font-semibold">
              {player.canonical_name || `Player ${player.player_id}`}
            </span>
            <span className="mt-1 block text-xs text-gray-400">
              Player ID {player.player_id}
              {player.friend_codes.length ? ` · ${player.friend_codes.join(", ")}` : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { deleteJson, fetchJson, fetchMatchScopes, type MatchScope } from "../../api";
import { isLeagueCode } from "../../config/leagues";
import { useLeague } from "../../context/LeagueContext";

type ManagedMatch = {
  match_id: number;
  label: string;
  league: string;
  season: string;
  division: string;
  match_type: string;
  result_type: string;
  match_number: number | null;
  series_match_number: number | null;
};

type MatchManifest = {
  generated_at: string;
  match: { match_id: number; label: string };
  source: {
    source_filename: string;
    fingerprint: string;
    archive_status: string;
    storage_object_key: string | null;
    match_count: number;
  };
  records_deleted: Record<string, number>;
  record_ids_deleted: Record<string, number[]>;
  references_updated_not_deleted: Record<string, Array<number | string>>;
  shared_records_preserved: {
    teams: Array<{ team_id: number; name: string; tag: string }>;
    players: Array<{ player_id: number; friend_code: string; name: string | null }>;
    tracks: Array<{ track_id: number; name: string; race: number }>;
  };
  database_additions_from_upload: Array<{
    id: number;
    operation_type: "addition" | "edit";
    admin_email: string | null;
    entity_type: string;
    entity_id: number;
    summary: string;
  }>;
};

type ManagementDetail = {
  manifest: MatchManifest;
  source_fingerprint: string;
};

export default function AdminMatchManager(): React.JSX.Element {
  const { league, setLeague } = useLeague();
  const [matches, setMatches] = useState<ManagedMatch[]>([]);
  const [scopes, setScopes] = useState<MatchScope[]>([]);
  const [season, setSeason] = useState("");
  const [division, setDivision] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [detail, setDetail] = useState<ManagementDetail | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const previousLeague = useRef(league);

  useEffect(() => {
    fetchMatchScopes()
      .then(setScopes)
      .catch(() => setScopes([]));
  }, []);

  useEffect(() => {
    if (previousLeague.current === league) return;
    previousLeague.current = league;
    setSeason("");
    setDivision("");
  }, [league]);

  const seasons = Array.from(
    new Set(scopes.filter((scope) => scope.league === league).map((scope) => scope.season))
  ).sort();
  const divisions = Array.from(
    new Set(
      scopes
        .filter((scope) => scope.league === league && (!season || scope.season === season))
        .map((scope) => scope.division)
    )
  ).sort();

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchJson<ManagedMatch[]>("/api/admin/matches", {
        league,
        season,
        division,
        query,
        limit: 500,
      })
        .then((response) => {
          if (!cancelled) setMatches(response);
        })
        .catch((caught: unknown) => {
          if (!cancelled)
            setError(caught instanceof Error ? caught.message : "Could not load matches.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [division, league, query, season]);

  async function openDeletion(matchId: number): Promise<void> {
    setError("");
    try {
      setDetail(await fetchJson<ManagementDetail>(`/api/admin/matches/${matchId}/management`));
      setConfirmation("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare deletion.");
    }
  }

  function downloadManifest(): void {
    if (!detail) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(detail.manifest, null, 2)], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `match-${detail.manifest.match.match_id}-deletion-manifest.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function confirmDeletion(): Promise<void> {
    if (!detail || confirmation !== detail.manifest.match.label) return;
    setDeleting(true);
    setError("");
    try {
      await deleteJson(`/api/admin/matches/${detail.manifest.match.match_id}`, {
        confirmation,
        expected_source_fingerprint: detail.source_fingerprint,
      });
      setMatches((current) =>
        current.filter((match) => match.match_id !== detail.manifest.match.match_id)
      );
      setDetail(null);
      setConfirmation("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete match.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="border border-white/15 bg-zinc-950/90 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Uploaded matches</h2>
          <p className="mt-1 text-sm text-gray-400">
            Edit through the match JSON workflow, or review exact database impact before deletion.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm text-gray-300">
          League
          <select
            value={league}
            onChange={(event) => {
              if (isLeagueCode(event.target.value)) setLeague(event.target.value);
            }}
            className="mt-1 w-full rounded border border-white/15 bg-black/40 px-3 py-2"
          >
            <option value="ctc">CTC</option>
            <option value="gsc">GSC</option>
          </select>
        </label>
        <label className="text-sm text-gray-300">
          Season
          <select
            value={season}
            onChange={(event) => {
              setSeason(event.target.value);
              setDivision("");
            }}
            className="mt-1 w-full rounded border border-white/15 bg-black/40 px-3 py-2"
          >
            <option value="">All seasons</option>
            {seasons.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-300">
          Division
          <select
            value={division}
            onChange={(event) => setDivision(event.target.value)}
            className="mt-1 w-full rounded border border-white/15 bg-black/40 px-3 py-2"
          >
            <option value="">All divisions</option>
            {divisions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-300">
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Match label"
            className="mt-1 w-full rounded border border-white/15 bg-black/40 px-3 py-2"
          />
        </label>
      </div>
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
      <div className="mt-4 max-h-80 overflow-auto border border-white/10">
        {loading ? <p className="p-4 text-gray-400">Loading matches…</p> : null}
        {!loading && matches.length === 0 ? (
          <p className="p-4 text-gray-400">No matching uploads.</p>
        ) : null}
        {matches.map((match) => (
          <div
            key={match.match_id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-3 last:border-b-0"
          >
            <div>
              <p className="font-semibold">{match.label}</p>
              <p className="text-xs uppercase text-gray-400">
                ID {match.match_id} · {match.season} {match.division} · {match.match_type}
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                to={`/json-editor?edit_match=${match.match_id}&league=${encodeURIComponent(match.league)}`}
                className="rounded bg-blue-500 px-3 py-2 text-sm font-bold"
              >
                Edit
              </Link>
              <button
                type="button"
                onClick={() => void openDeletion(match.match_id)}
                className="rounded border border-red-400/60 px-3 py-2 text-sm font-bold text-red-200"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-match-title"
            className="max-h-[90vh] w-full max-w-3xl overflow-auto border border-red-400/40 bg-zinc-950 p-6 shadow-2xl"
          >
            <h2 id="delete-match-title" className="text-2xl font-bold text-red-200">
              Delete {detail.manifest.match.label}?
            </h2>
            <p className="mt-2 text-gray-300">
              The match-owned rows below will be deleted. Teams, players, tracks, season entries,
              playoff configuration, and playoff participants are preserved. The source JSON is
              archived under the deleted directory.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="border border-white/10 p-3">
                <h3 className="font-bold">Rows deleted</h3>
                <ul className="mt-2 space-y-1 text-sm text-gray-300">
                  {Object.entries(detail.manifest.records_deleted).map(([name, count]) => (
                    <li key={name} className="border-b border-white/5 pb-1">
                      <span>
                        {name.replaceAll("_", " ")}: {count}
                      </span>
                      <span className="block break-all text-xs text-gray-500">
                        IDs: {detail.manifest.record_ids_deleted[name]?.join(", ") || "none"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="border border-white/10 p-3">
                <h3 className="font-bold">Shared records preserved</h3>
                <p className="mt-2 text-sm text-gray-300">
                  {detail.manifest.shared_records_preserved.teams.length} teams ·{" "}
                  {detail.manifest.shared_records_preserved.players.length} players ·{" "}
                  {detail.manifest.shared_records_preserved.tracks.length} track uses
                </p>
                <p className="mt-2 text-xs text-gray-400">
                  {detail.manifest.database_additions_from_upload.length} database changes traced to
                  this match are listed in the manifest but are not deleted automatically.
                </p>
              </div>
            </div>
            <details className="mt-4 border border-white/10 p-3 text-sm">
              <summary className="cursor-pointer font-bold">
                All preserved teams, players, and tracks
              </summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="font-semibold">Teams</p>
                  {detail.manifest.shared_records_preserved.teams.map((team) => (
                    <p key={team.team_id} className="text-xs text-gray-400">
                      #{team.team_id} {team.tag} — {team.name}
                    </p>
                  ))}
                </div>
                <div>
                  <p className="font-semibold">Players</p>
                  {detail.manifest.shared_records_preserved.players.map((player) => (
                    <p
                      key={`${player.player_id}:${player.friend_code}`}
                      className="text-xs text-gray-400"
                    >
                      #{player.player_id} {player.name || player.friend_code}
                    </p>
                  ))}
                </div>
                <div>
                  <p className="font-semibold">Tracks</p>
                  {detail.manifest.shared_records_preserved.tracks.map((track) => (
                    <p key={`${track.track_id}:${track.race}`} className="text-xs text-gray-400">
                      Race {track.race}: #{track.track_id} {track.name}
                    </p>
                  ))}
                </div>
              </div>
            </details>
            <details className="mt-3 border border-white/10 p-3 text-sm">
              <summary className="cursor-pointer font-bold">
                Database changes traced to this match
              </summary>
              {detail.manifest.database_additions_from_upload.length ? (
                detail.manifest.database_additions_from_upload.map((addition) => (
                  <p key={addition.id} className="mt-1 text-xs text-gray-400">
                    Log #{addition.id} [{addition.operation_type}] by{" "}
                    {addition.admin_email ?? "legacy import (email unavailable)"}:{" "}
                    {addition.summary} ({addition.entity_type} #{addition.entity_id}) — preserved
                  </p>
                ))
              ) : (
                <p className="mt-2 text-xs text-gray-400">None recorded.</p>
              )}
            </details>
            <details className="mt-3 border border-white/10 p-3 text-sm">
              <summary className="cursor-pointer font-bold">
                References updated but not deleted
              </summary>
              {Object.entries(detail.manifest.references_updated_not_deleted).map(
                ([recordType, ids]) => (
                  <p key={recordType} className="mt-1 break-all text-xs text-gray-400">
                    {recordType.replaceAll("_", " ")}: {ids.join(", ") || "none"}
                  </p>
                )
              )}
            </details>
            <button
              type="button"
              onClick={downloadManifest}
              className="mt-4 rounded border border-blue-300/60 px-3 py-2 font-bold text-blue-200"
            >
              Download deletion manifest
            </button>
            <label className="mt-5 block text-sm text-gray-300">
              Type <strong>{detail.manifest.match.label}</strong> to confirm
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="mt-1 w-full rounded border border-red-400/40 bg-black/50 px-3 py-2"
              />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDetail(null)}
                className="rounded border border-white/20 px-4 py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting || confirmation !== detail.manifest.match.label}
                onClick={() => void confirmDeletion()}
                className="rounded bg-red-600 px-4 py-2 font-bold disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete match"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

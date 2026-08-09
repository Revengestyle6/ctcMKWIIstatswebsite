import { useEffect, useState } from "react";

import { fetchJson, patchJson } from "../../api";

type TeamIdentity = {
  id: number;
  canonical_name: string;
  canonical_tag: string;
};

type TeamSeasonIdentity = {
  id: number;
  season: { id: number; code: string; name: string; season_number: number | null };
  division: { id: number; code: string; name: string };
  display_name: string;
  clan_tag: string;
};

type TeamIdentityDetail = {
  team: TeamIdentity;
  season_entries: TeamSeasonIdentity[];
};

type SeasonIdentityEditorProps = {
  teamId: number;
  entry: TeamSeasonIdentity;
  onSaved: (detail: TeamIdentityDetail) => void;
};

function SeasonIdentityEditor({
  teamId,
  entry,
  onSaved,
}: SeasonIdentityEditorProps): React.JSX.Element {
  const [displayName, setDisplayName] = useState(entry.display_name);
  const [clanTag, setClanTag] = useState(entry.clan_tag);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const unchanged = displayName.trim() === entry.display_name && clanTag.trim() === entry.clan_tag;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (unchanged) return;
    setSaving(true);
    setError("");
    try {
      const detail = await patchJson<TeamIdentityDetail>(
        `/api/admin/teams/${teamId}/season-entries/${entry.id}`,
        { display_name: displayName, clan_tag: clanTag }
      );
      onSaved(detail);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update season identity.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={save}
      className="rounded border border-white/10 bg-black/30 p-4"
      aria-label={`${entry.season.name} ${entry.division.name} identity`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-bold">
          {entry.season.name} · {entry.division.name}
        </h4>
        <span className="text-xs text-gray-500">
          {entry.season.code.toUpperCase()} / {entry.division.code.toUpperCase()}
        </span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.35fr)]">
        <label className="text-sm font-bold text-gray-200">
          Season name
          <input
            value={displayName}
            required
            maxLength={200}
            onChange={(event) => setDisplayName(event.target.value)}
            className="mt-2 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3"
          />
        </label>
        <label className="text-sm font-bold text-gray-200">
          Season tag
          <input
            value={clanTag}
            required
            maxLength={64}
            onChange={(event) => setClanTag(event.target.value)}
            className="mt-2 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving || unchanged || !displayName.trim() || !clanTag.trim()}
          className="rounded bg-emerald-500 px-4 py-2 text-sm font-bold text-black disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save season identity"}
        </button>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </div>
    </form>
  );
}

type TeamIdentityManagerProps = {
  teamId: number;
  onCanonicalSaved: (team: TeamIdentity) => void;
};

export default function TeamIdentityManager({
  teamId,
  onCanonicalSaved,
}: TeamIdentityManagerProps): React.JSX.Element {
  const [detail, setDetail] = useState<TeamIdentityDetail | null>(null);
  const [canonicalName, setCanonicalName] = useState("");
  const [canonicalTag, setCanonicalTag] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchJson<TeamIdentityDetail>(`/api/admin/teams/${teamId}/identity`)
      .then((response) => {
        if (cancelled) return;
        setDetail(response);
        setCanonicalName(response.team.canonical_name);
        setCanonicalTag(response.team.canonical_tag);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load team identity.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const canonicalUnchanged =
    canonicalName.trim() === detail?.team.canonical_name &&
    canonicalTag.trim() === detail?.team.canonical_tag;

  const saveCanonical = async (event: React.FormEvent) => {
    event.preventDefault();
    if (canonicalUnchanged) return;
    setSaving(true);
    setError("");
    try {
      const response = await patchJson<TeamIdentityDetail>(`/api/admin/teams/${teamId}/identity`, {
        canonical_name: canonicalName,
        canonical_tag: canonicalTag,
      });
      setDetail(response);
      setCanonicalName(response.team.canonical_name);
      setCanonicalTag(response.team.canonical_tag);
      onCanonicalSaved(response.team);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update team identity.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="mt-5 text-gray-400">Loading team identity…</p>;

  return (
    <div className="mt-5 space-y-5">
      <form
        onSubmit={saveCanonical}
        className="rounded border border-blue-300/20 bg-blue-950/20 p-4"
      >
        <h3 className="text-lg font-bold text-blue-100">Conventional identity</h3>
        <p className="mt-1 text-sm text-gray-400">
          This is the team&apos;s lasting name and tag across seasons. Season-specific identities
          below override these labels when that season is displayed.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.35fr)]">
          <label className="text-sm font-bold text-gray-200">
            Conventional name
            <input
              value={canonicalName}
              required
              maxLength={200}
              onChange={(event) => setCanonicalName(event.target.value)}
              className="mt-2 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3"
            />
          </label>
          <label className="text-sm font-bold text-gray-200">
            Canonical tag
            <input
              value={canonicalTag}
              required
              maxLength={64}
              onChange={(event) => setCanonicalTag(event.target.value)}
              className="mt-2 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || canonicalUnchanged || !canonicalName.trim() || !canonicalTag.trim()}
            className="rounded bg-blue-500 px-4 py-2 font-bold text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save conventional identity"}
          </button>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>
      </form>

      <section>
        <h3 className="text-lg font-bold">Season identities</h3>
        <p className="mt-1 text-sm text-gray-400">
          These entries come from imported participation records. Changing one does not alter the
          conventional identity or another season. If a season tag also appears in uploaded JSON,
          add it under Aliases so imports resolve it to this team.
        </p>
        <div className="mt-3 space-y-3">
          {detail?.season_entries.length ? (
            detail.season_entries.map((entry) => (
              <SeasonIdentityEditor
                key={`${entry.id}:${entry.display_name}:${entry.clan_tag}`}
                teamId={teamId}
                entry={entry}
                onSaved={setDetail}
              />
            ))
          ) : (
            <p className="py-6 text-gray-400">This team has no season entries yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

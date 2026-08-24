import { useEffect, useState } from "react";

import { deleteJson, fetchJson, patchJson, postJson } from "../../api";

type TeamIdentity = {
  id: number;
  canonical_name: string;
  canonical_tag: string;
  canonical_identity_override: boolean;
  canonical_league_preference: string | null;
};

type TeamSeasonIdentity = {
  id: number;
  season: { id: number; league: string; code: string; name: string; season_number: number | null };
  division: { id: number; code: string; name: string };
  display_name: string;
  clan_tag: string;
};

type TeamLeagueIdentity = {
  id: number;
  league: string;
  tag: string;
};

type TeamIdentityDetail = {
  team: TeamIdentity;
  league_identities: TeamLeagueIdentity[];
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
          {entry.season.league.toUpperCase()} · {entry.season.name} · {entry.division.name}
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
  const [leagueCode, setLeagueCode] = useState("ctc");
  const [leagueTag, setLeagueTag] = useState("");
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

  const applyDetail = (response: TeamIdentityDetail) => {
    setDetail(response);
    setCanonicalName(response.team.canonical_name);
    setCanonicalTag(response.team.canonical_tag);
    onCanonicalSaved(response.team);
  };

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
      applyDetail(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update team identity.");
    } finally {
      setSaving(false);
    }
  };

  const setCanonicalPreference = async (league: string) => {
    setSaving(true);
    setError("");
    try {
      const response = await patchJson<TeamIdentityDetail>(
        `/api/admin/teams/${teamId}/canonical-league-preference`,
        { league: league || null }
      );
      applyDetail(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update league preference.");
    } finally {
      setSaving(false);
    }
  };

  const setCanonicalOverride = async (enabled: boolean) => {
    setSaving(true);
    setError("");
    try {
      const response = await patchJson<TeamIdentityDetail>(
        `/api/admin/teams/${teamId}/canonical-identity-override`,
        { enabled }
      );
      applyDetail(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update identity override.");
    } finally {
      setSaving(false);
    }
  };

  const addLeagueIdentity = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!leagueTag.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = await postJson<TeamIdentityDetail>(
        `/api/admin/teams/${teamId}/league-identities`,
        { league: leagueCode, tag: leagueTag }
      );
      setDetail(response);
      setLeagueTag("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not link the league tag.");
    } finally {
      setSaving(false);
    }
  };

  const removeLeagueIdentity = async (identity: TeamLeagueIdentity) => {
    if (
      !window.confirm(`Unlink ${identity.tag} from ${identity.league.toUpperCase()} for this team?`)
    )
      return;
    setSaving(true);
    setError("");
    try {
      setDetail(
        await deleteJson<TeamIdentityDetail>(
          `/api/admin/teams/${teamId}/league-identities/${identity.id}`
        )
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlink the league tag.");
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
          The canonical identity automatically follows the newest season identity. Choose a league
          when simultaneous CTC and GSC identities should favor one competition.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold text-gray-200">
            Preferred league
            <select
              value={detail?.team.canonical_league_preference ?? ""}
              disabled={saving}
              onChange={(event) => void setCanonicalPreference(event.target.value)}
              className="mt-2 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3"
            >
              <option value="">Newest identity across all leagues</option>
              <option value="ctc">Prefer newest CTC identity</option>
              <option value="gsc">Prefer newest GSC identity</option>
            </select>
          </label>
          <label className="flex items-start gap-3 rounded border border-white/10 bg-black/25 p-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={detail?.team.canonical_identity_override ?? false}
              disabled={saving}
              onChange={(event) => void setCanonicalOverride(event.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              Keep canonical identity under manual control
              <span className="mt-1 block text-xs text-gray-400">
                Enabling this retains the current name and tag instead of following season entries.
              </span>
            </span>
          </label>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.35fr)]">
          <label className="text-sm font-bold text-gray-200">
            Conventional name
            <input
              value={canonicalName}
              required
              maxLength={200}
              disabled={!detail?.team.canonical_identity_override}
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
              disabled={!detail?.team.canonical_identity_override}
              onChange={(event) => setCanonicalTag(event.target.value)}
              className="mt-2 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={
              saving ||
              !detail?.team.canonical_identity_override ||
              canonicalUnchanged ||
              !canonicalName.trim() ||
              !canonicalTag.trim()
            }
            className="rounded bg-blue-500 px-4 py-2 font-bold text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save conventional identity"}
          </button>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>
      </form>

      <section className="rounded border border-amber-300/20 bg-amber-950/20 p-4">
        <h3 className="text-lg font-bold text-amber-100">League identity links</h3>
        <p className="mt-1 text-sm text-gray-400">
          These links control match-import identity. Add a GSC tag here to explicitly connect that
          league&apos;s team to this canonical team. Equal tags in different leagues are not linked
          automatically.
        </p>
        <form
          onSubmit={addLeagueIdentity}
          className="mt-4 grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
        >
          <label className="text-sm font-bold text-gray-200">
            League
            <select
              value={leagueCode}
              onChange={(event) => setLeagueCode(event.target.value)}
              className="mt-2 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3"
            >
              <option value="ctc">CTC</option>
              <option value="gsc">GSC</option>
            </select>
          </label>
          <label className="text-sm font-bold text-gray-200">
            Team tag in league
            <input
              value={leagueTag}
              required
              maxLength={64}
              onChange={(event) => setLeagueTag(event.target.value)}
              className="mt-2 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3"
            />
          </label>
          <button
            type="submit"
            disabled={saving || !leagueTag.trim()}
            className="self-end rounded bg-amber-400 px-4 py-3 font-bold text-black disabled:opacity-40"
          >
            Link tag
          </button>
        </form>
        <div className="mt-4 space-y-2">
          {detail?.league_identities.length ? (
            detail.league_identities.map((identity) => (
              <div
                key={identity.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded border border-white/10 bg-black/30 px-3 py-2"
              >
                <p>
                  <span className="font-bold text-amber-200">{identity.league.toUpperCase()}</span>{" "}
                  · {identity.tag}
                </p>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void removeLeagueIdentity(identity)}
                  className="rounded border border-red-400/40 px-3 py-1.5 text-sm text-red-300"
                >
                  Unlink
                </button>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-400">No league tags linked yet.</p>
          )}
        </div>
      </section>

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

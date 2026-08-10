import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { deleteJson, fetchJson, patchJson, postJson } from "../api";
import AdminSessionPanel from "../components/AdminSessionPanel";
import TeamIdentityManager from "../components/admin/TeamIdentityManager";
import TeamLogoManager from "../components/admin/TeamLogoManager";
import { BackToHomeLink } from "../components/BackToHomeLink";
import { LeagueHeaderControls } from "../components/LeagueHeaderControls";
import { useLeague } from "../context/LeagueContext";
import { useAdminSession } from "../hooks/useAdminSession";

type EntityType = "players" | "teams" | "tracks";
type AliasEntity = {
  id: number;
  label: string;
  secondary: string | null;
  alias_count: number;
};
type AliasItem = {
  id: number;
  type: string;
  value: string;
  first_seen_match_id?: number | null;
  last_seen_match_id?: number | null;
};
type FriendCodeItem = {
  id: number | null;
  value: string;
  is_primary: boolean;
  first_seen_match_id: number | null;
  last_seen_match_id: number | null;
};
type PlayerSeasonEntryItem = {
  id: number;
  league: string;
  season: string;
  division: string;
  team: {
    id: number;
    canonical_name: string;
    clan_tag: string;
    display_name: string;
  };
  primary_lounge_name: string | null;
  primary_mii_name: string | null;
  flag: string | null;
  first_seen_match_id: number | null;
  last_seen_match_id: number | null;
};
type AliasDetail = {
  id: number;
  label: string;
  canonical_name: string | null;
  secondary: string | null;
  alias_types: string[];
  aliases: AliasItem[];
  friend_codes: FriendCodeItem[];
  season_entries: PlayerSeasonEntryItem[];
};

const entityLabels: Record<EntityType, string> = {
  players: "Players",
  teams: "Teams",
  tracks: "Tracks",
};
const aliasTypeLabels: Record<string, string> = {
  lounge_name: "Lounge names",
  table_name: "Table names",
  mii_name: "Mii names",
  friend_codes: "Friend codes",
  season_entries: "Season entries",
  alias: "Aliases",
};
const aliasTypeSingularLabels: Record<string, string> = {
  lounge_name: "lounge name",
  table_name: "table name",
  mii_name: "Mii name",
  alias: "alias",
};

function aliasTypeLabel(value: string): string {
  return aliasTypeLabels[value] ?? value.replaceAll("_", " ");
}

function aliasTypeSingularLabel(value: string): string {
  return aliasTypeSingularLabels[value] ?? value.replaceAll("_", " ");
}

export default function AdminAliasManagementPage(): React.JSX.Element {
  const auth = useAdminSession();
  const { league } = useLeague();
  const [entityType, setEntityType] = useState<EntityType>("tracks");
  const [trackLeague, setTrackLeague] = useState<"ctc" | "gsc">(league);
  const [query, setQuery] = useState("");
  const [entities, setEntities] = useState<AliasEntity[]>([]);
  const [selected, setSelected] = useState<AliasDetail | null>(null);
  const [canonicalName, setCanonicalName] = useState("");
  const [aliasType, setAliasType] = useState("alias");
  const [newAlias, setNewAlias] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!auth.session?.authenticated) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetchJson<AliasEntity[]>(`/api/admin/aliases/${entityType}`, {
        query,
        limit: 500,
        league: entityType === "tracks" ? trackLeague : undefined,
      })
        .then((response) => {
          if (!cancelled) setEntities(response);
        })
        .catch((caught: unknown) => {
          if (!cancelled)
            setError(caught instanceof Error ? caught.message : "Could not load alias objects.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [auth.session?.authenticated, entityType, query, trackLeague]);

  useEffect(() => {
    setTrackLeague(league);
    setSelected(null);
  }, [league]);

  const visibleAliases = useMemo(
    () => selected?.aliases.filter((alias) => alias.type === aliasType) ?? [],
    [selected, aliasType]
  );
  const playerDetailTabs = useMemo(
    () => (selected ? [...selected.alias_types, "friend_codes", "season_entries"] : []),
    [selected]
  );
  const isAliasTab = selected?.alias_types.includes(aliasType) ?? false;

  const chooseType = (nextType: EntityType) => {
    setEntityType(nextType);
    setQuery("");
    setSelected(null);
    setCanonicalName("");
    setAliasType(
      nextType === "players" ? "lounge_name" : nextType === "teams" ? "identity" : "alias"
    );
    setNewAlias("");
    setError("");
  };

  const chooseEntity = async (entity: AliasEntity) => {
    setLoading(true);
    setError("");
    try {
      const detail = await fetchJson<AliasDetail>(`/api/admin/aliases/${entityType}/${entity.id}`);
      setSelected(detail);
      setCanonicalName(detail.canonical_name ?? "");
      setAliasType(entityType === "teams" ? "identity" : (detail.alias_types[0] ?? "alias"));
      setNewAlias("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load aliases.");
    } finally {
      setLoading(false);
    }
  };

  const saveCanonicalName = async () => {
    if (!selected || !canonicalName.trim()) return;
    setSaving(true);
    setError("");
    try {
      const detail = await patchJson<AliasDetail>(
        `/api/admin/aliases/players/${selected.id}/canonical-name`,
        { canonical_name: canonicalName }
      );
      setSelected(detail);
      setCanonicalName(detail.canonical_name ?? "");
      setEntities((current) =>
        current.map((entity) =>
          entity.id === selected.id ? { ...entity, label: detail.label } : entity
        )
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update canonical name.");
    } finally {
      setSaving(false);
    }
  };

  const saveAlias = async () => {
    if (!selected || !newAlias.trim()) return;
    setSaving(true);
    setError("");
    try {
      const detail = await postJson<AliasDetail>(
        `/api/admin/aliases/${entityType}/${selected.id}`,
        { type: aliasType, value: newAlias }
      );
      setSelected(detail);
      setNewAlias("");
      setEntities((current) =>
        current.map((entity) =>
          entity.id === selected.id ? { ...entity, alias_count: detail.aliases.length } : entity
        )
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add alias.");
    } finally {
      setSaving(false);
    }
  };

  const removeAlias = async (alias: AliasItem) => {
    if (!selected || !window.confirm(`Remove “${alias.value}” from ${selected.label}?`)) return;
    setSaving(true);
    setError("");
    try {
      const detail = await deleteJson<AliasDetail>(
        `/api/admin/aliases/${entityType}/${selected.id}/${alias.id}`
      );
      setSelected(detail);
      setEntities((current) =>
        current.map((entity) =>
          entity.id === selected.id ? { ...entity, alias_count: detail.aliases.length } : entity
        )
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove alias.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="relative z-10 min-h-screen bg-black/85 px-5 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <BackToHomeLink className="-ml-2 mb-1" />
            <p className="text-sm uppercase text-blue-200">Restricted administration</p>
            <h1 className="text-3xl font-bold">Alias Management</h1>
            <p className="mt-2 max-w-3xl text-gray-300">
              Search canonical objects, inspect their known names, and maintain the aliases used
              during match imports and statistics searches.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-4">
            <nav className="flex flex-wrap gap-3">
              <Link to="/admin/review-queue" className="text-blue-300 hover:text-blue-200">
                Review queue
              </Link>
              <Link to="/admin/access" className="text-blue-300 hover:text-blue-200">
                Admin access
              </Link>
            </nav>
            <LeagueHeaderControls />
          </div>
        </header>

        <section className="border border-white/15 bg-zinc-950/90 p-5">
          <AdminSessionPanel {...auth} />
        </section>

        {auth.session?.authenticated ? (
          <>
            <section className="border border-white/15 bg-zinc-950/90 p-4">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Alias object type">
                {(Object.keys(entityLabels) as EntityType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="tab"
                    aria-selected={entityType === type}
                    onClick={() => chooseType(type)}
                    className={`rounded px-4 py-2 font-bold ${
                      entityType === type
                        ? "bg-blue-500 text-white"
                        : "border border-white/20 bg-black/40 text-gray-300"
                    }`}
                  >
                    {entityLabels[type]}
                  </button>
                ))}
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.4fr)]">
              <section className="border border-white/15 bg-zinc-950/90 p-4">
                {entityType === "tracks" ? (
                  <fieldset className="mb-4">
                    <legend className="mb-2 text-sm font-bold text-gray-200">Track league</legend>
                    <div className="grid grid-cols-2 gap-2">
                      {(["ctc", "gsc"] as const).map((code) => (
                        <button
                          key={code}
                          type="button"
                          aria-pressed={trackLeague === code}
                          onClick={() => {
                            setTrackLeague(code);
                            setSelected(null);
                          }}
                          className={`rounded px-3 py-2 text-sm font-bold ${
                            trackLeague === code
                              ? "bg-emerald-500 text-black"
                              : "border border-white/20 bg-black/40 text-gray-300"
                          }`}
                        >
                          {code.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
                <label className="block text-sm font-bold text-gray-200">
                  Search {entityLabels[entityType].toLowerCase()}
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Canonical name, code, or alias"
                    className="mt-2 w-full rounded border border-white/20 bg-black/50 px-3 py-2"
                  />
                </label>
                <p className="mt-3 text-sm text-gray-400">
                  {loading ? "Loading…" : `${entities.length} objects shown`}
                </p>
                <div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                  {entities.map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => void chooseEntity(entity)}
                      className={`w-full rounded border p-3 text-left ${
                        selected?.id === entity.id
                          ? "border-blue-300 bg-blue-950/60"
                          : "border-white/10 bg-black/40 hover:border-white/30"
                      }`}
                    >
                      <span className="block font-bold">{entity.label}</span>
                      <span className="mt-1 block text-xs text-gray-400">
                        {entityType === "players" ? `Player ID ${entity.id} · ` : ""}
                        {entity.secondary ? `${entity.secondary} · ` : ""}
                        {entity.alias_count} {entity.alias_count === 1 ? "alias" : "aliases"}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="border border-white/15 bg-zinc-950/90 p-5">
                {selected ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-2xl font-bold">{selected.label}</h2>
                      {entityType === "players" ? (
                        <span className="rounded border border-blue-300/30 bg-blue-950/40 px-2 py-1 text-xs font-semibold text-blue-200">
                          Player ID {selected.id}
                        </span>
                      ) : null}
                    </div>
                    {selected.secondary ? (
                      <p className="mt-1 text-sm text-gray-400">{selected.secondary}</p>
                    ) : null}

                    {entityType === "players" ? (
                      <form
                        className="mt-5 rounded border border-blue-300/20 bg-blue-950/20 p-4"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveCanonicalName();
                        }}
                      >
                        <label
                          htmlFor="player-canonical-name"
                          className="block text-sm font-bold text-blue-100"
                        >
                          Canonical name
                          <span className="ml-1 text-red-400" aria-hidden="true">
                            *
                          </span>
                          <span className="sr-only"> (required)</span>
                          <span className="mt-1 block text-xs font-normal text-gray-400">
                            This is the player&apos;s display name throughout the site. Changing it
                            does not change their player ID or related records.
                          </span>
                        </label>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <input
                            id="player-canonical-name"
                            value={canonicalName}
                            onChange={(event) => setCanonicalName(event.target.value)}
                            required
                            className="min-h-11 flex-1 rounded border border-white/20 bg-black/50 px-3 text-white"
                          />
                          <button
                            type="submit"
                            disabled={
                              saving ||
                              !canonicalName.trim() ||
                              canonicalName.trim() === selected.canonical_name
                            }
                            className="rounded bg-blue-500 px-4 py-2 font-bold text-white disabled:opacity-40"
                          >
                            {saving ? "Saving…" : "Save canonical name"}
                          </button>
                        </div>
                      </form>
                    ) : null}

                    {entityType === "players" ? (
                      <div
                        className="mt-5 flex flex-wrap gap-2"
                        role="tablist"
                        aria-label="Player alias type"
                      >
                        {playerDetailTabs.map((type) => {
                          const count =
                            type === "friend_codes"
                              ? selected.friend_codes.length
                              : type === "season_entries"
                                ? selected.season_entries.length
                                : selected.aliases.filter((alias) => alias.type === type).length;
                          return (
                            <button
                              key={type}
                              type="button"
                              role="tab"
                              aria-selected={aliasType === type}
                              onClick={() => {
                                setAliasType(type);
                                setNewAlias("");
                              }}
                              className={`rounded px-3 py-2 text-sm font-bold ${
                                aliasType === type
                                  ? "bg-emerald-500 text-black"
                                  : "border border-white/20 bg-black/40"
                              }`}
                            >
                              {aliasTypeLabel(type)} ({count})
                            </button>
                          );
                        })}
                      </div>
                    ) : entityType === "teams" ? (
                      <div
                        className="mt-5 flex flex-wrap gap-2"
                        role="tablist"
                        aria-label="Team management section"
                      >
                        {[
                          ["identity", "Identity"],
                          ["alias", `Aliases (${selected.aliases.length})`],
                          ["logos", "Logos"],
                        ].map(([type, label]) => (
                          <button
                            key={type}
                            type="button"
                            role="tab"
                            aria-selected={aliasType === type}
                            onClick={() => {
                              setAliasType(type);
                              setNewAlias("");
                            }}
                            className={`rounded px-3 py-2 text-sm font-bold ${
                              aliasType === type
                                ? "bg-emerald-500 text-black"
                                : "border border-white/20 bg-black/40"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-gray-400">
                        Track aliases map alternate track names to this canonical track.
                      </p>
                    )}

                    {isAliasTab ? (
                      <>
                        <form
                          className="mt-5 flex flex-col gap-2 sm:flex-row"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveAlias();
                          }}
                        >
                          <input
                            value={newAlias}
                            onChange={(event) => setNewAlias(event.target.value)}
                            placeholder={`Add ${aliasTypeSingularLabel(aliasType)}`}
                            className="min-h-11 flex-1 rounded border border-white/20 bg-black/50 px-3"
                          />
                          <button
                            type="submit"
                            disabled={saving || !newAlias.trim()}
                            className="rounded bg-emerald-500 px-4 py-2 font-bold text-black disabled:opacity-40"
                          >
                            {saving ? "Saving…" : "Add alias"}
                          </button>
                        </form>

                        <div className="mt-5 space-y-2">
                          {visibleAliases.length ? (
                            visibleAliases.map((alias) => (
                              <div
                                key={alias.id}
                                className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-3"
                              >
                                <div>
                                  <p className="font-semibold">{alias.value}</p>
                                  {entityType === "players" &&
                                  (alias.first_seen_match_id || alias.last_seen_match_id) ? (
                                    <p className="text-xs text-gray-400">
                                      Match history: {alias.first_seen_match_id ?? "unknown"}–
                                      {alias.last_seen_match_id ?? "unknown"}
                                    </p>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => void removeAlias(alias)}
                                  className="rounded border border-red-400/40 px-3 py-2 text-red-300 hover:bg-red-950/50"
                                >
                                  Remove
                                </button>
                              </div>
                            ))
                          ) : (
                            <p className="py-6 text-center text-gray-400">
                              No {aliasTypeLabel(aliasType).toLowerCase()} recorded.
                            </p>
                          )}
                        </div>
                      </>
                    ) : null}

                    {entityType === "players" && aliasType === "friend_codes" ? (
                      <div className="mt-5 space-y-2">
                        {selected.friend_codes.length ? (
                          selected.friend_codes.map((friendCode) => (
                            <div
                              key={friendCode.id ?? friendCode.value}
                              className="border-t border-white/10 py-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-semibold">{friendCode.value}</p>
                                {friendCode.is_primary ? (
                                  <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs font-semibold text-blue-200">
                                    Primary
                                  </span>
                                ) : null}
                              </div>
                              {friendCode.first_seen_match_id || friendCode.last_seen_match_id ? (
                                <p className="mt-1 text-xs text-gray-400">
                                  Match history: {friendCode.first_seen_match_id ?? "unknown"}–
                                  {friendCode.last_seen_match_id ?? "unknown"}
                                </p>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <p className="py-6 text-center text-gray-400">
                            No friend codes recorded.
                          </p>
                        )}
                      </div>
                    ) : null}

                    {entityType === "players" && aliasType === "season_entries" ? (
                      <div className="mt-5 space-y-3">
                        {selected.season_entries.length ? (
                          selected.season_entries.map((entry) => (
                            <article
                              key={entry.id}
                              className="rounded border border-white/10 bg-black/30 p-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="font-bold">
                                  {entry.league.toUpperCase()} · {entry.season.toUpperCase()} ·{" "}
                                  {entry.division.toUpperCase()}
                                </h3>
                                <span className="text-xs text-gray-400">Entry ID {entry.id}</span>
                              </div>
                              <p className="mt-2 text-sm text-gray-200">
                                Team: {entry.team.clan_tag} — {entry.team.display_name}
                              </p>
                              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                                <div>
                                  <dt className="text-xs uppercase text-gray-500">Lounge name</dt>
                                  <dd>{entry.primary_lounge_name ?? "Not recorded"}</dd>
                                </div>
                                <div>
                                  <dt className="text-xs uppercase text-gray-500">Mii name</dt>
                                  <dd>{entry.primary_mii_name ?? "Not recorded"}</dd>
                                </div>
                                <div>
                                  <dt className="text-xs uppercase text-gray-500">Flag</dt>
                                  <dd>{entry.flag ?? "Not recorded"}</dd>
                                </div>
                              </dl>
                              {entry.first_seen_match_id || entry.last_seen_match_id ? (
                                <p className="mt-3 text-xs text-gray-400">
                                  Match history: {entry.first_seen_match_id ?? "unknown"}–
                                  {entry.last_seen_match_id ?? "unknown"}
                                </p>
                              ) : null}
                            </article>
                          ))
                        ) : (
                          <p className="py-6 text-center text-gray-400">
                            No player-season entries recorded.
                          </p>
                        )}
                      </div>
                    ) : null}

                    {entityType === "teams" && aliasType === "logos" ? (
                      <TeamLogoManager key={selected.id} teamId={selected.id} />
                    ) : null}

                    {entityType === "teams" && aliasType === "identity" ? (
                      <TeamIdentityManager
                        key={selected.id}
                        teamId={selected.id}
                        onCanonicalSaved={(team) => {
                          const label = `${team.canonical_tag} — ${team.canonical_name}`;
                          setSelected((current) =>
                            current ? { ...current, label, secondary: team.canonical_tag } : current
                          );
                          setEntities((current) =>
                            current.map((entity) =>
                              entity.id === team.id
                                ? { ...entity, label, secondary: team.canonical_tag }
                                : entity
                            )
                          );
                        }}
                      />
                    ) : null}
                  </>
                ) : (
                  <div className="flex min-h-64 items-center justify-center text-center text-gray-400">
                    Select a {entityType.slice(0, -1)} to manage its aliases.
                  </div>
                )}
              </section>
            </div>
          </>
        ) : null}

        {error ? (
          <p className="border border-red-500/40 bg-red-950/40 p-3 text-red-200">{error}</p>
        ) : null}
      </div>
    </main>
  );
}

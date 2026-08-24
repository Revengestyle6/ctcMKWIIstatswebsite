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
  created_at?: string;
  last_observed_at?: string;
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
  race_count?: number;
  canonical_name_override?: boolean;
};
type TrackRenameResponse = {
  track: AliasDetail;
  previous_name: string;
  races_updated: number;
};
type TrackMergeResponse = {
  target: AliasDetail;
  merged: { id: number; canonical_name: string };
  races_updated: number;
  aliases_moved: number;
};
type PlayerMergeComparison = {
  source: AliasDetail;
  target: AliasDetail;
  impact: {
    friend_codes: number;
    aliases: number;
    season_entries: number;
    overlapping_season_entries: number;
    match_players: number;
    race_results: number;
  };
  overlapping_matches: Array<{ id: number; label: string }>;
  blockers: string[];
};
type PlayerMergeResponse = {
  target: AliasDetail;
  merged: { id: number; canonical_name: string };
  friend_codes_moved: number;
  aliases_moved: number;
  aliases_consolidated: number;
  season_entries_moved: number;
  season_entries_consolidated: number;
  match_players_updated: number;
  race_results_updated: number;
};
type MkcRefreshResult = {
  player_id: number;
  canonical_name: string | null;
  canonical_name_override: boolean;
  friend_codes: string[];
  mkc_aliases: string[];
  mkc_ids: string[];
  lounge_name: string | null;
  status: "found" | "not_found" | "lookup_failed" | "ambiguous" | "no_friend_codes";
  change?: "new" | "updated" | "unchanged";
  friend_code?: string;
  mkc_player_id?: number;
  mkc_name?: string;
  canonical_name_options?: string[];
  proposed_canonical_name?: string | null;
  canonical_will_change?: boolean;
  shared_mkc_name_player_ids?: number[];
  attempts: Array<{ friend_code: string; status: string; error?: string }>;
};
type MkcRefreshPreview = {
  preview_id: string;
  scope: "bulk" | "individual";
  player_id: number | null;
  status: "pending" | "applied" | "rejected";
  summary: Record<string, number>;
  results: MkcRefreshResult[];
  created_at: string;
  expires_at: string;
  applied?: {
    aliases_created: number;
    canonical_names_changed: number;
    canonical_name_selections: Record<string, string>;
  };
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
  mkc_name: "MKCentral names",
  mkc_id: "MKCentral IDs",
  canonical_name: "Previous canonical names",
  friend_codes: "Friend codes",
  season_entries: "Season entries",
  alias: "Aliases",
};
const aliasTypeSingularLabels: Record<string, string> = {
  lounge_name: "lounge name",
  table_name: "table name",
  mii_name: "Mii name",
  mkc_name: "MKCentral name",
  mkc_id: "MKCentral ID",
  canonical_name: "previous canonical name",
  alias: "alias",
};

function aliasTypeLabel(value: string): string {
  return aliasTypeLabels[value] ?? value.replaceAll("_", " ");
}

function aliasTypeSingularLabel(value: string): string {
  return aliasTypeSingularLabels[value] ?? value.replaceAll("_", " ");
}

function PlayerComparisonCard({
  detail,
  disposition,
}: {
  detail: AliasDetail;
  disposition: "removed" | "kept";
}): React.JSX.Element {
  return (
    <article className="rounded border border-white/15 bg-black/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
            {disposition === "removed" ? "Source record" : "Destination record"}
          </p>
          <h3 className="mt-1 text-xl font-bold text-white">{detail.label}</h3>
          <p className="text-xs text-gray-400">Player ID {detail.id}</p>
        </div>
        <span
          className={`rounded px-2 py-1 text-xs font-bold ${
            disposition === "removed"
              ? "bg-red-500/20 text-red-200"
              : "bg-emerald-500/20 text-emerald-200"
          }`}
        >
          {disposition === "removed" ? "Will be removed" : "Will remain"}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase text-gray-500">Canonical name</dt>
          <dd>{detail.canonical_name ?? "Not set"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Manual override</dt>
          <dd>{detail.canonical_name_override ? "Enabled" : "Disabled"}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <h4 className="text-xs font-bold uppercase text-gray-400">
          Friend codes ({detail.friend_codes.length})
        </h4>
        <p className="mt-1 text-sm text-gray-200">
          {detail.friend_codes.length
            ? detail.friend_codes
                .map((friendCode) =>
                  friendCode.is_primary ? `${friendCode.value} (primary)` : friendCode.value
                )
                .join(", ")
            : "None recorded"}
        </p>
      </div>
      <div className="mt-4">
        <h4 className="text-xs font-bold uppercase text-gray-400">
          Aliases ({detail.aliases.length})
        </h4>
        <ul className="mt-1 space-y-1 text-sm text-gray-200">
          {detail.aliases.length ? (
            detail.aliases.map((alias) => (
              <li key={alias.id}>
                <span className="text-gray-500">{aliasTypeLabel(alias.type)}:</span> {alias.value}
              </li>
            ))
          ) : (
            <li>None recorded</li>
          )}
        </ul>
      </div>
      <div className="mt-4">
        <h4 className="text-xs font-bold uppercase text-gray-400">
          Season entries ({detail.season_entries.length})
        </h4>
        <ul className="mt-1 space-y-1 text-sm text-gray-200">
          {detail.season_entries.length ? (
            detail.season_entries.map((entry) => (
              <li key={entry.id}>
                {entry.league.toUpperCase()} {entry.season.toUpperCase()}{" "}
                {entry.division.toUpperCase()}
                {" · "}
                {entry.team.clan_tag} — {entry.team.display_name}
              </li>
            ))
          ) : (
            <li>None recorded</li>
          )}
        </ul>
      </div>
    </article>
  );
}

export default function AdminAliasManagementPage(): React.JSX.Element {
  const auth = useAdminSession();
  const { league } = useLeague();
  const [entityType, setEntityType] = useState<EntityType>("tracks");
  const [trackLeague, setTrackLeague] = useState<"ctc" | "gsc">(league);
  const [query, setQuery] = useState("");
  const [entities, setEntities] = useState<AliasEntity[]>([]);
  const [trackCandidates, setTrackCandidates] = useState<AliasEntity[]>([]);
  const [playerCandidates, setPlayerCandidates] = useState<AliasEntity[]>([]);
  const [selected, setSelected] = useState<AliasDetail | null>(null);
  const [canonicalName, setCanonicalName] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [playerMergeTargetId, setPlayerMergeTargetId] = useState("");
  const [playerMergeReview, setPlayerMergeReview] = useState<PlayerMergeComparison | null>(null);
  const [playerMergeLoading, setPlayerMergeLoading] = useState(false);
  const [aliasType, setAliasType] = useState("alias");
  const [newAlias, setNewAlias] = useState("");
  const [newFriendCode, setNewFriendCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mkcLoading, setMkcLoading] = useState(false);
  const [mkcPreview, setMkcPreview] = useState<MkcRefreshPreview | null>(null);
  const [mkcCanonicalSelections, setMkcCanonicalSelections] = useState<Record<number, string>>({});

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
    if (!auth.session?.authenticated || entityType !== "tracks") return;
    let cancelled = false;
    fetchJson<AliasEntity[]>("/api/admin/aliases/tracks", {
      limit: 500,
      league: trackLeague,
    })
      .then((response) => {
        if (!cancelled) setTrackCandidates(response);
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : "Could not load track choices.");
      });
    return () => {
      cancelled = true;
    };
  }, [auth.session?.authenticated, entityType, trackLeague]);

  useEffect(() => {
    if (!auth.session?.authenticated || entityType !== "players") return;
    let cancelled = false;
    fetchJson<AliasEntity[]>("/api/admin/aliases/players", { limit: 500 })
      .then((response) => {
        if (!cancelled) setPlayerCandidates(response);
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : "Could not load player choices.");
      });
    return () => {
      cancelled = true;
    };
  }, [auth.session?.authenticated, entityType]);

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
  const combinedMkcNameResults = useMemo(
    () =>
      mkcPreview?.results.filter(
        (result) =>
          result.status === "found" &&
          !result.shared_mkc_name_player_ids?.length &&
          (result.canonical_name_options?.length ?? 0) > 1
      ) ?? [],
    [mkcPreview]
  );
  const reviewedCanonicalChanges = useMemo(
    () =>
      mkcPreview?.results.filter(
        (result) =>
          result.status === "found" &&
          !result.canonical_name_override &&
          (mkcCanonicalSelections[result.player_id] ?? result.proposed_canonical_name) !==
            result.canonical_name
      ).length ?? 0,
    [mkcCanonicalSelections, mkcPreview]
  );

  const chooseType = (nextType: EntityType) => {
    setEntityType(nextType);
    setQuery("");
    setSelected(null);
    setCanonicalName("");
    setMergeTargetId("");
    setPlayerMergeTargetId("");
    setPlayerMergeReview(null);
    setAliasType(
      nextType === "players" ? "lounge_name" : nextType === "teams" ? "identity" : "alias"
    );
    setNewAlias("");
    setNewFriendCode("");
    setError("");
    setNotice("");
  };

  const chooseEntity = async (entity: AliasEntity) => {
    setLoading(true);
    setError("");
    try {
      const detail = await fetchJson<AliasDetail>(`/api/admin/aliases/${entityType}/${entity.id}`);
      setSelected(detail);
      setCanonicalName(detail.canonical_name ?? "");
      setMergeTargetId("");
      setPlayerMergeTargetId("");
      setPlayerMergeReview(null);
      setAliasType(entityType === "teams" ? "identity" : (detail.alias_types[0] ?? "alias"));
      setNewAlias("");
      setNewFriendCode("");
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

  const setCanonicalOverride = async (enabled: boolean) => {
    if (!selected || entityType !== "players") return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const detail = await patchJson<AliasDetail>(
        `/api/admin/aliases/players/${selected.id}/canonical-name-override`,
        { enabled }
      );
      setSelected(detail);
      setCanonicalName(detail.canonical_name ?? "");
      setEntities((current) =>
        current.map((entity) =>
          entity.id === detail.id ? { ...entity, label: detail.label } : entity
        )
      );
      setNotice(
        enabled
          ? "Canonical-name override enabled. MKCentral refreshes will preserve this name."
          : "Canonical-name override disabled. Automatic name priority has been reapplied."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update name override.");
    } finally {
      setSaving(false);
    }
  };

  const createMkcPreview = async (playerId?: number) => {
    setMkcLoading(true);
    setError("");
    setNotice("");
    try {
      const preview = await postJson<MkcRefreshPreview>("/api/admin/mkc-refresh-previews", {
        player_id: playerId,
      });
      setMkcPreview(preview);
      setMkcCanonicalSelections(
        Object.fromEntries(
          preview.results
            .filter(
              (result) =>
                result.status === "found" &&
                !result.canonical_name_override &&
                !result.shared_mkc_name_player_ids?.length &&
                (result.canonical_name_options?.length ?? 0) > 1
            )
            .map((result) => [
              result.player_id,
              result.proposed_canonical_name ?? result.mkc_name ?? "",
            ])
        )
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not query MKCentral names.");
    } finally {
      setMkcLoading(false);
    }
  };

  const decideMkcPreview = async (decision: "apply" | "reject") => {
    if (!mkcPreview) return;
    setMkcLoading(true);
    setError("");
    try {
      const decided = await postJson<MkcRefreshPreview>(
        `/api/admin/mkc-refresh-previews/${mkcPreview.preview_id}/${decision}`,
        decision === "apply" ? { canonical_name_selections: mkcCanonicalSelections } : {}
      );
      if (decision === "apply") {
        const entityPromise = fetchJson<AliasEntity[]>("/api/admin/aliases/players", {
          query: entityType === "players" ? query : "",
          limit: 500,
        });
        const detailPromise =
          entityType === "players" && selected
            ? fetchJson<AliasDetail>(`/api/admin/aliases/players/${selected.id}`)
            : Promise.resolve(null);
        const [refreshedEntities, refreshedDetail] = await Promise.all([
          entityPromise,
          detailPromise,
        ]);
        if (entityType === "players") setEntities(refreshedEntities);
        if (refreshedDetail) {
          setSelected(refreshedDetail);
          setCanonicalName(refreshedDetail.canonical_name ?? "");
        }
        setNotice(
          `Applied MKCentral refresh: ${decided.applied?.aliases_created ?? 0} aliases added and ${decided.applied?.canonical_names_changed ?? 0} canonical names changed.`
        );
      } else {
        setNotice("MKCentral refresh rejected. No player names were changed.");
      }
      setMkcPreview(null);
      setMkcCanonicalSelections({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${decision} refresh.`);
    } finally {
      setMkcLoading(false);
    }
  };

  const downloadMkcReport = () => {
    if (!mkcPreview) return;
    const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      [
        "Player ID",
        "Current canonical name",
        "Override enabled",
        "Result",
        "Change",
        "MKCentral name",
        "MKCentral player ID",
        "Resolved friend code",
        "Friend codes tried",
        "Lookup details",
        "Proposed canonical name",
      ],
      ...mkcPreview.results.map((result) => [
        result.player_id,
        result.canonical_name,
        result.canonical_name_override,
        result.status,
        result.change ?? "",
        result.mkc_name ?? "",
        result.mkc_player_id ?? "",
        result.friend_code ?? "",
        result.attempts.map((attempt) => `${attempt.friend_code}: ${attempt.status}`).join("; "),
        result.attempts
          .filter((attempt) => attempt.error)
          .map((attempt) => `${attempt.friend_code}: ${attempt.error}`)
          .join("; "),
        mkcCanonicalSelections[result.player_id] ?? result.proposed_canonical_name ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mkcentral-name-refresh-${mkcPreview.preview_id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const saveTrackCanonicalName = async () => {
    if (!selected || entityType !== "tracks" || !canonicalName.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await patchJson<TrackRenameResponse>(
        `/api/admin/aliases/tracks/${selected.id}/canonical-name`,
        { canonical_name: canonicalName }
      );
      setSelected(response.track);
      setCanonicalName(response.track.canonical_name ?? "");
      const updateEntity = (entity: AliasEntity) =>
        entity.id === selected.id
          ? {
              ...entity,
              label: response.track.label,
              alias_count: response.track.aliases.length,
            }
          : entity;
      setEntities((current) => current.map(updateEntity));
      setTrackCandidates((current) => current.map(updateEntity));
      setNotice(
        `Renamed to ${response.track.label} and updated ${response.races_updated} historical ${response.races_updated === 1 ? "race" : "races"}.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not rename track.");
    } finally {
      setSaving(false);
    }
  };

  const mergeSelectedTrack = async () => {
    if (!selected || entityType !== "tracks" || !mergeTargetId) return;
    const targetId = Number(mergeTargetId);
    const target = trackCandidates.find((candidate) => candidate.id === targetId);
    if (!target) return;
    if (
      !window.confirm(
        `Merge “${selected.label}” into “${target.label}”? All historical races will use “${target.label}”, and the original track record will be deleted.`
      )
    )
      return;

    const sourceId = selected.id;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await postJson<TrackMergeResponse>(
        `/api/admin/aliases/tracks/${sourceId}/merge`,
        { target_track_id: targetId }
      );
      const updateEntities = (current: AliasEntity[]) =>
        current
          .filter((entity) => entity.id !== sourceId)
          .map((entity) =>
            entity.id === targetId
              ? {
                  ...entity,
                  label: response.target.label,
                  alias_count: response.target.aliases.length,
                }
              : entity
          );
      setEntities(updateEntities);
      setTrackCandidates(updateEntities);
      setSelected(response.target);
      setCanonicalName(response.target.canonical_name ?? "");
      setMergeTargetId("");
      setNotice(
        `Merged ${response.merged.canonical_name} into ${response.target.label}. Updated ${response.races_updated} ${response.races_updated === 1 ? "race" : "races"} and preserved ${response.aliases_moved} ${response.aliases_moved === 1 ? "alias" : "aliases"}.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not merge tracks.");
    } finally {
      setSaving(false);
    }
  };

  const reviewPlayerMerge = async () => {
    if (!selected || entityType !== "players" || !playerMergeTargetId) return;
    setPlayerMergeLoading(true);
    setError("");
    setNotice("");
    try {
      const comparison = await fetchJson<PlayerMergeComparison>(
        `/api/admin/aliases/players/${selected.id}/merge-comparison`,
        { target_player_id: playerMergeTargetId }
      );
      setPlayerMergeReview(comparison);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not compare player records.");
    } finally {
      setPlayerMergeLoading(false);
    }
  };

  const confirmPlayerMerge = async () => {
    if (!playerMergeReview || playerMergeReview.blockers.length) return;
    const sourceId = playerMergeReview.source.id;
    const targetId = playerMergeReview.target.id;
    setPlayerMergeLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await postJson<PlayerMergeResponse>(
        `/api/admin/aliases/players/${sourceId}/merge`,
        { target_player_id: targetId }
      );
      const updatePlayers = (current: AliasEntity[]) =>
        current
          .filter((entity) => entity.id !== sourceId)
          .map((entity) =>
            entity.id === targetId
              ? {
                  ...entity,
                  label: response.target.label,
                  secondary: response.target.secondary,
                  alias_count: response.target.aliases.length,
                }
              : entity
          );
      setEntities(updatePlayers);
      setPlayerCandidates(updatePlayers);
      setSelected(response.target);
      setCanonicalName(response.target.canonical_name ?? "");
      setPlayerMergeReview(null);
      setPlayerMergeTargetId("");
      setNotice(
        `Merged ${response.merged.canonical_name} into ${response.target.label}. Moved ${response.friend_codes_moved} friend codes, updated ${response.match_players_updated} match appearances, and updated ${response.race_results_updated} race results.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not merge player records.");
    } finally {
      setPlayerMergeLoading(false);
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

  const addFriendCode = async () => {
    if (!selected || entityType !== "players" || !newFriendCode.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const detail = await postJson<AliasDetail>(
        `/api/admin/aliases/players/${selected.id}/friend-codes`,
        { friend_code: newFriendCode }
      );
      setSelected(detail);
      setNewFriendCode("");
      setEntities((current) =>
        current.map((entity) =>
          entity.id === selected.id ? { ...entity, secondary: detail.secondary } : entity
        )
      );
      setNotice(
        "Friend code added. Refresh this player's MKCentral name to resolve the associated profile."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add friend code.");
    } finally {
      setSaving(false);
    }
  };

  const removeFriendCode = async (friendCode: FriendCodeItem) => {
    if (!selected || friendCode.id === null) return;
    if (
      !window.confirm(
        `Remove friend code ${friendCode.value} from ${selected.label}? Friend codes should generally only be removed when they were added by mistake.`
      )
    )
      return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const detail = await deleteJson<AliasDetail>(
        `/api/admin/aliases/players/${selected.id}/friend-codes/${friendCode.id}`
      );
      setSelected(detail);
      setEntities((current) =>
        current.map((entity) =>
          entity.id === selected.id ? { ...entity, secondary: detail.secondary } : entity
        )
      );
      setNotice(`Removed friend code ${friendCode.value}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove friend code.");
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
              {entityType === "players" ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <p className="max-w-3xl text-sm text-gray-400">
                    Query MKCentral using each player&apos;s most recently used friend code first,
                    then review every proposed alias and canonical-name change before applying it.
                  </p>
                  <button
                    type="button"
                    disabled={mkcLoading}
                    onClick={() => void createMkcPreview()}
                    className="rounded bg-violet-500 px-4 py-2 font-bold text-white disabled:opacity-40"
                  >
                    {mkcLoading ? "Querying MKCentral…" : "Refresh all MKCentral names"}
                  </button>
                </div>
              ) : null}
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
                            {selected.canonical_name_override
                              ? "Manual override is active. MKCentral refreshes will still record aliases but will not replace this name."
                              : "Automatic priority is active. The latest MKCentral name is preferred when one is available."}
                          </span>
                        </label>
                        <label className="mt-3 flex items-start gap-3 rounded border border-white/10 bg-black/25 p-3 text-sm text-gray-200">
                          <input
                            type="checkbox"
                            checked={selected.canonical_name_override ?? false}
                            disabled={saving}
                            onChange={(event) => void setCanonicalOverride(event.target.checked)}
                            className="mt-1 h-4 w-4"
                          />
                          <span>
                            Keep canonical name under manual control
                            <span className="mt-1 block text-xs text-gray-400">
                              Enabling this keeps the current canonical name. MKCentral names remain
                              recorded as timestamped aliases.
                            </span>
                          </span>
                        </label>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <input
                            id="player-canonical-name"
                            value={canonicalName}
                            onChange={(event) => setCanonicalName(event.target.value)}
                            required
                            disabled={!selected.canonical_name_override}
                            className="min-h-11 flex-1 rounded border border-white/20 bg-black/50 px-3 text-white"
                          />
                          <button
                            type="submit"
                            disabled={
                              saving ||
                              !selected.canonical_name_override ||
                              !canonicalName.trim() ||
                              canonicalName.trim() === selected.canonical_name
                            }
                            className="rounded bg-blue-500 px-4 py-2 font-bold text-white disabled:opacity-40"
                          >
                            {saving ? "Saving…" : "Save canonical name"}
                          </button>
                          <button
                            type="button"
                            disabled={mkcLoading}
                            onClick={() => void createMkcPreview(selected.id)}
                            className="rounded border border-violet-300/40 px-4 py-2 font-bold text-violet-200 disabled:opacity-40"
                          >
                            {mkcLoading ? "Querying…" : "Refresh MKCentral name"}
                          </button>
                        </div>
                      </form>
                    ) : null}

                    {entityType === "players" ? (
                      <form
                        className="mt-5 rounded border border-amber-300/25 bg-amber-950/20 p-4"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void reviewPlayerMerge();
                        }}
                      >
                        <label
                          htmlFor="player-merge-target"
                          className="block text-sm font-bold text-amber-100"
                        >
                          Merge into an existing player
                          <span className="mt-1 block text-xs font-normal text-gray-400">
                            Moves all friend codes, aliases, season entries, match appearances, and
                            race results to the destination. You will review both records before
                            this player record is permanently removed.
                          </span>
                        </label>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <select
                            id="player-merge-target"
                            value={playerMergeTargetId}
                            onChange={(event) => setPlayerMergeTargetId(event.target.value)}
                            className="min-h-11 flex-1 rounded border border-white/20 bg-black/50 px-3 text-white"
                          >
                            <option value="">Choose destination player</option>
                            {playerCandidates
                              .filter((candidate) => candidate.id !== selected.id)
                              .map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.label}
                                  {candidate.secondary ? ` — ${candidate.secondary}` : ""} (ID{" "}
                                  {candidate.id})
                                </option>
                              ))}
                          </select>
                          <button
                            type="submit"
                            disabled={playerMergeLoading || !playerMergeTargetId}
                            className="rounded bg-amber-400 px-4 py-2 font-bold text-black disabled:opacity-40"
                          >
                            {playerMergeLoading ? "Loading comparison…" : "Review merge"}
                          </button>
                        </div>
                      </form>
                    ) : null}

                    {entityType === "tracks" ? (
                      <div className="mt-5 grid gap-4 xl:grid-cols-2">
                        <form
                          className="rounded border border-blue-300/20 bg-blue-950/20 p-4"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveTrackCanonicalName();
                          }}
                        >
                          <label
                            htmlFor="track-canonical-name"
                            className="block text-sm font-bold text-blue-100"
                          >
                            Rename canonical track
                            <span className="mt-1 block text-xs font-normal text-gray-400">
                              Changes this track&apos;s name on all {selected.race_count ?? 0}{" "}
                              recorded races. The old name remains an alias for future imports.
                            </span>
                          </label>
                          <input
                            id="track-canonical-name"
                            value={canonicalName}
                            onChange={(event) => setCanonicalName(event.target.value)}
                            required
                            className="mt-3 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3 text-white"
                          />
                          <button
                            type="submit"
                            disabled={
                              saving ||
                              !canonicalName.trim() ||
                              canonicalName.trim() === selected.canonical_name
                            }
                            className="mt-3 rounded bg-blue-500 px-4 py-2 font-bold text-white disabled:opacity-40"
                          >
                            {saving ? "Saving…" : "Rename track"}
                          </button>
                        </form>

                        <form
                          className="rounded border border-amber-300/25 bg-amber-950/20 p-4"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void mergeSelectedTrack();
                          }}
                        >
                          <label
                            htmlFor="track-merge-target"
                            className="block text-sm font-bold text-amber-100"
                          >
                            Map to an existing track
                            <span className="mt-1 block text-xs font-normal text-gray-400">
                              Moves all races and aliases to the destination, then permanently
                              removes this track record.
                            </span>
                          </label>
                          <select
                            id="track-merge-target"
                            value={mergeTargetId}
                            onChange={(event) => setMergeTargetId(event.target.value)}
                            className="mt-3 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3 text-white"
                          >
                            <option value="">Choose destination track</option>
                            {trackCandidates
                              .filter((candidate) => candidate.id !== selected.id)
                              .map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.label}
                                </option>
                              ))}
                          </select>
                          <button
                            type="submit"
                            disabled={saving || !mergeTargetId}
                            className="mt-3 rounded bg-amber-400 px-4 py-2 font-bold text-black disabled:opacity-40"
                          >
                            {saving ? "Merging…" : "Map and remove track"}
                          </button>
                        </form>
                      </div>
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
                                setNewFriendCode("");
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
                                  {alias.created_at ? (
                                    <p className="text-xs text-gray-400">
                                      Added {new Date(alias.created_at).toLocaleString()}
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
                        <form
                          className="mb-5 flex flex-col gap-2 sm:flex-row"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void addFriendCode();
                          }}
                        >
                          <input
                            value={newFriendCode}
                            onChange={(event) => setNewFriendCode(event.target.value)}
                            placeholder="0000-0000-0000"
                            aria-label="New friend code"
                            inputMode="numeric"
                            maxLength={14}
                            pattern="\d{4}-\d{4}-\d{4}"
                            className="min-h-11 flex-1 rounded border border-white/20 bg-black/50 px-3"
                          />
                          <button
                            type="submit"
                            disabled={saving || !newFriendCode.trim()}
                            className="rounded bg-emerald-500 px-4 py-2 font-bold text-black disabled:opacity-40"
                          >
                            {saving ? "Saving…" : "Add friend code"}
                          </button>
                        </form>
                        {selected.friend_codes.length ? (
                          selected.friend_codes.map((friendCode) => (
                            <div
                              key={friendCode.id ?? friendCode.value}
                              className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-3"
                            >
                              <div>
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
                              <button
                                type="button"
                                disabled={saving || friendCode.id === null}
                                onClick={() => void removeFriendCode(friendCode)}
                                className="rounded border border-red-400/40 px-3 py-2 text-red-300 hover:bg-red-950/50 disabled:opacity-40"
                              >
                                Remove
                              </button>
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
        {notice ? (
          <p className="border border-emerald-500/40 bg-emerald-950/40 p-3 text-emerald-100">
            {notice}
          </p>
        ) : null}
      </div>

      {playerMergeReview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="player-merge-review-title"
        >
          <section className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded border border-amber-300/30 bg-zinc-950 p-5 shadow-2xl">
            <h2 id="player-merge-review-title" className="text-2xl font-bold text-amber-100">
              Review player merge
            </h2>
            <p className="mt-2 text-sm text-gray-300">
              No changes have been made. Confirming keeps the destination player and permanently
              removes the source after its identity and historical records are transferred.
            </p>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <PlayerComparisonCard detail={playerMergeReview.source} disposition="removed" />
              <PlayerComparisonCard detail={playerMergeReview.target} disposition="kept" />
            </div>

            <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Friend codes moved", playerMergeReview.impact.friend_codes],
                ["Aliases moved", playerMergeReview.impact.aliases],
                ["Season entries moved", playerMergeReview.impact.season_entries],
                ["Season entries combined", playerMergeReview.impact.overlapping_season_entries],
                ["Match appearances updated", playerMergeReview.impact.match_players],
                ["Race results updated", playerMergeReview.impact.race_results],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-white/10 bg-black/30 p-3">
                  <dt className="text-xs uppercase text-gray-400">{label}</dt>
                  <dd className="mt-1 text-2xl font-bold">{value}</dd>
                </div>
              ))}
            </dl>

            {playerMergeReview.blockers.length ? (
              <div className="mt-5 rounded border border-red-500/40 bg-red-950/40 p-4 text-red-100">
                <h3 className="font-bold">This merge cannot be completed</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {playerMergeReview.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-white/10 pt-4">
              <button
                type="button"
                disabled={playerMergeLoading}
                onClick={() => setPlayerMergeReview(null)}
                className="rounded border border-white/25 px-4 py-2 font-bold text-gray-100 disabled:opacity-40"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={playerMergeLoading || playerMergeReview.blockers.length > 0}
                onClick={() => void confirmPlayerMerge()}
                className="rounded bg-red-500 px-4 py-2 font-bold text-white disabled:opacity-40"
              >
                {playerMergeLoading ? "Merging…" : "Confirm merge"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {mkcPreview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mkc-review-title"
        >
          <section className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded border border-violet-300/30 bg-zinc-950 p-5 shadow-2xl">
            <h2 id="mkc-review-title" className="text-2xl font-bold text-violet-100">
              Review MKCentral name refresh
            </h2>
            <p className="mt-2 text-sm text-gray-300">
              No database names have changed yet. Review or download these lookup results, then
              accept or reject the complete refresh.
            </p>

            {error ? (
              <div
                role="alert"
                className="mt-4 rounded border border-red-400/40 bg-red-950/50 p-3 text-sm text-red-100"
              >
                {error}
              </div>
            ) : null}

            <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["New MKCentral names", mkcPreview.summary.new],
                ["Updated MKCentral names", mkcPreview.summary.updated],
                ["Profiles not found", mkcPreview.summary.not_found],
                ["Lookup failures", mkcPreview.summary.lookup_failed],
                ["Unchanged", mkcPreview.summary.unchanged],
                ["Ambiguous", mkcPreview.summary.ambiguous],
                ["No friend codes", mkcPreview.summary.no_friend_codes],
                ["Canonical changes", reviewedCanonicalChanges],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-white/10 bg-black/30 p-3">
                  <dt className="text-xs uppercase text-gray-400">{label}</dt>
                  <dd className="mt-1 text-2xl font-bold">{value}</dd>
                </div>
              ))}
            </dl>

            {combinedMkcNameResults.length ? (
              <div className="mt-6 rounded border border-violet-300/25 bg-violet-950/15 p-4">
                <h3 className="font-bold text-violet-100">
                  Choose canonical names for combined MKCentral records
                </h3>
                <p className="mt-1 text-xs text-gray-400">
                  The complete MKCentral value is always saved as the alias. Choose one separated
                  name for the canonical display, or keep the complete value if the slash or pipe is
                  part of the name.
                </p>
                <div className="mt-4 space-y-4">
                  {combinedMkcNameResults.map((result) => (
                    <div
                      key={result.player_id}
                      className="block rounded border border-white/10 bg-black/30 p-3 text-sm"
                    >
                      <span className="block font-semibold">
                        Player {result.player_id}: {result.canonical_name ?? "Unnamed"}
                      </span>
                      <span className="mt-1 block text-xs text-gray-400">
                        Raw MKCentral alias: {result.mkc_name}
                      </span>
                      {result.canonical_name_override ? (
                        <span className="mt-2 block text-amber-200">
                          Manual override is active, so this refresh will retain the current
                          canonical name.
                        </span>
                      ) : (
                        <select
                          aria-label={`Canonical name for player ${result.player_id}`}
                          value={
                            mkcCanonicalSelections[result.player_id] ??
                            result.proposed_canonical_name ??
                            result.mkc_name
                          }
                          onChange={(event) =>
                            setMkcCanonicalSelections((current) => ({
                              ...current,
                              [result.player_id]: event.target.value,
                            }))
                          }
                          className="mt-2 min-h-11 w-full rounded border border-white/20 bg-zinc-950 px-3 text-white"
                        >
                          {result.proposed_canonical_name &&
                          !result.canonical_name_options?.includes(
                            result.proposed_canonical_name
                          ) ? (
                            <option value={result.proposed_canonical_name}>
                              {result.proposed_canonical_name} (lounge-name fallback)
                            </option>
                          ) : null}
                          {result.canonical_name_options?.map((option) => (
                            <option key={option} value={option}>
                              {option === result.mkc_name
                                ? `${option} (use complete MKCentral name)`
                                : option}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {[
              ["New MKCentral names", "new"],
              ["Changed MKCentral names", "updated"],
            ].map(([heading, change]) => {
              const results = mkcPreview.results.filter((result) => result.change === change);
              return results.length ? (
                <div key={change} className="mt-6">
                  <h3 className="font-bold text-emerald-200">{heading}</h3>
                  <div className="mt-2 space-y-2">
                    {results.map((result) => (
                      <div
                        key={result.player_id}
                        className="rounded border border-white/10 bg-black/30 p-3 text-sm"
                      >
                        <span className="font-semibold">
                          Player {result.player_id}: {result.canonical_name ?? "Unnamed"}
                        </span>
                        <span className="ml-2 text-gray-400">
                          · MKCentral name{" "}
                          <span className="text-emerald-200">{result.mkc_name}</span>
                          {" · "}ID {result.mkc_player_id} · via {result.friend_code}
                          {result.canonical_name_override ? " · canonical override retained" : ""}
                        </span>
                        {result.shared_mkc_name_player_ids?.length ? (
                          <span className="mt-2 block text-amber-200">
                            This name is shared by players{" "}
                            {result.shared_mkc_name_player_ids.join(", ")}. Their lounge names
                            become the automatic canonical names.
                          </span>
                        ) : null}
                        {!result.canonical_name_override && result.proposed_canonical_name ? (
                          <span className="mt-1 block text-gray-300">
                            Canonical name after approval: {result.proposed_canonical_name}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null;
            })}

            {mkcPreview.results.some((result) => result.status === "not_found") ? (
              <div className="mt-6">
                <h3 className="font-bold text-amber-200">No MKCentral profile found</h3>
                <p className="mt-1 text-xs text-gray-400">
                  MKCentral responded successfully for every friend code tried for these players.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {mkcPreview.results
                    .filter((result) => result.status === "not_found")
                    .map((result) => (
                      <span
                        key={result.player_id}
                        className="rounded border border-amber-300/20 bg-amber-950/20 px-3 py-2 text-sm"
                      >
                        Player {result.player_id}: {result.canonical_name ?? "Unnamed"}
                      </span>
                    ))}
                </div>
              </div>
            ) : null}

            {mkcPreview.results.some((result) =>
              ["lookup_failed", "ambiguous", "no_friend_codes"].includes(result.status)
            ) ? (
              <div className="mt-6">
                <h3 className="font-bold text-red-200">Could not resolve</h3>
                <div className="mt-2 space-y-2">
                  {mkcPreview.results
                    .filter((result) =>
                      ["lookup_failed", "ambiguous", "no_friend_codes"].includes(result.status)
                    )
                    .map((result) => (
                      <div
                        key={result.player_id}
                        className="rounded border border-red-300/20 bg-red-950/20 p-3 text-sm"
                      >
                        Player {result.player_id}: {result.canonical_name ?? "Unnamed"} ·{" "}
                        {result.status.replaceAll("_", " ")}
                        {result.attempts.some((attempt) => attempt.error) ? (
                          <span className="mt-1 block text-xs text-red-100/80">
                            {result.attempts
                              .filter((attempt) => attempt.error)
                              .map((attempt) => attempt.error)
                              .join("; ")}
                          </span>
                        ) : null}
                      </div>
                    ))}
                </div>
              </div>
            ) : null}

            <div className="mt-7 flex flex-wrap justify-between gap-3 border-t border-white/10 pt-5">
              <button
                type="button"
                onClick={downloadMkcReport}
                className="rounded border border-violet-300/40 px-4 py-2 font-bold text-violet-200"
              >
                Download CSV report
              </button>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={mkcLoading}
                  onClick={() => void decideMkcPreview("reject")}
                  className="rounded border border-red-300/40 px-4 py-2 font-bold text-red-200 disabled:opacity-40"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={mkcLoading}
                  onClick={() => void decideMkcPreview("apply")}
                  className="rounded bg-emerald-500 px-4 py-2 font-bold text-black disabled:opacity-40"
                >
                  {mkcLoading ? "Applying…" : "Accept and apply"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

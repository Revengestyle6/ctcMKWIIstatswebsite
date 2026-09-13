import { useEffect, useRef, useState } from "react";

import { fetchJson, patchJson, postFormData, postJson, resolveAssetUrl } from "../../api";

type LogoSeason = {
  id: number;
  league: string;
  season: string;
  name: string;
  season_number: number | null;
};

type LogoDivision = { id: number; code: string; name: string };

type TeamSeasonEntry = {
  id: number;
  display_name: string;
  clan_tag: string;
  season: LogoSeason;
  division: LogoDivision;
};

type TeamLogo = {
  id: number;
  season: LogoSeason | null;
  team_season_entry: TeamSeasonEntry | null;
  alt_text: string;
  priority: number;
  is_active: boolean;
  source: "upload" | "static";
  url: string;
  created_at: string | null;
};

type TeamLogoDetail = {
  team: { id: number; canonical_name: string; canonical_tag: string };
  seasons: LogoSeason[];
  season_entries: TeamSeasonEntry[];
  logos: TeamLogo[];
};

type AssignmentMode = "reuse" | "upload";

function entryLabel(entry: TeamSeasonEntry): string {
  return `${entry.season.league.toUpperCase()} ${entry.season.season.toUpperCase()} ${entry.division.code.toUpperCase()} — ${entry.display_name} (${entry.clan_tag})`;
}

function logoScopeLabel(logo: TeamLogo): string {
  if (logo.team_season_entry) return entryLabel(logo.team_season_entry);
  if (logo.season) {
    return `${logo.season.league.toUpperCase()} ${logo.season.season.toUpperCase()} — all divisions`;
  }
  return "Default / career";
}

function scopePayload(scope: string): {
  season_id?: number;
  team_season_entry_id?: number;
} {
  const [kind, rawId] = scope.split(":");
  const id = Number(rawId);
  if (kind === "entry" && Number.isInteger(id)) return { team_season_entry_id: id };
  if (kind === "season" && Number.isInteger(id)) return { season_id: id };
  return {};
}

function logoMatchesScope(logo: TeamLogo, scope: string): boolean {
  const target = scopePayload(scope);
  if (target.team_season_entry_id) {
    return logo.team_season_entry?.id === target.team_season_entry_id;
  }
  if (target.season_id) {
    return !logo.team_season_entry && logo.season?.id === target.season_id;
  }
  return !logo.team_season_entry && !logo.season;
}

const inputClass = "mt-2 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3";

export default function TeamLogoManager({ teamId }: { teamId: number }): React.JSX.Element {
  const [detail, setDetail] = useState<TeamLogoDetail | null>(null);
  const [targetScope, setTargetScope] = useState("career");
  const [mode, setMode] = useState<AssignmentMode>("reuse");
  const [sourceLogoId, setSourceLogoId] = useState("");
  const [altText, setAltText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const assignmentRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setMessage("");
    fetchJson<TeamLogoDetail>(`/api/admin/teams/${teamId}/logos`)
      .then((response) => {
        if (cancelled) return;
        setDetail(response);
        setTargetScope(
          response.season_entries[0] ? `entry:${response.season_entries[0].id}` : "career"
        );
        const initialLogo = response.logos.find((logo) => logo.is_active) ?? response.logos[0];
        setSourceLogoId(initialLogo ? String(initialLogo.id) : "");
        setAltText(initialLogo?.alt_text ?? `${response.team.canonical_name} logo`);
        setMode(initialLogo ? "reuse" : "upload");
        setImage(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load team logos.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const selectedLogo = detail?.logos.find((logo) => String(logo.id) === sourceLogoId) ?? null;
  const explicitTargetLogo =
    detail?.logos.find((logo) => logo.is_active && logoMatchesScope(logo, targetScope)) ?? null;

  const chooseSourceLogo = (logoId: string) => {
    setSourceLogoId(logoId);
    const logo = detail?.logos.find((candidate) => String(candidate.id) === logoId);
    if (logo) setAltText(logo.alt_text);
  };

  const assignLogo = async (event: React.FormEvent) => {
    event.preventDefault();
    if ((mode === "reuse" && !sourceLogoId) || (mode === "upload" && !image)) return;
    setSaving(true);
    setError("");
    setMessage("");
    const target = scopePayload(targetScope);
    try {
      const response =
        mode === "reuse"
          ? await postJson<TeamLogoDetail>(`/api/admin/teams/${teamId}/logos/reuse`, {
              source_logo_id: Number(sourceLogoId),
              ...target,
              alt_text: altText,
            })
          : await (() => {
              const body = new FormData();
              if (image) body.set("image", image);
              if (target.season_id) body.set("season_id", String(target.season_id));
              if (target.team_season_entry_id) {
                body.set("team_season_entry_id", String(target.team_season_entry_id));
              }
              body.set("alt_text", altText);
              return postFormData<TeamLogoDetail>(`/api/admin/teams/${teamId}/logos`, body);
            })();
      setDetail(response);
      setImage(null);
      if (imageInputRef.current) imageInputRef.current.value = "";
      const activeTargetLogo = response.logos.find(
        (logo) => logo.is_active && logoMatchesScope(logo, targetScope)
      );
      if (activeTargetLogo) setSourceLogoId(String(activeTargetLogo.id));
      setMessage("Logo assignment saved for the selected scope.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not assign the team logo.");
    } finally {
      setSaving(false);
    }
  };

  const updateLogo = async (logo: TeamLogo, changes: Record<string, unknown>) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await patchJson<TeamLogoDetail>(
        `/api/admin/teams/${teamId}/logos/${logo.id}`,
        changes
      );
      setDetail(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the team logo.");
    } finally {
      setSaving(false);
    }
  };

  const editAltText = (logo: TeamLogo) => {
    const next = window.prompt("Logo alt text", logo.alt_text)?.trim();
    if (next && next !== logo.alt_text) void updateLogo(logo, { alt_text: next });
  };

  const startReuse = (logo: TeamLogo) => {
    setMode("reuse");
    chooseSourceLogo(String(logo.id));
    assignmentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading) return <p className="mt-5 text-gray-400">Loading team logos…</p>;

  return (
    <div className="mt-5 space-y-5">
      <div
        ref={assignmentRef}
        className="scroll-mt-6 rounded border border-blue-300/20 bg-blue-950/20 p-4"
      >
        <p className="text-xs font-bold uppercase tracking-wider text-blue-300">Logo assignment</p>
        <h3 className="mt-1 text-lg font-bold text-blue-100">Set the logo for a specific entry</h3>
        <p className="mt-1 text-sm text-gray-400">
          Pick the exact season and division entry first, then reuse an image already on this team
          or upload a new one. Entry logos override season-wide and career logos.
        </p>

        <form onSubmit={assignLogo} className="mt-4 space-y-4">
          <label className="block text-sm font-bold text-gray-200">
            Team entry to update
            <select
              value={targetScope}
              onChange={(event) => setTargetScope(event.target.value)}
              className={inputClass}
            >
              <optgroup label="Specific season and division">
                {detail?.season_entries.map((entry) => (
                  <option key={entry.id} value={`entry:${entry.id}`}>
                    {entryLabel(entry)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Fallback logos">
                {detail?.seasons.map((season) => (
                  <option key={season.id} value={`season:${season.id}`}>
                    {season.league.toUpperCase()} {season.season.toUpperCase()} — all divisions
                  </option>
                ))}
                <option value="career">Default / career — all seasons</option>
              </optgroup>
            </select>
            <span className="mt-2 block text-xs font-normal text-gray-400">
              {explicitTargetLogo
                ? `Current explicit logo: ${explicitTargetLogo.alt_text}`
                : "No explicit logo is set here; this scope currently uses a broader fallback."}
            </span>
          </label>

          <fieldset>
            <legend className="text-sm font-bold text-gray-200">Choose the image</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-3 rounded border border-white/15 bg-black/25 p-3">
                <input
                  type="radio"
                  name="logo-mode"
                  value="reuse"
                  checked={mode === "reuse"}
                  disabled={!detail?.logos.length}
                  onChange={() => setMode("reuse")}
                />
                <span>
                  <span className="block font-bold text-white">Reuse existing</span>
                  <span className="text-xs text-gray-400">No duplicate upload needed</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded border border-white/15 bg-black/25 p-3">
                <input
                  type="radio"
                  name="logo-mode"
                  value="upload"
                  checked={mode === "upload"}
                  onChange={() => setMode("upload")}
                />
                <span>
                  <span className="block font-bold text-white">Upload new</span>
                  <span className="text-xs text-gray-400">PNG, JPEG, or WebP</span>
                </span>
              </label>
            </div>
          </fieldset>

          {mode === "reuse" ? (
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-end">
              <label className="text-sm font-bold text-gray-200">
                Existing team logo
                <select
                  required
                  value={sourceLogoId}
                  onChange={(event) => chooseSourceLogo(event.target.value)}
                  className={inputClass}
                >
                  <option value="">Select a logo</option>
                  {detail?.logos.map((logo) => (
                    <option key={logo.id} value={logo.id}>
                      {logoScopeLabel(logo)} · {logo.is_active ? "Active" : "Inactive"} —{" "}
                      {logo.alt_text}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex h-28 items-center justify-center rounded border border-white/15 bg-white/10 p-2">
                {selectedLogo ? (
                  <img
                    src={resolveAssetUrl(selectedLogo.url)}
                    alt={selectedLogo.alt_text}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-center text-xs text-gray-500">Choose a preview</span>
                )}
              </div>
            </div>
          ) : (
            <label className="block text-sm font-bold text-gray-200">
              New logo image
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                required
                onChange={(event) => setImage(event.target.files?.[0] ?? null)}
                className={`${inputClass} py-2`}
              />
            </label>
          )}

          <label className="block text-sm font-bold text-gray-200">
            Alt text
            <input
              value={altText}
              onChange={(event) => setAltText(event.target.value)}
              placeholder={`${detail?.team.canonical_name ?? "Team"} logo`}
              className={inputClass}
            />
          </label>

          <button
            type="submit"
            disabled={saving || (mode === "reuse" ? !sourceLogoId : !image)}
            className="rounded bg-emerald-500 px-4 py-2 font-bold text-black disabled:opacity-40"
          >
            {saving
              ? "Saving…"
              : mode === "reuse"
                ? "Assign selected logo"
                : "Upload and assign logo"}
          </button>
        </form>
      </div>

      {error ? (
        <p role="alert" className="border border-red-500/40 bg-red-950/40 p-3 text-red-200">
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="border border-emerald-500/40 bg-emerald-950/40 p-3 text-emerald-200"
        >
          {message}
        </p>
      ) : null}

      <section>
        <h3 className="text-lg font-bold">Available logos and history</h3>
        <p className="mt-1 text-sm text-gray-400">
          Reuse any image below for another entry, including inactive historical logos.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {detail?.logos.length ? (
            detail.logos.map((logo) => (
              <article
                key={logo.id}
                className={`rounded border p-4 ${
                  logo.is_active
                    ? "border-emerald-400/50 bg-emerald-950/20"
                    : "border-white/10 bg-black/30"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded bg-white/10 p-2">
                    <img
                      src={resolveAssetUrl(logo.url)}
                      alt={logo.alt_text}
                      loading="lazy"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold">{logoScopeLabel(logo)}</p>
                    <p className="mt-1 break-words text-sm text-gray-300">{logo.alt_text}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {logo.is_active ? "Active" : "Inactive"} · {logo.source}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => startReuse(logo)}
                    className="rounded border border-blue-400/40 px-3 py-2 text-sm text-blue-200"
                  >
                    Reuse for another entry
                  </button>
                  {!logo.is_active ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void updateLogo(logo, { is_active: true })}
                      className="rounded border border-emerald-400/40 px-3 py-2 text-sm text-emerald-300"
                    >
                      Make active here
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void updateLogo(logo, { is_active: false })}
                      className="rounded border border-amber-400/40 px-3 py-2 text-sm text-amber-200"
                    >
                      Deactivate
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => editAltText(logo)}
                    className="rounded border border-white/20 px-3 py-2 text-sm text-gray-200"
                  >
                    Edit alt text
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="py-6 text-gray-400 sm:col-span-2">No logos have been uploaded.</p>
          )}
        </div>
      </section>
    </div>
  );
}

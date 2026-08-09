import { useEffect, useRef, useState } from "react";

import { fetchJson, patchJson, postFormData, resolveAssetUrl } from "../../api";

type LogoSeason = {
  id: number;
  league: string;
  season: string;
  name: string;
  season_number: number | null;
};

type TeamLogo = {
  id: number;
  season: LogoSeason | null;
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
  logos: TeamLogo[];
};

export default function TeamLogoManager({ teamId }: { teamId: number }): React.JSX.Element {
  const [detail, setDetail] = useState<TeamLogoDetail | null>(null);
  const [seasonId, setSeasonId] = useState("");
  const [altText, setAltText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchJson<TeamLogoDetail>(`/api/admin/teams/${teamId}/logos`)
      .then((response) => {
        if (!cancelled) setDetail(response);
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

  const uploadLogo = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!image) return;
    setSaving(true);
    setError("");
    const body = new FormData();
    body.set("image", image);
    body.set("season_id", seasonId);
    body.set("alt_text", altText);
    try {
      const response = await postFormData<TeamLogoDetail>(`/api/admin/teams/${teamId}/logos`, body);
      setDetail(response);
      setImage(null);
      setAltText("");
      formRef.current?.reset();
      setSeasonId("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload the team logo.");
    } finally {
      setSaving(false);
    }
  };

  const updateLogo = async (logo: TeamLogo, changes: Record<string, unknown>) => {
    setSaving(true);
    setError("");
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

  if (loading) return <p className="mt-5 text-gray-400">Loading team logos…</p>;

  return (
    <div className="mt-5 space-y-5">
      <div className="rounded border border-blue-300/20 bg-blue-950/20 p-4">
        <h3 className="text-lg font-bold text-blue-100">Upload team logo</h3>
        <p className="mt-1 text-sm text-gray-400">
          A season logo overrides the default for that season. Uploading a replacement makes the new
          image active and keeps the previous image as inactive history.
        </p>
        <form ref={formRef} onSubmit={uploadLogo} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold text-gray-200">
            Logo scope
            <select
              value={seasonId}
              onChange={(event) => setSeasonId(event.target.value)}
              className="mt-2 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3"
            >
              <option value="">Default / career logo</option>
              {detail?.seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.league.toUpperCase()} · {season.name} ({season.season.toUpperCase()})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold text-gray-200">
            Image
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
              onChange={(event) => setImage(event.target.files?.[0] ?? null)}
              className="mt-2 block min-h-11 w-full rounded border border-white/20 bg-black/50 px-3 py-2"
            />
          </label>
          <label className="text-sm font-bold text-gray-200 sm:col-span-2">
            Alt text
            <input
              value={altText}
              onChange={(event) => setAltText(event.target.value)}
              placeholder={`${detail?.team.canonical_name ?? "Team"} logo`}
              className="mt-2 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={saving || !image}
              className="rounded bg-emerald-500 px-4 py-2 font-bold text-black disabled:opacity-40"
            >
              {saving ? "Uploading…" : "Upload and activate"}
            </button>
          </div>
        </form>
      </div>

      {error ? (
        <p className="border border-red-500/40 bg-red-950/40 p-3 text-red-200">{error}</p>
      ) : null}

      <section>
        <h3 className="text-lg font-bold">Logo history</h3>
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
                    <p className="font-bold">
                      {logo.season
                        ? `${logo.season.name} (${logo.season.season.toUpperCase()})`
                        : "Default / career"}
                    </p>
                    <p className="mt-1 break-words text-sm text-gray-300">{logo.alt_text}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {logo.is_active ? "Active" : "Inactive"} · {logo.source}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!logo.is_active ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void updateLogo(logo, { is_active: true })}
                      className="rounded border border-emerald-400/40 px-3 py-2 text-sm text-emerald-300"
                    >
                      Make active
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

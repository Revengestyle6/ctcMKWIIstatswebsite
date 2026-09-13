import { useEffect, useMemo, useRef, useState } from "react";

import { fetchJson, patchJson, postFormData, postJson, resolveAssetUrl } from "../../api";
import type { LeagueCode } from "../../config/leagues";

type SetupConference = { id: number; code: string; name: string; sort_order: number };
type SetupDivision = {
  id: number;
  code: string;
  name: string;
  is_conference_based: boolean;
  conferences: SetupConference[];
  playoff_team_count: number | null;
};
type SetupSeason = {
  id: number;
  league: string;
  code: string;
  number: number | null;
  name: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  divisions: SetupDivision[];
};
type SetupTeam = {
  id: number;
  canonical_name: string;
  canonical_tag: string;
  league_identities: Array<{ league: string; tag: string }>;
};
type SetupEntry = {
  id: number;
  team: SetupTeam;
  season: { id: number; code: string; name: string };
  division: SetupDivision;
  display_name: string;
  clan_tag: string;
  hex_color: string | null;
  competition_status: "active" | "dropped" | "disqualified";
  conference: SetupConference | null;
};
type SetupCatalog = {
  league: string;
  seasons: SetupSeason[];
  teams: SetupTeam[];
  entries: SetupEntry[];
};
type SetupMutation = { created_id: number; catalog: SetupCatalog };
type SetupUpdate = { updated_id: number; catalog: SetupCatalog };
type RegistrationLogo = {
  id: number;
  season: { id: number; league: string; season: string; name: string } | null;
  alt_text: string;
  is_active: boolean;
  source: "upload" | "static";
  url: string;
};
type RegistrationLogoDetail = {
  team: { id: number; canonical_name: string; canonical_tag: string };
  logos: RegistrationLogo[];
};

const inputClass =
  "mt-2 min-h-11 w-full rounded border border-white/20 bg-black/50 px-3 text-white focus:outline-none league-focus-ring";

export default function CompetitionSetupManager({
  league,
}: {
  league: LeagueCode;
}): React.JSX.Element {
  const [catalog, setCatalog] = useState<SetupCatalog | null>(null);
  const [divisionSeasonId, setDivisionSeasonId] = useState("");
  const [registrationSeasonId, setRegistrationSeasonId] = useState("");
  const [registrationDivisionId, setRegistrationDivisionId] = useState("");
  const [registrationTeamId, setRegistrationTeamId] = useState("");
  const [registrationLogoDetail, setRegistrationLogoDetail] =
    useState<RegistrationLogoDetail | null>(null);
  const [registrationLogoMode, setRegistrationLogoMode] = useState("none");
  const [registrationLogoScope, setRegistrationLogoScope] = useState("season");
  const [registrationExistingLogoId, setRegistrationExistingLogoId] = useState("");
  const [registrationLogoFile, setRegistrationLogoFile] = useState<File | null>(null);
  const [registrationLogoAltText, setRegistrationLogoAltText] = useState("");
  const [registrationLogosLoading, setRegistrationLogosLoading] = useState(false);
  const [registrationLogoError, setRegistrationLogoError] = useState("");
  const [browserSeasonId, setBrowserSeasonId] = useState("");
  const [browserDivisionId, setBrowserDivisionId] = useState("");
  const [seasonCode, setSeasonCode] = useState("");
  const [seasonName, setSeasonName] = useState("");
  const [seasonNumber, setSeasonNumber] = useState("");
  const [seasonStatus, setSeasonStatus] = useState("upcoming");
  const [seasonStartsOn, setSeasonStartsOn] = useState("");
  const [seasonEndsOn, setSeasonEndsOn] = useState("");
  const [divisionCode, setDivisionCode] = useState("");
  const [divisionName, setDivisionName] = useState("");
  const [divisionConferenceBased, setDivisionConferenceBased] = useState(false);
  const [divisionConferenceA, setDivisionConferenceA] = useState("Conference A");
  const [divisionConferenceB, setDivisionConferenceB] = useState("Conference B");
  const [divisionPlayoffTeams, setDivisionPlayoffTeams] = useState("3");
  const [teamName, setTeamName] = useState("");
  const [teamTag, setTeamTag] = useState("");
  const [entryName, setEntryName] = useState("");
  const [entryTag, setEntryTag] = useState("");
  const [entryColor, setEntryColor] = useState("");
  const [editSeasonId, setEditSeasonId] = useState("");
  const [editSeasonCode, setEditSeasonCode] = useState("");
  const [editSeasonNumber, setEditSeasonNumber] = useState("");
  const [editSeasonName, setEditSeasonName] = useState("");
  const [editSeasonStatus, setEditSeasonStatus] = useState("upcoming");
  const [editSeasonStartsOn, setEditSeasonStartsOn] = useState("");
  const [editSeasonEndsOn, setEditSeasonEndsOn] = useState("");
  const [editDivisionSeasonId, setEditDivisionSeasonId] = useState("");
  const [editDivisionId, setEditDivisionId] = useState("");
  const [editDivisionCode, setEditDivisionCode] = useState("");
  const [editDivisionName, setEditDivisionName] = useState("");
  const [editDivisionConferenceBased, setEditDivisionConferenceBased] = useState(false);
  const [editDivisionConferenceA, setEditDivisionConferenceA] = useState("Conference A");
  const [editDivisionConferenceB, setEditDivisionConferenceB] = useState("Conference B");
  const [editDivisionPlayoffTeams, setEditDivisionPlayoffTeams] = useState("3");
  const [editConferenceAssignments, setEditConferenceAssignments] = useState<
    Record<string, string>
  >({});
  const [registrationConferenceId, setRegistrationConferenceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const registrationLogoFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchJson<SetupCatalog>("/api/admin/competition-setup", { league })
      .then((response) => {
        if (cancelled) return;
        setCatalog(response);
        setDivisionSeasonId("");
        setRegistrationSeasonId("");
        setRegistrationDivisionId("");
        setRegistrationTeamId("");
        setRegistrationLogoDetail(null);
        setBrowserSeasonId("");
        setBrowserDivisionId("");
        setEditSeasonId("");
        setEditDivisionSeasonId("");
        setEditDivisionId("");
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load competition setup.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [league]);

  useEffect(() => {
    let cancelled = false;
    setRegistrationLogoDetail(null);
    setRegistrationLogoError("");
    if (!registrationTeamId) {
      setRegistrationLogosLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setRegistrationLogosLoading(true);
    fetchJson<RegistrationLogoDetail>(`/api/admin/teams/${registrationTeamId}/logos`)
      .then((response) => {
        if (!cancelled) setRegistrationLogoDetail(response);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setRegistrationLogoError(
            caught instanceof Error ? caught.message : "Could not load existing team logos."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setRegistrationLogosLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [registrationTeamId]);

  const divisionChoices = useMemo(
    () =>
      catalog?.seasons.flatMap((season) =>
        season.divisions.map((division) => ({ season, division }))
      ) ?? [],
    [catalog]
  );
  const latestSeasonNumber =
    catalog?.seasons.reduce((latest, season) => {
      const codeNumber = Number.parseInt(season.code.match(/^s(\d+)$/i)?.[1] ?? "", 10);
      const current = season.number ?? (Number.isNaN(codeNumber) ? 0 : codeNumber);
      return Math.max(latest, current);
    }, 0) ?? 0;
  const suggestedSeasonNumber = latestSeasonNumber + 1;
  const registrationDivision = useMemo(
    () =>
      divisionChoices.find((choice) => String(choice.division.id) === registrationDivisionId) ??
      null,
    [divisionChoices, registrationDivisionId]
  );
  const registrationSeason = useMemo(
    () => catalog?.seasons.find((season) => String(season.id) === registrationSeasonId) ?? null,
    [catalog, registrationSeasonId]
  );
  const browserDivision = useMemo(
    () =>
      divisionChoices.find((choice) => String(choice.division.id) === browserDivisionId) ?? null,
    [browserDivisionId, divisionChoices]
  );
  const browserSeason = useMemo(
    () => catalog?.seasons.find((season) => String(season.id) === browserSeasonId) ?? null,
    [browserSeasonId, catalog]
  );
  const browserEntries = useMemo(
    () => catalog?.entries.filter((entry) => String(entry.division.id) === browserDivisionId) ?? [],
    [browserDivisionId, catalog]
  );
  const editDivisionSeason = useMemo(
    () => catalog?.seasons.find((season) => String(season.id) === editDivisionSeasonId) ?? null,
    [catalog, editDivisionSeasonId]
  );
  const editDivisionEntries = useMemo(
    () => catalog?.entries.filter((entry) => String(entry.division.id) === editDivisionId) ?? [],
    [catalog, editDivisionId]
  );
  const registeredTeamIds = useMemo(
    () =>
      new Set(
        registrationDivision
          ? (catalog?.entries
              .filter((entry) => entry.season.id === registrationDivision.season.id)
              .map((entry) => entry.team.id) ?? [])
          : []
      ),
    [catalog, registrationDivision]
  );
  const selectedRegistrationLogo = useMemo(
    () =>
      registrationLogoDetail?.logos.find(
        (logo) => String(logo.id) === registrationExistingLogoId
      ) ?? null,
    [registrationExistingLogoId, registrationLogoDetail]
  );
  const registrationLogoReady =
    registrationLogoMode === "none" ||
    (registrationLogoAltText.trim() !== "" &&
      ((registrationLogoMode === "existing" && registrationExistingLogoId !== "") ||
        (registrationLogoMode === "upload" && registrationLogoFile !== null)));

  const beginMutation = (action: string) => {
    setSaving(action);
    setError("");
    setNotice("");
  };

  const createSeason = async (event: React.FormEvent) => {
    event.preventDefault();
    beginMutation("season");
    try {
      const response = await postJson<SetupMutation>("/api/admin/competition-setup/seasons", {
        league,
        code: seasonCode,
        name: seasonName,
        number: seasonNumber || null,
        status: seasonStatus,
        starts_on: seasonStartsOn || null,
        ends_on: seasonEndsOn || null,
      });
      setCatalog(response.catalog);
      setSeasonCode("");
      setSeasonName("");
      setSeasonNumber("");
      setSeasonStartsOn("");
      setSeasonEndsOn("");
      setNotice("Season created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the season.");
    } finally {
      setSaving("");
    }
  };

  const createDivision = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!divisionSeasonId) return;
    beginMutation("division");
    try {
      const response = await postJson<SetupMutation>("/api/admin/competition-setup/divisions", {
        season_id: Number(divisionSeasonId),
        code: divisionCode,
        name: divisionName,
        is_conference_based: divisionConferenceBased,
        conference_names: { a: divisionConferenceA, b: divisionConferenceB },
        playoff_team_count: divisionConferenceBased ? 4 : Number(divisionPlayoffTeams),
      });
      setCatalog(response.catalog);
      setDivisionCode("");
      setDivisionName("");
      setDivisionConferenceBased(false);
      setDivisionPlayoffTeams("3");
      setNotice("Division created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the division.");
    } finally {
      setSaving("");
    }
  };

  const createTeam = async (event: React.FormEvent) => {
    event.preventDefault();
    beginMutation("team");
    try {
      const response = await postJson<SetupMutation>("/api/admin/competition-setup/teams", {
        league,
        canonical_name: teamName,
        canonical_tag: teamTag,
      });
      setCatalog(response.catalog);
      setTeamName("");
      setTeamTag("");
      setNotice("Canonical team created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the team.");
    } finally {
      setSaving("");
    }
  };

  const registerTeam = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!registrationTeamId || !registrationDivision) return;
    beginMutation("entry");
    try {
      const body = new FormData();
      body.set("team_id", registrationTeamId);
      body.set("season_id", String(registrationDivision.season.id));
      body.set("division_id", String(registrationDivision.division.id));
      body.set("conference_id", registrationConferenceId);
      body.set("display_name", entryName);
      body.set("clan_tag", entryTag);
      body.set("hex_color", entryColor);
      body.set("logo_mode", registrationLogoMode);
      body.set("logo_scope", registrationLogoScope);
      body.set("alt_text", registrationLogoAltText);
      if (registrationLogoMode === "existing") {
        body.set("existing_logo_id", registrationExistingLogoId);
      } else if (registrationLogoMode === "upload" && registrationLogoFile) {
        body.set("image", registrationLogoFile);
      }
      const response = await postFormData<SetupMutation>(
        "/api/admin/competition-setup/team-season-entries/with-logo",
        body
      );
      setCatalog(response.catalog);
      setEntryColor("");
      setRegistrationLogoMode("none");
      setRegistrationExistingLogoId("");
      setRegistrationLogoFile(null);
      if (registrationLogoFileRef.current) registrationLogoFileRef.current.value = "";
      setNotice(
        registrationLogoMode === "none"
          ? "Team registered for the selected division."
          : "Team registered and its initial logo was configured."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not register the team.");
    } finally {
      setSaving("");
    }
  };

  const chooseSeasonToEdit = (nextSeasonId: string) => {
    setEditSeasonId(nextSeasonId);
    const season = catalog?.seasons.find((candidate) => String(candidate.id) === nextSeasonId);
    setEditSeasonCode(season?.code ?? "");
    setEditSeasonNumber(season?.number === null || !season ? "" : String(season.number));
    setEditSeasonName(season?.name ?? "");
    setEditSeasonStatus(season?.status ?? "upcoming");
    setEditSeasonStartsOn(season?.starts_on ?? "");
    setEditSeasonEndsOn(season?.ends_on ?? "");
  };

  const saveSeason = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editSeasonId) return;
    beginMutation("edit-season");
    try {
      const response = await patchJson<SetupUpdate>(
        `/api/admin/competition-setup/seasons/${editSeasonId}`,
        {
          code: editSeasonCode,
          number: editSeasonNumber || null,
          name: editSeasonName,
          status: editSeasonStatus,
          starts_on: editSeasonStartsOn || null,
          ends_on: editSeasonEndsOn || null,
        }
      );
      setCatalog(response.catalog);
      setNotice("Season metadata updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the season.");
    } finally {
      setSaving("");
    }
  };

  const chooseDivisionToEdit = (nextDivisionId: string) => {
    setEditDivisionId(nextDivisionId);
    const choice = divisionChoices.find(
      (candidate) => String(candidate.division.id) === nextDivisionId
    );
    setEditDivisionCode(choice?.division.code ?? "");
    setEditDivisionName(choice?.division.name ?? "");
    setEditDivisionConferenceBased(choice?.division.is_conference_based ?? false);
    setEditDivisionConferenceA(
      choice?.division.conferences?.find((conference) => conference.code === "a")?.name ??
        "Conference A"
    );
    setEditDivisionConferenceB(
      choice?.division.conferences?.find((conference) => conference.code === "b")?.name ??
        "Conference B"
    );
    setEditDivisionPlayoffTeams(
      choice?.division.playoff_team_count ? String(choice.division.playoff_team_count) : "3"
    );
    setEditConferenceAssignments(
      Object.fromEntries(
        (catalog?.entries ?? [])
          .filter((entry) => entry.division.id === choice?.division.id)
          .map((entry) => [String(entry.id), entry.conference?.code ?? ""])
      )
    );
  };

  const chooseDivisionSeasonToEdit = (nextSeasonId: string) => {
    setEditDivisionSeasonId(nextSeasonId);
    setEditDivisionId("");
    setEditDivisionCode("");
    setEditDivisionName("");
    setEditDivisionConferenceBased(false);
    setEditDivisionPlayoffTeams("3");
    setEditConferenceAssignments({});
  };

  const saveDivision = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editDivisionId) return;
    beginMutation("edit-division");
    try {
      const response = await patchJson<SetupUpdate>(
        `/api/admin/competition-setup/divisions/${editDivisionId}`,
        {
          code: editDivisionCode,
          name: editDivisionName,
          is_conference_based: editDivisionConferenceBased,
          conference_names: {
            a: editDivisionConferenceA,
            b: editDivisionConferenceB,
          },
          playoff_team_count: editDivisionConferenceBased ? 4 : Number(editDivisionPlayoffTeams),
          conference_assignments: editDivisionConferenceBased
            ? editConferenceAssignments
            : undefined,
        }
      );
      setCatalog(response.catalog);
      setNotice("Division metadata updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the division.");
    } finally {
      setSaving("");
    }
  };

  const chooseRegistrationTeam = (nextTeamId: string) => {
    setRegistrationTeamId(nextTeamId);
    setRegistrationLogoMode("none");
    setRegistrationLogoScope("season");
    setRegistrationExistingLogoId("");
    setRegistrationLogoFile(null);
    setRegistrationLogoError("");
    if (registrationLogoFileRef.current) registrationLogoFileRef.current.value = "";
    const team = catalog?.teams.find((candidate) => String(candidate.id) === nextTeamId);
    if (!team) {
      setEntryName("");
      setEntryTag("");
      setRegistrationLogoAltText("");
      return;
    }
    const leagueIdentity = team.league_identities.find((identity) => identity.league === league);
    setEntryName(team.canonical_name);
    setEntryTag(leagueIdentity?.tag ?? team.canonical_tag);
    setRegistrationLogoAltText(`${team.canonical_name} logo`);
  };

  const chooseRegistrationSeason = (nextSeasonId: string) => {
    setRegistrationSeasonId(nextSeasonId);
    setRegistrationDivisionId("");
    setRegistrationConferenceId("");
    setRegistrationLogoMode("none");
    setRegistrationExistingLogoId("");
    setRegistrationLogoFile(null);
    if (registrationLogoFileRef.current) registrationLogoFileRef.current.value = "";
  };

  const chooseRegistrationDivision = (nextDivisionId: string) => {
    setRegistrationDivisionId(nextDivisionId);
    setRegistrationConferenceId("");
  };

  const chooseExistingRegistrationLogo = (nextLogoId: string) => {
    setRegistrationExistingLogoId(nextLogoId);
    const logo = registrationLogoDetail?.logos.find(
      (candidate) => String(candidate.id) === nextLogoId
    );
    if (logo) setRegistrationLogoAltText(logo.alt_text);
  };

  if (loading) return <p className="text-gray-400">Loading competition setup…</p>;

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-white/10 bg-black/25 p-3 text-sm text-gray-300">
        Each action saves independently. Use only the action you need now and return to the others
        whenever the league is ready.
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <form
          onSubmit={createSeason}
          className="rounded-lg border border-blue-300/20 bg-blue-950/15 p-4"
        >
          <p className="text-xs font-bold uppercase tracking-wider text-blue-200">Season action</p>
          <h3 className="mt-1 text-lg font-bold">Create a season</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold text-gray-200">
              Season code
              <input
                required
                value={seasonCode}
                onChange={(event) => setSeasonCode(event.target.value)}
                placeholder={`s${suggestedSeasonNumber}`}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-bold text-gray-200">
              Season number
              <input
                type="number"
                min="1"
                value={seasonNumber}
                onChange={(event) => setSeasonNumber(event.target.value)}
                placeholder="Inferred from code"
                className={inputClass}
              />
            </label>
            <label className="text-sm font-bold text-gray-200 sm:col-span-2">
              Display name
              <input
                required
                value={seasonName}
                onChange={(event) => setSeasonName(event.target.value)}
                placeholder={`${league.toUpperCase()} Season ${suggestedSeasonNumber}`}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-bold text-gray-200 sm:col-span-2">
              Status
              <select
                value={seasonStatus}
                onChange={(event) => setSeasonStatus(event.target.value)}
                className={inputClass}
              >
                <option value="upcoming">Upcoming</option>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
              </select>
            </label>
            <label className="text-sm font-bold text-gray-200">
              Start date
              <input
                type="date"
                value={seasonStartsOn}
                onChange={(event) => setSeasonStartsOn(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-bold text-gray-200">
              End date
              <input
                type="date"
                min={seasonStartsOn || undefined}
                value={seasonEndsOn}
                onChange={(event) => setSeasonEndsOn(event.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={saving !== ""}
            className="mt-4 rounded bg-blue-500 px-4 py-2 font-bold disabled:opacity-40"
          >
            {saving === "season" ? "Creating…" : "Create season"}
          </button>
        </form>

        <form
          onSubmit={createDivision}
          className="rounded-lg border border-cyan-300/20 bg-cyan-950/15 p-4"
        >
          <p className="text-xs font-bold uppercase tracking-wider text-cyan-200">
            Division action
          </p>
          <h3 className="mt-1 text-lg font-bold">Create a division</h3>
          <label className="mt-3 block text-sm font-bold text-gray-200">
            Season
            <select
              required
              value={divisionSeasonId}
              onChange={(event) => setDivisionSeasonId(event.target.value)}
              className={inputClass}
            >
              <option value="">Select a season</option>
              {catalog?.seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name} ({season.code.toUpperCase()})
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold text-gray-200">
              Division code
              <input
                required
                value={divisionCode}
                onChange={(event) => setDivisionCode(event.target.value)}
                placeholder="d1"
                className={inputClass}
              />
            </label>
            <label className="text-sm font-bold text-gray-200">
              Display name
              <input
                required
                value={divisionName}
                onChange={(event) => setDivisionName(event.target.value)}
                placeholder="Division 1"
                className={inputClass}
              />
            </label>
          </div>
          <label className="mt-4 flex items-start gap-3 rounded border border-white/10 bg-black/20 p-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={divisionConferenceBased}
              onChange={(event) => setDivisionConferenceBased(event.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              <strong className="block">Conference-based division</strong>
              Creates two conferences of four teams and locks playoffs to four teams.
            </span>
          </label>
          {divisionConferenceBased ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-bold text-gray-200">
                Conference A name
                <input
                  required
                  value={divisionConferenceA}
                  onChange={(event) => setDivisionConferenceA(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="text-sm font-bold text-gray-200">
                Conference B name
                <input
                  required
                  value={divisionConferenceB}
                  onChange={(event) => setDivisionConferenceB(event.target.value)}
                  className={inputClass}
                />
              </label>
            </div>
          ) : (
            <label className="mt-3 block text-sm font-bold text-gray-200">
              Playoff qualifiers
              <select
                value={divisionPlayoffTeams}
                onChange={(event) => setDivisionPlayoffTeams(event.target.value)}
                className={inputClass}
              >
                <option value="3">3 teams</option>
                <option value="4">4 teams</option>
              </select>
              <span className="mt-1 block text-xs font-normal text-gray-400">
                Five- and six-team divisions can switch this after the preseason vote.
              </span>
            </label>
          )}
          <button
            type="submit"
            disabled={saving !== "" || !divisionSeasonId}
            className="mt-4 rounded bg-cyan-500 px-4 py-2 font-bold text-black disabled:opacity-40"
          >
            {saving === "division" ? "Creating…" : "Create division"}
          </button>
        </form>

        <form
          onSubmit={createTeam}
          className="rounded-lg border border-violet-300/20 bg-violet-950/15 p-4"
        >
          <p className="text-xs font-bold uppercase tracking-wider text-violet-200">Team action</p>
          <h3 className="mt-1 text-lg font-bold">Create a canonical team</h3>
          <p className="mt-1 text-sm text-gray-400">
            This creates the organization only. Register it for a division separately when needed.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold text-gray-200">
              Canonical name
              <input
                required
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="Team name"
                className={inputClass}
              />
            </label>
            <label className="text-sm font-bold text-gray-200">
              Canonical tag
              <input
                required
                value={teamTag}
                onChange={(event) => setTeamTag(event.target.value)}
                placeholder="TAG"
                className={inputClass}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={saving !== "" || !teamName.trim() || !teamTag.trim()}
            className="mt-4 rounded bg-violet-500 px-4 py-2 font-bold disabled:opacity-40"
          >
            {saving === "team" ? "Creating…" : "Create team"}
          </button>
        </form>

        <form
          onSubmit={registerTeam}
          className="rounded-lg border border-emerald-300/20 bg-emerald-950/15 p-4"
        >
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-200">
            Registration action
          </p>
          <h3 className="mt-1 text-lg font-bold">Register a team for a division</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold text-gray-200">
              Season
              <select
                required
                value={registrationSeasonId}
                onChange={(event) => chooseRegistrationSeason(event.target.value)}
                className={inputClass}
              >
                <option value="">Select a season</option>
                {catalog?.seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name} ({season.code.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold text-gray-200">
              Division
              <select
                required
                disabled={!registrationSeason}
                value={registrationDivisionId}
                onChange={(event) => chooseRegistrationDivision(event.target.value)}
                className={inputClass}
              >
                <option value="">
                  {registrationSeason ? "Select a division" : "Select a season first"}
                </option>
                {registrationSeason?.divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name} ({division.code.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>
            {registrationDivision?.division.is_conference_based ? (
              <label className="text-sm font-bold text-gray-200 sm:col-span-2">
                Conference
                <select
                  required
                  value={registrationConferenceId}
                  onChange={(event) => setRegistrationConferenceId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">Select a conference</option>
                  {registrationDivision.division.conferences.map((conference) => (
                    <option key={conference.id} value={conference.id}>
                      {conference.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="text-sm font-bold text-gray-200 sm:col-span-2">
              Team
              <select
                required
                value={registrationTeamId}
                onChange={(event) => chooseRegistrationTeam(event.target.value)}
                className={inputClass}
              >
                <option value="">Select a team</option>
                {catalog?.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.canonical_tag} — {team.canonical_name}
                    {registeredTeamIds.has(team.id) ? " (already registered this season)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold text-gray-200">
              Season display name
              <input
                required
                value={entryName}
                onChange={(event) => setEntryName(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-bold text-gray-200">
              Season tag
              <input
                required
                value={entryTag}
                onChange={(event) => setEntryTag(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-bold text-gray-200 sm:col-span-2">
              Team color
              <input
                type="text"
                pattern="#[0-9a-fA-F]{6}"
                value={entryColor}
                onChange={(event) => setEntryColor(event.target.value)}
                placeholder="#3B82F6"
                className={inputClass}
              />
            </label>
          </div>
          <fieldset className="mt-4 border-t border-emerald-200/15 pt-4">
            <legend className="px-1 text-sm font-bold text-emerald-100">Initial logo</legend>
            <p className="mt-1 text-sm text-gray-400">
              Optional. This is only for the moment a team is initially added to a division. Use
              Alias Management for later logo changes.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-bold text-gray-200">
                Logo choice
                <select
                  value={registrationLogoMode}
                  disabled={!registrationTeamId || !registrationDivision}
                  onChange={(event) => {
                    setRegistrationLogoMode(event.target.value);
                    setRegistrationExistingLogoId("");
                    setRegistrationLogoFile(null);
                    if (registrationLogoFileRef.current) {
                      registrationLogoFileRef.current.value = "";
                    }
                  }}
                  className={inputClass}
                >
                  <option value="none">Keep current logo setup</option>
                  <option value="existing" disabled={!registrationLogoDetail?.logos.length}>
                    Use an existing logo
                  </option>
                  <option value="upload">Upload a new logo</option>
                </select>
              </label>

              {registrationLogoMode !== "none" ? (
                <label className="text-sm font-bold text-gray-200">
                  Logo scope
                  <select
                    value={registrationLogoScope}
                    onChange={(event) => setRegistrationLogoScope(event.target.value)}
                    className={inputClass}
                  >
                    <option value="season">
                      This season
                      {registrationDivision ? ` — ${registrationDivision.season.name}` : ""}
                    </option>
                    <option value="career">Default / career logo</option>
                  </select>
                </label>
              ) : null}

              {registrationLogoMode === "existing" ? (
                <label className="text-sm font-bold text-gray-200 sm:col-span-2">
                  Existing logo
                  <select
                    required
                    value={registrationExistingLogoId}
                    onChange={(event) => chooseExistingRegistrationLogo(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select an existing logo</option>
                    {registrationLogoDetail?.logos.map((logo) => (
                      <option key={logo.id} value={logo.id}>
                        {logo.season
                          ? `${logo.season.league.toUpperCase()} · ${logo.season.name}`
                          : "Default / career"}
                        {logo.is_active ? " · Active" : " · Inactive"} — {logo.alt_text}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {registrationLogoMode === "upload" ? (
                <label className="text-sm font-bold text-gray-200 sm:col-span-2">
                  Logo image
                  <input
                    ref={registrationLogoFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    required
                    onChange={(event) => setRegistrationLogoFile(event.target.files?.[0] ?? null)}
                    className={`${inputClass} py-2`}
                  />
                </label>
              ) : null}

              {registrationLogoMode !== "none" ? (
                <label className="text-sm font-bold text-gray-200 sm:col-span-2">
                  Logo alt text
                  <input
                    required
                    value={registrationLogoAltText}
                    onChange={(event) => setRegistrationLogoAltText(event.target.value)}
                    placeholder="Describe the team logo"
                    className={inputClass}
                  />
                </label>
              ) : null}
            </div>

            {registrationLogosLoading ? (
              <p className="mt-3 text-sm text-gray-400">Loading existing logos…</p>
            ) : null}
            {registrationLogoError ? (
              <p role="alert" className="mt-3 text-sm text-red-200">
                {registrationLogoError}
              </p>
            ) : null}
            {selectedRegistrationLogo ? (
              <div className="mt-3 flex items-center gap-3 rounded border border-white/10 bg-black/25 p-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-white/10 p-2">
                  <img
                    src={resolveAssetUrl(selectedRegistrationLogo.url)}
                    alt={selectedRegistrationLogo.alt_text}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <p className="text-sm text-gray-300">
                  This image will be reused; the original logo remains available in its current
                  scope.
                </p>
              </div>
            ) : null}
          </fieldset>
          <button
            type="submit"
            disabled={
              saving !== "" ||
              !registrationTeamId ||
              !registrationDivision ||
              (registrationDivision.division.is_conference_based && !registrationConferenceId) ||
              !registrationLogoReady ||
              registeredTeamIds.has(Number(registrationTeamId))
            }
            className="mt-4 rounded bg-emerald-500 px-4 py-2 font-bold text-black disabled:opacity-40"
          >
            {saving === "entry" ? "Registering…" : "Register team"}
          </button>
        </form>
      </div>

      <section className="rounded-lg border border-white/15 bg-zinc-950/60 p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-amber-200">
          Existing structure
        </p>
        <h3 className="mt-1 text-lg font-bold">Edit season and division metadata</h3>
        <p className="mt-1 text-sm text-gray-400">
          Update either record independently. League ownership and division placement stay fixed to
          protect existing registrations and match data.
        </p>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <form
            onSubmit={saveSeason}
            className="rounded-lg border border-blue-300/20 bg-black/25 p-4"
          >
            <p className="text-xs font-bold uppercase tracking-wider text-blue-200">
              Season maintenance
            </p>
            <h4 className="mt-1 text-lg font-bold">Edit a season</h4>
            <label className="mt-3 block text-sm font-bold text-gray-200">
              Existing season
              <select
                required
                value={editSeasonId}
                onChange={(event) => chooseSeasonToEdit(event.target.value)}
                className={inputClass}
              >
                <option value="">Select a season</option>
                {catalog?.seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name} ({season.code.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-bold text-gray-200">
                Season code
                <input
                  required
                  disabled={!editSeasonId}
                  value={editSeasonCode}
                  onChange={(event) => setEditSeasonCode(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="text-sm font-bold text-gray-200">
                Season number
                <input
                  type="number"
                  min="1"
                  disabled={!editSeasonId}
                  value={editSeasonNumber}
                  onChange={(event) => setEditSeasonNumber(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="text-sm font-bold text-gray-200 sm:col-span-2">
                Display name
                <input
                  required
                  disabled={!editSeasonId}
                  value={editSeasonName}
                  onChange={(event) => setEditSeasonName(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="text-sm font-bold text-gray-200 sm:col-span-2">
                Status
                <select
                  disabled={!editSeasonId}
                  value={editSeasonStatus}
                  onChange={(event) => setEditSeasonStatus(event.target.value)}
                  className={inputClass}
                >
                  <option value="unknown">Unknown</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active</option>
                  <option value="complete">Complete</option>
                </select>
              </label>
              <label className="text-sm font-bold text-gray-200">
                Start date
                <input
                  type="date"
                  disabled={!editSeasonId}
                  value={editSeasonStartsOn}
                  onChange={(event) => setEditSeasonStartsOn(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="text-sm font-bold text-gray-200">
                End date
                <input
                  type="date"
                  min={editSeasonStartsOn || undefined}
                  disabled={!editSeasonId}
                  value={editSeasonEndsOn}
                  onChange={(event) => setEditSeasonEndsOn(event.target.value)}
                  className={inputClass}
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={saving !== "" || !editSeasonId}
              className="mt-4 rounded bg-blue-500 px-4 py-2 font-bold disabled:opacity-40"
            >
              {saving === "edit-season" ? "Saving…" : "Save season"}
            </button>
          </form>

          <form
            onSubmit={saveDivision}
            className="rounded-lg border border-cyan-300/20 bg-black/25 p-4"
          >
            <p className="text-xs font-bold uppercase tracking-wider text-cyan-200">
              Division maintenance
            </p>
            <h4 className="mt-1 text-lg font-bold">Edit a division</h4>
            <label className="mt-3 block text-sm font-bold text-gray-200">
              Existing season
              <select
                required
                value={editDivisionSeasonId}
                onChange={(event) => chooseDivisionSeasonToEdit(event.target.value)}
                className={inputClass}
              >
                <option value="">Select a season</option>
                {catalog?.seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name} ({season.code.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm font-bold text-gray-200">
              Existing division
              <select
                required
                disabled={!editDivisionSeason}
                value={editDivisionId}
                onChange={(event) => chooseDivisionToEdit(event.target.value)}
                className={inputClass}
              >
                <option value="">
                  {editDivisionSeason ? "Select a division" : "Select a season first"}
                </option>
                {editDivisionSeason?.divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name} ({division.code.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-bold text-gray-200">
                Division code
                <input
                  required
                  disabled={!editDivisionId}
                  value={editDivisionCode}
                  onChange={(event) => setEditDivisionCode(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="text-sm font-bold text-gray-200">
                Display name
                <input
                  required
                  disabled={!editDivisionId}
                  value={editDivisionName}
                  onChange={(event) => setEditDivisionName(event.target.value)}
                  className={inputClass}
                />
              </label>
            </div>
            <label className="mt-4 flex items-start gap-3 rounded border border-white/10 bg-black/20 p-3 text-sm text-gray-200">
              <input
                type="checkbox"
                disabled={!editDivisionId}
                checked={editDivisionConferenceBased}
                onChange={(event) => setEditDivisionConferenceBased(event.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>
                <strong className="block">Conference-based division</strong>
                Two conferences, four teams each, and four playoff qualifiers.
              </span>
            </label>
            {editDivisionConferenceBased ? (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-bold text-gray-200">
                    Conference A name
                    <input
                      required
                      value={editDivisionConferenceA}
                      onChange={(event) => setEditDivisionConferenceA(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="text-sm font-bold text-gray-200">
                    Conference B name
                    <input
                      required
                      value={editDivisionConferenceB}
                      onChange={(event) => setEditDivisionConferenceB(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                </div>
                {editDivisionEntries.length ? (
                  <fieldset className="rounded border border-white/10 p-3">
                    <legend className="px-1 text-sm font-bold text-cyan-100">
                      Team conference placement
                    </legend>
                    <p className="mb-3 text-xs text-gray-400">
                      Assign every team. An eight-team division requires exactly four in each
                      conference.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {editDivisionEntries.map((entry) => (
                        <label key={entry.id} className="text-sm font-bold text-gray-200">
                          {entry.clan_tag} — {entry.display_name}
                          <select
                            required
                            value={editConferenceAssignments[String(entry.id)] ?? ""}
                            onChange={(event) =>
                              setEditConferenceAssignments((current) => ({
                                ...current,
                                [String(entry.id)]: event.target.value,
                              }))
                            }
                            className={inputClass}
                          >
                            <option value="">Select a conference</option>
                            <option value="a">{editDivisionConferenceA}</option>
                            <option value="b">{editDivisionConferenceB}</option>
                          </select>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                  <p className="text-sm text-gray-400">
                    Teams can be assigned as they are registered.
                  </p>
                )}
              </div>
            ) : (
              <label className="mt-3 block text-sm font-bold text-gray-200">
                Playoff qualifiers
                <select
                  disabled={!editDivisionId}
                  value={editDivisionPlayoffTeams}
                  onChange={(event) => setEditDivisionPlayoffTeams(event.target.value)}
                  className={inputClass}
                >
                  <option value="3">3 teams</option>
                  <option value="4">4 teams</option>
                </select>
                <span className="mt-1 block text-xs font-normal text-gray-400">
                  Switch between three and four qualifiers until the first playoff series starts.
                </span>
              </label>
            )}
            <button
              type="submit"
              disabled={saving !== "" || !editDivisionId}
              className="mt-4 rounded bg-cyan-500 px-4 py-2 font-bold text-black disabled:opacity-40"
            >
              {saving === "edit-division" ? "Saving…" : "Save division"}
            </button>
          </form>
        </div>
      </section>

      {error ? (
        <p role="alert" className="border border-red-500/40 bg-red-950/40 p-3 text-red-200">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="border border-emerald-500/30 bg-emerald-950/30 p-3">
          {notice}
        </p>
      ) : null}

      <section className="rounded-lg border border-white/15 bg-black/30 p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-amber-200">Team directory</p>
        <h3 className="mt-1 text-lg font-bold">Teams by division</h3>
        <p className="mt-1 text-sm text-gray-400">
          Choose a {league.toUpperCase()} division to see its registered teams. New divisions and
          registrations appear here as they are added.
        </p>
        <div className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold text-gray-200">
            Season
            <select
              value={browserSeasonId}
              onChange={(event) => {
                setBrowserSeasonId(event.target.value);
                setBrowserDivisionId("");
              }}
              className={inputClass}
            >
              <option value="">Select a season</option>
              {catalog?.seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name} ({season.code.toUpperCase()})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold text-gray-200">
            Division
            <select
              disabled={!browserSeason}
              value={browserDivisionId}
              onChange={(event) => setBrowserDivisionId(event.target.value)}
              className={inputClass}
            >
              <option value="">
                {browserSeason ? "Select a division" : "Select a season first"}
              </option>
              {browserSeason?.divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name} ({division.code.toUpperCase()})
                </option>
              ))}
            </select>
          </label>
        </div>

        {browserDivision ? (
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-bold">
                {browserDivision.season.name} · {browserDivision.division.name}
              </h4>
              <span className="text-sm text-gray-400">
                {browserEntries.length} {browserEntries.length === 1 ? "team" : "teams"}
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {browserEntries.length ? (
                browserEntries.map((entry) => (
                  <article
                    key={entry.id}
                    className="rounded border border-white/10 bg-black/30 p-3"
                  >
                    <div className="flex items-center gap-2">
                      {entry.hex_color ? (
                        <span
                          aria-hidden="true"
                          className="h-3 w-3 rounded-full border border-white/30"
                          style={{ backgroundColor: entry.hex_color }}
                        />
                      ) : null}
                      <span className="font-bold">{entry.clan_tag}</span>
                      <span className="text-gray-300">{entry.display_name}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Canonical team: {entry.team.canonical_name}
                      {entry.competition_status !== "active"
                        ? ` · ${entry.competition_status}`
                        : ""}
                    </p>
                  </article>
                ))
              ) : (
                <p className="text-sm text-gray-400">No teams are registered in this division.</p>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

import { useState } from "react";
import { patchJson } from "../api";

type CompetitionStatus = "active" | "dropped" | "disqualified";

export type CompetitionStatusTeam = {
  team_season_entry_id: number;
  canonical_name: string;
  display_name: string;
  clan_tag: string;
  competition_status: CompetitionStatus;
  competition_status_note: string | null;
  scope_label?: string;
};

export default function TeamCompetitionStatusManager({
  teams,
  onUpdated,
}: {
  teams: CompetitionStatusTeam[];
  onUpdated: (entryId: number, status: CompetitionStatus, note: string | null) => void;
}): React.JSX.Element | null {
  const [teamId, setTeamId] = useState(teams[0]?.team_season_entry_id ?? 0);
  const selected = teams.find((team) => team.team_season_entry_id === teamId) ?? teams[0];
  const [status, setStatus] = useState<CompetitionStatus>(selected?.competition_status ?? "active");
  const [note, setNote] = useState(selected?.competition_status_note ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!selected) return null;

  function chooseTeam(nextId: number): void {
    const next = teams.find((team) => team.team_season_entry_id === nextId);
    setTeamId(nextId);
    setStatus(next?.competition_status ?? "active");
    setNote(next?.competition_status_note ?? "");
    setMessage(null);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setMessage(null);
    try {
      const result = await patchJson<{
        team_season_entry_id: number;
        status: CompetitionStatus;
        note: string | null;
      }>(`/api/admin/team-season-entries/${selected.team_season_entry_id}/status`, {
        status,
        note,
      });
      onUpdated(result.team_season_entry_id, result.status, result.note);
      setMessage("Competition status saved. Standings recalculate automatically.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save team status.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-5 rounded-lg border border-amber-300/25 bg-zinc-950/90 p-4 shadow-2xl">
      <div className="mb-3">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-300">Admin control</p>
        <h2 className="text-xl font-bold">Team Competition Status</h2>
        <p className="mt-1 text-sm text-gray-300">
          Dropped or disqualified teams retain original match history, while every standings result
          is recalculated as a 150–0 loss and their players become leaderboard-ineligible.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_13rem_1.5fr_auto] md:items-end">
        <label className="text-xs font-semibold uppercase text-gray-400">
          Team
          <select
            value={selected.team_season_entry_id}
            onChange={(event) => chooseTeam(Number(event.target.value))}
            className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white"
          >
            {teams.map((team) => (
              <option key={team.team_season_entry_id} value={team.team_season_entry_id}>
                {team.scope_label ? `${team.scope_label} · ` : ""}
                {team.display_name || team.canonical_name} ({team.clan_tag})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold uppercase text-gray-400">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as CompetitionStatus)}
            className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white"
          >
            <option value="active">Active</option>
            <option value="dropped">Dropped</option>
            <option value="disqualified">Disqualified</option>
          </select>
        </label>
        <label className="text-xs font-semibold uppercase text-gray-400">
          Public note
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional context"
            className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white"
          />
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-md bg-amber-400 px-4 py-2 font-bold text-black hover:bg-amber-300 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save status"}
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-amber-100">{message}</p> : null}
    </section>
  );
}

import { useMemo, useState } from "react";

import type { TeamScope } from "../api";

type Props = {
  teams: TeamScope[];
  selectedTeamId?: number;
  assignedTeamIds: ReadonlySet<number>;
  onSelect: (team: TeamScope) => void;
};

export default function TeamScopePool({
  teams,
  selectedTeamId,
  assignedTeamIds,
  onSelect,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const visibleTeams = useMemo(() => {
    const target = query.trim().toLowerCase();
    if (!target) return teams;
    return teams.filter((team) =>
      [team.display_name, team.canonical_name, team.clan_tag, team.canonical_tag].some((value) =>
        value.toLowerCase().includes(target)
      )
    );
  }, [query, teams]);

  return (
    <div className="mt-4 border border-violet-300/20 bg-violet-950/15 p-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 text-left font-semibold text-violet-200"
        aria-expanded={open}
      >
        <span>Season team pool</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="mt-3">
          <p className="text-xs text-gray-400">
            Select a team already registered in this season and division.
          </p>
          {teams.length > 6 ? (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter teams by name or tag"
              aria-label="Filter season teams"
              className="mt-3 w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-sm"
            />
          ) : null}
          <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
            {visibleTeams.map((team) => {
              const selected = team.team_id === selectedTeamId;
              const assignedElsewhere = !selected && assignedTeamIds.has(team.team_id);
              return (
                <div
                  key={team.team_season_entry_id}
                  data-team-scope-id={team.team_season_entry_id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-2"
                >
                  <div>
                    <p className="font-semibold">{team.display_name || team.canonical_name}</p>
                    <p className="text-xs text-gray-400">
                      {team.clan_tag}
                      {team.canonical_tag !== team.clan_tag
                        ? ` · canonical tag ${team.canonical_tag}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={selected || assignedElsewhere}
                    onClick={() => onSelect(team)}
                    className="rounded border border-violet-300/40 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-950/50 disabled:opacity-40"
                  >
                    {selected ? "Selected" : assignedElsewhere ? "In match" : "Use team"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

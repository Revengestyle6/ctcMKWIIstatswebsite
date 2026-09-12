import type { PlayerRoleMode } from "../dashboardApi";

interface RoleModeToggleProps {
  value: PlayerRoleMode;
  onChange: (value: PlayerRoleMode) => void;
  disabled?: boolean;
}

const ROLE_OPTIONS: Array<{ value: PlayerRoleMode; label: string }> = [
  { value: "runner", label: "Runner" },
  { value: "bagger", label: "Bagger" },
];

export function RoleModeToggle({ value, onChange, disabled = false }: RoleModeToggleProps) {
  return (
    <fieldset className="m-0 min-w-40 flex-1 border-0 p-0 disabled:opacity-50" disabled={disabled}>
      <legend className="mb-1 text-sm font-semibold text-gray-300">Player role</legend>
      <div className="segmented-control">
        {ROLE_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

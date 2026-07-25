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
      <div className="grid h-10 w-40 grid-cols-2 overflow-hidden rounded-md border border-white/20 bg-zinc-950">
        {ROLE_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`h-full w-20 text-sm font-semibold transition-colors focus:z-10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400 disabled:cursor-not-allowed ${
                selected
                  ? "bg-blue-500 text-white"
                  : "bg-transparent text-gray-300 hover:bg-white/10 hover:text-white"
              }`}
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

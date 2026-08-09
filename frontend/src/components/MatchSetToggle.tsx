export type MatchSet = "regular" | "playoffs" | "all";

const OPTIONS: Array<{ value: MatchSet; label: string }> = [
  { value: "regular", label: "Regular season" },
  { value: "playoffs", label: "Playoffs" },
  { value: "all", label: "All matches" },
];

export function MatchSetToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: MatchSet;
  onChange: (value: MatchSet) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <span className="mb-1 block text-sm font-semibold text-gray-200">Match set</span>
      <fieldset
        className="inline-flex overflow-hidden rounded-md border border-white/20 bg-black/40"
        aria-label="Match set"
      >
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={value === option.value}
            className={`px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              value === option.value ? "bg-blue-500 text-white" : "text-gray-200 hover:bg-white/10"
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

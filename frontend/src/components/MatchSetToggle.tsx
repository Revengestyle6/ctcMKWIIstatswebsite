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
      <fieldset className="segmented-control" aria-label="Match set">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

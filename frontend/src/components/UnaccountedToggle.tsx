import { useSearchParams } from "react-router-dom";

export function UnaccountedToggle() {
  const [params, setParams] = useSearchParams();
  const included = params.get("include_unaccounted") === "true";
  return (
    <label className="flex max-w-sm items-start gap-2 text-sm text-amber-200">
      <input
        type="checkbox"
        checked={included}
        className="mt-1"
        onChange={(event) => {
          const next = new URLSearchParams(params);
          if (event.target.checked) next.set("include_unaccounted", "true");
          else next.delete("include_unaccounted");
          setParams(next, { replace: true });
        }}
      />
      <span>
        Include unaccounted matches
        <span className="block text-xs text-gray-400">
          Adds total scores and available GP scores. Race and track analytics use recorded races
          only.
        </span>
      </span>
    </label>
  );
}

export function UnaccountedContribution({ count }: { count?: number }) {
  return count ? (
    <p className="my-3 text-sm text-amber-200">
      Includes {count} unaccounted {count === 1 ? "match" : "matches"}. Placement, race-number, and
      track statistics use recorded races only.
    </p>
  ) : null;
}

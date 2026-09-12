import { LEAGUE_CODES } from "../config/leagues";
import { useLeague } from "../context/LeagueContext";

export default function LeagueSwitcher({
  className = "",
  disabled = false,
}: {
  className?: string;
  disabled?: boolean;
}) {
  const { league, setLeague } = useLeague();

  return (
    <fieldset disabled={disabled} className={`segmented-control ${className}`}>
      <legend className="sr-only">League</legend>
      <div className="flex">
        {LEAGUE_CODES.map((code) => (
          <button
            key={code}
            type="button"
            aria-label={code.toUpperCase()}
            aria-pressed={league === code}
            onClick={() => setLeague(code)}
            className={`rounded-md px-3 py-2 text-xs font-bold transition focus:outline-none league-focus-ring ${
              league === code
                ? "league-accent-bg text-black"
                : "text-gray-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            {code.toUpperCase()}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

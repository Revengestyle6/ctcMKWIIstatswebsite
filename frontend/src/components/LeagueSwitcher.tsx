import { LEAGUE_CODES, LEAGUES } from "../config/leagues";
import { useLeague } from "../context/LeagueContext";
import { LeagueLogoImage } from "./LeagueBrand";

export default function LeagueSwitcher({ className = "" }: { className?: string }) {
  const { league, setLeague } = useLeague();

  return (
    <fieldset
      className={`rounded-lg border border-white/15 bg-black/70 p-1 shadow-md backdrop-blur-md ${className}`}
    >
      <legend className="sr-only">League</legend>
      <div className="flex">
        {LEAGUE_CODES.map((code) => (
          <button
            key={code}
            type="button"
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

export function HomeLeagueSelector() {
  const { league, setLeague } = useLeague();

  return (
    <fieldset className="flex items-center justify-center" aria-label="Select league">
      <legend className="sr-only">Select league</legend>
      {LEAGUE_CODES.map((code, index) => {
        const selected = code === league;
        const config = LEAGUES[code];
        return (
          <div key={code} className="flex items-center">
            {index > 0 ? (
              <span aria-hidden="true" className="mx-4 h-20 w-px bg-white/20 sm:mx-6 sm:h-24" />
            ) : null}
            <button
              type="button"
              aria-label={config.shortName}
              aria-pressed={selected}
              title={`Switch to ${config.name}`}
              onClick={() => setLeague(code)}
              className={`rounded-xl p-2 transition duration-200 focus:outline-none league-focus-ring ${
                selected
                  ? "bg-white/10 opacity-100 shadow-lg"
                  : "opacity-35 grayscale hover:bg-white/5 hover:opacity-70"
              }`}
            >
              <LeagueLogoImage league={code} className="h-24 w-24 sm:h-28 sm:w-28" />
            </button>
          </div>
        );
      })}
    </fieldset>
  );
}

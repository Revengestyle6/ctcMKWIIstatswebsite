import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext";
import { LeagueLogo } from "./LeagueBrand";
import LeagueSwitcher from "./LeagueSwitcher";

export function LeagueHeaderControls({
  logoClassName = "h-11 w-11",
  className = "",
}: {
  logoClassName?: string;
  className?: string;
}) {
  const { config, leaguePath } = useLeague();

  return (
    <div className={`flex shrink-0 items-center gap-2 ${className}`}>
      <Link
        to={leaguePath("/")}
        aria-label={`${config.shortName} home`}
        className="rounded-lg focus:outline-none league-focus-ring"
      >
        <LeagueLogo className={logoClassName} />
      </Link>
      <LeagueSwitcher />
    </div>
  );
}

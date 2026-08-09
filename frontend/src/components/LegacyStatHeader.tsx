import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext";
import { LeagueLogo } from "./LeagueBrand";

export function LegacyStatHeader({ title }: { title: string }) {
  const { config, leaguePath } = useLeague();
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-black/60 px-4 py-3 backdrop-blur-md">
      <div className="mx-auto grid max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <Link
          to={leaguePath("/")}
          className="rounded-md px-2 py-2 font-semibold text-blue-300 transition hover:bg-white/10 hover:text-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <span aria-hidden="true">&larr;</span> Home
        </Link>
        <h1 className="truncate text-center text-xl font-bold sm:text-3xl">{title}</h1>
        <Link
          to={leaguePath("/")}
          aria-label={`${config.shortName} home`}
          className="rounded-lg focus:outline-none league-focus-ring"
        >
          <LeagueLogo className="h-11 w-11 sm:h-12 sm:w-12" />
        </Link>
      </div>
    </header>
  );
}

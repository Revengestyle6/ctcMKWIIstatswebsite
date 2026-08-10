import { BackToHomeLink } from "./BackToHomeLink";
import { LeagueHeaderControls } from "./LeagueHeaderControls";

export function LegacyStatHeader({ title }: { title: string }) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-black/60 px-4 py-3 backdrop-blur-md">
      <div className="mx-auto grid max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <BackToHomeLink />
        <h1 className="truncate text-center text-xl font-bold sm:text-3xl">{title}</h1>
        <LeagueHeaderControls logoClassName="h-11 w-11 sm:h-12 sm:w-12" />
      </div>
    </header>
  );
}

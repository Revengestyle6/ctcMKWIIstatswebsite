import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { backDestination, isNavigationLinkActive, navigationGroups } from "../config/navigation";
import { useLeague } from "../context/LeagueContext";

export function BackToHomeLink({ className = "" }: { className?: string }) {
  const { leaguePath } = useLeague();
  const { pathname } = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const navigationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        setIsOpen(false);
        navigationRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
        return;
      }
      if (!navigationRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);

  return (
    <div ref={navigationRef} className={`relative flex items-center gap-1 ${className}`}>
      <Link
        to={leaguePath(backDestination(pathname))}
        className="inline-flex rounded-md px-2 py-2 font-semibold league-accent-text transition hover:bg-white/10 focus:outline-none league-focus-ring"
      >
        <span aria-hidden="true">&lt;&nbsp;</span>
        Back
      </Link>
      <button
        type="button"
        aria-label="Pages"
        aria-expanded={isOpen}
        aria-controls="page-navigation-panel"
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-sm font-semibold text-gray-200 transition hover:bg-white/10 hover:text-white focus:outline-none league-focus-ring"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <span className="hidden sm:inline">Pages</span>
      </button>

      {isOpen ? (
        <nav
          id="page-navigation-panel"
          aria-label="Page navigation"
          className="absolute left-0 top-full z-[70] mt-2 max-h-[calc(100vh-6rem)] w-[min(38rem,calc(100vw-2rem))] origin-top-left overflow-y-auto rounded-xl border border-white/15 bg-zinc-900/95 p-3 text-left text-white shadow-2xl backdrop-blur-xl"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {navigationGroups.map((group) => (
              <section key={group.id} aria-labelledby={`page-navigation-${group.id}`}>
                <h2
                  id={`page-navigation-${group.id}`}
                  className="mb-2 rounded-md border border-white/10 bg-white/10 px-2.5 py-1.5 text-sm font-bold uppercase tracking-wider league-accent-text"
                >
                  {group.label}
                </h2>
                <div className="space-y-0.5">
                  {group.links.map((link) => {
                    const isActive = isNavigationLinkActive(link, pathname);
                    return (
                      <Link
                        key={link.to}
                        to={leaguePath(link.to)}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setIsOpen(false)}
                        className={`block rounded-lg px-2 py-2 transition hover:bg-white/10 focus:outline-none league-focus-ring ${isActive ? "bg-white/10 league-accent-text" : "text-gray-100"}`}
                      >
                        <span className="block text-sm font-semibold">{link.label}</span>
                        <span className="mt-0.5 hidden text-xs leading-4 text-gray-400 sm:block">
                          {link.description}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

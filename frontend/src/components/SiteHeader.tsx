import { lazy, Suspense, useEffect, useRef } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { adminNavigation, navigationGroups } from "../config/navigation";
import { useLeague } from "../context/LeagueContext";
import { LeagueHeaderControls } from "./LeagueHeaderControls";

const MusicPlayer = lazy(() => import("./MusicPlayer"));

export default function SiteHeader() {
  const { config, leaguePath } = useLeague();
  const { pathname, search } = useLocation();
  const header = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);
  const isAdmin = pathname.startsWith("/admin/") || pathname === "/database-health";

  useEffect(() => {
    const closeMenus = (event: Event) => {
      header.current?.querySelectorAll("details[open]").forEach((menu) => {
        if (event instanceof KeyboardEvent && event.key === "Escape") {
          menu.removeAttribute("open");
          menu.querySelector("summary")?.focus();
        } else if (event.type === "pointerdown" && !menu.contains(event.target as Node)) {
          menu.removeAttribute("open");
        }
      });
    };
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeMenus);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeMenus);
    };
  }, []);

  useEffect(() => {
    if (previousPath.current !== pathname) {
      header.current?.querySelectorAll("details[open]").forEach((menu) => {
        menu.removeAttribute("open");
      });
      document.getElementById("main-content")?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      previousPath.current = pathname;
    }
  }, [pathname]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `site-nav-link${isActive ? " is-active" : ""}`;

  return (
    <header className="site-header" ref={header}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="site-masthead">
        <div className="flex min-w-0 items-center gap-3">
          <LeagueHeaderControls
            disabled={pathname === "/json-editor" && new URLSearchParams(search).has("edit_match")}
          />
          <Link to={leaguePath("/")} className="site-wordmark">
            <span>{config.name}</span>
            <span>Statistics</span>
          </Link>
        </div>
        <Suspense fallback={null}>
          <MusicPlayer />
        </Suspense>
      </div>
      <nav className="site-navigation" aria-label="Primary navigation">
        <NavLink to={leaguePath("/")} end className={linkClass}>
          Home
        </NavLink>
        {navigationGroups[0].links.map((link) => (
          <NavLink key={link.to} to={leaguePath(link.to)} className={linkClass}>
            {link.label}
          </NavLink>
        ))}
        {navigationGroups.slice(1).map((group) => (
          <details className="nav-menu" key={group.id}>
            <summary
              className={`site-nav-link${group.links.some((link) => pathname === link.to) || (group.id === "tools" && isAdmin) ? " is-active" : ""}`}
            >
              {group.label}
              <span aria-hidden="true" className="menu-chevron">
                ⌄
              </span>
            </summary>
            <div className="nav-menu-panel">
              {group.links.map((link) => (
                <NavLink
                  key={link.to}
                  to={leaguePath(link.to)}
                  onClick={(event) =>
                    event.currentTarget.closest("details")?.removeAttribute("open")
                  }
                >
                  <span>{link.label}</span>
                  <small>{link.description}</small>
                </NavLink>
              ))}
            </div>
          </details>
        ))}
      </nav>
      {isAdmin && (
        <nav className="admin-navigation" aria-label="Administration">
          {adminNavigation.map((link) => (
            <NavLink key={link.to} to={leaguePath(link.to)} className={linkClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}

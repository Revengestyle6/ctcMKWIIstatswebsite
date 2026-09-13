export interface NavigationLink {
  to: string;
  label: string;
  description: string;
}

export interface NavigationGroup {
  id: string;
  label: string;
  links: readonly NavigationLink[];
}

export const navigationGroups = [
  {
    id: "competition",
    label: "Competition",
    links: [
      { to: "/standings", label: "Standings", description: "League tables and playoffs." },
      { to: "/matches", label: "Matches", description: "War tables and race results." },
      { to: "/players", label: "Players", description: "Player directory and dashboards." },
      { to: "/teams", label: "Teams", description: "Team directory and dashboards." },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    links: [
      {
        to: "/stats",
        label: "Player statistics",
        description: "Player averages and individual track performance.",
      },
      {
        to: "/top-team-players",
        label: "Team statistics",
        description: "Player contributions and track results by team.",
      },
      {
        to: "/tracks",
        label: "Track analytics",
        description: "Track trends, timing, margins, and team strengths.",
      },
      {
        to: "/best-matchups",
        label: "Team matchups",
        description: "Head-to-head team and track comparisons.",
      },
    ],
  },
  {
    id: "tools",
    label: "Tools & admin",
    links: [
      {
        to: "/json-editor",
        label: "Match JSON editor",
        description: "Create, validate, and submit match data.",
      },
      {
        to: "/admin/access",
        label: "Administrator access",
        description: "Sign in for league data management.",
      },
      {
        to: "/admin/database",
        label: "Database management",
        description: "Manage aliases, teams, and archive data.",
      },
      {
        to: "/admin/review-queue",
        label: "Review queue",
        description: "Review submitted match data.",
      },
      {
        to: "/database-health",
        label: "Database health",
        description: "Check archive quality and coverage.",
      },
    ],
  },
] as const satisfies readonly NavigationGroup[];

export function isNavigationLinkActive(link: NavigationLink, pathname: string): boolean {
  if (link.to === "/players") return pathname === "/players" || pathname.startsWith("/players/");
  if (link.to === "/teams") return pathname === "/teams" || pathname.startsWith("/teams/");
  if (link.to === "/tracks") return pathname === "/tracks" || pathname.startsWith("/tracks/");
  return pathname === link.to;
}

export function backDestination(pathname: string): string {
  if (pathname.startsWith("/players/")) return "/players";
  if (pathname.startsWith("/teams/")) return "/teams";
  if (pathname.startsWith("/tracks/")) return "/tracks";
  if (
    pathname === "/admin/database" ||
    pathname === "/admin/aliases" ||
    pathname === "/admin/review-queue" ||
    pathname === "/database-health"
  ) {
    return "/admin/access";
  }
  return "/";
}

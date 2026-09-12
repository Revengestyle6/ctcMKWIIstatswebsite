// One catalog for the home page and persistent navigation.
export const navigationGroups = [
  {
    id: "competition",
    label: "Competition",
    description: "Follow the season, then explore the people behind the results.",
    links: [
      {
        to: "/standings",
        label: "Standings",
        description: "League tables, player averages, and playoffs.",
      },
      {
        to: "/matches",
        label: "Matches",
        description: "War tables, race results, and score progression.",
      },
      {
        to: "/players",
        label: "Players",
        description: "Find a player’s career, season, and track results.",
      },
      {
        to: "/teams",
        label: "Teams",
        description: "Explore team records, rosters, and match history.",
      },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    description: "Take a closer look at performance across players, teams, and tracks.",
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
        to: "/top-tracks",
        label: "Track averages",
        description: "Player and team rankings for each track.",
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
    label: "Tools",
    description: "Contribute to the match archive or manage league data.",
    links: [
      {
        to: "/json-editor",
        label: "Match JSON editor",
        description: "Create, validate, and submit match data.",
      },
      {
        to: "/admin/access",
        label: "Administrator access",
        description: "Sign in for data management and review tools.",
      },
    ],
  },
] as const;

export const adminNavigation = [
  { to: "/admin/access", label: "Access" },
  { to: "/admin/database", label: "Database management" },
  { to: "/admin/review-queue", label: "Review queue" },
  { to: "/database-health", label: "Database health" },
] as const;

export function pageTitle(pathname: string): string | undefined {
  if (pathname.startsWith("/players/")) return "Player dashboard";
  if (pathname.startsWith("/teams/")) return "Team dashboard";
  for (const group of navigationGroups) {
    const link = group.links.find((link) => link.to === pathname);
    if (link) return link.label;
  }
  return adminNavigation.find((link) => link.to === pathname)?.label;
}

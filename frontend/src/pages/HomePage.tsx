import type React from "react";
import { Link } from "react-router-dom";
import { HomeLeagueSelector } from "../components/LeagueSwitcher";
import { useLeague } from "../context/LeagueContext";

const navigationSections = [
  {
    id: "competition",
    eyebrow: "Competition",
    title: "Follow the season",
    description: "Standings, completed matches, and the teams and players competing in the league.",
    links: [
      {
        to: "/standings",
        title: "Divisional Standings",
        description: "View league tables, head-to-head results, GP averages, and playoff brackets.",
        featured: true,
      },
      {
        to: "/matches",
        title: "Match History",
        description: "Browse complete war tables, race results, tracks, and score progression.",
      },
      {
        to: "/players",
        title: "Player Dashboards",
        description: "Browse players and open complete career and season analytics.",
      },
      {
        to: "/teams",
        title: "Team Dashboards",
        description: "Browse teams, rosters, records, tracks, and match history.",
      },
    ],
  },
  {
    id: "analytics",
    eyebrow: "Analytics",
    title: "Explore performance",
    description: "Compare results across players, teams, tracks, and head-to-head matchups.",
    links: [
      {
        to: "/stats",
        title: "Player Statistics",
        description: "Review player averages, race counts, and track performance.",
      },
      {
        to: "/top-team-players",
        title: "Team Statistics",
        description: "Compare player production and track results for a selected team.",
      },
      {
        to: "/top-tracks",
        title: "Track Averages",
        description: "Find the strongest player and team results by track.",
      },
      {
        to: "/best-matchups",
        title: "Team Matchups",
        description: "Compare head-to-head team and track performance.",
      },
    ],
  },
  {
    id: "management",
    eyebrow: "Data & administration",
    title: "Manage the archive",
    description:
      "Tools for maintaining match data, checking archive quality, and reviewing uploads.",
    links: [
      {
        to: "/database-health",
        title: "Database Health",
        description:
          "Monitor additions, record counts, archive integrity, and data-quality findings.",
      },
      {
        to: "/json-editor",
        title: "Match JSON Editor",
        description: "Create, validate, preview, and upload match data.",
      },
      {
        to: "/admin/access",
        title: "Administrator Access",
        description: "Sign in, review queued JSON, and view database and repository onboarding.",
      },
    ],
  },
] as const;

export default function HomePage(): React.JSX.Element {
  const { config, leaguePath } = useLeague();
  return (
    <main className="relative min-h-screen text-white">
      <section className="border-b border-white/10 bg-black/55 px-5 py-12 backdrop-blur-sm sm:px-8 sm:py-16">
        <div className="mx-auto max-w-6xl text-center">
          <div className="mx-auto mb-5 w-fit">
            <HomeLeagueSelector />
          </div>
          <h1 className="text-4xl font-bold sm:text-5xl">{config.name} Statistics</h1>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-gray-200 sm:text-lg">
            {config.description}
          </p>

          <nav className="mx-auto mt-10 max-w-6xl space-y-7 text-left" aria-label="Site pages">
            {navigationSections.map((section) => (
              <section
                key={section.id}
                aria-labelledby={`${section.id}-navigation-heading`}
                className="rounded-xl border border-white/10 bg-black/35 p-4 shadow-lg sm:p-6"
              >
                <div className="mb-4 sm:flex sm:items-end sm:justify-between sm:gap-6">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] league-accent-text">
                      {section.eyebrow}
                    </p>
                    <h2
                      id={`${section.id}-navigation-heading`}
                      className="mt-1 text-xl font-bold text-white"
                    >
                      {section.title}
                    </h2>
                  </div>
                  <p className="mt-2 max-w-xl text-sm leading-5 text-gray-300 sm:mt-0 sm:text-right">
                    {section.description}
                  </p>
                </div>

                <div
                  className={`grid gap-3 sm:grid-cols-2 ${section.links.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}
                >
                  {section.links.map((link) => (
                    <Link
                      key={link.to}
                      to={leaguePath(link.to)}
                      className={`group rounded-lg border px-4 py-4 transition hover:-translate-y-0.5 hover:bg-black/80 focus:outline-none league-focus-ring ${"featured" in link && link.featured ? "league-accent-border bg-white/10" : "border-white/15 bg-black/55 hover:border-white/35"}`}
                    >
                      <span className="flex items-center justify-between gap-3 text-base font-bold text-white">
                        {link.title}
                        <span
                          aria-hidden="true"
                          className="league-accent-text transition-transform group-hover:translate-x-0.5"
                        >
                          →
                        </span>
                      </span>
                      <span className="mt-2 block text-sm leading-5 text-gray-300">
                        {link.description}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </nav>
        </div>
      </section>

      <section className="border-b border-white/10 bg-zinc-950/90 px-5 py-10 sm:px-8">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
          <div>
            <h2 className="text-2xl font-bold">About the data</h2>
            <p className="mt-3 max-w-3xl leading-7 text-gray-300">
              Analytics are calculated from MKW Table Bot JSON, reviewed historical files, and
              matches submitted through the site&apos;s editor. Available seasons and divisions are
              read directly from the database.
            </p>
            <p className="mt-3 max-w-3xl leading-7 text-gray-300">
              Historical source data can be missing or incomplete. Report duplicate player
              identities, incorrect team assignments, or obvious score errors so the archive can be
              corrected.
            </p>
          </div>
          <div className="border-l-2 border-blue-400/70 pl-5">
            <p className="text-sm font-semibold uppercase text-blue-200">Start with the source</p>
            <h2 className="mt-1 text-xl font-bold">Every result can be traced to a match.</h2>
            <p className="mt-2 leading-6 text-gray-300">
              Match History shows full war tables, penalties, tracks, race scores, and the
              differential over time.
            </p>
            <Link
              to={leaguePath("/matches")}
              className="mt-4 inline-block font-semibold text-blue-300 hover:text-blue-200"
            >
              Open Match History →
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-black/85 px-5 py-10 backdrop-blur-sm sm:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-sm font-semibold uppercase league-accent-text">Live competition</p>
              <h2 className="mt-1 text-2xl font-bold">{config.name}</h2>
            </div>
            {config.twitchChannel ? (
              <a
                href={`https://www.twitch.tv/${config.twitchChannel}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold league-accent-text"
              >
                Open on Twitch →
              </a>
            ) : null}
          </div>
          {config.twitchChannel ? (
            <div className="aspect-video overflow-hidden rounded-md border border-white/15 bg-black shadow-2xl">
              <iframe
                src={`https://player.twitch.tv/?channel=${config.twitchChannel}&parent=${window.location.hostname}`}
                allow="autoplay; fullscreen; encrypted-media"
                allowFullScreen
                className="h-full w-full"
                title={`${config.name} Twitch channel`}
                loading="lazy"
              />
            </div>
          ) : (
            <div className="rounded-md border border-white/15 bg-black/70 px-6 py-10 text-center text-gray-300">
              Broadcast information for {config.shortName} will appear here when configured.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

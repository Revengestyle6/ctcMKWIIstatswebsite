import React from "react";
import { Link } from "react-router-dom";

const analyticsLinks = [
  { to: "/matches", title: "Match History", description: "Browse complete war tables, race results, tracks, and score progression." },
  { to: "/players", title: "Player Dashboards", description: "Browse players and open complete career and season analytics." },
  { to: "/teams", title: "Team Dashboards", description: "Browse teams, rosters, records, tracks, and match history." },
  { to: "/stats", title: "Player Statistics", description: "Review player averages, race counts, and track performance." },
  { to: "/top-team-players", title: "Team Statistics", description: "Compare player production and track results for a selected team." },
  { to: "/top-tracks", title: "Track Averages", description: "Find the strongest player and team results by track." },
  { to: "/best-matchups", title: "Team Matchups", description: "Compare head-to-head team and track performance." },
  { to: "/database-health", title: "Database Health", description: "Monitor additions, record counts, archive integrity, and data-quality findings." },
];

export default function HomePage(): React.JSX.Element {
  return (
    <main className="relative min-h-screen text-white">
      <section className="border-b border-white/10 bg-black/55 px-5 py-12 backdrop-blur-sm sm:px-8 sm:py-16">
        <div className="mx-auto max-w-6xl text-center">
          <img
            src="/images/CTC_LOGO/ctclogo.webp"
            alt="Custom Track Cup logo"
            className="mx-auto mb-5 h-24 w-24 rounded-md sm:h-28 sm:w-28"
          />
          <h1 className="text-4xl font-bold sm:text-5xl">Custom Track Cup Statistics</h1>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-gray-200 sm:text-lg">
            Multi-season player, team, track, matchup, and race analytics built from the CTC match archive.
          </p>

          <nav className="mx-auto mt-9 grid max-w-5xl gap-3 text-left sm:grid-cols-2 lg:grid-cols-3" aria-label="Statistics pages">
            {analyticsLinks.map((link, index) => (
              <Link
                key={link.to}
                to={link.to}
                className={`rounded-md border px-4 py-4 transition hover:-translate-y-0.5 hover:border-blue-300/70 hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-blue-300 ${index === 0 ? "border-blue-300/50 bg-blue-950/80" : "border-white/15 bg-black/65"}`}
              >
                <span className="block text-lg font-bold text-white">{link.title}</span>
                <span className="mt-1 block text-sm leading-5 text-gray-300">{link.description}</span>
              </Link>
            ))}
            <Link
              to="/json-editor"
              className="rounded-md border border-emerald-300/40 bg-emerald-950/75 px-4 py-4 transition hover:-translate-y-0.5 hover:border-emerald-200/70 hover:bg-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-300"
            >
              <span className="block text-lg font-bold text-white">Match JSON Editor</span>
              <span className="mt-1 block text-sm leading-5 text-gray-300">Create, validate, preview, and upload match data.</span>
            </Link>
          </nav>

          <p className="mt-7 text-sm text-gray-300">Created by Lawrence</p>
        </div>
      </section>

      <section className="border-b border-white/10 bg-zinc-950/90 px-5 py-10 sm:px-8">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
          <div>
            <h2 className="text-2xl font-bold">About the data</h2>
            <p className="mt-3 max-w-3xl leading-7 text-gray-300">
              Analytics are calculated from MKW Table Bot JSON, reviewed historical files, and matches submitted through the site&apos;s editor. Available seasons and divisions are read directly from the database.
            </p>
            <p className="mt-3 max-w-3xl leading-7 text-gray-300">
              Historical source data can be missing or incomplete. Report duplicate player identities, incorrect team assignments, or obvious score errors so the archive can be corrected.
            </p>
          </div>
          <div className="border-l-2 border-blue-400/70 pl-5">
            <p className="text-sm font-semibold uppercase text-blue-200">Start with the source</p>
            <h2 className="mt-1 text-xl font-bold">Every result can be traced to a match.</h2>
            <p className="mt-2 leading-6 text-gray-300">
              Match History shows full war tables, penalties, tracks, race scores, and the differential over time.
            </p>
            <Link to="/matches" className="mt-4 inline-block font-semibold text-blue-300 hover:text-blue-200">
              Open Match History →
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-black/85 px-5 py-10 backdrop-blur-sm sm:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-sm font-semibold uppercase text-red-200">Live competition</p>
              <h2 className="mt-1 text-2xl font-bold">Custom Track Cup on Twitch</h2>
            </div>
            <a
              href="https://www.twitch.tv/customtrackcupmkwii"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-red-200 hover:text-red-100"
            >
              Open on Twitch →
            </a>
          </div>
          <div className="aspect-video overflow-hidden rounded-md border border-white/15 bg-black shadow-2xl">
            <iframe
              src={`https://player.twitch.tv/?channel=customtrackcupmkwii&parent=${window.location.hostname}`}
              allow="autoplay; fullscreen; encrypted-media"
              allowFullScreen
              className="h-full w-full"
              title="Custom Track Cup MKWii Twitch channel"
              loading="lazy"
            />
          </div>
        </div>
      </section>
    </main>
  );
}

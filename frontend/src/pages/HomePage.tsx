import { Link } from "react-router-dom";
import { LeagueLogo } from "../components/LeagueBrand";
import { navigationGroups } from "../config/navigation";
import { useLeague } from "../context/LeagueContext";

export default function HomePage() {
  const { config, leaguePath } = useLeague();
  return (
    <main className="home-page">
      <header className="home-intro">
        <div>
          <p className="eyebrow">Mario Kart Wii · {config.shortName}</p>
          <h1>{config.name} statistics</h1>
          <p>
            Follow {config.name}, revisit a match, or explore the players and teams behind the
            results.
          </p>
          <Link to={leaguePath("/standings")} className="ui-button home-primary">
            View standings <span aria-hidden="true">→</span>
          </Link>
        </div>
        <LeagueLogo className="home-logo" />
      </header>

      <nav aria-label="Site pages" className="home-sections">
        {navigationGroups.map((group) => (
          <section key={group.id} className="home-section" aria-labelledby={`${group.id}-heading`}>
            <div className="home-section-heading">
              <h2 id={`${group.id}-heading`}>{group.label}</h2>
              <p>{group.description}</p>
            </div>
            <div className="home-link-grid">
              {group.links.map((link) => (
                <Link key={link.to} to={leaguePath(link.to)} className="home-link">
                  <div>
                    <h3>{link.label}</h3>
                    <p>{link.description}</p>
                  </div>
                  <span aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </nav>

      <section className="home-about" aria-labelledby="about-data">
        <div>
          <h2 id="about-data">Behind the numbers</h2>
          <p>
            Results come from MKW Table Bot match files and reviewed submissions. Historical records
            can be incomplete. Match History includes the race scores, tracks, and penalties behind
            each result.
          </p>
          <Link to={leaguePath("/matches")} className="league-accent-text">
            Explore match history →
          </Link>
        </div>
        {config.twitchChannel && (
          <details className="broadcast">
            <summary>
              Watch {config.shortName} on Twitch <span aria-hidden="true">↗</span>
            </summary>
            <p className="mb-4 mt-2 text-sm text-gray-400">
              <a
                href={`https://www.twitch.tv/${config.twitchChannel}`}
                target="_blank"
                rel="noreferrer"
                className="league-accent-text"
              >
                Open channel in a new tab →
              </a>
            </p>
            <div className="aspect-video overflow-hidden rounded-lg bg-black">
              <iframe
                src={`https://player.twitch.tv/?channel=${config.twitchChannel}&parent=${window.location.hostname}&autoplay=false`}
                allow="fullscreen; encrypted-media"
                allowFullScreen
                className="h-full w-full"
                title={`${config.name} Twitch channel`}
                loading="lazy"
              />
            </div>
          </details>
        )}
      </section>
      <footer className="home-footer">{config.name} · Mario Kart Wii statistics</footer>
    </main>
  );
}

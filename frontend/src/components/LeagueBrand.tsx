import { useState } from "react";
import { Link } from "react-router-dom";
import { LEAGUES, type LeagueCode } from "../config/leagues";
import { useLeague } from "../context/LeagueContext";

export function LeagueLogoImage({
  league,
  className = "h-11 w-11",
}: {
  league: LeagueCode;
  className?: string;
}) {
  const config = LEAGUES[league];
  const [failedUrl, setFailedUrl] = useState("");
  const failed = failedUrl === config.logoUrl;

  if (failed) {
    return (
      <span
        role="img"
        aria-label={`${config.name} logo placeholder`}
        className={`${className} inline-flex items-center justify-center rounded-md border border-white/20 bg-black/70 text-xs font-black tracking-tight league-accent-text`}
      >
        {config.shortName}
      </span>
    );
  }

  return (
    <img
      src={config.logoUrl}
      alt={config.logoAlt}
      className={`${className} rounded-md object-contain`}
      onError={() => setFailedUrl(config.logoUrl)}
    />
  );
}

export function LeagueLogo({ className = "h-11 w-11" }: { className?: string }) {
  const { league } = useLeague();
  return <LeagueLogoImage league={league} className={className} />;
}

export function LeagueHomeLogo({ className }: { className?: string }) {
  const { leaguePath } = useLeague();
  return (
    <Link to={leaguePath("/")} className="rounded-md focus:outline-none league-focus-ring">
      <LeagueLogo className={className} />
    </Link>
  );
}

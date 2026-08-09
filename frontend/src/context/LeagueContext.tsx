import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isLeagueCode, LEAGUES, type LeagueCode, type LeagueConfig } from "../config/leagues";

const STORAGE_KEY = "mkw-stats:league:v1";
const LEAGUE_SCOPED_PARAMS = [
  "season",
  "division",
  "match",
  "team",
  "team_id",
  "opponent_team_id",
  "track",
  "track_id",
];

interface LeagueContextValue {
  league: LeagueCode;
  config: LeagueConfig;
  setLeague: (league: LeagueCode) => void;
  leaguePath: (path: string) => string;
}

const LeagueContext = createContext<LeagueContextValue | null>(null);

function storedLeague(): LeagueCode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLeagueCode(value) ? value : "ctc";
  } catch {
    return "ctc";
  }
}

function setLeagueFavicon(league: LeagueCode, faviconUrl: string): void {
  const current = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (current?.dataset.league === league) return;

  const favicon = document.createElement("link");
  favicon.id = "league-favicon";
  favicon.rel = "icon";
  favicon.type = faviconUrl.endsWith(".png") ? "image/png" : "image/webp";
  favicon.href = faviconUrl;
  favicon.dataset.league = league;

  if (current) {
    current.replaceWith(favicon);
  } else {
    document.head.append(favicon);
  }
}

export function LeagueProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryLeague = new URLSearchParams(location.search).get("league");
  const league = isLeagueCode(queryLeague) ? queryLeague : storedLeague();
  const config = LEAGUES[league];

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, league);
    } catch {
      // URL state remains authoritative when storage is unavailable.
    }

    const root = document.documentElement;
    root.dataset.league = league;
    root.style.setProperty("--league-accent", config.theme.accent);
    root.style.setProperty("--league-accent-hover", config.theme.accentHover);
    root.style.setProperty("--league-accent-muted", config.theme.accentMuted);
    root.style.setProperty("--league-focus", config.theme.focus);
    root.style.setProperty("--league-page-fallback", config.theme.pageFallback);
    document.title = `${config.name} Statistics`;

    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = config.description;

    setLeagueFavicon(league, config.faviconUrl);

    if (!isLeagueCode(queryLeague)) {
      const params = new URLSearchParams(location.search);
      params.set("league", league);
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
  }, [config, league, location.pathname, location.search, navigate, queryLeague]);

  const setLeague = useCallback(
    (nextLeague: LeagueCode) => {
      if (nextLeague === league) return;
      const params = new URLSearchParams(location.search);
      params.set("league", nextLeague);
      for (const key of LEAGUE_SCOPED_PARAMS) params.delete(key);
      navigate({ pathname: location.pathname, search: params.toString() });
    },
    [league, location.pathname, location.search, navigate]
  );

  const leaguePath = useCallback(
    (path: string) => {
      const url = new URL(path, window.location.origin);
      url.searchParams.set("league", league);
      return `${url.pathname}${url.search}${url.hash}`;
    },
    [league]
  );

  const value = useMemo(
    () => ({ league, config, setLeague, leaguePath }),
    [config, league, leaguePath, setLeague]
  );

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague(): LeagueContextValue {
  const context = useContext(LeagueContext);
  if (!context) throw new Error("useLeague must be used inside LeagueProvider.");
  return context;
}

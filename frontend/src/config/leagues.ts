import mediaManifest from "../../media-manifest.json";

export type LeagueCode = "ctc" | "gsc";

export interface LeagueTheme {
  accent: string;
  accentHover: string;
  accentMuted: string;
  focus: string;
  pageFallback: string;
}

export interface LeagueConfig {
  code: LeagueCode;
  shortName: string;
  name: string;
  description: string;
  trackPool: "custom" | "base";
  logoUrl: string;
  faviconUrl: string;
  logoAlt: string;
  backgrounds: readonly string[];
  theme: LeagueTheme;
  twitchChannel?: string;
}

function numberedBackgrounds(directory: string, count: number): readonly string[] {
  return Object.freeze(
    Array.from(
      { length: count },
      (_, index) => `${directory}/${String(index + 1).padStart(3, "0")}.webp`
    )
  );
}

export const LEAGUES: Record<LeagueCode, LeagueConfig> = Object.freeze({
  ctc: {
    code: "ctc",
    shortName: "CTC",
    name: "Custom Track Cup",
    description:
      "Multi-season player, team, track, matchup, and race analytics for custom-track competition.",
    trackPool: "custom",
    logoUrl: "/media/leagues/ctc/branding/logo.webp",
    faviconUrl: "/media/leagues/ctc/branding/logo.webp",
    logoAlt: "Custom Track Cup logo",
    backgrounds: numberedBackgrounds(
      "/media/leagues/ctc/backgrounds",
      mediaManifest.leagues.ctc.backgroundCount
    ),
    theme: {
      accent: "#60a5fa",
      accentHover: "#93c5fd",
      accentMuted: "#172554",
      focus: "#60a5fa",
      pageFallback: "#020617",
    },
    twitchChannel: "customtrackcupmkwii",
  },
  gsc: {
    code: "gsc",
    shortName: "GSC",
    name: "Grand Star Cup",
    description:
      "Multi-season player, team, track, matchup, and race analytics for regular-track competition.",
    trackPool: "base",
    logoUrl: "/media/leagues/gsc/branding/logo.webp",
    faviconUrl: "/media/leagues/gsc/branding/favicon.png",
    logoAlt: "Grand Star Cup logo",
    backgrounds: numberedBackgrounds(
      "/media/leagues/gsc/backgrounds",
      mediaManifest.leagues.gsc.backgroundCount
    ),
    theme: {
      accent: "#fbbf24",
      accentHover: "#fde68a",
      accentMuted: "#451a03",
      focus: "#fbbf24",
      pageFallback: "#1c1302",
    },
    twitchChannel: "MarioKartCentralWii",
  },
});

export const LEAGUE_CODES = Object.freeze(Object.keys(LEAGUES) as LeagueCode[]);

export function isLeagueCode(value: string | null | undefined): value is LeagueCode {
  return value === "ctc" || value === "gsc";
}

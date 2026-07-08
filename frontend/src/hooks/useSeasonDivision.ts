import { useEffect, useState } from "react";
import {
  DivisionOption,
  SeasonOption,
  fetchDivisions,
  fetchSeasons,
} from "../api";

export function useSeasonDivision() {
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [divisions, setDivisions] = useState<DivisionOption[]>([]);
  const [season, setSeason] = useState("");
  const [division, setDivision] = useState("");
  const [loadingScope, setLoadingScope] = useState(true);
  const [scopeError, setScopeError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSeasons() {
      setLoadingScope(true);
      setScopeError("");
      try {
        const seasonData = await fetchSeasons();
        if (cancelled) return;
        setSeasons(seasonData);
        setSeason(seasonData[0]?.season ?? "");
      } catch (error) {
        if (cancelled) return;
        setScopeError(error instanceof Error ? error.message : "Failed to load seasons.");
        setSeasons([]);
        setSeason("");
      } finally {
        if (!cancelled) setLoadingScope(false);
      }
    }

    loadSeasons();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDivisions() {
      if (!season) {
        setDivisions([]);
        setDivision("");
        return;
      }

      setLoadingScope(true);
      setScopeError("");
      try {
        const divisionData = await fetchDivisions(season);
        if (cancelled) return;
        setDivisions(divisionData);
        setDivision(divisionData[0]?.division ?? "");
      } catch (error) {
        if (cancelled) return;
        setScopeError(error instanceof Error ? error.message : "Failed to load divisions.");
        setDivisions([]);
        setDivision("");
      } finally {
        if (!cancelled) setLoadingScope(false);
      }
    }

    loadDivisions();
    return () => {
      cancelled = true;
    };
  }, [season]);

  return {
    seasons,
    divisions,
    season,
    division,
    loadingScope,
    scopeError,
    setSeason,
    setDivision,
  };
}

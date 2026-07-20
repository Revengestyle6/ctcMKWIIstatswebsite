import type React from "react";
import { type DivisionOption, formatDivisionName, type SeasonOption } from "../api";

interface SeasonDivisionSelectorProps {
  season: string;
  division: string;
  seasons: SeasonOption[];
  divisions: DivisionOption[];
  disabled?: boolean;
  onSeasonChange: (season: string) => void;
  onDivisionChange: (division: string) => void;
  className?: string;
}

export default function SeasonDivisionSelector({
  season,
  division,
  seasons,
  divisions,
  disabled = false,
  onSeasonChange,
  onDivisionChange,
  className = "",
}: SeasonDivisionSelectorProps): React.JSX.Element {
  return (
    <div className={`flex flex-col sm:flex-row gap-4 ${className}`}>
      <div>
        <label htmlFor="season-selector" className="block font-semibold mb-1">
          Season
        </label>
        <select
          id="season-selector"
          className="px-4 py-2 rounded-md border border-gray-400 bg-white text-black focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-40"
          value={season}
          onChange={(event) => onSeasonChange(event.target.value)}
          disabled={disabled || seasons.length === 0}
        >
          {seasons.map((option) => (
            <option key={option.season} value={option.season}>
              {option.name || option.season.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="division-selector" className="block font-semibold mb-1">
          Division
        </label>
        <select
          id="division-selector"
          className="px-4 py-2 rounded-md border border-gray-400 bg-white text-black focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-40"
          value={division}
          onChange={(event) => onDivisionChange(event.target.value)}
          disabled={disabled || divisions.length === 0}
        >
          {divisions.map((option) => (
            <option key={option.division} value={option.division}>
              {formatDivisionName(option)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

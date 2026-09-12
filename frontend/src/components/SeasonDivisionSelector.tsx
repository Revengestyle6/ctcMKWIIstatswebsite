import type React from "react";
import { useId } from "react";
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
  const id = useId();
  return (
    <div className={`scope-selector ${className}`}>
      <div>
        <label htmlFor={`${id}-season`} className="block text-sm font-semibold mb-1 text-gray-300">
          Season
        </label>
        <select
          id={`${id}-season`}
          className="ui-input w-full"
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
        <label
          htmlFor={`${id}-division`}
          className="block text-sm font-semibold mb-1 text-gray-300"
        >
          Division
        </label>
        <select
          id={`${id}-division`}
          className="ui-input w-full"
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

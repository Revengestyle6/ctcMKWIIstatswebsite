import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface MetricItem {
  label: string;
  value: string;
  detail?: string;
}

export interface ScopeAppearance {
  season: string;
  division: string;
}

export interface ScopeEntityOption {
  id: number;
  label: string;
  season?: string;
  division?: string;
}

export interface DashboardTab {
  id: string;
  label: string;
}

interface DashboardShellProps {
  title: string;
  identity: ReactNode;
  controls: ReactNode;
  children: ReactNode;
}

export function DashboardShell({ title, identity, controls, children }: DashboardShellProps) {
  return (
    <div className="relative min-h-screen text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/80 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto grid max-w-7xl grid-cols-[5rem_1fr_5rem] items-center sm:grid-cols-[8rem_1fr_8rem]">
          <Link to="/" className="font-semibold text-blue-300 hover:text-blue-200">
            &larr; Back
          </Link>
          <h1 className="text-center text-xl font-bold sm:text-2xl">{title}</h1>
          <img
            src="/images/CTC_LOGO/ctclogo.webp"
            alt="Custom Track Cup"
            className="ml-auto h-11 w-11 rounded-md"
          />
        </div>
      </header>

      <section className="border-b border-white/10 bg-zinc-950/90 px-4 py-6 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl">{identity}</div>
      </section>

      <section className="border-b border-white/10 bg-black/75 px-4 py-4 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl">{controls}</div>
      </section>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

export function TeamLogo({ src, alt, className = "h-20 w-20" }: { src: string; alt: string; className?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className={`${className} shrink-0 rounded-md border border-white/15 bg-black/60 object-contain p-1`}
      onError={(event) => {
        const image = event.currentTarget;
        if (!image.src.endsWith("/images/team-logos/placeholder.webp")) {
          image.src = "/images/team-logos/placeholder.webp";
        }
      }}
    />
  );
}

export function MetricGrid({ items }: { items: MetricItem[] }) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-md border border-white/10 bg-black/65 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="min-h-24 border-b border-r border-white/10 px-4 py-4 last:border-r-0 sm:min-h-28">
          <dt className="text-xs font-semibold text-gray-400">{item.label}</dt>
          <dd className="mt-1 text-2xl font-bold text-white">{item.value}</dd>
          {item.detail && <dd className="mt-1 text-xs text-gray-400">{item.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function DashboardTabs({
  tabs,
  active,
  onChange,
  extraControl,
}: {
  tabs: DashboardTab[];
  active: string;
  onChange: (tab: string) => void;
  extraControl?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-white/10 sm:flex-row sm:items-end sm:justify-between">
      <nav className="overflow-x-auto" aria-label="Dashboard tabs">
        <div className="flex min-w-max">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`border-b-2 px-4 py-3 font-semibold transition ${active === tab.id ? "border-blue-400 text-white" : "border-transparent text-gray-400 hover:text-white"}`}
              aria-current={active === tab.id ? "page" : undefined}
              onClick={() => onChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
      {extraControl ? <div className="shrink-0 pb-2">{extraControl}</div> : null}
    </div>
  );
}

interface ScopeControlsProps {
  appearances: ScopeAppearance[];
  season: string;
  division: string;
  entityLabel?: string;
  entityId?: string;
  entityOptions?: ScopeEntityOption[];
  minRaces: number;
  extraControl?: ReactNode;
  disabled?: boolean;
  onSeasonChange: (value: string) => void;
  onDivisionChange: (value: string) => void;
  onEntityChange?: (value: string) => void;
  onMinRacesChange: (value: number) => void;
}

export function DashboardScopeControls({
  appearances,
  season,
  division,
  entityLabel,
  entityId = "",
  entityOptions = [],
  minRaces,
  extraControl,
  disabled,
  onSeasonChange,
  onDivisionChange,
  onEntityChange,
  onMinRacesChange,
}: ScopeControlsProps) {
  const seasons = Array.from(new Set(appearances.map((entry) => entry.season))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const divisions = Array.from(new Set(
    appearances.filter((entry) => !season || entry.season === season).map((entry) => entry.division)
  )).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const filteredEntities = entityOptions.filter((option) =>
    (!season || !option.season || option.season === season)
    && (!division || !option.division || option.division === division)
  );
  const uniqueEntities = Array.from(new Map(filteredEntities.map((option) => [option.id, option])).values());
  const controlClass = "min-h-10 rounded-md border border-white/20 bg-zinc-950 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm font-semibold text-gray-300">
        Scope
        <select
          className={controlClass}
          value={season}
          disabled={disabled}
          onChange={(event) => onSeasonChange(event.target.value)}
        >
          <option value="">Career</option>
          {seasons.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
        </select>
      </label>

      <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm font-semibold text-gray-300">
        Division
        <select
          className={controlClass}
          value={division}
          disabled={disabled || !season}
          onChange={(event) => onDivisionChange(event.target.value)}
        >
          <option value="">All divisions</option>
          {divisions.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
        </select>
      </label>

      {entityLabel && onEntityChange && (
        <label className="flex min-w-44 flex-1 flex-col gap-1 text-sm font-semibold text-gray-300">
          {entityLabel}
          <select
            className={controlClass}
            value={entityId}
            disabled={disabled}
            onChange={(event) => onEntityChange(event.target.value)}
          >
            <option value="">All {entityLabel.toLowerCase()}s</option>
            {uniqueEntities.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      )}

      {extraControl}

      <label className="flex min-w-36 flex-col gap-1 text-sm font-semibold text-gray-300">
        Minimum races
        <input
          className={`${controlClass} w-full text-center`}
          type="number"
          min={1}
          max={500}
          value={minRaces}
          disabled={disabled}
          onChange={(event) => onMinRacesChange(Math.min(500, Math.max(1, Number(event.target.value) || 1)))}
        />
      </label>
    </div>
  );
}

export function ResultBadge({ result }: { result: string }) {
  const color = result === "win"
    ? "bg-emerald-950 text-emerald-200 border-emerald-500/40"
    : result === "loss"
      ? "bg-rose-950 text-rose-200 border-rose-500/40"
      : "bg-zinc-800 text-gray-200 border-white/15";
  return <span className={`inline-flex min-w-12 justify-center rounded border px-2 py-1 text-xs font-bold ${color}`}>{result.toUpperCase()}</span>;
}

export function RankingSummary({ rank, population, minimum }: { rank?: number; population: number; minimum: number }) {
  return (
    <div className="border-l-2 border-blue-400 pl-4">
      <p className="text-sm font-semibold text-blue-200">Division ranking</p>
      <p className="mt-1 text-2xl font-bold">{rank ? `#${rank} of ${population}` : "Not qualified"}</p>
      <p className="mt-1 text-sm text-gray-400">Minimum {minimum} races</p>
    </div>
  );
}

export function TrendRows({
  values,
  signed = false,
}: {
  values: Array<{ id: number; label: string; value: number | null }>;
  signed?: boolean;
}) {
  const max = Math.max(1, ...values.map((item) => Math.abs(item.value ?? 0)));
  if (values.length === 0) return <p className="text-sm text-gray-400">No trend data in this scope.</p>;

  return (
    <div className="space-y-2">
      {values.map((item) => {
        const unavailable = item.value === null;
        const value = item.value ?? 0;
        const width = unavailable ? "0%" : `${Math.max(2, Math.abs(value) / max * 100)}%`;
        const color = signed && value < 0 ? "bg-rose-400" : "bg-blue-400";
        return (
          <div key={item.id} className="grid grid-cols-[5rem_1fr_3.5rem] items-center gap-3 text-sm">
            <span className="truncate text-gray-400" title={item.label}>{item.label}</span>
            <div className="h-2 overflow-hidden rounded bg-white/10">
              <div className={`h-full ${color}`} style={{ width }} />
            </div>
            <span className={`text-right font-semibold ${unavailable ? "text-gray-500" : "text-gray-200"}`}>
              {unavailable ? "-" : `${signed && value > 0 ? "+" : ""}${value}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

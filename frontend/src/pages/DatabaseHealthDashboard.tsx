import { useEffect, useMemo, useState } from "react";
import AdminSessionPanel from "../components/AdminSessionPanel";
import { LeagueHeaderControls } from "../components/LeagueHeaderControls";
import { LegacyStatHeader } from "../components/LegacyStatHeader";
import {
  type DatabaseHealthIssue,
  type DatabaseHealthReport,
  fetchDatabaseHealth,
  type HealthSeverity,
  reviewDatabaseHealthIssue,
} from "../databaseHealthApi";
import { useAdminSession } from "../hooks/useAdminSession";

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const COUNT_GROUPS = [
  {
    label: "Competition",
    tables: [
      "seasons",
      "divisions",
      "division_playoff_configs",
      "playoff_series",
      "playoff_series_participants",
      "teams",
      "team_logos",
      "team_season_entries",
    ],
  },
  {
    label: "Player identity",
    tables: ["players", "player_friend_codes", "player_aliases", "player_season_entries"],
  },
  {
    label: "Matches",
    tables: ["source_files", "matches", "match_table_refs", "match_teams", "match_players"],
  },
  {
    label: "Races and results",
    tables: [
      "tracks",
      "track_aliases",
      "races",
      "race_team_results",
      "race_player_results",
      "penalties",
    ],
  },
  { label: "Audit", tables: ["database_addition_logs"] },
] as const;

const SEVERITY_STYLES: Record<HealthSeverity, string> = {
  critical: "border-red-400/40 bg-red-950/45 text-red-100",
  warning: "border-amber-300/35 bg-amber-950/40 text-amber-100",
  info: "border-blue-300/30 bg-blue-950/40 text-blue-100",
};

function readableLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string | null): string {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE_FORMATTER.format(date);
}

function formatBytes(value: number | null): string {
  if (value === null) return "Not available";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

type IssueQueueStatus = "active" | "dismissed";

interface IssueExportFilters {
  severity: "all" | HealthSeverity;
  category: string;
  search: string;
  status: IssueQueueStatus;
  includeArchive: boolean;
}

function buildStructuredIssue(
  issue: DatabaseHealthIssue,
  report: DatabaseHealthReport,
  exportedAt: string
) {
  return {
    schema_version: 1,
    export_type: "database_health_issue",
    exported_at: exportedAt,
    source_report: {
      generated_at: report.generated_at,
      database_health_status: report.status,
    },
    issue: {
      key: issue.key,
      severity: issue.severity,
      category: issue.category,
      title: issue.title,
      detail: issue.detail,
      affected_record_count: issue.count,
      included_example_count: issue.entities.length,
      examples_truncated: issue.count > issue.entities.length,
      examples: issue.entities,
      dismissible: issue.dismissible,
      is_dismissed: issue.is_dismissed,
      review: issue.review,
    },
    requested_action:
      "Investigate the finding and propose a source-of-truth remediation. Do not modify source data when the evidence is ambiguous without explicit approval.",
  };
}

function buildIssueQueueReport(
  report: DatabaseHealthReport,
  issues: DatabaseHealthIssue[],
  filters: IssueExportFilters,
  exportedAt: string
): string {
  const filterSummary = [
    `- Severity: ${filters.severity === "all" ? "All severities" : readableLabel(filters.severity)}`,
    `- Category: ${filters.category === "all" ? "All categories" : readableLabel(filters.category)}`,
    `- Search: ${filters.search.trim() ? JSON.stringify(filters.search.trim()) : "None"}`,
    `- Issue status: ${readableLabel(filters.status)}`,
    `- JSON archive checks: ${filters.includeArchive ? "Included" : "Skipped"}`,
  ].join("\n");
  const issueSections =
    issues.length === 0
      ? "No issues matched the selected filters."
      : issues
          .map((issue, index) => {
            const payload = buildStructuredIssue(issue, report, exportedAt);
            return [
              `### ${index + 1}. ${issue.title}`,
              "",
              `- Severity: ${readableLabel(issue.severity)}`,
              `- Category: ${readableLabel(issue.category)}`,
              `- Issue key: \`${issue.key}\``,
              `- Affected records: ${issue.count}`,
              `- Examples included: ${issue.entities.length}${issue.count > issue.entities.length ? " (truncated by the health API)" : ""}`,
              "",
              "````json",
              JSON.stringify(payload, null, 2),
              "````",
            ].join("\n");
          })
          .join("\n\n");

  return [
    "# Database Health Issue Queue Report",
    "",
    `- Exported: ${exportedAt}`,
    `- Source health report generated: ${report.generated_at}`,
    `- Database health status: ${readableLabel(report.status)}`,
    `- Issues included: ${issues.length} of ${report.issues.length}`,
    "",
    "## Applied Filters",
    "",
    filterSummary,
    "",
    "## Instructions For The Investigator",
    "",
    "Investigate each finding against the repository's durable source data and importer/analytics code. Propose a source-of-truth remediation only when the evidence supports it. Do not guess missing historical values or modify ambiguous data without explicit approval. Note that an issue's examples may be capped even when its affected-record count is larger.",
    "",
    "## Issues",
    "",
    issueSections,
    "",
  ].join("\n");
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers expose the API but deny it outside a secure context.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("This browser could not copy the issue to the clipboard.");
}

function downloadMarkdown(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function reportFilename(exportedAt: string): string {
  return `database-health-issue-report-${exportedAt.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")}.md`;
}

export default function DatabaseHealthDashboard() {
  const auth = useAdminSession();
  const [report, setReport] = useState<DatabaseHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [includeArchive, setIncludeArchive] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [severity, setSeverity] = useState<"all" | HealthSeverity>("all");
  const [category, setCategory] = useState("all");
  const [issueSearch, setIssueSearch] = useState("");
  const [additionType, setAdditionType] = useState("all");
  const [issueStatus, setIssueStatus] = useState<IssueQueueStatus>("active");
  const [savingIssueKey, setSavingIssueKey] = useState("");
  const [copiedIssueKey, setCopiedIssueKey] = useState("");

  useEffect(() => {
    if (!auth.session?.authenticated) {
      if (!auth.loading) setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchDatabaseHealth(includeArchive, refreshVersion)
      .then((nextReport) => {
        if (!cancelled) setReport(nextReport);
      })
      .catch((requestError: unknown) => {
        if (!cancelled)
          setError(
            requestError instanceof Error ? requestError.message : "Failed to load database health."
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.loading, auth.session?.authenticated, includeArchive, refreshVersion]);

  const categories = useMemo(
    () => Array.from(new Set((report?.issues ?? []).map((issue) => issue.category))).sort(),
    [report]
  );
  const normalizedIssueSearch = issueSearch.trim().toLocaleLowerCase();
  const filteredIssues = useMemo(
    () =>
      (report?.issues ?? []).filter((issue) => {
        if (issueStatus === "active" && issue.is_dismissed) return false;
        if (issueStatus === "dismissed" && !issue.is_dismissed) return false;
        if (severity !== "all" && issue.severity !== severity) return false;
        if (category !== "all" && issue.category !== category) return false;
        if (!normalizedIssueSearch) return true;
        return `${issue.title} ${issue.detail} ${issue.entities.map((entity) => entity.label).join(" ")}`
          .toLocaleLowerCase()
          .includes(normalizedIssueSearch);
      }),
    [report, severity, category, normalizedIssueSearch, issueStatus]
  );
  const additionTypes = useMemo(
    () => Object.keys(report?.additions.by_entity_type ?? {}).sort(),
    [report]
  );
  const filteredAdditions = useMemo(
    () =>
      (report?.additions.recent ?? []).filter(
        (addition) => additionType === "all" || addition.entity_type === additionType
      ),
    [report, additionType]
  );

  if (!auth.loading && !auth.session?.authenticated) {
    return (
      <main className="relative z-10 min-h-screen bg-black/85 px-5 py-8 text-white sm:px-8">
        <div className="mx-auto max-w-4xl border border-white/15 bg-zinc-950/90 p-5">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-3xl font-bold">Database Health</h1>
            <LeagueHeaderControls />
          </header>
          <AdminSessionPanel {...auth} />
        </div>
      </main>
    );
  }

  async function handleIssueReview(issue: DatabaseHealthIssue) {
    const status = issue.is_dismissed ? "open" : "dismissed";
    const note =
      status === "dismissed"
        ? window.prompt(
            "Why is this finding safe to dismiss? This reason will be saved for future reviewers.",
            issue.review?.note ?? ""
          )
        : "Restored to active review.";
    if (note === null) return;
    setSavingIssueKey(issue.key);
    setError("");
    try {
      await reviewDatabaseHealthIssue(issue.key, status, note);
      setRefreshVersion((value) => value + 1);
    } catch (reviewError: unknown) {
      setError(
        reviewError instanceof Error ? reviewError.message : "Failed to save the review decision."
      );
    } finally {
      setSavingIssueKey("");
    }
  }

  async function handleCopyIssue(issue: DatabaseHealthIssue) {
    if (!report) return;
    setError("");
    try {
      const payload = buildStructuredIssue(issue, report, new Date().toISOString());
      await copyTextToClipboard(JSON.stringify(payload, null, 2));
      setCopiedIssueKey(issue.key);
    } catch (copyError: unknown) {
      setCopiedIssueKey("");
      setError(copyError instanceof Error ? copyError.message : "Failed to copy the issue.");
    }
  }

  function handleGenerateIssueReport() {
    if (!report) return;
    setError("");
    try {
      const exportedAt = new Date().toISOString();
      const contents = buildIssueQueueReport(
        report,
        filteredIssues,
        {
          severity,
          category,
          search: issueSearch,
          status: issueStatus,
          includeArchive,
        },
        exportedAt
      );
      downloadMarkdown(reportFilename(exportedAt), contents);
    } catch (exportError: unknown) {
      setError(
        exportError instanceof Error ? exportError.message : "Failed to generate the issue report."
      );
    }
  }

  return (
    <main className="relative min-h-screen px-4 pb-12 pt-24 font-sans text-white sm:px-6">
      <LegacyStatHeader title="Database Health" />
      <div className="mx-auto max-w-7xl">
        <section className="mb-6 rounded-xl border border-white/15 bg-black/55 p-5 shadow-xl backdrop-blur-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-200">
                Safe monitoring
              </p>
              <h2 className="mt-1 text-2xl font-bold">
                Integrity, additions, counts, and review candidates
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">
                Fuzzy duplicate findings are review suggestions. Review decisions never merge or
                edit statistics records.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={includeArchive}
                  onChange={(event) => setIncludeArchive(event.target.checked)}
                  className="h-4 w-4 accent-blue-500"
                />
                Check JSON archive
              </label>
              <button
                type="button"
                onClick={() => setRefreshVersion((value) => value + 1)}
                disabled={loading}
                className="rounded-md border border-blue-300/50 bg-blue-950/70 px-4 py-2 font-semibold text-blue-100 transition hover:bg-blue-900/70 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-wait disabled:opacity-50"
              >
                {loading ? "Checking..." : "Refresh checks"}
              </button>
            </div>
          </div>
        </section>

        {error && (
          <p
            role="alert"
            className="mb-6 rounded-lg border border-red-400/40 bg-red-950/60 p-4 text-red-100"
          >
            {error}
          </p>
        )}
        {loading && !report && (
          <p aria-live="polite" className="py-16 text-center text-gray-300">
            Running database health checks...
          </p>
        )}

        {report && (
          <div className={loading ? "opacity-70 transition-opacity" : "transition-opacity"}>
            <HealthSummary report={report} />

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <IssuePanel
                issues={filteredIssues}
                total={report.issues.length}
                severity={severity}
                category={category}
                search={issueSearch}
                categories={categories}
                issueStatus={issueStatus}
                savingIssueKey={savingIssueKey}
                copiedIssueKey={copiedIssueKey}
                onSeverityChange={setSeverity}
                onCategoryChange={setCategory}
                onSearchChange={setIssueSearch}
                onIssueStatusChange={setIssueStatus}
                onReview={handleIssueReview}
                onCopyIssue={handleCopyIssue}
                onGenerateReport={handleGenerateIssueReport}
              />
              <OperationalPanel report={report} />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <CountPanel counts={report.counts} />
              <AdditionPanel
                report={report}
                additions={filteredAdditions}
                additionType={additionType}
                additionTypes={additionTypes}
                onTypeChange={setAdditionType}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function HealthSummary({ report }: { report: DatabaseHealthReport }) {
  const statusStyles =
    report.status === "healthy"
      ? "border-emerald-300/40 bg-emerald-950/55 text-emerald-100"
      : report.status === "warning"
        ? "border-amber-300/40 bg-amber-950/55 text-amber-100"
        : "border-red-400/45 bg-red-950/60 text-red-100";
  const cards = [
    { label: "Critical findings", value: report.summary.critical, color: "text-red-300" },
    { label: "Warnings", value: report.summary.warnings, color: "text-amber-200" },
    {
      label: "Record count",
      value: report.summary.total_records.toLocaleString(),
      color: "text-white",
    },
    {
      label: "Logged additions",
      value: report.additions.total.toLocaleString(),
      color: "text-blue-200",
    },
    {
      label: "Needs review",
      value: report.summary.matches_needing_review,
      color: "text-amber-200",
    },
    { label: "Dismissed findings", value: report.summary.dismissed, color: "text-gray-300" },
  ];
  return (
    <section aria-label="Database health summary">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <div className={`rounded-xl border p-4 ${statusStyles}`}>
          <p className="text-xs font-semibold uppercase tracking-wide">Overall status</p>
          <p className="mt-2 text-2xl font-bold capitalize">{report.status}</p>
          <p className="mt-1 text-xs opacity-80">Checked {formatDate(report.generated_at)}</p>
        </div>
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-white/15 bg-black/60 p-4 shadow-lg"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {card.label}
            </p>
            <p className={`mt-2 text-2xl font-bold tabular-nums ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function IssuePanel({
  issues,
  total,
  severity,
  category,
  search,
  categories,
  issueStatus,
  savingIssueKey,
  copiedIssueKey,
  onSeverityChange,
  onCategoryChange,
  onSearchChange,
  onIssueStatusChange,
  onReview,
  onCopyIssue,
  onGenerateReport,
}: {
  issues: DatabaseHealthIssue[];
  total: number;
  severity: "all" | HealthSeverity;
  category: string;
  search: string;
  categories: string[];
  issueStatus: IssueQueueStatus;
  savingIssueKey: string;
  copiedIssueKey: string;
  onSeverityChange: (value: "all" | HealthSeverity) => void;
  onCategoryChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onIssueStatusChange: (value: IssueQueueStatus) => void;
  onReview: (issue: DatabaseHealthIssue) => void;
  onCopyIssue: (issue: DatabaseHealthIssue) => void;
  onGenerateReport: () => void;
}) {
  return (
    <section className="rounded-xl border border-white/15 bg-black/55 shadow-xl">
      <div className="border-b border-white/10 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Issue queue</h2>
            <p className="mt-1 text-sm text-gray-400">
              Showing {issues.length} of {total} issue groups
            </p>
          </div>
          <button
            type="button"
            onClick={onGenerateReport}
            className="rounded-md border border-blue-300/50 bg-blue-950/70 px-3 py-2 text-sm font-semibold text-blue-100 transition hover:bg-blue-900/70 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            Generate filtered report
          </button>
          <div className="grid w-full gap-2 sm:grid-cols-2">
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search issues..."
              aria-label="Search health issues"
              className="rounded-md border border-gray-500 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-400 sm:col-span-2"
            />
            <select
              value={severity}
              onChange={(event) => onSeverityChange(event.target.value as "all" | HealthSeverity)}
              aria-label="Filter by severity"
              className="rounded-md border border-gray-500 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warnings</option>
              <option value="info">Informational</option>
            </select>
            <select
              value={category}
              onChange={(event) => onCategoryChange(event.target.value)}
              aria-label="Filter by category"
              className="rounded-md border border-gray-500 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="all">All categories</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {readableLabel(value)}
                </option>
              ))}
            </select>
            <fieldset
              aria-label="Filter by issue status"
              className="grid grid-cols-2 rounded-md border border-gray-500 bg-black/30 p-1 sm:col-span-2"
            >
              {(["active", "dismissed"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => onIssueStatusChange(status)}
                  aria-pressed={issueStatus === status}
                  className={`rounded px-3 py-1.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                    issueStatus === status
                      ? "bg-blue-700 text-white shadow"
                      : "text-gray-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {readableLabel(status)}
                </button>
              ))}
            </fieldset>
          </div>
        </div>
      </div>
      <div className="max-h-[46rem] space-y-3 overflow-y-auto p-4">
        {issues.length === 0 ? (
          <p className="py-10 text-center text-gray-300">No issues match the current filters.</p>
        ) : (
          issues.map((issue) => (
            <IssueCard
              key={issue.key}
              issue={issue}
              saving={savingIssueKey === issue.key}
              copied={copiedIssueKey === issue.key}
              onReview={onReview}
              onCopy={onCopyIssue}
            />
          ))
        )}
      </div>
    </section>
  );
}

function IssueCard({
  issue,
  saving,
  copied,
  onReview,
  onCopy,
}: {
  issue: DatabaseHealthIssue;
  saving: boolean;
  copied: boolean;
  onReview: (issue: DatabaseHealthIssue) => void;
  onCopy: (issue: DatabaseHealthIssue) => void;
}) {
  return (
    <details
      className={`rounded-lg border p-4 ${SEVERITY_STYLES[issue.severity]} ${issue.is_dismissed ? "opacity-65" : ""}`}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-current/30 px-2 py-0.5 text-xs font-bold uppercase">
                {issue.severity}
              </span>
              <span className="text-xs font-semibold uppercase opacity-75">
                {readableLabel(issue.category)}
              </span>
              {issue.is_dismissed && (
                <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs font-bold uppercase text-gray-100">
                  Dismissed
                </span>
              )}
            </div>
            <h3 className="mt-2 font-bold">{issue.title}</h3>
            <p className="mt-1 text-sm opacity-85">{issue.detail}</p>
          </div>
          <span className="rounded-full bg-black/30 px-3 py-1 text-sm font-bold tabular-nums">
            {issue.count}
          </span>
        </div>
      </summary>
      {issue.entities.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-current/15 pt-3 text-sm">
          {issue.entities.map((entity, index) => (
            <li key={`${entity.id ?? "none"}-${index}`} className="break-words">
              {entity.label}
              {entity.id !== null ? ` · ID ${entity.id}` : ""}
              {entity.value !== undefined ? ` · ${entity.value}` : ""}
            </li>
          ))}
          {issue.count > issue.entities.length && (
            <li className="opacity-70">+ {issue.count - issue.entities.length} more</li>
          )}
        </ul>
      )}
      {issue.review && (
        <div className="mt-3 rounded-md border border-current/15 bg-black/20 p-3 text-sm">
          <p>
            <span className="font-semibold">Review note:</span>{" "}
            {issue.review.note || "No note provided."}
          </p>
          <p className="mt-1 text-xs opacity-70">
            {issue.review.reviewed_by} · {formatDate(issue.review.reviewed_at)}
          </p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onCopy(issue)}
          className="rounded-md border border-current/30 bg-black/25 px-3 py-2 text-sm font-semibold transition hover:bg-black/40 focus:outline-none focus:ring-2 focus:ring-current"
          aria-label={`Copy structured issue: ${issue.title}`}
          aria-live="polite"
        >
          {copied ? "Copied structured issue" : "Copy structured issue"}
        </button>
        {issue.dismissible && (
          <button
            type="button"
            onClick={() => onReview(issue)}
            disabled={saving}
            className="rounded-md border border-current/30 bg-black/25 px-3 py-2 text-sm font-semibold transition hover:bg-black/40 disabled:cursor-wait disabled:opacity-50"
          >
            {saving ? "Saving..." : issue.is_dismissed ? "Restore finding" : "Dismiss with reason"}
          </button>
        )}
      </div>
      {!issue.dismissible && (
        <p className="mt-3 text-xs font-semibold opacity-70">
          Fix the underlying source data to clear this finding.
        </p>
      )}
    </details>
  );
}

function OperationalPanel({ report }: { report: DatabaseHealthReport }) {
  const database = report.database;
  const engineName =
    database.backend === "postgresql" ? "PostgreSQL" : readableLabel(database.backend);
  const foreignKeys = database.integrity.foreign_keys;
  const constraintSummary =
    foreignKeys.constraints === null
      ? "Not available"
      : foreignKeys.validated === null
        ? `${foreignKeys.constraints} configured`
        : `${foreignKeys.validated} of ${foreignKeys.constraints} validated`;
  const archiveItems = [
    ["Missing files", report.archive.missing_files.length],
    ["Hash mismatches", report.archive.hash_mismatches.length],
    ["Unimported files", report.archive.orphan_files.length],
  ];
  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-white/15 bg-black/55 p-5 shadow-xl">
        <h2 className="text-xl font-bold">Database integrity</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Detail
            label="Database engine"
            value={`${engineName}${database.version ? ` ${database.version}` : ""}`}
          />
          <Detail label="Connection status" value={database.connection_status.toUpperCase()} />
          <Detail label="Database name" value={database.name || "Not available"} breakWords />
          <Detail
            label="Schema revision"
            value={database.schema_revision || "Not available"}
            breakWords
          />
          <Detail label="Database size" value={formatBytes(database.size_bytes)} />
          <Detail
            label="Physical integrity scan"
            value={readableLabel(database.integrity.physical.status)}
          />
          <Detail label="Integrity method" value={database.integrity.physical.method} breakWords />
          <Detail label="Foreign-key constraints" value={constraintSummary} />
          {foreignKeys.unvalidated !== null ? (
            <Detail label="Unvalidated constraints" value={String(foreignKeys.unvalidated)} />
          ) : null}
          {foreignKeys.violations !== null ? (
            <Detail label="Foreign-key violations" value={String(foreignKeys.violations)} />
          ) : null}
          <Detail label="Latest import" value={formatDate(database.latest_import_at)} />
          <Detail label="Latest logged addition" value={formatDate(database.latest_addition_at)} />
        </dl>
      </div>
      <div className="rounded-xl border border-white/15 bg-black/55 p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">JSON archive</h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${report.archive.status === "ok" ? "bg-emerald-900 text-emerald-100" : report.archive.status === "warning" ? "bg-amber-900 text-amber-100" : "bg-gray-700 text-gray-200"}`}
          >
            {report.archive.status}
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
          {archiveItems.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-white/5 p-3">
              <dt className="text-xs text-gray-400">{label}</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Detail({
  label,
  value,
  breakWords = false,
}: {
  label: string;
  value: string;
  breakWords?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={`mt-1 font-semibold text-gray-100 ${breakWords ? "break-all text-sm" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function CountPanel({ counts }: { counts: Record<string, number> }) {
  const displayedTables = new Set<string>(COUNT_GROUPS.flatMap((group) => [...group.tables]));
  const extraTables = Object.keys(counts)
    .filter((table) => !displayedTables.has(table))
    .sort();
  return (
    <section className="rounded-xl border border-white/15 bg-black/55 p-5 shadow-xl">
      <h2 className="text-xl font-bold">Record counts</h2>
      <p className="mt-1 text-sm text-gray-400">Current rows in every application table.</p>
      <div className="mt-4 space-y-5">
        {COUNT_GROUPS.map((group) => (
          <div key={group.label}>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-blue-200">
              {group.label}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.tables
                .filter((table) => table in counts)
                .map((table) => (
                  <CountRow key={table} table={table} count={counts[table]} />
                ))}
            </div>
          </div>
        ))}
        {extraTables.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {extraTables.map((table) => (
              <CountRow key={table} table={table} count={counts[table]} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CountRow({ table, count }: { table: string; count: number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2">
      <span className="text-sm text-gray-300">{readableLabel(table)}</span>
      <span className="font-bold tabular-nums">{count.toLocaleString()}</span>
    </div>
  );
}

function AdditionPanel({
  report,
  additions,
  additionType,
  additionTypes,
  onTypeChange,
}: {
  report: DatabaseHealthReport;
  additions: DatabaseHealthReport["additions"]["recent"];
  additionType: string;
  additionTypes: string[];
  onTypeChange: (value: string) => void;
}) {
  return (
    <section className="rounded-xl border border-white/15 bg-black/55 shadow-xl">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 p-5">
        <div>
          <h2 className="text-xl font-bold">Recent additions</h2>
          <p className="mt-1 text-sm text-gray-400">
            Latest {report.additions.recent.length} durable upload events
          </p>
        </div>
        <select
          value={additionType}
          onChange={(event) => onTypeChange(event.target.value)}
          aria-label="Filter additions by entity type"
          className="rounded-md border border-gray-500 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">All entity types</option>
          {additionTypes.map((type) => (
            <option key={type} value={type}>
              {readableLabel(type)} ({report.additions.by_entity_type[type]})
            </option>
          ))}
        </select>
      </div>
      <ol className="max-h-[52rem] divide-y divide-white/10 overflow-y-auto">
        {additions.length === 0 ? (
          <li className="p-8 text-center text-gray-300">No additions match this filter.</li>
        ) : (
          additions.map((addition) => (
            <li key={addition.id} className="p-4 transition-colors hover:bg-white/5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-100">{addition.summary}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {readableLabel(addition.entity_type)} · Record {addition.entity_id}
                    {addition.match_id ? ` · Match ${addition.match_id}` : ""}
                  </p>
                </div>
                <time
                  className="shrink-0 text-right text-xs text-gray-400"
                  dateTime={addition.created_at ?? undefined}
                >
                  {formatDate(addition.created_at)}
                </time>
              </div>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}

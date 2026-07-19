import { fetchJson, postJson, type DatabaseAddition } from "./api";

export type HealthSeverity = "critical" | "warning" | "info";

export interface DatabaseHealthEntity {
  id: number | null;
  label: string;
  value?: string | number | null;
}

export interface DatabaseHealthIssue {
  key: string;
  severity: HealthSeverity;
  category: string;
  title: string;
  detail: string;
  count: number;
  entities: DatabaseHealthEntity[];
  dismissible: boolean;
  is_dismissed: boolean;
  review: {
    status: "open" | "dismissed";
    note: string;
    reviewed_at: string;
    reviewed_by: string;
  } | null;
}

export interface ArchiveHealth {
  status: "ok" | "warning" | "skipped";
  missing_files: Array<Record<string, string>>;
  hash_mismatches: Array<Record<string, string>>;
  orphan_files: Array<Record<string, string>>;
}

export interface DatabaseHealthReport {
  generated_at: string;
  status: "healthy" | "warning" | "critical";
  database: {
    path: string;
    size_bytes: number | null;
    integrity: "ok" | "failed";
    foreign_key_violations: number;
    latest_import_at: string | null;
    latest_addition_at: string | null;
  };
  summary: {
    critical: number;
    warnings: number;
    informational: number;
    dismissed: number;
    matches_needing_review: number;
    total_records: number;
  };
  counts: Record<string, number>;
  additions: {
    total: number;
    by_entity_type: Record<string, number>;
    recent: DatabaseAddition[];
  };
  archive: ArchiveHealth;
  issues: DatabaseHealthIssue[];
}

export function reviewDatabaseHealthIssue(
  issueKey: string,
  status: "open" | "dismissed",
  note: string
): Promise<{ issue_key: string; review: NonNullable<DatabaseHealthIssue["review"]> }> {
  return postJson<{ issue_key: string; review: NonNullable<DatabaseHealthIssue["review"]> }>(
    "/api/database-health/reviews",
    {
    issue_key: issueKey,
    status,
    note,
    }
  );
}

export function fetchDatabaseHealth(
  includeArchive = true,
  refreshVersion = 0
): Promise<DatabaseHealthReport> {
  return fetchJson("/api/database-health", {
    include_archive: includeArchive ? 1 : 0,
    refresh: refreshVersion || undefined,
  });
}

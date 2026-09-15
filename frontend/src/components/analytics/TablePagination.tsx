import { type ReactNode, useState } from "react";

const PAGE_SIZE = 10;

export type CsvValue = boolean | number | string | null | undefined;

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row, index: number) => CsvValue;
}

function escapeCsv(value: CsvValue) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function downloadCsv<Row>(filename: string, columns: CsvColumn<Row>[], rows: Row[]) {
  const csvRows = [
    columns.map((column) => column.header),
    ...rows.map((row, index) => columns.map((column) => column.value(row, index))),
  ];
  const csv = `\uFEFF${csvRows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function csvFilename(...parts: Array<number | string | null | undefined>) {
  return `${parts
    .filter((part) => part != null && String(part).trim())
    .map((part) =>
      String(part)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
    )
    .filter(Boolean)
    .join("-")}.csv`;
}

export function usePaginatedRows<Row>(rows: Row[], resetKey: string, pageSize = PAGE_SIZE) {
  const [pagination, setPagination] = useState({ resetKey, page: 1 });
  const page = pagination.resetKey === resetKey ? pagination.page : 1;

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const firstIndex = (currentPage - 1) * pageSize;

  return {
    page: currentPage,
    pageCount,
    firstIndex,
    rows: rows.slice(firstIndex, firstIndex + pageSize),
    setPage: (nextPage: number) =>
      setPagination({ resetKey, page: Math.min(pageCount, Math.max(1, nextPage)) }),
  };
}

export function TablePaginationControls({
  label,
  total,
  page,
  pageCount,
  firstIndex,
  onPageChange,
  onExport,
  beforeActions,
}: {
  label: string;
  total: number;
  page: number;
  pageCount: number;
  firstIndex: number;
  onPageChange: (page: number) => void;
  onExport?: () => void;
  beforeActions?: ReactNode;
}) {
  const firstShown = total ? firstIndex + 1 : 0;
  const lastShown = Math.min(firstIndex + PAGE_SIZE, total);
  const buttonClass =
    "min-h-10 rounded-md border border-white/20 bg-white/5 px-3 text-sm font-semibold text-white transition hover:border-blue-300/60 hover:bg-blue-500/15 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/20 disabled:hover:bg-white/5";

  return (
    <div className="flex flex-col gap-3 rounded-md border border-white/10 bg-white/[.03] p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-gray-300" aria-live="polite">
        Showing{" "}
        <strong className="text-white">
          {firstShown}–{lastShown}
        </strong>{" "}
        of <strong className="text-white">{total}</strong>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {beforeActions}
        {onExport && (
          <button type="button" className={buttonClass} onClick={onExport} disabled={!total}>
            Export CSV
          </button>
        )}
        <button
          type="button"
          className={buttonClass}
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          aria-label={`Previous ${label} page`}
        >
          ← Previous
        </button>
        <span className="min-w-24 text-center text-sm font-semibold text-gray-200">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          className={buttonClass}
          onClick={() => onPageChange(page + 1)}
          disabled={page === pageCount}
          aria-label={`Next ${label} page`}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

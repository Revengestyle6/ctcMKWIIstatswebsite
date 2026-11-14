import { useLayoutEffect, useRef, useState } from "react";

/** Let the audit's natural height determine the leaderboard's row budget. */
export function useAuditLeaderboardLayout(enabled: boolean, layoutKey: string) {
  const leaderboardRef = useRef<HTMLElement>(null);
  const auditPanelRef = useRef<HTMLElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const tableViewportRef = useRef<HTMLDivElement>(null);
  const tableHeaderRef = useRef<HTMLTableSectionElement>(null);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const paginationRef = useRef<HTMLElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);
  const rowMeasurement = useRef({ key: "", width: 0, height: 40 });
  const [height, setHeight] = useState<number>();
  const [minimumHeight, setMinimumHeight] = useState(0);
  const [pageSize, setPageSize] = useState(8);

  useLayoutEffect(() => {
    if (!enabled) return;
    const leaderboard = leaderboardRef.current;
    const audit = auditPanelRef.current;
    const controls = controlsRef.current;
    const viewport = tableViewportRef.current;
    const header = tableHeaderRef.current;
    const body = tableBodyRef.current;
    const pagination = paginationRef.current;
    if (!leaderboard || !audit || !controls || !viewport || !header || !body || !pagination) return;

    let frame = 0;
    const measure = () => {
      const width = leaderboard.getBoundingClientRect().width;
      if (width !== rowMeasurement.current.width || layoutKey !== rowMeasurement.current.key) {
        rowMeasurement.current = { key: layoutKey, width, height: 40 };
      }
      // Remember the tallest row at this width/filter so mixed eligible and
      // ineligible rows cannot cause repeated growth/shrink cycles between pages.
      for (const row of Array.from(body.rows))
        rowMeasurement.current.height = Math.max(
          rowMeasurement.current.height,
          row.getBoundingClientRect().height
        );
      const rowHeight = rowMeasurement.current.height;
      const scrollbarHeight = viewport.offsetHeight - viewport.clientHeight;
      const fixedHeight =
        controls.getBoundingClientRect().height +
        header.getBoundingClientRect().height +
        pagination.getBoundingClientRect().height +
        scrollbarHeight +
        2;
      const minimum = Math.ceil(
        fixedHeight + Math.max(rowHeight, emptyRef.current?.getBoundingClientRect().height ?? 0)
      );
      const target = Math.max(audit.getBoundingClientRect().height, minimum);
      setMinimumHeight((current) => (current === minimum ? current : minimum));
      setHeight((current) => (current === target ? current : target));
      const capacity = Math.max(1, Math.floor((target - fixedHeight) / rowHeight));
      setPageSize((current) => (current === capacity ? current : capacity));
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    for (const element of [audit, controls, viewport, header, body, pagination])
      observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [enabled, layoutKey]);

  return {
    leaderboardRef,
    auditPanelRef,
    controlsRef,
    tableViewportRef,
    tableHeaderRef,
    tableBodyRef,
    paginationRef,
    emptyRef,
    height,
    minimumHeight,
    pageSize,
  };
}

import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../../api";
import type { RaceDraft } from "./matchJsonEditorModel";
import {
  imageDisclosure,
  ResultsImageAccessMessage,
  useResultsImageAccess,
} from "./ResultsImageAccess";
import ResultsImagePicker from "./ResultsImagePicker";
import { scanResultsImage } from "./raceResultsImage";
import type { RecognizedResultRow, ResultsRosterPlayer } from "./raceResultsImport";

type Props = {
  races: readonly RaceDraft[];
  roster: readonly ResultsRosterPlayer[];
  onExtracted: (index: number, rows: RecognizedResultRow[]) => number;
  onClose: () => void;
};

type ImageSlot = {
  file?: File;
  loading?: boolean;
  status?: string;
  phase?: "running" | "waiting" | "retrying" | "complete" | "failed";
};

const phaseLabels = {
  running: "Extracting",
  waiting: "Waiting for the rate limit",
  retrying: "Waiting to retry",
  complete: "Complete",
  failed: "Failed",
};

function waitForDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const timer = window.setTimeout(stop, milliseconds);
    signal.addEventListener("abort", stop, { once: true });
  });
}

export default function BulkResultsImageDialog({ races, roster, onExtracted, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const extraction = useRef<AbortController>(null);
  const id = useId();
  const access = useResultsImageAccess();
  const [slots, setSlots] = useState<Partial<Record<number, ImageSlot>>>({});
  const [running, setRunning] = useState(false);
  const [batch, setBatch] = useState<number[]>();

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      extraction.current?.abort();
      element?.close();
    };
  }, []);

  function updateSlot(index: number, patch: Partial<ImageSlot>) {
    setSlots((current) => ({ ...current, [index]: { ...current[index], ...patch } }));
  }

  const queued = races.flatMap((race, index) => {
    const file = slots[index]?.file;
    return file ? [{ race, index, file }] : [];
  });

  const progress = batch ?? queued.map(({ index }) => index);
  const loadingImage = Object.values(slots).some((slot) => slot?.loading);
  const canReturn =
    !running &&
    !loadingImage &&
    queued.length === 0 &&
    Boolean(batch?.length && batch.every((index) => slots[index]?.phase === "complete"));

  function selectFile(index: number, file?: File) {
    setBatch(undefined);
    updateSlot(index, { file, status: undefined, phase: undefined });
  }

  async function runExtraction() {
    if (!queued.length || extraction.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    extraction.current = controller;
    setRunning(true);
    setBatch(queued.map(({ index }) => index));
    setSlots((current) => {
      const next = { ...current };
      for (const { index, file } of queued) next[index] = { file };
      return next;
    });
    async function attempt({ race, file, index }: (typeof queued)[number], retry: boolean) {
      if (signal.aborted) return;
      updateSlot(index, { status: "Extracting results…", phase: "running" });
      try {
        const rows = await scanResultsImage(file, roster, race.roomSize, signal);
        if (signal.aborted) return;
        const added = onExtracted(index, rows);
        updateSlot(index, {
          file: undefined,
          phase: "complete",
          status: added
            ? `Added ${added} ${added === 1 ? "placement" : "placements"}.`
            : "No new placements were added.",
        });
      } catch (failure) {
        if (signal.aborted) return;
        if (retry) {
          updateSlot(index, {
            phase: "failed",
            status: failure instanceof Error ? failure.message : "Could not extract the results.",
          });
          return;
        }

        const rateLimited = failure instanceof ApiError && failure.status === 429;
        const retryAfter = rateLimited ? failure.details.retry_after_seconds : undefined;
        const delay =
          typeof retryAfter === "number" && Number.isInteger(retryAfter)
            ? Math.max(5, retryAfter)
            : 5;
        updateSlot(index, {
          status: rateLimited ? "Rate limited · Retry queued" : "Retry queued",
          phase: rateLimited ? "waiting" : "retrying",
        });
        return { retryAt: performance.now() + delay * 1_000, rateLimited };
      }
    }

    try {
      const retries = await Promise.all(queued.map((item) => attempt(item, false)));
      await Promise.all(
        queued.map(async (item, index) => {
          const retry = retries[index];
          if (!retry || signal.aborted) return;
          const remaining = retry.retryAt - performance.now();
          if (remaining > 0) {
            const seconds = Math.ceil(remaining / 1_000);
            updateSlot(item.index, {
              status: retry.rateLimited
                ? `Waiting for the rate limit (${seconds}s)…`
                : `Retrying in ${seconds}s…`,
            });
            await waitForDelay(remaining, signal);
          }
          await attempt(item, true);
        })
      );
    } finally {
      extraction.current = null;
      if (!signal.aborted) setRunning(false);
    }
  }

  function close() {
    extraction.current?.abort();
    onClose();
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-1rem)] max-w-5xl flex-col overflow-hidden rounded-lg border border-white/20 bg-zinc-950 p-0 text-white shadow-2xl backdrop:bg-black/75 open:flex"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4 sm:px-6">
        <h2 id={`${id}-title`} className="text-xl font-bold">
          Bulk Extraction
        </h2>
        <button
          type="button"
          onClick={close}
          className="rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15"
        >
          {running ? "Stop and close" : "Close"}
        </button>
      </div>
      {access === "ready" ? (
        <>
          <section
            aria-label="Race images"
            className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-3 sm:px-6"
          >
            <p className="mt-2 text-sm text-gray-300">{imageDisclosure}</p>
            <p className="mt-1 text-sm text-gray-300">
              Paste, drop, or choose an image for any race.
            </p>
            <div className="mt-3 space-y-4">
              {Array.from({ length: Math.ceil(races.length / 4) }, (_, gpIndex) => {
                const start = gpIndex * 4;
                const gpRaces = races.slice(start, start + 4);
                return (
                  <div
                    key={gpRaces[0].raceNumber}
                    className={`relative grid gap-1.5 md:grid-cols-2 ${gpIndex > 0 ? "before:pointer-events-none before:absolute before:inset-x-0 before:-top-2 before:border-t before:border-dashed before:border-white/30 before:content-['']" : ""}`}
                  >
                    {gpRaces.map((race, raceIndex) => {
                      const index = start + raceIndex;
                      const slot = slots[index];
                      const trackName = race.trackName.trim();
                      const raceLabel = `Race ${race.raceNumber}${trackName ? `: ${trackName}` : ""}`;
                      return (
                        <ResultsImagePicker
                          key={race.raceNumber}
                          label={`Image for ${raceLabel}`}
                          file={slot?.file}
                          compact
                          disabled={running}
                          onFile={(file) => selectFile(index, file)}
                          onLoading={(loading) => updateSlot(index, { loading })}
                          description={
                            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                              <h3 className="min-w-0 break-words text-sm font-semibold leading-tight">
                                {raceLabel}
                              </h3>
                              {slot?.status && (
                                <p
                                  className={`min-w-0 break-words text-xs ${slot.phase === "failed" ? "text-amber-200" : "text-gray-300"}`}
                                  role="status"
                                >
                                  {slot.status}
                                </p>
                              )}
                            </div>
                          }
                        >
                          {slot?.file && !slot.loading && !running && (
                            <button
                              type="button"
                              onClick={() => selectFile(index)}
                              aria-label="Remove image"
                              className="rounded px-1.5 py-1 text-xs text-gray-300 hover:text-white"
                            >
                              Remove
                            </button>
                          )}
                        </ResultsImagePicker>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/15 bg-zinc-950 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
              {progress.length > 0 && (
                <ol aria-label="Extraction progress" className="flex w-full max-w-sm gap-px">
                  {progress.map((index) => {
                    const raceNumber = races[index].raceNumber;
                    const phase = batch ? slots[index]?.phase : undefined;
                    const label = `Race ${raceNumber}: ${phase ? phaseLabels[phase] : "Queued"}`;
                    return (
                      <li
                        key={index}
                        aria-label={label}
                        title={label}
                        className={`relative flex h-6 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-sm border text-[10px] font-semibold tabular-nums sm:text-xs ${
                          phase === "failed"
                            ? "border-red-400/70 bg-red-950/60 text-red-100"
                            : phase === "waiting" || phase === "retrying"
                              ? "border-amber-400/70 bg-amber-950/60 text-amber-100"
                              : phase === "running"
                                ? "border-emerald-400/70 bg-emerald-950/50 text-white"
                                : "border-white/10 bg-white/10 text-gray-200"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`absolute inset-0 origin-left bg-emerald-500/55 motion-safe:transition-transform motion-safe:duration-300 ${phase === "complete" ? "scale-x-100" : "scale-x-0"}`}
                        />
                        <span aria-hidden="true" className="relative">
                          {raceNumber}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
              <span
                className={`text-gray-300 ${progress.length ? "text-xs" : "self-start text-sm"}`}
              >
                {queued.length} {queued.length === 1 ? "image" : "images"} queued
              </span>
            </div>
            <button
              type="button"
              disabled={!canReturn && (running || !queued.length || loadingImage)}
              onClick={canReturn ? close : () => void runExtraction()}
              className="shrink-0 whitespace-nowrap rounded-md bg-emerald-500 px-2 py-2 text-sm font-bold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4 sm:text-base"
            >
              {running ? "Extracting results…" : canReturn ? "Return to Editor" : "Run Extraction"}
            </button>
          </div>
        </>
      ) : (
        <div className="px-4 pb-4 sm:px-6 sm:pb-6">
          <ResultsImageAccessMessage access={access} />
        </div>
      )}
    </dialog>
  );
}

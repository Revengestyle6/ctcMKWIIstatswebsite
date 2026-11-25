import { useEffect, useRef, useState } from "react";
import {
  imageDisclosure,
  ResultsImageAccessMessage,
  useResultsImageAccess,
} from "./ResultsImageAccess";
import ResultsImagePicker from "./ResultsImagePicker";
import { scanResultsImage } from "./raceResultsImage";
import type { RecognizedResultRow, ResultsRosterPlayer } from "./raceResultsImport";

type Props = {
  id: string;
  focusOnMount: boolean;
  blocked: boolean;
  raceNumber: number;
  roomSize: number;
  roster: ResultsRosterPlayer[];
  onExtracted: (rows: RecognizedResultRow[]) => void;
};

export default function ResultsImageUploader({
  id,
  focusOnMount,
  blocked,
  raceNumber,
  roomSize,
  roster,
  onExtracted,
}: Props) {
  const access = useResultsImageAccess();
  const extraction = useRef<AbortController>(null);
  const [file, setFile] = useState<File>();
  const [running, setRunning] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => () => extraction.current?.abort(), []);

  async function runExtraction() {
    if (blocked || !file || extraction.current) return;
    const controller = new AbortController();
    extraction.current = controller;
    setFile(undefined);
    setRunning(true);
    setError(undefined);
    try {
      const rows = await scanResultsImage(file, roster, roomSize, controller.signal);
      if (!controller.signal.aborted) onExtracted(rows);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Could not extract the results.");
      }
    } finally {
      extraction.current = null;
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  return (
    <section id={id} className="mb-4" aria-label={`Image extraction for Race ${raceNumber}`}>
      {access === "ready" ? (
        <ResultsImagePicker
          label="Results image"
          file={file}
          disabled={blocked || running}
          submitted={running}
          focusOnMount={focusOnMount}
          onFile={(selected) => {
            setFile(selected);
            setError(undefined);
          }}
          onLoading={setLoadingImage}
          description={<p className="text-xs text-gray-300">{imageDisclosure}</p>}
        >
          <button
            type="button"
            disabled={blocked || !file || running || loadingImage}
            onClick={() => void runExtraction()}
            className="rounded-md bg-emerald-500 px-4 py-2 font-bold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "Extracting results…" : "Run Extraction"}
          </button>
        </ResultsImagePicker>
      ) : (
        <ResultsImageAccessMessage access={access} />
      )}
      {error && (
        <p className="mt-2 text-sm text-amber-200" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

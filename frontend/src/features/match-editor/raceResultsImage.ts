import { postFormData } from "../../api";
import type { RecognizedResultRow, ResultsRosterPlayer } from "./raceResultsImport";

export const resultsImportPath = "/api/admin/race-results-image";

const maxImageBytes = 25_000_000;

export async function readDroppedImage(url: string, signal: AbortSignal): Promise<File> {
  const source = new URL(url);
  if (!["https:", "http:", "blob:", "data:"].includes(source.protocol)) {
    throw new Error("Unsupported image source.");
  }
  const response = await fetch(source, {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  const type = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (!response.ok || !type.startsWith("image/") || !response.body) {
    throw new Error("The link did not return an image.");
  }
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxImageBytes) {
      await reader.cancel();
      throw new Error("Choose an image smaller than 25 MB.");
    }
    chunks.push(value);
  }
  return new File(chunks, "Dropped image", { type });
}

async function prepareImage(file: File): Promise<Blob> {
  if (file.size > maxImageBytes) throw new Error("Choose an image smaller than 25 MB.");
  const image = await createImageBitmap(file).catch(() => {
    throw new Error("This image could not be opened. Try PNG, JPEG, or WebP.");
  });
  const canvas = document.createElement("canvas");
  try {
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    if (Math.min(canvas.width, canvas.height) < 20) {
      throw new Error("Choose a larger results image.");
    }
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser could not prepare the image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    image.close();
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not prepare the results image."));
      },
      "image/jpeg",
      0.9
    );
  });
}

export async function scanResultsImage(
  image: File,
  roster: readonly ResultsRosterPlayer[],
  roomSize: number,
  signal: AbortSignal
): Promise<RecognizedResultRow[]> {
  const prepared = await prepareImage(image);
  signal.throwIfAborted();
  const body = new FormData();
  body.set("image", prepared, "results.jpg");
  body.set("roomSize", String(roomSize));
  body.set("roster", JSON.stringify(roster.map(({ miiName }) => miiName)));
  const result = await postFormData<{ rows: RecognizedResultRow[] }>(
    resultsImportPath,
    body,
    signal
  );
  return result.rows;
}

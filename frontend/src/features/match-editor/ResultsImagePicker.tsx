import { type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { readDroppedImage } from "./raceResultsImage";

type Props = {
  label: string;
  file?: File;
  disabled: boolean;
  compact?: boolean;
  submitted?: boolean;
  focusOnMount?: boolean;
  description?: ReactNode;
  children?: ReactNode;
  onFile: (file?: File) => void;
  onLoading: (loading: boolean) => void;
};

const buttonClass =
  "rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-40";

export default function ResultsImagePicker({
  label,
  file,
  disabled,
  compact = false,
  submitted,
  focusOnMount,
  description,
  children,
  onFile,
  onLoading,
}: Props) {
  const pickerButtonClass = compact
    ? "rounded border border-white/15 bg-white/10 px-2 py-1 text-xs font-semibold hover:bg-white/15 disabled:opacity-40"
    : buttonClass;
  const panel = useRef<HTMLElement>(null);
  const imageRead = useRef<AbortController>(null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (focusOnMount) panel.current?.focus({ preventScroll: true });
  }, [focusOnMount]);

  useEffect(() => () => imageRead.current?.abort(), []);

  function updateLoading(active: boolean) {
    setLoadingImage(active);
    onLoading(active);
  }

  function selectImage(image?: File) {
    if (disabled || !image) return;
    imageRead.current?.abort();
    imageRead.current = null;
    updateLoading(false);
    if (image.type && !image.type.startsWith("image/")) {
      onFile(undefined);
      setError("Choose an image file.");
      return;
    }
    setError(undefined);
    onFile(image);
  }

  async function pasteImage() {
    if (disabled || imageRead.current) return;
    const controller = new AbortController();
    imageRead.current = controller;
    updateLoading(true);
    setError(undefined);
    try {
      const items = await navigator.clipboard?.read?.();
      if (!items) throw new Error("Clipboard access is unavailable.");
      for (const item of items) {
        const type = item.types.find((value) => value.startsWith("image/"));
        if (!type) continue;
        const image = await item.getType(type);
        if (!controller.signal.aborted) selectImage(new File([image], "Pasted image", { type }));
        return;
      }
      if (!controller.signal.aborted) setError("Copy a results image first.");
    } catch {
      if (!controller.signal.aborted) setError("Use Ctrl+V or ⌘V, or choose an image file.");
    } finally {
      if (imageRead.current === controller) {
        imageRead.current = null;
        updateLoading(false);
      }
    }
  }

  async function dropImage(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const { dataTransfer } = event;
    const image =
      Array.from(dataTransfer.files).find(({ type }) => !type || type.startsWith("image/")) ??
      Array.from(dataTransfer.items)
        .find(({ kind, type }) => kind === "file" && (!type || type.startsWith("image/")))
        ?.getAsFile();
    if (image) {
      selectImage(image);
      return;
    }

    const html = document.createElement("template");
    html.innerHTML = dataTransfer.getData("text/html");
    const url =
      html.content.querySelector("img[src]")?.getAttribute("src") ??
      dataTransfer
        .getData("text/uri-list")
        .split(/\r?\n/)
        .find((line) => line && !line.startsWith("#"));
    imageRead.current?.abort();
    onFile(undefined);
    if (!url) {
      imageRead.current = null;
      updateLoading(false);
      setError("Drop an image file, or copy the image and paste it here.");
      return;
    }

    const controller = new AbortController();
    imageRead.current = controller;
    updateLoading(true);
    setError(undefined);
    try {
      const linkedImage = await readDroppedImage(url, controller.signal);
      if (!controller.signal.aborted) selectImage(linkedImage);
    } catch {
      if (!controller.signal.aborted) {
        setError(
          "Could not load the dropped image. Copy and paste it here or choose an image file."
        );
      }
    } finally {
      if (imageRead.current === controller) {
        imageRead.current = null;
        updateLoading(false);
      }
    }
  }

  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-label={label}
      onDragOver={(event) => {
        event.preventDefault();
        const ready = !disabled;
        event.dataTransfer.dropEffect = ready ? "copy" : "none";
        if (ready) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setDragging(false);
        }
      }}
      onDrop={(event) => void dropImage(event)}
      onPaste={(event) => {
        const image =
          Array.from(event.clipboardData.files).find(({ type }) => type.startsWith("image/")) ??
          Array.from(event.clipboardData.items)
            .find(({ kind, type }) => kind === "file" && type.startsWith("image/"))
            ?.getAsFile();
        if (!image) return;
        event.preventDefault();
        selectImage(image);
      }}
      className={`min-w-0 rounded-md border ${compact ? "p-2" : "p-3"} outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${dragging ? "border-blue-400 bg-blue-950/40" : "border-white/15 bg-black/20"}`}
    >
      {description}
      <div
        className={
          compact
            ? "mt-1 flex flex-wrap items-center gap-2"
            : "mt-2 flex flex-wrap items-center gap-3 rounded-md border border-dashed border-white/25 p-2"
        }
      >
        <p
          title={file?.name}
          className={
            compact
              ? "min-w-0 grow basis-24 truncate text-xs text-gray-300"
              : "min-w-0 grow basis-40 break-words text-sm"
          }
          role="status"
        >
          {submitted
            ? "Image submitted"
            : (file?.name ??
              (compact
                ? "Drop or paste an image"
                : "Drop an image here or paste with Ctrl+V or ⌘V."))}
        </p>
        <div className={`flex min-w-0 flex-wrap items-center ${compact ? "gap-1.5" : "gap-2"}`}>
          <button
            type="button"
            onClick={() => void pasteImage()}
            disabled={disabled || loadingImage}
            className={pickerButtonClass}
          >
            Paste image
          </button>
          <label
            className={`${pickerButtonClass} cursor-pointer focus-within:ring-2 focus-within:ring-blue-400 ${disabled ? "pointer-events-none opacity-40" : ""}`}
          >
            Choose image
            <input
              type="file"
              accept="image/*"
              aria-label="Choose results image"
              disabled={disabled}
              onChange={(event) => {
                const selected = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                selectImage(selected);
              }}
              className="sr-only"
            />
          </label>
          {children}
        </div>
      </div>
      {error && (
        <p className="mt-2 text-sm text-amber-200" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

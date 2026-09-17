"use client";

import { useRef, useState } from "react";
import { cn } from "@tallyvis/ui";
import { useEstimator } from "@/lib/estimator/EstimatorContext";
import { windowCleaningEstimatorConfig } from "@/lib/estimator/industry-config";

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PhotoUpload() {
  const { input, addPhotos, removePhoto } = useEstimator();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rejections, setRejections] = useState<string[]>([]);

  const { minPhotos, maxPhotos } = windowCleaningEstimatorConfig;
  const count = input.photos.length;
  const atMax = count >= maxPhotos;

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const rejected = addPhotos(Array.from(fileList));
    setRejections(rejected.map((r) => `${r.name}: ${r.reason}`));
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
          isDragging ? "border-accent-strong bg-accent-soft" : "border-line bg-paper-alt",
          atMax && "opacity-50",
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="h-8 w-8 text-ink-faint"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M7 9l5-5 5 5M12 4v12"
          />
        </svg>
        <button
          type="button"
          disabled={atMax}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-accent-strong-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {atMax ? "Maximum photos added" : "Add photos"}
        </button>
        <p className="text-xs text-ink-faint">
          Drag and drop, or tap to use your camera or photo library.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-ink-faint">
        <span>
          {count} of {maxPhotos} photos
        </span>
        <span>
          {count < minPhotos
            ? `Add at least ${minPhotos - count} more to continue`
            : "You're good to continue"}
        </span>
      </div>

      {rejections.length > 0 ? (
        <ul className="rounded-lg border border-accent/40 bg-accent-soft px-4 py-3 text-xs text-accent-strong">
          {rejections.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {input.photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {input.photos.map((photo) => (
            <li
              key={photo.id}
              className="group relative aspect-square overflow-hidden rounded-lg border border-line"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not an optimizable remote asset */}
              <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(photo.id)}
                aria-label={`Remove photo ${photo.name}`}
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-paper opacity-90 transition-opacity hover:bg-ink focus-visible:opacity-100"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="h-3.5 w-3.5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
              <span className="absolute bottom-1 left-1 rounded bg-ink/70 px-1.5 py-0.5 text-[10px] text-paper">
                {formatSize(photo.sizeBytes)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

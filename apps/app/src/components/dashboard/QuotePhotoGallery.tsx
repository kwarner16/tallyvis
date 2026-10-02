"use client";

import { useState } from "react";
import type { QuotePhoto } from "@tallyvis/types";

/**
 * Production hardening (see docs/decisions/0038-quote-photo-storage.md) —
 * renders a quote's customer-submitted photos as a tap-to-enlarge grid.
 * Every `<img>` points at this business's own authenticated
 * `/api/quotes/[id]/photos/[photoId]` route (never `photo.storageKey`
 * directly — that's an opaque server-side storage key, not a URL), so the
 * browser's own session cookie is what authorizes each image request;
 * there is nothing else to pass here.
 */
export function QuotePhotoGallery({ quoteId, photos }: { quoteId: string; photos: QuotePhoto[] }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

  if (photos.length === 0) {
    return <p className="text-sm text-ink-faint">No customer photos available for this quote.</p>;
  }

  function photoUrl(photo: QuotePhoto): string {
    return `/api/quotes/${quoteId}/photos/${photo.id}`;
  }

  function markFailed(id: string) {
    setFailedIds((prev) => new Set(prev).add(id));
  }

  const active = lightboxIndex !== null ? photos[lightboxIndex] : undefined;

  return (
    <>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setLightboxIndex(index)}
            disabled={failedIds.has(photo.id)}
            aria-label={`View customer photo ${index + 1} of ${photos.length}`}
            className="aspect-square overflow-hidden rounded-lg border border-line bg-paper-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:cursor-default"
          >
            {failedIds.has(photo.id) ? (
              <span className="flex h-full w-full items-center justify-center p-2 text-center text-[10px] text-ink-faint">
                Photo unavailable
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- served by our own authenticated API route, not a static/remote asset Next.js can optimize
              <img
                src={photoUrl(photo)}
                alt=""
                loading="lazy"
                onError={() => markFailed(photo.id)}
                className="h-full w-full object-cover transition-transform hover:scale-105"
              />
            )}
          </button>
        ))}
      </div>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Customer photo preview"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
          onClick={() => setLightboxIndex(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- same authenticated API route as the thumbnail grid above */}
          <img
            src={photoUrl(active)}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightboxIndex(null)}
            aria-label="Close photo preview"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-paper text-ink shadow-lg"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          {photos.length > 1 ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((i) => ((i ?? 0) - 1 + photos.length) % photos.length);
                }}
                aria-label="Previous photo"
                className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-paper text-ink shadow-lg"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((i) => ((i ?? 0) + 1) % photos.length);
                }}
                aria-label="Next photo"
                className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-paper text-ink shadow-lg"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

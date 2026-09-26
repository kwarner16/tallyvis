"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { PropertyAnalysisResult } from "@tallyvis/types";
import type { RawPropertyObservation } from "@tallyvis/api";
import { compressImageFile, ImageCompressionError, MAX_SOURCE_FILE_BYTES } from "../imageCompression";
import { verifyEmbedIdAction } from "../publicActions";
import { windowCleaningEstimatorConfig } from "./industry-config";
import {
  EMPTY_CUSTOMER_INPUT,
  type ContactDetails,
  type CustomerInput,
  type PropertyDetails,
  type ServicePreferences,
  type UploadedPhoto,
} from "./types";

const STORAGE_KEY = "tallyvis-estimator-draft-v1";
/**
 * Phase 14 (see docs/decisions/0016-onboarding-billing-embed.md) — kept in
 * a SEPARATE storage key from `STORAGE_KEY`, deliberately not cleared by
 * `reset()`: a customer completing one estimate and starting another
 * inside the same embed browsing session is still on the same business's
 * widget, so the embed identity should survive "start a new estimate."
 * Written by `/embed/[embedId]`'s landing page before it redirects into
 * `/estimate/property` — since that redirect fully remounts the
 * `/estimate/*` route tree (a different layout subtree, so a fresh
 * `EstimatorProvider`), React context state alone would not survive the
 * transition; browser storage does.
 *
 * Deliberately `sessionStorage`, not `localStorage` (2026-09 incident —
 * found via a real production test whose quote landed on the wrong,
 * long-stale business): `localStorage` persists indefinitely and is
 * shared across EVERY future tab/visit regardless of how it's reached,
 * which is exactly what let a stale cached embed id leak into a later,
 * unrelated top-level visit to the marketing site's own bare `/estimate`
 * wizard (the original bug this key's own gating logic was fixing,
 * 2026-09-24). The fix at the time added a `window.self !== window.top`
 * guard — "only trust the cached id while actually rendered inside an
 * iframe right now" — which incidentally also broke the legitimate case
 * of opening `/embed/[embedId]` as a plain top-level page (exactly how a
 * human naturally smoke-tests "the estimator embedded on my website" by
 * following the link directly, without an iframe): the id was written,
 * but `window.self === window.top` for that whole session, so it was
 * NEVER read back, and every action silently fell through to
 * `getDefaultPublicBusiness()` (the single oldest business in the entire
 * database) instead — confirmed against a real quote in production Neon
 * that landed on exactly that oldest, unrelated business.
 * `sessionStorage` is scoped to one tab's browsing session regardless of
 * iframe-ness, which fixes BOTH: reading it back no longer depends on
 * (and can no longer be defeated by) iframe framing, and it can no
 * longer bleed into an unrelated LATER tab/session the way `localStorage`
 * could, so the `window.self !== window.top` guard is removed rather
 * than kept alongside it — see `readCachedEmbedId`/`writeCachedEmbedId`/
 * `clearCachedEmbedId` below, factored out as plain, DOM-storage-shaped
 * functions (same "pure logic, injectable storage" pattern
 * `imageCompression.ts` already uses) purely so this invariant — no
 * frame-context branching anywhere in the read/write path — is directly
 * unit-testable without a real DOM.
 *
 * 2026-09-26 follow-up incident: per-TAB scoping alone still wasn't
 * enough — it stops a cached id crossing tabs/sessions, but not a LATER,
 * unrelated visit to the direct estimator within the SAME tab that
 * happened to visit a business's embed earlier (real repro: visit Korr's
 * embed, then later in the same tab open the direct estimator from
 * tallyvis.com — Korr's branding, and Korr's tenant, would have carried
 * over). `shouldConsiderCachedEmbedId` closes that: a cached id is now
 * only ever considered when this mount's landing path isn't the bare,
 * direct entry point, regardless of what's sitting in `sessionStorage`.
 */
const EMBED_ID_STORAGE_KEY = "tallyvis-estimator-embed-id";

/** Minimal shape these helpers need — satisfied by `window.sessionStorage`/`window.localStorage` and by a plain in-memory fake in tests. */
type EmbedIdStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readCachedEmbedId(storage: EmbedIdStorage): string | null {
  return storage.getItem(EMBED_ID_STORAGE_KEY);
}

export function writeCachedEmbedId(storage: EmbedIdStorage, id: string): void {
  storage.setItem(EMBED_ID_STORAGE_KEY, id);
}

export function clearCachedEmbedId(storage: EmbedIdStorage): void {
  storage.removeItem(EMBED_ID_STORAGE_KEY);
}

/**
 * The tenant-isolation invariant (2026-09 "lost tenant identity" incident —
 * docs/decisions/0026): once THIS session is known to have started from a
 * specific business's embed (a cached id was present at all), it must
 * NEVER silently fall through to the bare/default-business estimator
 * again — that's exactly how a real production quote ended up under an
 * unrelated business, with no error surfaced anywhere. `verifyEmbedIdAction`
 * previously collapsed "confirmed invalid" and "an unexpected error
 * prevented checking at all" into the same `false`, and the caller then
 * treated that identically to "no embed was ever cached" — clearing the
 * id and proceeding as if this were always a bare session. Neither a
 * confirmed-invalid id NOR a transient failure may do that: both must
 * BLOCK, not degrade. A pure, exported function (not inlined in the
 * effect below) so this exact invariant is directly unit-testable without
 * a DOM — see `EstimatorContext.test.ts`.
 */
export function shouldBlockEstimator(cachedEmbedIdPresent: boolean, verification: boolean | null): boolean {
  if (!cachedEmbedIdPresent) return false;
  return verification !== true;
}

/**
 * The bare wizard welcome screen — the ONE path a business's embed can
 * never redirect to (`/embed/[embedId]` always lands directly on
 * `/estimate/property`, see that page's own comment) and the exact URL
 * every direct/marketing entry point uses (apps/web's `ESTIMATOR_URL`, and
 * "entering the URL directly" per a human's own mental model of "the
 * estimator's URL").
 */
export const DIRECT_ESTIMATOR_ENTRY_PATH = "/estimate";

/**
 * 2026-09-26 "wrong branding" incident: a cached embed id in
 * `sessionStorage` survives EVERY in-tab navigation and reload, not just
 * the one legitimate `/embed/[id]` -> `/estimate/property` transition it
 * exists to bridge (see `EMBED_ID_STORAGE_KEY`'s own comment). Visiting a
 * business's embed, then later in the SAME TAB navigating to the direct,
 * un-embedded estimator (e.g. tallyvis.com's own "Try the Estimator" link,
 * which always lands on `DIRECT_ESTIMATOR_ENTRY_PATH`) picked up that
 * stale cached id and applied the WRONG business's branding — and, more
 * seriously, would have attached a real quote to that unrelated business
 * too, since the server has no way to distinguish a stale client-side
 * embed id from a legitimate one; both resolve to a real, valid business.
 *
 * A fresh mount that lands exactly on `DIRECT_ESTIMATOR_ENTRY_PATH` can
 * therefore never legitimately be continuing an embedded flow, no matter
 * what an earlier, unrelated visit in this same tab left cached — this
 * function is consulted BEFORE any verification call, purely on the
 * mount's landing path, so a stale id is never even considered (and is
 * actively cleared, so it can't resurface later in this tab either).
 *
 * Any OTHER `/estimate/*` path is left to the existing verify-then-trust
 * logic below unchanged: it could legitimately be a same-flow mid-wizard
 * reload (sessionStorage surviving a refresh is the whole reason it's used
 * over in-memory state), or someone directly bookmarking a sub-step, which
 * real server-side verification (`shouldBlockEstimator`) already fails
 * closed on if the id doesn't resolve.
 */
export function shouldConsiderCachedEmbedId(pathname: string): boolean {
  return pathname !== DIRECT_ESTIMATOR_ENTRY_PATH;
}

/**
 * Only property/service/contact answers persist across a reload — uploaded
 * photos are real browser File objects (via blob: URLs) that cannot survive
 * one, so we intentionally don't try. Restoring a "photo" that just shows a
 * broken image would be worse than asking the customer to re-add them.
 */
type PersistedInput = Pick<CustomerInput, "property" | "services" | "notes" | "contact">;

export interface PhotoRejection {
  name: string;
  reason: string;
}

/**
 * Writes the embed id directly to localStorage without needing an
 * `EstimatorProvider` mounted — used by `/embed/[embedId]`'s landing page,
 * which sits outside `/estimate/*`'s layout tree and redirects into it
 * right after. See `EMBED_ID_STORAGE_KEY`'s own comment for why
 * localStorage (not React context) is what actually carries this across
 * that redirect.
 */
export function persistEmbedId(id: string): void {
  try {
    writeCachedEmbedId(window.sessionStorage, id);
  } catch {
    // Storage unavailable — the embed simply won't survive a mid-flow refresh; not fatal to this page load.
  }
}

interface EstimatorContextValue {
  input: CustomerInput;
  analysis: PropertyAnalysisResult | null;
  /**
   * The AI's raw per-field observation behind `analysis`, when one exists —
   * `null` both before any analysis has run and when `analysis` was set by
   * the manual fallback (Phase 13 — see
   * docs/decisions/0015-job-outcome-tracking.md). Preserved only so it can
   * be saved alongside the resulting quote for later comparison; the
   * public wizard still has no UI that displays it, unchanged from Phase 12.
   */
  aiObservation: RawPropertyObservation | null;
  /**
   * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
   * — safe, already-rendered follow-up-photo copy computed server-side by
   * `analyzePublicPropertyAction` (see that action's own comment for why
   * this is plain strings, not a client-side call to `describeEvidenceGaps`).
   * Empty when there's nothing to ask for, or for the manual-entry path.
   */
  evidenceMessages: string[];
  /**
   * Vision V1.1 (docs/decisions/0023-guided-capture-evidence-confidence.md)
   * — true once the customer has been through `/estimate/confirm` (or that
   * step decided there was nothing AI-derived to confirm — see
   * `setConfirmed`'s call sites). `setAnalysis` always resets this to
   * `false`, so a fresh analysis always requires a fresh confirmation
   * before `/estimate/result` will price it.
   */
  confirmed: boolean;
  analysisError: string | null;
  /** Set once this session's result has been saved as a Quote, to guard against creating duplicates if the result page re-renders. */
  quoteId: string | null;
  /** Which business's embed this session belongs to, if any — `null` for the marketing site's own bare `/estimate/*` wizard. See `EMBED_ID_STORAGE_KEY`'s comment. */
  embedId: string | null;
  /**
   * True when this session is known to have started from a specific
   * business's embed (a cached id was present) but that identity could
   * NOT be confirmed valid — either genuinely invalid or an unexpected
   * error prevented checking. See `shouldBlockEstimator`'s own comment:
   * every `/estimate/*` step must treat this as a hard stop, never as
   * "proceed with no tenant" (that would be the exact bug this closes).
   */
  embedBlocked: boolean;
  /** True while `addPhotos` is still compressing a batch — see imageCompression.ts. Lets PhotoUpload show "Processing…" instead of leaving the customer wondering why their photo hasn't appeared yet. */
  isProcessingPhotos: boolean;
  updateProperty: (patch: Partial<PropertyDetails>) => void;
  updateServices: (patch: Partial<ServicePreferences>) => void;
  updateContact: (patch: Partial<ContactDetails>) => void;
  setNotes: (notes: string) => void;
  /** Compresses each file client-side (see imageCompression.ts) before adding it — never trusts the original, potentially multi-megabyte phone photo directly. */
  addPhotos: (files: File[]) => Promise<PhotoRejection[]>;
  removePhoto: (id: string) => void;
  setAnalysis: (
    result: PropertyAnalysisResult | null,
    observation?: RawPropertyObservation | null,
    evidenceMessages?: string[],
  ) => void;
  setConfirmed: (value: boolean) => void;
  setAnalysisError: (message: string | null) => void;
  setQuoteId: (id: string) => void;
  setEmbedId: (id: string) => void;
  reset: () => void;
}

const EstimatorContext = createContext<EstimatorContextValue | null>(null);

export function EstimatorProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState<CustomerInput>(EMPTY_CUSTOMER_INPUT);
  const [analysis, setAnalysisState] = useState<PropertyAnalysisResult | null>(null);
  const [aiObservation, setAiObservation] = useState<RawPropertyObservation | null>(null);
  const [evidenceMessages, setEvidenceMessages] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [embedId, setEmbedIdState] = useState<string | null>(null);
  const [embedBlocked, setEmbedBlocked] = useState(false);
  const [isProcessingPhotos, setIsProcessingPhotos] = useState(false);
  const hydrated = useRef(false);
  // Captured once, at this EstimatorProvider instance's first render — see
  // shouldConsiderCachedEmbedId's own comment for why the LANDING path
  // (not whatever the pathname happens to be later, after client-side
  // navigation between wizard steps) is what must gate trusting a cached
  // embed id. A ref (not a dependency of the mount effect below) so it
  // never changes after mount, matching that effect's intentional
  // run-once-per-provider-instance semantics.
  const pathname = usePathname();
  const mountPathname = useRef(pathname);

  /** `observation` defaults to `null` (not "leave whatever was there") — every caller sets both explicitly, so a stale AI observation can never survive a manual re-entry or a fresh analysis. */
  const setAnalysis = useCallback(
    (
      result: PropertyAnalysisResult | null,
      observation: RawPropertyObservation | null = null,
      newEvidenceMessages: string[] = [],
    ) => {
      setAnalysisState(result);
      setAiObservation(observation);
      setEvidenceMessages(newEvidenceMessages);
      setConfirmed(false);
    },
    [],
  );

  const setEmbedId = useCallback((id: string) => {
    setEmbedIdState(id);
    persistEmbedId(id);
  }, []);

  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const persisted = JSON.parse(raw) as PersistedInput;
          setInput((prev) => ({ ...prev, ...persisted }));
        }
        // Read back from `sessionStorage` regardless of iframe framing — no
        // frame-context check (see `EMBED_ID_STORAGE_KEY`'s own comment for
        // why a `window.self !== window.top` guard used to be here, and why
        // it's gone: `sessionStorage`'s own per-tab-session scoping already
        // prevents the original bug that guard existed for, without also
        // silently dropping the embed id for a legitimate top-level visit
        // to `/embed/[embedId]`). Whether a value found here is actually
        // CONSIDERED still depends on this mount's landing path — see
        // `shouldConsiderCachedEmbedId` just below.
        const storedEmbedId = readCachedEmbedId(window.sessionStorage);
        if (storedEmbedId && !shouldConsiderCachedEmbedId(mountPathname.current)) {
          // 2026-09-26 incident: this mount landed fresh on the bare,
          // direct entry point — see shouldConsiderCachedEmbedId's own
          // comment for why a cached id can never be legitimate here.
          // Cleared (not just ignored) so it can't resurface later in this
          // same tab either.
          clearCachedEmbedId(window.sessionStorage);
        } else if (storedEmbedId) {
          // A cached embed id from an earlier session must be revalidated,
          // not blindly trusted — the underlying business may have been
          // deleted/recreated since it was cached. Previously this went
          // uncaught until the customer clicked Analyze at the end of the
          // wizard, surfacing as "This estimator isn't set up correctly"
          // after they'd already filled everything in — confirmed root
          // cause, not a guess: business resolution itself was proven
          // healthy for the business's real, current embed id and fails
          // only for an id that no longer matches one.
          //
          // 2026-09 incident (docs/decisions/0026): `verification` is
          // `true` (confirmed valid), `false` (confirmed invalid), or
          // `null` (an unexpected error — NOT the same as invalid). Only
          // `true` may set the trusted `embedId` state. Neither of the
          // other two may silently proceed as a bare session — that used
          // to happen here, and a real production quote landed on an
          // unrelated business as a direct result, with nothing surfaced
          // to the customer or the business. `shouldBlockEstimator`
          // encodes this invariant once, testably, for both branches.
          const verification = await verifyEmbedIdAction(storedEmbedId);
          if (shouldBlockEstimator(true, verification)) {
            // Only clear the cache for a CONFIRMED-invalid id — a
            // transient error might resolve on its own (a reload/retry),
            // and clearing it here would just as permanently discard a
            // perfectly real embed id as trusting it blindly did before.
            if (verification === false) clearCachedEmbedId(window.sessionStorage);
            setEmbedBlocked(true);
          } else {
            setEmbedIdState(storedEmbedId);
          }
        }
      } catch {
        // Corrupt or unavailable storage — start fresh rather than block the flow.
      } finally {
        hydrated.current = true;
      }
    });
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    const toPersist: PersistedInput = {
      property: input.property,
      services: input.services,
      notes: input.notes,
      contact: input.contact,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
    } catch {
      // Storage unavailable (private browsing, quota) — not fatal, just skip.
    }
  }, [input.property, input.services, input.notes, input.contact]);

  const updateProperty = useCallback((patch: Partial<PropertyDetails>) => {
    setInput((prev) => ({ ...prev, property: { ...prev.property, ...patch } }));
  }, []);

  const updateServices = useCallback((patch: Partial<ServicePreferences>) => {
    setInput((prev) => ({ ...prev, services: { ...prev.services, ...patch } }));
  }, []);

  const updateContact = useCallback((patch: Partial<ContactDetails>) => {
    setInput((prev) => ({ ...prev, contact: { ...prev.contact, ...patch } }));
  }, []);

  const setNotes = useCallback((notes: string) => {
    setInput((prev) => ({ ...prev, notes }));
  }, []);

  /**
   * Compresses every accepted file client-side (see imageCompression.ts)
   * before it ever becomes a photo this session holds — a real, uncompressed
   * phone photo is commonly 3-12MB, and Vercel Functions enforce a hard
   * 4.5MB total request body limit (see next.config.ts's own comment), so
   * sending the original file directly was never viable. The synchronous
   * gate (count, MIME type, an absurdly large source file) still runs
   * first and fast, exactly as before; only actually-accepted files pay
   * for compression, and a failure compressing one file never blocks the
   * others (each is caught and reported individually, matching this
   * function's existing per-file rejection reporting).
   */
  const addPhotos = useCallback(
    async (files: File[]): Promise<PhotoRejection[]> => {
      const rejections: PhotoRejection[] = [];
      const remainingSlots = windowCleaningEstimatorConfig.maxPhotos - input.photos.length;
      const toProcess: File[] = [];

      for (const file of files) {
        if (toProcess.length >= remainingSlots) {
          rejections.push({ name: file.name, reason: "Maximum number of photos reached." });
          continue;
        }
        if (!file.type.startsWith("image/")) {
          rejections.push({ name: file.name, reason: "Not a supported image file." });
          continue;
        }
        if (file.size > MAX_SOURCE_FILE_BYTES) {
          rejections.push({ name: file.name, reason: "File is larger than 20 MB — try a different photo." });
          continue;
        }
        toProcess.push(file);
      }

      if (toProcess.length === 0) return rejections;

      setIsProcessingPhotos(true);
      const accepted: UploadedPhoto[] = [];
      try {
        for (const file of toProcess) {
          try {
            const { blob, sizeBytes } = await compressImageFile(file);
            accepted.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              previewUrl: URL.createObjectURL(blob),
              name: file.name,
              sizeBytes,
            });
          } catch (err) {
            rejections.push({
              name: file.name,
              reason: err instanceof ImageCompressionError ? err.message : "This photo couldn't be processed.",
            });
          }
        }
      } finally {
        setIsProcessingPhotos(false);
      }

      if (accepted.length > 0) {
        setInput((prev) => ({ ...prev, photos: [...prev.photos, ...accepted] }));
      }

      return rejections;
    },
    [input.photos.length],
  );

  const removePhoto = useCallback((id: string) => {
    setInput((prev) => {
      const photo = prev.photos.find((p) => p.id === id);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return { ...prev, photos: prev.photos.filter((p) => p.id !== id) };
    });
  }, []);

  const reset = useCallback(() => {
    setInput((prev) => {
      prev.photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      return EMPTY_CUSTOMER_INPUT;
    });
    setAnalysisState(null);
    setAiObservation(null);
    setEvidenceMessages([]);
    setConfirmed(false);
    setAnalysisError(null);
    setQuoteId(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore — nothing meaningful to recover from here.
    }
  }, []);

  const value = useMemo<EstimatorContextValue>(
    () => ({
      input,
      analysis,
      aiObservation,
      evidenceMessages,
      confirmed,
      analysisError,
      quoteId,
      embedId,
      embedBlocked,
      isProcessingPhotos,
      updateProperty,
      updateServices,
      updateContact,
      setNotes,
      addPhotos,
      removePhoto,
      setAnalysis,
      setConfirmed,
      setAnalysisError,
      setQuoteId,
      setEmbedId,
      reset,
    }),
    [
      input,
      analysis,
      aiObservation,
      evidenceMessages,
      confirmed,
      analysisError,
      quoteId,
      embedId,
      embedBlocked,
      isProcessingPhotos,
      updateProperty,
      updateServices,
      updateContact,
      setNotes,
      addPhotos,
      removePhoto,
      setAnalysis,
      setEmbedId,
      reset,
    ],
  );

  return <EstimatorContext.Provider value={value}>{children}</EstimatorContext.Provider>;
}

export function useEstimator(): EstimatorContextValue {
  const ctx = useContext(EstimatorContext);
  if (!ctx) throw new Error("useEstimator must be used within an EstimatorProvider");
  return ctx;
}

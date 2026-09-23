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
 * a SEPARATE localStorage key from `STORAGE_KEY`, deliberately not cleared
 * by `reset()`: a customer completing one estimate and starting another
 * inside the same embedded iframe session is still on the same business's
 * widget, so the embed identity should survive "start a new estimate."
 * Written by `/embed/[embedId]`'s landing page before it redirects into
 * `/estimate/property` — since that redirect fully remounts the
 * `/estimate/*` route tree (a different layout subtree, so a fresh
 * `EstimatorProvider`), React context state alone would not survive the
 * transition; localStorage does.
 */
const EMBED_ID_STORAGE_KEY = "tallyvis-estimator-embed-id";

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
    window.localStorage.setItem(EMBED_ID_STORAGE_KEY, id);
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
  analysisError: string | null;
  /** Set once this session's result has been saved as a Quote, to guard against creating duplicates if the result page re-renders. */
  quoteId: string | null;
  /** Which business's embed this session belongs to, if any — `null` for the marketing site's own bare `/estimate/*` wizard. See `EMBED_ID_STORAGE_KEY`'s comment. */
  embedId: string | null;
  /** True while `addPhotos` is still compressing a batch — see imageCompression.ts. Lets PhotoUpload show "Processing…" instead of leaving the customer wondering why their photo hasn't appeared yet. */
  isProcessingPhotos: boolean;
  updateProperty: (patch: Partial<PropertyDetails>) => void;
  updateServices: (patch: Partial<ServicePreferences>) => void;
  updateContact: (patch: Partial<ContactDetails>) => void;
  setNotes: (notes: string) => void;
  /** Compresses each file client-side (see imageCompression.ts) before adding it — never trusts the original, potentially multi-megabyte phone photo directly. */
  addPhotos: (files: File[]) => Promise<PhotoRejection[]>;
  removePhoto: (id: string) => void;
  setAnalysis: (result: PropertyAnalysisResult | null, observation?: RawPropertyObservation | null) => void;
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
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [embedId, setEmbedIdState] = useState<string | null>(null);
  const [isProcessingPhotos, setIsProcessingPhotos] = useState(false);
  const hydrated = useRef(false);

  /** `observation` defaults to `null` (not "leave whatever was there") — every caller sets both explicitly, so a stale AI observation can never survive a manual re-entry or a fresh analysis. */
  const setAnalysis = useCallback((result: PropertyAnalysisResult | null, observation: RawPropertyObservation | null = null) => {
    setAnalysisState(result);
    setAiObservation(observation);
  }, []);

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
        const storedEmbedId = window.localStorage.getItem(EMBED_ID_STORAGE_KEY);
        if (storedEmbedId) {
          // A cached embed id from an earlier session must be revalidated,
          // not blindly trusted — the underlying business may have been
          // deleted/recreated since it was cached (this key is deliberately
          // never cleared by `reset()`, so it otherwise persists forever).
          // Previously this went uncaught until the customer clicked
          // Analyze at the end of the wizard, surfacing as "This estimator
          // isn't set up correctly" after they'd already filled everything
          // in — confirmed root cause, not a guess: business resolution
          // itself was proven healthy for the business's real, current
          // embed id and fails only for an id that no longer matches one.
          // Clearing an invalid id falls back to the same bare-estimator
          // behavior a visitor with no embed context already gets — it
          // never substitutes a different business's identity.
          const stillValid = await verifyEmbedIdAction(storedEmbedId);
          if (stillValid) {
            setEmbedIdState(storedEmbedId);
          } else {
            window.localStorage.removeItem(EMBED_ID_STORAGE_KEY);
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
      analysisError,
      quoteId,
      embedId,
      isProcessingPhotos,
      updateProperty,
      updateServices,
      updateContact,
      setNotes,
      addPhotos,
      removePhoto,
      setAnalysis,
      setAnalysisError,
      setQuoteId,
      setEmbedId,
      reset,
    }),
    [
      input,
      analysis,
      aiObservation,
      analysisError,
      quoteId,
      embedId,
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

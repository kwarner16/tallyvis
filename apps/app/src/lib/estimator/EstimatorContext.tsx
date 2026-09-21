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
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;

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
  updateProperty: (patch: Partial<PropertyDetails>) => void;
  updateServices: (patch: Partial<ServicePreferences>) => void;
  updateContact: (patch: Partial<ContactDetails>) => void;
  setNotes: (notes: string) => void;
  addPhotos: (files: File[]) => PhotoRejection[];
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
    queueMicrotask(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const persisted = JSON.parse(raw) as PersistedInput;
          setInput((prev) => ({ ...prev, ...persisted }));
        }
        const storedEmbedId = window.localStorage.getItem(EMBED_ID_STORAGE_KEY);
        if (storedEmbedId) setEmbedIdState(storedEmbedId);
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

  const addPhotos = useCallback((files: File[]): PhotoRejection[] => {
    const rejections: PhotoRejection[] = [];
    const accepted: UploadedPhoto[] = [];

    setInput((prev) => {
      const remainingSlots = windowCleaningEstimatorConfig.maxPhotos - prev.photos.length;

      for (const file of files) {
        if (accepted.length >= remainingSlots) {
          rejections.push({ name: file.name, reason: "Maximum number of photos reached." });
          continue;
        }
        if (!file.type.startsWith("image/")) {
          rejections.push({ name: file.name, reason: "Not a supported image file." });
          continue;
        }
        if (file.size > MAX_PHOTO_SIZE_BYTES) {
          rejections.push({ name: file.name, reason: "File is larger than 10 MB." });
          continue;
        }

        accepted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          previewUrl: URL.createObjectURL(file),
          name: file.name,
          sizeBytes: file.size,
        });
      }

      return accepted.length > 0 ? { ...prev, photos: [...prev.photos, ...accepted] } : prev;
    });

    return rejections;
  }, []);

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

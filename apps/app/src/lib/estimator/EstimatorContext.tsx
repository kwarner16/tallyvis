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

interface EstimatorContextValue {
  input: CustomerInput;
  analysis: PropertyAnalysisResult | null;
  analysisError: string | null;
  /** Set once this session's result has been saved as a Quote, to guard against creating duplicates if the result page re-renders. */
  quoteId: string | null;
  updateProperty: (patch: Partial<PropertyDetails>) => void;
  updateServices: (patch: Partial<ServicePreferences>) => void;
  updateContact: (patch: Partial<ContactDetails>) => void;
  setNotes: (notes: string) => void;
  addPhotos: (files: File[]) => PhotoRejection[];
  removePhoto: (id: string) => void;
  setAnalysis: (result: PropertyAnalysisResult | null) => void;
  setAnalysisError: (message: string | null) => void;
  setQuoteId: (id: string) => void;
  reset: () => void;
}

const EstimatorContext = createContext<EstimatorContextValue | null>(null);

export function EstimatorProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState<CustomerInput>(EMPTY_CUSTOMER_INPUT);
  const [analysis, setAnalysis] = useState<PropertyAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const persisted = JSON.parse(raw) as PersistedInput;
          setInput((prev) => ({ ...prev, ...persisted }));
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
    setAnalysis(null);
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
      analysisError,
      quoteId,
      updateProperty,
      updateServices,
      updateContact,
      setNotes,
      addPhotos,
      removePhoto,
      setAnalysis,
      setAnalysisError,
      setQuoteId,
      reset,
    }),
    [
      input,
      analysis,
      analysisError,
      quoteId,
      updateProperty,
      updateServices,
      updateContact,
      setNotes,
      addPhotos,
      removePhoto,
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

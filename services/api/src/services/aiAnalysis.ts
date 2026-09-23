import { createHash } from "node:crypto";
import type { PropertyImage, PropertyMetadata } from "@tallyvis/types";
import { AiProviderError, analyzePropertyDetailed, type AnalyzePropertyResult } from "@tallyvis/ai";
import type { AuthSession } from "../auth/session";
import type { Queryable } from "../db/pg/client";

export type { AnalyzePropertyResult };
export { AiProviderError, type AiErrorCategory } from "@tallyvis/ai";

/**
 * Server-side AI analysis orchestration (Phase 11 — see
 * docs/decisions/0013-ai-analysis-foundation.md). This is the only place
 * `apps/app` can reach `@tallyvis/ai` from — never directly, and never
 * from client code, so the provider (and its API key) never leaves the
 * server. This file owns authorization and input bounds; `@tallyvis/ai`
 * owns everything provider- and schema-specific.
 */

export interface AnalyzePropertyInput {
  images: PropertyImage[];
  property: {
    stories?: number;
    address?: string;
  };
}

/**
 * Mirrors `apps/app/src/lib/estimator/industry-config.ts`'s `maxPhotos`
 * (6) — not imported from it, since `services/api` can never depend on an
 * app (see CLAUDE.md's module boundary rules). This is the authoritative
 * bound either way: a client-side limit is UX guidance only, never
 * trusted as the real enforcement. Lowered from 8 alongside `MAX_IMAGE_BYTES`
 * below — see that constant's own comment for why: this check alone can't
 * prevent a Vercel-platform-level request rejection (that happens before
 * this code ever runs), but it's still real defense-in-depth against a
 * client that skips its own (also-lowered) limit.
 */
const MAX_IMAGES = 6;
/**
 * Mirrors the client-side cap `EstimatorContext.tsx` already enforces —
 * re-checked here because a client-side limit is never authoritative.
 * Lowered from 10MB after confirming Vercel Functions have a hard 4.5MB
 * total request body limit, platform-enforced before this app's own code
 * (or even Next.js's own, more generous `bodySizeLimit` config in
 * next.config.ts) ever sees the request. A base64 data URI (how a photo
 * reaches this function — see imageEncoding.ts) is ~4/3 the size of the
 * original file, so `MAX_IMAGES` photos at the old 10MB limit could total
 * well over 100MB base64-encoded, guaranteeing a raw platform 413 this
 * code has no chance to intercept or explain. 6 * 500KB raw ≈ 4MB
 * base64-encoded, leaving headroom under the 4.5MB ceiling for the rest of
 * the request. Real client-side photo compression before upload — flagged
 * as a known gap since Phase 11, still not built — is what actually
 * resolves the tension between "let a customer submit a real, useful
 * photo" and this hard platform ceiling; this is a correctness fix
 * (matching limits to what the platform can actually transport), not that.
 */
const MAX_IMAGE_BYTES = 500 * 1024;

function approxDecodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * The authoritative input check — a client's own limits (form validation,
 * `maxPhotos`) are UX only. Throws a categorized `AiProviderError` (Phase
 * 12) rather than a bare `Error` so the UI can give the business a message
 * specific to what actually went wrong, not just a generic failure.
 */
function validateAnalyzeInput(input: AnalyzePropertyInput): void {
  if (!Array.isArray(input.images) || input.images.length === 0) {
    throw new AiProviderError("At least one photo is required to analyze a property.", "invalid-image");
  }
  if (input.images.length > MAX_IMAGES) {
    throw new AiProviderError(`No more than ${MAX_IMAGES} photos can be analyzed at once.`, "too-many-images");
  }
  for (const image of input.images) {
    const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/.exec(image.url);
    if (!match || !match[1]) {
      throw new AiProviderError("Each photo must be a valid image.", "invalid-image");
    }
    if (approxDecodedBytes(match[1]) > MAX_IMAGE_BYTES) {
      throw new AiProviderError("Each photo must be smaller than 500 KB.", "image-too-large");
    }
  }
}

/**
 * A short-lived, process-local memo of recent analyses, keyed by a hash of
 * everything that actually determines the result (which business, what
 * photos, what property details) — "avoid duplicate calls for identical
 * analysis inputs when practical" from the Phase 11 brief. This is a
 * best-effort, single-process cache, not a distributed rate limiter or a
 * usage-metering system — see the ADR for why that's the right scope for
 * this phase. Entries expire; a failed analysis is never cached, so a
 * transient provider error doesn't get "remembered" as the answer.
 */
const DEDUP_TTL_MS = 5 * 60 * 1000;
const dedupCache = new Map<string, { result: AnalyzePropertyResult; expiresAt: number }>();

function dedupKey(businessId: string, input: AnalyzePropertyInput): string {
  const hash = createHash("sha256");
  hash.update(businessId);
  hash.update(JSON.stringify(input.property));
  for (const image of input.images) hash.update(image.url);
  return hash.digest("hex");
}

function pruneExpired(now: number): void {
  for (const [key, entry] of dedupCache) {
    if (entry.expiresAt <= now) dedupCache.delete(key);
  }
}

async function runAnalysisFor(businessId: string, input: AnalyzePropertyInput): Promise<AnalyzePropertyResult> {
  validateAnalyzeInput(input);

  const now = Date.now();
  const key = dedupKey(businessId, input);
  const cached = dedupCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  const metadata: PropertyMetadata = {
    vertical: "window-cleaning",
    address: input.property.address,
    customerDeclaredStories: input.property.stories,
  };

  // No automatic retries here (or in @tallyvis/ai) — a failed call fails
  // once, and it's the caller's UI job to offer a manual retry, exactly
  // the pattern the estimator's "analyzing" step already used pre-Phase-11.
  const result = await analyzePropertyDetailed(input.images, metadata);

  pruneExpired(now);
  dedupCache.set(key, { result, expiresAt: now + DEDUP_TTL_MS });
  return result;
}

/**
 * Authenticated business-side analysis — `session.businessId` is the only
 * source of "which business," derived from the validated session cookie
 * the same way every other function in this package is. There is no
 * businessId parameter here for a caller to substitute. `db` is accepted
 * for signature consistency with the rest of this package (every
 * session-scoped service function takes it) even though nothing here
 * reads or writes the database — Phase 11 analysis is not persisted; see
 * the ADR.
 */
export async function analyzePropertyForBusiness(
  _db: Queryable,
  session: AuthSession,
  input: AnalyzePropertyInput,
): Promise<AnalyzePropertyResult> {
  return runAnalysisFor(session.businessId, input);
}

/**
 * The public estimator's counterpart — `businessId` is resolved by the
 * caller (`apps/app/src/lib/publicActions.ts`) via `getDefaultPublicBusiness`,
 * the exact same pattern `createQuotePublic` already uses, never from
 * anything the browser asserts about itself. This is the only AI entry
 * point reachable without a session; the customer-facing `/quote/[token]`
 * share-link view has no path to this function at all.
 */
export async function analyzePropertyPublic(
  _db: Queryable,
  businessId: string,
  input: AnalyzePropertyInput,
): Promise<AnalyzePropertyResult> {
  return runAnalysisFor(businessId, input);
}

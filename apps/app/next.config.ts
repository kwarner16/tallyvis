import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@tallyvis/ui",
    "@tallyvis/pricing",
    "@tallyvis/config",
    "@tallyvis/types",
    "@tallyvis/api",
  ],
  experimental: {
    serverActions: {
      // The estimator sends up to 6 photos (as base64 data URLs) through a
      // single Server Action to the AI provider, each pre-compressed
      // client-side (see apps/app/src/lib/imageCompression.ts) toward
      // ~450KB raw — real, uncompressed phone photos are commonly 3-12MB,
      // and Vercel Functions enforce a hard 4.5MB total request body limit
      // at the platform level (confirmed against Vercel's current docs)
      // that no next.config.ts setting can raise; a request over that
      // ceiling never reaches this app's code at all, just a raw platform
      // 413. Worst case here — 6 photos all landing at the ~450KB
      // compression target — is ~2.7MB raw, ~3.6MB once base64-encoded.
      // 4.0mb leaves headroom above that for the property/customer JSON
      // fields and Next's own Server Action framing, while staying
      // meaningfully under Vercel's 4.5MB ceiling (not 4.49mb — a request
      // that size should fail cleanly inside Next's own handling, not by
      // brushing up against the platform's own hard cutoff).
      bodySizeLimit: "4.0mb",
    },
  },
};

export default nextConfig;

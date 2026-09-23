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
      // The estimator sends up to 6 photos (as base64 data URLs, per
      // apps/app/src/lib/imageEncoding.ts) through a single Server Action
      // to the AI provider. This used to be 15mb, but Vercel Functions
      // enforce a hard 4.5MB total request body limit at the platform
      // level — confirmed against Vercel's current docs — which no
      // next.config.ts setting can raise; a request over that ceiling
      // never reaches this app's code at all, just a raw platform 413.
      // 4.3mb sits just under that ceiling: 6 photos * 500KB raw (see
      // EstimatorContext.tsx's MAX_PHOTO_SIZE_BYTES) is ~4MB once
      // base64-encoded, leaving headroom for the rest of the request
      // while still catching an oversized request inside Next's own
      // Server Actions handling (a clean, catchable error) rather than
      // letting Vercel's infrastructure reject it first.
      bodySizeLimit: "4.3mb",
    },
  },
};

export default nextConfig;

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
      // The estimator sends up to 8 uncompressed photos (as base64 data
      // URLs, per apps/app/src/lib/imageEncoding.ts) through a single
      // Server Action to the AI provider — Next's 1MB default would reject
      // a real customer's real smartphone photos almost immediately.
      // Raising it is a stopgap, not a full fix: client-side image
      // compression/resizing before upload (there is currently none) is
      // the real fix and remains a follow-up — found during the Stripe V1
      // hardening audit's file-upload review, not as a reported incident.
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;

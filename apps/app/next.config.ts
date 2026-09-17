import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@tallyvis/ui",
    "@tallyvis/pricing",
    "@tallyvis/config",
    "@tallyvis/types",
    "@tallyvis/ai",
    "@tallyvis/api",
  ],
};

export default nextConfig;

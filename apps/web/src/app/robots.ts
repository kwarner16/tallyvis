import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";

/** Phase 15 SEO foundation (see docs/decisions/0028-mobile-sms-embed-and-growth-updates.md) — nothing on the marketing site needs to be hidden from crawlers. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

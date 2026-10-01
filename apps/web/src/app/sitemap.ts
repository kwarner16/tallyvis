import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";

/**
 * Phase 15 SEO foundation (see
 * docs/decisions/0028-mobile-sms-embed-and-growth-updates.md). Every real
 * content route in the site, and only those — `/estimator` is deliberately
 * excluded: it's a pure external redirect to the live product, not a page
 * with its own content to index. Add a new route here in the same commit
 * that adds its `page.tsx`.
 */
const ROUTES: { path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }[] = [
  { path: "/", changeFrequency: "monthly", priority: 1 },
  { path: "/ai-window-cleaning-estimator", changeFrequency: "monthly", priority: 0.8 },
  { path: "/window-cleaning-quote-software", changeFrequency: "monthly", priority: 0.8 },
  { path: "/guides", changeFrequency: "monthly", priority: 0.6 },
  { path: "/guides/how-to-quote-window-cleaning-jobs-from-photos", changeFrequency: "yearly", priority: 0.6 },
  { path: "/guides/what-ai-can-and-cannot-see-in-property-photos", changeFrequency: "yearly", priority: 0.6 },
  { path: "/about", changeFrequency: "yearly", priority: 0.5 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.5 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/data", changeFrequency: "yearly", priority: 0.2 },
  { path: "/install", changeFrequency: "monthly", priority: 0.4 },
  { path: "/sms-opt-in-proof", changeFrequency: "yearly", priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}

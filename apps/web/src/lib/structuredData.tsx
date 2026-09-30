import { SITE_URL } from "./seo";

/**
 * Phase 15 SEO foundation (see
 * docs/decisions/0028-mobile-sms-embed-and-growth-updates.md). Every
 * builder here returns a plain, JSON-serializable object — pure and
 * independently unit-testable (see `__tests__/structuredData.test.ts`) —
 * containing only fields that are actually true about Tallyvis today.
 * Deliberately excluded: `aggregateRating`/`review` (no real reviews
 * exist), `offers` with fabricated pricing claims, and any `sameAs` social
 * profile that doesn't exist. See CLAUDE.md: "Do not fabricate... in this
 * repo."
 */

export interface JsonLdObject {
  "@context": "https://schema.org";
  "@type": string;
  [key: string]: unknown;
}

export function organizationJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Tallyvis",
    url: SITE_URL,
    description:
      "Tallyvis is an AI visual estimating and quoting platform for window cleaning businesses.",
  };
}

export function webSiteJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Tallyvis",
    url: SITE_URL,
  };
}

/**
 * Homepage-only — `applicationCategory`/`operatingSystem` are the only
 * schema.org-meaningful facts about the product itself; no rating, review,
 * or `offers` price claim is included (Tallyvis's real pricing already
 * lives in `/#pricing` as ordinary page content, not a schema.org price
 * claim search engines could surface out of context).
 */
export function softwareApplicationJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Tallyvis",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description:
      "AI-assisted photo-based estimating and quoting software for window cleaning businesses.",
  };
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export function breadcrumbListJsonLd(items: BreadcrumbItem[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

export interface ArticleMeta {
  title: string;
  description: string;
  path: string;
  datePublished: string;
}

/** No named author (nothing here is bylined) — `author`/`publisher` are both the Tallyvis organization itself, which is accurate rather than a fabricated byline. */
export function articleJsonLd(meta: ArticleMeta): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: meta.title,
    description: meta.description,
    url: `${SITE_URL}${meta.path}`,
    datePublished: meta.datePublished,
    author: { "@type": "Organization", name: "Tallyvis" },
    publisher: { "@type": "Organization", name: "Tallyvis" },
  };
}

/** Renders any builder's output as a `<script type="application/ld+json">` tag. */
/** `data` is always our own typed, non-user-supplied object run through `JSON.stringify` — never raw HTML or user input. */
export function JsonLdScript({ data }: { data: JsonLdObject }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

export function OrganizationJsonLd() {
  return <JsonLdScript data={organizationJsonLd()} />;
}

export function WebSiteJsonLd() {
  return <JsonLdScript data={webSiteJsonLd()} />;
}

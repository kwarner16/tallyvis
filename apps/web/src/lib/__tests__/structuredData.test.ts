import { describe, expect, it } from "vitest";
import {
  articleJsonLd,
  breadcrumbListJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from "../structuredData";

/**
 * Phase 15 SEO foundation (see
 * docs/decisions/0028-mobile-sms-embed-and-growth-updates.md). Confirms
 * each generator produces valid, parseable JSON-LD with the required
 * schema.org fields, and — per CLAUDE.md's "do not fabricate" rule — that
 * no generator ever emits a rating, review, or offer field, since none of
 * that data is real.
 */

function assertValidJson(value: unknown) {
  expect(() => JSON.parse(JSON.stringify(value))).not.toThrow();
}

describe("organizationJsonLd", () => {
  it("produces valid JSON-LD with the required Organization fields", () => {
    const data = organizationJsonLd();
    assertValidJson(data);
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("Organization");
    expect(data.name).toBe("Tallyvis");
    expect(typeof data.url).toBe("string");
  });

  it("never includes a fabricated rating, review, or logo asset that doesn't exist", () => {
    const data = organizationJsonLd();
    expect(data).not.toHaveProperty("aggregateRating");
    expect(data).not.toHaveProperty("review");
    expect(data).not.toHaveProperty("logo");
  });
});

describe("webSiteJsonLd", () => {
  it("produces valid JSON-LD with the required WebSite fields", () => {
    const data = webSiteJsonLd();
    assertValidJson(data);
    expect(data["@type"]).toBe("WebSite");
    expect(data.name).toBe("Tallyvis");
  });
});

describe("softwareApplicationJsonLd", () => {
  it("produces valid JSON-LD with the required SoftwareApplication fields", () => {
    const data = softwareApplicationJsonLd();
    assertValidJson(data);
    expect(data["@type"]).toBe("SoftwareApplication");
    expect(data.applicationCategory).toBeTruthy();
  });

  it("never includes fabricated rating, review, or offers/price claims", () => {
    const data = softwareApplicationJsonLd();
    expect(data).not.toHaveProperty("aggregateRating");
    expect(data).not.toHaveProperty("review");
    expect(data).not.toHaveProperty("offers");
  });
});

describe("breadcrumbListJsonLd", () => {
  it("produces a valid BreadcrumbList with correctly-ordered, 1-indexed positions", () => {
    const data = breadcrumbListJsonLd([
      { name: "Guides", path: "/guides" },
      { name: "Example Guide", path: "/guides/example" },
    ]);
    assertValidJson(data);
    expect(data["@type"]).toBe("BreadcrumbList");
    const items = data.itemListElement as { position: number; name: string; item: string }[];
    expect(items).toHaveLength(2);
    expect(items[0]!.position).toBe(1);
    expect(items[0]!.name).toBe("Guides");
    expect(items[1]!.position).toBe(2);
    expect(items[1]!.item).toContain("/guides/example");
  });
});

describe("articleJsonLd", () => {
  it("produces a valid Article with an Organization author/publisher rather than a fabricated byline", () => {
    const data = articleJsonLd({
      title: "Example Article",
      description: "An example description.",
      path: "/guides/example",
      datePublished: "2026-09-30",
    });
    assertValidJson(data);
    expect(data["@type"]).toBe("Article");
    expect(data.headline).toBe("Example Article");
    expect((data.author as { "@type": string; name: string })["@type"]).toBe("Organization");
    expect((data.publisher as { "@type": string; name: string }).name).toBe("Tallyvis");
  });
});

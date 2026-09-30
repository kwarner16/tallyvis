import { describe, expect, it } from "vitest";
import sitemap from "../sitemap";
import robots from "../robots";
import { SITE_URL } from "../../lib/seo";

describe("sitemap", () => {
  it("includes every real content route, each as an absolute URL under the canonical domain", () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);

    for (const path of [
      "/",
      "/ai-window-cleaning-estimator",
      "/window-cleaning-quote-software",
      "/guides",
      "/guides/how-to-quote-window-cleaning-jobs-from-photos",
      "/guides/what-ai-can-and-cannot-see-in-property-photos",
      "/about",
      "/contact",
      "/privacy",
      "/terms",
      "/data",
    ]) {
      expect(urls).toContain(`${SITE_URL}${path}`);
    }
  });

  it("excludes /estimator — an external redirect, not real content", () => {
    const entries = sitemap();
    expect(entries.some((entry) => entry.url.endsWith("/estimator"))).toBe(false);
  });

  it("gives the homepage the highest priority", () => {
    const entries = sitemap();
    const home = entries.find((entry) => entry.url === SITE_URL || entry.url === `${SITE_URL}/`);
    expect(home?.priority).toBe(1);
  });
});

describe("robots", () => {
  it("allows crawling and references the sitemap under the canonical domain", () => {
    const result = robots();
    expect(result.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules?.allow).toBe("/");
  });
});

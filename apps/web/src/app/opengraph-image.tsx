import { ImageResponse } from "next/og";

/**
 * Phase 15 SEO foundation (see
 * docs/decisions/0028-mobile-sms-embed-and-growth-updates.md) — apps/web's
 * `public/` directory has no raster image assets at all (the homepage's
 * own hero visual is built from inline SVG/CSS, not a screenshot), so
 * there was no real product screenshot available to use as a static OG
 * image. This generates a simple branded card from text + the site's own
 * brand colors instead, the same "build it from design tokens, not a
 * fabricated screenshot" approach the Hero visual already takes.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "#faf7f1",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 9999,
              background: "#e35c0f",
              display: "flex",
            }}
          />
          <span style={{ fontSize: 36, fontWeight: 700, color: "#1b1815" }}>Tallyvis</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <span style={{ fontSize: 64, fontWeight: 700, color: "#1b1815", lineHeight: 1.1 }}>
            Turn customer photos into quotes.
          </span>
          <span style={{ fontSize: 30, color: "#5b564f" }}>
            AI-assisted estimating for window cleaning businesses.
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}

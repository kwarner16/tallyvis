import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { OrganizationJsonLd, WebSiteJsonLd } from "@/lib/structuredData";
import { SITE_URL } from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Phase 15 SEO foundation (see
 * docs/decisions/0028-mobile-sms-embed-and-growth-updates.md). `metadataBase`
 * lets every page below resolve a relative `alternates.canonical`/OG image
 * path into a real absolute URL without repeating `SITE_URL` everywhere.
 *
 * NOTE for Kyle: once you've verified tallyvis.com in Google Search Console
 * (see the final report's exact steps), add a `verification: { google:
 * "<the code Search Console gives you>" }` field here — deliberately left
 * out rather than shipped as an empty placeholder, since an empty
 * verification meta tag is worse than no tag at all.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Tallyvis — Turn customer photos into quotes.",
    template: "%s — Tallyvis",
  },
  description:
    "Tallyvis embeds on your website, analyzes the photos your customers upload, helps collect the job details, and turns it all into an estimate — priced using your own rules.",
  openGraph: {
    type: "website",
    siteName: "Tallyvis",
    title: "Tallyvis — Turn customer photos into quotes.",
    description:
      "Tallyvis embeds on your website, analyzes the photos your customers upload, helps collect the job details, and turns it all into an estimate — priced using your own rules.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tallyvis — Turn customer photos into quotes.",
    description:
      "Tallyvis embeds on your website, analyzes the photos your customers upload, helps collect the job details, and turns it all into an estimate — priced using your own rules.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <noscript>
          <style>{`[data-reveal] { opacity: 1 !important; transform: none !important; }`}</style>
        </noscript>
      </head>
      <body className="flex min-h-full flex-col">
        <OrganizationJsonLd />
        <WebSiteJsonLd />
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

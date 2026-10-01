import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Install the Estimator",
  description: "How to install the Tallyvis estimator on your website — WordPress, Shopify, Wix, Squarespace, Webflow, GoDaddy, and custom-coded sites.",
  alternates: { canonical: "/install" },
};

/**
 * Customer-facing installation guide (pre-launch audit, 2026-10 — see
 * docs/decisions/0033-pre-launch-audit.md). Lives in apps/web (public, no
 * login) rather than apps/app, so it's reachable even by a business's own
 * web developer who doesn't have a Tallyvis dashboard login — same
 * reasoning as /privacy, /terms, /data, /sms-opt-in-proof already living
 * here. Linked from the dashboard's "Website → Install Tallyvis" page
 * (`apps/app`'s `WebsiteInstallClient.tsx`) via `INSTALL_GUIDE_URL`, and
 * from this site's own footer.
 *
 * Deliberately describes the REAL embed mechanism
 * (`apps/app/public/embed.js`/`apps/app/src/lib/embedSnippets.ts` —
 * `buildScriptSnippet`/`buildIframeSnippet`) rather than inventing a
 * simplified or aspirational one. Platform-specific steps for WordPress,
 * GoDaddy, and Shopify mirror the exact same caveats already shown in the
 * dashboard's own platform picker (`WebsiteInstallClient.tsx`'s
 * `PLATFORM_GUIDES`) so the two never contradict each other. Wix,
 * Squarespace, and Webflow have no dedicated tab in that picker today, so
 * their sections here are deliberately general (point to each platform's
 * own well-documented "Embed"/custom-code feature) rather than claiming a
 * specific, unverified menu path.
 */
export default function InstallGuidePage() {
  return (
    <LegalPage eyebrow="Help" heading="Install the Tallyvis Estimator">
      <p>
        This guide walks through installing the Tallyvis estimator on your own website. It takes most
        businesses a few minutes, and no coding experience is required for any of the methods below.
      </p>

      <h2>What is the Tallyvis embed?</h2>
      <p>
        The Tallyvis embed is a small snippet you add to your website. It displays your own branded
        estimator &mdash; the same photo-upload, AI-analysis, and quote-request flow you see in your
        Tallyvis dashboard &mdash; directly on your site, so a visitor can request an estimate without
        ever leaving your page. Submissions go straight into your Tallyvis dashboard as new quote
        requests.
      </p>
      <p>
        Every business gets its own unique embed identifier, baked into its snippet. Installing your
        snippet shows <strong>your</strong> estimator, with your branding and your pricing &mdash; it
        can never show another business&rsquo;s estimator, and your snippet can never be used to access
        anyone else&rsquo;s dashboard, pricing, or customer data.
      </p>

      <h2>Where to get your embed code</h2>
      <p>
        Always copy your embed code from your own Tallyvis dashboard &mdash; don&rsquo;t type it by
        hand or reuse one from documentation or another business. Log in and go to{" "}
        <strong>Website</strong> in the dashboard sidebar. That page shows your real, ready-to-paste
        snippet (already filled in with your own embed identifier), a live preview of your estimator,
        and whether Tallyvis has detected it installed on a real page yet.
      </p>

      <h2>General installation</h2>
      <p>Most platforms follow the same three steps:</p>
      <ol>
        <li>Open the <strong>Website</strong> page in your Tallyvis dashboard and copy your snippet.</li>
        <li>
          Find the place on your site where you can add custom HTML, an embed block, or a code
          section &mdash; usually labeled something like &ldquo;Custom HTML,&rdquo; &ldquo;Embed,&rdquo;
          or &ldquo;Code Block&rdquo; depending on your platform.
        </li>
        <li>Paste the snippet in, then save and publish your page.</li>
      </ol>
      <p>
        Your dashboard&rsquo;s Website page gives you two snippet types. The <strong>script
        snippet</strong> (a small <code>&lt;div&gt;</code> plus a <code>&lt;script&gt;</code> tag) is
        the preferred option wherever your platform allows it, and automatically resizes to fit your
        page as a visitor moves through the estimator. The <strong>iframe snippet</strong> is a
        fallback for platforms or page builders that strip <code>&lt;script&gt;</code> tags from
        custom-HTML areas &mdash; it uses a fixed starting height instead of auto-resizing, but shows
        the exact same estimator.
      </p>

      <h2>WordPress</h2>
      <ol>
        <li>In the WordPress block editor, add a &ldquo;Custom HTML&rdquo; block wherever you want the estimator to appear.</li>
        <li>Paste your script snippet into that block.</li>
        <li>Publish or update the page.</li>
      </ol>
      <p>
        Some WordPress.com plans strip raw <code>&lt;script&gt;</code> tags from Custom HTML blocks.
        If the estimator doesn&rsquo;t appear after publishing, use the iframe snippet from your
        dashboard instead.
      </p>

      <h2>Shopify</h2>
      <ol>
        <li>In your Shopify theme editor, add a &ldquo;Custom Liquid&rdquo; section (or an app-embed block) wherever you want the estimator.</li>
        <li>Paste your script snippet into it.</li>
        <li>Save and publish your theme.</li>
      </ol>
      <p>If your theme blocks script execution in that section, use the iframe snippet instead &mdash; it works the same way across every Shopify theme.</p>

      <h2>Wix</h2>
      <ol>
        <li>In the Wix Editor, add an &ldquo;Embed&rdquo; element (Wix calls this &ldquo;Embed Code&rdquo; / &ldquo;Custom Embeds&rdquo;) wherever you want the estimator.</li>
        <li>Paste your iframe snippet into it &mdash; Wix&rsquo;s embed element is iframe-based, so the iframe snippet is the reliable choice here.</li>
        <li>Publish your site.</li>
      </ol>

      <h2>Squarespace</h2>
      <ol>
        <li>Add a &ldquo;Code Block&rdquo; (Squarespace&rsquo;s custom-HTML element) to the page section where you want the estimator.</li>
        <li>Paste your script snippet into the Code Block.</li>
        <li>Save and publish.</li>
      </ol>
      <p>If the estimator doesn&rsquo;t appear, try the iframe snippet instead &mdash; some Squarespace plans restrict script execution inside Code Blocks.</p>

      <h2>Webflow</h2>
      <ol>
        <li>Add an &ldquo;Embed&rdquo; element from Webflow&rsquo;s Add panel to the section where you want the estimator.</li>
        <li>Paste your script snippet into the embed element&rsquo;s code editor.</li>
        <li>Publish your site.</li>
      </ol>

      <h2>GoDaddy Website Builder</h2>
      <ol>
        <li>Add an &ldquo;Embed&rdquo; or &ldquo;HTML&rdquo; section wherever you want the estimator.</li>
        <li>Paste your iframe snippet into it.</li>
        <li>Publish your site.</li>
      </ol>
      <p>
        GoDaddy&rsquo;s HTML embed block commonly strips <code>&lt;script&gt;</code> tags depending on
        your plan, so the iframe snippet is the most reliable option here.
      </p>

      <h2>Custom HTML / custom-coded websites</h2>
      <ol>
        <li>Open your site&rsquo;s HTML source, or your builder&rsquo;s &ldquo;Custom code&rdquo;/&ldquo;Embed&rdquo; feature.</li>
        <li>Paste your script snippet wherever you want the estimator to appear &mdash; just before <code>&lt;/body&gt;</code> works well.</li>
        <li>Save and publish.</li>
      </ol>

      <h2>Troubleshooting</h2>

      <h3>The estimator isn&rsquo;t appearing</h3>
      <p>
        Confirm the snippet was actually saved and published (not left in a draft). If you used the
        script snippet, check whether your platform&rsquo;s editor stripped the{" "}
        <code>&lt;script&gt;</code> tag when you saved &mdash; this is common on some WordPress.com,
        GoDaddy, Shopify, and Squarespace plans. Switch to the iframe snippet from your dashboard&rsquo;s
        Website page and try again.
      </p>

      <h3>The wrong business&rsquo;s estimator is appearing</h3>
      <p>
        This can only happen if the wrong embed identifier was pasted in &mdash; double-check you
        copied the snippet from your own dashboard&rsquo;s Website page, not from a saved file,
        screenshot, or another business&rsquo;s site. Re-copy it fresh and replace the old snippet.
      </p>

      <h3>Sizing or width issues</h3>
      <p>
        The estimator fills the width of whatever element or column you place it in &mdash; put it
        inside a full-width section if it looks narrow. The script snippet resizes its height
        automatically as a visitor moves through the steps; the iframe snippet uses a fixed height, so
        if content looks cut off, increase the <code>height</code> value in the iframe tag.
      </p>

      <h3>Caching</h3>
      <p>
        If you&rsquo;ve made changes and still see the old version (or no estimator at all), clear your
        site&rsquo;s page cache (many site builders and WordPress caching plugins cache published
        pages) and your browser&rsquo;s cache, then reload.
      </p>

      <h3>My site builder stripped the embed code</h3>
      <p>
        Some page builders remove <code>&lt;script&gt;</code> tags from custom-HTML areas for security
        reasons, even though they let you paste one in. If your estimator disappears after
        saving/publishing, that&rsquo;s almost always what happened &mdash; switch to the iframe
        snippet, which uses no <code>&lt;script&gt;</code> tag at all.
      </p>

      <h3>Testing after installation</h3>
      <p>
        Load the page where you added the snippet in a browser and confirm the estimator appears.
        Run through a full test submission &mdash; upload a couple of photos and submit a request
        &mdash; and confirm it shows up as a new quote in your Tallyvis dashboard. Your dashboard&rsquo;s
        Website page also shows an &ldquo;Installation status&rdquo; indicator that updates
        automatically the first time your snippet loads on a real page.
      </p>

      <h2>Need help installing?</h2>
      <p>
        You&rsquo;re welcome to install the estimator yourself using this guide. If you&rsquo;d rather
        have Tallyvis handle it, reach out through{" "}
        <Link href="/contact">Contact</Link> and we can help with setup directly &mdash; what&rsquo;s
        included depends on your onboarding/service arrangement.
      </p>
    </LegalPage>
  );
}

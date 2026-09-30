import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout } from "@/components/ArticleLayout";

const PATH = "/guides/what-ai-can-and-cannot-see-in-property-photos";
const TITLE = "What AI Can and Cannot Reliably Detect From Property Photos";
const DESCRIPTION =
  "An honest look at where AI photo analysis for window cleaning estimates is genuinely reliable, where it isn't, and why that gap is worth designing around rather than hiding.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
};

export default function Page() {
  return (
    <ArticleLayout title={TITLE} description={DESCRIPTION} path={PATH} datePublished="2026-09-30">
      <p>
        AI photo analysis is genuinely useful for estimating window cleaning jobs — but it is not
        magic, and a tool that pretends otherwise sets both the business and the customer up for a bad
        surprise. This is a plain-language rundown of where it tends to be reliable, where it
        isn&rsquo;t, and why the honest answer matters more than a confident-sounding wrong one.
      </p>

      <h2>What it&rsquo;s generally good at</h2>
      <ul>
        <li>
          <strong>Counting clearly visible windows</strong> across a well-framed, well-lit photo of a
          full elevation — this is the core task, and it&rsquo;s the one modern vision models handle
          well when the photo itself is good.
        </li>
        <li>
          <strong>Recognizing common window types</strong> (double-hung, casement, picture windows,
          sliders) from a reasonably clear, unobstructed view.
        </li>
        <li>
          <strong>Flagging its own uncertainty</strong> — a well-built system can distinguish &ldquo;I
          counted this confidently&rdquo; from &ldquo;this photo doesn&rsquo;t show enough of the
          property to be sure,&rdquo; which matters more for a usable estimate than raw accuracy alone.
        </li>
      </ul>

      <h2>Where it struggles — and why</h2>
      <ul>
        <li>
          <strong>Obstructed views.</strong> A tree branch, a parked car, a fence, or a porch roof can
          hide a window entirely, or make a partial view look like a different count than reality. AI
          can only analyze what&rsquo;s actually visible in the frame.
        </li>
        <li>
          <strong>Glare and reflections.</strong> Bright sun on glass can wash out a whole section of a
          photo, and reflections can occasionally make a window look like two, or make a shadow look
          like a window.
        </li>
        <li>
          <strong>Sides of the property not photographed.</strong> This sounds obvious, but it&rsquo;s
          the most common real-world gap: no photo was taken of a side yard, a back elevation, or a
          detached structure, so there&rsquo;s nothing for the AI (or a human) to go on.
        </li>
        <li>
          <strong>Subtle condition details at a distance.</strong> Hard water etching, hairline cracks,
          or how dirty a track actually is can be hard to judge confidently from a photo taken a few
          feet back, even when the window itself is clearly visible.
        </li>
        <li>
          <strong>Scale and depth.</strong> A single photo doesn&rsquo;t always make it obvious whether
          a window is standard-sized or oversized, or exactly how many stories up a window sits,
          without other cues in the frame (a doorway, a roofline, a person).
        </li>
      </ul>

      <h2>Why the gap matters more than the average</h2>
      <p>
        A system that&rsquo;s often right but confidently wrong the rest of the time is worse for a
        business than one that&rsquo;s a bit less accurate overall but clearly says &ldquo;I&rsquo;m not
        sure about this part&rdquo; when it doesn&rsquo;t know. The second system lets a human step in
        exactly where it matters; the first one hides the problem until a quote is already in the
        customer&rsquo;s inbox. This is the reasoning behind Tallyvis&rsquo;s{" "}
        <Link href="/ai-window-cleaning-estimator">estimator</Link>: the AI proposes characteristics,
        surfaces what it&rsquo;s uncertain about, and a human (the customer, or the business) confirms
        or corrects before a price is ever calculated — the AI never determines the price on its own.
      </p>

      <h2>Getting better results in practice</h2>
      <p>
        Most of the accuracy gap above is closed not by a smarter model, but by better photos: full
        elevations, shot straight-on, in even light, with nothing important cropped out of frame. See{" "}
        <Link href="/guides/how-to-quote-window-cleaning-jobs-from-photos">
          how to quote window cleaning jobs from photos
        </Link>{" "}
        for the specifics.
      </p>
    </ArticleLayout>
  );
}

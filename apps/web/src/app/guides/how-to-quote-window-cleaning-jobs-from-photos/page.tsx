import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout } from "@/components/ArticleLayout";
import { ESTIMATOR_URL } from "@/lib/urls";

const PATH = "/guides/how-to-quote-window-cleaning-jobs-from-photos";
const TITLE = "How to Quote Window Cleaning Jobs From Photos";
const DESCRIPTION =
  "A practical guide to estimating window cleaning jobs from customer-submitted photos — what to capture, how to count accurately, and when a site visit is still worth it.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
};

export default function Page() {
  return (
    <ArticleLayout title={TITLE} description={DESCRIPTION} path={PATH} datePublished="2026-09-30">
      <p>
        Every drive-out estimate costs a window cleaning business real time — gas, a slot on the
        schedule, and often a wait for the homeowner to be home. A lot of that can be replaced with a
        good set of photos, if you know what to look for in them. Here&rsquo;s how to actually do it.
      </p>

      <h2>What to ask the customer to photograph</h2>
      <p>
        The single biggest driver of estimate accuracy is photo coverage, not photo quality. A few
        blurry-but-complete shots beat one crisp close-up. Ask for:
      </p>
      <ul>
        <li>One photo of each elevation (front, back, and both sides) taken straight-on, not at an angle.</li>
        <li>Enough distance to fit the whole elevation in frame, including the roofline.</li>
        <li>A second, closer photo of any elevation with more than 6&ndash;8 windows, so individual panes are still distinguishable.</li>
        <li>Anything unusual called out separately — a sunroom, a bay window, a skylight, second-story windows with no visible ground access.</li>
      </ul>

      <h2>Counting windows and panes without miscounting</h2>
      <p>
        Count openings, not panes, first — an &ldquo;opening&rdquo; is one physical window unit, even if
        it&rsquo;s divided into multiple panes by grilles or true divided lights. Then note the pane
        pattern separately (e.g. 6-over-6), since that affects labor time more than price-per-window
        alone. Two mistakes are worth watching for specifically:
      </p>
      <ul>
        <li>
          <strong>Reflections and glare</strong> can make a single large window look like two, or hide
          a window entirely against a dark tree line. Ask for a photo taken from a slightly different
          angle if a section looks ambiguous.
        </li>
        <li>
          <strong>Partially obscured windows</strong> — behind a parked car, a bush, or a porch roof —
          are the most common source of a low estimate that turns into a surprise on-site. Flag these
          rather than guessing.
        </li>
      </ul>

      <h2>What else changes the price</h2>
      <p>
        Window count gets you most of the way to an estimate, but a few other things consistently
        matter more than people expect when pricing from photos alone:
      </p>
      <ul>
        <li><strong>Stories and access.</strong> A second-story window over a flat, walkable roof is a different job than one over a steep pitch or a pool.</li>
        <li><strong>Screens and tracks.</strong> Ask whether screens should come out and get cleaned separately, and whether tracks look like they&rsquo;ve been neglected — both are easy to miss from a photo taken a few feet back.</li>
        <li><strong>Hard water staining.</strong> Visible etching or mineral buildup usually means a different (often billed separately) treatment, not just a standard clean.</li>
        <li><strong>General condition.</strong> Years of buildup takes longer to clean than routine maintenance, even at the same window count.</li>
      </ul>

      <h2>When to still schedule a site visit</h2>
      <p>
        Photo-based estimating is a filter, not a replacement for judgment. Keep visiting in person
        when photos don&rsquo;t clearly show enough of the property to be confident, when a customer
        describes something the photos don&rsquo;t cover (interior cleaning, an unusual window type,
        commercial-scale glass), or when the estimate is large enough that getting it wrong is
        expensive either way. A tool that tells you when its own confidence is low — rather than
        guessing silently — makes this call a lot easier.
      </p>

      <h2>Where AI-assisted tools fit in</h2>
      <p>
        This is exactly the workflow{" "}
        <Link href="/ai-window-cleaning-estimator">Tallyvis&rsquo;s AI estimator</Link> is built around:
        a customer uploads photos on your own website, the AI proposes a window count and job
        characteristics, you (or the customer) confirm anything it flagged as uncertain, and the price
        comes from your own pricing rules — never invented by the AI. You can{" "}
        <a href={ESTIMATOR_URL}>try the live demo estimator</a> to see what that confirmation step
        actually looks like.
      </p>

      <h2>FAQ</h2>
      <h3>How many photos does a customer usually need to send?</h3>
      <p>
        Four to six is typical for an average single-family home — one per elevation, plus a closer
        shot of any busy elevation. More photos rarely hurt; fewer photos is the more common problem.
      </p>
      <h3>Should I always show a price range instead of an exact number?</h3>
      <p>
        When photo coverage is genuinely incomplete, a range (or a note that the number needs
        confirmation) is more honest than a precise-looking figure you&rsquo;re not confident in — and
        it sets the right expectation before you ever show up.
      </p>
    </ArticleLayout>
  );
}

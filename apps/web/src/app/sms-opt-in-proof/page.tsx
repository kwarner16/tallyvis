import type { Metadata } from "next";
import { SMS_CONSENT_DISCLOSURE_TEXT, SMS_CONSENT_DISCLOSURE_VERSION } from "@tallyvis/types";
import { LegalPage } from "@/components/LegalPage";
import { ESTIMATOR_URL } from "@/lib/urls";

export const metadata: Metadata = {
  title: "SMS Opt-In Proof",
  description: "Public, no-login proof of Tallyvis's SMS opt-in flow for Twilio A2P 10DLC campaign review.",
  alternates: { canonical: "/sms-opt-in-proof" },
};

/**
 * Public, no-login compliance proof page for Twilio A2P 10DLC campaign
 * submission (see docs/decisions/0032-sms-stop-start-sync.md's own
 * "Public opt-in proof" section). Lives in apps/web (the marketing site,
 * same place /privacy and /terms already live) rather than apps/app,
 * since it's a static compliance artifact, not part of the estimator
 * wizard itself, and apps/web is already the public, unauthenticated app.
 *
 * The disclosure text below is imported live from `@tallyvis/types` —
 * the SAME constant the estimator's actual consent checkbox renders (see
 * `apps/app/src/app/estimate/review/page.tsx`) — rather than a copy-pasted
 * string, so this page can never drift out of sync with what a real
 * customer actually sees and agrees to.
 *
 * The two screenshots are authentic, Kyle-captured images of the live
 * TallyVis demo estimator (`apps/web/public/sms-opt-in-proof/
 * estimator-form.png`/`post-submission.png`) — not generated, not
 * recreated, not a mockup. Described below exactly as they actually look,
 * not as a generic/idealized flow: `estimator-form.png` shows the
 * checkbox and disclosure in their real DEFAULT state (phone field still
 * empty, checkbox unchecked) rather than a filled-in/checked example,
 * since that default state is itself the compliance-relevant fact (opt-in
 * is never pre-checked).
 */
export default function SmsOptInProofPage() {
  return (
    <LegalPage eyebrow="Compliance" heading="SMS Opt-In Proof">
      <p>
        This page documents Tallyvis&rsquo;s SMS opt-in flow for Twilio A2P 10DLC campaign
        review. It is public and requires no login. The two screenshots below are authentic
        captures of the live TallyVis public demo estimator &mdash; nothing here is a mockup,
        recreation, or AI-generated image. The demo uses the exact same consent UI and disclosure
        text as a real business&rsquo;s estimator: a business&rsquo;s own (embedded) estimator
        renders the identical contact step shown here, and &mdash; when that business has SMS
        enabled &mdash; relies on this same consent mechanism before sending any customer-facing
        SMS.
      </p>

      <h2>Live disclosure text (version {SMS_CONSENT_DISCLOSURE_VERSION})</h2>
      <p>
        The exact text presented next to the unchecked SMS opt-in checkbox on the estimator&rsquo;s
        contact step, imported directly from the same source the application renders &mdash; not a
        separate copy:
      </p>
      <p>
        <strong>&ldquo;{SMS_CONSENT_DISCLOSURE_TEXT}&rdquo;</strong>
      </p>

      <h2>1. The estimator&rsquo;s contact/review step</h2>
      <p>
        An authentic screenshot of the live contact step of{" "}
        <a href={ESTIMATOR_URL} target="_blank" rel="noreferrer">
          the TallyVis demo estimator
        </a>
        . It shows the optional phone field, the SMS consent checkbox in its default,
        <strong> unchecked</strong> state, and the complete disclosure text above (message
        frequency, message/data-rate, STOP/HELP, and consent-is-not-a-condition-of-purchase
        language), with working Privacy Policy and Terms of Service links. A customer who wants
        to opt in enters a valid phone number and affirmatively checks this same box themselves;
        it is never checked for them, and an estimate can be requested with it left unchecked
        (phone number is optional, and SMS consent is never required to request an estimate).
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a plain static compliance screenshot, not an optimized content image */}
      <img
        src="/sms-opt-in-proof/estimator-form.png"
        alt="The TallyVis estimator's contact step, showing the optional phone field, the unchecked-by-default SMS opt-in checkbox, the full disclosure text, and Privacy Policy/Terms of Service links"
        className="rounded-xl border border-line"
      />

      <h2>2. The end of the demo flow</h2>
      <p>
        An authentic screenshot of the final screen a visitor sees after completing the public
        demo estimator. This public demo is explicitly a preview: it does not send a real
        request, text, or email to any business, and no SMS is sent as part of it &mdash; the
        screen says so directly (&ldquo;That&rsquo;s the full experience&rdquo; / &ldquo;This was
        a preview &mdash; no request was sent to any business&rdquo;). A real business&rsquo;s own
        estimator (embedded on that business&rsquo;s website) uses the identical consent step
        shown above, but actually creates a request with that business and &mdash; only for a
        customer who opted in with a valid phone number &mdash; sends the SMS messages described
        in this program.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a plain static compliance screenshot, not an optimized content image */}
      <img
        src="/sms-opt-in-proof/post-submission.png"
        alt="The TallyVis demo estimator's final screen, confirming the demo is complete and explaining that it was a preview and no request was sent to any business"
        className="rounded-xl border border-line"
      />

      <h2>Status</h2>
      <p>
        The form and consent mechanism shown above are live in production today, and both
        screenshots on this page are authentic captures of it.
      </p>
    </LegalPage>
  );
}

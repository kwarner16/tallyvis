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
 * The two screenshots below are NOT fabricated: no generated/fake image
 * exists at either path today. Each `<img>` points at a real file that
 * does not yet exist in this repository; until Kyle captures and adds it
 * (see the instructions beside each one), the browser will show a broken
 * image in that spot — an honest reflection of "not yet captured," not a
 * placeholder pretending to be a real screenshot. See the final report for
 * exactly what Kyle still needs to do here.
 */
export default function SmsOptInProofPage() {
  return (
    <LegalPage eyebrow="Compliance" heading="SMS Opt-In Proof">
      <p>
        This page documents Tallyvis&rsquo;s SMS opt-in flow for Twilio A2P 10DLC campaign
        review. It is public and requires no login, and reflects the actual, currently live
        estimator UI and disclosure text &mdash; nothing here is a mockup.
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

      <h2>1. The estimator form, before submission</h2>
      <p>
        Shows the optional phone field, the unchecked SMS opt-in checkbox, the full disclosure
        text above, and working Privacy Policy and Terms of Service links, as they actually
        appear on the live contact step of{" "}
        <a href={ESTIMATOR_URL} target="_blank" rel="noreferrer">
          the Tallyvis estimator
        </a>
        .
      </p>
      <p>
        <em>Screenshot pending &mdash; not yet captured.</em> When added, this will be a real
        screenshot saved to <code>apps/web/public/sms-opt-in-proof/estimator-form.png</code>.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a plain static compliance screenshot, not an optimized content image */}
      <img
        src="/sms-opt-in-proof/estimator-form.png"
        alt="The Tallyvis estimator's contact step, showing the optional phone field, the unchecked SMS opt-in checkbox, the full disclosure text, and Privacy Policy/Terms of Service links"
        className="rounded-xl border border-line"
      />

      <h2>2. Immediately after submission</h2>
      <p>
        Shows the customer-facing state right after the form is submitted with the SMS checkbox
        checked.
      </p>
      <p>
        <em>Screenshot pending &mdash; not yet captured.</em> When added, this will be a real
        screenshot saved to <code>apps/web/public/sms-opt-in-proof/post-submission.png</code>.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a plain static compliance screenshot, not an optimized content image */}
      <img
        src="/sms-opt-in-proof/post-submission.png"
        alt="The customer-facing state immediately after submitting the estimator form with the SMS opt-in checkbox checked"
        className="rounded-xl border border-line"
      />

      <h2>Status</h2>
      <p>
        The form and consent mechanism shown above are live in production today. The two
        screenshots on this page have not yet been captured &mdash; see the engineering report
        this page shipped with for exactly what remains before this page is ready to submit as
        Twilio opt-in proof.
      </p>
    </LegalPage>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@tallyvis/ui";
import { LegalPage } from "@/components/LegalPage";
import { SETTINGS_URL } from "@/lib/urls";

export const metadata: Metadata = {
  title: "Manage Your Data",
  description:
    "How to revoke Google access, delete your Tallyvis account, and request deletion of personal information Tallyvis maintains, including data obtained through Google integrations.",
};

export default function ManageYourDataPage() {
  return (
    <LegalPage eyebrow="Privacy" heading="Manage Your Data">
      <p>
        This page explains, in plain language, how to control the information Tallyvis has about
        you. It supplements our <Link href="/privacy">Privacy Policy</Link>, which remains the
        full description of how we collect, use, and protect information.
      </p>

      <h2>Disconnect or revoke Google access</h2>
      <p>
        If you signed up for or linked Tallyvis to a Google Account, you can revoke that access at
        any time from your Google Account&rsquo;s own permissions settings &mdash; this
        immediately stops Tallyvis from being able to use that authorization.
      </p>
      <p>
        Go to{" "}
        <a
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google Account &rarr; Security &rarr; Third-party apps &amp; services
        </a>{" "}
        , find Tallyvis, and remove access.
      </p>

      <h2>Delete your Tallyvis account</h2>
      <p>
        Account deletion is self-service. If you have an active subscription, it is canceled with
        Stripe first, and then your Tallyvis business, dashboard access, customers, quotes, and
        pricing configuration are permanently deleted. This does not erase Stripe&rsquo;s own
        payment or invoice history, which Stripe retains for accounting purposes. This action
        cannot be undone.
      </p>
      <p>
        To delete your account, log in and go to{" "}
        <strong>Dashboard &rarr; Settings &rarr; Danger Zone</strong>, then type{" "}
        <strong>DELETE</strong> to confirm.
      </p>
      <p>
        <a href={SETTINGS_URL} className={buttonVariants({ variant: "outline" })}>
          Go to Dashboard Settings
        </a>
      </p>

      <h2>Request deletion of other personal information</h2>
      <p>
        For requests our self-service tools don&rsquo;t cover &mdash; for example, deleting
        specific personal information we maintain without deleting your whole account, or a
        request from a customer of a business that uses Tallyvis &mdash; contact us directly using
        the information on our <Link href="/contact">Contact</Link> page. We will respond and
        process valid requests consistent with our <Link href="/privacy">Privacy Policy</Link> and
        applicable law.
      </p>

      <h2>Request deletion of data obtained through Google integrations</h2>
      <p>
        Information Tallyvis obtains through a Google integration is tied to your account.
        Deleting your account (above) removes it. If you need Google-derived data deleted without
        deleting your whole account, contact us using the information on our{" "}
        <Link href="/contact">Contact</Link> page and we will process the request.
      </p>

      <h2>Contact us about privacy or data requests</h2>
      <p>
        For any question about this page, your data, or our Privacy Policy, reach us through the
        contact information on our <Link href="/contact">Contact</Link> page.
      </p>
    </LegalPage>
  );
}

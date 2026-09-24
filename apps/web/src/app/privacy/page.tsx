import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Tallyvis collects, uses, discloses, and protects information, including Google user data accessed through Tallyvis integrations.",
};

const EFFECTIVE_DATE = "September 23, 2026";

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      heading="Privacy Policy"
      effectiveDate={EFFECTIVE_DATE}
      lastUpdated={EFFECTIVE_DATE}
    >
      <p>
        Tallyvis (&ldquo;Tallyvis,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;)
        provides software that helps service businesses create estimates, manage customer
        information, process uploaded images, communicate with customers, and manage related
        business workflows through artificial intelligence and other software tools.
      </p>
      <p>
        This Privacy Policy explains how Tallyvis collects, uses, stores, discloses, and protects
        information when you use the Tallyvis website, applications, services, integrations, and
        related features (collectively, the &ldquo;Services&rdquo;).
      </p>
      <p>By using the Services, you acknowledge the practices described in this Privacy Policy.</p>

      <h2>1. Information We Collect</h2>

      <h3>Account and Business Information</h3>
      <p>When you create or manage a Tallyvis account, we may collect information such as:</p>
      <ul>
        <li>Name</li>
        <li>Email address</li>
        <li>Business name</li>
        <li>Username and account credentials</li>
        <li>Business contact information</li>
        <li>Business configuration and pricing information</li>
        <li>Subscription and billing status</li>
        <li>Account preferences and settings</li>
      </ul>
      <p>
        Passwords are intended to be stored using secure hashing rather than in readable plaintext
        form.
      </p>

      <h3>Customer and Quote Information</h3>
      <p>
        Businesses using Tallyvis may provide or collect information relating to their customers,
        including:
      </p>
      <ul>
        <li>Customer names</li>
        <li>Email addresses</li>
        <li>Phone numbers</li>
        <li>Service addresses or property information</li>
        <li>Quote and estimate information</li>
        <li>Service requests</li>
        <li>Customer messages or notes</li>
        <li>Quote acceptance, rejection, or modification requests</li>
        <li>Job outcomes and service information</li>
      </ul>
      <p>
        When a business uses Tallyvis to collect customer information, that business may
        independently have obligations regarding its collection and use of that information.
      </p>

      <h3>Images and AI Analysis Data</h3>
      <p>
        Tallyvis may allow users or customers to upload photographs or other images for the
        purpose of generating or assisting with service estimates.
      </p>
      <p>
        For example, images of a property may be analyzed to identify characteristics relevant to
        a service estimate, such as windows, screens, property features, accessibility, or other
        job characteristics.
      </p>
      <p>We may process:</p>
      <ul>
        <li>Uploaded images</li>
        <li>AI-generated observations</li>
        <li>Confidence or uncertainty information</li>
        <li>User corrections to AI observations</li>
        <li>Estimate inputs and outputs</li>
        <li>Job outcomes and related operational information</li>
      </ul>
      <p>
        AI-generated results may be inaccurate and should not be treated as guaranteed
        observations or professional assessments.
      </p>

      <h3>Google User Data</h3>
      <p>
        Tallyvis may allow users to connect certain Google services through Google&rsquo;s OAuth
        authorization system.
      </p>
      <p>
        Depending on the features a user chooses to enable and the permissions the user grants,
        Tallyvis may access specific Google user data necessary to provide those features.
      </p>
      <p>Tallyvis will only request Google permissions that are reasonably necessary for functionality offered to the user.</p>
      <p>
        We use information obtained from Google APIs only to provide or improve user-facing
        Tallyvis features that the user has requested or authorized.
      </p>
      <p>
        Tallyvis&rsquo;s use and transfer of information received from Google APIs will adhere to
        the <strong>Google API Services User Data Policy, including the Limited Use requirements</strong>.
      </p>
      <p>Tallyvis does not sell Google user data.</p>
      <p>
        Tallyvis does not use Google user data for advertising, retargeting, personalized
        advertising, or determining creditworthiness.
      </p>
      <p>
        Tallyvis does not use information obtained through Google Workspace APIs to develop,
        train, or improve generalized or non-personalized artificial intelligence or
        machine-learning models.
      </p>
      <p>
        Google user data will not be transferred to third parties except where necessary to
        provide or improve user-facing functionality requested by the user, for legitimate
        security purposes, to comply with applicable law, or as otherwise permitted by the Google
        API Services User Data Policy.
      </p>
      <p>
        Human access to Google user data is restricted except when the user has provided
        appropriate consent, when necessary for security or abuse investigation, when required by
        law, or in other circumstances permitted by Google&rsquo;s applicable policies.
      </p>
      <p>
        Users may revoke Tallyvis&rsquo;s access to their Google Account through their Google
        Account permissions and may contact us regarding deletion of Google-derived data
        maintained by Tallyvis. See{" "}
        <Link href="/data">Manage Your Data</Link> for step-by-step instructions.
      </p>

      <h3>Payment Information</h3>
      <p>
        Payments for Tallyvis subscriptions, setup fees, and other paid services may be processed
        through third-party payment processors such as Stripe.
      </p>
      <p>
        Tallyvis generally does not directly store complete payment card numbers. Payment
        processors may collect and process payment information according to their own privacy
        policies.
      </p>
      <p>We may receive information related to a transaction, such as:</p>
      <ul>
        <li>Payment status</li>
        <li>Subscription status</li>
        <li>Billing customer identifiers</li>
        <li>Purchased plan</li>
        <li>Transaction identifiers</li>
        <li>Invoice information</li>
      </ul>

      <h3>Technical and Usage Information</h3>
      <p>
        When you interact with Tallyvis, we may automatically collect certain technical
        information, including:
      </p>
      <ul>
        <li>IP address</li>
        <li>Browser and device information</li>
        <li>Operating system</li>
        <li>Pages or features accessed</li>
        <li>Dates and times of access</li>
        <li>Referring pages</li>
        <li>Application logs</li>
        <li>Error information</li>
        <li>Security events</li>
        <li>Usage and performance information</li>
      </ul>
      <p>
        We may use cookies, local storage, session technologies, and similar mechanisms to operate
        and secure the Services.
      </p>

      <h2>2. How We Use Information</h2>
      <p>We may use information collected through Tallyvis to:</p>
      <ul>
        <li>Provide and operate the Services</li>
        <li>Authenticate users and maintain accounts</li>
        <li>Generate and manage estimates and quotes</li>
        <li>Analyze uploaded images</li>
        <li>Provide AI-assisted functionality</li>
        <li>Manage customers and service requests</li>
        <li>Process subscriptions and payments</li>
        <li>Send requested quotes, notifications, and transactional communications</li>
        <li>Operate integrations authorized by users</li>
        <li>Provide customer support</li>
        <li>Improve reliability and user experience</li>
        <li>Diagnose technical problems</li>
        <li>Prevent fraud, abuse, or unauthorized access</li>
        <li>Maintain the security of Tallyvis</li>
        <li>Comply with applicable legal obligations</li>
        <li>Enforce our agreements and policies</li>
      </ul>
      <p>We do not sell personal information as a core part of our business model.</p>

      <h2>3. Artificial Intelligence</h2>
      <p>
        Certain Tallyvis features use artificial intelligence to analyze information supplied
        through the Services.
      </p>
      <p>
        Information submitted to an AI-enabled feature may be transmitted to an AI service
        provider solely as necessary to provide that functionality, subject to our agreements and
        applicable data-handling requirements.
      </p>
      <p>
        AI-generated observations and estimates may contain errors. Businesses using Tallyvis
        remain responsible for reviewing estimates, pricing, observations, and other AI-generated
        results before relying upon or providing them to customers.
      </p>
      <p>
        Google Workspace API data is not used to train or improve generalized or non-personalized
        AI or machine-learning models.
      </p>

      <h2>4. How We Share Information</h2>
      <p>
        We may disclose information to service providers that assist us in operating Tallyvis,
        such as providers of:
      </p>
      <ul>
        <li>Cloud hosting</li>
        <li>Database infrastructure</li>
        <li>Artificial intelligence processing</li>
        <li>Payment processing</li>
        <li>Email or communications delivery</li>
        <li>Security and fraud prevention</li>
        <li>Analytics and application monitoring</li>
      </ul>
      <p>
        These providers are permitted to process information only as appropriate to perform
        services for Tallyvis and subject to applicable contractual or legal restrictions.
      </p>
      <p>We may also disclose information when reasonably necessary to:</p>
      <ul>
        <li>Comply with applicable law, regulation, legal process, or governmental request</li>
        <li>Protect Tallyvis, our users, customers, or others</li>
        <li>Detect or investigate fraud, abuse, or security incidents</li>
        <li>Enforce our agreements</li>
        <li>
          Facilitate a merger, financing, acquisition, reorganization, or sale of assets, subject
          to applicable legal and contractual requirements
        </li>
      </ul>

      <h2>5. Data Retention</h2>
      <p>
        We retain information for as long as reasonably necessary to provide the Services,
        maintain legitimate business records, comply with legal obligations, resolve disputes, and
        enforce agreements.
      </p>
      <p>Retention periods may differ depending on the type of information and why it was collected.</p>
      <p>
        When information is no longer reasonably necessary, we may delete or anonymize it, subject
        to legal, security, backup, and operational requirements.
      </p>

      <h2>6. Data Security</h2>
      <p>
        Tallyvis uses reasonable administrative, technical, and organizational safeguards designed
        to protect information against unauthorized access, disclosure, alteration, or
        destruction.
      </p>
      <p>
        These safeguards may include encryption in transit, access controls, authentication
        systems, hashed credentials or tokens, logging, and other security measures.
      </p>
      <p>
        However, no internet-based system or method of electronic storage can be guaranteed to be
        completely secure.
      </p>

      <h2>7. User Choices and Data Deletion</h2>
      <p>
        Depending on the Services being used, users may be able to review or modify certain
        account information from within Tallyvis.
      </p>
      <p>
        Users may also request access to, correction of, or deletion of personal information
        maintained by Tallyvis, subject to applicable legal and operational requirements.
      </p>
      <p>
        Users who connect a Google Account may revoke Tallyvis&rsquo;s authorization through their
        Google Account security and permissions settings.
      </p>
      <p>
        Users may also contact Tallyvis to request deletion of information associated with their
        account, including applicable information obtained through Google integrations.
      </p>
      <p>
        For step-by-step instructions on revoking Google access, deleting your account, and
        requesting deletion of your data, see <Link href="/data">Manage Your Data</Link>.
      </p>

      <h2>8. Business Customers and Their Customers</h2>
      <p>Tallyvis provides software to independent businesses.</p>
      <p>
        When a business uses Tallyvis to collect or process information about its own customers,
        the business may act as the party responsible for determining how that customer
        information is collected and used.
      </p>
      <p>
        Customers of a business using Tallyvis should contact that business directly regarding its
        privacy practices. Tallyvis may assist its business customers with appropriate privacy
        requests where applicable.
      </p>

      <h2>9. Children&rsquo;s Privacy</h2>
      <p>
        Tallyvis is intended for business and commercial use and is not directed toward children
        under 13.
      </p>
      <p>
        We do not knowingly collect personal information directly from children under 13 through
        accounts intended for use of the Services.
      </p>
      <p>
        If we learn that information has been collected from a child in violation of applicable
        law, we will take appropriate steps to delete it.
      </p>

      <h2>10. Third-Party Services</h2>
      <p>Tallyvis may integrate with or link to third-party services.</p>
      <p>
        Those services operate under their own terms and privacy practices. Tallyvis is not
        responsible for the privacy practices of third-party services except to the extent
        required by applicable law.
      </p>

      <h2>11. Changes to This Privacy Policy</h2>
      <p>
        We may update this Privacy Policy as Tallyvis evolves or as legal, regulatory, or
        technical requirements change.
      </p>
      <p>When we make changes, we will update the &ldquo;Last Updated&rdquo; date at the top of this policy.</p>
      <p>
        If changes materially affect how we handle personal information, we may provide additional
        notice when appropriate.
      </p>

      <h2>12. Contact Us</h2>
      <p>
        Questions, requests, or concerns regarding this Privacy Policy or Tallyvis&rsquo;s data
        practices may be submitted through the contact information provided on Tallyvis.com. See{" "}
        <Link href="/contact">Contact</Link> and <Link href="/data">Manage Your Data</Link> for
        Google authorization revocation and account/data deletion requests.
      </p>
      <p>
        <strong>Website:</strong> tallyvis.com
      </p>
      <p>&copy; 2026 Tallyvis. All rights reserved.</p>
    </LegalPage>
  );
}

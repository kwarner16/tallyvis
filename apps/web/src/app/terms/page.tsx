import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms governing access to and use of the Tallyvis website, applications, AI features, integrations, and related services.",
};

const EFFECTIVE_DATE = "September 23, 2026";

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      heading="Terms of Service"
      effectiveDate={EFFECTIVE_DATE}
      lastUpdated={EFFECTIVE_DATE}
    >
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of the Tallyvis
        website, applications, software, artificial intelligence features, integrations, APIs,
        embedded tools, and related services (collectively, the &ldquo;Services&rdquo;).
      </p>
      <p>By creating an account, accessing, purchasing, or using the Services, you agree to these Terms.</p>
      <p>
        If you use Tallyvis on behalf of a business or other organization, you represent that you
        have authority to accept these Terms on its behalf.
      </p>
      <p>If you do not agree to these Terms, do not use the Services.</p>

      <h2>1. Tallyvis Services</h2>
      <p>Tallyvis provides software designed to help service businesses perform tasks that may include:</p>
      <ul>
        <li>Creating estimates and quotes</li>
        <li>Collecting customer information</li>
        <li>Receiving and processing uploaded images</li>
        <li>Using artificial intelligence to analyze service-related information</li>
        <li>Managing customers and quotes</li>
        <li>Sharing estimates with customers</li>
        <li>Tracking quote acceptance or rejection</li>
        <li>Integrating estimation tools into websites</li>
        <li>Managing business pricing configurations</li>
        <li>Connecting third-party services and integrations</li>
        <li>Supporting business workflows and communications</li>
      </ul>
      <p>Features may change, be added, or be removed as Tallyvis develops.</p>

      <h2>2. Accounts</h2>
      <p>You may be required to create an account to use certain Services.</p>
      <p>
        You agree to provide accurate information and to maintain the security of your account
        credentials.
      </p>
      <p>
        You are responsible for activity occurring through your account unless caused by
        circumstances for which Tallyvis is legally responsible.
      </p>
      <p>You must promptly notify Tallyvis if you reasonably believe your account has been compromised.</p>

      <h2>3. Business Use</h2>
      <p>
        Tallyvis is primarily intended for businesses and individuals engaged in commercial
        activities.
      </p>
      <p>Businesses using Tallyvis remain responsible for their own operations, including:</p>
      <ul>
        <li>Pricing</li>
        <li>Quotes and estimates</li>
        <li>Customer relationships</li>
        <li>Services performed</li>
        <li>Taxes</li>
        <li>Licenses and permits</li>
        <li>Insurance</li>
        <li>Employee or contractor relationships</li>
        <li>Regulatory compliance</li>
        <li>Customer communications</li>
        <li>Contracts entered into with their customers</li>
      </ul>
      <p>
        Tallyvis does not become a party to a service agreement between a business using Tallyvis
        and that business&rsquo;s customer merely because Tallyvis was used to create or deliver an
        estimate.
      </p>

      <h2>4. AI-Generated Information</h2>
      <p>
        Tallyvis may use artificial intelligence and machine-learning technologies to analyze
        photographs, documents, descriptions, property characteristics, or other information.
      </p>
      <p>Artificial intelligence can make mistakes.</p>
      <p>
        AI-generated observations, classifications, counts, recommendations, prices, estimates,
        confidence levels, and other outputs are provided as tools to assist users and are not
        guaranteed to be accurate, complete, or appropriate for every situation.
      </p>
      <p>Users are responsible for reviewing AI-generated results before relying on them or providing them to customers.</p>
      <p>
        Tallyvis does not guarantee that AI-generated estimates will equal the final cost, labor
        requirement, property condition, service requirements, or actual results of a job.
      </p>

      <h2>5. Quotes and Estimates</h2>
      <p>
        Estimates generated through Tallyvis may depend on information supplied by customers,
        businesses, third-party services, or artificial intelligence systems.
      </p>
      <p>
        Actual service conditions may differ from those visible in photographs or supplied through
        the Services.
      </p>
      <p>
        Businesses using Tallyvis are responsible for determining their final pricing and whether
        an estimate should be honored, modified, or withdrawn, subject to applicable law and
        agreements with their customers.
      </p>

      <h2>6. Customer Data</h2>
      <p>You retain applicable rights to information and content that you submit to Tallyvis.</p>
      <p>
        You grant Tallyvis permission to host, process, transmit, reproduce, and otherwise use
        submitted information as reasonably necessary to operate, secure, maintain, and provide the
        Services.
      </p>
      <p>
        You represent that you have the rights and permissions reasonably necessary to provide
        information to Tallyvis and authorize its processing through the Services.
      </p>
      <p>
        If you collect information from your customers through Tallyvis, you are responsible for
        providing any notices and obtaining any permissions or consents required by applicable
        law.
      </p>

      <h2>7. Google and Third-Party Integrations</h2>
      <p>Tallyvis may allow users to connect services provided by Google or other third parties.</p>
      <p>
        Use of these integrations may be subject to additional terms and privacy policies
        maintained by those third parties.
      </p>
      <p>
        When connecting a third-party service, you authorize Tallyvis to access and process
        information permitted by the authorization you grant for the purpose of providing the
        requested integration and related Tallyvis functionality.
      </p>
      <p>
        Tallyvis&rsquo;s use of information received from Google APIs will adhere to the Google API
        Services User Data Policy, including the Limited Use requirements.
      </p>
      <p>Users may disconnect supported integrations or revoke authorization through the applicable third-party service.</p>

      <h2>8. Acceptable Use</h2>
      <p>You may not use Tallyvis to:</p>
      <ul>
        <li>Violate applicable laws or regulations</li>
        <li>Infringe intellectual property or privacy rights</li>
        <li>Access another person&rsquo;s account without authorization</li>
        <li>Distribute malware or malicious code</li>
        <li>Interfere with the security or operation of the Services</li>
        <li>Attempt to bypass authentication or security controls</li>
        <li>Probe or exploit vulnerabilities without written authorization</li>
        <li>Use automated systems to overload or disrupt the Services</li>
        <li>Misrepresent AI-generated information as independently verified when it has not been verified</li>
        <li>Use the Services for fraudulent, deceptive, or unlawful activity</li>
        <li>Attempt to reverse engineer the Services except where applicable law expressly permits it</li>
      </ul>
      <p>
        We may suspend or restrict access when reasonably necessary to protect Tallyvis, its
        users, customers, infrastructure, or third parties.
      </p>

      <h2>9. Subscription Plans and Fees</h2>
      <p>Certain Tallyvis features require a paid subscription or other payment.</p>
      <p>
        Pricing, available features, usage limits, setup charges, trial periods, and other
        commercial terms will be displayed when purchasing a plan or otherwise communicated before
        a charge is authorized.
      </p>
      <p>
        Unless otherwise stated, recurring subscriptions automatically renew for additional
        billing periods until canceled.
      </p>
      <p>
        You authorize Tallyvis and its payment processor to charge the applicable payment method
        for fees associated with your account.
      </p>

      <h2>10. Free Trials</h2>
      <p>Tallyvis may offer free trials.</p>
      <p>
        Trial duration, eligibility, feature availability, and conversion to a paid subscription
        may be subject to conditions displayed when the trial begins.
      </p>
      <p>
        Unless otherwise disclosed during signup, access to paid functionality may end when a
        trial expires if a paid subscription has not been established.
      </p>
      <p>Tallyvis may modify or discontinue promotional trial offers for future users.</p>

      <h2>11. Cancellation</h2>
      <p>You may cancel a recurring subscription using available account-management functionality or by contacting Tallyvis.</p>
      <p>
        Cancellation generally prevents future renewal charges but does not automatically entitle
        you to a refund for amounts already paid, except where required by law or expressly
        provided by Tallyvis.
      </p>

      <h2>12. Intellectual Property</h2>
      <p>
        Tallyvis and its licensors retain all rights in the Services, including software,
        interfaces, branding, designs, documentation, models, systems, and other technology,
        except for content owned by users or third parties.
      </p>
      <p>
        These Terms grant you a limited, non-exclusive, non-transferable right to use the Services
        while your account is authorized and in compliance with these Terms.
      </p>
      <p>
        &ldquo;Tallyvis,&rdquo; its logos, branding, and associated marks may not be used without
        authorization except as permitted by applicable law.
      </p>

      <h2>13. Feedback</h2>
      <p>
        If you voluntarily provide suggestions, ideas, or feedback regarding Tallyvis, you grant
        Tallyvis permission to use that feedback to develop and improve the Services without an
        obligation to compensate you.
      </p>
      <p>
        This provision does not transfer ownership of your confidential business information or
        customer data to Tallyvis.
      </p>

      <h2>14. Service Availability</h2>
      <p>We work to maintain reliable Services, but uninterrupted availability cannot be guaranteed.</p>
      <p>Tallyvis may occasionally be unavailable because of:</p>
      <ul>
        <li>Maintenance</li>
        <li>Software updates</li>
        <li>Infrastructure failures</li>
        <li>Third-party outages</li>
        <li>Security incidents</li>
        <li>Internet disruptions</li>
        <li>Events outside our reasonable control</li>
      </ul>
      <p>Features may also change as Tallyvis evolves.</p>

      <h2>15. Beta and Experimental Features</h2>
      <p>Certain features may be identified as beta, preview, experimental, or early access.</p>
      <p>Such features may contain errors, change substantially, or be discontinued.</p>
      <p>
        You should not rely on experimental functionality for critical operations without
        appropriate independent safeguards.
      </p>

      <h2>16. Disclaimers</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SERVICES ARE PROVIDED &ldquo;AS
        IS&rdquo; AND &ldquo;AS AVAILABLE.&rdquo;
      </p>
      <p>
        TALLYVIS DOES NOT GUARANTEE THAT THE SERVICES, AI OUTPUTS, ESTIMATES, OBSERVATIONS, OR
        OTHER RESULTS WILL ALWAYS BE ACCURATE, COMPLETE, AVAILABLE, SECURE, OR ERROR-FREE.
      </p>
      <p>
        TALLYVIS DOES NOT PROVIDE LEGAL, TAX, ACCOUNTING, ENGINEERING, INSURANCE, OR OTHER
        PROFESSIONAL ADVICE THROUGH THE SERVICES.
      </p>
      <p>Some jurisdictions do not allow certain warranty disclaimers, so portions of this section may not apply to you.</p>

      <h2>17. Limitation of Liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, TALLYVIS WILL NOT BE LIABLE FOR
        INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOST
        PROFITS, LOST REVENUE, LOST BUSINESS, OR LOST DATA ARISING FROM OR RELATING TO THE
        SERVICES.
      </p>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, TALLYVIS&rsquo;S AGGREGATE LIABILITY
        ARISING FROM OR RELATING TO THE SERVICES WILL NOT EXCEED THE AMOUNT PAID BY YOU TO TALLYVIS
        DURING THE TWELVE MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM.
      </p>
      <p>These limitations apply only to the extent permitted by applicable law.</p>

      <h2>18. Indemnification</h2>
      <p>
        To the extent permitted by applicable law, you agree to indemnify and hold harmless
        Tallyvis and its owners, officers, employees, contractors, and affiliates from claims,
        damages, liabilities, and reasonable expenses arising from your unlawful use of the
        Services, violation of these Terms, violation of another person&rsquo;s rights, or services
        you provide to your own customers.
      </p>

      <h2>19. Termination</h2>
      <p>You may stop using Tallyvis at any time.</p>
      <p>Tallyvis may suspend or terminate access when reasonably necessary because of:</p>
      <ul>
        <li>Material violation of these Terms</li>
        <li>Fraudulent or unlawful activity</li>
        <li>Security threats</li>
        <li>Nonpayment</li>
        <li>Abuse of the Services</li>
        <li>Legal or regulatory requirements</li>
      </ul>
      <p>Where reasonable and appropriate, we may provide notice or an opportunity to resolve the issue.</p>
      <p>Sections that by their nature should survive termination will remain effective after termination.</p>

      <h2>20. Changes to These Terms</h2>
      <p>We may update these Terms as Tallyvis develops.</p>
      <p>The updated Terms will display a revised &ldquo;Last Updated&rdquo; date.</p>
      <p>For material changes, we may provide additional notice where appropriate or required by law.</p>
      <p>
        Continued use of the Services after revised Terms become effective constitutes acceptance
        to the extent permitted by applicable law.
      </p>

      <h2>21. Governing Law</h2>
      <p>
        These Terms will be governed by applicable United States law and the law of the state in
        which Tallyvis is legally established, without regard to conflict-of-law principles,
        except where applicable consumer-protection law requires otherwise.
      </p>

      <h2>22. Entire Agreement</h2>
      <p>
        These Terms, together with the Tallyvis Privacy Policy and any additional terms expressly
        applicable to a particular service or subscription, constitute the agreement governing
        your use of the Services.
      </p>
      <p>
        If any provision is found unenforceable, the remaining provisions will remain in effect to
        the extent permitted by law.
      </p>

      <h2>23. Contact</h2>
      <p>Questions regarding these Terms may be submitted through the contact information provided on TallyVis.com.</p>
      <p>
        <strong>Website:</strong> tallyvis.com
      </p>
      <p>&copy; 2026 Tallyvis. All rights reserved.</p>
    </LegalPage>
  );
}

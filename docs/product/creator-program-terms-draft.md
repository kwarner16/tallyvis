# TallyVis Founding Creator Program — draft participant terms

**STATUS: DRAFT. Not published anywhere, not shown to any creator, and
not legally reviewed.** This exists so Kyle has a concrete starting point
to send to a lawyer (or decide to simplify himself) before actually
handing program terms to a real creator. Nothing in this document should
be presented to anyone as binding until Kyle has reviewed and approved
it — and even once he has, it should not be represented as attorney-
reviewed unless it actually has been. It restates the factual program
mechanics already implemented in code — it does not invent any new
commitment, guarantee, or legal position beyond what this document
itself states, and several sections below explicitly flag where legal
judgment is still needed. This version (V1.1) supersedes the prior draft
and reflects the hardening-pass business rules Kyle finalized after the
program's initial launch — see `docs/decisions/0040-creator-affiliate-program.md`'s
V1.1 addendum for the engineering side of the same decisions.

---

## 1. What this program is

TallyVis's Founding Creator Program is an invitation/application-based
affiliate arrangement between TallyVis and an individual creator
("Creator"). A Creator who promotes TallyVis using their unique referral
link may earn a commission on subscription revenue from businesses that
sign up through that link, and — if the Creator also operates their own
qualifying business and remains an Active Creator (defined below) — may
receive complimentary access to TallyVis. These are two separate
benefits: a Creator can earn commission without ever receiving
complimentary access, and complimentary access can end without affecting
commission already earned on existing referrals (see Sections 9 and 11).

## 2. Eligibility and acceptance

Participation is by Kyle's invitation or approval of a submitted
application — there is no self-serve signup. A Creator's program
relationship begins once Kyle creates their record in TallyVis's internal
system and communicates their referral link and terms to them. Nothing in
the public `/creators` page or application form itself creates a binding
relationship; it is only an expression of interest TallyVis reviews.

## 3. Active Creator status and qualifying content

A Creator is an "Active Creator" for a given calendar month if, during
that month, they published at least one piece of original content that:

- features, demonstrates, reviews, or teaches something about TallyVis;
- is publicly accessible (not private/unlisted-only);
- includes the Creator's TallyVis referral link where reasonably
  possible to do so; and
- complies with Section 10's disclosure requirement and contains no
  false claims about TallyVis.

There is no minimum view count, follower count, engagement level, or
number of resulting referrals/conversions — one qualifying piece,
anywhere across the Creator's platforms, satisfies the requirement for
that month (it is not required per-platform). The calendar month in
which a Creator is first activated is an onboarding month with no content
requirement; the requirement begins with the first full calendar month
after activation. Re-activating a Creator after a pause does not grant a
second onboarding month.

TallyVis does not use, and does not claim to have, any automated means of
verifying content publication, reach, or disclosure compliance. Kyle
reviews this manually and may record what he's found (a date, a link, and
a short note) in TallyVis's internal system. If Kyle identifies a month
where the requirement appears to have been missed, TallyVis's practice
(not a promise enforceable by the Creator) is to contact the Creator and
give them a reasonable opportunity to correct the record before any
status change — see Section 9.

## 4. Referral links and attribution

Each Creator receives a unique referral link
(`tallyvis.com/r/<their-code>`). Attribution works as follows, and is not
negotiable per-Creator:

- A visitor's first click on a valid, Active Creator's link is recorded
  via a first-party browser cookie for 30 days.
- If that visitor signs up for a TallyVis account within that window, the
  resulting business is permanently attributed to that Creator — this
  attribution cannot later be changed by a different link, a different
  cookie, or a different Creator's claim.
- A business can be attributed to at most one Creator, ever.
- Only a Creator whose status is Active at the moment of a NEW signup can
  receive new attribution. A link shared while a Creator was Active but
  clicked/signed-up-through after that Creator was paused or deactivated
  does not create a new referral.
- TallyVis does not currently implement multi-touch attribution (crediting
  more than one Creator, or more than one touchpoint, for the same
  signup) and has no plans to.

## 5. Commission

- **Rate and duration**: TallyVis's standard offer is a 20% recurring
  commission on eligible collected subscription revenue, for the first
  12 months of each referred, paying customer's subscription. TallyVis
  may set a different rate and/or duration for a specific Creator by
  agreement; once a commission is recorded, its rate and amount are fixed
  and are never recalculated retroactively even if the Creator's general
  rate later changes.
- **"Eligible collected revenue"** means the amount TallyVis's payment
  processor (Stripe) actually collects for a referred business's
  recurring subscription invoice, after any discount or coupon, and
  excludes: TallyVis's own one-time fees (such as a one-time installation
  fee), any portion identified by the payment processor as tax collected
  on behalf of a tax authority, and any portion later refunded (see
  Section 7).
- Commission is calculated and recorded automatically when TallyVis's
  payment processor confirms an invoice was paid.
- **Existing referrals survive a Creator's later pause or deactivation.**
  If a Creator was Active at the time a business was legitimately
  referred and attributed to them, that Creator continues earning
  eligible commission on that SAME referral's future invoices for the
  rest of that referral's original commission-duration window, even after
  the Creator is later paused or deactivated. Pausing/deactivation only
  ever affects NEW attribution and complimentary access (Sections 4 and
  9) going forward — it does not retroactively confiscate commission
  eligibility already established on an existing, legitimate referral.

## 6. Tax responsibility

Each Creator is solely responsible for determining and meeting their own
tax obligations (income tax, self-employment tax, sales/VAT, or any
other applicable tax) arising from commission payments. TallyVis does not
withhold taxes on a Creator's behalf and, in this version of the program,
does not yet have a built process for collecting tax documentation (such
as a Form W-9 or equivalent) before payment — see Section 8's open item.

## 7. Refunds and chargebacks

- If a referred business's subscription payment is refunded (in whole or
  in part) before the corresponding commission has been marked paid, the
  commission is reduced proportionally to the refunded amount — a full
  refund fully reverses the commission; a partial refund reverses the
  same proportion of the commission. Multiple partial refunds on the same
  payment are calculated from the cumulative refunded amount each time,
  so the total reversal can never exceed the original commission.
- If a refund arrives AFTER a commission has already been marked paid,
  TallyVis does not automatically claw back money already sent to the
  Creator. Instead, TallyVis records the amount owed back as a deduction
  against the Creator's future payable balance, and will discuss it
  directly with the Creator as part of normal payout reconciliation.
- A chargeback is treated the same as a refund of the disputed amount for
  purposes of this section.

## 8. Payment of commission

- TallyVis does not currently pay commissions automatically — there is no
  bank transfer, Stripe Connect, or PayPal integration in this version of
  the program. Kyle reviews and manually pays Creators, on a monthly
  cadence, for commission that has cleared a holding period (TallyVis's
  current internal policy is 30 days from when a commission is recorded)
  and meets or exceeds a minimum payout threshold (TallyVis's current
  internal policy is $25); a balance below that threshold simply rolls
  forward to the next month rather than being forfeited.
- TallyVis may delay payment of any commission reasonably suspected of
  being associated with fraud or abuse (Section 9) while it is reviewed.
- A Creator must provide lawful, accurate payment information (and any
  tax information TallyVis later requires) before a payment can be made.
- **\[Needs Kyle/legal input\]**: specific payment method(s) offered, and
  whether/when a tax form is collected — not yet built or decided.

## 9. Pausing, deactivating, and terminating a Creator

TallyVis distinguishes two different actions, which have different
consequences:

- **Pausing or deactivating** a Creator (for example, because they missed
  the content requirement and did not correct it after being given a
  reasonable opportunity to) stops new referral attribution through their
  link and may end their complimentary access, but does NOT erase
  referrals already legitimately attributed to them or confiscate
  commission eligibility already established on those referrals — see
  Section 5's "existing referrals survive" rule. TallyVis retains sole
  discretion over when and whether to reactivate a paused Creator.
- **Terminating** a Creator's participation for fraud, abuse, or a
  material violation of these terms is different: TallyVis may withhold
  or reverse commission reasonably associated with the fraudulent or
  abusive conduct itself. Commission legitimately earned from unrelated,
  genuine referrals is not automatically forfeited merely because the
  Creator's overall participation was terminated for cause — but TallyVis
  reserves the right to review and, where warranted, withhold any amount
  reasonably in dispute while an issue is investigated.

Examples of prohibited conduct that may lead to termination for cause:
referring oneself or a business one effectively controls to manufacture
commission, creating fake accounts, cookie stuffing or otherwise
manipulating attribution, spam, impersonation, or making false claims
about TallyVis.

## 10. Disclosure and the Creator's independence

- The Creator is solely responsible for clearly and conspicuously
  disclosing their material connection to TallyVis (e.g. "#ad," "TallyVis
  partner," or equivalent plain-language disclosure) wherever and
  whenever they promote TallyVis or their referral link, in accordance
  with applicable advertising/endorsement law and platform rules in their
  own jurisdiction and on each platform they use. TallyVis does not
  provide individualized legal advice to Creators about how to comply.
- The Creator is never required to give positive-only coverage. Honest
  reviews, including criticism of TallyVis, are permitted and expected;
  being an active, disclosed participant in this program does not
  obligate a Creator to misrepresent their genuine opinion.

## 11. Complimentary TallyVis access

- If offered, a Creator's own qualifying business may use TallyVis at no
  charge while the Creator remains an Active Creator.
- This access is tied to the Creator's Active status specifically (not
  merely to having ever been a Creator) and ends immediately, with no
  separate notice step, if the Creator is paused or deactivated. It is
  distinct from, and can end independently of, commission already earned
  on the Creator's existing referrals (Section 5).
- **\[Needs Kyle/legal input\]**: whether any minimum notice should be
  promised before revoking complimentary access — this draft does not
  promise any.

## 12. Content ownership and TallyVis's use of it

- The Creator retains ownership of the content they create (videos,
  posts, reviews, etc.) about TallyVis. Participating in this program
  does not transfer ownership of that content to TallyVis, and TallyVis
  does not have an unlimited, automatic license to reuse it.
- If TallyVis wants to reuse a Creator's content in paid advertising or
  other marketing beyond ordinary sharing/linking to it (e.g. resharing
  it on TallyVis's own social accounts), TallyVis will ask the Creator for
  separate, explicit permission first, unless the Creator has already
  granted a broader license in writing.

## 13. Separate sponsorship arrangements

The commission-and-complimentary-access relationship described in this
document is the standard Founding Creator Program benefit and is
automatic once a Creator is active in the program. A separate paid
sponsorship or per-piece fee arrangement (for example, paying a Creator a
flat fee for one specific video) is a DIFFERENT, separately negotiated
agreement — it is never automatic, is never implied by mere program
participation, and would be documented on its own terms if and when
TallyVis and a specific Creator agree to one.

## 14. No income guarantee

TallyVis makes no promise or guarantee about how much, if anything, a
Creator will earn through this program. Past results of any other
creator are not a guarantee of future results.

## 15. Program modification and termination

TallyVis may modify, pause, or end this program generally, or a specific
Creator's participation in it, at any time and for any reason. Commission
already earned and still eligible under Section 5's rules at the time of
such a change survives it and remains payable under these terms, unless
TallyVis determines the underlying referral was fraudulent or obtained in
violation of these terms (Section 9).

**\[Needs Kyle/legal input\]**: a real agreement should also cover, at
minimum: confidentiality of any early-access/product information shared
with the Creator, a dispute-resolution/governing-law clause consistent
with TallyVis's main Terms of Service, and limitation-of-liability
language. None of that is drafted here.

---

*End of draft. Do not send this to a creator as-is.*

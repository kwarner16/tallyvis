# TallyVis Founding Creator Program — Kyle's playbook

How to run the program day to day: recruiting a creator, setting them up,
tracking their monthly activity, paying them, and handling the edge cases
(inactivity, refunds, deactivation). See
`docs/decisions/0040-creator-affiliate-program.md` (including its V1.1
addendum) for the underlying architecture and reasoning; this document is
the operational "what do I actually click, and when" counterpart.

## The full lifecycle, at a glance

1. Recruit a creator (outreach or inbound application).
2. Agree on terms (standard 20%/12-month, or custom).
3. Create them in `/admin/creators`.
4. Activate them and send their link.
5. Grant complimentary access, if applicable.
6. Each month: record their qualifying content.
7. Each month: review commissions owed.
8. Wait out the 30-day holding period before paying.
9. Pay the eligible balance manually, outside TallyVis.
10. Mark each paid commission correctly in the dashboard.
11. Handle inactivity (missed content) if it comes up.
12. Handle refunds/adjustments as they arrive.
13. Deactivate when necessary — existing referrals keep paying out.

The sections below walk through each step.

## 1. Recruit a creator

- A public application arrives by email (from `/creators`'s form) to
  whatever `CONTACT_EMAIL_TO_ADDRESS` is configured as, subject line
  `TallyVis Creator Program application: <name>`. It is **just an email**
  — nothing is created in the database yet.
- Or you reach out first. See "Outreach email template" at the bottom of
  this document for approved copy you can send as-is or adapt.
- Either way, nothing in TallyVis itself happens until you create them in
  the admin dashboard (step 3).

## 2. Agree on terms

Before creating their record, confirm with the creator (even informally,
over email/DM):

- The standard offer: 20% recurring commission on eligible collected
  revenue, for the first 12 months of each business they refer, plus
  complimentary TallyVis access while they're an Active Creator (one
  piece of real content per month, no view/follower minimums).
- Whether you're offering them different terms (a different rate or
  duration) — if so, you'll set that explicitly in step 3.
- That they understand the disclosure requirement (Section 10 of
  `docs/product/creator-program-terms-draft.md`) and that complimentary
  access and commission are two separate things — losing one doesn't
  automatically lose the other (see step 11/12 below).

## 3. Add the creator

1. Sign in to the dashboard as an admin and go to **Admin → Creators**
   (`/admin/creators`).
2. Fill in the "Add a creator" form at the bottom of that page:
   - **Name**, **Email** — required.
   - **Referral code** (the `slug`) — required, becomes
     `tallyvis.com/r/<code>`. Choose something short and memorable
     (their handle/name is usually easiest). **This cannot be changed
     later** once you start sharing it — pick carefully.
   - **Primary platform** / **Profile URL** — optional, for your own
     reference.
   - **Commission rate** / **Commission duration** — pre-filled with the
     program default (20% / 12 months). Only change these for this
     specific creator if you've agreed to different terms with them.
   - **Internal notes** — anything you want to remember (how you met
     them, audience size, what you agreed to).
3. Submit. You land on that creator's detail page
   (`/admin/creators/<id>`), which immediately shows their referral URL
   with a **Copy** button — this is the exact link to send them.
4. New creators start in **Prospect** status.

## 4. Activate them and send their link

A referral link only actually attributes anything once the creator's
status is **Active** — use the status buttons on their detail page to
move them along (Prospect → Invited → Active) once you've actually agreed
to work together and are ready for their link to go live.

The moment you set a creator **Active** for the first time, TallyVis
stamps their activation date — this is what starts their onboarding
month (see step 6). Pausing and later re-activating them does NOT reset
this date or grant a second onboarding month.

Copy the referral URL from their detail page and send it to them
directly (email, DM, whatever). There's no creator-facing login or
dashboard in this version of the program.

## 5. Grant complimentary access (if applicable)

Only relevant if the creator also runs their own window-cleaning business
on TallyVis (most creators won't).

1. On their detail page, under **Free TallyVis access**, paste in their
   business's internal ID. You can find a business's ID on its own
   `/admin/businesses/<id>` page.
2. Click **Link**.
3. Click **Grant complimentary access**.

That business now skips TallyVis's normal subscription paywall entirely
— no Stripe charge, no fake trial, just free access for as long as this
is on and the creator's status is Active. Pausing/deactivating the
creator, or clicking **Revoke complimentary access**, turns it back off
immediately.

## 6. Each month: record their qualifying content

TallyVis does not, and cannot, automatically check whether a creator
posted qualifying content — you have to actually look (their channel,
their feed, wherever they post) and record what you found.

On their detail page, under **Active Creator status**:

- The page shows you when the content requirement actually begins for
  this creator — the calendar month they were activated in is a free
  onboarding month with no requirement; it kicks in the month after that.
- When you find a qualifying post, fill in the date, paste the link, and
  optionally a short note, then submit. This **replaces** the previously
  recorded entry — TallyVis doesn't keep a full history of every past
  post, just the most recent one, since that's all the "are they still
  active" question needs.

If you can't find anything for a given month, see step 11.

## 7. Each month: review commissions owed

On `/admin/creators`, the table shows every creator's clicks, signups,
paying customers, MRR, pending commission, payable commission, paid
commission, and adjustments at a glance. Click a creator's name for the
detail: a **Commission summary** card (pending/payable/paid/adjustments),
an **Unpaid commissions** table showing each commission's net-of-reversal
amount and whether it's "Payable" or still "Pending," and a **Commission
history** table of what's already settled.

- **Pending** = still inside the 30-day holding period — not yet
  something you'd normally pay.
- **Payable** = cleared the holding period — ready to actually pay out.
- A commission that was partially refunded shows its reduced, net amount
  directly — you always pay what's shown, not the original gross
  commission amount.

## 8. Wait out the holding period

TallyVis's internal policy is a 30-day holding period before a commission
is considered payable, and a $25 minimum payout threshold (a balance
below that simply rolls forward to next month rather than being
forfeited). Neither of these is hard-blocked in the app — you can mark
something paid early or below threshold if you have a good reason to —
but the dashboard's "Payable" vs. "Pending" labels follow this policy by
default so you have a sane default view.

## 9. Pay the eligible balance manually

This program does **not** pay out automatically — there's no bank
transfer, Stripe Connect, or PayPal integration. When you're ready to
actually send a creator money (however you've arranged — bank transfer,
PayPal, whatever), pay them OUTSIDE TallyVis first. TallyVis never
initiates or touches a real money movement.

## 10. Mark each paid commission correctly

1. Go to that creator's detail page.
2. In the **Unpaid commissions** table, each row is one Stripe invoice's
   worth of commission.
3. After you've actually paid the creator, click **Mark paid** on each
   row you just paid — you can add a short note (e.g. a transaction
   reference) in the field next to the button. This moves it out of
   "unpaid" and into that creator's history, permanently.

There's no bulk "mark all paid" — click each row. If you pay several
creators at once, do this for each creator's rows after paying them.

Once a commission is marked paid, TallyVis never rewrites that row again
— even if a refund later arrives on that same payment (see step 12).

## 11. Handle inactivity (missed content requirement)

TallyVis never automatically pauses or deactivates a creator for missing
their monthly content — that decision is always yours, and the system
has no ability to verify content on its own anyway. The intended process:

1. Notice the gap (their **Active Creator status** card on the detail
   page shows you the last thing you recorded and when).
2. Reach out to the creator directly and let them know.
3. Give them a reasonable opportunity to post something and correct the
   record.
4. If they don't, THEN use the status buttons to pause or deactivate them
   — see step 13 for exactly what that does and doesn't affect.

## 12. Handle refunds and adjustments

If Stripe tells TallyVis a payment was refunded, the corresponding
commission is automatically adjusted — proportionally to how much was
refunded, not an all-or-nothing reversal. A $25 refund on a $100 payment
with a $20 commission reverses $5, not the full $20. Multiple partial
refunds on the same payment are handled correctly without your
involvement; a full refund fully reverses the remaining commission.

If a refund arrives on a payment whose commission you'd **already marked
paid**, TallyVis does NOT claw that money back automatically — the
historical "Paid" row stays exactly as it was. Instead, you'll see a
negative entry appear in that creator's **Adjustments** table on their
detail page — this is money the creator effectively owes back, netted
against their NEXT payout. It's on you to actually have that
conversation with the creator and account for it when you next pay them;
TallyVis just keeps the auditable record.

## 13. Pausing, deactivating, and terminating a creator

Use the status buttons on their detail page. TallyVis distinguishes two
different situations:

- **Pause / Deactivate** (the normal case — e.g. they went quiet and
  didn't post, or you're ending things amicably): their link stops
  attributing NEW signups immediately, and if they have free TallyVis
  access, that's suspended immediately too. **Referrals they already
  legitimately earned while Active keep paying out commission for the
  rest of that referral's original 12-month (or custom) window** — you
  do not lose, and should not expect to lose, commission income on
  existing referrals just because you paused someone. This is
  intentional and verified by automated tests.
- **Terminating for fraud/abuse** (self-referral, fake accounts, cookie
  stuffing, spam, false claims, etc.): this is a judgment call you make
  yourself — TallyVis has no automated fraud detection beyond basic
  self-referral checks (see step 14). If you determine a specific
  referral was fraudulent, you have standing to withhold or reverse the
  commission tied to THAT referral specifically; you don't need to (and
  generally shouldn't) also confiscate commission from that same
  creator's other, legitimate referrals just because you're terminating
  them for cause.

Already-earned commissions are never deleted or hidden when you change a
creator's status — their history stays intact for your records either
way.

## 14. Self-referral and abuse protection (automatic)

TallyVis automatically blocks a referral from being attributed at all
if the new business's signup email matches the creator's own program
email, or if the new business is the creator's own already-linked
TallyVis business. You won't see these as referrals in the first place —
they're silently skipped at signup. This is a basic safety net, not a
substitute for your own judgment; anything more sophisticated (shared
devices, a friend-of-the-creator signing up, etc.) is still something
only you can catch by reviewing the referred-businesses list yourself.

## 15. Common questions

**Can I change a creator's commission rate later?** Yes, in their edit
form on the detail page. It only affects commissions calculated AFTER
the change — anything already recorded keeps the rate that was in effect
when it was created.

**What if someone clicks two different creators' links before signing
up?** Whichever one they clicked FIRST is who gets credited, and only if
that creator was Active at the time of signup.

**What if a referred business cancels and resubscribes a year later?**
The 12-month commission window is fixed from their FIRST real payment and
never resets — a long-cancelled-then-returning customer likely falls
outside the window and generates no further commission. This is
intentional, not a bug.

**If I deactivate a creator, do I lose the commission they already
earned?** No — see step 13. Deactivation stops NEW attribution and may
end complimentary access, but existing, legitimate referrals keep paying
out for their original eligibility window.

---

## Outreach email template

Approved copy for reaching out to a creator you want to recruit. Use as-
is, or adapt lightly — but keep the substance (20%, monthly content
requirement, no automated payouts/portal) accurate to what's actually
built. **This is a template to copy into your own email client — TallyVis
has no outbound email campaign system, and this program does not send
this automatically.**

> **Subject: TallyVis Founding Creator Program**
>
> Hi [First Name],
>
> I'm Kyle, the founder of TallyVis — an AI tool that lets window
> cleaning (and other home service) businesses turn a few photos into an
> instant, accurate quote.
>
> I've been following your content and think your audience would
> genuinely find this useful, so I wanted to personally invite you to our
> **Founding Creator Program**.
>
> Here's what that means:
>
> - You get **TallyVis at no cost while you're an active creator** — if
>   you run your own window cleaning business, you can use the real
>   product free of charge.
> - You earn a **20% recurring commission** on any business you refer
>   that becomes a paying TallyVis customer, for their first 12 months
>   with us.
> - The only thing we ask in return is **at least one piece of
>   meaningful TallyVis content per month** — a video, a post, a review,
>   whatever fits your platform. No minimum views or followers required.
> - You'll also have a **direct line to me as the founder** — not a
>   support queue. Your feedback genuinely shapes what we build next.
>
> If that sounds interesting, just reply and I'll get you set up with
> your own referral link.
>
> Kyle Warner
> Founder, TallyVis
> tallyvis.com

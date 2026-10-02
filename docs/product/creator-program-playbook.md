# TallyVis Founding Creator Program — Kyle's playbook

How to run the program day to day: inviting a creator, setting them up,
monitoring their performance, and paying them. See
`docs/decisions/0040-creator-affiliate-program.md` for the underlying
architecture and reasoning; this document is the operational "what do I
actually click" counterpart.

## 1. Someone applies, or you want to invite someone

- A public application arrives by email (from `/creators`'s form) to
  whatever `CONTACT_EMAIL_TO_ADDRESS` is configured as, subject line
  `TallyVis Creator Program application: <name>`. It is **just an email**
  — nothing is created in the database yet.
- You can also decide to invite someone who never applied.
- Either way, nothing in TallyVis itself happens until you create them
  in the admin dashboard (step 2).

## 2. Add the creator

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
4. New creators start in **Prospect** status. A referral link only
   actually attributes anything once the creator's status is **Active**
   — use the status buttons on their detail page to move them along
   (Prospect → Invited → Active) once you've actually agreed to work
   together and are ready for their link to go live.

## 3. Give them their link

Copy the referral URL from their detail page and send it to them
directly (email, DM, whatever). There's no creator-facing login or
dashboard in this version of the program — see the ADR's "Deferred"
section for why, and what a future one could look like without a
database redesign.

## 4. Watch it work

On `/admin/creators`, the table shows every creator's clicks, signups,
paying customers, MRR, and commission at a glance. Click a creator's
name to see:

- Their referred businesses, with signup date, plan, and subscription
  status.
- Every commission they've earned, split into **Unpaid** (owed, not yet
  paid) and **history** (already paid, or reversed because the
  underlying payment was refunded).

A business only ever appears here because it genuinely signed up through
that creator's link within the 30-day cookie window, or (if cookies
expired) an account the creator's referral cookie was still present for
— see the ADR's "Attribution" section for exactly what counts.

## 5. Pay a creator

This program does **not** pay out automatically — see the ADR for why.
When you're ready to actually send a creator money (however you do
that — bank transfer, PayPal, whatever you've arranged):

1. Go to that creator's detail page.
2. In the **Unpaid commissions** table, each row is one Stripe invoice's
   worth of commission.
3. Pay the creator OUTSIDE TallyVis however you've agreed (not something
   this app does).
4. Come back and click **Mark paid** on each row you just paid — you can
   add a short note (e.g. a transaction reference) in the field next to
   the button. This moves it out of "unpaid" and into that creator's
   history, permanently.

There's no bulk "mark all paid" — click each row. If you pay several
creators at once, do this for each creator's rows after paying them.

## 6. If a referred customer gets a refund

Nothing for you to do — if Stripe tells TallyVis a payment was refunded,
the corresponding commission is automatically marked **Reversed** in
that creator's history. If you'd already marked it paid before the
refund happened, it stays "Paid" (a real payment you already made) and
that becomes a conversation to have with the creator directly, not
something the app resolves for you.

## 7. Pausing or ending a relationship with a creator

Use the status buttons on their detail page:

- **Pause**: their existing referrals/commissions are untouched, but
  their link stops attributing NEW signups until you reactivate them.
- **Deactivate**: same effect, intended as the longer-term/final state.
- If they also have free TallyVis access (see below) and you deactivate
  or pause them, that access is suspended immediately — you don't need a
  separate step.

Already-earned commissions are never deleted or hidden when you change
a creator's status — their history stays intact for your records.

## 8. Giving a creator free TallyVis access

Only relevant if the creator also runs their own window-cleaning
business on TallyVis (most creators won't).

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

## 9. Common questions

**Can I change a creator's commission rate later?** Yes, in their edit
form on the detail page. It only affects commissions calculated AFTER
the change — anything already recorded keeps the rate that was in
effect when it was created.

**What if someone clicks two different creators' links before signing
up?** Whichever one they clicked FIRST is who gets credited — see the
ADR's "Attribution" section.

**What if a referred business cancels and resubscribes a year later?**
The 12-month commission window is fixed from their FIRST real payment
and never resets — a long-cancelled-then-returning customer likely falls
outside the window and generates no further commission. This is
intentional, not a bug.

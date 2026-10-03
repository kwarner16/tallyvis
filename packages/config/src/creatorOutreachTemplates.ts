/**
 * Founding Creator outreach email copy, stored verbatim as Kyle wrote
 * it (see docs/decisions/0042-creator-outreach-tracker.md's "Email
 * template behavior" section). Plain text only — no Markdown — so the
 * "Copy Email" button never puts `**`/other Markdown syntax on the
 * clipboard. TallyVis never sends either of these; they exist only to
 * be copied, pasted into a real email client, personalized, and sent
 * by Kyle manually.
 *
 * Dollar figures in Email #1 ($159/month, $31.80/month) reflect the
 * "growth" plan's real price at the time this was written
 * (`packages/config/src/plans.ts`) — they are Kyle's own authored copy,
 * not computed from `PLANS`, so a future price change does not silently
 * rewrite his sentence; update this file by hand if the referenced
 * price ever changes.
 *
 * Name substitution: only ever from a known CONTACT name (a real
 * person's name), never from a creator's channel/display name — see
 * `firstNameOf`'s own comment. A prospect with no contact name on file
 * keeps the literal placeholder so Kyle notices and fills it in by
 * hand.
 */

/** First token of a real contact name only — e.g. "Steve Smith" -> "Steve". Never derived from a channel/display name (a channel like "SteveO The Window Cleaner" is not reliably anyone's first name). */
export function firstNameOf(contactName: string | undefined | null): string | undefined {
  const trimmed = contactName?.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/\s+/)[0];
}

export function renderOutreachEmail1(contactName?: string | null): string {
  const name = firstNameOf(contactName) ?? "[Name]";
  return `Hi ${name},

My name is Kyle Warner. I'm the founder of TallyVis, and I wanted to personally offer you a chance to make money from your content.

We're starting something called the TallyVis Founding Creator Program, where we're inviting a small group of creators to partner with us.

What does that mean for you?

20% RECURRING commission from EVERY paying customer you refer - EVERY month for their first 12 MONTHS.

Trust me, this stacks.

Our most popular plan is $159/month. If someone subscribes through your link, that's $31.80/month paid to you for as long as they remain subscribed and eligible during those 12 months.

10 customers? $318/month.
25?
50?
You do the math.

All we want from you is to actually use TallyVis - for free while you're an active creator - and make at least one piece of content per month showing your real experience with it. We'll give you your own affiliate link, and the customers you send our way can start building recurring commission for you.

NOTE: We're keeping the Founding Creator group intentionally small, so I can't guarantee we'll have spots available for long.

If you're interested, just reply to this email. I'll send you the details, show you what's next, and get your creator account set up if you wish to do so.

Best,
Kyle Warner
Founder, TallyVis
tallyvis.com`;
}

export function renderOutreachEmail2(contactName?: string | null): string {
  const name = firstNameOf(contactName) ?? "[First Name]";
  return `Hey ${name},

Awesome man! I actually watched your video on [SPECIFIC VIDEO/TOPIC] — I think TallyVis could work really well with the kind of stuff you're already making.

[1–2 PERSONAL SENTENCES RESPONDING DIRECTLY TO WHAT THEY SAID IN THEIR REPLY.]

Getting started is pretty simple. Here's how it'll work:

1. We'll get you set up with TallyVis for free.
   I want you to actually use the product yourself before you start making content about it.
2. You'll get your own affiliate link.
   Anyone who becomes a paying TallyVis customer through your link gets attributed to you.
3. You earn 20% recurring commission.
   You'll earn 20% of eligible subscription revenue from each customer you refer, every month, for their first 12 months with us.
4. Make it your own.
   All I'm asking is that you make at least one meaningful piece of TallyVis content per month while you're an active creator. No scripts, no minimum views, and no engagement quotas. Show it however makes sense for your audience and give them your real opinion.

[PERSONAL TRANSITION — e.g. "I think your audience would especially get a kick out of seeing ___."]

If you're down, I'll [EXACT NEXT STEP] and we can get you rolling.

Kyle`;
}

export const OUTREACH_EMAIL_SUBJECT_1 = "A partnership idea for you";

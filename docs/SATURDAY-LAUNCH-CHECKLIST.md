# Saturday Launch Checklist

Produced during the final validation & launch-readiness pass, Thursday
night 2026-09-24 into Friday 2026-09-25. Baseline before this pass:
`34e4e24` (tagged locally as `pre-launch-baseline-2026-09-24`), 504
tests passing, clean lint/typecheck/build, clean working tree.

This file is the living pre-launch punch list. Update it as items close.

---

## MUST FIX BEFORE SELLING

Things that could cause payment failure, account/login failure,
customer-data exposure, tenant leakage, estimator failure, materially
incorrect silent quoting, broken onboarding/embed, production email
failure, or inability to manage a subscription.

### 1. Stripe was completely unconfigured in production — IN PROGRESS

**Confirmed during this pass**: `tallyvis-app`'s Vercel production
environment had **none** of `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_STARTER/GROWTH/PRO/INSTALLATION` set. The code degrades
gracefully (`billingConfigured()` returns false rather than crashing —
verified in `services/api/src/billing/index.ts`/`services/subscriptions.ts`),
but it meant **no business could choose a plan, start a trial via
Checkout, or manage billing** — the core of "sell real subscriptions."

**Done this session** (test mode, in the "TallyVis" Stripe account,
`acct_1UICRTBGRArqyRXr`):
- Created 4 Products/Prices matching `packages/config/src/plans.ts`
  exactly: Starter $69/mo (`price_1UJN4WBGRArqyRXr4tRxTUmP`), Growth
  $159/mo (`price_1UJN4hBGRArqyRXrpwkqjdy3`), Pro $299/mo
  (`price_1UJN4mBGRArqyRXrqjHrxGMy`), Installation $299 one-time
  (`price_1UJN4rBGRArqyRXrFGXv5hZl`).
- Created a webhook endpoint at `https://app.tallyvis.com/api/webhooks/stripe`
  listening for `checkout.session.completed`,
  `customer.subscription.created/updated/deleted`.
- Set `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_PRO`,
  `STRIPE_PRICE_INSTALLATION`, `STRIPE_WEBHOOK_SECRET` on Vercel
  production (`tallyvis-app`).

**Still required (you)**:
- [ ] Grab the **test-mode** secret key from
      https://dashboard.stripe.com/test/apikeys and run
      `vercel env add STRIPE_SECRET_KEY production` in `apps/app`.
- [ ] Trigger a redeploy (env var changes don't apply to an
      already-built deployment).
- [ ] Run a real test-mode Checkout end to end (Part 12/Friday) —
      trial start, webhook delivery, dashboard billing state, Customer
      Portal, cancel/reactivate.
- [ ] When ready to take real money: repeat the Product/Price/webhook
      creation in **live mode** and swap the five env vars — a
      deliberate, separate step, not automatic from test mode.

### 2. Google OAuth redirect URI — NOT independently verifiable this session

Code derives the redirect URI correctly and consistently:
`` `${NEXT_PUBLIC_APP_URL}/api/auth/google/callback` `` in both
`start/route.ts` and `callback/route.ts`, and `NEXT_PUBLIC_APP_URL` is
confirmed set in Vercel production. I do not have access to the Google
Cloud Console for this project.

- [ ] Confirm the OAuth client's **Authorized redirect URIs** in Google
      Cloud Console includes exactly `https://app.tallyvis.com/api/auth/google/callback`
      (no trailing slash, exact scheme/host).
- [ ] Do one real "Sign in with Google" as part of Friday's pass —
      signup, login, and an already-logged-in "link Google" from
      `/dashboard/settings`.

### 3. Email provider/domain — value not independently verifiable

`EMAIL_PROVIDER`, `RESEND_API_KEY`, and `EMAIL_FROM_ADDRESS` are all set
in Vercel production (confirmed present), but their hidden values
weren't read this session.

- [ ] Confirm `EMAIL_PROVIDER` is literally `resend`, not `dev` — the
      `dev` provider only logs to the server console and sends nothing,
      which would make password reset and "email this quote" silently
      no-op in production with no customer-visible error.
- [ ] Confirm `EMAIL_FROM_ADDRESS`'s domain is verified in Resend (an
      unverified sending domain fails delivery, sometimes silently from
      the customer's point of view).
- [ ] Send one real password-reset email and one real "email this
      quote to the customer" during Friday's pass, checking actual
      inbox delivery — not just the dev-console log.

### 4. Full live click-through — NOT completed this session

Browser automation (Claude for Chrome) was unavailable in this
environment this session (extension not connected), so Part 8/10's
full interactive customer + business + billing + embed walkthrough
was **not exercised end to end**. Everything in this checklist that
says "confirmed" was verified by code inspection, the automated test
suite (520 tests, see below), direct HTTP checks, and Vercel
build/deploy/log inspection — not by clicking through the product as a
real user would. **This is the single most important remaining gap.**
Part 12's Friday manual campaign is the actual acceptance test for
launch — do not treat this document's other checkmarks as a substitute
for it.

### 5. `needs_review` escalation — FIXED this session

`determineInitialQuoteStatus` (`services/api/src/services/quotes.ts`)
forced `needs_review` on ANY evidence tier short of `"sufficient"`, even
after a customer fully confirmed every pricing-critical field (the
confirm page only caps confidence for strictly `"insufficient"`
evidence) or a business reviewed and saved a quote itself (which always
records confidence `"high"` on save). That permanently forced review
based on a historical, already-resolved coverage gap. Fixed: only
genuinely `"insufficient"` evidence still escalates unconditionally —
`"usable_with_uncertainty"` no longer does once confidence is genuinely
high. New/updated tests in `quoteEscalation.test.ts` and
`benchmarkCases.test.ts` cover both the old and new behavior explicitly.
Committed as `c916466`, pushed and deployed.

---

## SHOULD FIX SOON

Real issues that don't prevent onboarding the first few customers.

- **Public estimator: a re-analysis loop after the quote already exists
  never updates that quote.** The customer-facing `/estimate/result`
  page creates a `Quote` record as soon as it first loads (by design —
  captures a lead even if the customer never finishes). If a customer
  then clicks "Add another photo," re-runs analysis, and re-confirms,
  the on-screen price they see is correct, but the **already-created
  quote row is never updated** with the better analysis/photos — the
  business would see the original (usually `needs_review`, since
  evidence wasn't sufficient on the first pass) record, not the
  improved one. Deliberately not fixed under time pressure: a real fix
  needs either an authenticated-equivalent "update my own just-created
  quote" mechanism (new attack surface — quote ids are opaque UUIDv4,
  low risk, but this is exactly the "quote id as authorization"
  anti-pattern ADR 0012 replaced with real share tokens) or a product
  decision to defer quote creation until analysis is stable. Needs
  deliberate design, not a rushed launch-week patch.
- **`turbo.json` is missing `env` declarations** for `AI_PROVIDER`,
  `AI_PROVIDER_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`,
  `STRIPE_PRICE_*`, `STRIPE_WEBHOOK_SECRET` (confirmed via a build
  warning during this session's deploy). These are all read at request
  time, not baked into the build, so this isn't causing wrong behavior
  today — but it means Turborepo's build cache doesn't know these vars
  affect the app, which is exactly the kind of gap that bites later.
- **A benign `pg`/SSL deprecation warning is logged at `error` level on
  every cold start** (`SECURITY WARNING: The SSL modes 'prefer'...`),
  confirmed in production logs. Not a real error, but it pollutes error
  monitoring and could mask or get confused with a genuine incident.
  Fix by setting `sslmode=verify-full` explicitly in the connection
  string, or filtering it at the logging layer.
- **Benchmark harness delete has no confirmation** — internal-only
  tool, low risk, but a stray click permanently removes a test case
  with no undo.

---

## POST-LAUNCH

Improvements, polish, optimization, analytics, additional automation,
longer-term technical work.

- Per-business configurable escalation policy ("always auto-send" vs.
  "always review") — `determineInitialQuoteStatus` was deliberately
  kept as one small, pure function specifically so this can call it
  conditionally later without changing its logic (see its own comment).
- A more elaborate review/confidence system (automatic flagging,
  review queue) beyond today's binary `needs_review` — already flagged
  as future work in ADR 0013.
- Benchmark harness: CSV export, richer per-condition breakdowns,
  photo-quality auto-classification instead of manual tags.
- Live-mode Stripe cutover once ready to take real payments (separate,
  deliberate step from this session's test-mode wiring).

---

## Friday manual test campaign

A practical benchmark plan — ~20-30 scenarios, not hundreds. Capture
every one in `/dashboard/testing` (the new benchmark harness built this
session) so results are structured, not just impressions.

### Sequence (do these roughly in order; each takes a few minutes)

1. **Baseline good case** — a real house, 4-6 clear daylight photos,
   normal distance, no obstruction. Record ground truth (actual window
   count, screens, stories, access) before looking at the AI result.
2. **Same house, distant/across-street only** — same property, but
   only far-away photos. Compare accuracy to #1.
3. **Same house, close-up only** — only close crops of individual
   windows/sections, no overview shot.
4. **Same house, mixed close-up + overview** — the realistic customer
   pattern.
5. **Overcast** — same or a different house, overcast lighting.
6. **Bright sun / harsh shadows.**
7. **Glare/reflection** — shoot toward reflective glass at an angle
   that catches glare.
8. **Dusk.**
9. **Low light / indoor-adjacent evening shot.**
10. **Blurry image** (one intentionally motion-blurred photo in the
    set).
11. **Poor-quality image** (low resolution / heavily compressed).
12. **Partial obstruction** — a parked car or trash cans blocking part
    of the facade.
13. **Heavy obstruction** — trees/bushes covering a meaningful fraction
    of visible windows.
14. **Detached single-family, 1 story.**
15. **Detached single-family, 2 story.**
16. **Detached single-family, 3+ story** (if available).
17. **Townhouse.**
18. **Neighboring house visible** in frame — confirm the AI doesn't
    count the neighbor's windows.
19. **Incomplete property coverage** — deliberately omit one side of
    the house from the photo set (missing-side condition tag).
20. **Unusual/grouped/bay windows** — a property with at least one bay
    window or an unusual grouped arrangement.
21. **Glass doors present** — confirm they aren't miscounted as
    windows.
22. **Screens present, clearly visible.**
23. **Repeated/overlapping angles** — deliberately submit 2 photos of
    nearly the same angle, see if it double-counts.
24. **Recovery test — link to a prior "insufficient evidence" case**:
    take case #2's (distant-only) result, then add 2 closer follow-up
    photos as a NEW case linked via "Follow-up to" back to case #2, and
    confirm accuracy improves and evidence upgrades toward
    "sufficient." This is what Part 6/7's guided-capture verification
    is actually testing.
25. **Manual-entry fallback** — on the real customer estimator (not the
    harness), simulate an AI failure or explicitly use `/estimate/manual`
    and confirm a quote still gets created.
26-30. **Free scenarios** — use your own judgment for a handful more
   real customer-style photo sets (normal phone photos, not staged) to
   round out the sample toward 20-30 total.

After each case: check the AI result, evidence tier, and any "add more
photos" message; enter ground truth; enter what you'd realistically
confirm as the customer; save. The dashboard's summary cards and
by-condition table update automatically.

### What to read from the results afterward

- Is raw recall/accuracy noticeably worse for distant, obstructed, or
  low-light photos than for clear ones? (Expected — confirms the
  evidence-quality system is tracking real difficulty, not
  arbitrary.)
- Does "evidence tier" correlate with actual accuracy (the
  evidence-warning-effectiveness table)? If insufficient-evidence cases
  are just as accurate as sufficient ones, the warning isn't earning
  its keep.
- Did the recovery test (#24) actually improve accuracy and evidence
  tier?
- Is customer-confirmed accuracy meaningfully better than raw AI
  accuracy? (It should be — that's the whole point of the confirmation
  step.)

---

## Launch gate (evidence-based, not an arbitrary accuracy number)

Answer these from Friday's actual results, not from memory:

- [ ] Does the AI usually produce a *usable* observation (not
      necessarily perfect)?
- [ ] Does it correctly recognize genuinely poor-evidence cases rather
      than confidently presenting an unsupported total?
- [ ] Does guided capture (the recovery-test scenario) measurably help?
- [ ] Can a customer easily correct a wrong AI value, and is the
      corrected value what actually gets priced (never the AI's raw
      value)?
- [ ] Is server-side pricing still the only source of a dollar amount
      anywhere in the flow (spot-check: no client-computed total is
      ever sent to `createQuote`/`createQuotePublic` and trusted)?
- [ ] Are genuinely unresolved/insufficient-evidence cases escalated to
      `needs_review` instead of silently quoted? (Verified in code +
      tests this session; Friday should confirm it in practice too.)
- [ ] Does the complete Stripe → onboarding → embed → estimate →
      quote → share → accept/decline flow work without you touching
      anything mid-flow? (Not yet verified live — see MUST FIX #4.)

**We can launch with imperfect computer vision. We cannot launch with
silent, uncontrolled quoting errors or a broken payment/onboarding
path.** Keep that distinction central when deciding Saturday morning.

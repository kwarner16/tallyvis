# 0042 — Founding Creator Outreach Tracker V1

## Status

Accepted. The creator-side equivalent of the Sales Call Tracker (ADR
0041), built the same evening on the same internal-admin-tool pattern.
Lives inside the EXISTING `/admin/creators` area rather than as a
separate top-level admin section — this is explicitly about creators
BEFORE they join the Founding Creator Program, not a second, unrelated
system.

## Why this exists

Kyle researches creators (via ChatGPT) who might be good Founding
Creator partners, and needed a way to paste that researched list into
TallyVis, have it detect anyone already imported/contacted, work
through the rest one by one, quickly open each creator's actual content
to understand them before reaching out, copy a prewritten (but always
manually personalized and manually sent) outreach email, record what
happened, schedule follow-ups, and — once a creator says yes — safely
convert them into a real Founding Creator record without duplicating or
bypassing any of that program's existing rules.

## Architecture

Mirrors the Sales Call Tracker's shape, and reuses rather than
duplicates wherever a direct line existed:

- **Shared tokenizer**: `services/tabularImportParsing.ts` is a new
  extraction of the Sales Call Tracker's own paste-parsing engine
  (delimiter detection, Markdown-table tolerance, header aliasing) —
  `salesImportParsing.ts` was refactored to use it with no behavior
  change (confirmed by its full existing test suite still passing
  unmodified), and `creatorOutreachParsing.ts` is a second, independent
  thin wrapper around the same engine. Neither feature duplicates the
  tricky tokenizing logic.
- **Repositories** (`repositories/creatorProspects.ts`,
  `repositories/creatorOutreachActivities.ts`) — same `TEXT`/ISO-string/
  `makeId()` conventions as every other table in this schema.
- **Services** (`services/creatorProspects.ts`,
  `services/creatorOutreachActivities.ts`) — every exported admin
  function independently re-checks `isAdminSession`. Conversion
  (`convertProspectToCreatorAdmin`) calls `services/creators.ts`'s
  EXISTING `createCreatorAdmin` directly rather than re-implementing
  creator creation — see "Prospect → creator conversion" below.
- **Constants/templates** (`packages/config/src/creatorOutreachTracker.ts`,
  `creatorOutreachTemplates.ts`) — outreach status enum/labels and the
  two email templates, the same "policy/display constants live in
  packages/config" shape `salesCallTracker.ts`/`creatorProgram.ts`
  already use.
- **Admin pages**: `/admin/creators/outreach` and its sub-routes, gated
  by the same `requireAdminContext()`. Integrated into the EXISTING
  Creators area via a link from `/admin/creators`'s own header — no new
  top-level sidebar nav entry, unlike the Sales Call Tracker (which is
  an unrelated domain and got its own top-level `Sales` entry). The
  existing `/admin/creators` and `/admin/creators/[id]` pages are
  otherwise completely unchanged.

## Schema (migration `0018_creator_outreach.sql`)

Purely additive — two new tables, nothing existing changes shape.

```
creator_prospects: id, display_name, contact_name?, contact_email?,
  normalized_email?, platform, profile_url?, normalized_profile_url?,
  other_profile_urls_json, niche?, followers_approx?, notes, source?,
  status, last_contacted_at?, follow_up_at?, converted_creator_id?,
  created_at, updated_at

creator_outreach_activities: id, prospect_id, status, notes,
  follow_up_at?, created_at
```

No `CHECK` constraints — matching every other migration in this schema;
outreach status values are validated in the application layer
(`isCreatorOutreachStatus`). One real database constraint:
`idx_creator_prospects_converted_creator_id`, a partial unique index on
`converted_creator_id WHERE converted_creator_id IS NOT NULL` — a given
real creator can be the conversion target of at most one prospect, ever.
`converted_creator_id` is a plain `REFERENCES creators(id)`, never the
other direction — a creator prospect is never a `creators` row itself,
and importing/contacting one never activates, grants complimentary
access, or creates any commission/referral relationship (see "Prospect
→ creator conversion" below).

A creator prospect is never a `Business`, either — nothing about this
feature touches `businesses`/`subscriptions`.

## Import format

Preferred columns: Creator Name | Contact Name | Email | Primary
Platform | Profile URL | Other Platforms | Niche | Followers | Source.
Parsed by the shared tabular tokenizer (Markdown table, spreadsheet
tab-paste, or comma-separated; tolerant of a missing/reordered header).
A row needs a creator name AND at least one of a usable (http(s),
successfully normalized) profile URL or a usable (valid-format) email —
"a creator without a publicly verified email is still importable if we
have a usable profile/channel URL," applied symmetrically: an email
alone is equally sufficient. Everything else is optional.
`other_profile_urls` splits a cell on comma/semicolon, so one column can
list several additional platforms. `followers_approx` tolerates a "K"/
"M" suffix (`"42K"` → `42000`).

As with the Sales Call Tracker, the commit action never trusts the
preview's own display — it re-parses and re-classifies the SAME raw
pasted text server-side from scratch before writing anything.

## Duplicate detection

Two PRIMARY signals, either of which alone proves a duplicate: a
normalized (lowercased/trimmed) contact email, and a normalized/
canonical profile URL. Canonicalization lowercases host+path, strips a
leading `www.`, a trailing slash, and a small, explicit, bounded set of
known platform "tab" suffixes (`/videos`, `/featured`, `/about`,
`/shorts`, `/posts`, `/streams`) so the same YouTube channel's `/videos`
and bare channel URL collapse to one canonical form — a documented
string heuristic, never a scraper or a platform API call. Display name
alone is only ever a **possible duplicate** signal, exactly like the
Sales Call Tracker's business-name rule — names vary too much to trust
on their own.

**URL safety is enforced at the SAME point as canonicalization**:
`normalizeProfileUrl`/`isSafeHttpUrl` reject any non-`http(s)` scheme
outright (`javascript:`, `data:`, `vbscript:`, `file:`, etc.). A row
whose profile URL fails this check never has that URL stored at all —
even when the row is still importable because it also has a valid
email. The same gate applies to every entry in `other_profile_urls`.
This matters because a stored `profile_url` is later rendered directly
as a clickable `<a href>` on the prospect workspace page ("View
[Platform] Profile →") — nothing unsafe can ever reach that point.

## Outreach lifecycle

Unlike a phone call, an email exchange has no "in progress" state to
track — there is no equivalent of Start Call/End Call. Recording an
activity (`recordCreatorOutreachActivityAdmin`, the action behind "Save
& Next Creator") is always a single, immediate write: one
`creator_outreach_activities` row (status/notes/follow-up, append-only
history) plus an update to the prospect's own denormalized snapshot
(current `status`, `last_contacted_at`, `follow_up_at`) — both together,
always in sync. A later activity that doesn't set a new follow-up
correctly clears a previously scheduled one, identical reasoning to the
Sales Call Tracker.

Status values: `not_contacted`, `email1_sent`, `awaiting_reply`,
`replied`, `interested`, `not_interested`, `follow_up`, `email2_sent`,
`converted`. One field, not a separate "activity type" vs. "status"
pair — the brief explicitly allowed either shape ("if cleaner
architecture separates activity type from current prospect status, do
that") and a single field was simpler and sufficient here, unlike the
Sales Call Tracker's outcome/connection-status split (which existed to
save a field on a form filled out dozens of times a session; outreach
has no equivalent high-frequency pressure).

## Email template behavior

Both templates (`packages/config/src/creatorOutreachTemplates.ts`) are
stored as plain-text template literals, word-for-word as Kyle wrote
them — never Markdown, so "Copy Email #1/#2" can never put `**`/other
Markdown syntax on the clipboard. TallyVis never sends either email;
"Copy" renders the text client-side and puts it on the clipboard, Kyle
pastes it into his own email client, personalizes it, and sends it by
hand.

Name substitution is deliberately narrow: `firstNameOf()` takes the
first token of a known **contact name** (a real person's name) only —
never a creator's channel/display name, which is not reliably anyone's
first name (e.g. "SteveO The Window Cleaner"). With no contact name on
file, the literal `[Name]`/`[First Name]` placeholder is left in place
so Kyle notices it needs filling in by hand. Every content-specific
placeholder in Email #2 (`[SPECIFIC VIDEO/TOPIC]`, the personal-response
sentences, `[PERSONAL TRANSITION]`, `[EXACT NEXT STEP]`) is always left
intact — only the greeting name is ever auto-filled.

Email #2's content requirement line reads "at least one meaningful
piece of TallyVis content per month" (singular "piece," matching the
real program's language in ADR 0040's V1.1 addendum) — a wording
correction made before implementation, not a later patch.

## Follow-ups

`listCreatorFollowUpsDueAdmin` surfaces a due/overdue follow-up with the
prospect and its most recent activity — identical reasoning to the
Sales Call Tracker: only a prospect's MOST RECENT activity's
`follow_up_at` counts, so a later activity that didn't renew the
follow-up correctly supersedes a stale one. The outreach queue page
excludes any prospect with a due follow-up from its general list (shown
in the dedicated "Creator follow-ups due" section instead, at the top)
and orders everything else due/overdue first, then never-contacted,
then already-contacted-with-nothing-pending — same ordering shape as
the Sales Call Tracker's queue, for the same reason: "advance to the
next appropriate prospect" is satisfied by ordering, never by an
automatic action.

## Prospect → creator conversion

The one safe, explicit link from a creator prospect to a real
`creators` row. `convertProspectToCreatorAdmin` reuses
`services/creators.ts`'s existing `createCreatorAdmin` completely
unchanged — no parallel creator-creation logic was written. The new
creator is created in `createCreatorAdmin`'s own default (`"prospect"`)
status; this function never passes `status: "active"`, never touches
complimentary access, and never links a business. Everything about
activating a Founding Creator, granting complimentary access, or
linking their TallyVis business continues through the existing,
completely unchanged `/admin/creators/[id]` admin workflow — replying
positively to an outreach email implies none of that automatically, per
the brief's own explicit instruction.

**Atomicity**: the whole operation — reading the prospect, calling
`createCreatorAdmin`, and linking the prospect via
`markCreatorProspectConverted`'s conditional `UPDATE ... WHERE
converted_creator_id IS NULL` — runs inside one `db.transaction(...)`.
If the conditional update loses a race (the prospect was converted by a
concurrent request moments earlier), the whole transaction rolls back,
undoing the just-created creator row too — so a lost race can never
leave an orphaned, unlinked creator behind. A test
(`convertProspectToCreatorAdmin > never leaves an orphaned creator
behind...`) proves this using a genuine failure (a slug collision), not
a mock. A prospect already converted is rejected with a clear error
before any creator is created at all — both the service-level check and
the database's own partial unique index guard this, the same
defense-in-depth shape used throughout this codebase.

After conversion, the prospect's own workspace page shows "Converted to
a Founding Creator" with a link to the real creator's admin page, and
is excluded from the outreach queue entirely — there is nothing further
to do with it there.

## Metrics — exact definitions

Every number is derived from `creator_prospects`'s current snapshot
state (plus the same follow-up-due query the queue page uses).

- **Total prospects** — every `creator_prospects` row.
- **Not contacted** — `totalProspects - contacted` (computed in the UI,
  not its own stored/metric field).
- **Contacted** — status is anything other than `not_contacted`.
- **Awaiting reply** — status is `email1_sent`, `awaiting_reply`, or
  `email2_sent` (an email went out and nothing's come back yet).
- **Replied** — status is `replied`, `interested`, `not_interested`,
  `follow_up`, `email2_sent`, or `converted` (anything implying the
  creator actually responded at some point).
- **Interested** / **Not interested** / **Converted** — exact status
  counts.
- **Follow-ups due** — the same forward-looking due/overdue count the
  queue page's dedicated section shows.
- **Outreach → reply rate** — replied ÷ contacted; `0` (never `NaN`)
  when nothing has been contacted yet.
- **Outreach → interested rate** — interested ÷ contacted; same
  zero-safe handling.
- **Outreach → conversion rate** — converted ÷ total prospects; same
  zero-safe handling.

"Converted" means explicitly linked to a real `creators` row — nothing
more. It does not imply that creator is active, has complimentary
access, or has ever referred a paying customer; the metrics page states
this explicitly.

## What this does NOT touch

The existing `/admin/creators`/`/admin/creators/[id]` pages, their
Server Actions, and every function in `services/creators.ts` — all
unchanged. The Founding Creator Program's commission/referral/
attribution rules (ADR 0040 and its V1.1 addendum) — unchanged.
`hasComplimentaryAccess`, activation, business linking — all still only
ever triggered through the existing admin UI, never automatically from
an outreach status.

## Intentionally deferred

Per the brief's own explicit list: automated email sending of any kind
(no Gmail/Resend/any provider integration for outreach — every email is
copied and sent by hand), email open/click tracking, scraping of any
platform, automatic social-follower-count synchronization (followers
are a one-time, manually-entered approximation, never refreshed
automatically), AI-generated personalization, automatic creator
approval (conversion always requires Kyle's own explicit, confirmed
action), automated follow-up emails, creator scoring/ranking of any
kind (approximate follower count is contextual display information
only — never a computed quality score), and general CRM functionality
beyond this specific outreach-to-conversion workflow.

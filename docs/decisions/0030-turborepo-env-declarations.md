# 0030 — Declare every server-side env var `@tallyvis/app` reads in turbo.json

**Status:** Accepted

## Context

After the last production deploy, Vercel's build log showed a Turborepo
warning: 13 environment variables configured on the Vercel project
(`AI_PROVIDER`, `AI_PROVIDER_API_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `EMAIL_PROVIDER`, `RESEND_API_KEY`,
`EMAIL_FROM_ADDRESS`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`,
`STRIPE_PRICE_PRO`, `STRIPE_PRICE_INSTALLATION`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`) were "missing from turbo.json" and "WILL NOT be
available to your application and may cause your build to fail."

`turbo.json`'s own existing comment (written when `DATABASE_URL`/
`DIRECT_URL`/the two `NEXT_PUBLIC_*` vars were added) already explains the
root cause precisely: Turbo 2's default `envMode` is `"strict"` — a task's
spawned process (`next build`) only sees env vars explicitly declared in
that task's `env` array. Locally this is invisible because `next build`/
`next dev` load `apps/app/.env.local` directly off disk themselves,
bypassing Turbo's env handling entirely. On Vercel, there is no
`.env.local` on disk — the real secrets only exist as process environment
variables Vercel injects — so anything not declared here gets silently
stripped before `next build` ever runs. The 13 vars above were added to
Vercel (for the Stripe/email/Google/AI work) without the matching
`turbo.json` declaration ever being added alongside them.

## What was done

Audited every `process.env.*` reference reachable from `@tallyvis/app`'s
build — not just the 13 flagged vars, but everything in `apps/app/src`,
`services/api/src`, and `services/ai/src` (the two packages `apps/app`
imports in-process; `services/api` has no independent `build` step of its
own, so its env needs ride along with whichever app actually builds).
Found 6 more genuinely-consumed vars missing from both Vercel's warning
and `turbo.json`, all from the Phase 15/A2P-10DLC SMS work (ADR
0028/0029): `AI_PROVIDER_MODEL`, `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_FROM_NUMBER`
— not yet set on Vercel (so they didn't trigger a warning), but real vars
the code reads that will need declaring the moment they are.

Deliberately excluded: `AI_DIAGNOSTIC_IMAGE_DIR` (`services/ai/src/index.ts`'s
own comment: "No such variable is ever set in any deployed (Vercel)
environment," hard-blocked whenever `NODE_ENV === "production"` regardless
— a local-only debugging flag, not a real deployment concern), and
`NODE_ENV` (confirmed via `turbo run build --dry=json` that Turbo's strict
mode doesn't strip it — consistent with every build in this repo's history
having worked without it ever being declared).

All 19 additions went into the existing `tasks.build.env` array (and
mirrored into `tasks.dev.env`, which already duplicated the original 4 —
kept in sync rather than left to drift) — not a new `globalEnv` key, since
none of these affect `lint`/`typecheck`/`test`, only `build`/`dev`. No
`"@tallyvis/app#build"`-scoped override was introduced either: the
existing repo convention already puts every app-facing var in the single
shared `build` task (`DATABASE_URL`/`DIRECT_URL` were already there despite
being apps/app-only), and `@tallyvis/web`'s build simply never reads any
of the newly-added names, so sharing the list costs nothing and avoids
introducing a second turbo.json configuration pattern for no functional
benefit.

Every entry is a **name only** — `turbo.json` contains zero secret values,
exactly as it did before. None of the added names carry a `NEXT_PUBLIC_`
prefix, so none of them can ever be inlined into client-side JavaScript by
Next.js regardless of this file — that inlining behavior is controlled
entirely by the `NEXT_PUBLIC_` naming convention itself, not by anything
in `turbo.json`. Declaring a var here only controls whether the `next
build` child process's OS environment includes it; it has no bearing on
whether client code can read it.

## Verification

Confirmed via `turbo run build --dry=json --filter=@tallyvis/app` that all
23 vars (4 original + 19 added) now appear in that task's
`environmentVariables.specified.env`, and that `turbo.json` still parses
and plans successfully (dry-run exit code 0). Full `pnpm typecheck`/`lint`/
`test`/`build` all pass unchanged. Caching behavior is preserved —
`pnpm build` immediately after still hits Turbo's cache ("FULL TURBO");
the only change to any task's cache key is the expected one (env var
*names* changed, so the hash changed once, same as any other `turbo.json`
edit).

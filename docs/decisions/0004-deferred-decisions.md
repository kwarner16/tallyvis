# 0004 — Deliberately deferred decisions

**Status:** Accepted (Phase 1) — this is a log of open decisions, not a plan to solve them now.

Recording these explicitly so they're revisited at the right phase instead
of being decided implicitly by whatever's easiest at the time.

| Decision                 | Deferred to                                              | Leading candidate (not chosen yet)                                           |
| ------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Database engine          | Phase 10 (services/api build-out starts Phase 4)         | Postgres + Drizzle or Prisma                                                 |
| Auth provider            | Phase 11                                                 | Not yet evaluated                                                            |
| Payments                 | Phase 11                                                 | Stripe (matches the tiered SaaS pricing model)                               |
| CI/CD                    | When a second contributor or a real deploy target exists | GitHub Actions                                                               |
| Hosting/deployment       | Phase 2 (marketing site needs to go live)                | Vercel                                                                       |
| Real AI/CV provider      | Phase 8                                                  | Not yet evaluated — `services/ai`'s interface is provider-agnostic by design |
| Repo visibility, license | Founder decision, not engineering                        | N/A                                                                          |

None of these block Phase 1. Each should get its own numbered ADR when it's
actually decided.

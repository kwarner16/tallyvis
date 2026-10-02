/**
 * Auth-related types local to `services/api` — distinct from
 * `packages/types`, which holds the AI/pricing/quote domain contract
 * shared with the browser. `AuthUser` is what's safe to hand back to a
 * caller (no password hash); the full row with its hash never leaves
 * `repositories/users.ts`.
 */
export interface AuthUser {
  id: string;
  email: string;
  businessId: string;
  createdAt: string;
  /** Internal TallyVis staff flag (see docs/decisions/0035-admin-dashboard.md) — never set by any customer-facing signup/account flow, only by the out-of-band `grantAdmin` script. False for every real customer account. */
  isAdmin: boolean;
}

/**
 * Founder-only operational script: waives the $299 professional
 * installation fee for one named business — the "founding customer"
 * incentive from docs/decisions/0018-stripe-v1-hardening.md. Deliberately
 * NOT a coupon/promotion system and NOT a dashboard feature: there is no
 * admin UI in this app (a business only ever manages its own account), so
 * this is a one-off script a founder runs directly against the database,
 * the same way `seed.ts` is. The public price in `@tallyvis/config` is
 * never touched — this only ever changes ONE business's own
 * `billing_charges` row.
 *
 * Usage: `pnpm --filter @tallyvis/api waive-installation <owner-email>`
 *
 * If the business hasn't reached the installation choice yet, this
 * creates the charge at its full, real price and immediately marks it
 * waived — so the record accurately reflects what was waived, for your
 * own bookkeeping, rather than looking like the fee never existed. If the
 * business already has a charge on file (pending, e.g. from an abandoned
 * checkout attempt), that row is marked waived in place. Refuses if the
 * charge has already been paid — a real payment is never silently
 * overwritten by this script.
 */
import { PROFESSIONAL_INSTALLATION_FEE } from "@tallyvis/config";
import { getDb } from "./client";
import { getUserWithPasswordHashByEmail } from "../repositories/users";
import {
  createBillingCharge,
  getBillingChargeByKind,
  markBillingChargeStatus,
} from "../repositories/billingCharges";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: pnpm --filter @tallyvis/api waive-installation <owner-email>");
    process.exit(1);
  }

  const db = getDb();
  const found = getUserWithPasswordHashByEmail(db, email);
  if (!found) {
    console.error(`No account found for ${email}.`);
    process.exit(1);
  }
  const businessId = found.user.businessId;

  const existing = getBillingChargeByKind(db, businessId, PROFESSIONAL_INSTALLATION_FEE.kind);
  if (existing?.status === "paid") {
    console.error(`${email}'s installation fee has already been paid — refusing to overwrite a real payment.`);
    process.exit(1);
  }

  const charge =
    existing ??
    createBillingCharge(db, businessId, {
      kind: PROFESSIONAL_INSTALLATION_FEE.kind,
      amountCents: PROFESSIONAL_INSTALLATION_FEE.amountCents,
      currency: PROFESSIONAL_INSTALLATION_FEE.currency,
    });

  markBillingChargeStatus(db, charge.id, "waived");
  console.log(`Waived the professional installation fee for ${email} (business ${businessId}).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

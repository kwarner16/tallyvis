// Public surface of services/api. Only this file should be imported from
// apps/app — never a path into db/, repositories/, or auth/ directly. Those
// stay internal so the "everything is scoped by an AuthSession, derived
// from a validated cookie, never from client input" rule can't be
// accidentally bypassed by reaching past the service layer.

export { getDb } from "./db/client";
export { SESSION_COOKIE_NAME, type AuthSession } from "./auth/session";
export type { AuthUser } from "./types";

export {
  signUp,
  logIn,
  logOut,
  resolveSession,
  type SignUpInput,
  type LogInInput,
  type AuthResult,
} from "./services/auth";

export {
  getCurrentBusiness,
  updateCurrentBusiness,
  getDefaultPublicBusiness,
  resolveEmbedBusiness,
  type UpdateBusinessInput,
} from "./services/business";

export {
  listCustomers,
  getCustomer,
  findOrCreateCustomer,
  updateCustomer,
} from "./services/customers";

export {
  getActiveConfiguration,
  getActiveConfigurationForBusiness,
  getConfigurationById,
  saveNewPricingConfigurationVersion,
} from "./services/pricing";

export {
  listQuotes,
  getQuote,
  createQuote,
  createQuotePublic,
  updateQuoteAnalysis,
  recalculateQuoteEstimate,
  updateQuoteCustomer,
  updateQuoteStatus,
  getQuoteAiObservation,
  type CreateQuoteInput,
} from "./services/quotes";

export {
  recordJobOutcome,
  getJobOutcome,
  getQuoteObservationComparison,
  listQuotesWithOutcomes,
  type JobOutcome,
  type JobOutcomeStatus,
  type SaveJobOutcomeInput,
  type QuoteWithOutcomeSummary,
  type ObservationComparisonRow,
} from "./services/jobOutcomes";

export {
  getShareLinkStatus,
  generateShareLink,
  revokeShareLink,
  getQuoteByShareToken,
  acceptQuoteByToken,
  declineQuoteByToken,
  requestQuoteChangesByToken,
  type ShareLinkStatus,
  type ShareLinkResult,
  type PublicQuoteView,
  type PublicBusinessSummary,
} from "./services/quoteSharing";

// AI-related types re-exported from @tallyvis/ai so apps/app depends on this
// package for anything AI-related, never on @tallyvis/ai directly — see
// docs/decisions/0013-ai-analysis-foundation.md.
export type { RawPropertyObservation, ObservedValue } from "@tallyvis/ai";

export {
  analyzePropertyForBusiness,
  analyzePropertyPublic,
  AiProviderError,
  type AnalyzePropertyInput,
  type AnalyzePropertyResult,
  type AiErrorCategory,
} from "./services/aiAnalysis";

// Phase 14 — account recovery, notifications, billing/subscriptions, and
// website-embed foundation. See
// docs/decisions/0016-onboarding-billing-embed.md.

export { requestPasswordReset, resetPassword } from "./services/passwordReset";

export { NotificationError, isUsingDevEmailProvider, type NotificationErrorCategory } from "./notifications";

export { sendQuoteEmail, type QuoteEmailResult } from "./services/quoteEmail";

export {
  getSubscription,
  resolveEffectiveStatus,
  hasProductAccess,
  startTrial,
  listBillingCharges,
  billingConfigured,
  createCheckoutSessionForPlan,
  type Subscription,
  type SubscriptionStatus,
  type BillingCharge,
} from "./services/subscriptions";

export { BillingProviderError, type BillingErrorCategory } from "./billing";

export { handleStripeWebhook, WebhookVerificationError } from "./services/billingWebhooks";
export { isWebhookConfigured } from "./billing";

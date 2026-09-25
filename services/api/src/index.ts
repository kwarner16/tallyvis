// Public surface of services/api. Only this file should be imported from
// apps/app — never a path into db/, repositories/, or auth/ directly. Those
// stay internal so the "everything is scoped by an AuthSession, derived
// from a validated cookie, never from client input" rule can't be
// accidentally bypassed by reaching past the service layer.

export { getDb, type Queryable } from "./db/pg/client";
export { SESSION_COOKIE_NAME, type AuthSession } from "./auth/session";
export type { AuthUser } from "./types";

export {
  signUp,
  logIn,
  logOut,
  resolveSession,
  getCurrentUser,
  type SignUpInput,
  type LogInInput,
  type AuthResult,
  type CurrentUserInfo,
} from "./services/auth";

export {
  getCurrentBusiness,
  updateCurrentBusiness,
  getDefaultPublicBusiness,
  resolveEmbedBusiness,
  resolvePublicBusinessSummary,
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

// Final validation & launch-readiness phase (2026-09) — internal estimator
// benchmark harness (/dashboard/testing). See services/benchmarkCases.ts.
export {
  saveBenchmarkCase,
  listBenchmarkCases,
  deleteBenchmarkCase,
  computeBenchmarkMetrics,
  type BenchmarkCondition,
  type BenchmarkCase,
  type BenchmarkGroundTruth,
  type BenchmarkAiSummary,
  type BenchmarkConfirmedResult,
  type SaveBenchmarkCaseInput,
  type BenchmarkMetrics,
  type BenchmarkConditionBreakdown,
  type EvidenceTierBreakdown,
  type FollowUpPhotoStats,
} from "./services/benchmarkCases";

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
export type {
  RawPropertyObservation,
  ObservedValue,
  EvidenceAssessment,
  EvidenceCoverage,
  EvidenceIssue,
  OverallEvidence,
} from "@tallyvis/ai";
export { describeEvidenceGaps } from "@tallyvis/ai";

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
  createInstallationCheckoutSession,
  chooseSelfInstall,
  createBillingPortalSession,
  type Subscription,
  type SubscriptionStatus,
  type BillingCharge,
} from "./services/subscriptions";

export { BillingProviderError, type BillingErrorCategory } from "./billing";

export { handleStripeWebhook, WebhookVerificationError } from "./services/billingWebhooks";
export { isWebhookConfigured } from "./billing";

export { deleteAccount, AccountDeletionError } from "./services/accountDeletion";

export {
  generateRandomToken,
  generatePkcePair,
  buildGoogleAuthorizationUrl,
  exchangeCodeForIdToken,
  verifyGoogleIdToken,
  GoogleAuthError,
  type PkcePair,
  type VerifiedGoogleIdentity,
} from "./auth/googleOAuth";

export { signInWithGoogle, GoogleSignInError, type GoogleAuthOutcome } from "./services/googleAuth";

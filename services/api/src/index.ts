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
  setPassword,
  isAdminSession,
  type SignUpInput,
  type LogInInput,
  type AuthResult,
  type CurrentUserInfo,
} from "./services/auth";

export {
  getCurrentBusiness,
  updateCurrentBusiness,
  updateSmsNotificationSettings,
  completeOnboarding,
  getDefaultPublicBusiness,
  resolveEmbedBusiness,
  resolvePublicBusinessSummary,
  type UpdateBusinessInput,
  type UpdateSmsNotificationSettingsInput,
  type CompleteOnboardingInput,
} from "./services/business";

export {
  listCustomers,
  getCustomer,
  findOrCreateCustomer,
  updateCustomer,
  isCustomerSmsEligible,
} from "./services/customers";

// V1 customer-facing SMS messaging program (see customerSms.ts for the full
// design note, and docs/decisions/0031-customer-sms-v1-messaging-program.md/
// 0032-sms-stop-start-sync.md for what's actually active). Wired triggers:
// `sendOptInConfirmationSms` to `createQuotePublic` below,
// `sendEstimateReadySms` to `updateQuoteStatus`'s transition into
// "approved" (NOT to quote creation — see that function's own comment),
// and `sendPostServiceThankYouSms` to `recordJobOutcome`'s transition into
// "completed". All three are re-exported mainly so tests can exercise them
// directly. `sendAppointmentConfirmationSms`/`sendAppointmentReminderSms`/
// `sendOnTheWaySms` have NO wired trigger (no appointment/scheduling data
// model, no background-job infrastructure, no "on the way" job-status
// action exist in this codebase) and are NOT part of the active V1
// campaign — exported only so a future feature that adds one of those
// doesn't have to rebuild the consent/eligibility-gated sender from
// scratch.
export {
  sendOptInConfirmationSms,
  sendEstimateReadySms,
  sendAppointmentConfirmationSms,
  sendAppointmentReminderSms,
  sendOnTheWaySms,
  sendPostServiceThankYouSms,
  type AppointmentSmsDetails,
} from "./services/customerSms";

export { handleTwilioSmsWebhook, TwilioWebhookVerificationError, type SmsOptEventResult } from "./services/smsWebhooks";

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
  updateQuotePublic,
  updateQuoteAnalysis,
  recalculateQuoteEstimate,
  updateQuoteCustomer,
  updateQuoteStatus,
  getQuoteAiObservation,
  type CreateQuoteInput,
} from "./services/quotes";

export { getQuotePhoto, type PendingQuotePhoto } from "./services/quotePhotos";
export { type StoredPhoto } from "./storage";

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
export { isUsingDevSmsProvider } from "./notifications/sms";

export { sendQuoteEmail, type QuoteEmailResult } from "./services/quoteEmail";

export {
  getSubscription,
  getSubscriptionReconciled,
  resolveEffectiveStatus,
  hasProductAccess,
  isTrialEligible,
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

// Internal TallyVis CEO/Admin dashboard (see
// docs/decisions/0035-admin-dashboard.md). Every function below
// independently re-verifies the caller's session is an admin
// (`isAdminSession`) before returning any cross-tenant data — see
// services/admin.ts's own header comment.
export {
  getAdminOverview,
  listBusinessesAdmin,
  getBusinessDetailAdmin,
  listSubscriptionsAdmin,
  listRecentActivityAdmin,
  calculateMrrBreakdown,
  isSubscriptionPastDue,
  type AdminOverview,
  type AdminSubscriptionStatusCounts,
  type AdminBusinessListResult,
  type ListBusinessesAdminInput,
  type AdminBusinessDetail,
  type AdminSubscriptionRow,
  type MrrBreakdown,
} from "./services/admin";
export type {
  AdminBusinessCounts,
  AdminQuoteCounts,
  AdminBusinessListRow,
  AdminBusinessSortBy,
  AdminSortDirection,
  AdminRecentEventRow,
} from "./repositories/admin";

// Business feedback / bug-report channel (production hardening — see
// docs/decisions/0039-embed-logo-signup-notifications-and-feedback.md).
export {
  submitFeedback,
  listFeedbackAdmin,
  type Feedback,
  type FeedbackType,
  type SubmitFeedbackInput,
} from "./services/feedback";

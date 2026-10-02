"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  getDb,
  logIn,
  logOut,
  requestPasswordReset,
  resetPassword,
  signUp,
  SESSION_COOKIE_NAME,
} from "@tallyvis/api";
import { isPlanId } from "@tallyvis/config";
import { APP_URL } from "./urls";
import { INTENDED_PLAN_COOKIE_NAME } from "./constants";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // matches services/api's session TTL

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export interface AuthActionState {
  error?: string;
}

export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  try {
    const { token } = await signUp(getDb(), {
      businessName: String(formData.get("businessName") ?? ""),
      ownerEmail: String(formData.get("ownerEmail") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    await setSessionCookie(token);

    const plan = String(formData.get("plan") ?? "");
    if (isPlanId(plan)) {
      const store = await cookies();
      store.set(INTENDED_PLAN_COOKIE_NAME, plan, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60, // just long enough to reach the onboarding prompt this same session
      });
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create your account." };
  }
  redirect("/dashboard");
}

/**
 * Only ever honors a same-origin, dashboard- or admin-relative path —
 * never an absolute URL or protocol-relative one (`//evil.example`) — so a
 * `?redirect=` query param on the public `/login` page can never be turned
 * into an open redirect. Anything that doesn't match is silently ignored in
 * favor of the generic dashboard home. `/admin` is allowed here purely so
 * an admin deep link (e.g. `/admin/businesses/<id>`) survives an
 * intervening sign-in the same way a dashboard deep link already does —
 * this does NOT grant admin access: a non-admin session redirected here
 * still gets bounced to `/dashboard` by `requireAdminContext()`
 * the moment that page actually runs. See
 * docs/decisions/0035-admin-dashboard.md.
 */
function sanitizeDashboardRedirect(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string" || value.startsWith("//")) {
    return undefined;
  }
  if (!value.startsWith("/dashboard") && !value.startsWith("/admin")) {
    return undefined;
  }
  return value;
}

export async function logInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const redirectTo = sanitizeDashboardRedirect(formData.get("redirect"));
  try {
    const { token } = await logIn(getDb(), {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    await setSessionCookie(token);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not log in." };
  }
  redirect(redirectTo ?? "/dashboard");
}

export async function logOutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  await logOut(getDb(), token);
  store.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}

/**
 * Phase 14 — password recovery (see
 * docs/decisions/0016-onboarding-billing-embed.md). Always resolves the
 * same way regardless of whether the email belongs to a real account —
 * `requestPasswordReset` itself never reveals that, and this action must
 * not either. The success state shown to the user is generic on purpose.
 */
export async function requestPasswordResetAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState & { submitted?: boolean }> {
  const email = String(formData.get("email") ?? "");
  const { finished } = await requestPasswordReset(getDb(), email, (token) => `${APP_URL}/reset-password?token=${token}`);
  // Keeps the function alive long enough for the email send to actually
  // complete without making the browser wait for it — see
  // requestPasswordReset's own comment for the production bug this fixes
  // (Vercel can freeze the process right after the response is sent,
  // which silently drops a truly fire-and-forget promise).
  after(() => finished);
  return { submitted: true };
}

export async function resetPasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password !== confirmPassword) {
    return { error: "Passwords don't match." };
  }

  try {
    await resetPassword(getDb(), token, password);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not reset your password." };
  }
  redirect("/login?reset=success");
}

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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

async function setSessionCookie(token: string): Promise<void> {
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

export async function logInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  try {
    const { token } = await logIn(getDb(), {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    await setSessionCookie(token);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not log in." };
  }
  redirect("/dashboard");
}

export async function logOutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  logOut(getDb(), token);
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
  await requestPasswordReset(getDb(), email, (token) => `${APP_URL}/reset-password?token=${token}`);
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

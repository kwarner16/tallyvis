"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, logIn, logOut, signUp, SESSION_COOKIE_NAME } from "@tallyvis/api";

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

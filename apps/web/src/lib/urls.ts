export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
export const ESTIMATOR_URL = `${APP_URL}/estimate`;
/** Business owner sign-in — apps/app's authenticated dashboard, not the customer estimator above. */
export const LOGIN_URL = `${APP_URL}/login`;
export const SIGNUP_URL = `${APP_URL}/signup`;

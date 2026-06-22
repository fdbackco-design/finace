import { createHmac, timingSafeEqual } from 'crypto';

export const AUTH_COOKIE = 'finance_auth';
const SESSION_VERSION    = 'v1';
const MAX_AGE_SEC        = 60 * 60 * 24 * 7; // 7일

function adminUsername(): string {
  return (process.env.ADMIN_USERNAME ?? '').trim();
}

function adminPassword(): string {
  return (process.env.ADMIN_PASSWORD ?? '').trim();
}

function sessionSecret(): string {
  return `${adminUsername()}:${adminPassword()}`;
}

export function createSessionToken(): string {
  return createHmac('sha256', sessionSecret())
    .update(`finance-session-${SESSION_VERSION}`)
    .digest('hex');
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token || !adminUsername() || !adminPassword()) return false;
  const expected = createSessionToken();
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyCredentials(username: string, password: string): boolean {
  const expectedUser = adminUsername();
  const expectedPass = adminPassword();
  if (!expectedUser || !expectedPass) return false;
  return safeEqual(username.trim(), expectedUser) && safeEqual(password.trim(), expectedPass);
}

/** env-check 등 진단용 — 실제 값은 노출하지 않음 */
export function getAdminAuthEnvStatus() {
  const username = adminUsername();
  const password = adminPassword();
  return {
    hasUsername: Boolean(username),
    hasPassword: Boolean(password),
    usernameLength: username.length,
    passwordLength: password.length,
  };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function authCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path:     '/',
    maxAge:   MAX_AGE_SEC,
  };
}

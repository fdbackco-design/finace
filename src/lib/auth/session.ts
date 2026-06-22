import { createHmac, timingSafeEqual } from 'crypto';

export const AUTH_COOKIE = 'finance_auth';
const SESSION_VERSION    = 'v1';
const MAX_AGE_SEC        = 60 * 60 * 24 * 7; // 7일

function sessionSecret(): string {
  const user = process.env.ADMIN_USERNAME ?? '';
  const pass = process.env.ADMIN_PASSWORD ?? '';
  return `${user}:${pass}`;
}

export function createSessionToken(): string {
  return createHmac('sha256', sessionSecret())
    .update(`finance-session-${SESSION_VERSION}`)
    .digest('hex');
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) return false;
  const expected = createSessionToken();
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyCredentials(username: string, password: string): boolean {
  const expectedUser = process.env.ADMIN_USERNAME ?? '';
  const expectedPass = process.env.ADMIN_PASSWORD ?? '';
  if (!expectedUser || !expectedPass) return false;
  return safeEqual(username, expectedPass) && safeEqual(password, expectedPass);
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

import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_COOKIE,
  authCookieOptions,
  createSessionToken,
  verifyCredentials,
} from '@/src/lib/auth/session';

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const username = (body.username ?? '').trim();
  const password = (body.password ?? '').trim();

  if (!process.env.ADMIN_USERNAME?.trim() || !process.env.ADMIN_PASSWORD?.trim()) {
    return NextResponse.json(
      { ok: false, error: '서버 인증 설정이 없습니다. ADMIN_USERNAME / ADMIN_PASSWORD를 등록하세요.' },
      { status: 503 },
    );
  }

  if (!verifyCredentials(username, password)) {
    return NextResponse.json({ ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  const secure = req.nextUrl.protocol === 'https:';
  res.cookies.set(AUTH_COOKIE, createSessionToken(), authCookieOptions(secure));
  return res;
}

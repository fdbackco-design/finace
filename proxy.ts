import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifySessionToken } from '@/src/lib/auth/session';

/**
 * 인증 프록시 — 쿠키 세션 기반
 *
 * 보호 대상 경로 접근 시 미인증이면 /login 으로 리다이렉트
 * (브라우저 Basic Auth 다이얼로그 대신 커스텀 로그인 페이지 사용)
 *
 * 환경변수:
 *   ADMIN_USERNAME — 관리자 아이디
 *   ADMIN_PASSWORD — 관리자 비밀번호
 */

const PROTECTED_PATHS = [
  '/upload',
  '/cashflow',
  '/dashboard',
  '/unmatched',
  '/transactions',
  '/vendors',
  '/api/upload',
  '/api/db-check',
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 로그인 페이지: 이미 인증됐으면 홈으로
  if (pathname === '/login') {
    const token = req.cookies.get(AUTH_COOKIE)?.value;
    if (verifySessionToken(token)) {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  }

  if (!isProtected(pathname)) {
    return NextResponse.next();
  }

  if (!process.env.ADMIN_USERNAME?.trim() || !process.env.ADMIN_PASSWORD?.trim()) {
    return new NextResponse(
      '서버 설정 오류: ADMIN_USERNAME / ADMIN_PASSWORD 환경변수를 등록해 주세요.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (verifySessionToken(token)) {
    return NextResponse.next();
  }

  // API 요청은 JSON 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: '인증이 필요합니다.' }, { status: 401 });
  }

  // 페이지 요청 → 로그인으로 리다이렉트
  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('next', pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/login',
    '/upload/:path*',
    '/cashflow/:path*',
    '/dashboard/:path*',
    '/unmatched/:path*',
    '/transactions/:path*',
    '/vendors/:path*',
    '/api/upload/:path*',
    '/api/db-check/:path*',
  ],
};

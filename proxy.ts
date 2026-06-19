import { NextRequest, NextResponse } from 'next/server';

/**
 * Basic Auth 미들웨어
 *
 * 보호 대상 경로:
 *   /upload, /cashflow, /dashboard, /unmatched, /transactions
 *   /api/db-check
 *
 * 필요 환경변수 (Vercel Environment Variables에 등록):
 *   ADMIN_USERNAME — 관리자 아이디
 *   ADMIN_PASSWORD — 관리자 비밀번호
 *
 * 두 변수 중 하나라도 없으면 해당 경로는 503(서비스 불가)으로 차단.
 *
 * TODO (운영 강화 시):
 *   - Supabase Auth / NextAuth 로그인 세션으로 교체
 *   - IP 화이트리스트 (Vercel Edge Config 활용)
 *   - Rate limiting (Upstash Redis 등)
 */

const PROTECTED_PATHS = [
  '/upload',
  '/cashflow',
  '/dashboard',
  '/unmatched',
  '/transactions',
  '/api/db-check',
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export function proxy(req: NextRequest) {
  if (!isProtected(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  // 환경변수 미설정 시 서비스 불가
  if (!username || !password) {
    return new NextResponse(
      '서버 설정 오류: ADMIN_USERNAME / ADMIN_PASSWORD 환경변수를 등록해 주세요.',
      {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      },
    );
  }

  const authHeader = req.headers.get('authorization') ?? '';

  if (authHeader.startsWith('Basic ')) {
    const encoded = authHeader.slice(6);
    let decoded: string;
    try {
      decoded = atob(encoded);
    } catch {
      decoded = '';
    }

    const colonIdx    = decoded.indexOf(':');
    const inputUser   = colonIdx >= 0 ? decoded.slice(0, colonIdx)      : decoded;
    const inputPass   = colonIdx >= 0 ? decoded.slice(colonIdx + 1)     : '';

    // 타이밍 공격 방지: 두 문자열을 항상 동일 길이 비교
    if (safeEqual(inputUser, username) && safeEqual(inputPass, password)) {
      return NextResponse.next();
    }
  }

  // 인증 실패 → 브라우저 Basic Auth 다이얼로그 표시
  return new NextResponse('인증이 필요합니다', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Finance Dashboard", charset="UTF-8"',
      'Content-Type':     'text/plain; charset=utf-8',
    },
  });
}

/** 길이 차이를 숨기는 상수 시간 문자열 비교 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const config = {
  matcher: [
    '/upload/:path*',
    '/cashflow/:path*',
    '/dashboard/:path*',
    '/unmatched/:path*',
    '/transactions/:path*',
    '/api/db-check/:path*',
  ],
};

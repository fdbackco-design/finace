import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// 환경변수 존재 여부만 반환 — 실제 값은 절대 출력하지 않음
// TODO: 운영 안정화 후 이 route 제거 또는 관리자 토큰으로 보호
export async function GET() {
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return NextResponse.json({
    NEXT_PUBLIC_SUPABASE_URL:      !!url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!anon,
    SUPABASE_SERVICE_ROLE_KEY:     !!service,
    // URL prefix만 힌트로 표시 (값 노출 없이 설정 확인용)
    url_prefix: url ? url.slice(0, 30) + '...' : null,
    all_ok: !!(url && anon && service),
  });
}

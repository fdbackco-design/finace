import { NextResponse } from 'next/server';
import { getAdminAuthEnvStatus } from '@/src/lib/auth/session';
import { getSupabaseEnvStatus } from '@/src/lib/env';

export const dynamic = 'force-dynamic';

// 환경변수 존재 여부만 반환 — 실제 값은 절대 출력하지 않음
// TODO: 운영 안정화 후 관리자 토큰으로 보호 또는 제거
export async function GET() {
  const env = getSupabaseEnvStatus();
  const auth = getAdminAuthEnvStatus();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  return NextResponse.json({
    NEXT_PUBLIC_SUPABASE_URL:      env.hasUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.hasAnonKey,
    SUPABASE_SERVICE_ROLE_KEY:     env.hasServiceRoleKey,
    ADMIN_USERNAME_SET:            auth.hasUsername,
    ADMIN_PASSWORD_SET:            auth.hasPassword,
    admin_username_length:         auth.usernameLength,
    admin_password_length:         auth.passwordLength,
    url_prefix: url ? url.slice(0, 30) + '...' : null,
    all_ok: env.allOk && auth.hasUsername && auth.hasPassword,
  });
}

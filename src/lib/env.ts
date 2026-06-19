// 서버/API route 전용 — 환경변수 존재 여부 체크
// 실제 값은 절대 반환하지 않음
export function getSupabaseEnvStatus() {
  return {
    hasUrl:            Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasAnonKey:        Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    allOk:
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
      Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
}

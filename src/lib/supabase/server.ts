import { createClient } from '@supabase/supabase-js';

// 서버 전용 클라이언트 (service_role key 사용 — RLS 우회)
// 브라우저에서 절대 사용 금지
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      '[Supabase] 환경변수 누락:',
      !url ? 'NEXT_PUBLIC_SUPABASE_URL' : '',
      !key ? 'SUPABASE_SERVICE_ROLE_KEY' : '',
      '— Vercel Dashboard에서 등록 후 Redeploy 필요'
    );
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

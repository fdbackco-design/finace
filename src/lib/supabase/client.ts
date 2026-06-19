import { createClient } from '@supabase/supabase-js';

// 브라우저 클라이언트 (anon key 사용 — RLS 적용)
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}


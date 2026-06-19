import { createClient } from '@supabase/supabase-js';
import { getSupabaseEnvStatus } from '@/src/lib/env';

// 서버 전용 클라이언트 (service_role key — RLS 우회)
// 브라우저 컴포넌트에서 절대 import 금지
export function createServerClient() {
  const env = getSupabaseEnvStatus();

  if (!env.hasUrl || !env.hasServiceRoleKey) {
    console.error(
      '[Supabase server] 환경변수 누락 →',
      !env.hasUrl            ? 'NEXT_PUBLIC_SUPABASE_URL ' : '',
      !env.hasServiceRoleKey ? 'SUPABASE_SERVICE_ROLE_KEY' : '',
    );
    return null;
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// ── 타입: 데이터 패치 결과 discriminated union ──────────────────────────────
export type FetchResult<T> =
  | { status: 'env_missing' }
  | { status: 'db_error'; message: string; code?: string }
  | { status: 'table_missing' }
  | { status: 'ok'; data: T[] };

export async function fetchTable<T>(
  table: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: (client: any) => any,
): Promise<FetchResult<T>> {
  const client = createServerClient();
  if (!client) return { status: 'env_missing' };

  const { data, error } = await builder(client);

  if (error) {
    console.error(`[Supabase] ${table} 조회 에러:`, error.code, error.message);

    // 테이블 미존재 (PostgreSQL: 42P01, Supabase: PGRST200 / undefined_table)
    if (
      error.code === '42P01' ||
      error.code === 'PGRST200' ||
      (error.message ?? '').toLowerCase().includes('does not exist') ||
      (error.message ?? '').toLowerCase().includes('undefined_table')
    ) {
      return { status: 'table_missing' };
    }

    return { status: 'db_error', message: error.message, code: error.code };
  }

  return { status: 'ok', data: (data ?? []) as T[] };
}

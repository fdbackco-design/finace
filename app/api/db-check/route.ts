import { NextResponse } from 'next/server';
import { getSupabaseEnvStatus } from '@/src/lib/env';
import { createServerClient } from '@/src/lib/supabase/server';

export const dynamic = 'force-dynamic';

// DB 연결 및 테이블 건수 확인 — 실제 key 값 출력 절대 금지
// TODO: 운영 안정화 후 관리자 토큰으로 보호 또는 제거
const TABLES = [
  'companies',
  'cashflow_entries',
  'bank_transactions',
  'card_transactions',
  'hometax_invoices',
] as const;

async function countTable(client: any, table: string): Promise<number | string> {
  const { count, error } = await client
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) return `error: ${error.message}`;
  return count ?? 0;
}

export async function GET() {
  const env = getSupabaseEnvStatus();

  if (!env.allOk) {
    return NextResponse.json({
      env: { all_ok: false, hasUrl: env.hasUrl, hasAnonKey: env.hasAnonKey, hasServiceRoleKey: env.hasServiceRoleKey },
      tables: null,
      errors: ['환경변수 누락 — /api/env-check 확인'],
    });
  }

  const client = createServerClient();
  if (!client) {
    return NextResponse.json({
      env: { all_ok: true },
      tables: null,
      errors: ['Supabase 클라이언트 생성 실패'],
    });
  }

  const tables: Record<string, number | string> = {};
  const errors: string[] = [];

  for (const tbl of TABLES) {
    const result = await countTable(client, tbl);
    tables[tbl] = result;
    if (typeof result === 'string' && result.startsWith('error:')) {
      errors.push(`[${tbl}] ${result}`);
    }
  }

  return NextResponse.json({
    env:    { all_ok: env.allOk },
    tables,
    errors,
  });
}

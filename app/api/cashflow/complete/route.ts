/**
 * POST /api/cashflow/complete
 * 선택한 cashflow_entries를 매칭 완료 처리
 * Body: { entryIds: string[], completedBy?: string, method?: 'MANUAL'|'AUTO' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/src/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const entryIds: string[] = body?.entryIds ?? [];
  const completedBy = body?.completedBy ?? 'user';
  const method: 'MANUAL' | 'AUTO' = body?.method === 'AUTO' ? 'AUTO' : 'MANUAL';

  if (!entryIds.length) return NextResponse.json({ error: 'entryIds 필수' }, { status: 400 });

  const client = createServerClient();
  if (!client) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 });

  const now = new Date().toISOString();

  const { error: updateErr } = await (client as any)
    .from('cashflow_entries')
    .update({
      is_completed:     true,
      completed_at:     now,
      completed_by:     completedBy,
      completed_method: method,
      match_status:     'USER_CONFIRMED',
    })
    .in('id', entryIds);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // 이력 기록
  const histories = entryIds.map(entryId => ({
    cashflow_entry_id: entryId,
    action:     'COMPLETE',
    data_after: { is_completed: true, completed_by: completedBy, method },
    changed_by: completedBy,
  }));
  await (client as any).from('cashflow_entry_history').insert(histories);

  return NextResponse.json({ ok: true, processedCount: entryIds.length });
}

/**
 * PATCH /api/cashflow/[id]/restore
 * 매칭 완료 내역을 미완료(활성)로 복원
 * 기존 그룹, 수동 수정 거래처명, 구분값, 매칭 근거, 이력 모두 유지
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/src/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const restoredBy = body?.restoredBy ?? 'user';

  const client = createServerClient();
  if (!client) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 });

  const { data: current, error: fetchErr } = await (client as any)
    .from('cashflow_entries')
    .select('id, is_completed, completed_at, completed_by, completed_method, match_status, category_manual, vendor_name_override, group_id')
    .eq('id', id)
    .single();

  if (fetchErr || !current) return NextResponse.json({ error: '항목 없음' }, { status: 404 });
  if (!current.is_completed) return NextResponse.json({ message: '이미 미완료 상태' });

  const { error: updateErr } = await (client as any)
    .from('cashflow_entries')
    .update({
      is_completed:     false,
      completed_at:     null,
      completed_by:     null,
      completed_method: null,
      // match_status는 USER_CONFIRMED 유지 (사용자 확인된 항목이므로)
    })
    .eq('id', id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await (client as any).from('cashflow_entry_history').insert({
    cashflow_entry_id: id,
    action:      'RESTORE',
    data_before: { is_completed: true, completed_by: current.completed_by },
    data_after:  { is_completed: false },
    changed_by:  restoredBy,
  });

  return NextResponse.json({ ok: true });
}

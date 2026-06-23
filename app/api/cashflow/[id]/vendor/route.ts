/**
 * PATCH /api/cashflow/[id]/vendor
 * 거래처명 수정 (수정 이력 저장, 원본 보존)
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
  const newName    = body?.vendor_name?.trim();
  const changedBy  = body?.changed_by  ?? 'user';
  const changeReason = body?.reason    ?? null;
  const changePath   = body?.path      ?? 'ui_inline_edit';

  if (!newName) return NextResponse.json({ error: 'vendor_name 필수' }, { status: 400 });

  const client = createServerClient();
  if (!client) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 });

  // 현재 거래처명 조회 (원본 보존)
  const { data: current, error: fetchErr } = await (client as any)
    .from('cashflow_entries')
    .select('id, vendor_name, vendor_name_override')
    .eq('id', id)
    .single();

  if (fetchErr || !current) return NextResponse.json({ error: '항목 없음' }, { status: 404 });

  const oldName = current.vendor_name_override ?? current.vendor_name;

  if (oldName === newName) return NextResponse.json({ message: '변경 없음' });

  // 거래처명 override 업데이트
  const { error: updateErr } = await (client as any)
    .from('cashflow_entries')
    .update({ vendor_name_override: newName, match_status: 'USER_EDITED', is_user_edited: true })
    .eq('id', id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // 이력 저장
  await (client as any).from('vendor_name_history').insert({
    cashflow_entry_id: id,
    old_name:    oldName,
    new_name:    newName,
    changed_by:  changedBy,
    change_reason: changeReason,
    change_path: changePath,
  });

  await (client as any).from('cashflow_entry_history').insert({
    cashflow_entry_id: id,
    action:     'VENDOR_EDIT',
    data_before: { vendor_name: oldName },
    data_after:  { vendor_name: newName },
    changed_by:  changedBy,
  });

  return NextResponse.json({ ok: true, newName });
}

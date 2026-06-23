/**
 * PATCH /api/cashflow/[id]/category
 * 구분(display_category) 수동 수정 - 이후 자동 분류가 덮어쓰지 않음
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
  const newCategory = body?.display_category?.trim();
  const changedBy   = body?.changed_by ?? 'user';

  if (!newCategory) return NextResponse.json({ error: 'display_category 필수' }, { status: 400 });

  const client = createServerClient();
  if (!client) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 });

  const { data: current, error: fetchErr } = await (client as any)
    .from('cashflow_entries')
    .select('id, display_category, category_manual')
    .eq('id', id)
    .single();

  if (fetchErr || !current) return NextResponse.json({ error: '항목 없음' }, { status: 404 });

  const oldCategory = current.category_manual ?? current.display_category;

  const { error: updateErr } = await (client as any)
    .from('cashflow_entries')
    .update({
      category_manual:    newCategory,
      display_category:   newCategory,
      category_override:  true,          // 수동 수정 활성 → 자동 분류가 덮어쓰지 않음
    })
    .eq('id', id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await (client as any).from('cashflow_entry_history').insert({
    cashflow_entry_id: id,
    action:      'CATEGORY_CHANGE',
    data_before: { display_category: oldCategory },
    data_after:  { display_category: newCategory },
    changed_by:  changedBy,
  });

  return NextResponse.json({ ok: true, newCategory });
}

/**
 * POST /api/cashflow/groups  — 그룹 생성
 * GET  /api/cashflow/groups  — 그룹 목록 조회 (month 쿼리 파라미터)
 * PATCH /api/cashflow/groups — 그룹 수정 (body에 id 포함)
 * DELETE /api/cashflow/groups — 그룹 해제 (body에 id 포함)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/src/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  const companyCode = req.nextUrl.searchParams.get('company') ?? '';

  const client = createServerClient();
  if (!client) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 });

  let query = (client as any)
    .from('cashflow_groups')
    .select('id, group_name, company_code, month, created_at');
  if (month)       query = query.eq('month', month);
  if (companyCode) query = query.eq('company_code', companyCode);
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ groups: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const groupName:  string   = body?.group_name?.trim();
  const entryIds:   string[] = body?.entry_ids   ?? [];
  const companyCode: string  = body?.company_code ?? '';
  const month:      string   = body?.month        ?? '';
  const createdBy:  string   = body?.created_by   ?? 'user';

  if (!groupName)          return NextResponse.json({ error: 'group_name 필수' }, { status: 400 });
  if (!entryIds.length)    return NextResponse.json({ error: 'entry_ids 필수' }, { status: 400 });

  const client = createServerClient();
  if (!client) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 });

  // 그룹 생성
  const { data: group, error: groupErr } = await (client as any)
    .from('cashflow_groups')
    .insert({ group_name: groupName, company_code: companyCode, month, created_by: createdBy })
    .select('id, group_name')
    .single();

  if (groupErr) return NextResponse.json({ error: groupErr.message }, { status: 500 });

  // 선택 항목에 group_id 할당
  const updates = entryIds.map((entryId, idx) => ({
    id: entryId,
    group_id:   group.id,
    group_name: groupName,
    group_order: idx,
  }));

  for (const upd of updates) {
    await (client as any)
      .from('cashflow_entries')
      .update({ group_id: upd.group_id, group_name: upd.group_name, group_order: upd.group_order })
      .eq('id', upd.id);
  }

  // 이력
  await (client as any).from('cashflow_groups_history').insert({
    group_id:   group.id,
    action:     'CREATE',
    group_name: groupName,
    entry_ids:  entryIds,
    changed_by: createdBy,
  });

  return NextResponse.json({ ok: true, group }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const groupId = body?.id;
  if (!groupId) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

  const client = createServerClient();
  if (!client) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 });

  const updates: Record<string, unknown> = {};
  if (body.group_name) updates.group_name = body.group_name.trim();

  if (Object.keys(updates).length === 0) return NextResponse.json({ message: '변경 없음' });

  // 그룹명 변경 시 entries도 갱신
  if (updates.group_name) {
    await (client as any)
      .from('cashflow_entries')
      .update({ group_name: updates.group_name })
      .eq('group_id', groupId);
  }

  const { error } = await (client as any)
    .from('cashflow_groups')
    .update(updates)
    .eq('id', groupId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await (client as any).from('cashflow_groups_history').insert({
    group_id:   groupId,
    action:     'RENAME',
    group_name: updates.group_name ?? null,
    changed_by: body.changed_by ?? 'user',
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const groupId  = body?.id;
  const changedBy = body?.changed_by ?? 'user';

  if (!groupId) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

  const client = createServerClient();
  if (!client) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 });

  // 그룹에 속한 항목 해제 (group_id = null)
  const { data: affected } = await (client as any)
    .from('cashflow_entries')
    .select('id')
    .eq('group_id', groupId);

  const affectedIds = (affected ?? []).map((r: any) => r.id);

  await (client as any)
    .from('cashflow_entries')
    .update({ group_id: null, group_name: null, group_order: 0 })
    .eq('group_id', groupId);

  // 그룹 삭제 (CASCADE로 FK가 SET NULL되므로 entries는 이미 처리됨)
  await (client as any).from('cashflow_groups').delete().eq('id', groupId);

  await (client as any).from('cashflow_groups_history').insert({
    group_id:   groupId,
    action:     'DISSOLVE',
    entry_ids:  affectedIds,
    changed_by: changedBy,
  });

  return NextResponse.json({ ok: true, releasedCount: affectedIds.length });
}

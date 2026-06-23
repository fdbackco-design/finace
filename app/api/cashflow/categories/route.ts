/**
 * GET  /api/cashflow/categories  — 구분 항목 목록 조회
 * POST /api/cashflow/categories  — 구분 항목 추가
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/src/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const client = createServerClient();
  if (!client) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 });

  const { data, error } = await (client as any)
    .from('cashflow_category_items')
    .select('id, category_value, is_system, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categories: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const value = body?.category_value?.trim();
  if (!value) return NextResponse.json({ error: 'category_value 필수' }, { status: 400 });

  const client = createServerClient();
  if (!client) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 });

  const { data, error } = await (client as any)
    .from('cashflow_category_items')
    .upsert({ category_value: value, is_system: false, is_active: true, sort_order: 500 }, { onConflict: 'category_value' })
    .select('id, category_value, is_system, sort_order');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data?.[0] }, { status: 201 });
}

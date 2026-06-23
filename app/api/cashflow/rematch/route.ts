/**
 * POST /api/cashflow/rematch
 *
 * body: { month: "YYYY-MM" }
 *
 * DB에서 해당 월 bank/card/hometax 데이터를 불러와 매칭 엔진을 재실행하고,
 * 자동 생성된 cashflow_entries(USER_EDITED / USER_CONFIRMED 제외)를 교체한다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runRematch } from '@/src/lib/upload/runRematch';

export const dynamic    = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const month: string = body?.month ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month 파라미터가 필요합니다 (YYYY-MM)' }, { status: 400 });
  }

  try {
    const result = await runRematch(month);
    return NextResponse.json({ ok: true, month, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

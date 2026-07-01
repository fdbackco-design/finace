import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/src/lib/supabase/server';
import { getCashEventBalances } from '@/src/lib/phase2/balanceQueries';
import type { CashStatus } from '@/src/lib/phase2/types';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase 환경변수 누락' }, { status: 503 });
  }

  const params        = req.nextUrl.searchParams;
  const companyId     = params.get('company_id')      ?? undefined;
  const cashStatus    = params.get('cash_status');
  const eventDateFrom = params.get('event_date_from') ?? undefined;
  const eventDateTo   = params.get('event_date_to')   ?? undefined;
  const limitStr      = params.get('limit');
  const limit         = limitStr ? parseInt(limitStr, 10) : undefined;

  let statusFilter: CashStatus | CashStatus[] | undefined;
  if (cashStatus === 'unallocated') {
    statusFilter = ['UNALLOCATED', 'PARTIALLY_ALLOCATED'];
  } else if (cashStatus) {
    statusFilter = cashStatus.toUpperCase() as CashStatus;
  }

  const { data, error } = await getCashEventBalances(supabase, {
    companyId,
    cashStatus:     statusFilter,
    eventDateFrom,
    eventDateTo,
    limit,
  });

  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ data });
}

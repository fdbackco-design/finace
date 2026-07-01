import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/src/lib/supabase/server';
import { getObligationBalances } from '@/src/lib/phase2/balanceQueries';
import type { LifecycleStatus } from '@/src/lib/phase2/types';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase 환경변수 누락' }, { status: 503 });
  }

  const params          = req.nextUrl.searchParams;
  const companyId       = params.get('company_id')    ?? undefined;
  const lifecycleStatus = params.get('lifecycle_status');
  const dueDateFrom     = params.get('due_date_from') ?? undefined;
  const dueDateTo       = params.get('due_date_to')   ?? undefined;
  const limitStr        = params.get('limit');
  const limit           = limitStr ? parseInt(limitStr, 10) : undefined;

  let statusFilter: LifecycleStatus | LifecycleStatus[] | undefined;
  if (lifecycleStatus === 'open') {
    statusFilter = ['OPEN', 'PARTIALLY_SETTLED'];
  } else if (lifecycleStatus) {
    statusFilter = lifecycleStatus.toUpperCase() as LifecycleStatus;
  }

  const { data, error } = await getObligationBalances(supabase, {
    companyId,
    lifecycleStatus: statusFilter,
    dueDateFrom,
    dueDateTo,
    limit,
  });

  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ data });
}

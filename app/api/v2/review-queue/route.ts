import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/src/lib/supabase/server';
import { createReviewQueueItem } from '@/src/lib/phase2/reviewDecisionService';
import type { ReviewType, ReviewPriority } from '@/src/lib/phase2/types';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

// ── GET: 검토 대기 목록 조회 ───────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase 환경변수 누락' }, { status: 503 });
  }

  const params      = req.nextUrl.searchParams;
  const companyId   = params.get('company_id')  ?? undefined;
  const caseStatus  = params.get('case_status') ?? 'PENDING';
  const reviewType  = params.get('review_type') ?? undefined;
  const limitStr    = params.get('limit');
  const limit       = limitStr ? parseInt(limitStr, 10) : 50;

  let q = supabase
    .from('review_queue')
    .select('*')
    .eq('case_status', caseStatus)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (companyId)  q = q.eq('company_id', companyId);
  if (reviewType) q = q.eq('review_type', reviewType);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// ── POST: 새 검토 항목 생성 ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase 환경변수 누락' }, { status: 503 });
  }

  let body: {
    company_id:              string;
    company_code:            string;
    review_type:             ReviewType;
    priority?:               ReviewPriority;
    obligation_id?:          string;
    cash_event_id?:          string;
    proposed_allocation_id?: string;
    summary:                 string;
    detail_json?:            Record<string, unknown>;
    due_date?:               string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 JSON' }, { status: 400 });
  }

  if (!body.company_id || !body.review_type || !body.summary) {
    return NextResponse.json({ error: 'company_id, review_type, summary 필수' }, { status: 400 });
  }

  const { data, error } = await createReviewQueueItem(supabase, {
    companyId:             body.company_id,
    companyCode:           body.company_code,
    reviewType:            body.review_type,
    priority:              body.priority ?? 'NORMAL',
    obligationId:          body.obligation_id,
    cashEventId:           body.cash_event_id,
    proposedAllocationId:  body.proposed_allocation_id,
    summary:               body.summary,
    detailJson:            body.detail_json,
    dueDate:               body.due_date,
  });

  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}

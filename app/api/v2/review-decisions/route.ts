import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/src/lib/supabase/server';
import { processReviewDecision } from '@/src/lib/phase2/reviewDecisionService';
import type { Decision, ActorRole, ReviewEffectInput } from '@/src/lib/phase2/types';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

// ── POST: 검토 결정 처리 (RPC 호출) ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase 환경변수 누락' }, { status: 503 });
  }

  let body: {
    review_queue_id:  string;
    decision:         Decision;
    decision_reason:  string;
    actor_id:         string;
    actor_role:       ActorRole;
    effects:          Array<{
      effect_type:               string;
      match_allocation_id?:      string;
      obligation_adjustment_id?: string;
      obligation_id?:            string;
      amount_override?:          number;
    }>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 JSON' }, { status: 400 });
  }

  if (!body.review_queue_id || !body.decision || !body.actor_id || !body.actor_role) {
    return NextResponse.json(
      { error: 'review_queue_id, decision, actor_id, actor_role 필수' },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.effects)) {
    return NextResponse.json({ error: 'effects는 배열이어야 합니다' }, { status: 400 });
  }

  const effects: ReviewEffectInput[] = body.effects.map(e => ({
    effectType:             e.effect_type as ReviewEffectInput['effectType'],
    matchAllocationId:      e.match_allocation_id,
    obligationAdjustmentId: e.obligation_adjustment_id,
    obligationId:           e.obligation_id,
    amountOverride:         e.amount_override,
  }));

  const { data, error } = await processReviewDecision(supabase, {
    reviewQueueId:  body.review_queue_id,
    decision:       body.decision,
    decisionReason: body.decision_reason,
    actorId:        body.actor_id,
    actorRole:      body.actor_role,
    effects,
  });

  if (error) {
    const status = error.includes('CEO role') ? 403 : 500;
    return NextResponse.json({ error }, { status });
  }

  return NextResponse.json({ data }, { status: 201 });
}

// ── GET: 검토 결정 이력 조회 ──────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase 환경변수 누락' }, { status: 503 });
  }

  const params          = req.nextUrl.searchParams;
  const reviewQueueId   = params.get('review_queue_id') ?? undefined;
  const companyId       = params.get('company_id')      ?? undefined;
  const limitStr        = params.get('limit');
  const limit           = limitStr ? parseInt(limitStr, 10) : 20;

  let q = supabase
    .from('review_decisions')
    .select('*, review_decision_effects(*)')
    .order('decided_at', { ascending: false })
    .limit(limit);

  if (reviewQueueId) q = q.eq('review_queue_id', reviewQueueId);
  if (companyId)     q = q.eq('company_id', companyId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

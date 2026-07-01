/**
 * Phase 2A: Review Decision 서비스
 *
 * process_review_decision() RPC 호출 래퍼.
 * 원자성은 DB RPC에서 보장 — 이 계층은 타입 안전성 + 에러 처리만 담당.
 *
 * HUMAN_CONFIRMED allocation 정정 경로:
 *   1. 새 review_queue CORRECTION_REQUEST 생성
 *   2. 이 함수를 ALLOCATION_SUPERSEDE effect로 호출 → 기존 allocation SUPERSEDED
 *   3. 필요 시 새 PROPOSED allocation + ALLOCATION_CONFIRM effect를 같은 호출에 포함
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ReviewDecisionInput,
  ProcessReviewDecisionResult,
  ReviewQueue,
  ReviewType,
  ReviewPriority,
} from './types';

// ── Review Decision 처리 ───────────────────────────────────────────────────────

export async function processReviewDecision(
  supabase: SupabaseClient,
  input:    ReviewDecisionInput,
): Promise<{ data: ProcessReviewDecisionResult | null; error: string | null }> {
  const { reviewQueueId, decision, decisionReason, actorId, actorRole, effects } = input;

  const { data, error } = await supabase.rpc('process_review_decision', {
    p_review_queue_id: reviewQueueId,
    p_decision:        decision,
    p_decision_reason: decisionReason,
    p_actor_id:        actorId,
    p_actor_role:      actorRole,
    p_effects:         effects.map(e => ({
      effect_type:              e.effectType,
      match_allocation_id:      e.matchAllocationId      ?? null,
      obligation_adjustment_id: e.obligationAdjustmentId ?? null,
      obligation_id:            e.obligationId           ?? null,
      amount_override:          e.amountOverride         ?? null,
    })),
  });

  if (error) return { data: null, error: error.message };

  const result = data as { ok: boolean; review_decision_id: string };
  return {
    data: {
      ok:               result.ok,
      reviewDecisionId: result.review_decision_id,
    },
    error: null,
  };
}

// ── Review Queue 생성 ─────────────────────────────────────────────────────────

export interface CreateReviewQueueInput {
  companyId:             string;
  companyCode:           string;
  reviewType:            ReviewType;
  priority:              ReviewPriority;
  obligationId?:         string;
  cashEventId?:          string;
  proposedAllocationId?: string;
  proposedAdjustmentId?: string;
  summary:               string;
  detailJson?:           Record<string, unknown>;
  dueDate?:              string;
}

export async function createReviewQueueItem(
  supabase: SupabaseClient,
  input:    CreateReviewQueueInput,
): Promise<{ data: ReviewQueue | null; error: string | null }> {
  const { data, error } = await supabase
    .from('review_queue')
    .insert({
      company_id:             input.companyId,
      company_code:           input.companyCode,
      review_type:            input.reviewType,
      priority:               input.priority,
      case_status:            'PENDING',
      obligation_id:          input.obligationId          ?? null,
      cash_event_id:          input.cashEventId           ?? null,
      proposed_allocation_id: input.proposedAllocationId  ?? null,
      proposed_adjustment_id: input.proposedAdjustmentId  ?? null,
      summary:                input.summary,
      detail_json:            input.detailJson             ?? null,
      due_date:               input.dueDate                ?? null,
    })
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as ReviewQueue, error: null };
}

// ── HUMAN_CONFIRMED allocation 정정 헬퍼 ─────────────────────────────────────
// 기존 HUMAN_CONFIRMED allocation → SUPERSEDED
// 새 allocation(PROPOSED) 생성은 호출자가 별도로 처리 후 이 함수에 ALLOCATION_CONFIRM effect로 포함

export async function requestAllocationCorrection(
  supabase:           SupabaseClient,
  opts: {
    companyId:         string;
    companyCode:       string;
    existingAllocationId: string;
    newAllocationId?:  string;
    newAllocatedAmount?: number;
    actorId:           string;
    actorRole:         'CEO' | 'FINANCE';
    reason:            string;
  },
): Promise<{ data: ProcessReviewDecisionResult | null; error: string | null }> {
  // 1. 정정 요청 review_queue 생성
  const { data: rq, error: rqErr } = await createReviewQueueItem(supabase, {
    companyId:            opts.companyId,
    companyCode:          opts.companyCode,
    reviewType:           'CORRECTION_REQUEST',
    priority:             'NORMAL',
    proposedAllocationId: opts.existingAllocationId,
    summary:              `배분 정정 요청: ${opts.reason}`,
    detailJson:           { existing_allocation_id: opts.existingAllocationId, reason: opts.reason },
  });

  if (rqErr || !rq) return { data: null, error: rqErr ?? 'review_queue 생성 실패' };

  // 2. SUPERSEDE + (선택) 새 allocation CONFIRM을 단일 RPC 호출
  const effects = [
    { effectType: 'ALLOCATION_SUPERSEDE' as const, matchAllocationId: opts.existingAllocationId },
    ...(opts.newAllocationId ? [{
      effectType:        'ALLOCATION_CONFIRM' as const,
      matchAllocationId: opts.newAllocationId,
      amountOverride:    opts.newAllocatedAmount,
    }] : []),
  ];

  return processReviewDecision(supabase, {
    reviewQueueId:  rq.id,
    decision:       'APPROVED',
    decisionReason: opts.reason,
    actorId:        opts.actorId,
    actorRole:      opts.actorRole,
    effects,
  });
}

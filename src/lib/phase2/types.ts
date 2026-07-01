/**
 * Phase 2A TypeScript 타입 정의
 *
 * 원칙:
 *   - obligations / cash_events 잔액은 DB View에서 계산
 *   - remaining_amount / unallocated_amount는 View 조회 결과에만 존재
 *   - lifecycle_status / cash_status도 View에서 파생
 */

import type { CompanyCode } from '../types';

// ── 공통 ─────────────────────────────────────────────────────────────────────

export type EventType     = 'REALIZED_INFLOW' | 'REALIZED_OUTFLOW' | 'EXPECTED_INFLOW' | 'EXPECTED_OUTFLOW';
export type ObligationType = 'RECEIVABLE' | 'PAYABLE';
export type ObligationSubtype = 'HT_INVOICE' | 'CARD_SETTLEMENT_GROUP' | 'FIXED_COST' | 'MANUAL';
export type OriginType    = 'SOURCE_TRANSACTION' | 'CARD_SETTLEMENT_GROUP' | 'FIXED_COST_RULE' | 'MANUAL';
export type AllocationStatus = 'PROPOSED' | 'AUTO_CONFIRMED' | 'HUMAN_CONFIRMED' | 'REJECTED' | 'SUPERSEDED';
export type AdjustmentStatus = 'PROPOSED' | 'HUMAN_CONFIRMED' | 'REJECTED';
export type AdjustmentType   = 'FEE_DEDUCTION' | 'DISCOUNT' | 'WRITE_OFF' | 'REVERSAL';
export type ReviewType    = 'PARTIAL_PAYMENT' | 'COMBINED_PAYMENT' | 'FEE_DEDUCTION' |
  'MULTIPLE_CANDIDATES' | 'DATE_MISMATCH' | 'AMOUNT_MISMATCH' |
  'NEW_COUNTERPARTY' | 'UNIDENTIFIED_COUNTERPARTY' |
  'OVERDUE_OBLIGATION' | 'UNALLOCATED_CASH' | 'OVER_ALLOCATED' |
  'CORRECTION_REQUEST';
export type ReviewPriority = 'URGENT' | 'NORMAL' | 'LOW';
export type CaseStatus    = 'PENDING' | 'IN_REVIEW' | 'RESOLVED' | 'DEFERRED';
export type Decision      = 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'PARTIAL_APPROVE';
export type ActorRole     = 'CEO' | 'FINANCE' | 'SYSTEM';
export type LifecycleStatus = 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED' | 'CANCELLED' | 'SUPERSEDED';
export type CashStatus    = 'UNALLOCATED' | 'PARTIALLY_ALLOCATED' | 'FULLY_ALLOCATED' | 'OVER_ALLOCATED';
export type EffectType    = 'ALLOCATION_CONFIRM' | 'ALLOCATION_REJECT' | 'ALLOCATION_SUPERSEDE' |
  'ADJUSTMENT_CONFIRM' | 'ADJUSTMENT_REJECT' | 'OBLIGATION_CANCEL';
export type MatchType     = 'FULL' | 'PARTIAL' | 'COMBINED' | 'CARD_SETTLEMENT' | 'FEE_ADJUSTED';

// ── 핵심 엔티티 (DB 저장 컬럼) ───────────────────────────────────────────────

export interface NormalizedTransaction {
  id:                       string;
  company_id:               string;
  company_code:             CompanyCode;
  bank_transaction_id:      string | null;
  card_transaction_id:      string | null;
  hometax_invoice_id:       string | null;
  event_type:               EventType;
  event_date:               string;  // YYYY-MM-DD
  gross_amount:             number;
  counterparty_name:        string | null;
  counterparty_business_no: string | null;
  is_projected:             boolean;
  projected_at:             string | null;
  created_at:               string;
}

export interface CashEvent {
  id:                        string;
  company_id:                string;
  company_code:              CompanyCode;
  normalized_transaction_id: string;
  bank_transaction_id:       string;
  event_type:                'INFLOW' | 'OUTFLOW';
  event_date:                string;
  gross_amount:              number;
  account_no:                string | null;
  source_type:               'BANK_IBK' | 'BANK_WOORI' | null;
  created_at:                string;
  updated_at:                string;
}

export interface CashEventBalance extends CashEvent {
  confirmed_allocated_amount: number;
  unallocated_amount:         number;
  cash_status:                CashStatus;
}

export interface Obligation {
  id:                                string;
  company_id:                        string;
  company_code:                      CompanyCode;
  origin_type:                       OriginType;
  obligation_type:                   ObligationType;
  obligation_subtype:                ObligationSubtype;
  due_date:                          string | null;
  gross_amount:                      number;
  normalized_transaction_id:         string | null;
  generated_from_fixed_cost_rule_id: string | null;
  fixed_cost_month:                  string | null;
  card_settlement_group_key:         string | null;
  counterparty_name:                 string | null;
  counterparty_business_no:          string | null;
  is_user_locked:                    boolean;
  locked_by:                         string | null;
  locked_at:                         string | null;
  is_cancelled:                      boolean;
  cancelled_at:                      string | null;
  cancelled_reason:                  string | null;
  is_superseded:                     boolean;
  superseded_at:                     string | null;
  created_at:                        string;
  updated_at:                        string;
}

export interface ObligationBalance extends Obligation {
  confirmed_allocated_amount: number;
  confirmed_adjusted_amount:  number;
  remaining_amount:           number;
  lifecycle_status:           LifecycleStatus;
}

export interface MatchAllocation {
  id:                string;
  company_id:        string;
  cash_event_id:     string;
  obligation_id:     string;
  allocated_amount:  number;
  match_type:        MatchType;
  confidence_score:  number | null;
  match_reason_codes: string[] | null;
  date_diff_days:    number | null;
  created_by:        'ENGINE' | 'HUMAN' | 'RULE';
  matching_run_id:   string | null;
  allocation_status: AllocationStatus;
  review_decision_id: string | null;
  created_at:        string;
  updated_at:        string;
}

export interface ObligationAdjustment {
  id:                string;
  obligation_id:     string;
  company_id:        string;
  adjustment_type:   AdjustmentType;
  amount:            number;
  status:            AdjustmentStatus;
  review_decision_id: string | null;
  reason:            string;
  evidence_json:     Record<string, unknown> | null;
  created_at:        string;
  updated_at:        string;
}

export interface ObligationSourceLink {
  id:                       string;
  obligation_id:             string;
  link_type:                 'HT_INVOICE_SOURCE' | 'CARD_COMPONENT' | 'FIXED_COST_SOURCE';
  normalized_transaction_id: string | null;
  card_transaction_id:       string | null;
  hometax_invoice_id:        string | null;
  fixed_cost_rule_id:        string | null;
  contributing_amount:       number;
  created_at:                string;
}

export interface ReviewQueue {
  id:                     string;
  company_id:             string;
  company_code:           CompanyCode;
  review_type:            ReviewType;
  priority:               ReviewPriority;
  case_status:            CaseStatus;
  obligation_id:          string | null;
  cash_event_id:          string | null;
  proposed_allocation_id: string | null;
  proposed_adjustment_id: string | null;
  summary:                string;
  detail_json:            Record<string, unknown> | null;
  assigned_to:            string | null;
  due_date:               string | null;
  resolved_at:            string | null;
  created_at:             string;
  updated_at:             string;
}

export interface ReviewDecision {
  id:              string;
  review_queue_id: string;
  company_id:      string;
  decision:        Decision;
  decision_reason: string;
  actor_id:        string;
  actor_role:      ActorRole;
  decided_at:      string;
  created_at:      string;
}

export interface ReviewDecisionEffect {
  id:                       string;
  review_decision_id:        string;
  effect_type:               EffectType;
  match_allocation_id:       string | null;
  obligation_adjustment_id:  string | null;
  obligation_id:             string | null;
  amount_override:           number | null;
  created_at:                string;
}

// ── 서비스 계층 파라미터 타입 ─────────────────────────────────────────────────

export interface ReviewDecisionInput {
  reviewQueueId:  string;
  decision:       Decision;
  decisionReason: string;
  actorId:        string;
  actorRole:      ActorRole;
  effects:        ReviewEffectInput[];
}

export interface ReviewEffectInput {
  effectType:             EffectType;
  matchAllocationId?:     string;
  obligationAdjustmentId?: string;
  obligationId?:          string;
  amountOverride?:        number;
}

export interface ProcessReviewDecisionResult {
  ok:               boolean;
  reviewDecisionId: string;
}

// ── 투영 결과 타입 ────────────────────────────────────────────────────────────

export interface Phase2ProjectionResult {
  normalizedTransactions: number;
  cashEvents:             number;
  htObligations:          number;
  cardGroupObligations:   number;
  fixedCostObligations:   number;
  proposedAllocations:    number;
  autoConfirmedAllocations: number;
  reviewItems:            number;
  overdueItems:           number;
  errors:                 string[];
}

// ── 자동확정 판단 근거 ─────────────────────────────────────────────────────────

export type AutoConfirmCode =
  | 'SAME_COMPANY'
  | 'DIRECTION_MATCH'
  | 'AMOUNT_EXACT'
  | 'DATE_WITHIN_3D'
  | 'VENDOR_STRONG_MATCH'
  | 'SINGLE_CANDIDATE'
  | 'SINGLE_ALLOCATION'
  | 'NOT_PARTIAL_PAYMENT'
  | 'NO_PARSE_WARNINGS';

export interface AutoConfirmCheck {
  code:    AutoConfirmCode;
  passed:  boolean;
  detail?: string;
}

/**
 * Phase 2A Golden Dataset
 *
 * 명세 기반 픽스처: 실제 DB 없이 순수 로직 검증.
 * 모든 날짜는 2026-06 기준.
 */

import type {
  NormalizedTransaction,
  CashEvent,
  Obligation,
  ObligationBalance,
  CashEventBalance,
  MatchAllocation,
} from '../../src/lib/phase2/types';

// ── 고정 상수 ──────────────────────────────────────────────────────────────────

export const COMPANY_ID   = 'aaaaaaaa-0000-0000-0000-000000000001';
export const COMPANY_CODE = 'feedback' as const;

// ── NT 픽스처 ─────────────────────────────────────────────────────────────────

export const NT_BANK_INFLOW: NormalizedTransaction = {
  id:                        'nt-bank-001',
  company_id:                COMPANY_ID,
  company_code:              COMPANY_CODE,
  bank_transaction_id:       'bank-001',
  card_transaction_id:       null,
  hometax_invoice_id:        null,
  event_type:                'REALIZED_INFLOW',
  event_date:                '2026-06-10',
  gross_amount:              1100000,
  counterparty_name:         '(주)테스트벤더',
  counterparty_business_no:  '123-45-67890',
  is_projected:              true,
  projected_at:              '2026-06-10T10:00:00Z',
  created_at:                '2026-06-10T10:00:00Z',
};

export const NT_BANK_OUTFLOW: NormalizedTransaction = {
  id:                        'nt-bank-002',
  company_id:                COMPANY_ID,
  company_code:              COMPANY_CODE,
  bank_transaction_id:       'bank-002',
  card_transaction_id:       null,
  hometax_invoice_id:        null,
  event_type:                'REALIZED_OUTFLOW',
  event_date:                '2026-06-15',
  gross_amount:              550000,
  counterparty_name:         '(주)공급사A',
  counterparty_business_no:  '234-56-78901',
  is_projected:              true,
  projected_at:              '2026-06-15T10:00:00Z',
  created_at:                '2026-06-15T10:00:00Z',
};

export const NT_HT_SALES: NormalizedTransaction = {
  id:                        'nt-ht-001',
  company_id:                COMPANY_ID,
  company_code:              COMPANY_CODE,
  bank_transaction_id:       null,
  card_transaction_id:       null,
  hometax_invoice_id:        'ht-sales-001',
  event_type:                'EXPECTED_INFLOW',
  event_date:                '2026-06-08',
  gross_amount:              1100000,
  counterparty_name:         '(주)테스트벤더',
  counterparty_business_no:  '123-45-67890',
  is_projected:              true,
  projected_at:              '2026-06-08T09:00:00Z',
  created_at:                '2026-06-08T09:00:00Z',
};

export const NT_HT_PURCHASE: NormalizedTransaction = {
  id:                        'nt-ht-002',
  company_id:                COMPANY_ID,
  company_code:              COMPANY_CODE,
  bank_transaction_id:       null,
  card_transaction_id:       null,
  hometax_invoice_id:        'ht-purchase-001',
  event_type:                'EXPECTED_OUTFLOW',
  event_date:                '2026-06-12',
  gross_amount:              550000,
  counterparty_name:         '(주)공급사A',
  counterparty_business_no:  '234-56-78901',
  is_projected:              true,
  projected_at:              '2026-06-12T09:00:00Z',
  created_at:                '2026-06-12T09:00:00Z',
};

export const NT_CARD: NormalizedTransaction = {
  id:                        'nt-card-001',
  company_id:                COMPANY_ID,
  company_code:              COMPANY_CODE,
  bank_transaction_id:       null,
  card_transaction_id:       'card-001',
  hometax_invoice_id:        null,
  event_type:                'EXPECTED_OUTFLOW',
  event_date:                '2026-05-30',
  gross_amount:              88000,
  counterparty_name:         '스타벅스',
  counterparty_business_no:  null,
  is_projected:              true,
  projected_at:              '2026-06-01T09:00:00Z',
  created_at:                '2026-06-01T09:00:00Z',
};

// ── Cash Event 픽스처 ─────────────────────────────────────────────────────────

export const CE_INFLOW: CashEvent = {
  id:                        'ce-001',
  company_id:                COMPANY_ID,
  company_code:              COMPANY_CODE,
  normalized_transaction_id: 'nt-bank-001',
  bank_transaction_id:       'bank-001',
  event_type:                'INFLOW',
  event_date:                '2026-06-10',
  gross_amount:              1100000,
  account_no:                '123-456789',
  source_type:               'BANK_IBK',
  created_at:                '2026-06-10T10:00:00Z',
  updated_at:                '2026-06-10T10:00:00Z',
};

export const CE_OUTFLOW: CashEvent = {
  id:                        'ce-002',
  company_id:                COMPANY_ID,
  company_code:              COMPANY_CODE,
  normalized_transaction_id: 'nt-bank-002',
  bank_transaction_id:       'bank-002',
  event_type:                'OUTFLOW',
  event_date:                '2026-06-15',
  gross_amount:              550000,
  account_no:                '123-456789',
  source_type:               'BANK_IBK',
  created_at:                '2026-06-15T10:00:00Z',
  updated_at:                '2026-06-15T10:00:00Z',
};

// ── Obligation 픽스처 ─────────────────────────────────────────────────────────

const OBL_BASE = {
  company_id:                        COMPANY_ID,
  company_code:                      COMPANY_CODE,
  generated_from_fixed_cost_rule_id: null,
  fixed_cost_month:                  null,
  card_settlement_group_key:         null,
  is_user_locked:                    false,
  locked_by:                         null,
  locked_at:                         null,
  is_cancelled:                      false,
  cancelled_at:                      null,
  cancelled_reason:                  null,
  is_superseded:                     false,
  superseded_at:                     null,
  created_at:                        '2026-06-08T09:00:00Z',
  updated_at:                        '2026-06-08T09:00:00Z',
};

export const OBL_RECEIVABLE: Obligation = {
  ...OBL_BASE,
  id:                        'obl-001',
  origin_type:               'SOURCE_TRANSACTION',
  obligation_type:           'RECEIVABLE',
  obligation_subtype:        'HT_INVOICE',
  due_date:                  '2026-06-08',
  gross_amount:              1100000,
  normalized_transaction_id: 'nt-ht-001',
  counterparty_name:         '(주)테스트벤더',
  counterparty_business_no:  '123-45-67890',
};

export const OBL_PAYABLE: Obligation = {
  ...OBL_BASE,
  id:                        'obl-002',
  origin_type:               'SOURCE_TRANSACTION',
  obligation_type:           'PAYABLE',
  obligation_subtype:        'HT_INVOICE',
  due_date:                  '2026-06-12',
  gross_amount:              550000,
  normalized_transaction_id: 'nt-ht-002',
  counterparty_name:         '(주)공급사A',
  counterparty_business_no:  '234-56-78901',
};

export const OBL_CARD_GROUP: Obligation = {
  ...OBL_BASE,
  id:                        'obl-003',
  origin_type:               'CARD_SETTLEMENT_GROUP',
  obligation_type:           'PAYABLE',
  obligation_subtype:        'CARD_SETTLEMENT_GROUP',
  due_date:                  '2026-06-21',
  gross_amount:              88000,
  normalized_transaction_id: null,
  card_settlement_group_key: 'feedback||CARD_IBK||2026-06-21',
  counterparty_name:         null,
  counterparty_business_no:  null,
};

// ── ObligationBalance 픽스처 (View 결과) ──────────────────────────────────────

export const OBL_BALANCE_OPEN: ObligationBalance = {
  ...OBL_RECEIVABLE,
  confirmed_allocated_amount: 0,
  confirmed_adjusted_amount:  0,
  remaining_amount:           1100000,
  lifecycle_status:           'OPEN',
};

export const OBL_BALANCE_PARTIAL: ObligationBalance = {
  ...OBL_PAYABLE,
  confirmed_allocated_amount: 300000,
  confirmed_adjusted_amount:  0,
  remaining_amount:           250000,
  lifecycle_status:           'PARTIALLY_SETTLED',
};

export const OBL_BALANCE_SETTLED: ObligationBalance = {
  ...OBL_RECEIVABLE,
  id:                         'obl-001-settled',
  confirmed_allocated_amount: 1100000,
  confirmed_adjusted_amount:  0,
  remaining_amount:           0,
  lifecycle_status:           'SETTLED',
};

// ── CashEventBalance 픽스처 (View 결과) ───────────────────────────────────────

export const CE_BALANCE_UNALLOCATED: CashEventBalance = {
  ...CE_INFLOW,
  confirmed_allocated_amount: 0,
  unallocated_amount:         1100000,
  cash_status:                'UNALLOCATED',
};

export const CE_BALANCE_PARTIAL: CashEventBalance = {
  ...CE_OUTFLOW,
  confirmed_allocated_amount: 300000,
  unallocated_amount:         250000,
  cash_status:                'PARTIALLY_ALLOCATED',
};

export const CE_BALANCE_FULL: CashEventBalance = {
  ...CE_INFLOW,
  id:                         'ce-001-full',
  confirmed_allocated_amount: 1100000,
  unallocated_amount:         0,
  cash_status:                'FULLY_ALLOCATED',
};

// ── Allocation 픽스처 ─────────────────────────────────────────────────────────

export const ALLOC_AUTO_CONFIRMED: MatchAllocation = {
  id:                 'alloc-001',
  company_id:         COMPANY_ID,
  cash_event_id:      'ce-001',
  obligation_id:      'obl-001',
  allocated_amount:   1100000,
  match_type:         'FULL',
  confidence_score:   0.95,
  match_reason_codes: ['AUTO_CONFIRM'],
  date_diff_days:     2,
  created_by:         'ENGINE',
  matching_run_id:    null,
  allocation_status:  'AUTO_CONFIRMED',
  review_decision_id: null,
  created_at:         '2026-06-10T10:05:00Z',
  updated_at:         '2026-06-10T10:05:00Z',
};

export const ALLOC_HUMAN_CONFIRMED: MatchAllocation = {
  id:                 'alloc-002',
  company_id:         COMPANY_ID,
  cash_event_id:      'ce-002',
  obligation_id:      'obl-002',
  allocated_amount:   550000,
  match_type:         'FULL',
  confidence_score:   0.80,
  match_reason_codes: ['FAIL_DATE_WITHIN_3D'],
  date_diff_days:     5,
  created_by:         'ENGINE',
  matching_run_id:    null,
  allocation_status:  'HUMAN_CONFIRMED',
  review_decision_id: 'rd-001',
  created_at:         '2026-06-15T11:00:00Z',
  updated_at:         '2026-06-15T11:30:00Z',
};

// ── 자동확정 실패 케이스 ───────────────────────────────────────────────────────

/** 금액 불일치 케이스 (diff > 10원) */
export const CE_AMOUNT_MISMATCH: CashEventBalance = {
  ...CE_INFLOW,
  id:                         'ce-mismatch',
  gross_amount:               1100500,  // 500원 차이
  confirmed_allocated_amount: 0,
  unallocated_amount:         1100500,
  cash_status:                'UNALLOCATED',
};

/** 날짜 불일치 케이스 (diff > 3일) */
export const OBL_DATE_MISMATCH: ObligationBalance = {
  ...OBL_BALANCE_OPEN,
  id:           'obl-date-mismatch',
  due_date:     '2026-05-20',  // 21일 차이
  remaining_amount: 1100000,
};

/** 연체 케이스 */
export const OBL_OVERDUE: ObligationBalance = {
  ...OBL_BALANCE_OPEN,
  id:           'obl-overdue',
  due_date:     '2026-05-01',  // 55일 연체
  remaining_amount: 880000,
  lifecycle_status: 'OPEN',
};

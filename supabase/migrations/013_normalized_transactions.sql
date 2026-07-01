-- ==========================================================
-- 013_normalized_transactions.sql
-- Phase 2A: 원천 데이터 정규화 레이어
--
-- 역할:
--   bank/card/HT 원본의 포맷 차이를 흡수하여
--   cash_events / obligations 생성을 위한 정규화 레이어 제공
--
-- 중요: fixed_cost_rules는 여기서 소스가 아님
--       (obligations 직접 생성 — 015 참조)
--
-- source FK 제약: bank/card/HT 중 정확히 1개만 non-null
-- ==========================================================

-- ── 0. finance_audit_logs CHECK 제약 확장 (additive) ─────────────────────────
-- Phase 2A 이벤트 타입 추가 (기존 값 유지, 신규 값 추가)

ALTER TABLE finance_audit_logs
  DROP CONSTRAINT IF EXISTS finance_audit_logs_entity_type_check;
ALTER TABLE finance_audit_logs
  ADD CONSTRAINT finance_audit_logs_entity_type_check
  CHECK (entity_type IN (
    -- Phase 1 기존
    'upload_session', 'source_file',
    'bank_transaction', 'card_transaction', 'hometax_invoice',
    'cashflow_entry', 'matching_run',
    'vendor', 'fixed_cost_rule', 'setting',
    -- Phase 2A 신규
    'normalized_transaction', 'cash_event', 'obligation',
    'match_allocation', 'obligation_adjustment',
    'review_queue', 'review_decision'
  ));

ALTER TABLE finance_audit_logs
  DROP CONSTRAINT IF EXISTS finance_audit_logs_action_type_check;
ALTER TABLE finance_audit_logs
  ADD CONSTRAINT finance_audit_logs_action_type_check
  CHECK (action_type IN (
    -- Phase 1 기존
    'UPLOAD_START', 'UPLOAD_COMPLETE', 'UPLOAD_ERROR',
    'PARSE_COMPLETE', 'PARSE_PARTIAL', 'PARSE_ERROR',
    'IMPORT_COMPLETE',
    'REMATCH_START', 'REMATCH_COMPLETE', 'REMATCH_ERROR',
    'AUTO_MATCH', 'MATCH_SUPERSEDED',
    'VENDOR_REGISTER', 'VENDOR_ALIAS_ADD',
    'SETTING_CHANGE',
    -- Phase 2A 신규
    'NT_CREATED',
    'CASH_EVENT_CREATED',
    'OBLIGATION_CREATED', 'OBLIGATION_CANCELLED', 'OBLIGATION_SUPERSEDED',
    'ALLOCATION_PROPOSED', 'ALLOCATION_CONFIRMED',
    'ALLOCATION_REJECTED', 'ALLOCATION_SUPERSEDED', 'ALLOCATION_CORRECTION',
    'ADJUSTMENT_PROPOSED', 'ADJUSTMENT_CONFIRMED', 'ADJUSTMENT_REJECTED',
    'REVIEW_CREATED', 'REVIEW_RESOLVED', 'REVIEW_DEFERRED',
    'REVIEW_DECISION_RECORDED',
    'CARD_GROUP_CREATED', 'CARD_GROUP_UPDATED',
    'FIXED_COST_OBLIGATION_CREATED',
    'OVERDUE_DETECTED'
  ));

-- ── 1. normalized_transactions ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS normalized_transactions (
  id                      uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id              uuid         NOT NULL REFERENCES companies(id),
  company_code            text         NOT NULL,

  -- Source FK: 정확히 1개만 non-null (bank / card / HT)
  bank_transaction_id     uuid         REFERENCES bank_transactions(id),
  card_transaction_id     uuid         REFERENCES card_transactions(id),
  hometax_invoice_id      uuid         REFERENCES hometax_invoices(id),

  event_type              text         NOT NULL
    CHECK (event_type IN (
      'REALIZED_INFLOW',
      'REALIZED_OUTFLOW',
      'EXPECTED_INFLOW',
      'EXPECTED_OUTFLOW'
    )),
  event_date              date         NOT NULL,
  gross_amount            bigint       NOT NULL CHECK (gross_amount > 0),

  counterparty_name       text,
  counterparty_business_no text,

  -- 투영 여부 (cash_event 또는 obligation으로 투영됐는지)
  is_projected            boolean      NOT NULL DEFAULT false,
  projected_at            timestamptz,

  created_at              timestamptz  NOT NULL DEFAULT now(),

  -- 정확히 1개의 source FK만 non-null
  CONSTRAINT nt_exactly_one_source CHECK (
    (bank_transaction_id  IS NOT NULL)::int +
    (card_transaction_id  IS NOT NULL)::int +
    (hometax_invoice_id   IS NOT NULL)::int = 1
  ),
  -- 동일 source FK에 NT 중복 생성 방지
  CONSTRAINT nt_bank_unique   UNIQUE (bank_transaction_id),
  CONSTRAINT nt_card_unique   UNIQUE (card_transaction_id),
  CONSTRAINT nt_ht_unique     UNIQUE (hometax_invoice_id)
);

-- ── 인덱스 ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_nt_company_date
  ON normalized_transactions(company_id, event_date);
CREATE INDEX IF NOT EXISTS idx_nt_event_type
  ON normalized_transactions(event_type);
CREATE INDEX IF NOT EXISTS idx_nt_is_projected
  ON normalized_transactions(is_projected) WHERE is_projected = false;
CREATE INDEX IF NOT EXISTS idx_nt_counterparty
  ON normalized_transactions USING GIN (counterparty_name gin_trgm_ops);

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS normalized_transactions;
-- (finance_audit_logs CHECK 원복은 012 내용 그대로 ALTER TABLE로 복구)

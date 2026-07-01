-- ==========================================================
-- 014_cash_events.sql
-- Phase 2A: 실제 확인된 현금 이동 기록
--
-- 역할:
--   REALIZED_INFLOW / REALIZED_OUTFLOW normalized_transactions의
--   1:1 투영. 은행 거래만 소스.
--
-- 잔액 계산 없음:
--   allocated_amount, unallocated_amount, status는
--   v_cash_event_balance View에서 실시간 계산 (022 참조)
-- ==========================================================

CREATE TABLE IF NOT EXISTS cash_events (
  id                        uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id                uuid         NOT NULL REFERENCES companies(id),
  company_code              text         NOT NULL,

  normalized_transaction_id uuid         NOT NULL REFERENCES normalized_transactions(id),
  bank_transaction_id       uuid         NOT NULL REFERENCES bank_transactions(id),  -- denormalized

  event_type                text         NOT NULL
    CHECK (event_type IN ('INFLOW', 'OUTFLOW')),
  event_date                date         NOT NULL,
  gross_amount              bigint       NOT NULL CHECK (gross_amount > 0),

  account_no                text,
  source_type               text         -- BANK_IBK | BANK_WOORI

    CHECK (source_type IN ('BANK_IBK', 'BANK_WOORI')),

  created_at                timestamptz  NOT NULL DEFAULT now(),
  updated_at                timestamptz  NOT NULL DEFAULT now(),

  -- NT와 1:1
  CONSTRAINT ce_nt_unique UNIQUE (normalized_transaction_id),
  CONSTRAINT ce_bank_unique UNIQUE (bank_transaction_id)
);

-- ── 인덱스 ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ce_company_date
  ON cash_events(company_id, event_date);
CREATE INDEX IF NOT EXISTS idx_ce_event_type
  ON cash_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ce_gross_amount
  ON cash_events(gross_amount);

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS cash_events;

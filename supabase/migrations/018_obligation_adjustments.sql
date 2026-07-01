-- ==========================================================
-- 018_obligation_adjustments.sql
-- Phase 2A: 의무 잔액 조정 (수수료 차감·할인·대손·역분개)
--
-- 역할:
--   현금 배분 없이 obligation 잔액을 줄이는 조정.
--   review_decision_effects를 통해 HUMAN_CONFIRMED 처리.
--
-- 잔액 공식 (v_obligation_balance에서 계산):
--   remaining = gross_amount
--             - SUM(match_allocations AUTO/HUMAN_CONFIRMED)
--             - SUM(obligation_adjustments HUMAN_CONFIRMED)
--
-- WRITE_OFF 승인 권한:
--   Phase 2A: application service에서 actor_role='CEO' 검증
--   Phase 2B: RLS 레벨에서 강화 예정
-- ==========================================================

CREATE TABLE IF NOT EXISTS obligation_adjustments (
  id                  uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  obligation_id       uuid         NOT NULL REFERENCES obligations(id),
  company_id          uuid         NOT NULL REFERENCES companies(id),

  adjustment_type     text         NOT NULL
    CHECK (adjustment_type IN (
      'FEE_DEDUCTION',  -- 수수료 차감
      'DISCOUNT',       -- 할인
      'WRITE_OFF',      -- 대손 처리 (CEO 전용)
      'REVERSAL'        -- 역분개
    )),

  amount              bigint       NOT NULL CHECK (amount > 0),

  status              text         NOT NULL DEFAULT 'PROPOSED'
    CHECK (status IN ('PROPOSED', 'HUMAN_CONFIRMED', 'REJECTED')),

  review_decision_id  uuid,        -- HUMAN_CONFIRMED 시 review_decisions FK (021 추가 후 활성화)

  reason              text         NOT NULL,
  evidence_json       jsonb,

  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

-- ── 인덱스 ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_oa_obligation
  ON obligation_adjustments(obligation_id);
CREATE INDEX IF NOT EXISTS idx_oa_status
  ON obligation_adjustments(status);
CREATE INDEX IF NOT EXISTS idx_oa_confirmed
  ON obligation_adjustments(obligation_id, status)
  WHERE status = 'HUMAN_CONFIRMED';

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS obligation_adjustments;

-- ==========================================================
-- 021_review_decision_effects.sql
-- Phase 2A: 결정 효과 목록
--
-- 역할:
--   review_decisions 1건 → review_decision_effects N건
--   1개 결정으로 여러 allocation/adjustment 상태 변경 가능
--
-- 사용 케이스:
--   COMBINED_PAYMENT 승인 1회 → ALLOCATION_CONFIRM × 2
--   FEE_DEDUCTION 승인 1회 → ALLOCATION_CONFIRM + ADJUSTMENT_CONFIRM
--   정정 요청 승인 → ALLOCATION_SUPERSEDE + ALLOCATION_CONFIRM
-- ==========================================================

CREATE TABLE IF NOT EXISTS review_decision_effects (
  id                        uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_decision_id        uuid         NOT NULL REFERENCES review_decisions(id),

  effect_type               text         NOT NULL
    CHECK (effect_type IN (
      'ALLOCATION_CONFIRM',    -- match_allocation → HUMAN_CONFIRMED
      'ALLOCATION_REJECT',     -- match_allocation → REJECTED
      'ALLOCATION_SUPERSEDE',  -- match_allocation → SUPERSEDED (정정 경로 전용)
      'ADJUSTMENT_CONFIRM',    -- obligation_adjustment → HUMAN_CONFIRMED
      'ADJUSTMENT_REJECT',     -- obligation_adjustment → REJECTED
      'OBLIGATION_CANCEL'      -- obligation → is_cancelled = true
    )),

  match_allocation_id       uuid         REFERENCES match_allocations(id),
  obligation_adjustment_id  uuid         REFERENCES obligation_adjustments(id),
  obligation_id             uuid         REFERENCES obligations(id),

  amount_override           bigint,      -- PARTIAL_APPROVE 시 실제 확정 금액

  created_at                timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT rde_at_least_one_target CHECK (
    match_allocation_id IS NOT NULL OR
    obligation_adjustment_id IS NOT NULL OR
    obligation_id IS NOT NULL
  )
);

-- ── 인덱스 ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rde_decision
  ON review_decision_effects(review_decision_id);
CREATE INDEX IF NOT EXISTS idx_rde_allocation
  ON review_decision_effects(match_allocation_id)
  WHERE match_allocation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rde_adjustment
  ON review_decision_effects(obligation_adjustment_id)
  WHERE obligation_adjustment_id IS NOT NULL;

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS review_decision_effects;

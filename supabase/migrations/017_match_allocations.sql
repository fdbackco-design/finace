-- ==========================================================
-- 017_match_allocations.sql
-- Phase 2A: cash_events ↔ obligations N:M 금액 배분
--
-- 활성 allocation 정의:
--   PROPOSED / AUTO_CONFIRMED / HUMAN_CONFIRMED
--
-- 잔액 집계 포함 여부:
--   AUTO_CONFIRMED / HUMAN_CONFIRMED → v_obligation_balance 집계에 포함
--   PROPOSED → 집계 미포함 (확정 대기 중)
--   REJECTED / SUPERSEDED → 집계 미포함
--
-- 변경 규칙:
--   PROPOSED: allocated_amount UPDATE 허용
--   AUTO_CONFIRMED / HUMAN_CONFIRMED: UPDATE 금지
--     → 수정 필요 시 SUPERSEDED 처리 후 새 행 생성
--
-- 보호 규칙:
--   자동 재매칭: HUMAN_CONFIRMED allocation SUPERSEDE 금지
--   명시적 정정: review_decision + review_decision_effects 경로만 허용
-- ==========================================================

CREATE TABLE IF NOT EXISTS match_allocations (
  id                  uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          uuid         NOT NULL REFERENCES companies(id),

  cash_event_id       uuid         NOT NULL REFERENCES cash_events(id),
  obligation_id       uuid         NOT NULL REFERENCES obligations(id),

  allocated_amount    bigint       NOT NULL CHECK (allocated_amount > 0),

  match_type          text         NOT NULL
    CHECK (match_type IN (
      'FULL',          -- 현금 전액 = obligation remaining 정확 일치
      'PARTIAL',       -- 현금 일부만 배분 (obligation remaining 미만)
      'COMBINED',      -- 1 cash_event → N obligations 합산지급
      'CARD_SETTLEMENT', -- 카드 그룹 결제 매칭
      'FEE_ADJUSTED'   -- 수수료 차감 (별도 adjustment와 함께 사용)
    )),

  confidence_score    numeric(5,4),
  match_reason_codes  text[],      -- 충족된 조건 코드 배열

  date_diff_days      int,

  created_by          text         NOT NULL
    CHECK (created_by IN ('ENGINE', 'HUMAN', 'RULE')),
  matching_run_id     uuid         REFERENCES matching_runs(id),

  allocation_status   text         NOT NULL DEFAULT 'PROPOSED'
    CHECK (allocation_status IN (
      'PROPOSED',
      'AUTO_CONFIRMED',
      'HUMAN_CONFIRMED',
      'REJECTED',
      'SUPERSEDED'
    )),

  review_decision_id  uuid,        -- HUMAN_CONFIRMED 시 review_decisions FK (021 추가 후 활성화)

  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

-- 활성 allocation 유일성: 동일 (cash_event, obligation) 조합에 활성 allocation 최대 1개
CREATE UNIQUE INDEX IF NOT EXISTS idx_ma_active_unique
  ON match_allocations(cash_event_id, obligation_id)
  WHERE allocation_status IN ('PROPOSED', 'AUTO_CONFIRMED', 'HUMAN_CONFIRMED');

-- ── 인덱스 ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ma_cash_event
  ON match_allocations(cash_event_id);
CREATE INDEX IF NOT EXISTS idx_ma_obligation
  ON match_allocations(obligation_id);
CREATE INDEX IF NOT EXISTS idx_ma_status
  ON match_allocations(allocation_status);
CREATE INDEX IF NOT EXISTS idx_ma_confirmed
  ON match_allocations(obligation_id, allocation_status)
  WHERE allocation_status IN ('AUTO_CONFIRMED', 'HUMAN_CONFIRMED');

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS match_allocations;

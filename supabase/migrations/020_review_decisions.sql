-- ==========================================================
-- 020_review_decisions.sql
-- Phase 2A: 검토 결정 append-only 이력
--
-- 역할:
--   사람의 결정 자체를 기록. 수정/삭제 불가.
--   실제 영향 (어떤 allocation이 CONFIRMED됐는지)은
--   review_decision_effects (021) 에서 관리.
--
-- 원자성:
--   review_decision + review_decision_effects +
--   allocation/adjustment 상태 변경 + finance_audit_logs
--   → process_review_decision RPC (025) 에서 단일 트랜잭션 처리
-- ==========================================================

CREATE TABLE IF NOT EXISTS review_decisions (
  id                uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_queue_id   uuid         NOT NULL REFERENCES review_queue(id),
  company_id        uuid         NOT NULL REFERENCES companies(id),

  decision          text         NOT NULL
    CHECK (decision IN (
      'APPROVED',        -- 전체 승인
      'REJECTED',        -- 전체 거절
      'DEFERRED',        -- 다음 사이클로 연기
      'PARTIAL_APPROVE'  -- 일부 금액/항목만 승인
    )),

  decision_reason   text         NOT NULL,   -- 사유 필수
  actor_id          text         NOT NULL,
  actor_role        text         NOT NULL
    CHECK (actor_role IN ('CEO', 'FINANCE', 'SYSTEM')),

  decided_at        timestamptz  NOT NULL DEFAULT now(),  -- immutable
  created_at        timestamptz  NOT NULL DEFAULT now()

  -- UPDATE / DELETE 정책 없음 (append-only)
);

-- ── 인덱스 ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rd_review_queue
  ON review_decisions(review_queue_id);
CREATE INDEX IF NOT EXISTS idx_rd_decided_at
  ON review_decisions(decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_rd_actor
  ON review_decisions(actor_id, decided_at DESC);

-- match_allocations / obligation_adjustments → review_decisions FK 활성화
ALTER TABLE match_allocations
  ADD CONSTRAINT ma_review_decision_fk
  FOREIGN KEY (review_decision_id) REFERENCES review_decisions(id);

ALTER TABLE obligation_adjustments
  ADD CONSTRAINT oa_review_decision_fk
  FOREIGN KEY (review_decision_id) REFERENCES review_decisions(id);

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- ALTER TABLE match_allocations DROP CONSTRAINT IF EXISTS ma_review_decision_fk;
-- ALTER TABLE obligation_adjustments DROP CONSTRAINT IF EXISTS oa_review_decision_fk;
-- DROP TABLE IF EXISTS review_decisions;

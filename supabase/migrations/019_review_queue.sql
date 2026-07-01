-- ==========================================================
-- 019_review_queue.sql
-- Phase 2A: 검토 대기 큐
--
-- 역할:
--   자동화 확신 없는 케이스를 사람에게 전달.
--   한 건의 review_queue에 여러 allocation/adjustment 후보가 연결될 수 있음.
--
-- case_status 전이:
--   PENDING → IN_REVIEW → RESOLVED (review_decision 생성 완료)
--                       → DEFERRED → PENDING (다음 사이클 재진입)
-- ==========================================================

CREATE TABLE IF NOT EXISTS review_queue (
  id                      uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id              uuid         NOT NULL REFERENCES companies(id),
  company_code            text         NOT NULL,

  review_type             text         NOT NULL
    CHECK (review_type IN (
      'PARTIAL_PAYMENT',       -- 부분입금/지급
      'COMBINED_PAYMENT',      -- 합산지급 (1 cash → N obligations)
      'FEE_DEDUCTION',         -- 수수료 차감
      'MULTIPLE_CANDIDATES',   -- 복수 후보 (동점 아닌 경우)
      'DATE_MISMATCH',         -- 날짜 오차 > 30일
      'AMOUNT_MISMATCH',       -- 금액 오차 > 30%
      'NEW_COUNTERPARTY',      -- 미등록 거래처 고액 거래
      'UNIDENTIFIED_COUNTERPARTY', -- 거래처명 NULL
      'OVERDUE_OBLIGATION',    -- 예정일 경과 미정산
      'UNALLOCATED_CASH',      -- 입금 후 7일 이상 미배분
      'OVER_ALLOCATED',        -- SUM(allocations) > gross_amount
      'CORRECTION_REQUEST'     -- 기존 HUMAN_CONFIRMED 정정 요청
    )),

  priority                text         NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('URGENT', 'NORMAL', 'LOW')),

  case_status             text         NOT NULL DEFAULT 'PENDING'
    CHECK (case_status IN ('PENDING', 'IN_REVIEW', 'RESOLVED', 'DEFERRED')),

  -- 연결 엔티티 (obligation / cash_event 중 최소 1개 non-null)
  obligation_id           uuid         REFERENCES obligations(id),
  cash_event_id           uuid         REFERENCES cash_events(id),

  -- 제안된 allocation / adjustment (PROPOSED 상태인 것)
  proposed_allocation_id  uuid         REFERENCES match_allocations(id),
  proposed_adjustment_id  uuid         REFERENCES obligation_adjustments(id),

  summary                 text         NOT NULL,   -- 한국어 사람이 읽는 설명
  detail_json             jsonb,                   -- 수치, 후보 목록 등

  assigned_to             text,
  due_date                date,

  resolved_at             timestamptz,
  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT rq_at_least_one_entity CHECK (
    obligation_id IS NOT NULL OR cash_event_id IS NOT NULL
  )
);

-- ── 인덱스 ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rq_company_status
  ON review_queue(company_id, case_status);
CREATE INDEX IF NOT EXISTS idx_rq_priority
  ON review_queue(priority, case_status)
  WHERE case_status IN ('PENDING', 'IN_REVIEW');
CREATE INDEX IF NOT EXISTS idx_rq_obligation
  ON review_queue(obligation_id)
  WHERE obligation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rq_cash_event
  ON review_queue(cash_event_id)
  WHERE cash_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rq_type
  ON review_queue(review_type, case_status);

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS review_queue;

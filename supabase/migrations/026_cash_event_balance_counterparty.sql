-- ==========================================================
-- 026_cash_event_balance_counterparty.sql
-- v_cash_event_balance에 거래처(counterparty) 노출
--
-- 배경 (FINDING-B):
--   proposeAllocations의 자동확정 조건 VENDOR_STRONG_MATCH는 cash_event 측
--   거래처명을 obligation 거래처명과 비교하는데, cash_events 테이블(014)과
--   v_cash_event_balance 뷰(022)에 거래처 컬럼이 없어 항상 undefined →
--   vendorMatch가 항상 0.5 반환 → 자동확정이 전혀 발화하지 않았음.
--
--   거래처는 normalized_transactions(013)에 존재하므로, cash_events의
--   normalized_transaction_id로 LEFT JOIN하여 뷰에 노출한다.
--
-- 안전성:
--   - 순수 additive: 기존 출력 컬럼 순서/타입 보존 + 말미에 2개 컬럼만 추가
--     (CREATE OR REPLACE VIEW 규칙 준수)
--   - LEFT JOIN: NT가 없어도 cash_events 행은 절대 누락되지 않음
--   - 잔액/상태 계산 로직(022)은 그대로 복제, 변경 없음
--   - 파괴적 변경(DROP/데이터 삭제) 없음
--
-- Rollback:
--   022_phase2_views.sql의 v_cash_event_balance 정의를 CREATE OR REPLACE로 재실행.
-- ==========================================================

CREATE OR REPLACE VIEW v_cash_event_balance AS
SELECT
  ce.*,

  -- 확정 allocation 합계 (022와 동일)
  COALESCE(ma_agg.confirmed_allocated, 0)  AS confirmed_allocated_amount,

  -- 미배분 잔액 (022와 동일)
  ce.gross_amount
    - COALESCE(ma_agg.confirmed_allocated, 0)  AS unallocated_amount,

  -- cash_status (022와 동일)
  CASE
    WHEN COALESCE(ma_agg.confirmed_allocated, 0) = 0
                                          THEN 'UNALLOCATED'
    WHEN COALESCE(ma_agg.confirmed_allocated, 0) > ce.gross_amount
                                          THEN 'OVER_ALLOCATED'
    WHEN COALESCE(ma_agg.confirmed_allocated, 0) = ce.gross_amount
                                          THEN 'FULLY_ALLOCATED'
    ELSE                                  'PARTIALLY_ALLOCATED'
  END AS cash_status,

  -- 026 추가: 거래처 (normalized_transactions에서 파생) — 자동확정 거래처 비교용
  nt.counterparty_name        AS counterparty_name,
  nt.counterparty_business_no AS counterparty_business_no

FROM cash_events ce

LEFT JOIN (
  SELECT
    cash_event_id,
    SUM(allocated_amount) AS confirmed_allocated
  FROM match_allocations
  WHERE allocation_status IN ('AUTO_CONFIRMED', 'HUMAN_CONFIRMED')
  GROUP BY cash_event_id
) ma_agg ON ma_agg.cash_event_id = ce.id

LEFT JOIN normalized_transactions nt
  ON nt.id = ce.normalized_transaction_id;

-- ── 검증 SQL ─────────────────────────────────────────────────────────────────
-- SELECT id, counterparty_name, counterparty_business_no, cash_status
-- FROM v_cash_event_balance LIMIT 5;

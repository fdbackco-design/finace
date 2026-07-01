-- ==========================================================
-- 022_phase2_views.sql
-- Phase 2A: 잔액 계산 View
--
-- v_obligation_balance:
--   obligations + 확정 allocation 합계 + 확정 adjustment 합계
--   → remaining_amount, lifecycle_status 실시간 계산
--
-- v_cash_event_balance:
--   cash_events + 확정 allocation 합계
--   → unallocated_amount, cash_status 실시간 계산
--
-- 중요:
--   obligations / cash_events 본 테이블에는 잔액 컬럼 없음.
--   모든 잔액 조회는 이 View를 사용.
--   성능 이슈 실증 후에만 캐시 컬럼 도입 (additive, Phase 2B+)
-- ==========================================================

-- ── v_obligation_balance ────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_obligation_balance AS
SELECT
  o.*,

  -- 확정 allocation 합계 (AUTO_CONFIRMED + HUMAN_CONFIRMED만)
  COALESCE(ma_agg.confirmed_allocated, 0)  AS confirmed_allocated_amount,

  -- 확정 adjustment 합계 (HUMAN_CONFIRMED만)
  COALESCE(oa_agg.confirmed_adjusted, 0)   AS confirmed_adjusted_amount,

  -- 잔액
  o.gross_amount
    - COALESCE(ma_agg.confirmed_allocated, 0)
    - COALESCE(oa_agg.confirmed_adjusted, 0)  AS remaining_amount,

  -- lifecycle_status (terminal 상태 우선, 나머지는 잔액 기반)
  CASE
    WHEN o.is_cancelled   THEN 'CANCELLED'
    WHEN o.is_superseded  THEN 'SUPERSEDED'
    WHEN o.gross_amount
         - COALESCE(ma_agg.confirmed_allocated, 0)
         - COALESCE(oa_agg.confirmed_adjusted, 0) <= 0
                          THEN 'SETTLED'
    WHEN COALESCE(ma_agg.confirmed_allocated, 0)
         + COALESCE(oa_agg.confirmed_adjusted, 0) > 0
                          THEN 'PARTIALLY_SETTLED'
    ELSE                  'OPEN'
  END AS lifecycle_status

FROM obligations o

LEFT JOIN (
  SELECT
    obligation_id,
    SUM(allocated_amount) AS confirmed_allocated
  FROM match_allocations
  WHERE allocation_status IN ('AUTO_CONFIRMED', 'HUMAN_CONFIRMED')
  GROUP BY obligation_id
) ma_agg ON ma_agg.obligation_id = o.id

LEFT JOIN (
  SELECT
    obligation_id,
    SUM(amount) AS confirmed_adjusted
  FROM obligation_adjustments
  WHERE status = 'HUMAN_CONFIRMED'
  GROUP BY obligation_id
) oa_agg ON oa_agg.obligation_id = o.id;

-- ── v_cash_event_balance ────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_cash_event_balance AS
SELECT
  ce.*,

  -- 확정 allocation 합계
  COALESCE(ma_agg.confirmed_allocated, 0)  AS confirmed_allocated_amount,

  -- 미배분 잔액
  ce.gross_amount
    - COALESCE(ma_agg.confirmed_allocated, 0)  AS unallocated_amount,

  -- cash_status
  CASE
    WHEN COALESCE(ma_agg.confirmed_allocated, 0) = 0
                                          THEN 'UNALLOCATED'
    WHEN COALESCE(ma_agg.confirmed_allocated, 0) > ce.gross_amount
                                          THEN 'OVER_ALLOCATED'
    WHEN COALESCE(ma_agg.confirmed_allocated, 0) = ce.gross_amount
                                          THEN 'FULLY_ALLOCATED'
    ELSE                                  'PARTIALLY_ALLOCATED'
  END AS cash_status

FROM cash_events ce

LEFT JOIN (
  SELECT
    cash_event_id,
    SUM(allocated_amount) AS confirmed_allocated
  FROM match_allocations
  WHERE allocation_status IN ('AUTO_CONFIRMED', 'HUMAN_CONFIRMED')
  GROUP BY cash_event_id
) ma_agg ON ma_agg.cash_event_id = ce.id;

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP VIEW IF EXISTS v_cash_event_balance;
-- DROP VIEW IF EXISTS v_obligation_balance;

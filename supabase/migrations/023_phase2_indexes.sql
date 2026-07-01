-- ==========================================================
-- 023_phase2_indexes.sql
-- Phase 2A: 추가 성능 인덱스
--
-- 각 테이블의 기본 인덱스는 해당 테이블 마이그레이션에 포함.
-- 이 파일에는 다중 테이블 조회 패턴 최적화 인덱스만 추가.
-- ==========================================================

-- ── 자주 쓰이는 복합 조회 패턴 ────────────────────────────────────────────────

-- 1. 회사별 미결 의무 목록 (OPEN + PARTIALLY_SETTLED)
--    v_obligation_balance 조회 시 기반 필터
CREATE INDEX IF NOT EXISTS idx_obl_company_open
  ON obligations(company_id, due_date)
  WHERE is_cancelled = false AND is_superseded = false;

-- 2. 회사별 미배분 현금 이벤트
CREATE INDEX IF NOT EXISTS idx_ce_company_date_full
  ON cash_events(company_id, event_type, event_date);

-- 3. allocation engine: obligation 후보 탐색
--    (company, obligation_type, is_cancelled, is_superseded, due_date 범위)
CREATE INDEX IF NOT EXISTS idx_obl_engine_lookup
  ON obligations(company_id, obligation_type, is_cancelled, is_superseded, due_date)
  WHERE is_cancelled = false AND is_superseded = false;

-- 4. 카드 그룹 키로 의무 빠른 조회
CREATE INDEX IF NOT EXISTS idx_obl_card_group_key
  ON obligations(company_code, card_settlement_group_key)
  WHERE card_settlement_group_key IS NOT NULL;

-- 5. review_queue 대기 건수 (대시보드 요약용)
CREATE INDEX IF NOT EXISTS idx_rq_company_pending
  ON review_queue(company_id, priority, case_status)
  WHERE case_status = 'PENDING';

-- 6. match_allocations: cash_event 기준 집계 (v_cash_event_balance)
CREATE INDEX IF NOT EXISTS idx_ma_ce_agg
  ON match_allocations(cash_event_id, allocated_amount)
  WHERE allocation_status IN ('AUTO_CONFIRMED', 'HUMAN_CONFIRMED');

-- 7. match_allocations: obligation 기준 집계 (v_obligation_balance)
CREATE INDEX IF NOT EXISTS idx_ma_obl_agg
  ON match_allocations(obligation_id, allocated_amount)
  WHERE allocation_status IN ('AUTO_CONFIRMED', 'HUMAN_CONFIRMED');

-- 8. obligation_adjustments: obligation 기준 집계
CREATE INDEX IF NOT EXISTS idx_oa_obl_agg
  ON obligation_adjustments(obligation_id, amount)
  WHERE status = 'HUMAN_CONFIRMED';

-- 9. normalized_transactions: 미투영 목록 조회
CREATE INDEX IF NOT EXISTS idx_nt_company_unprojected
  ON normalized_transactions(company_id, event_type, event_date)
  WHERE is_projected = false;

-- 10. 고정비 의무: 월별 생성 여부 확인
CREATE INDEX IF NOT EXISTS idx_obl_fixed_cost_month
  ON obligations(generated_from_fixed_cost_rule_id, fixed_cost_month)
  WHERE origin_type = 'FIXED_COST_RULE';

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_obl_company_open;
-- DROP INDEX IF EXISTS idx_ce_company_date_full;
-- DROP INDEX IF EXISTS idx_obl_engine_lookup;
-- DROP INDEX IF EXISTS idx_obl_card_group_key;
-- DROP INDEX IF EXISTS idx_rq_company_pending;
-- DROP INDEX IF EXISTS idx_ma_ce_agg;
-- DROP INDEX IF EXISTS idx_ma_obl_agg;
-- DROP INDEX IF EXISTS idx_oa_obl_agg;
-- DROP INDEX IF EXISTS idx_nt_company_unprojected;
-- DROP INDEX IF EXISTS idx_obl_fixed_cost_month;

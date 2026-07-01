-- ==========================================================
-- 024_phase2_rls.sql
-- Phase 2A: Row Level Security 정책
--
-- 패턴: 기존 Phase 1 테이블과 동일
--   auth_select: authenticated / service_role 읽기
--   auth_insert: authenticated / service_role 쓰기
--   service_delete: service_role만 삭제
--   (UPDATE는 application 계층에서 제어; service_role은 RLS 우회)
--
-- WRITE_OFF 승인 제한:
--   Phase 2A: application service에서 actor_role='CEO' 검증
--   Phase 2B: RLS 레벨 강화 예정
-- ==========================================================

-- ── normalized_transactions ───────────────────────────────────────────────────
ALTER TABLE normalized_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select" ON normalized_transactions;
DROP POLICY IF EXISTS "auth_insert" ON normalized_transactions;
DROP POLICY IF EXISTS "service_delete" ON normalized_transactions;
CREATE POLICY "auth_select" ON normalized_transactions
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON normalized_transactions
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "service_delete" ON normalized_transactions
  FOR DELETE USING (auth.role() = 'service_role');

-- ── cash_events ───────────────────────────────────────────────────────────────
ALTER TABLE cash_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select" ON cash_events;
DROP POLICY IF EXISTS "auth_insert" ON cash_events;
DROP POLICY IF EXISTS "service_delete" ON cash_events;
CREATE POLICY "auth_select" ON cash_events
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON cash_events
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "service_delete" ON cash_events
  FOR DELETE USING (auth.role() = 'service_role');

-- ── obligations ───────────────────────────────────────────────────────────────
ALTER TABLE obligations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select" ON obligations;
DROP POLICY IF EXISTS "auth_insert" ON obligations;
DROP POLICY IF EXISTS "auth_update" ON obligations;
DROP POLICY IF EXISTS "service_delete" ON obligations;
CREATE POLICY "auth_select" ON obligations
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON obligations
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_update" ON obligations
  FOR UPDATE USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "service_delete" ON obligations
  FOR DELETE USING (auth.role() = 'service_role');

-- ── obligation_source_links ───────────────────────────────────────────────────
ALTER TABLE obligation_source_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select" ON obligation_source_links;
DROP POLICY IF EXISTS "auth_insert" ON obligation_source_links;
DROP POLICY IF EXISTS "service_delete" ON obligation_source_links;
CREATE POLICY "auth_select" ON obligation_source_links
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON obligation_source_links
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "service_delete" ON obligation_source_links
  FOR DELETE USING (auth.role() = 'service_role');

-- ── match_allocations ────────────────────────────────────────────────────────
ALTER TABLE match_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select" ON match_allocations;
DROP POLICY IF EXISTS "auth_insert" ON match_allocations;
DROP POLICY IF EXISTS "auth_update" ON match_allocations;
DROP POLICY IF EXISTS "service_delete" ON match_allocations;
CREATE POLICY "auth_select" ON match_allocations
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON match_allocations
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_update" ON match_allocations
  FOR UPDATE USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "service_delete" ON match_allocations
  FOR DELETE USING (auth.role() = 'service_role');

-- ── obligation_adjustments ───────────────────────────────────────────────────
ALTER TABLE obligation_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select" ON obligation_adjustments;
DROP POLICY IF EXISTS "auth_insert" ON obligation_adjustments;
DROP POLICY IF EXISTS "auth_update" ON obligation_adjustments;
DROP POLICY IF EXISTS "service_delete" ON obligation_adjustments;
CREATE POLICY "auth_select" ON obligation_adjustments
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON obligation_adjustments
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_update" ON obligation_adjustments
  FOR UPDATE USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "service_delete" ON obligation_adjustments
  FOR DELETE USING (auth.role() = 'service_role');

-- ── review_queue ─────────────────────────────────────────────────────────────
ALTER TABLE review_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select" ON review_queue;
DROP POLICY IF EXISTS "auth_insert" ON review_queue;
DROP POLICY IF EXISTS "auth_update" ON review_queue;
DROP POLICY IF EXISTS "service_delete" ON review_queue;
CREATE POLICY "auth_select" ON review_queue
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON review_queue
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_update" ON review_queue
  FOR UPDATE USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "service_delete" ON review_queue
  FOR DELETE USING (auth.role() = 'service_role');

-- ── review_decisions ─────────────────────────────────────────────────────────
-- append-only: UPDATE / DELETE 없음
ALTER TABLE review_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select" ON review_decisions;
DROP POLICY IF EXISTS "auth_insert" ON review_decisions;
CREATE POLICY "auth_select" ON review_decisions
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON review_decisions
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- ── review_decision_effects ───────────────────────────────────────────────────
-- append-only: UPDATE / DELETE 없음
ALTER TABLE review_decision_effects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select" ON review_decision_effects;
DROP POLICY IF EXISTS "auth_insert" ON review_decision_effects;
CREATE POLICY "auth_select" ON review_decision_effects
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON review_decision_effects
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- (각 테이블 DROP 시 RLS 정책도 자동 삭제됨)

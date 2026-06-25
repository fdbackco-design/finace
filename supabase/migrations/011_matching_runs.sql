-- ==========================================================
-- 011_matching_runs.sql
-- matching_runs 신규 / transaction_matches 컬럼 추가
-- ==========================================================

-- ── 1. matching_runs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matching_runs (
  id                uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 실행 범위 (SUPERSEDED 무효화 기준: company_id + target_month)
  company_id        uuid         NOT NULL REFERENCES companies(id),
  company_code      text         NOT NULL,
  target_month      text         NOT NULL,

  engine_version    text         NOT NULL DEFAULT '1.0',
  triggered_by      text         NOT NULL
    CHECK (triggered_by IN ('upload', 'manual', 'scheduled')),
  upload_session_id uuid         REFERENCES upload_sessions(id) ON DELETE SET NULL,

  status            text         NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),

  bank_count        int          NOT NULL DEFAULT 0,
  card_count        int          NOT NULL DEFAULT 0,
  ht_count          int          NOT NULL DEFAULT 0,
  auto_matched      int          NOT NULL DEFAULT 0,
  manual_review     int          NOT NULL DEFAULT 0,
  unmatched_count   int          NOT NULL DEFAULT 0,
  deleted_count     int          NOT NULL DEFAULT 0,
  created_count     int          NOT NULL DEFAULT 0,
  error_summary     jsonb,

  created_at        timestamptz  DEFAULT now(),
  completed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_mr_company_month ON matching_runs(company_id, target_month);
CREATE INDEX IF NOT EXISTS idx_mr_created       ON matching_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mr_running       ON matching_runs(status) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_mr_session       ON matching_runs(upload_session_id)
  WHERE upload_session_id IS NOT NULL;

-- ── 2. transaction_matches 컬럼 추가 ─────────────────────────────────────
-- 기존 컬럼: id, match_type, score, hometax_invoice_id, bank_transaction_id,
--            card_transaction_id, fixed_cost_id, match_reason, created_at

ALTER TABLE transaction_matches
  ADD COLUMN IF NOT EXISTS company_id       uuid     REFERENCES companies(id),
  ADD COLUMN IF NOT EXISTS matching_run_id  uuid     REFERENCES matching_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_status     text     NOT NULL DEFAULT 'AUTO_ACCEPTED'
    CHECK (match_status IN (
      'PROPOSED',
      'AUTO_ACCEPTED',
      'MANUAL_ACCEPTED',
      'REJECTED',
      'SUPERSEDED'
    )),
  ADD COLUMN IF NOT EXISTS is_active        boolean  NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_tm_company_active ON transaction_matches(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_tm_run            ON transaction_matches(matching_run_id);
CREATE INDEX IF NOT EXISTS idx_tm_active         ON transaction_matches(is_active)
  WHERE is_active = true;

-- ── 3. SUPERSEDED 처리 범위 (코드 참조용 문서) ───────────────────────────
-- runRematch(month, companyId) 호출 시:
--
--   UPDATE transaction_matches
--   SET is_active = false, match_status = 'SUPERSEDED'
--   WHERE is_active = true
--     AND company_id = :company_id
--     AND matching_run_id IN (
--       SELECT id FROM matching_runs
--       WHERE company_id = :company_id AND target_month = :month
--     );
--
-- 다른 법인 또는 다른 월의 매칭 이력은 영향받지 않음.

-- ── 4. 허용 FK 조합 (코드 참조용 문서) ──────────────────────────────────
-- match_type          | ht_id | bank_id | card_id | fixed_cost_id | step
-- HT_PURCHASE-BANK    |   O   |    O    |    X    |      X        | Step3
-- HT_PURCHASE-CARD    |   O   |    X    |    O    |      X        | Step3
-- HT_SALES-BANK       |   O   |    O    |    X    |      X        | Step4
-- FIXED_COST-BANK     |   X   |    O    |    X    |      O        | Step2
--
-- matched 미생성 step: Step1(가수금), stepSalary(급여), Step5(잔여)
-- 제약: bank_id와 card_id 동시 non-null 불가 (서비스 계층 검증, DB CHECK는 Phase 3)

-- ── 5. RLS ───────────────────────────────────────────────────────────────
ALTER TABLE matching_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select"    ON matching_runs;
DROP POLICY IF EXISTS "auth_insert"    ON matching_runs;
DROP POLICY IF EXISTS "auth_update"    ON matching_runs;
DROP POLICY IF EXISTS "service_delete" ON matching_runs;
CREATE POLICY "auth_select" ON matching_runs
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON matching_runs
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_update" ON matching_runs
  FOR UPDATE USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "service_delete" ON matching_runs
  FOR DELETE USING (auth.role() = 'service_role');

-- ── Rollback ─────────────────────────────────────────────────────────────
-- ALTER TABLE transaction_matches
--   DROP COLUMN IF EXISTS company_id,
--   DROP COLUMN IF EXISTS matching_run_id,
--   DROP COLUMN IF EXISTS match_status,
--   DROP COLUMN IF EXISTS is_active;
-- DROP TABLE IF EXISTS matching_runs;

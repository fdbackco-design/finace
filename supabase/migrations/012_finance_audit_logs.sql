-- ==========================================================
-- 012_finance_audit_logs.sql
-- 범용 시스템 감사 로그 (업로드·파싱·재매칭·설정변경)
--
-- 기존 history 테이블과 역할 분리:
--   cashflow_entry_history   : cashflow_entry 행 단위 수동 수정 이력 (기존 유지)
--   vendor_name_history      : 거래처명 수정 상세 이력 (기존 유지)
--   cashflow_groups_history  : 그룹 조작 이력 (기존 유지)
--   finance_audit_logs (신규): 시스템 이벤트 단위 감사 로그
--
-- 수동 수정 이벤트는 기존 history 테이블에만 기록.
-- 이 테이블에 중복하지 않음.
-- ==========================================================

CREATE TABLE IF NOT EXISTS finance_audit_logs (
  id            uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),

  company_id    uuid         REFERENCES companies(id),
  company_code  text,

  entity_type   text         NOT NULL
    CHECK (entity_type IN (
      'upload_session', 'source_file',
      'bank_transaction', 'card_transaction', 'hometax_invoice',
      'cashflow_entry', 'matching_run',
      'vendor', 'fixed_cost_rule', 'setting'
    )),
  entity_id     uuid,

  action_type   text         NOT NULL
    CHECK (action_type IN (
      'UPLOAD_START', 'UPLOAD_COMPLETE', 'UPLOAD_ERROR',
      'PARSE_COMPLETE', 'PARSE_PARTIAL', 'PARSE_ERROR',
      'IMPORT_COMPLETE',
      'REMATCH_START', 'REMATCH_COMPLETE', 'REMATCH_ERROR',
      'AUTO_MATCH', 'MATCH_SUPERSEDED',
      'VENDOR_REGISTER', 'VENDOR_ALIAS_ADD',
      'SETTING_CHANGE'
    )),

  before_json   jsonb,
  after_json    jsonb,
  metadata      jsonb,
  reason        text,
  actor_id      text         NOT NULL DEFAULT 'system',

  created_at    timestamptz  DEFAULT now()
);

-- append-only: UPDATE / DELETE 정책 없음
CREATE INDEX IF NOT EXISTS idx_fal_entity  ON finance_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_fal_action  ON finance_audit_logs(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fal_company ON finance_audit_logs(company_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fal_created ON finance_audit_logs(created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE finance_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select" ON finance_audit_logs;
DROP POLICY IF EXISTS "auth_insert" ON finance_audit_logs;
CREATE POLICY "auth_select" ON finance_audit_logs
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON finance_audit_logs
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- ── Rollback ─────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS finance_audit_logs;

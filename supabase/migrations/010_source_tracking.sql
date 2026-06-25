-- ==========================================================
-- 010_source_tracking.sql
-- source_files 보강 / transaction_source_links 신규 /
-- source_parse_warnings 신규 / 원천 테이블 행 추적 컬럼 추가
--
-- 적용 순서:
--   Supabase Dashboard → SQL Editor → 이 파일 실행
--   (Storage 버킷 생성은 주석 참조 — 수동 생성 필요)
-- Rollback: 파일 하단 주석 참조
-- ==========================================================

-- ── 0. Supabase Storage 버킷 ──────────────────────────────────────────────
-- private / 4MB 제한 / 브라우저 직접 접근 정책 없음
-- service_role key는 Storage RLS를 우회하므로 서버 업로드에 별도 정책 불필요
-- 향후 원본 파일 열람: 서버가 signed URL 발급 방식으로 구현 (Phase 2+)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'finance-raw', 'finance-raw', false, 4194304,
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/octet-stream'
  ]
) ON CONFLICT (id) DO NOTHING;


-- ── 1. source_files 컬럼 추가 ─────────────────────────────────────────────
-- 기존 컬럼: id, upload_session_id, company_id, company_code,
--            filename, file_type, parse_date, record_count, created_at

ALTER TABLE source_files
  ADD COLUMN IF NOT EXISTS detected_source_type  text,
  ADD COLUMN IF NOT EXISTS file_size_bytes        bigint,
  ADD COLUMN IF NOT EXISTS file_content_hash      text,
  ADD COLUMN IF NOT EXISTS storage_path           text,
  ADD COLUMN IF NOT EXISTS storage_mime_type      text,
  ADD COLUMN IF NOT EXISTS duplicate_of           uuid REFERENCES source_files(id),
  ADD COLUMN IF NOT EXISTS parser_name            text,
  ADD COLUMN IF NOT EXISTS parser_version         text        NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS header_row_number      int,
  ADD COLUMN IF NOT EXISTS default_sheet_name     text,
  ADD COLUMN IF NOT EXISTS imported_by            text        NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS imported_at            timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status                 text        NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'storage_uploaded', 'parsing',
      'importing', 'success', 'partial', 'error'
    )),
  ADD COLUMN IF NOT EXISTS parse_warning_count    int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success_row_count      int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_row_count        int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_row_count    int         NOT NULL DEFAULT 0;

-- ── 2. source_parse_warnings ──────────────────────────────────────────────
-- 정상 행의 raw_row_json 전체 저장은 Phase 2 (parsed_rows 테이블).
-- 오류 행의 원본 값은 이번 Phase 1부터 보존.

CREATE TABLE IF NOT EXISTS source_parse_warnings (
  id                 uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_file_id     uuid         NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  source_row_number  int,
  source_sheet_name  text,
  severity           text         NOT NULL
    CHECK (severity IN ('error', 'warning', 'info')),
  error_code         text,
  message            text         NOT NULL,
  raw_row_json       jsonb,
  created_at         timestamptz  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spw_file     ON source_parse_warnings(source_file_id);
CREATE INDEX IF NOT EXISTS idx_spw_severity ON source_parse_warnings(severity, source_file_id);

-- ── 3. transaction_source_links ───────────────────────────────────────────
--
-- 원칙:
--   - 원천 거래 최초 생성 시 link_type='PRIMARY' 링크 생성
--   - source_hash 충돌(동일 거래가 새 파일에 재포함) 시 link_type='DUPLICATE_SOURCE'
--   - 기존 원천 거래의 source_file_id, source_row_number는 절대 덮어쓰지 않음
--   - 향후 "이 거래가 포함된 원본 파일들" 조회:
--       SELECT sf.* FROM transaction_source_links tsl
--       JOIN source_files sf ON sf.id = tsl.source_file_id
--       WHERE tsl.bank_transaction_id = :id

CREATE TABLE IF NOT EXISTS transaction_source_links (
  id                   uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_file_id       uuid         NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  source_row_number    int,
  source_sheet_name    text,
  bank_transaction_id  uuid         REFERENCES bank_transactions(id) ON DELETE CASCADE,
  card_transaction_id  uuid         REFERENCES card_transactions(id) ON DELETE CASCADE,
  hometax_invoice_id   uuid         REFERENCES hometax_invoices(id)  ON DELETE CASCADE,
  link_type            text         NOT NULL
    CHECK (link_type IN ('PRIMARY', 'DUPLICATE_SOURCE')),
  created_at           timestamptz  DEFAULT now(),

  CONSTRAINT chk_tsl_single_entity CHECK (
    (bank_transaction_id IS NOT NULL)::int +
    (card_transaction_id IS NOT NULL)::int +
    (hometax_invoice_id  IS NOT NULL)::int = 1
  )
);

-- (파일 × 거래) 쌍 중복 방지 — idempotent upsert의 충돌 키
CREATE UNIQUE INDEX IF NOT EXISTS idx_tsl_file_bank ON transaction_source_links(source_file_id, bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tsl_file_card ON transaction_source_links(source_file_id, card_transaction_id)
  WHERE card_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tsl_file_ht   ON transaction_source_links(source_file_id, hometax_invoice_id)
  WHERE hometax_invoice_id  IS NOT NULL;

-- 거래 → 원본 파일 역조회
CREATE INDEX IF NOT EXISTS idx_tsl_bank ON transaction_source_links(bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tsl_card ON transaction_source_links(card_transaction_id)
  WHERE card_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tsl_ht   ON transaction_source_links(hometax_invoice_id)
  WHERE hometax_invoice_id  IS NOT NULL;

-- ── 4. 원천 테이블 행 추적 컬럼 ──────────────────────────────────────────
-- source_row_number: 1-based, 사용자가 Excel에서 직접 찾을 수 있는 행 번호
-- source_sheet_name: 다중 시트 대응
-- source_file_id: 최초 생성 파일 (이후 upsert 시 DO NOTHING으로 보존)

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS source_row_number  int,
  ADD COLUMN IF NOT EXISTS source_sheet_name  text;

ALTER TABLE card_transactions
  ADD COLUMN IF NOT EXISTS source_row_number  int,
  ADD COLUMN IF NOT EXISTS source_sheet_name  text;

ALTER TABLE hometax_invoices
  ADD COLUMN IF NOT EXISTS source_row_number  int,
  ADD COLUMN IF NOT EXISTS source_sheet_name  text;

-- ── 5. 인덱스 ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sf_content_hash    ON source_files(file_content_hash)
  WHERE file_content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sf_session_status  ON source_files(upload_session_id, status);
CREATE INDEX IF NOT EXISTS idx_sf_duplicate       ON source_files(duplicate_of)
  WHERE duplicate_of IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_source_file   ON bank_transactions(source_file_id)
  WHERE source_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_card_source_file   ON card_transactions(source_file_id)
  WHERE source_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ht_source_file     ON hometax_invoices(source_file_id)
  WHERE source_file_id IS NOT NULL;

-- ── 6. RLS ───────────────────────────────────────────────────────────────
-- 현재: 인증 사용자 전체 접근 (법인별 행 단위 격리 미구현 — 향후 과제)

ALTER TABLE source_parse_warnings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_source_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select" ON source_parse_warnings;
DROP POLICY IF EXISTS "auth_insert" ON source_parse_warnings;
CREATE POLICY "auth_select" ON source_parse_warnings
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON source_parse_warnings
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "auth_select" ON transaction_source_links;
DROP POLICY IF EXISTS "auth_insert" ON transaction_source_links;
CREATE POLICY "auth_select" ON transaction_source_links
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "auth_insert" ON transaction_source_links
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- ==========================================================
-- Rollback (역순 실행)
-- ==========================================================
-- DROP TABLE IF EXISTS transaction_source_links;
-- DROP TABLE IF EXISTS source_parse_warnings;
-- ALTER TABLE hometax_invoices  DROP COLUMN IF EXISTS source_row_number, DROP COLUMN IF EXISTS source_sheet_name;
-- ALTER TABLE card_transactions DROP COLUMN IF EXISTS source_row_number, DROP COLUMN IF EXISTS source_sheet_name;
-- ALTER TABLE bank_transactions DROP COLUMN IF EXISTS source_row_number, DROP COLUMN IF EXISTS source_sheet_name;
-- ALTER TABLE source_files
--   DROP COLUMN IF EXISTS detected_source_type,
--   DROP COLUMN IF EXISTS file_size_bytes,
--   DROP COLUMN IF EXISTS file_content_hash,
--   DROP COLUMN IF EXISTS storage_path,
--   DROP COLUMN IF EXISTS storage_mime_type,
--   DROP COLUMN IF EXISTS duplicate_of,
--   DROP COLUMN IF EXISTS parser_name,
--   DROP COLUMN IF EXISTS parser_version,
--   DROP COLUMN IF EXISTS header_row_number,
--   DROP COLUMN IF EXISTS default_sheet_name,
--   DROP COLUMN IF EXISTS imported_by,
--   DROP COLUMN IF EXISTS imported_at,
--   DROP COLUMN IF EXISTS status,
--   DROP COLUMN IF EXISTS parse_warning_count,
--   DROP COLUMN IF EXISTS success_row_count,
--   DROP COLUMN IF EXISTS error_row_count,
--   DROP COLUMN IF EXISTS duplicate_row_count;

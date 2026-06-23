-- ==========================================================
-- 006_vendor_representative.sql
-- vendors 테이블에 대표자명 컬럼 추가
-- ==========================================================

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS representative_name text;

CREATE INDEX IF NOT EXISTS idx_vendors_rep_name
  ON vendors(representative_name)
  WHERE representative_name IS NOT NULL;

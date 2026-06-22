-- ==========================================================
-- 004_vendors.sql
-- 거래처 관리: vendors + vendor_aliases 테이블
-- cashflow_entries 에 vendor_id, vendor_name_mapped 컬럼 추가
-- ==========================================================

-- ── 1. vendors (표준 거래처) ──────────────────────────────────────────────────
CREATE TABLE vendors (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_name  text NOT NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX idx_vendors_name ON vendors(vendor_name);

-- updated_at 자동 갱신 (fn_set_updated_at 은 001_init 에서 이미 정의됨)
CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── 2. vendor_aliases (원본명 / 사업자번호 매핑) ─────────────────────────────
CREATE TABLE vendor_aliases (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id       uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  source_name     text,           -- 카드·은행·계산서에서 들어오는 원본 상호명
  business_number text,           -- 사업자등록번호 (정규화: 숫자 10자리 또는 하이픈 형식)
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT chk_alias_has_value CHECK (source_name IS NOT NULL OR business_number IS NOT NULL)
);

CREATE INDEX idx_va_vendor_id     ON vendor_aliases(vendor_id);
CREATE INDEX idx_va_biz_no        ON vendor_aliases(business_number) WHERE business_number IS NOT NULL;
CREATE INDEX idx_va_source_name   ON vendor_aliases USING GIN (source_name gin_trgm_ops);

-- ── 3. cashflow_entries 에 거래처 매핑 컬럼 추가 ──────────────────────────────
ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS vendor_id          uuid REFERENCES vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_name_mapped text;

CREATE INDEX IF NOT EXISTS idx_cf_vendor_id     ON cashflow_entries(vendor_id)     WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cf_vendor_mapped ON cashflow_entries(vendor_name_mapped) WHERE vendor_name_mapped IS NOT NULL;

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE vendors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select" ON vendors FOR SELECT USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_insert" ON vendors FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_update" ON vendors FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "service_delete" ON vendors FOR DELETE USING (auth.role() = 'service_role');

CREATE POLICY "auth_select" ON vendor_aliases FOR SELECT USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_insert" ON vendor_aliases FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_update" ON vendor_aliases FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "service_delete" ON vendor_aliases FOR DELETE USING (auth.role() = 'service_role');

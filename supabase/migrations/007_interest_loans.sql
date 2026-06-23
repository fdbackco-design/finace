-- ==========================================================
-- 007_interest_loans.sql
-- 이자 관리: interest_loans 테이블 추가
-- cashflow_entries category 체크에 '이자' 추가
-- ==========================================================

-- ── 1. cashflow_entries category CHECK에 '이자' 추가 ──────────────────────────

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.cashflow_entries'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%category%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE cashflow_entries DROP CONSTRAINT %I', v_conname);
  END IF;
END;
$$;

ALTER TABLE cashflow_entries
  ADD CONSTRAINT cashflow_entries_category_check
  CHECK (category IN (
    '매출','매입','고정비','가수금','카드결제','카드지출',
    '급여','대출','이체','기타수입','기타지출','기타','미분류','이자'
  ));

-- ── 2. interest_loans 테이블 ──────────────────────────────────────────────────

CREATE TABLE interest_loans (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_code          text NOT NULL,
  loan_bank             text NOT NULL,           -- 대출은행
  account_number        text,                    -- 계좌번호
  financial_institution text NOT NULL,           -- 금융기관명 → cashflow vendor_name
  loan_start_date       date NOT NULL,           -- 대출기간 시작
  loan_end_date         date NOT NULL,           -- 대출기간 종료
  payment_day           int  NOT NULL CHECK (payment_day BETWEEN 1 AND 31),
  interest_amount       bigint NOT NULL CHECK (interest_amount > 0),
  memo                  text,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE INDEX idx_il_company ON interest_loans(company_code);

CREATE TRIGGER trg_il_updated_at
  BEFORE UPDATE ON interest_loans
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── 3. cashflow_entries에 interest_loan_id 참조 컬럼 추가 ─────────────────────

ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS interest_loan_id uuid REFERENCES interest_loans(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_cf_interest_loan ON cashflow_entries(interest_loan_id)
  WHERE interest_loan_id IS NOT NULL;

-- ── 4. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE interest_loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select" ON interest_loans FOR SELECT USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_insert" ON interest_loans FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "auth_update" ON interest_loans FOR UPDATE USING (auth.role() IN ('authenticated','service_role'));
CREATE POLICY "service_delete" ON interest_loans FOR DELETE USING (auth.role() = 'service_role');

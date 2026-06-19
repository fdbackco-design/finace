-- ==========================================================
-- 자금수지현황 시스템 — Supabase PostgreSQL 초기 스키마
-- Version: 2026-06-19
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ==========================================================
-- ENUM-style CHECK constraints (변경 필요 시 ALTER TABLE로 수정)
-- ==========================================================

-- ==========================================================
-- 1. companies (회사 마스터)
-- ==========================================================
CREATE TABLE companies (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         text NOT NULL UNIQUE,        -- '피드백' | '상생' | '슛문'
  company_code text NOT NULL UNIQUE,        -- 'feedback' | 'sangsaeng' | 'shootmoon'
  business_no  text,                        -- 사업자등록번호
  created_at   timestamptz DEFAULT now()
);

-- ==========================================================
-- 2. upload_sessions (파일 업로드 이력)
-- ==========================================================
CREATE TABLE upload_sessions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  upload_date       date NOT NULL DEFAULT CURRENT_DATE,
  company_id        uuid REFERENCES companies(id),
  file_type         text,                   -- BANK_IBK | CARD_WOORI | HT_PURCHASE_TAX 등
  original_filename text,
  storage_path      text,                   -- Supabase Storage 경로 (업로드 시 사용)
  status            text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending','processing','completed','error')),
  error_message     text,
  parsed_row_count  int,
  session_label     text,                   -- 'local_import_YYYYMMDD' 등
  created_at        timestamptz DEFAULT now(),
  processed_at      timestamptz DEFAULT now()
);

-- ==========================================================
-- 3. source_files (파싱 파일 추적)
-- ==========================================================
CREATE TABLE source_files (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  upload_session_id uuid REFERENCES upload_sessions(id),
  company_id        uuid REFERENCES companies(id),
  company_code      text NOT NULL,
  filename          text NOT NULL,
  file_type         text NOT NULL,
  parse_date        date DEFAULT CURRENT_DATE,
  record_count      int DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

-- ==========================================================
-- 4. bank_transactions
-- ==========================================================
CREATE TABLE bank_transactions (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_file_id       uuid REFERENCES source_files(id),
  company_id           uuid NOT NULL REFERENCES companies(id),
  company_code         text NOT NULL,
  source_type          text NOT NULL
    CHECK (source_type IN ('BANK_IBK','BANK_WOORI')),

  transaction_date     date NOT NULL,
  transaction_time     time,
  description          text,
  memo                 text,
  withdraw_amount      bigint NOT NULL DEFAULT 0,
  deposit_amount       bigint NOT NULL DEFAULT 0,
  balance              bigint,

  account_no           text,
  counter_account_no   text,
  counter_bank         text,
  counter_account_name text,
  tx_type              text,
  category_hint        text,               -- '가수금' or ''

  -- 중복 방지 (파싱 결과 hash)
  source_hash          text UNIQUE,

  created_at           timestamptz DEFAULT now()
);

CREATE INDEX idx_bank_company_date  ON bank_transactions(company_id, transaction_date);
CREATE INDEX idx_bank_withdraw      ON bank_transactions(withdraw_amount) WHERE withdraw_amount > 0;
CREATE INDEX idx_bank_deposit       ON bank_transactions(deposit_amount)  WHERE deposit_amount > 0;
CREATE INDEX idx_bank_desc          ON bank_transactions USING GIN (description gin_trgm_ops);
CREATE INDEX idx_bank_counter_name  ON bank_transactions USING GIN (counter_account_name gin_trgm_ops);

-- ==========================================================
-- 5. card_transactions
-- ==========================================================
CREATE TABLE card_transactions (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_file_id     uuid REFERENCES source_files(id),
  company_id         uuid NOT NULL REFERENCES companies(id),
  company_code       text NOT NULL,
  source_type        text NOT NULL
    CHECK (source_type IN ('CARD_IBK','CARD_WOORI')),

  used_at            timestamptz,
  used_date          date,
  merchant_name      text,
  amount             bigint NOT NULL DEFAULT 0,
  approval_number    text,
  card_no            text,
  business_no        text,
  payment_due_date   date,
  is_cancelled       boolean NOT NULL DEFAULT false,
  cancelled_amount   bigint NOT NULL DEFAULT 0,
  domestic_or_foreign text,
  sales_type         text,

  source_hash        text UNIQUE,
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX idx_card_company_date ON card_transactions(company_id, used_date);
CREATE INDEX idx_card_amount       ON card_transactions(amount) WHERE amount > 0;
CREATE INDEX idx_card_payment_due  ON card_transactions(payment_due_date);
CREATE INDEX idx_card_merchant     ON card_transactions USING GIN (merchant_name gin_trgm_ops);

-- ==========================================================
-- 6. hometax_invoices
-- ==========================================================
CREATE TABLE hometax_invoices (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_file_id         uuid REFERENCES source_files(id),
  company_id             uuid NOT NULL REFERENCES companies(id),
  company_code           text NOT NULL,
  source_type            text NOT NULL
    CHECK (source_type IN ('HT_PURCHASE_TAX','HT_PURCHASE','HT_SALES_TAX')),

  issue_date             date NOT NULL,
  approval_number        text,
  vendor_name            text,             -- G열: 공급자 상호
  customer_name          text,             -- L열: 공급받는자 상호
  vendor_business_no     text,
  item_name              text,
  total_amount           bigint NOT NULL DEFAULT 0,
  supply_amount          bigint NOT NULL DEFAULT 0,
  tax_amount             bigint NOT NULL DEFAULT 0,
  invoice_direction      text NOT NULL
    CHECK (invoice_direction IN ('purchase','sales')),
  tax_type               text NOT NULL
    CHECK (tax_type IN ('tax','exempt')),
  invoice_classification text,
  receipt_type           text,
  is_cancelled           boolean NOT NULL DEFAULT false,

  -- 자금수지현황표 거래처: 매입=vendor_name, 매출=customer_name
  counterparty           text GENERATED ALWAYS AS (
    CASE WHEN invoice_direction = 'sales' THEN customer_name ELSE vendor_name END
  ) STORED,

  source_hash            text UNIQUE,
  created_at             timestamptz DEFAULT now()
);

CREATE INDEX idx_ht_company_date  ON hometax_invoices(company_id, issue_date);
CREATE INDEX idx_ht_amount        ON hometax_invoices(total_amount);
CREATE INDEX idx_ht_direction     ON hometax_invoices(invoice_direction);
CREATE INDEX idx_ht_vendor        ON hometax_invoices USING GIN (vendor_name   gin_trgm_ops);
CREATE INDEX idx_ht_customer      ON hometax_invoices USING GIN (customer_name gin_trgm_ops);

-- ==========================================================
-- 7. fixed_cost_rules (고정비캘린더)
-- ==========================================================
CREATE TABLE fixed_cost_rules (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid REFERENCES companies(id),    -- NULL = 전체 회사
  company_code    text,                              -- 'feedback'|'sangsaeng'|'shootmoon'|'all'
  payment_day     int,                              -- 1~31 (31=말일)
  category        text NOT NULL,                    -- B열: 계정과목
  vendor_name     text NOT NULL,                    -- C열: 자금수지현황 거래처명
  amount          bigint DEFAULT 0,
  vendor_alias    text,                             -- E열: 업체명
  match_key       text,                             -- F열: 거래처정보 (매핑 키)
  account_no_str  text,                             -- K열: 입금계좌/카드번호
  payment_type    text,                             -- J열: 계좌_송금|카드_자동결제
  vat_type        text,
  is_card_bill    boolean NOT NULL DEFAULT false,   -- category='카드' → true
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_fcr_company   ON fixed_cost_rules(company_id);
CREATE INDEX idx_fcr_match_key ON fixed_cost_rules USING GIN (match_key gin_trgm_ops);

-- ==========================================================
-- 8. cashflow_entries (자금수지현황표 핵심 테이블)
-- ==========================================================
CREATE TABLE cashflow_entries (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  company_code         text NOT NULL,
  entry_date           date NOT NULL,
  vendor_name          text NOT NULL,
  category             text NOT NULL
    CHECK (category IN (
      '매출','매입','고정비','가수금','카드결제','카드지출',
      '급여','대출','이체','기타수입','기타지출','기타','미분류'
    )),
  sub_category         text,                        -- 임차료|급여|지급수수료 등 세부
  income_amount        bigint NOT NULL DEFAULT 0,
  expense_amount       bigint NOT NULL DEFAULT 0,

  -- 원천 정보
  source_type          text NOT NULL
    CHECK (source_type IN (
      'BANK_IBK','BANK_WOORI','CARD_IBK','CARD_WOORI',
      'HT_PURCHASE_TAX','HT_PURCHASE','HT_SALES_TAX',
      'FIXED_COST','MANUAL'
    )),
  payment_source_type  text
    CHECK (payment_source_type IS NULL OR payment_source_type IN (
      'BANK_IBK','BANK_WOORI','CARD_IBK','CARD_WOORI',
      'HT_PURCHASE_TAX','HT_PURCHASE','HT_SALES_TAX',
      'FIXED_COST','MANUAL'
    )),

  -- 매칭 상태
  match_status         text NOT NULL DEFAULT 'UNMATCHED'
    CHECK (match_status IN (
      'AUTO_MATCHED','MANUAL_REVIEW','UNMATCHED',
      'USER_CONFIRMED','USER_EDITED','EXCLUDED'
    )),
  match_reason         text,

  -- 연결 참조 (모두 nullable)
  hometax_invoice_id   uuid REFERENCES hometax_invoices(id)  ON DELETE SET NULL,
  bank_transaction_id  uuid REFERENCES bank_transactions(id) ON DELETE SET NULL,
  card_transaction_id  uuid REFERENCES card_transactions(id) ON DELETE SET NULL,
  fixed_cost_id        uuid REFERENCES fixed_cost_rules(id)  ON DELETE SET NULL,

  -- 기타
  raw                  jsonb,                       -- 원본 데이터 스냅샷
  memo                 text,
  is_user_edited       boolean NOT NULL DEFAULT false,

  -- 자동 계산
  year                 int GENERATED ALWAYS AS (EXTRACT(YEAR  FROM entry_date)::int) STORED,
  month                int GENERATED ALWAYS AS (EXTRACT(MONTH FROM entry_date)::int) STORED,

  -- TODO: 추후 role 기반 권한 확장 시 created_by uuid REFERENCES auth.users(id) 추가
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX idx_cf_company_ym  ON cashflow_entries(company_id, year, month);
CREATE INDEX idx_cf_date        ON cashflow_entries(entry_date);
CREATE INDEX idx_cf_status      ON cashflow_entries(match_status);
CREATE INDEX idx_cf_category    ON cashflow_entries(category);
CREATE INDEX idx_cf_vendor      ON cashflow_entries USING GIN (vendor_name gin_trgm_ops);
CREATE INDEX idx_cf_ht_id       ON cashflow_entries(hometax_invoice_id)  WHERE hometax_invoice_id  IS NOT NULL;
CREATE INDEX idx_cf_bank_id     ON cashflow_entries(bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;
CREATE INDEX idx_cf_card_id     ON cashflow_entries(card_transaction_id) WHERE card_transaction_id IS NOT NULL;

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_cf_updated_at
  BEFORE UPDATE ON cashflow_entries
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ==========================================================
-- 9. transaction_matches (매칭 결과 로그)
-- ==========================================================
CREATE TABLE transaction_matches (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_type           text NOT NULL,               -- HT_PURCHASE-BANK | HT_SALES-BANK | FIXED_COST-BANK 등
  score                numeric(5,4),
  hometax_invoice_id   uuid REFERENCES hometax_invoices(id)  ON DELETE CASCADE,
  bank_transaction_id  uuid REFERENCES bank_transactions(id) ON DELETE CASCADE,
  card_transaction_id  uuid REFERENCES card_transactions(id) ON DELETE CASCADE,
  fixed_cost_id        uuid REFERENCES fixed_cost_rules(id)  ON DELETE CASCADE,
  match_reason         text,
  created_at           timestamptz DEFAULT now()
);

CREATE INDEX idx_tm_ht_id   ON transaction_matches(hometax_invoice_id)  WHERE hometax_invoice_id  IS NOT NULL;
CREATE INDEX idx_tm_bank_id ON transaction_matches(bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;
CREATE INDEX idx_tm_card_id ON transaction_matches(card_transaction_id) WHERE card_transaction_id IS NOT NULL;

-- ==========================================================
-- 10. unmatched_items (수동 검토 대기 항목)
-- ==========================================================
CREATE TABLE unmatched_items (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_type       text NOT NULL CHECK (item_type IN ('BANK','CARD','HOMETAX')),
  company_id      uuid NOT NULL REFERENCES companies(id),
  company_code    text NOT NULL,
  source_type     text NOT NULL,
  item_date       date,
  vendor_name     text,
  amount          bigint,
  ref_id          uuid,                 -- bank_transaction.id | card_transaction.id | hometax_invoice.id
  reason          text,
  reviewed        boolean NOT NULL DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_um_company   ON unmatched_items(company_id);
CREATE INDEX idx_um_type      ON unmatched_items(item_type);
CREATE INDEX idx_um_reviewed  ON unmatched_items(reviewed) WHERE reviewed = false;

-- ==========================================================
-- 11. bank_balances (잔고 스냅샷)
-- ==========================================================
CREATE TABLE bank_balances (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  company_code text NOT NULL,
  source_type  text NOT NULL CHECK (source_type IN ('BANK_IBK','BANK_WOORI')),
  account_no   text,
  balance      bigint NOT NULL,
  as_of_date   date NOT NULL,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (company_id, source_type, as_of_date)
);

-- ==========================================================
-- 12. 집계 뷰
-- ==========================================================

-- 월별 자금수지 요약
CREATE VIEW v_monthly_cashflow AS
SELECT
  c.name         AS company_name,
  c.company_code,
  ce.year,
  ce.month,
  ce.category,
  ce.sub_category,
  SUM(ce.income_amount)  AS total_income,
  SUM(ce.expense_amount) AS total_expense,
  COUNT(*)               AS entry_count
FROM cashflow_entries ce
JOIN companies c ON c.id = ce.company_id
WHERE ce.match_status != 'EXCLUDED'
GROUP BY c.name, c.company_code, ce.year, ce.month, ce.category, ce.sub_category
ORDER BY ce.year DESC, ce.month DESC, c.name, ce.category;

-- 미매칭 은행 거래
CREATE VIEW v_unmatched_bank AS
SELECT
  bt.id,
  c.name             AS company_name,
  bt.source_type,
  bt.transaction_date,
  bt.description,
  bt.deposit_amount,
  bt.withdraw_amount,
  bt.counter_account_name,
  bt.category_hint
FROM bank_transactions bt
JOIN companies c ON c.id = bt.company_id
WHERE NOT EXISTS (
  SELECT 1 FROM cashflow_entries ce
  WHERE ce.bank_transaction_id = bt.id
)
ORDER BY bt.transaction_date DESC;

-- 미매칭 홈텍스
CREATE VIEW v_unmatched_hometax AS
SELECT
  hi.id,
  c.name        AS company_name,
  hi.source_type,
  hi.issue_date,
  hi.counterparty,
  hi.total_amount,
  hi.item_name,
  hi.is_cancelled
FROM hometax_invoices hi
JOIN companies c ON c.id = hi.company_id
WHERE NOT EXISTS (
  SELECT 1 FROM cashflow_entries ce
  WHERE ce.hometax_invoice_id = hi.id
)
ORDER BY hi.issue_date DESC;

-- ==========================================================
-- 13. Row Level Security
-- ==========================================================
ALTER TABLE companies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_files       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hometax_invoices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_cost_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashflow_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE unmatched_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_balances      ENABLE ROW LEVEL SECURITY;

-- MVP: 인증된 사용자 전체 읽기/쓰기 허용
-- TODO: 추후 role 기반으로 세분화 (admin/viewer 구분 등)
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'companies','upload_sessions','source_files',
    'bank_transactions','card_transactions','hometax_invoices',
    'fixed_cost_rules','cashflow_entries','transaction_matches',
    'unmatched_items','bank_balances'
  ] LOOP
    -- SELECT, INSERT, UPDATE: authenticated 허용
    EXECUTE format(
      'CREATE POLICY "auth_select" ON %I FOR SELECT USING (auth.role() = ''authenticated'')', tbl
    );
    EXECUTE format(
      'CREATE POLICY "auth_insert" ON %I FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', tbl
    );
    EXECUTE format(
      'CREATE POLICY "auth_update" ON %I FOR UPDATE USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')', tbl
    );
    -- DELETE: service_role 전용 (실수 방지)
    EXECUTE format(
      'CREATE POLICY "service_delete" ON %I FOR DELETE USING (auth.role() = ''service_role'')', tbl
    );
  END LOOP;
END;
$$;

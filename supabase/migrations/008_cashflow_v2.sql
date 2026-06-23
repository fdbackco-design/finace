-- ==========================================================
-- 008_cashflow_v2.sql
-- 자금수지현황 V2: 구분 드롭다운, 거래처 수정 이력, 그룹, 매칭 완료,
--                  금액 상태, 세금계산서 기준일(writtenDate) 전환
-- ==========================================================

-- ==========================================================
-- 1. cashflow_entries 컬럼 추가
-- ==========================================================

-- 1-1. 자금수지현황 표시 여부 (false = 단순 은행 입출금)
ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS show_in_cashflow boolean NOT NULL DEFAULT true;

-- 기존 BANK 원천 기타수입/지출 항목은 기본 숨김
UPDATE cashflow_entries
  SET show_in_cashflow = false
WHERE source_type IN ('BANK_IBK','BANK_WOORI')
  AND category IN ('기타수입','기타지출')
  AND match_status = 'UNMATCHED';

-- 1-2. 구분(display_category) - 사용자 노출 분류
ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS display_category      text,   -- 현재 표시값 (manual > auto)
  ADD COLUMN IF NOT EXISTS category_auto         text,   -- 자동 추천값
  ADD COLUMN IF NOT EXISTS category_manual       text,   -- 수동 수정값
  ADD COLUMN IF NOT EXISTS category_override     boolean NOT NULL DEFAULT false,  -- true=수동 수정 활성
  ADD COLUMN IF NOT EXISTS classification_basis  text;   -- 분류 근거 (고정비매칭/거래처키워드 등)

-- 1-3. 거래처명 override
ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS vendor_name_override  text;   -- 사용자 수정 거래처명 (원본 vendor_name 유지)

-- 1-4. 금액 상태 관련
ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS amount_status         text
    CHECK (amount_status IS NULL OR amount_status IN (
      '입금 예정','실제 입금','지급 예정','실제 지급',
      '미수 잔액','미지급 잔액','부분 입금','입금 완료',
      '부분 지급','지급 완료','초과 입금 검토 필요','초과 지급 검토 필요','매칭 필요'
    )),
  ADD COLUMN IF NOT EXISTS invoice_amount        bigint NOT NULL DEFAULT 0,  -- 세금계산서 총액
  ADD COLUMN IF NOT EXISTS actual_amount         bigint NOT NULL DEFAULT 0,  -- 실제 입금/지급액 (이 건)
  ADD COLUMN IF NOT EXISTS accumulated_amount    bigint NOT NULL DEFAULT 0,  -- 누적 입금/지급액
  ADD COLUMN IF NOT EXISTS remaining_amount      bigint NOT NULL DEFAULT 0,  -- 잔액 (invoice - accumulated)
  ADD COLUMN IF NOT EXISTS actual_date           date;                       -- 실제 입금일/지급일

-- 1-5. 그룹 관련 (cashflow_groups 생성 후 FK 추가)
ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS group_id     uuid,
  ADD COLUMN IF NOT EXISTS group_name   text,
  ADD COLUMN IF NOT EXISTS group_order  int  NOT NULL DEFAULT 0;

-- 1-6. 매칭 완료 처리
ALTER TABLE cashflow_entries
  ADD COLUMN IF NOT EXISTS is_completed     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by     text,
  ADD COLUMN IF NOT EXISTS completed_method text
    CHECK (completed_method IS NULL OR completed_method IN ('AUTO','MANUAL'));

-- ==========================================================
-- 2. cashflow_category_items (구분 항목 마스터)
-- ==========================================================
CREATE TABLE IF NOT EXISTS cashflow_category_items (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_value text NOT NULL UNIQUE,      -- 구분값 (예: '임차료', '급여')
  is_system      boolean NOT NULL DEFAULT false,  -- 시스템 기본 항목
  is_active      boolean NOT NULL DEFAULT true,
  sort_order     int  NOT NULL DEFAULT 999,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE TRIGGER trg_cci_updated_at
  BEFORE UPDATE ON cashflow_category_items
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 기본 구분 항목 삽입 (시스템 항목)
INSERT INTO cashflow_category_items (category_value, is_system, sort_order) VALUES
  ('지급수수료',        true,  10),
  ('복리후생비',        true,  20),
  ('급여',              true,  30),
  ('원천세',            true,  40),
  ('4대보험',           true,  50),
  ('외상매입금',        true,  60),
  ('미지급금',          true,  70),
  ('이자',              true,  80),
  ('통신비',            true,  90),
  ('임차료(손성훈)',    true, 100),
  ('임차료(신진혁)',    true, 110),
  ('관리비',            true, 120),
  ('임차료',            true, 130),
  ('정기주차권',        true, 140),
  ('리스료',            true, 150),
  ('임차료(이명진)',    true, 160),
  ('렌탈료',            true, 170),
  ('렌트료',            true, 180),
  ('기장료',            true, 190)
ON CONFLICT (category_value) DO NOTHING;

-- ==========================================================
-- 3. cashflow_groups (그룹 관리)
-- ==========================================================
CREATE TABLE IF NOT EXISTS cashflow_groups (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_name   text NOT NULL,
  company_code text NOT NULL,
  month        text NOT NULL,             -- 'YYYY-MM'
  notes        text,
  created_by   text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cg_company_month ON cashflow_groups(company_code, month);

CREATE TRIGGER trg_cg_updated_at
  BEFORE UPDATE ON cashflow_groups
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 그룹 FK 연결
ALTER TABLE cashflow_entries
  ADD CONSTRAINT fk_cf_group
    FOREIGN KEY (group_id) REFERENCES cashflow_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cf_group ON cashflow_entries(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cf_completed ON cashflow_entries(is_completed) WHERE is_completed = true;
CREATE INDEX IF NOT EXISTS idx_cf_show ON cashflow_entries(show_in_cashflow, entry_date);

-- ==========================================================
-- 4. vendor_name_history (거래처명 수정 이력)
-- ==========================================================
CREATE TABLE IF NOT EXISTS vendor_name_history (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cashflow_entry_id   uuid NOT NULL REFERENCES cashflow_entries(id) ON DELETE CASCADE,
  old_name            text NOT NULL,
  new_name            text NOT NULL,
  changed_by          text,
  changed_at          timestamptz NOT NULL DEFAULT now(),
  change_reason       text,
  change_path         text  -- 'ui_inline_edit' | 'api' | 'bulk'
);

CREATE INDEX IF NOT EXISTS idx_vnh_entry ON vendor_name_history(cashflow_entry_id);
CREATE INDEX IF NOT EXISTS idx_vnh_at    ON vendor_name_history(changed_at DESC);

-- ==========================================================
-- 5. cashflow_entry_history (범용 변경 이력)
-- ==========================================================
CREATE TABLE IF NOT EXISTS cashflow_entry_history (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cashflow_entry_id   uuid NOT NULL REFERENCES cashflow_entries(id) ON DELETE CASCADE,
  action              text NOT NULL,        -- 'VENDOR_EDIT','CATEGORY_CHANGE','COMPLETE','RESTORE','GROUP_ADD','GROUP_REMOVE'
  data_before         jsonb,
  data_after          jsonb,
  changed_by          text,
  changed_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ceh_entry ON cashflow_entry_history(cashflow_entry_id);
CREATE INDEX IF NOT EXISTS idx_ceh_at    ON cashflow_entry_history(changed_at DESC);

-- ==========================================================
-- 6. cashflow_groups_history (그룹 생성·수정·해제 이력)
-- ==========================================================
CREATE TABLE IF NOT EXISTS cashflow_groups_history (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id     uuid REFERENCES cashflow_groups(id) ON DELETE SET NULL,
  action       text NOT NULL,        -- 'CREATE','RENAME','ADD_ITEM','REMOVE_ITEM','DISSOLVE'
  group_name   text,
  entry_ids    uuid[],
  changed_by   text,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- 7. RLS 적용
-- ==========================================================
ALTER TABLE cashflow_category_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashflow_groups           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_name_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashflow_entry_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashflow_groups_history   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'cashflow_category_items','cashflow_groups',
    'vendor_name_history','cashflow_entry_history','cashflow_groups_history'
  ] LOOP
    EXECUTE format('CREATE POLICY "auth_select" ON %I FOR SELECT USING (auth.role() IN (''authenticated'',''service_role''))', tbl);
    EXECUTE format('CREATE POLICY "auth_insert" ON %I FOR INSERT WITH CHECK (auth.role() IN (''authenticated'',''service_role''))', tbl);
    EXECUTE format('CREATE POLICY "auth_update" ON %I FOR UPDATE USING (auth.role() IN (''authenticated'',''service_role''))', tbl);
    EXECUTE format('CREATE POLICY "service_delete" ON %I FOR DELETE USING (auth.role() = ''service_role'')', tbl);
  END LOOP;
END;
$$;

-- ==========================================================
-- 8. 기존 cashflow_entries 컬럼 기본값 채우기
-- ==========================================================

-- HT 매출 미매칭: '입금 예정'
UPDATE cashflow_entries SET
  amount_status   = '입금 예정',
  invoice_amount  = income_amount,
  show_in_cashflow = true
WHERE source_type = 'HT_SALES_TAX'
  AND match_status = 'UNMATCHED'
  AND amount_status IS NULL;

-- HT 매출 매칭 완료: '입금 완료'
UPDATE cashflow_entries SET
  amount_status    = '입금 완료',
  invoice_amount   = income_amount,
  actual_amount    = income_amount,
  accumulated_amount = income_amount,
  remaining_amount = 0,
  show_in_cashflow = true
WHERE source_type = 'HT_SALES_TAX'
  AND match_status IN ('AUTO_MATCHED','USER_CONFIRMED')
  AND amount_status IS NULL;

-- HT 매입: '지급 예정' (미매칭) / '지급 완료' (매칭)
UPDATE cashflow_entries SET
  amount_status   = CASE WHEN match_status IN ('AUTO_MATCHED','USER_CONFIRMED') THEN '지급 완료' ELSE '지급 예정' END,
  invoice_amount  = expense_amount,
  actual_amount   = CASE WHEN match_status IN ('AUTO_MATCHED','USER_CONFIRMED') THEN expense_amount ELSE 0 END,
  accumulated_amount = CASE WHEN match_status IN ('AUTO_MATCHED','USER_CONFIRMED') THEN expense_amount ELSE 0 END,
  remaining_amount = CASE WHEN match_status IN ('AUTO_MATCHED','USER_CONFIRMED') THEN 0 ELSE expense_amount END,
  show_in_cashflow = true
WHERE source_type IN ('HT_PURCHASE_TAX','HT_PURCHASE')
  AND amount_status IS NULL;

-- 고정비: '지급 예정' / '실제 지급'
UPDATE cashflow_entries SET
  amount_status   = CASE WHEN bank_transaction_id IS NOT NULL THEN '실제 지급' ELSE '지급 예정' END,
  show_in_cashflow = true
WHERE source_type = 'FIXED_COST'
  AND amount_status IS NULL;

-- 카드지출
UPDATE cashflow_entries SET
  amount_status   = '실제 지급',
  show_in_cashflow = true
WHERE category = '카드지출'
  AND amount_status IS NULL;

-- 가수금
UPDATE cashflow_entries SET
  amount_status   = '실제 입금',
  show_in_cashflow = true
WHERE category = '가수금'
  AND amount_status IS NULL;

-- ==========================================================
-- 9. display_category 초기값 채우기 (category 기반 매핑)
-- ==========================================================

UPDATE cashflow_entries SET
  category_auto = CASE
    WHEN sub_category ILIKE '%임차료%' AND vendor_name ILIKE '%손성훈%' THEN '임차료(손성훈)'
    WHEN sub_category ILIKE '%임차료%' AND vendor_name ILIKE '%신진혁%' THEN '임차료(신진혁)'
    WHEN sub_category ILIKE '%임차료%' AND vendor_name ILIKE '%이명진%' THEN '임차료(이명진)'
    WHEN sub_category ILIKE '%임차료%' THEN '임차료'
    WHEN sub_category ILIKE '%급여%' OR category = '급여' THEN '급여'
    WHEN sub_category ILIKE '%원천세%' THEN '원천세'
    WHEN sub_category ILIKE '%4대보험%' OR sub_category ILIKE '%보험%' THEN '4대보험'
    WHEN sub_category ILIKE '%관리비%' THEN '관리비'
    WHEN sub_category ILIKE '%이자%' OR category = '이자' THEN '이자'
    WHEN sub_category ILIKE '%리스%' THEN '리스료'
    WHEN sub_category ILIKE '%렌트%' OR sub_category ILIKE '%렌탈%' THEN '렌트료'
    WHEN sub_category ILIKE '%기장%' THEN '기장료'
    WHEN sub_category ILIKE '%주차%' THEN '정기주차권'
    WHEN sub_category ILIKE '%통신%' THEN '통신비'
    WHEN sub_category ILIKE '%지급수수료%' OR sub_category = '지급수수료' THEN '지급수수료'
    WHEN sub_category ILIKE '%복리%' OR sub_category ILIKE '%식대%' THEN '복리후생비'
    WHEN category = '매입' THEN '외상매입금'
    WHEN category = '매출' THEN NULL
    ELSE NULL
  END,
  classification_basis = CASE
    WHEN category IN ('매입','매출','고정비','급여','이자') THEN 'system_category'
    ELSE NULL
  END
WHERE category_auto IS NULL;

UPDATE cashflow_entries
  SET display_category = COALESCE(category_manual, category_auto)
WHERE display_category IS NULL;

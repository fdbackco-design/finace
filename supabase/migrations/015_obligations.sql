-- ==========================================================
-- 015_obligations.sql
-- Phase 2A: 예정 수금·지급 의무
--
-- 역할:
--   HT 계산서, 카드 결제 그룹, 고정비 규칙에서 생성되는
--   예정 의무. 실제 현금 정산 전까지 존재.
--
-- 잔액 계산 없음:
--   remaining_amount, lifecycle_status는
--   v_obligation_balance View에서 실시간 계산 (022 참조)
--
-- origin_type별 생성 경로:
--   SOURCE_TRANSACTION  : HT invoice → normalized_transaction → obligation (1:1)
--   CARD_SETTLEMENT_GROUP: card_transactions 그룹 → obligation (N:1)
--   FIXED_COST_RULE     : fixed_cost_rule → obligation (규칙 기반, NT 없음)
--   MANUAL              : 사용자 직접 생성
--
-- HT invoice 방향 → obligation_type:
--   invoice_direction='sales'    → RECEIVABLE (매출 미수금)
--   invoice_direction='purchase' → PAYABLE    (매입 미지급금)
-- ==========================================================

CREATE TABLE IF NOT EXISTS obligations (
  id                               uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id                       uuid         NOT NULL REFERENCES companies(id),
  company_code                     text         NOT NULL,

  origin_type                      text         NOT NULL
    CHECK (origin_type IN (
      'SOURCE_TRANSACTION',
      'CARD_SETTLEMENT_GROUP',
      'FIXED_COST_RULE',
      'MANUAL'
    )),
  obligation_type                  text         NOT NULL
    CHECK (obligation_type IN ('RECEIVABLE', 'PAYABLE')),
  obligation_subtype               text         NOT NULL
    CHECK (obligation_subtype IN (
      'HT_INVOICE',
      'CARD_SETTLEMENT_GROUP',
      'FIXED_COST',
      'MANUAL'
    )),

  due_date                         date,
  gross_amount                     bigint       NOT NULL CHECK (gross_amount > 0),

  -- SOURCE_TRANSACTION 시: HT invoice NT 참조
  normalized_transaction_id        uuid         REFERENCES normalized_transactions(id),

  -- FIXED_COST_RULE 시: 직접 참조 (NT 없음)
  generated_from_fixed_cost_rule_id uuid        REFERENCES fixed_cost_rules(id),
  fixed_cost_month                 text,        -- 'YYYY-MM'

  -- CARD_SETTLEMENT_GROUP 시: 그룹 키
  -- 형식: '{company_code}||{source_type}||{payment_due_date}'
  -- 예시: 'feedback||CARD_IBK||2026-07-20'
  card_settlement_group_key        text,

  -- 거래처 정보
  counterparty_name                text,
  counterparty_business_no         text,

  -- 사용자 잠금 (USER_CONFIRMED 상당: 자동 재매칭이 변경 불가)
  is_user_locked                   boolean      NOT NULL DEFAULT false,
  locked_by                        text,
  locked_at                        timestamptz,

  -- 취소 (terminal state — 명시적 설정)
  is_cancelled                     boolean      NOT NULL DEFAULT false,
  cancelled_at                     timestamptz,
  cancelled_reason                 text,

  -- 대체 (terminal state — 재매칭/재업로드로 대체됨)
  is_superseded                    boolean      NOT NULL DEFAULT false,
  superseded_at                    timestamptz,

  created_at                       timestamptz  NOT NULL DEFAULT now(),
  updated_at                       timestamptz  NOT NULL DEFAULT now(),

  -- HT invoice는 NT와 1:1
  CONSTRAINT obl_nt_unique UNIQUE (normalized_transaction_id),

  -- 카드 그룹 의무는 그룹 키당 1개 (ACTIVE 상태)
  CONSTRAINT obl_card_group_unique UNIQUE (card_settlement_group_key)
    DEFERRABLE INITIALLY DEFERRED,

  -- 고정비는 회사+규칙+월 조합 1개
  CONSTRAINT obl_fixed_cost_unique UNIQUE (generated_from_fixed_cost_rule_id, fixed_cost_month)
);

-- CARD_SETTLEMENT_GROUP 유효성: 해당 컬럼 있으면 그룹 키 필수
ALTER TABLE obligations ADD CONSTRAINT obl_card_group_key_required
  CHECK (
    origin_type != 'CARD_SETTLEMENT_GROUP'
    OR card_settlement_group_key IS NOT NULL
  );

-- FIXED_COST_RULE 유효성
ALTER TABLE obligations ADD CONSTRAINT obl_fixed_cost_rule_required
  CHECK (
    origin_type != 'FIXED_COST_RULE'
    OR (generated_from_fixed_cost_rule_id IS NOT NULL AND fixed_cost_month IS NOT NULL)
  );

-- ── 인덱스 ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_obl_company_due
  ON obligations(company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_obl_origin_type
  ON obligations(origin_type);
CREATE INDEX IF NOT EXISTS idx_obl_obligation_type
  ON obligations(obligation_type);
CREATE INDEX IF NOT EXISTS idx_obl_active
  ON obligations(company_id, is_cancelled, is_superseded, due_date)
  WHERE is_cancelled = false AND is_superseded = false;
CREATE INDEX IF NOT EXISTS idx_obl_counterparty
  ON obligations USING GIN (counterparty_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_obl_card_group
  ON obligations(card_settlement_group_key)
  WHERE card_settlement_group_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obl_fixed_cost_rule
  ON obligations(generated_from_fixed_cost_rule_id)
  WHERE generated_from_fixed_cost_rule_id IS NOT NULL;

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS obligations;

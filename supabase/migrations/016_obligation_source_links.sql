-- ==========================================================
-- 016_obligation_source_links.sql
-- Phase 2A: obligation과 원천 거래 간 다중 연결
--
-- 역할:
--   HT invoice obligation → 1 link (HT_INVOICE_SOURCE)
--   CARD_SETTLEMENT_GROUP obligation → N links (CARD_COMPONENT)
--   FIXED_COST_RULE obligation → 1 link (FIXED_COST_SOURCE)
--
-- contributing_amount:
--   CARD_COMPONENT: 이 카드 거래가 그룹 합계에 기여하는 금액
--   HT/FIXED_COST: obligation.gross_amount와 동일
-- ==========================================================

CREATE TABLE IF NOT EXISTS obligation_source_links (
  id                      uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  obligation_id           uuid         NOT NULL REFERENCES obligations(id),

  link_type               text         NOT NULL
    CHECK (link_type IN (
      'HT_INVOICE_SOURCE',
      'CARD_COMPONENT',
      'FIXED_COST_SOURCE'
    )),

  -- Source FK (link_type에 따라 1개만 non-null)
  normalized_transaction_id uuid        REFERENCES normalized_transactions(id),
  card_transaction_id       uuid        REFERENCES card_transactions(id),
  hometax_invoice_id        uuid        REFERENCES hometax_invoices(id),
  fixed_cost_rule_id        uuid        REFERENCES fixed_cost_rules(id),

  contributing_amount     bigint       NOT NULL CHECK (contributing_amount > 0),

  created_at              timestamptz  NOT NULL DEFAULT now(),

  -- HT obligation: NT와 중복 등록 방지
  CONSTRAINT osl_ht_nt_unique UNIQUE (obligation_id, normalized_transaction_id),
  -- 카드 컴포넌트: 동일 카드 거래를 동일 obligation에 중복 연결 방지
  CONSTRAINT osl_card_unique UNIQUE (obligation_id, card_transaction_id)
);

-- ── 인덱스 ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_osl_obligation
  ON obligation_source_links(obligation_id);
CREATE INDEX IF NOT EXISTS idx_osl_card_tx
  ON obligation_source_links(card_transaction_id)
  WHERE card_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_osl_ht_invoice
  ON obligation_source_links(hometax_invoice_id)
  WHERE hometax_invoice_id IS NOT NULL;

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS obligation_source_links;

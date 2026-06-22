-- ==========================================================
-- 003_fix_card_settlement.sql
-- 카드 결제일 통일: 전월 6일 ~ 당월 5일 사용 → 당월 20일 결제
-- 우리카드·기업카드 모두 동일 기준 적용
-- Supabase Dashboard → SQL Editor 에서 실행
-- ==========================================================

-- Step 1: card_transactions.payment_due_date 재계산
--   사용일 1~5일 → 당월 20일
--   사용일 6~31일 → 익월 20일
UPDATE card_transactions
SET payment_due_date = CASE
  WHEN EXTRACT(DAY FROM used_date::date) <= 5 THEN
    (DATE_TRUNC('month', used_date::date) + INTERVAL '19 days')::date
  ELSE
    (DATE_TRUNC('month', used_date::date) + INTERVAL '1 month' + INTERVAL '19 days')::date
  END
WHERE source_type IN ('CARD_IBK', 'CARD_WOORI')
  AND used_date IS NOT NULL;

-- Step 2: cashflow_entries.entry_date 를 card_transactions.payment_due_date 기준으로 수정
UPDATE cashflow_entries ce
SET entry_date = ct.payment_due_date
FROM card_transactions ct
WHERE ce.card_transaction_id = ct.id
  AND ce.category = '카드지출'
  AND ct.payment_due_date IS NOT NULL;

-- ==========================================================
-- 검증 쿼리 (실행 후 확인)
-- ==========================================================
-- SELECT
--   ce.entry_date,
--   ce.source_type,
--   COUNT(*) AS cnt,
--   SUM(ce.expense_amount) AS total
-- FROM cashflow_entries ce
-- WHERE ce.category = '카드지출'
-- GROUP BY ce.entry_date, ce.source_type
-- ORDER BY ce.entry_date, ce.source_type;

-- ==========================================================
-- 009_bank_show_in_cashflow.sql
-- 은행 원천 미매칭 항목을 자금수지현황에 표시
-- (008에서 숨겼던 은행 기타수입/기타지출 복원)
-- ==========================================================

UPDATE cashflow_entries
  SET show_in_cashflow = true
WHERE source_type IN ('BANK_IBK', 'BANK_WOORI')
  AND category    IN ('기타수입', '기타지출')
  AND match_status = 'UNMATCHED';

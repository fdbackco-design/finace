-- ==========================================================
-- 002_card_classification.sql
-- card_transactions 테이블에 카드 분류 컬럼 추가
-- Supabase Dashboard → SQL Editor에서 실행
-- ==========================================================

ALTER TABLE card_transactions
  ADD COLUMN IF NOT EXISTS card_provider text NULL,   -- '우리카드' | '기업카드'
  ADD COLUMN IF NOT EXISTS card_label    text NULL;   -- '상생 우리카드' | '상생 기업카드' | '피드백 우리카드' | '피드백 기업카드'

-- 인덱스: 카드 라벨 기준 조회 최적화
CREATE INDEX IF NOT EXISTS idx_card_label
  ON card_transactions (card_label)
  WHERE card_label IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_card_provider
  ON card_transactions (company_id, card_provider)
  WHERE card_provider IS NOT NULL;

-- ==========================================================
-- 기존 데이터 백필 (card_no 기반 자동 분류)
-- ==========================================================

-- 기업카드(CARD_IBK) 백필
UPDATE card_transactions
SET
  card_provider = '기업카드',
  card_label    = '피드백 기업카드'
WHERE source_type = 'CARD_IBK'
  AND card_no LIKE '%-6904'
  AND card_label IS NULL;

UPDATE card_transactions
SET
  card_provider = '기업카드',
  card_label    = '상생 기업카드'
WHERE source_type = 'CARD_IBK'
  AND (card_no LIKE '%-7979' OR card_no LIKE '%-7969')
  AND card_label IS NULL;

-- 우리카드(CARD_WOORI) 백필
UPDATE card_transactions
SET
  card_provider = '우리카드',
  card_label    = '피드백 우리카드'
WHERE source_type = 'CARD_WOORI'
  AND card_no LIKE '%-9727'
  AND card_label IS NULL;

UPDATE card_transactions
SET
  card_provider = '우리카드',
  card_label    = '상생 우리카드'
WHERE source_type = 'CARD_WOORI'
  AND card_no LIKE '%-6313'
  AND card_label IS NULL;

-- ==========================================================
-- 백필 결과 검증 쿼리 (실행 후 확인용)
-- ==========================================================
-- SELECT
--   card_label,
--   count(*) AS cnt,
--   sum(amount) AS total_amount
-- FROM card_transactions
-- WHERE NOT is_cancelled
-- GROUP BY card_label
-- ORDER BY card_label;

-- 홈택스 A열(작성일자) / C열(발급일자) 분리
-- issue_date = C열 발급일자 (자금수지·매칭 기준), written_date = A열 작성일자

ALTER TABLE hometax_invoices
  ADD COLUMN IF NOT EXISTS written_date date;

COMMENT ON COLUMN hometax_invoices.issue_date   IS 'C열 발급일자 — 자금수지·매칭 기준';
COMMENT ON COLUMN hometax_invoices.written_date IS 'A열 작성일자';

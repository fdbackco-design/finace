/** 홈택스 계산서 행에서 A열(작성일자)·C열(발급일자) 파싱 */
export function parseDateCell(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().substring(0, 10);
  }
  const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

export function parseHometaxRowDates(row: unknown[]): { writtenDate: string; issuedDate: string } {
  const writtenDate = parseDateCell(row[0]);
  const issuedRaw   = parseDateCell(row[2]);
  const issuedDate  = issuedRaw || writtenDate;
  return { writtenDate, issuedDate };
}

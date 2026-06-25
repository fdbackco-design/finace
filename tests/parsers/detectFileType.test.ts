import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseUploadedFile } from '../../src/lib/upload/parseUploadedFile';

// 최소 헤더 행으로 워크북 버퍼를 생성하는 헬퍼
function makeXlsxBuffer(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ── BANK_WOORI 감지 ─────────────────────────────────────────────────────────
describe('파일 타입 감지 - BANK_WOORI', () => {
  it('거래일시 + 입금금액 + 출금금액 헤더를 BANK_WOORI로 감지', () => {
    const rows = [
      ['번호', '거래일시', '적요', '기재내용', '출금금액', '입금금액', '거래후잔액', '취급점', '메모'],
    ];
    const buf = makeXlsxBuffer(rows);
    const result = parseUploadedFile(buf, '우리은행_test.xlsx', null, null);
    expect(result.sourceType).toBe('BANK_WOORI');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

// ── BANK_IBK 감지 ───────────────────────────────────────────────────────────
describe('파일 타입 감지 - BANK_IBK', () => {
  it('파일명에 거래내역조회가 있으면 BANK_IBK로 감지', () => {
    const rows = [[''], ['계좌번호:123-456 현재잔액:0원'], [''], ['번호', '거래일시', '출금액', '입금액', '잔액', '거래내용']];
    const buf = makeXlsxBuffer(rows);
    const result = parseUploadedFile(buf, '거래내역조회_test.xlsx', null, null);
    expect(result.sourceType).toBe('BANK_IBK');
  });
});

// ── 미감지 파일 ────────────────────────────────────────────────────────────
describe('파일 타입 감지 - 미감지', () => {
  it('관련 없는 헤더는 needsManual=true 반환', () => {
    const buf = makeXlsxBuffer([['Name', 'Value', 'Other']]);
    const result = parseUploadedFile(buf, 'random.xlsx', null, null);
    expect(result.needsManual).toBe(true);
  });
});

// ── BANK_WOORI vs BANK_IBK 우선순위 ────────────────────────────────────────
describe('파일 타입 감지 - BANK_WOORI before BANK_IBK (substring 안전성)', () => {
  it('"입금금액" (WOORI 형식)이 있으면 BANK_IBK로 오감지하지 않음', () => {
    // WOORI: "입금금액" (long form), IBK: "입금액" (short form — substring of 입금금액)
    // BANK_WOORI 판정이 먼저 돼야 올바름
    const rows = [['번호', '거래일시', '적요', '기재내용', '출금금액', '입금금액', '거래후잔액']];
    const buf = makeXlsxBuffer(rows);
    const result = parseUploadedFile(buf, '우리test.xlsx', null, null);
    expect(result.sourceType).not.toBe('BANK_IBK');
  });
});

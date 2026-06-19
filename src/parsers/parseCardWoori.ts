import * as XLSX from 'xlsx';
import { CardTransaction, CompanyCode, ParsedFileResult, ParseError } from '../lib/types';

function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[,\s원]/g, ''), 10);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

// "2026.06.06 ~ 2026.06.19" → 2026
function extractYear(periodStr: string): number {
  const m = String(periodStr ?? '').match(/(\d{4})\./);
  return m ? parseInt(m[1]) : new Date().getFullYear();
}

// "06.18 13:49" + year → "2026-06-18T13:49:00"
function parseWooriDate(dateStr: string, year: number): string {
  if (!dateStr || !/^\d{2}\.\d{2}/.test(dateStr.trim())) return '';
  const [datePart = '', timePart = '00:00'] = dateStr.trim().split(' ');
  const [month = '01', day = '01'] = datePart.split('.');
  const timeFull = `${timePart}:00`.split(':').slice(0, 3).join(':');
  return `${year}-${month}-${day}T${timeFull}`;
}

// Next month's payment date from period end string
function calcPaymentDueDate(periodStr: string, payDay: number): string {
  // "2026.06.06 ~ 2026.06.19" → take end date
  const endPart = String(periodStr ?? '').split('~')[1]?.trim() ?? '';
  const m = endPart.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  if (!m) return '';
  let [, y, mo] = m;
  let nextMo = parseInt(mo) + 1;
  let nextY  = parseInt(y);
  if (nextMo > 12) { nextMo = 1; nextY++; }
  return `${nextY}-${String(nextMo).padStart(2, '0')}-${String(payDay).padStart(2, '0')}`;
}

export function parseCardWoori(
  buffer: Buffer,
  company: CompanyCode,
  filename: string,
  payDay: number = 20
): ParsedFileResult<CardTransaction> {
  const wb  = XLSX.read(buffer, { type: 'buffer', raw: false });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

  // R3 (idx 2) B열: 이용기간 "YYYY.MM.DD ~ YYYY.MM.DD"
  const periodStr     = String(aoa[2]?.[1] ?? '');
  const year          = extractYear(periodStr);
  const paymentDueDate = calcPaymentDueDate(periodStr, payDay);

  // Format detection: header at R19 (idx 18)
  // idx9 contains '사업자' → Format A (피드백), else Format B (상생)
  const headerRow = (aoa[18] ?? []) as unknown[];
  const isFormatA = String(headerRow[9] ?? '').includes('사업자');

  const records: CardTransaction[] = [];
  const errors:  ParseError[]      = [];

  // Data starts at idx 19 (R20)
  for (let i = 19; i < aoa.length; i++) {
    const row = aoa[i];
    // idx 0 must look like a date "MM.DD HH:mm"
    const dateStr = String(row[0] ?? '').trim();
    if (!/^\d{2}\.\d{2}/.test(dateStr)) continue;

    try {
      let merchantName:     string;
      let approvalNumber:   string;
      let cardLast4:        string;
      let businessNo:       string;
      let salesType:        string;
      let amount:           number;
      let status:           string;
      let domesticOrForeign: string;

      if (isFormatA) {
        // 피드백 포맷: 가맹점 idx5, 금액 idx16
        approvalNumber   = String(row[2] ?? '');
        cardLast4        = String(row[3] ?? '');
        merchantName     = String(row[5] ?? '');
        businessNo       = String(row[9] ?? '');
        salesType        = String(row[12] ?? '');
        amount           = parseAmount(row[16]);
        status           = String(row[18] ?? '');
        domesticOrForeign = '국내'; // 피드백 포맷은 국내/해외 구분 컬럼 없음
      } else {
        // 상생 포맷: 가맹점 idx7, 금액 idx15
        domesticOrForeign = String(row[2] ?? '');
        approvalNumber    = String(row[3] ?? '');
        cardLast4         = String(row[5] ?? '');
        merchantName      = String(row[7] ?? '');
        salesType         = String(row[11] ?? '');
        amount            = parseAmount(row[15]);
        status            = String(row[18] ?? '');
        businessNo        = '';
      }

      const isCancelled    = status === '취소';
      const cancelledAmount = isCancelled ? amount : 0;
      const usedAt         = parseWooriDate(dateStr, year);
      const cardNo         = cardLast4 ? `****-****-****-${cardLast4}` : '';

      records.push({
        company,
        sourceType: 'CARD_WOORI',
        usedAt,
        merchantName,
        amount,
        approvalNumber,
        cardNo,
        businessNo,
        paymentDueDate,
        isCancelled,
        cancelledAmount,
        domesticOrForeign,
        salesType,
      });
    } catch (e) {
      errors.push({ file: filename, rowIndex: i, message: String(e), rawData: row as unknown[] });
    }
  }

  return {
    company,
    sourceType: 'CARD_WOORI',
    filename,
    records,
    errors,
    meta: { year, periodStr, paymentDueDate, format: isFormatA ? 'A_feedback' : 'B_sangsaeng' },
  };
}

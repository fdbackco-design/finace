import * as XLSX from 'xlsx';
import { CardTransaction, CompanyCode, ParsedFileResult, ParseError } from '../lib/types';
import { classifyCard } from '../lib/cards/classifyCard';
import { calcCardPaymentDueDate } from '../lib/cards/settlement';

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

export function parseCardWoori(
  buffer: Buffer,
  company: CompanyCode,
  filename: string
): ParsedFileResult<CardTransaction> {
  const wb        = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheetName = wb.SheetNames[0];
  const ws        = wb.Sheets[sheetName];
  const aoa       = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

  // R3 (idx 2) B열: 이용기간 — 연도 추출에만 사용 (결제일은 사용일 기준으로 계산)
  const periodStr = String(aoa[2]?.[1] ?? '');
  const year      = extractYear(periodStr);

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

      const isCancelled     = status === '취소';
      const cancelledAmount = isCancelled ? amount : 0;
      const usedAt          = parseWooriDate(dateStr, year);
      const cardNo          = cardLast4 ? `****-****-****-${cardLast4}` : '';

      const usedDate = usedAt.substring(0, 10);

      // 이용카드 식별값(cardLast4)으로 분류: 9727=피드백, 6313=상생
      const classification = classifyCard({ source: 'CARD_WOORI', cardRef: cardLast4, cardNo });

      // 카드번호(9727/6313) 기준 회사 결정: 파일명 파라미터보다 우선 적용
      const effectiveCompany: CompanyCode =
        classification?.companyName === '피드백' ? 'feedback'  :
        classification?.companyName === '상생'   ? 'sangsaeng' :
        company;

      // 결제일: 카드별 납부일/마감일 기준 계산
      const cardKey        = `${effectiveCompany}:CARD_WOORI`;
      const paymentDueDate = usedDate ? calcCardPaymentDueDate(usedDate, cardKey) : '';

      records.push({
        company: effectiveCompany,
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
        cardProvider:    classification?.cardProvider ?? null,
        cardLabel:       classification?.cardLabel    ?? null,
        sourceRowNumber: i + 1,
        sourceSheetName: sheetName,
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
    meta: { year, periodStr, format: isFormatA ? 'A_feedback' : 'B_sangsaeng' },
  };
}

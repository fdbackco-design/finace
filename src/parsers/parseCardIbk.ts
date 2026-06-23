import * as XLSX from 'xlsx';
import { CardTransaction, CompanyCode, ParsedFileResult, ParseError } from '../lib/types';
import { classifyCard } from '../lib/cards/classifyCard';
import { calcCardPaymentDueDate } from '../lib/cards/settlement';

function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string') return parseInt(v.replace(/[,\s원]/g, ''), 10) || 0;
  return 0;
}

export function parseCardIbk(
  buffer: Buffer,
  company: CompanyCode,
  filename: string
): ParsedFileResult<CardTransaction> {
  const wb  = XLSX.read(buffer, { type: 'buffer', raw: false });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

  const records: CardTransaction[] = [];
  const errors:  ParseError[]      = [];

  // Data starts at idx 3 (R4). Skip rows where A is not a positive integer (합계행 포함).
  for (let i = 3; i < aoa.length; i++) {
    const row = aoa[i];
    if (typeof row[0] !== 'number' || row[0] <= 0) continue;

    try {
      const approvalType = String(row[1] ?? '');
      const isCancelled  = approvalType === '취소또는할인';

      // "2026-06-19 12:36:48" → ISO
      const dtStr  = String(row[3] ?? '');
      const [dp = '', tp = ''] = dtStr.split(' ');
      const usedAt = tp ? `${dp}T${tp}` : dp;

      const cardNo      = String(row[4] ?? '');
      const merchantName = String(row[6] ?? '');
      const amount       = parseAmount(row[7]);
      const approvalNumber  = String(row[14] ?? '');
      const cancelledAmount = parseAmount(row[17]);

      const businessNo = String(row[21] ?? '');
      const usageType  = String(row[2] ?? '');
      const domesticOrForeign = usageType.includes('해외') ? '해외' : '국내';

      const classification = classifyCard({ source: 'CARD_IBK', cardNo });

      // 결제일: 카드별 납부일/마감일 기준 계산
      const cardKey        = `${company}:CARD_IBK`;
      const paymentDueDate = dp ? calcCardPaymentDueDate(dp, cardKey) : '';

      records.push({
        company,
        sourceType: 'CARD_IBK',
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
        salesType: String(row[10] ?? ''),
        cardProvider: classification?.cardProvider ?? null,
        cardLabel:    classification?.cardLabel    ?? null,
      });
    } catch (e) {
      errors.push({ file: filename, rowIndex: i, message: String(e), rawData: row as unknown[] });
    }
  }

  return { company, sourceType: 'CARD_IBK', filename, records, errors, meta: {} };
}

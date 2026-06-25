import * as XLSX from 'xlsx';
import { BankTransaction, CompanyCode, ParsedFileResult, ParseError } from '../lib/types';

function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string') return parseInt(v.replace(/[,\s원]/g, ''), 10) || 0;
  return 0;
}

function extractMeta(s: string): { accountNo: string; balance: number } {
  const acctMatch = s.match(/계좌번호:([0-9\-]+)/);
  const balMatch  = s.match(/현재잔액:([\d,]+)원/);
  return {
    accountNo: acctMatch?.[1] ?? '',
    balance:   balMatch ? parseAmount(balMatch[1]) : 0,
  };
}

export function parseBankIbk(
  buffer: Buffer,
  company: CompanyCode,
  filename: string
): ParsedFileResult<BankTransaction> {
  const wb        = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheetName = wb.SheetNames[0];
  const ws        = wb.Sheets[sheetName];
  const aoa       = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

  const metaStr = String(aoa[1]?.[0] ?? '');
  const { accountNo, balance: currentBalance } = extractMeta(metaStr);

  const records: BankTransaction[] = [];
  const errors:  ParseError[]      = [];

  // Data starts at idx 3 (R4). Skip rows whose A-column is not a positive integer.
  for (let i = 3; i < aoa.length; i++) {
    const row = aoa[i];
    if (typeof row[0] !== 'number' || row[0] <= 0) continue;

    try {
      const dtStr          = String(row[1] ?? '');
      const [rawDate = '', time = ''] = dtStr.split(' ');
      const date = rawDate.replace(/\./g, '-'); // "2026.06.10" → "2026-06-10"
      const withdrawAmount = parseAmount(row[2]);
      const depositAmount  = parseAmount(row[3]);
      const balance        = parseAmount(row[4]);
      const description    = String(row[5] ?? '');
      const counterAcctNo  = String(row[6] ?? '');
      const counterBank    = String(row[7] ?? '');
      const memo           = String(row[8] ?? '');
      const txType         = String(row[9] ?? '');
      const counterName    = String(row[12] ?? '');

      // 가수금: 피드백 전용, 입금이고 거래내용에 '송해민' 포함
      let categoryHint = '';
      if (
        company === 'feedback' &&
        depositAmount > 0 &&
        description.includes('송해민')
      ) {
        categoryHint = '가수금';
      }

      records.push({
        company,
        sourceType: 'BANK_IBK',
        transactionDate:   date,
        transactionTime:   time,
        description,
        memo,
        withdrawAmount,
        depositAmount,
        balance,
        accountNo,
        counterAccountNo:   counterAcctNo,
        counterBank,
        counterAccountName: counterName,
        txType,
        categoryHint,
        sourceRowNumber:  i + 1,
        sourceSheetName:  sheetName,
      });
    } catch (e) {
      errors.push({ file: filename, rowIndex: i, message: String(e), rawData: row as unknown[] });
    }
  }

  return { company, sourceType: 'BANK_IBK', filename, records, errors, meta: { accountNo, currentBalance } };
}

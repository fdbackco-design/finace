import * as XLSX from 'xlsx';
import { BankTransaction, CompanyCode, ParsedFileResult, ParseError } from '../lib/types';

function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string') return parseInt(v.replace(/[,\s원]/g, ''), 10) || 0;
  return 0;
}

export function parseBankWoori(
  buffer: Buffer,
  company: CompanyCode,
  filename: string
): ParsedFileResult<BankTransaction> {
  const wb  = XLSX.read(buffer, { type: 'buffer', raw: false });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

  // R2 (idx1): 계좌번호 및 예금주 (모든 셀 동일 내용)
  const meta1Str  = String(aoa[1]?.[0] ?? '');
  const acctMatch = meta1Str.match(/계좌번호 : (\d+)/);
  const accountNo = acctMatch?.[1] ?? '';

  const records: BankTransaction[] = [];
  const errors:  ParseError[]      = [];
  let   lastBalance = 0;

  // Data starts at idx 4 (R5). Skip rows whose A-column is not a positive integer.
  for (let i = 4; i < aoa.length; i++) {
    const row = aoa[i];
    if (typeof row[0] !== 'number' || row[0] <= 0) continue;

    try {
      // "2026.06.10 13:11:20" → date "2026-06-10", time "13:11:20"
      const dtStr = String(row[1] ?? '');
      const [rawDate = '', time = ''] = dtStr.split(' ');
      const date = rawDate.replace(/\./g, '-');

      const description    = String(row[2] ?? '');  // 적요
      const memoContent    = String(row[3] ?? '');  // 기재내용
      const withdrawAmount = parseAmount(row[4]);
      const depositAmount  = parseAmount(row[5]);
      const balance        = parseAmount(row[6]);
      const branch         = String(row[7] ?? '');
      const memo           = String(row[8] ?? '');

      lastBalance = balance;

      records.push({
        company,
        sourceType: 'BANK_WOORI',
        transactionDate:    date,
        transactionTime:    time,
        description,
        memo: [memoContent, memo].filter(Boolean).join(' | '),
        withdrawAmount,
        depositAmount,
        balance,
        accountNo,
        counterAccountNo:   '',
        counterBank:        '',
        counterAccountName: '',
        txType:             branch,
        categoryHint:       '',
      });
    } catch (e) {
      errors.push({ file: filename, rowIndex: i, message: String(e), rawData: row as unknown[] });
    }
  }

  return { company, sourceType: 'BANK_WOORI', filename, records, errors, meta: { accountNo, lastBalance } };
}

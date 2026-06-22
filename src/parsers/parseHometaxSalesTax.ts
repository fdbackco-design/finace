import * as XLSX from 'xlsx';
import { HometaxInvoice, CompanyCode, ParsedFileResult, ParseError } from '../lib/types';
import { parseHometaxRowDates } from './hometaxDateUtils';

function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string') return parseInt(v.replace(/[,\s원]/g, ''), 10) || 0;
  return 0;
}

// 매출 세금계산서: 컬럼 구조는 HT_PURCHASE_TAX와 동일.
// G(idx6)=우리 회사(공급자), L(idx11)=거래처(공급받는자) → 매출처.
export function parseHometaxSalesTax(
  buffer: Buffer,
  company: CompanyCode,
  filename: string
): ParsedFileResult<HometaxInvoice> {
  const wb  = XLSX.read(buffer, { type: 'buffer', raw: false });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

  const records: HometaxInvoice[] = [];
  const errors:  ParseError[]     = [];

  for (let i = 6; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row[0] || !/^\d{4}-\d{2}-\d{2}/.test(String(row[0]))) continue;

    try {
      const { writtenDate, issuedDate } = parseHometaxRowDates(row);
      const approvalNumber   = String(row[1] ?? '');
      const vendorBusinessNo = String(row[4] ?? '');
      const vendorName       = String(row[6] ?? '');  // G열: 우리 회사 (참고용)
      const customerName     = String(row[11] ?? ''); // L열: 거래처 (실질 매출처)
      const rawTotal         = typeof row[14] === 'number' ? row[14] : parseAmount(row[14]);
      const supplyAmount     = parseAmount(row[15]);
      const taxAmount        = parseAmount(row[16]);
      const invoiceClass     = String(row[17] ?? '');
      const receiptType      = String(row[21] ?? '');
      const itemName         = String(row[28] ?? ''); // AC열: 품목명

      const isCancelled = rawTotal < 0;
      const totalAmount = Math.abs(rawTotal);

      records.push({
        company,
        sourceType: 'HT_SALES_TAX',
        writtenDate,
        issuedDate,
        approvalNumber,
        vendorName,
        customerName,
        itemName,
        totalAmount,
        supplyAmount: Math.abs(supplyAmount),
        taxAmount:    Math.abs(taxAmount),
        invoiceDirection:     'sales',
        taxType:              'tax',
        invoiceClassification: invoiceClass,
        receiptType,
        isCancelled,
        vendorBusinessNo,
      });
    } catch (e) {
      errors.push({ file: filename, rowIndex: i, message: String(e), rawData: row as unknown[] });
    }
  }

  return { company, sourceType: 'HT_SALES_TAX', filename, records, errors, meta: {} };
}

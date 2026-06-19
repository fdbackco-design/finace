import * as XLSX from 'xlsx';
import { HometaxInvoice, CompanyCode, ParsedFileResult, ParseError } from '../lib/types';

function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string') return parseInt(v.replace(/[,\s원]/g, ''), 10) || 0;
  return 0;
}

export function parseHometaxPurchaseTax(
  buffer: Buffer,
  company: CompanyCode,
  filename: string
): ParsedFileResult<HometaxInvoice> {
  const wb  = XLSX.read(buffer, { type: 'buffer', raw: false });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

  const records: HometaxInvoice[] = [];
  const errors:  ParseError[]     = [];

  // Data starts at idx 6 (R7). Must have a YYYY-MM-DD date in A(idx0).
  for (let i = 6; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row[0] || !/^\d{4}-\d{2}-\d{2}/.test(String(row[0]))) continue;

    try {
      const issueDate          = String(row[0]).substring(0, 10);
      const approvalNumber     = String(row[1] ?? '');
      const vendorBusinessNo   = String(row[4] ?? '');
      const vendorName         = String(row[6] ?? '');  // G열: 공급자 상호 (거래처)
      const customerName       = String(row[11] ?? ''); // L열: 공급받는자 상호 (우리 회사)
      const rawTotal           = typeof row[14] === 'number' ? row[14] : parseAmount(row[14]);
      const supplyAmount       = parseAmount(row[15]);
      const taxAmount          = parseAmount(row[16]);
      const invoiceClass       = String(row[17] ?? '');
      const receiptType        = String(row[21] ?? '');
      const itemName           = String(row[28] ?? ''); // AC열: 품목명

      const isCancelled  = rawTotal < 0;
      const totalAmount  = Math.abs(rawTotal);

      records.push({
        company,
        sourceType: 'HT_PURCHASE_TAX',
        issueDate,
        approvalNumber,
        vendorName,
        customerName,
        itemName,
        totalAmount,
        supplyAmount: Math.abs(supplyAmount),
        taxAmount:    Math.abs(taxAmount),
        invoiceDirection:     'purchase',
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

  return { company, sourceType: 'HT_PURCHASE_TAX', filename, records, errors, meta: {} };
}

import * as XLSX from 'xlsx';
import { HometaxInvoice, CompanyCode, ParsedFileResult, ParseError } from '../lib/types';
import { parseHometaxRowDates } from './hometaxDateUtils';

function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string') return parseInt(v.replace(/[,\s원]/g, ''), 10) || 0;
  return 0;
}

// 면세 전자계산서: Q열(세액) 없음 → idx16부터 1열씩 당겨짐.
// 주요 차이: itemName이 AB(idx27), receiptType이 U(idx20).
export function parseHometaxPurchase(
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
      const vendorName       = String(row[6] ?? '');  // G열: 공급자 상호 (거래처)
      const customerName     = String(row[11] ?? ''); // L열: 공급받는자 상호
      const totalAmount      = parseAmount(row[14]);  // O열: 합계금액 = 공급가액
      const supplyAmount     = parseAmount(row[15]);  // P열: 공급가액
      // Q열 없음 → R(idx16)=분류, U(idx20)=영수/청구, AB(idx27)=품목명
      const invoiceClass     = String(row[16] ?? ''); // Q열 = 전자세금계산서 분류
      const receiptType      = String(row[20] ?? ''); // U열 (1열 당겨짐)
      const itemName         = String(row[27] ?? ''); // AB열 (세금계산서의 AC가 아닌 AB!)

      records.push({
        company,
        sourceType: 'HT_PURCHASE',
        writtenDate,
        issuedDate,
        approvalNumber,
        vendorName,
        customerName,
        itemName,
        totalAmount,
        supplyAmount,
        taxAmount:            0,
        invoiceDirection:     'purchase',
        taxType:              'exempt',
        invoiceClassification: invoiceClass,
        receiptType,
        isCancelled:          false,
        vendorBusinessNo,
      });
    } catch (e) {
      errors.push({ file: filename, rowIndex: i, message: String(e), rawData: row as unknown[] });
    }
  }

  return { company, sourceType: 'HT_PURCHASE', filename, records, errors, meta: {} };
}

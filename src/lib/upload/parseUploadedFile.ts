import * as XLSX from 'xlsx';
import {
  CompanyCode, SourceType,
  BankTransaction, CardTransaction, HometaxInvoice, ParseError,
} from '../types';
import { parseBankIbk }           from '../../parsers/parseBankIbk';
import { parseBankWoori }          from '../../parsers/parseBankWoori';
import { parseCardIbk }            from '../../parsers/parseCardIbk';
import { parseCardWoori }          from '../../parsers/parseCardWoori';
import { parseHometaxPurchaseTax } from '../../parsers/parseHometaxPurchaseTax';
import { parseHometaxPurchase }    from '../../parsers/parseHometaxPurchase';
import { parseHometaxSalesTax }    from '../../parsers/parseHometaxSalesTax';
import { detectFileType }          from './detectFileType';

// 우리카드 결제일은 사용일 기준으로 자동 계산 (전월 6일~당월 5일 → 당월 20일)
// 회사별 다른 결제일 설정 제거

export type UploadedParseResult = {
  fileName:          string;
  companyCode:       CompanyCode;
  sourceType:        SourceType;
  confidence:        number;
  reasons:           string[];
  parsedCount:       number;
  errors:            ParseError[];
  bankTransactions?: BankTransaction[];
  cardTransactions?: CardTransaction[];
  hometaxInvoices?:  HometaxInvoice[];
  needsManual?:      boolean;   // 감지 실패 시 true → DB 반영 안 함
};

export function parseUploadedFile(
  buffer:              Buffer,
  fileName:            string,
  fallbackCompany:     CompanyCode | null = null,
  fallbackSourceType:  SourceType  | null = null,
): UploadedParseResult {
  // 워크북 읽기 (감지용)
  const wb             = XLSX.read(buffer, { type: 'buffer', raw: false });
  const ws             = wb.Sheets[wb.SheetNames[0]];
  const firstSheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

  const detected    = detectFileType(fileName, wb, firstSheetRows, fallbackCompany);
  const companyCode = (fallbackCompany    ?? detected.companyCode) as CompanyCode | null;
  const sourceType  = (fallbackSourceType ?? detected.sourceType)  as SourceType  | null;

  if (!companyCode || !sourceType) {
    return {
      fileName,
      companyCode: companyCode ?? 'feedback',
      sourceType:  sourceType  ?? 'BANK_IBK',
      confidence:  detected.confidence,
      reasons:     detected.reasons,
      parsedCount: 0,
      errors:      [{ file: fileName, rowIndex: -1, message: '파일 종류 또는 회사 자동 감지 실패 — 수동 선택 필요', rawData: [] }],
      needsManual: true,
    };
  }

  try {
    switch (sourceType) {
      case 'BANK_IBK': {
        const r = parseBankIbk(buffer, companyCode, fileName);
        return { fileName, companyCode, sourceType, confidence: detected.confidence, reasons: detected.reasons, parsedCount: r.records.length, errors: r.errors, bankTransactions: r.records };
      }
      case 'BANK_WOORI': {
        const r = parseBankWoori(buffer, companyCode, fileName);
        return { fileName, companyCode, sourceType, confidence: detected.confidence, reasons: detected.reasons, parsedCount: r.records.length, errors: r.errors, bankTransactions: r.records };
      }
      case 'CARD_IBK': {
        const r = parseCardIbk(buffer, companyCode, fileName);
        return { fileName, companyCode, sourceType, confidence: detected.confidence, reasons: detected.reasons, parsedCount: r.records.length, errors: r.errors, cardTransactions: r.records };
      }
      case 'CARD_WOORI': {
        const r = parseCardWoori(buffer, companyCode, fileName);
        return { fileName, companyCode, sourceType, confidence: detected.confidence, reasons: detected.reasons, parsedCount: r.records.length, errors: r.errors, cardTransactions: r.records };
      }
      case 'HT_PURCHASE_TAX': {
        const r = parseHometaxPurchaseTax(buffer, companyCode, fileName);
        return { fileName, companyCode, sourceType, confidence: detected.confidence, reasons: detected.reasons, parsedCount: r.records.length, errors: r.errors, hometaxInvoices: r.records };
      }
      case 'HT_PURCHASE': {
        const r = parseHometaxPurchase(buffer, companyCode, fileName);
        return { fileName, companyCode, sourceType, confidence: detected.confidence, reasons: detected.reasons, parsedCount: r.records.length, errors: r.errors, hometaxInvoices: r.records };
      }
      case 'HT_SALES_TAX': {
        const r = parseHometaxSalesTax(buffer, companyCode, fileName);
        return { fileName, companyCode, sourceType, confidence: detected.confidence, reasons: detected.reasons, parsedCount: r.records.length, errors: r.errors, hometaxInvoices: r.records };
      }
      default:
        return { fileName, companyCode, sourceType, confidence: 0, reasons: ['지원하지 않는 sourceType'], parsedCount: 0, errors: [], needsManual: true };
    }
  } catch (err) {
    return {
      fileName, companyCode, sourceType,
      confidence:  detected.confidence,
      reasons:     detected.reasons,
      parsedCount: 0,
      errors:      [{ file: fileName, rowIndex: -1, message: `파싱 오류: ${err}`, rawData: [] }],
    };
  }
}

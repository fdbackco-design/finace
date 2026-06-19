export type CompanyCode = 'feedback' | 'sangsaeng' | 'shootmoon';

export type SourceType =
  | 'BANK_IBK'
  | 'BANK_WOORI'
  | 'CARD_IBK'
  | 'CARD_WOORI'
  | 'HT_PURCHASE_TAX'
  | 'HT_PURCHASE'
  | 'HT_SALES_TAX';

export interface BankTransaction {
  company: CompanyCode;
  sourceType: 'BANK_IBK' | 'BANK_WOORI';
  transactionDate: string;     // YYYY-MM-DD
  transactionTime: string;     // HH:mm:ss
  description: string;         // F열(IBK 적요) or C열(WOORI 적요)
  memo: string;
  withdrawAmount: number;
  depositAmount: number;
  balance: number;
  accountNo: string;
  counterAccountNo: string;
  counterBank: string;
  counterAccountName: string;
  txType: string;
  categoryHint: string;        // '가수금' or ''
}

export interface CardTransaction {
  company: CompanyCode;
  sourceType: 'CARD_IBK' | 'CARD_WOORI';
  usedAt: string;              // ISO datetime or YYYY-MM-DDTHH:mm:ss
  merchantName: string;
  amount: number;
  approvalNumber: string;
  cardNo: string;
  businessNo: string;
  paymentDueDate: string;      // YYYY-MM-DD
  isCancelled: boolean;
  cancelledAmount: number;
  domesticOrForeign: string;
  salesType: string;
}

export interface HometaxInvoice {
  company: CompanyCode;
  sourceType: 'HT_PURCHASE_TAX' | 'HT_PURCHASE' | 'HT_SALES_TAX';
  issueDate: string;           // YYYY-MM-DD
  approvalNumber: string;
  vendorName: string;          // G열: 공급자 상호
  customerName: string;        // L열: 공급받는자 상호
  itemName: string;            // AC열(세금계산서) or AB열(면세계산서) 품목명
  totalAmount: number;         // O열 합계금액 (절대값)
  supplyAmount: number;        // P열 공급가액
  taxAmount: number;           // Q열 세액 (면세=0)
  invoiceDirection: 'purchase' | 'sales';
  taxType: 'tax' | 'exempt';
  invoiceClassification: string;  // 세금계산서/수정세금계산서/계산서
  receiptType: string;            // 영수/청구
  isCancelled: boolean;
  vendorBusinessNo: string;
}

export interface ParseError {
  file: string;
  rowIndex: number;
  message: string;
  rawData: unknown[];
}

export interface ParsedFileResult<T> {
  company: CompanyCode;
  sourceType: SourceType;
  filename: string;
  records: T[];
  errors: ParseError[];
  meta: Record<string, unknown>;
}

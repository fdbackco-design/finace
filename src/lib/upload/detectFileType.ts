import * as XLSX from 'xlsx';
import { CompanyCode, SourceType } from '../types';

export type DetectedUploadFile = {
  companyCode: CompanyCode | null;
  sourceType:  SourceType  | null;
  confidence:  number;
  reasons:     string[];
};

const COMPANY_KEYWORDS: Record<CompanyCode, string[]> = {
  feedback:  ['피드백', 'feedback', '주식회사피드백', 'feedbackco'],
  sangsaeng: ['상생', 'sangsaeng', '(주)상생', '주식회사상생'],
  shootmoon: ['슛문', 'shootmoon'],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_\-()（）\[\]]/g, '');
}

function flat(rows: unknown[][], limit = 8): string {
  return rows
    .slice(0, limit)
    .map(r => r.map(c => String(c ?? '')).join(' '))
    .join(' ')
    .toLowerCase();
}

function hasAll(text: string, ...terms: string[]): boolean {
  return terms.every(t => text.includes(t));
}

export function detectFileType(
  fileName:        string,
  _wb:             XLSX.WorkBook,
  firstSheetRows:  unknown[][],
  fallbackCompany: CompanyCode | null = null,
): DetectedUploadFile {
  const reasons:   string[]    = [];
  let companyCode: CompanyCode | null = null;
  let sourceType:  SourceType  | null = null;
  let confidence   = 0;

  const fnNorm   = norm(fileName);
  const content  = flat(firstSheetRows);

  // ── 회사 감지 ───────────────────────────────────────────────────────────────
  for (const [code, kws] of Object.entries(COMPANY_KEYWORDS)) {
    for (const kw of kws) {
      if (fnNorm.includes(norm(kw)) || content.includes(norm(kw))) {
        companyCode = code as CompanyCode;
        reasons.push(`회사 감지: "${kw}"`);
        break;
      }
    }
    if (companyCode) break;
  }
  if (!companyCode && fallbackCompany) {
    companyCode = fallbackCompany;
    reasons.push(`회사 수동 지정: ${fallbackCompany}`);
  }

  // ── sourceType 감지 ─────────────────────────────────────────────────────────

  // BANK_IBK: "거래내역조회" 파일명 or 헤더에 거래일시+출금액+입금액
  if (
    fnNorm.includes('거래내역조회') || fnNorm.includes('입출식예금') ||
    hasAll(content, '거래일시', '출금액', '입금액') ||
    hasAll(content, '거래일시', '잔액')
  ) {
    sourceType = 'BANK_IBK';
    confidence = 0.92;
    reasons.push('BANK_IBK: 파일명(거래내역조회) 또는 헤더(거래일시,출금액,입금액)');
  }
  // BANK_WOORI: 우리 관련 파일명 or 헤더
  else if (
    (fnNorm.includes('우리') && (fnNorm.includes('거래') || fnNorm.includes('이체'))) ||
    hasAll(content, '거래일자', '입금금액', '출금금액') ||
    hasAll(content, '거래일자', '거래후잔액')
  ) {
    sourceType = 'BANK_WOORI';
    confidence = 0.92;
    reasons.push('BANK_WOORI: 파일명(우리+거래) 또는 헤더(거래일자,입금금액,출금금액)');
  }
  // CARD_IBK: 기업카드 파일명 or 헤더에 결제예정일자
  else if (
    fnNorm.includes('기업카드') || fnNorm.includes('ibk카드') ||
    hasAll(content, '승인일시', '결제예정일자') ||
    hasAll(content, '가맹점명', '승인금액', '결제예정일자')
  ) {
    sourceType = 'CARD_IBK';
    confidence = 0.90;
    reasons.push('CARD_IBK: 파일명(기업카드) 또는 헤더(승인일시,결제예정일자)');
  }
  // CARD_WOORI: 우리카드 파일명 or 헤더
  else if (
    fnNorm.includes('우리카드') ||
    hasAll(content, '이용일자', '승인번호', '이용가맹점') ||
    content.includes('접수구분') || content.includes('접수/취소')
  ) {
    sourceType = 'CARD_WOORI';
    confidence = 0.90;
    reasons.push('CARD_WOORI: 파일명(우리카드) 또는 헤더(이용일자,승인번호)');
  }
  // HT_SALES_TAX: 매출 세금계산서
  else if (
    fnNorm.includes('매출전자세금계산서') || fnNorm.includes('매출세금계산서') ||
    (fnNorm.includes('매출') && fnNorm.includes('세금계산서'))
  ) {
    sourceType = 'HT_SALES_TAX';
    confidence = 0.93;
    reasons.push('HT_SALES_TAX: 파일명(매출전자세금계산서)');
  }
  // HT_PURCHASE_TAX vs HT_PURCHASE: 매입 계산서 — 세액 컬럼 유무로 구분
  else if (
    fnNorm.includes('매입전자세금계산서') || fnNorm.includes('매입세금계산서') ||
    (fnNorm.includes('매입') && fnNorm.includes('세금계산서'))
  ) {
    sourceType = 'HT_PURCHASE_TAX';
    confidence = 0.90;
    reasons.push('HT_PURCHASE_TAX: 파일명(매입전자세금계산서)');
  }
  else if (
    fnNorm.includes('매입전자계산서') || fnNorm.includes('매입계산서') ||
    (fnNorm.includes('매입') && fnNorm.includes('계산서') && !fnNorm.includes('세금'))
  ) {
    sourceType = 'HT_PURCHASE';
    confidence = 0.88;
    reasons.push('HT_PURCHASE: 파일명(매입전자계산서 / 면세)');
  }
  // 헤더 기반 홈택스 감지 (파일명 단서 없을 때)
  else if (hasAll(content, '공급자', '합계금액') && content.includes('세액')) {
    sourceType = fnNorm.includes('매출') ? 'HT_SALES_TAX' : 'HT_PURCHASE_TAX';
    confidence = 0.70;
    reasons.push(`홈택스 헤더 감지(공급자/합계금액/세액) → ${sourceType}`);
  }
  else if (hasAll(content, '공급자', '공급가액') && !content.includes('세액')) {
    sourceType = 'HT_PURCHASE';
    confidence = 0.65;
    reasons.push('홈택스 면세 헤더 감지(공급자/공급가액, 세액 없음)');
  }

  if (!sourceType) {
    confidence = 0;
    reasons.push('❌ 파일 종류 자동 감지 실패 — sourceType을 수동으로 선택해 주세요');
  }

  return { companyCode, sourceType, confidence, reasons };
}

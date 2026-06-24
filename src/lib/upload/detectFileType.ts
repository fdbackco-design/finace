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
  return s.normalize('NFC').toLowerCase().replace(/[\s_\-()（）\[\]]/g, '');
}

/**
 * IBK 은행 파일 헤더 셀(A:M2, row index 1)에서 "예금주명:" 값을 추출한다.
 * 셀은 멀티라인 텍스트이며 "예금주명:(주)피드백" 또는 "예금주명:주식회사 상생" 형태.
 */
function extractAccountHolder(rows: unknown[][]): string | null {
  // 앞 4행의 모든 셀을 검사 (위치 이동에 대비)
  // IBK: "예금주명:주식회사 상생", Woori: "예금주 : (주)상생" — 둘 다 처리
  for (let r = 0; r < Math.min(4, rows.length); r++) {
    for (let c = 0; c < Math.min(4, (rows[r] as unknown[]).length); c++) {
      const cell = String(rows[r]?.[c] ?? '');
      const match = cell.match(/예금주명?\s*[:：]\s*([^\n\r\t]+)/);
      if (match) {
        return match[1].trim();
      }
    }
  }
  return null;
}

/** Excel A5 = row index 4, col 0 — 홈택스 제목행 */
function hometaxTitleFromA5(rows: unknown[][]): string {
  const raw = rows[4]?.[0];
  return raw != null ? String(raw).normalize('NFC').trim() : '';
}

function detectHometaxFromTitle(title: string): { sourceType: SourceType; label: string } | null {
  if (!title.includes('목록조회')) return null;

  if (title.includes('매출') && title.includes('세금계산서')) {
    return { sourceType: 'HT_SALES_TAX', label: '매출 전자세금계산서' };
  }
  if (title.includes('매입') && title.includes('세금계산서')) {
    return { sourceType: 'HT_PURCHASE_TAX', label: '매입 전자세금계산서' };
  }
  if (title.includes('매입') && title.includes('계산서')) {
    return { sourceType: 'HT_PURCHASE', label: '매입 전자계산서(면세)' };
  }
  return null;
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
  const a5Title  = hometaxTitleFromA5(firstSheetRows);
  const hometaxFromA5 = detectHometaxFromTitle(a5Title);

  // ── 회사 감지 ───────────────────────────────────────────────────────────────

  // 1순위: IBK 은행 파일 A:M2 합병 셀에서 "예금주명:" 추출
  const accountHolder = extractAccountHolder(firstSheetRows);
  if (accountHolder) {
    const holderNorm = norm(accountHolder);
    for (const [code, kws] of Object.entries(COMPANY_KEYWORDS)) {
      for (const kw of kws) {
        if (holderNorm.includes(norm(kw))) {
          companyCode = code as CompanyCode;
          reasons.push(`예금주명 감지: "${accountHolder}" → ${code}`);
          break;
        }
      }
      if (companyCode) break;
    }
  }

  // 2순위: 파일명 + 앞 8행 내용 전체 키워드 탐색
  if (!companyCode) {
    const extendedContent = [fnNorm, content].join(' ');
    for (const [code, kws] of Object.entries(COMPANY_KEYWORDS)) {
      for (const kw of kws) {
        if (extendedContent.includes(norm(kw))) {
          companyCode = code as CompanyCode;
          reasons.push(`회사 감지: "${kw}"`);
          break;
        }
      }
      if (companyCode) break;
    }
  }

  if (!companyCode && fallbackCompany) {
    companyCode = fallbackCompany;
    reasons.push(`회사 수동 지정: ${fallbackCompany}`);
  }

  // ── sourceType 감지 ─────────────────────────────────────────────────────────

  // BANK_WOORI: IBK보다 먼저 검사 — 우리은행도 "거래일시"+"잔액"을 가지므로
  // IBK check가 먼저 실행되면 우리은행 파일이 BANK_IBK로 오감지됨.
  // 우리은행 구분자: "입금금액"/"출금금액" (IBK는 "입금액"/"출금액" 단형)
  if (
    (fnNorm.includes('우리') && (fnNorm.includes('거래') || fnNorm.includes('이체'))) ||
    hasAll(content, '거래일자', '입금금액', '출금금액') ||
    hasAll(content, '거래일자', '거래후잔액') ||
    hasAll(content, '거래일시', '입금금액', '출금금액')
  ) {
    sourceType = 'BANK_WOORI';
    confidence = 0.92;
    reasons.push('BANK_WOORI: 파일명(우리+거래) 또는 헤더(입금금액,출금금액)');
  }
  // BANK_IBK: "거래내역조회" 파일명 or 헤더에 거래일시+출금액+입금액
  else if (
    fnNorm.includes('거래내역조회') || fnNorm.includes('입출식예금') ||
    hasAll(content, '거래일시', '출금액', '입금액') ||
    hasAll(content, '거래일시', '잔액')
  ) {
    sourceType = 'BANK_IBK';
    confidence = 0.92;
    reasons.push('BANK_IBK: 파일명(거래내역조회) 또는 헤더(거래일시,출금액,입금액)');
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
  // 홈택스: A5 제목행 (매입/매출 전자(수정) 세금계산서 목록조회)
  else if (hometaxFromA5) {
    sourceType = hometaxFromA5.sourceType;
    confidence = 0.96;
    reasons.push(`${hometaxFromA5.sourceType}: A5 제목행("${a5Title}")`);
  }
  // HT_SALES_TAX: 매출 세금계산서 (파일명)
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
  // 헤더 기반 홈택스 감지 (파일명·A5 단서 없을 때)
  else if (hasAll(content, '공급자', '합계금액') && content.includes('세액')) {
    sourceType = hometaxFromA5?.sourceType
      ?? (fnNorm.includes('매출') ? 'HT_SALES_TAX' : 'HT_PURCHASE_TAX');
    confidence = hometaxFromA5 ? 0.90 : 0.70;
    reasons.push(
      hometaxFromA5
        ? `${sourceType}: A5 제목행("${a5Title}")`
        : `홈택스 헤더 감지(공급자/합계금액/세액) → ${sourceType}`,
    );
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

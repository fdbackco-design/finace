import { CompanyCode, SourceType } from '../lib/types';

export interface FixedCostEntry {
  id: string;
  paymentDayRaw: string;      // A열: "1일", "말일"
  paymentDay: number;         // 1-31 (말일=31)
  category: string;           // B열: 지급수수료/임차료/급여 등
  vendorName: string;         // C열: 자금수지현황표 거래처명
  amount: number;             // D열: 기준금액 (0이면 변동)
  vendorAlias: string;        // E열: 업체명 (추가 매핑 키)
  matchKey: string;           // F열: 거래처정보 (쉼표 구분 매핑 키 묶음)
  notes: string;              // G열
  companyRaw: string;         // H열 원문
  company: string;            // normalized: 'feedback'|'sangsaeng'|'shootmoon'|'all'
  paymentType: string;        // J열: 계좌_송금/카드_자동결제/계좌_자동이체
  accountNoStr: string;       // K열: "우리 1002-248-652584 홍선미"
  vatType: string;            // L열
  isCardBill: boolean;        // B열='카드' → 월 카드 청구서 결제
}

export type MatchStatus = 'AUTO_MATCHED' | 'MANUAL_REVIEW' | 'UNMATCHED';

export type AmountStatus =
  | '입금 예정' | '실제 입금' | '입금 완료' | '부분 입금'
  | '지급 예정' | '실제 지급' | '지급 완료' | '부분 지급'
  | '미수 잔액' | '미지급 잔액'
  | '초과 입금 검토 필요' | '초과 지급 검토 필요' | '매칭 필요';

export interface CashflowEntry {
  id: string;
  company: CompanyCode;
  date: string;                 // YYYY-MM-DD (세금계산서: written_date / 은행·카드: 거래일)
  vendorName: string;           // 거래처명 (자금수지현황표)
  category: string;             // 매입/매출/가수금/고정비/카드지출/기타수입/기타지출
  subCategory: string;          // 계정과목 세부 (임차료/급여/지급수수료 등)
  incomeAmount: number;
  expenseAmount: number;
  sourceType: SourceType | 'FIXED_COST';
  paymentSourceType: string;    // 실제 결제 수단
  matchStatus: MatchStatus;
  matchReason: string;
  hometaxInvoiceId: string;
  bankTransactionId: string;
  cardTransactionId: string;
  fixedCostId: string;
  // V2: 금액 상태 추적
  amountStatus?: AmountStatus;
  invoiceAmount?: number;       // 세금계산서 총액
  actualAmount?: number;        // 실제 입금/지급액
  accumulatedAmount?: number;   // 누적 입금/지급액
  remainingAmount?: number;     // 잔액
  actualDate?: string;          // 실제 거래일
  showInCashflow?: boolean;     // 자금수지현황표 표시 여부
  categoryAuto?: string;        // 자동 구분
  classificationBasis?: string; // 분류 근거
  groupName?: string;           // 자동 그룹명 (급여 등) — runRematch에서 cashflow_groups UUID로 변환
}

export interface MatchedPair {
  id: string;
  matchType: string;
  score: number;
  hometaxInvoiceId: string;
  bankTransactionId: string;
  cardTransactionId: string;
  fixedCostId: string;
  matchReason: string;
}

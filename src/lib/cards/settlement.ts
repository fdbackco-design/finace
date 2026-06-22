/**
 * 카드 결제 기준 공통 함수
 *
 * 결제 주기 규칙:
 *   사용 기간: 전월 6일 ~ 당월 5일
 *   결제일:    당월 20일
 *
 * 예시:
 *   2026-04-06 ~ 2026-05-05 사용 → 2026-05-20 결제 (5월 자금수지현황)
 *   2026-05-06 ~ 2026-06-05 사용 → 2026-06-20 결제 (6월 자금수지현황)
 *   2026-06-06 ~ 2026-07-05 사용 → 2026-07-20 결제 (7월 자금수지현황)
 */

export type CardSettlementPeriod = {
  cashflowMonth: string;   // '2026-05'
  settlementDate: string;  // '2026-05-20'
  usedDateFrom: string;    // '2026-04-06'
  usedDateTo: string;      // '2026-05-05'
};

/**
 * 자금수지현황 월(year, month)의 카드 결제 대상 기간을 반환한다.
 * 모든 카드(우리카드·기업카드)에 동일하게 적용.
 */
export function getCardSettlementPeriod(year: number, month: number): CardSettlementPeriod {
  const pad = (n: number) => String(n).padStart(2, '0');
  const cashflowMonth  = `${year}-${pad(month)}`;
  const settlementDate = `${cashflowMonth}-20`;

  let prevYear  = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) { prevMonth = 12; prevYear--; }

  const usedDateFrom = `${prevYear}-${pad(prevMonth)}-06`;
  const usedDateTo   = `${cashflowMonth}-05`;

  return { cashflowMonth, settlementDate, usedDateFrom, usedDateTo };
}

// ── 자금수지 반영일 결정 ────────────────────────────────────────────────────────

export type CashflowDateDecision = {
  entryDate: string;
  category:  '카드지출' | '매입' | '매출';
  basis:     'HOMETAX_INVOICE_DATE' | 'CARD_PAYMENT_DATE';
  invoiceId: string | null;
};

/**
 * 카드 거래의 자금수지 반영일·카테고리를 결정한다.
 *
 * 우선순위:
 *   1순위: 매칭된 홈택스 매입계산서 작성일 → category='매입'
 *   2순위: (카드 지출과 매출계산서 매칭은 구조적으로 MANUAL_REVIEW 처리)
 *   3순위: 카드 결제일 → category='카드지출'
 */
export function resolveCardCashflowDate(input: {
  paymentDueDate: string;
  matchedPurchaseInvoice?: { id: string; issueDate: string } | null;
  matchedSalesInvoice?:   { id: string; issueDate: string } | null;
}): CashflowDateDecision {
  if (input.matchedPurchaseInvoice) {
    return {
      entryDate: input.matchedPurchaseInvoice.issueDate,
      category:  '매입',
      basis:     'HOMETAX_INVOICE_DATE',
      invoiceId: input.matchedPurchaseInvoice.id,
    };
  }
  if (input.matchedSalesInvoice) {
    // 카드 지출 거래가 매출계산서와 매칭되는 것은 논리적으로 비정상
    // → MANUAL_REVIEW 처리를 위해 '매출' 카테고리와 함께 반환하되
    //   매칭 엔진에서 match_status='MANUAL_REVIEW'로 설정해야 함
    return {
      entryDate: input.matchedSalesInvoice.issueDate,
      category:  '매출',
      basis:     'HOMETAX_INVOICE_DATE',
      invoiceId: input.matchedSalesInvoice.id,
    };
  }
  return {
    entryDate: input.paymentDueDate,
    category:  '카드지출',
    basis:     'CARD_PAYMENT_DATE',
    invoiceId: null,
  };
}

// ── 사용일 → 결제일 계산 ────────────────────────────────────────────────────────

/**
 * 카드 사용일 → 결제일 계산 (1~5일: 당월 20일, 6~31일: 익월 20일)
 * payDay 기본값 20: 우리카드·기업카드 모두 동일
 */
export function calcCardPaymentDueDate(usedDateStr: string, payDay = 20): string {
  const m = usedDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const year  = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day   = parseInt(m[3], 10);
  const pad   = (n: number) => String(n).padStart(2, '0');

  if (day >= 6) {
    let nextMonth = month + 1;
    let nextYear  = year;
    if (nextMonth > 12) { nextMonth = 1; nextYear++; }
    return `${nextYear}-${pad(nextMonth)}-${pad(payDay)}`;
  }
  return `${year}-${pad(month)}-${pad(payDay)}`;
}

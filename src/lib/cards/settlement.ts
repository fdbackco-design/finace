// ── 카드별 결제 설정 ─────────────────────────────────────────────────────────

export type CardConfig = {
  paymentDay: number;  // 납부일 (결제일)
  fromDay:    number;  // 사용기간 시작: 전달 N일
  toDay:      number;  // 사용기간 종료: 이번달 N일
};

export const CARD_SETTLEMENT_CONFIG: Record<string, CardConfig> = {
  'feedback:CARD_IBK':    { paymentDay: 21, fromDay: 13, toDay: 12 },
  'feedback:CARD_WOORI':  { paymentDay: 20, fromDay: 6,  toDay: 5  },
  'sangsaeng:CARD_IBK':   { paymentDay: 25, fromDay: 3,  toDay: 2  },
  'sangsaeng:CARD_WOORI': { paymentDay: 17, fromDay: 3,  toDay: 2  },
  'shootmoon:CARD_IBK':   { paymentDay: 21, fromDay: 6,  toDay: 5  },
  'shootmoon:CARD_WOORI': { paymentDay: 20, fromDay: 6,  toDay: 5  },
};

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type CardSettlementPeriod = {
  cashflowMonth:  string;  // '2026-05'
  settlementDate: string;  // '2026-05-21'
  usedDateFrom:   string;  // '2026-04-13'
  usedDateTo:     string;  // '2026-05-12'
};

// ── 카드별 결제 기간 반환 ──────────────────────────────────────────────────────

export function getCardPeriod(cardKey: string, year: number, month: number): CardSettlementPeriod {
  const cfg = CARD_SETTLEMENT_CONFIG[cardKey] ?? { paymentDay: 20, fromDay: 6, toDay: 5 };
  const pad = (n: number) => String(n).padStart(2, '0');

  let prevYear = year, prevMonth = month - 1;
  if (prevMonth < 1) { prevMonth = 12; prevYear--; }

  const cashflowMonth = `${year}-${pad(month)}`;
  return {
    cashflowMonth,
    settlementDate: `${cashflowMonth}-${pad(cfg.paymentDay)}`,
    usedDateFrom:   `${prevYear}-${pad(prevMonth)}-${pad(cfg.fromDay)}`,
    usedDateTo:     `${cashflowMonth}-${pad(cfg.toDay)}`,
  };
}

/**
 * 자금수지현황 조회용: 모든 카드의 사용 기간을 커버하는 가장 넓은 날짜 범위를 반환한다.
 * 이 범위로 card_transactions를 한 번에 조회한 후 카드별로 필터링한다.
 */
export function getWidestCardDateRange(year: number, month: number): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0');

  let prevYear = year, prevMonth = month - 1;
  if (prevMonth < 1) { prevMonth = 12; prevYear--; }

  const configs  = Object.values(CARD_SETTLEMENT_CONFIG);
  const minFrom  = Math.min(...configs.map(c => c.fromDay));
  const maxTo    = Math.max(...configs.map(c => c.toDay));

  return {
    from: `${prevYear}-${pad(prevMonth)}-${pad(minFrom)}`,
    to:   `${year}-${pad(month)}-${pad(maxTo)}`,
  };
}

// ── 사용일 → 결제일 계산 ─────────────────────────────────────────────────────

/**
 * 카드 사용일 → 결제 예정일 계산.
 * cardKey 를 전달하면 카드별 납부일/마감일 기준 적용.
 * 생략 시 기본값(toDay=5, payDay=20) 사용.
 */
export function calcCardPaymentDueDate(usedDateStr: string, cardKey?: string): string {
  const m = usedDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';

  const year  = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day   = parseInt(m[3], 10);
  const pad   = (n: number) => String(n).padStart(2, '0');

  const cfg    = cardKey ? (CARD_SETTLEMENT_CONFIG[cardKey] ?? null) : null;
  const payDay = cfg?.paymentDay ?? 20;
  const toDay  = cfg?.toDay      ?? 5;

  if (day <= toDay) {
    // 마감일 이내 → 당월 결제
    return `${year}-${pad(month)}-${pad(payDay)}`;
  }
  // 마감일 초과 → 익월 결제
  let nextMonth = month + 1, nextYear = year;
  if (nextMonth > 12) { nextMonth = 1; nextYear++; }
  return `${nextYear}-${pad(nextMonth)}-${pad(payDay)}`;
}

// ── 자금수지 반영일 결정 ──────────────────────────────────────────────────────

export type CashflowDateDecision = {
  entryDate: string;
  category:  '카드지출' | '매입' | '매출';
  basis:     'HOMETAX_INVOICE_DATE' | 'CARD_PAYMENT_DATE';
  invoiceId: string | null;
};

export function resolveCardCashflowDate(input: {
  paymentDueDate: string;
  matchedPurchaseInvoice?: { id: string; issuedDate: string } | null;
  matchedSalesInvoice?:   { id: string; issuedDate: string } | null;
}): CashflowDateDecision {
  if (input.matchedPurchaseInvoice) {
    return {
      entryDate: input.matchedPurchaseInvoice.issuedDate,
      category:  '매입',
      basis:     'HOMETAX_INVOICE_DATE',
      invoiceId: input.matchedPurchaseInvoice.id,
    };
  }
  if (input.matchedSalesInvoice) {
    return {
      entryDate: input.matchedSalesInvoice.issuedDate,
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

// ── 하위호환 래퍼 (기존 import 유지용) ───────────────────────────────────────

/** @deprecated getCardPeriod 를 사용하세요. */
export function getCardSettlementPeriod(year: number, month: number): CardSettlementPeriod {
  return getCardPeriod('feedback:CARD_WOORI', year, month);
}

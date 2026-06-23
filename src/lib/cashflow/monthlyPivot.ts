import { CARD_SETTLEMENT_CONFIG } from '@/src/lib/cards/settlement';

// ── Types ────────────────────────────────────────────────────────────────────

export type DbEntry = {
  id: string;
  company_code: string;
  entry_date: string;          // YYYY-MM-DD
  vendor_name: string;
  vendor_name_mapped: string | null;
  hometax_invoice_id?: string | null;
  category: string;
  sub_category: string | null;
  income_amount: number;
  expense_amount: number;
  match_status: string;
  source_type: string;
  payment_source_type: string | null;
};

export type VendorNameResolver = (entry: DbEntry) => string;

export type CashflowMonthlyRow = {
  check: string;              // 그룹 라벨 (회사명 or 가수금 etc.)
  category: string;           // 구분
  vendorName: string;         // 거래처
  total: number;              // 순합계: 양수=수입, 음수=지출
  days: Record<number, number>; // day → 순금액
  rawEntryIds: string[];
  cardKey?: string;           // 카드 행 전용 ('feedback:CARD_IBK' 등)
};

// ── 매핑 상수 ─────────────────────────────────────────────────────────────────

// 카드 결제 예정일 (회사:카드종류 → 결제일) — CARD_SETTLEMENT_CONFIG 에서 파생
const CARD_PAYMENT_DAY: Record<string, number> = Object.fromEntries(
  Object.entries(CARD_SETTLEMENT_CONFIG).map(([k, v]) => [k, v.paymentDay])
);

// 카드 결제 행 거래처 이름
const CARD_VENDOR_LABEL: Record<string, string> = {
  'feedback:CARD_IBK':    '신용카드 대금결제(기업은행) 21일 결제분',
  'feedback:CARD_WOORI':  '신용카드 대금결제(우리은행) 20일 결제분',
  'sangsaeng:CARD_IBK':   '신용카드 대금결제(기업은행) 25일 결제분',
  'sangsaeng:CARD_WOORI': '신용카드 대금결제(우리은행) 17일 결제분',
  'shootmoon:CARD_IBK':   '신용카드 대금결제(기업은행) 21일 결제분',
  'shootmoon:CARD_WOORI': '신용카드 대금결제(우리은행) 20일 결제분',
};

const COMPANY_LABEL: Record<string, string> = {
  feedback:  '피드백',
  sangsaeng: '상생',
  shootmoon: '슛문',
};

// 정렬 순서: 작을수록 위쪽
const CHECK_ORDER: Record<string, number> = {
  '현금입금': 0,
  '가수금':   1,
  '매출수금': 2,
  '피드백':   3,
  '상생':     4,
  '슛문':     5,
};

// ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

function checkLabel(company_code: string, category: string): string {
  if (category === '매출') return '매출수금';
  if (category === '가수금') return '가수금';
  if (category === '기타수입') return '현금입금';
  return COMPANY_LABEL[company_code] ?? company_code;
}

function dayFromDate(dateStr: string): number {
  // 'YYYY-MM-DD' → day 숫자 (timezone 독립적)
  return parseInt(dateStr.split('-')[2], 10);
}

// ── 핵심 함수 ─────────────────────────────────────────────────────────────────

export function buildMonthlyPivot(
  entries: DbEntry[],
  daysInMonth: number,
  resolveVendorName?: VendorNameResolver,
): CashflowMonthlyRow[] {
  const map = new Map<string, CashflowMonthlyRow>();

  function upsert(key: string, init: Omit<CashflowMonthlyRow, 'total' | 'days' | 'rawEntryIds'>): CashflowMonthlyRow {
    if (!map.has(key)) {
      map.set(key, { ...init, total: 0, days: {}, rawEntryIds: [] });
    }
    return map.get(key)!;
  }

  function addToRow(row: CashflowMonthlyRow, day: number, net: number, entryId: string) {
    const d = Math.min(day, daysInMonth); // 월의 마지막 날을 초과하면 마지막 날로
    row.days[d] = (row.days[d] ?? 0) + net;
    row.total += net;
    row.rawEntryIds.push(entryId);
  }

  for (const e of entries) {
    const day = dayFromDate(e.entry_date);
    // net: 양수 = 수입(입금), 음수 = 지출(출금)
    const net = e.income_amount - e.expense_amount;

    // ── 카드지출: 개별 가맹점 대신 결제예정일 기준 집계 ──────────────────────
    if (e.category === '카드지출') {
      const ck = `${e.company_code}:${e.source_type}`;
      const payDay = CARD_PAYMENT_DAY[ck] ?? day;
      const label  = CARD_VENDOR_LABEL[ck] ?? `신용카드 대금결제(${e.source_type})`;

      const row = upsert(`CARD::${ck}`, {
        check:      COMPANY_LABEL[e.company_code] ?? e.company_code,
        category:   '미지급금',
        vendorName: label,
        cardKey:    ck,
      });
      addToRow(row, payDay, net, e.id); // net < 0 (expense)

    // ── 가수금: 개인 이름 무시, 대표이사 가수금 한 줄로 집계 ─────────────────
    } else if (e.category === '가수금') {
      const row = upsert('KASUGEUM', {
        check:      '가수금',
        category:   '-',
        vendorName: '대표이사 가수금',
      });
      addToRow(row, day, net, e.id);

    // ── 일반 항목 ──────────────────────────────────────────────────────────
    } else {
      const check = checkLabel(e.company_code, e.category);
      const displayName = resolveVendorName
        ? resolveVendorName(e)
        : (e.vendor_name_mapped ?? e.vendor_name);
      // 매핑된 거래처명 기준으로 그룹핑 (여러 지점/원본명 → 한 줄)
      const key = `${check}::${e.company_code}::${e.category}::${displayName}`;

      const row = upsert(key, {
        check,
        category:   e.category,
        vendorName: displayName,
      });
      addToRow(row, day, net, e.id);
    }
  }

  // ── 정렬 ────────────────────────────────────────────────────────────────
  const rows = Array.from(map.values());
  rows.sort((a, b) => {
    const aOrd = CHECK_ORDER[a.check] ?? 99;
    const bOrd = CHECK_ORDER[b.check] ?? 99;
    if (aOrd !== bOrd) return aOrd - bOrd;
    if (a.category !== b.category) return a.category.localeCompare(b.category, 'ko');
    return a.vendorName.localeCompare(b.vendorName, 'ko');
  });

  return rows;
}

// ── 월간 요약 ─────────────────────────────────────────────────────────────────

export type CashflowMonthlySummary = {
  month: string;
  days: number[];
  daily: {
    cashIncome:            Record<number, number>;
    salesCollection:       Record<number, number>;
    payablesAndFixedCosts: Record<number, number>;
  };
  totals: {
    cashIncomeTotal:            number;
    salesCollectionTotal:       number;
    payablesAndFixedCostsTotal: number;
    requiredMoney:              number;
  };
};

export function buildCashflowMonthlySummary(
  entries: DbEntry[],
  month: string,
  daysInMonth: number,
): CashflowMonthlySummary {
  const daily = {
    cashIncome:            {} as Record<number, number>,
    salesCollection:       {} as Record<number, number>,
    payablesAndFixedCosts: {} as Record<number, number>,
  };

  function add(rec: Record<number, number>, day: number, amount: number) {
    const d = Math.min(day, daysInMonth);
    rec[d] = (rec[d] ?? 0) + amount;
  }

  for (const e of entries) {
    const day = dayFromDate(e.entry_date);

    // 매출수금: category='매출' OR source_type='HT_SALES_TAX'
    if (e.income_amount > 0 && (e.category === '매출' || e.source_type === 'HT_SALES_TAX')) {
      add(daily.salesCollection, day, e.income_amount);
    // 현금입금: income > 0 AND NOT 가수금/매출
    } else if (e.income_amount > 0 && e.category !== '가수금' && e.category !== '매출') {
      add(daily.cashIncome, day, e.income_amount);
    }

    // 외상대+고정비: expense > 0 AND NOT 가수금 (카드지출은 결제예정일 기준)
    if (e.expense_amount > 0 && e.category !== '가수금') {
      const payDay = e.category === '카드지출'
        ? (CARD_PAYMENT_DAY[`${e.company_code}:${e.source_type}`] ?? day)
        : day;
      add(daily.payablesAndFixedCosts, payDay, e.expense_amount);
    }
  }

  const cashIncomeTotal            = Object.values(daily.cashIncome).reduce((s, v) => s + v, 0);
  const salesCollectionTotal       = Object.values(daily.salesCollection).reduce((s, v) => s + v, 0);
  const payablesAndFixedCostsTotal = Object.values(daily.payablesAndFixedCosts).reduce((s, v) => s + v, 0);

  return {
    month,
    days: Array.from({ length: daysInMonth }, (_, i) => i + 1),
    daily,
    totals: {
      cashIncomeTotal,
      salesCollectionTotal,
      payablesAndFixedCostsTotal,
      requiredMoney: cashIncomeTotal + salesCollectionTotal - payablesAndFixedCostsTotal,
    },
  };
}

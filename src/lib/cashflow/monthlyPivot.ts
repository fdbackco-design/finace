import { CARD_SETTLEMENT_CONFIG } from '@/src/lib/cards/settlement';

// ── Types ────────────────────────────────────────────────────────────────────

export type DbEntry = {
  id: string;
  company_code: string;
  entry_date: string;          // YYYY-MM-DD
  vendor_name: string;
  vendor_name_mapped: string | null;
  vendor_name_override: string | null;  // 사용자 수정 거래처명
  hometax_invoice_id?: string | null;
  category: string;
  sub_category: string | null;
  display_category: string | null;     // 사용자 구분 (드롭다운)
  income_amount: number;
  expense_amount: number;
  match_status: string;
  source_type: string;
  payment_source_type: string | null;
  // V2 금액 상태
  amount_status: string | null;
  invoice_amount: number;
  actual_amount: number;
  accumulated_amount: number;
  remaining_amount: number;
  actual_date: string | null;
  show_in_cashflow: boolean;
  // 그룹
  group_id: string | null;
  group_name: string | null;
  group_order: number;
  // 매칭 완료
  is_completed: boolean;
  completed_at: string | null;
};

export type VendorNameResolver = (entry: DbEntry) => string;

export type CashflowMonthlyRow = {
  check: string;              // 그룹 라벨 (회사명 or 가수금 etc.)
  category: string;           // 시스템 구분 (매입/매출 등)
  displayCategory: string;    // 사용자 구분 (드롭다운)
  vendorName: string;         // 거래처 (override 적용)
  total: number;              // 순합계: 양수=수입, 음수=지출
  days: Record<number, number>; // day → 순금액
  rawEntryIds: string[];      // 기반 cashflow_entry UUID 목록
  cardKey?: string;           // 카드 행 전용 ('feedback:CARD_IBK' 등)
  // V2 필드
  amountStatus: string | null;     // 금액 상태 레이블
  invoiceAmount: number;           // 세금계산서 합계
  actualAmount: number;            // 실제 처리액 합계
  remainingAmount: number;         // 잔액 합계
  groupId: string | null;          // 그룹 ID
  groupName: string | null;        // 그룹명
  groupOrder: number;              // 그룹 내 순서
  isCompleted: boolean;            // 매칭 완료 여부 (행 내 모든 항목 완료)
  entryCount: number;              // 포함된 원시 항목 수
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
  '가수금':   0,
  '매출수금': 1,
  '피드백':   2,
  '상생':     3,
  '슛문':     4,
};

// ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * amount_status가 DB에 없을 때 income/invoice 금액으로 유추
 * V2 이전 데이터 또는 미매칭 항목 대응
 */
function deriveAmountStatus(e: DbEntry): string | null {
  if (e.amount_status) return e.amount_status;

  const isSales = e.category === '매출' || e.source_type === 'HT_SALES_TAX';
  const isPurchase = e.category === '매입' || e.source_type === 'HT_PURCHASE_TAX' || e.source_type === 'HT_PURCHASE';

  if (isSales) {
    const inv = e.invoice_amount ?? 0;
    const inc = e.income_amount  ?? 0;
    const act = e.actual_amount  ?? 0;
    if (inc === 0) return '입금 예정';
    if (inv > 0) {
      const paid = act > 0 ? act : inc;
      if (Math.abs(inv - paid) <= 10) return '입금 완료';
      if (paid > inv) return '초과 입금 검토 필요';
      return '부분 입금';
    }
    return '실제 입금';
  }

  if (isPurchase) {
    const inv = e.invoice_amount  ?? 0;
    const exp = e.expense_amount  ?? 0;
    const act = e.actual_amount   ?? 0;
    if (exp === 0 && act === 0) return '지급 예정';
    if (inv > 0) {
      const paid = act > 0 ? act : exp;
      if (Math.abs(inv - paid) <= 10) return '지급 완료';
      if (paid < inv)  return '부분 지급';
      return '지급 완료';
    }
    return '실제 지급';
  }

  return null;
}

function checkLabel(company_code: string, category: string): string {
  if (category === '매출') return '매출수금';
  if (category === '가수금') return '가수금';
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

  function upsert(
    key: string,
    init: Omit<CashflowMonthlyRow, 'total' | 'days' | 'rawEntryIds' | 'invoiceAmount' | 'actualAmount' | 'remainingAmount' | 'entryCount' | 'isCompleted'>,
  ): CashflowMonthlyRow {
    if (!map.has(key)) {
      map.set(key, {
        ...init,
        total: 0, days: {}, rawEntryIds: [],
        invoiceAmount: 0, actualAmount: 0, remainingAmount: 0,
        entryCount: 0, isCompleted: false,
      });
    }
    return map.get(key)!;
  }

  function addToRow(row: CashflowMonthlyRow, day: number, net: number, e: DbEntry) {
    const d = Math.min(day, daysInMonth);
    row.days[d] = (row.days[d] ?? 0) + net;
    row.total += net;
    row.rawEntryIds.push(e.id);
    row.entryCount++;
    row.invoiceAmount   += (e.invoice_amount   ?? 0);
    row.actualAmount    += (e.actual_amount     ?? 0);
    row.remainingAmount += (e.remaining_amount  ?? 0);
    // 행 내 모든 항목이 완료되어야 is_completed = true
    if (!e.is_completed) row.isCompleted = false;
  }

  for (const e of entries) {
    // show_in_cashflow가 false인 항목은 피벗에 포함하지 않음
    if (e.show_in_cashflow === false) continue;

    const day = dayFromDate(e.entry_date);
    const net = e.income_amount - e.expense_amount;

    // 거래처명: override > ht > fc alias > mapped > original
    const resolvedName = e.vendor_name_override
      ?? (resolveVendorName ? resolveVendorName(e) : null)
      ?? e.vendor_name_mapped
      ?? e.vendor_name;

    const displayCat = e.display_category ?? e.category;

    // ── 카드지출 ─────────────────────────────────────────────────────────
    if (e.category === '카드지출') {
      const ck = `${e.company_code}:${e.source_type}`;
      const payDay = CARD_PAYMENT_DAY[ck] ?? day;
      const label  = CARD_VENDOR_LABEL[ck] ?? `신용카드 대금결제(${e.source_type})`;

      const row = upsert(`CARD::${ck}`, {
        check:           COMPANY_LABEL[e.company_code] ?? e.company_code,
        category:        '카드지출',
        displayCategory: '미지급금',
        vendorName:      label,
        cardKey:         ck,
        amountStatus:    '실제 지급',
        groupId:         e.group_id,
        groupName:       e.group_name,
        groupOrder:      e.group_order ?? 0,
      });
      addToRow(row, payDay, net, e);

    // ── 가수금 ───────────────────────────────────────────────────────────
    } else if (e.category === '가수금') {
      const row = upsert('KASUGEUM', {
        check:           '가수금',
        category:        '가수금',
        displayCategory: '가수금',
        vendorName:      '대표이사 가수금',
        amountStatus:    deriveAmountStatus(e) ?? '실제 입금',
        groupId:         null,
        groupName:       null,
        groupOrder:      0,
      });
      addToRow(row, day, net, e);

    // ── 일반 항목 ────────────────────────────────────────────────────────
    } else {
      const check = checkLabel(e.company_code, e.category);
      const key = `${check}::${e.company_code}::${e.category}::${resolvedName}`;

      const row = upsert(key, {
        check,
        category:        e.category,
        displayCategory: displayCat,
        vendorName:      resolvedName,
        amountStatus:    deriveAmountStatus(e),
        groupId:         e.group_id,
        groupName:       e.group_name,
        groupOrder:      e.group_order ?? 0,
      });
      // 첫 번째 항목이 그룹 정보를 결정 (이후 항목도 같은 그룹이어야 함)
      if (!row.groupId && e.group_id) {
        row.groupId   = e.group_id;
        row.groupName = e.group_name;
      }
      addToRow(row, day, net, e);
    }
  }

  // ── 정렬: 그룹 order → check order → category → vendorName ──────────────
  const rows = Array.from(map.values());
  rows.sort((a, b) => {
    // 그룹 내 항목은 group_order 기준 (같은 그룹끼리 묶음)
    if (a.groupId && b.groupId && a.groupId === b.groupId) {
      return a.groupOrder - b.groupOrder;
    }
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
    // 가수금만 현금입금 합계에 포함
    } else if (e.income_amount > 0 && e.category === '가수금') {
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

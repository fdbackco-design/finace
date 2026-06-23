export const dynamic    = 'force-dynamic';
export const revalidate = 0;

import { fetchTable } from '@/src/lib/supabase/server';
import {
  buildMonthlyPivot,
  buildCashflowMonthlySummary,
  type DbEntry,
  type CashflowMonthlyRow,
  type CashflowMonthlySummary,
} from '@/src/lib/cashflow/monthlyPivot';
import {
  cardLabelFromEntry,
  cardLabelSortOrder,
  type CardLabel,
} from '@/src/lib/cards/classifyCard';
import {
  getCardPeriod,
  getWidestCardDateRange,
  type CardSettlementPeriod,
} from '@/src/lib/cards/settlement';
import {
  buildFcAliasMap,
  resolveCashflowVendorName,
  type HtVendorRef,
} from '@/src/lib/cashflow/resolveVendorName';

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function parseMonth(raw: string | undefined): { year: number; month: number; label: string } {
  const now = new Date();
  const str = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = str.split('-').map(Number);
  return { year: y, month: m, label: `${y}년 ${m}월` };
}

function monthStr(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function prevNextMonth(year: number, month: number) {
  const prev = month === 1  ? monthStr(year - 1, 12)     : monthStr(year, month - 1);
  const next = month === 12 ? monthStr(year + 1, 1)      : monthStr(year, month + 1);
  return { prev, next };
}

function fmtAmt(v: number): { text: string; cls: string } {
  if (v === 0) return { text: '', cls: '' };
  const abs = new Intl.NumberFormat('ko-KR').format(Math.abs(v));
  return v > 0
    ? { text: abs,       cls: 'amt-income' }   // 수입: 파랑/녹색
    : { text: abs,       cls: 'amt-expense' };  // 지출: 빨강 (절댓값 표시)
}

// ── Error / Empty 공통 컴포넌트 ───────────────────────────────────────────────

function EnvWarn() {
  return (
    <div className="env-warn">
      <strong>⚠️ Supabase 환경변수가 설정되지 않았습니다.</strong><br />
      Vercel Dashboard → Settings → Environment Variables 에 3개를 등록하고 <strong>Redeploy</strong> 하세요.<br /><br />
      &nbsp;• NEXT_PUBLIC_SUPABASE_URL &nbsp;• NEXT_PUBLIC_SUPABASE_ANON_KEY &nbsp;• SUPABASE_SERVICE_ROLE_KEY<br /><br />
      진단: <a href="/api/env-check" target="_blank">/api/env-check</a> · <a href="/api/db-check" target="_blank">/api/db-check</a>
    </div>
  );
}

function DbErrWarn({ message, code }: { message: string; code?: string }) {
  const noTable = code === '42P01' || code === 'PGRST200';
  return (
    <div className="env-warn" style={{ background: '#fef2f2', borderColor: '#fca5a5' }}>
      <strong>⚠️ {noTable ? 'cashflow_entries 테이블 없음 — migration 실행 여부를 확인하세요.' : 'DB 조회 오류'}</strong>
      {!noTable && <><br /><code style={{ fontSize: 11 }}>{message}</code></>}
      <br />진단: <a href="/api/db-check" target="_blank" style={{ color: '#991b1b' }}>/api/db-check</a>
    </div>
  );
}

// ── 월간 요약 영역 ────────────────────────────────────────────────────────────

function SummarySection({ summary, daysInMonth, year, month }: {
  summary: CashflowMonthlySummary;
  daysInMonth: number;
  year: number;
  month: number;
}) {
  const dayNums  = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const weekdays = dayNums.map(d => new Date(year, month - 1, d).getDay());
  const { totals, daily } = summary;

  function fmtNum(v: number): string {
    return v === 0 ? '-' : new Intl.NumberFormat('ko-KR').format(Math.abs(v));
  }
  function fmtSigned(v: number): string {
    if (v === 0) return '-';
    const abs = new Intl.NumberFormat('ko-KR').format(Math.abs(v));
    return v < 0 ? `-${abs}` : abs;
  }

  // 일별 필요한 돈
  const dailyRequired: Record<number, number> = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const req = (daily.cashIncome[d] ?? 0) + (daily.salesCollection[d] ?? 0) - (daily.payablesAndFixedCosts[d] ?? 0);
    if (req !== 0) dailyRequired[d] = req;
  }

  const reqCls = totals.requiredMoney < 0 ? 'amt-expense' : totals.requiredMoney > 0 ? 'amt-income' : '';

  return (
    <div className="summary-section">
      {/* 월간 요약 카드 4개 */}
      <div className="summary-cards">
        <div className="summary-card summary-cash">
          <div className="summary-card-label">현금입금 합계</div>
          <div className="summary-card-value amt-income">{fmtNum(totals.cashIncomeTotal)}</div>
        </div>
        <div className="summary-card summary-sales">
          <div className="summary-card-label">매출수금 합계</div>
          <div className="summary-card-value amt-income">{fmtNum(totals.salesCollectionTotal)}</div>
        </div>
        <div className="summary-card summary-payables">
          <div className="summary-card-label">외상대+고정비 합계</div>
          <div className="summary-card-value amt-expense">{fmtNum(totals.payablesAndFixedCostsTotal)}</div>
        </div>
        <div className={`summary-card summary-required ${totals.requiredMoney < 0 ? 'summary-required-neg' : 'summary-required-pos'}`}>
          <div className="summary-card-label">필요한 돈</div>
          <div className={`summary-card-value ${reqCls}`}>{fmtSigned(totals.requiredMoney)}</div>
          <div className="summary-card-sub">
            {totals.requiredMoney < 0 ? '자금 부족' : totals.requiredMoney > 0 ? '여유 자금' : ''}
          </div>
        </div>
      </div>

      {/* 일별 요약 테이블 */}
      <div className="pivot-wrap" style={{ marginBottom: 20 }}>
        <table className="pivot-table">
          <thead>
            <tr>
              <th className="sum-col-label">구분</th>
              <th className="sum-col-total num">합계</th>
              {dayNums.map(d => (
                <th key={d} className={`pivot-day num${weekdays[d - 1] === 0 ? ' pivot-day-sun' : weekdays[d - 1] === 6 ? ' pivot-day-sat' : ''}`}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="sum-row-cash">
              <td className="sum-col-label">현금입금</td>
              <td className="sum-col-total num amt-income">{fmtNum(totals.cashIncomeTotal)}</td>
              {dayNums.map(d => {
                const v = daily.cashIncome[d];
                return <td key={d} className="pivot-day num">{v ? fmtNum(v) : ''}</td>;
              })}
            </tr>
            <tr className="sum-row-sales">
              <td className="sum-col-label">매출수금</td>
              <td className="sum-col-total num amt-income">{fmtNum(totals.salesCollectionTotal)}</td>
              {dayNums.map(d => {
                const v = daily.salesCollection[d];
                return <td key={d} className="pivot-day num">{v ? fmtNum(v) : ''}</td>;
              })}
            </tr>
            <tr className="sum-row-payables">
              <td className="sum-col-label">외상대+고정비</td>
              <td className="sum-col-total num amt-expense">{fmtNum(totals.payablesAndFixedCostsTotal)}</td>
              {dayNums.map(d => {
                const v = daily.payablesAndFixedCosts[d];
                return <td key={d} className="pivot-day num">{v ? fmtNum(v) : ''}</td>;
              })}
            </tr>
            <tr className="sum-row-required">
              <td className="sum-col-label sum-row-required-label">필요한 돈</td>
              <td className={`sum-col-total num ${reqCls}`}>{fmtSigned(totals.requiredMoney)}</td>
              {dayNums.map(d => {
                const v = dailyRequired[d];
                if (v === undefined) return <td key={d} className="pivot-day" />;
                return (
                  <td key={d} className={`pivot-day num ${v < 0 ? 'amt-expense' : 'amt-income'}`}>
                    {fmtSigned(v)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 카드 지출 타입 ────────────────────────────────────────────────────────────

// card_transactions 직접 조회용 타입
type CardTxRow = {
  id:            string;
  used_date:     string | null;
  merchant_name: string | null;
  amount:        number;
  card_label:    string | null;
  company_code:  string;
  source_type:   string;
};

// 카드-홈택스 매칭 cashflow_entries 조회용 타입
type CardMatchRow = {
  card_transaction_id: string;
  entry_date:          string;
  category:            string;
  vendor_name:         string | null;
  hometax_invoice_id:  string | null;
};

// 카드 거래 1건 표시용 타입
type CardTxDetail = {
  id:          string;
  usedDate:    string;
  invoiceDate: string | null;  // 홈택스 계산서 작성일 (매칭된 경우)
  vendorName:  string;         // 매칭된 경우 계산서 거래처명, 아니면 카드 가맹점명
  category:    '카드지출' | '매입';
  basis:       '계산서 날짜 반영' | '카드 결제일 반영';
  amount:      number;
};

type CardExpenseGroup = {
  label:          CardLabel;
  cardKey:        string;   // 'feedback:CARD_IBK' 등
  period:         CardSettlementPeriod;
  totalAmount:    number;  // 전체 사용액 (홈택스 매칭 포함)
  htMatchedTotal: number;  // 홈택스 매입으로 반영된 금액
  transactions:   CardTxDetail[];
};

const VALID_CARD_LABELS = new Set<string>([
  '상생 우리카드', '상생 기업카드', '피드백 우리카드', '피드백 기업카드',
]);

function cardLabelToKey(label: CardLabel): string {
  if (label === '피드백 기업카드') return 'feedback:CARD_IBK';
  if (label === '피드백 우리카드') return 'feedback:CARD_WOORI';
  if (label === '상생 기업카드')   return 'sangsaeng:CARD_IBK';
  if (label === '상생 우리카드')   return 'sangsaeng:CARD_WOORI';
  return '';
}

// ── 카드 지출 그룹 빌더 ───────────────────────────────────────────────────────

function buildCardExpenseGroups(
  rows:     CardTxRow[],
  matchMap: Map<string, CardMatchRow>,
  resolveVendor: (vendorName: string, hometaxInvoiceId: string | null) => string,
  year: number,
  month: number,
): CardExpenseGroup[] {
  const map = new Map<CardLabel, CardExpenseGroup>();

  for (const c of rows) {
    const label: CardLabel | null =
      (c.card_label && VALID_CARD_LABELS.has(c.card_label)
        ? c.card_label as CardLabel
        : cardLabelFromEntry(c.company_code, c.source_type));
    if (!label) continue;

    const cardKey = cardLabelToKey(label);
    const period  = getCardPeriod(cardKey, year, month);

    // 이 카드의 사용기간 범위 내 거래만 포함
    if (c.used_date && (c.used_date < period.usedDateFrom || c.used_date > period.usedDateTo)) continue;

    if (!map.has(label)) {
      map.set(label, { label, cardKey, period, totalAmount: 0, htMatchedTotal: 0, transactions: [] });
    }
    const g = map.get(label)!;
    g.totalAmount += c.amount;

    const match = matchMap.get(c.id);
    const isHtMatched = !!(match && match.category === '매입');

    if (isHtMatched) g.htMatchedTotal += c.amount;

    g.transactions.push({
      id:          c.id,
      usedDate:    c.used_date ?? '',
      invoiceDate: match?.entry_date ?? null,
      vendorName:  match
        ? resolveVendor(match.vendor_name ?? '', match.hometax_invoice_id)
        : (c.merchant_name ?? ''),
      category:    isHtMatched ? '매입' : '카드지출',
      basis:       isHtMatched ? '계산서 날짜 반영' : '카드 결제일 반영',
      amount:      c.amount,
    });
  }

  return Array.from(map.values()).sort(
    (a, b) => cardLabelSortOrder(a.label) - cardLabelSortOrder(b.label)
  );
}

// ── 카드 지출 섹션 ────────────────────────────────────────────────────────────

function CardExpenseSection({
  groups,
  cashflowLabel,
}: {
  groups: CardExpenseGroup[];
  cashflowLabel: string;
}) {
  if (groups.length === 0) return null;

  const hasHtMatch = groups.some(g => g.htMatchedTotal > 0);

  function fmtKrw(n: number): string {
    return new Intl.NumberFormat('ko-KR').format(n) + '원';
  }

  return (
    <div className="card-expense-section">
      <h2>카드 지출 상세</h2>
      <p style={{ marginTop: 4, color: '#64748b', fontSize: 12, marginBottom: 8 }}>
        ※ 해당 카드 사용액은 {cashflowLabel} 자금수지현황의 카드 결제 예정액입니다.
        {hasHtMatch && ' 홈택스 계산서 매칭 거래는 계산서 작성일 기준으로 반영됩니다.'}
      </p>
      {groups.map(g => (
        <details key={g.label} className="card-group">
          <summary>
            <span className="card-group-label">{g.label}</span>
            <span className="card-group-total">
              지출 합계 {fmtKrw(g.totalAmount)}
              {g.htMatchedTotal > 0 && (
                <span className="card-group-ht-note">
                  &nbsp;(이 중 {fmtKrw(g.htMatchedTotal)} 계산서 반영)
                </span>
              )}
            </span>
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 12 }}>
              결제일 {g.period.settlementDate.slice(5)} · 사용기간 {g.period.usedDateFrom.slice(5)} ~ {g.period.usedDateTo.slice(5)}
            </span>
          </summary>
          <div className="card-group-body">
            {g.transactions.length === 0 ? (
              <div className="card-group-empty">거래 내역이 없습니다.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>사용일</th>
                    {g.transactions.some(t => t.invoiceDate) && <th>계산서날짜</th>}
                    <th>거래처</th>
                    <th>구분</th>
                    <th className="num">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {g.transactions.map(t => (
                    <tr key={t.id} className={t.category === '매입' ? 'card-tx-ht-matched' : ''}>
                      <td style={{ whiteSpace: 'nowrap' }}>{t.usedDate}</td>
                      {g.transactions.some(tx => tx.invoiceDate) && (
                        <td style={{ whiteSpace: 'nowrap', color: t.invoiceDate ? '#0f766e' : '#94a3b8' }}>
                          {t.invoiceDate ?? '−'}
                        </td>
                      )}
                      <td>{t.vendorName}</td>
                      <td>
                        <span className={`card-tx-category ${t.category === '매입' ? 'card-tx-cat-ht' : 'card-tx-cat-card'}`}>
                          {t.category}
                        </span>
                      </td>
                      <td className="num amt-expense">{fmtKrw(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

// ── 피벗 테이블 렌더링 ────────────────────────────────────────────────────────

function PivotTable({ rows, daysInMonth, year, month }: {
  rows: CashflowMonthlyRow[];
  daysInMonth: number;
  year: number;
  month: number;
}) {
  const dayNums = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  // 요일 계산 (0=일, 6=토)
  const weekdays = dayNums.map(d => new Date(year, month - 1, d).getDay());

  // check 그룹별로 묶기
  const groups: [string, CashflowMonthlyRow[]][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (!last || last[0] !== row.check) {
      groups.push([row.check, [row]]);
    } else {
      last[1].push(row);
    }
  }

  return (
    <div className="pivot-wrap">
      <table className="pivot-table">
        <thead>
          <tr>
            <th className="pivot-check sticky-col-1">체크</th>
            <th className="pivot-cat  sticky-col-2">구분</th>
            <th className="pivot-vendor sticky-col-3">거래처</th>
            <th className="pivot-total  sticky-col-4 num">지출금액</th>
            {dayNums.map(d => (
              <th key={d} className={`pivot-day num${weekdays[d - 1] === 0 ? ' pivot-day-sun' : weekdays[d - 1] === 6 ? ' pivot-day-sat' : ''}`}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(([check, groupRows]) => (
            <>
              {/* 그룹 헤더 행 */}
              <tr key={`gh-${check}`} className="pivot-group-header">
                <td colSpan={4 + daysInMonth}>{check}</td>
              </tr>
              {groupRows.map((row, ri) => {
                const totFmt = fmtAmt(row.total);
                return (
                  <tr key={`${check}-${ri}`} className={row.total > 0 ? 'pivot-row-income' : 'pivot-row-expense'}>
                    <td className="sticky-col-1 pivot-check">{row.check}</td>
                    <td className="sticky-col-2 pivot-cat">{row.category}</td>
                    <td className="sticky-col-3 pivot-vendor">{row.vendorName}</td>
                    <td className={`sticky-col-4 pivot-total num ${totFmt.cls}`}>{totFmt.text}</td>
                    {dayNums.map(d => {
                      const v = row.days[d];
                      if (!v) return <td key={d} className="pivot-day" />;
                      const { text, cls } = fmtAmt(v);
                      return <td key={d} className={`pivot-day num ${cls}`}>{text}</td>;
                    })}
                  </tr>
                );
              })}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 페이지 ─────────────────────────────────────────────────────────────────────

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CashflowPage({ searchParams }: Props) {
  const params       = await searchParams;
  const rawMonth     = typeof params.month === 'string' ? params.month : undefined;
  const { year, month, label } = parseMonth(rawMonth);
  const { prev, next }         = prevNextMonth(year, month);
  const daysInMonth  = new Date(year, month, 0).getDate();
  const startDate    = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate      = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const result = await fetchTable<DbEntry>(
    'cashflow_entries',
    (client) =>
      client
        .from('cashflow_entries')
        .select('id,company_code,entry_date,vendor_name,vendor_name_mapped,hometax_invoice_id,category,sub_category,income_amount,expense_amount,match_status,source_type,payment_source_type')
        .gte('entry_date', startDate)
        .lte('entry_date', endDate)
        .order('entry_date', { ascending: true }) as any,
  );

  // 거래처명: 홈택스 G열 → 고정비 E열 → 기존 vendor_name
  const htIds = result.status === 'ok'
    ? [...new Set(result.data.map(e => e.hometax_invoice_id).filter(Boolean))] as string[]
    : [];

  const [htResult, fcResult] = await Promise.all([
    htIds.length > 0
      ? fetchTable<HtVendorRef & { id: string }>(
          'hometax_invoices',
          (client) =>
            client
              .from('hometax_invoices')
              .select('id,source_type,vendor_name,customer_name')
              .in('id', htIds) as any,
        )
      : Promise.resolve({ status: 'ok' as const, data: [] as (HtVendorRef & { id: string })[] }),
    fetchTable<{ vendor_name: string; vendor_alias: string | null }>(
      'fixed_cost_rules',
      (client) =>
        client
          .from('fixed_cost_rules')
          .select('vendor_name,vendor_alias')
          .eq('is_active', true) as any,
    ),
  ]);

  const htById = new Map<string, HtVendorRef>();
  if (htResult.status === 'ok') {
    for (const ht of htResult.data) {
      htById.set(ht.id, ht);
    }
  }
  const fcAliasByVendorName = fcResult.status === 'ok'
    ? buildFcAliasMap(fcResult.data)
    : new Map<string, string>();

  const resolveVendor = (entry: DbEntry) =>
    resolveCashflowVendorName(entry, htById, fcAliasByVendorName);

  const resolveVendorByFields = (vendorName: string, hometaxInvoiceId: string | null) =>
    resolveCashflowVendorName(
      { vendor_name: vendorName, hometax_invoice_id: hometaxInvoiceId },
      htById,
      fcAliasByVendorName,
    );

  // 카드 결제 대상 기간: 카드별 사용기간이 다르므로 가장 넓은 범위로 한 번에 조회
  // 각 카드 그룹에서 해당 카드의 실제 기간으로 재필터링
  const cardRange = getWidestCardDateRange(year, month);
  const cardTxResult = await fetchTable<CardTxRow>(
    'card_transactions',
    (client) =>
      client
        .from('card_transactions')
        .select('id,used_date,merchant_name,amount,card_label,company_code,source_type')
        .gte('used_date', cardRange.from)
        .lte('used_date', cardRange.to)
        .eq('is_cancelled', false)
        .gt('amount', 0) as any,
  );

  const pivotRows    = result.status === 'ok' ? buildMonthlyPivot(result.data, daysInMonth, resolveVendor) : [];
  const summary      = result.status === 'ok' && result.data.length > 0
    ? buildCashflowMonthlySummary(result.data, monthStr(year, month), daysInMonth)
    : null;

  // 카드-홈택스 매칭: 해당 기간 카드 거래 중 홈택스 계산서와 매칭된 항목 조회
  const cardTxIds = cardTxResult.status === 'ok' ? cardTxResult.data.map(c => c.id) : [];
  const matchedCfResult = cardTxIds.length > 0
    ? await fetchTable<CardMatchRow>(
        'cashflow_entries',
        (client) =>
          client
            .from('cashflow_entries')
            .select('card_transaction_id,entry_date,category,vendor_name,hometax_invoice_id')
            .in('card_transaction_id', cardTxIds)
            .in('category', ['매입', '매출']) as any,
      )
    : ({ status: 'ok' as const, data: [] as CardMatchRow[] });

  const matchMap = new Map<string, CardMatchRow>();
  if (matchedCfResult.status === 'ok') {
    for (const row of matchedCfResult.data) {
      if (row.card_transaction_id) matchMap.set(row.card_transaction_id, row);
    }
  }

  const cardGroups = cardTxResult.status === 'ok'
    ? buildCardExpenseGroups(cardTxResult.data, matchMap, resolveVendorByFields, year, month)
    : [];

  return (
    <div className="page" style={{ maxWidth: '100%' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 className="page-title">자금수지현황표</h1>
          <p className="page-sub">월별 피벗 · 카드는 결제예정일 기준 집계</p>
        </div>
        <a href="/transactions" style={{ fontSize: 12, color: '#64748b', textDecoration: 'underline' }}>
          전체 원장 보기 →
        </a>
      </div>

      {/* 월 내비게이션 */}
      <div className="month-nav">
        <a href={`/cashflow?month=${prev}`}>◀ {prev}</a>
        <span className="month-label">{label}</span>
        <a href={`/cashflow?month=${next}`}>{next} ▶</a>
      </div>

      {/* 상태별 메시지 */}
      {result.status === 'env_missing'   && <EnvWarn />}
      {result.status === 'table_missing' && <DbErrWarn message="테이블 없음" code="42P01" />}
      {result.status === 'db_error'      && <DbErrWarn message={result.message} code={result.code} />}

      {result.status === 'ok' && result.data.length === 0 && (
        <div className="empty" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 48 }}>
          <p className="empty-title">해당 월의 자금수지 데이터가 없습니다</p>
          <p>먼저 <code>npm run db:import</code>를 실행하거나 다른 월을 선택하세요.</p>
        </div>
      )}

      {result.status === 'ok' && result.data.length > 0 && (
        <>
          {summary && <SummarySection summary={summary} daysInMonth={daysInMonth} year={year} month={month} />}
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            {result.data.length}건 · {pivotRows.length}개 행
            &nbsp;·&nbsp;
            <span className="amt-income">▲ 수입 (녹색)</span>
            &nbsp;&nbsp;
            <span className="amt-expense">▼ 지출 (빨강)</span>
          </p>
          <PivotTable rows={pivotRows} daysInMonth={daysInMonth} year={year} month={month} />
          <CardExpenseSection groups={cardGroups} cashflowLabel={label} />
        </>
      )}
    </div>
  );
}

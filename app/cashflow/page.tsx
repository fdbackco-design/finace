export const dynamic    = 'force-dynamic';
export const revalidate = 0;

import { fetchTable } from '@/src/lib/supabase/server';
import {
  buildMonthlyPivot,
  buildCashflowMonthlySummary,
  type DbEntry,
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
} from '@/src/lib/cards/settlement';
import {
  buildFcAliasMap,
  resolveCashflowVendorName,
  type HtVendorRef,
} from '@/src/lib/cashflow/resolveVendorName';
import PivotTable, { type PivotCardGroup, type PivotCardTx } from './PivotTable';

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
  const prev = month === 1  ? monthStr(year - 1, 12) : monthStr(year, month - 1);
  const next = month === 12 ? monthStr(year + 1, 1)  : monthStr(year, month + 1);
  return { prev, next };
}

// ── 에러 컴포넌트 ─────────────────────────────────────────────────────────────

function EnvWarn() {
  return (
    <div className="env-warn">
      <strong>⚠️ Supabase 환경변수가 설정되지 않았습니다.</strong><br />
      Vercel → Settings → Environment Variables 에 등록 후 Redeploy 하세요.<br /><br />
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

// ── 월간 요약 ─────────────────────────────────────────────────────────────────

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

  const dailyRequired: Record<number, number> = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const req = (daily.cashIncome[d] ?? 0) + (daily.salesCollection[d] ?? 0) - (daily.payablesAndFixedCosts[d] ?? 0);
    if (req !== 0) dailyRequired[d] = req;
  }
  const reqCls = totals.requiredMoney < 0 ? 'amt-expense' : totals.requiredMoney > 0 ? 'amt-income' : '';

  return (
    <div className="summary-section">
      <div className="summary-cards">
        <div className="summary-card summary-cash">
          <div className="summary-card-label">가수금 합계</div>
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
              <td className="sum-col-label">가수금</td>
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

// ── 카드 지출 그룹 빌더 ───────────────────────────────────────────────────────

type CardTxRow = {
  id:            string;
  used_date:     string | null;
  merchant_name: string | null;
  amount:        number;
  card_label:    string | null;
  company_code:  string;
  source_type:   string;
};

type CardMatchRow = {
  card_transaction_id: string;
  entry_date:          string;
  category:            string;
  vendor_name:         string | null;
  hometax_invoice_id:  string | null;
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

function buildCardGroups(
  rows:     CardTxRow[],
  matchMap: Map<string, CardMatchRow>,
  resolveVendor: (vendorName: string, hometaxInvoiceId: string | null) => string,
  year: number,
  month: number,
): PivotCardGroup[] {
  const map = new Map<CardLabel, {
    cardKey: string;
    label: string;
    period: { settlementDate: string; usedDateFrom: string; usedDateTo: string };
    txs: PivotCardTx[];
  }>();

  for (const c of rows) {
    const label: CardLabel | null =
      (c.card_label && VALID_CARD_LABELS.has(c.card_label)
        ? c.card_label as CardLabel
        : cardLabelFromEntry(c.company_code, c.source_type));
    if (!label) continue;

    const cardKey = cardLabelToKey(label);
    const period  = getCardPeriod(cardKey, year, month);

    if (c.used_date && (c.used_date < period.usedDateFrom || c.used_date > period.usedDateTo)) continue;

    if (!map.has(label)) {
      map.set(label, { cardKey, label, period, txs: [] });
    }

    const match       = matchMap.get(c.id);
    const isHtMatched = !!(match && match.category === '매입');
    const vendorName  = match
      ? resolveVendor(match.vendor_name ?? '', match.hometax_invoice_id)
      : (c.merchant_name ?? '');

    map.get(label)!.txs.push({
      id:          c.id,
      usedDate:    c.used_date ?? '',
      vendorName,
      amount:      c.amount,
      isHtMatched,
    });
  }

  return Array.from(map.values())
    .sort((a, b) => cardLabelSortOrder(a.label as CardLabel) - cardLabelSortOrder(b.label as CardLabel))
    .map(({ cardKey, label, period, txs }) => ({
      cardKey,
      label,
      period,
      transactions: txs.sort((a, b) => a.usedDate.localeCompare(b.usedDate)),
    }));
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

  // V2 컬럼 포함 쿼리 (매칭 완료 제외, show_in_cashflow=true만)
  const result = await fetchTable<DbEntry>(
    'cashflow_entries',
    (client) =>
      client
        .from('cashflow_entries')
        .select([
          'id,company_code,entry_date,vendor_name,vendor_name_mapped,vendor_name_override',
          'hometax_invoice_id,category,sub_category,display_category',
          'income_amount,expense_amount,match_status,source_type,payment_source_type',
          'amount_status,invoice_amount,actual_amount,accumulated_amount,remaining_amount,actual_date',
          'show_in_cashflow,group_id,group_name,group_order,is_completed,completed_at',
        ].join(','))
        .gte('entry_date', startDate)
        .lte('entry_date', endDate)
        .eq('is_completed', false)
        .neq('show_in_cashflow', false)
        .order('entry_date', { ascending: true }) as any,
  );

  // 거래처명 resolve용 HT 조회
  const htIds = result.status === 'ok'
    ? [...new Set(result.data.map((e: DbEntry) => e.hometax_invoice_id).filter(Boolean))] as string[]
    : [];

  const [htResult, fcResult, catResult] = await Promise.all([
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
    // 구분 항목 목록
    fetchTable<{ id: string; category_value: string; is_system: boolean; sort_order: number }>(
      'cashflow_category_items',
      (client) =>
        client
          .from('cashflow_category_items')
          .select('id,category_value,is_system,sort_order')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }) as any,
    ),
  ]);

  const htById = new Map<string, HtVendorRef>();
  if (htResult.status === 'ok') {
    for (const ht of htResult.data) htById.set(ht.id, ht);
  }
  const fcAliasByVendorName = fcResult.status === 'ok'
    ? buildFcAliasMap(fcResult.data)
    : new Map<string, string>();

  const categoryItems = catResult.status === 'ok'
    ? catResult.data.map(c => c.category_value)
    : [];

  const resolveVendor = (entry: DbEntry) => {
    // vendor_name_override가 있으면 우선
    if (entry.vendor_name_override) return entry.vendor_name_override;
    return resolveCashflowVendorName(entry, htById, fcAliasByVendorName);
  };

  const resolveVendorByFields = (vendorName: string, hometaxInvoiceId: string | null) =>
    resolveCashflowVendorName(
      { vendor_name: vendorName, hometax_invoice_id: hometaxInvoiceId },
      htById,
      fcAliasByVendorName,
    );

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

  const pivotRows = result.status === 'ok'
    ? buildMonthlyPivot(result.data, daysInMonth, resolveVendor)
    : [];
  const summary = result.status === 'ok' && result.data.length > 0
    ? buildCashflowMonthlySummary(result.data, monthStr(year, month), daysInMonth)
    : null;

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

  const cardGroups: PivotCardGroup[] = cardTxResult.status === 'ok'
    ? buildCardGroups(cardTxResult.data, matchMap, resolveVendorByFields, year, month)
    : [];

  return (
    <div className="page" style={{ maxWidth: '100%' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 className="page-title">자금수지현황표</h1>
          <p className="page-sub">월별 피벗 · 카드는 결제예정일 기준 집계</p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <a href="/cashflow/matched" style={{ fontSize: 12, color: '#7c3aed', textDecoration: 'underline', fontWeight: 600 }}>
            매칭 완료 내역 →
          </a>
          <a href="/transactions" style={{ fontSize: 12, color: '#64748b', textDecoration: 'underline' }}>
            전체 원장 보기 →
          </a>
        </div>
      </div>

      {/* 월 내비게이션 */}
      <div className="month-nav">
        <a href={`/cashflow?month=${prev}`}>◀ {prev}</a>
        <span className="month-label">{label}</span>
        <a href={`/cashflow?month=${next}`}>{next} ▶</a>
      </div>

      {result.status === 'env_missing'   && <EnvWarn />}
      {result.status === 'table_missing' && <DbErrWarn message="테이블 없음" code="42P01" />}
      {result.status === 'db_error'      && <DbErrWarn message={result.message} code={result.code} />}

      {result.status === 'ok' && result.data.length === 0 && (
        <div className="empty" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 48 }}>
          <p className="empty-title">해당 월의 자금수지 데이터가 없습니다</p>
          <p>먼저 파일을 업로드하거나 다른 월을 선택하세요.</p>
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
          <PivotTable
            rows={pivotRows}
            cardGroups={cardGroups}
            categoryItems={categoryItems}
            daysInMonth={daysInMonth}
            year={year}
            month={month}
          />
        </>
      )}
    </div>
  );
}

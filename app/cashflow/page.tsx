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

// ── 카드 지출 그룹 빌더 ───────────────────────────────────────────────────────

type CardExpenseGroup = {
  label: CardLabel;
  totalAmount: number;
  transactions: Array<{ id: string; date: string; vendorName: string; description: string | null; amount: number }>;
};

// card_transactions 직접 조회용 타입
// (CARD_WOORI는 cashflow_entries.entry_date가 익월 결제일이므로 used_date 기준으로 별도 조회)
type CardTxRow = {
  id:           string;
  used_date:    string | null;
  merchant_name: string | null;
  amount:       number;
  card_label:   string | null;
  company_code: string;
  source_type:  string;
};

const VALID_CARD_LABELS = new Set<string>([
  '상생 우리카드', '상생 기업카드', '피드백 우리카드', '피드백 기업카드',
]);

function buildCardExpenseGroups(rows: CardTxRow[]): CardExpenseGroup[] {
  const map = new Map<CardLabel, CardExpenseGroup>();

  for (const c of rows) {
    // card_label 컬럼 우선, 없으면 company_code+source_type fallback
    const label: CardLabel | null =
      (c.card_label && VALID_CARD_LABELS.has(c.card_label)
        ? c.card_label as CardLabel
        : cardLabelFromEntry(c.company_code, c.source_type));
    if (!label) continue;

    if (!map.has(label)) {
      map.set(label, { label, totalAmount: 0, transactions: [] });
    }
    const g = map.get(label)!;
    g.totalAmount += c.amount;
    g.transactions.push({
      id:          c.id,
      date:        c.used_date ?? '',
      vendorName:  c.merchant_name ?? '',
      description: null,
      amount:      c.amount,
    });
  }

  return Array.from(map.values()).sort(
    (a, b) => cardLabelSortOrder(a.label) - cardLabelSortOrder(b.label)
  );
}

// ── 카드 지출 섹션 ────────────────────────────────────────────────────────────

function CardExpenseSection({ groups }: { groups: CardExpenseGroup[] }) {
  if (groups.length === 0) return null;

  function fmtKrw(n: number): string {
    return new Intl.NumberFormat('ko-KR').format(n) + '원';
  }

  return (
    <div className="card-expense-section">
      <h2>카드 지출 상세</h2>
      {groups.map(g => (
        <details key={g.label} className="card-group">
          <summary>
            <span className="card-group-label">{g.label}</span>
            <span className="card-group-total">지출 합계 {fmtKrw(g.totalAmount)}</span>
          </summary>
          <div className="card-group-body">
            {g.transactions.length === 0 ? (
              <div className="card-group-empty">거래 내역이 없습니다.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>거래처</th>
                    {g.transactions.some(t => t.description) && <th>적요</th>}
                    <th className="num">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {g.transactions.map(t => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                      <td>{t.vendorName}</td>
                      {g.transactions.some(tx => tx.description) && (
                        <td style={{ color: '#64748b', fontSize: 11 }}>{t.description ?? ''}</td>
                      )}
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
        .select('id,company_code,entry_date,vendor_name,category,sub_category,income_amount,expense_amount,match_status,source_type,payment_source_type')
        .gte('entry_date', startDate)
        .lte('entry_date', endDate)
        .order('entry_date', { ascending: true }) as any,
  );

  // card_transactions 직접 조회: CARD_WOORI는 entry_date가 익월(결제일)이므로
  // used_date(사용일) 기준으로 별도 조회해야 당월 카드 내역이 표시됨
  const cardTxResult = await fetchTable<CardTxRow>(
    'card_transactions',
    (client) =>
      client
        .from('card_transactions')
        .select('id,used_date,merchant_name,amount,card_label,company_code,source_type')
        .gte('used_date', startDate)
        .lte('used_date', endDate)
        .eq('is_cancelled', false)
        .gt('amount', 0) as any,
  );

  const pivotRows    = result.status === 'ok' ? buildMonthlyPivot(result.data, daysInMonth) : [];
  const summary      = result.status === 'ok' && result.data.length > 0
    ? buildCashflowMonthlySummary(result.data, monthStr(year, month), daysInMonth)
    : null;
  const cardGroups   = cardTxResult.status === 'ok' ? buildCardExpenseGroups(cardTxResult.data) : [];

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
          <CardExpenseSection groups={cardGroups} />
        </>
      )}
    </div>
  );
}

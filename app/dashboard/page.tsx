export const dynamic    = 'force-dynamic';
export const revalidate = 0;

import { fetchTable } from '@/src/lib/supabase/server';
import {
  buildBalanceRows,
  buildCardUsageRows,
  buildLatestBalanceMap,
  formatTodayKo,
  monthRangeToToday,
  sumKrwBalances,
} from '@/src/lib/dashboard/buildDashboardData';

type CardTx = {
  amount:        number;
  used_date:     string | null;
  card_label:    string | null;
  company_code:  string;
  source_type:   string;
  is_cancelled:  boolean;
};

type BankTx = {
  company_code:     string;
  source_type:      string;
  balance:          number | null;
  transaction_date: string;
  transaction_time: string | null;
};

function fmtKrw(n: number | null): string {
  if (n == null) return '₩  -';
  return `₩  ${new Intl.NumberFormat('ko-KR').format(n)}`;
}

function fmtUsd(): string {
  return '$  -';
}

function fmtCardAmt(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(n);
}

function companyRowClass(code: string): string {
  if (code === 'feedback')  return 'dash-co-feedback';
  if (code === 'sangsaeng') return 'dash-co-sangsaeng';
  if (code === 'shootmoon') return 'dash-co-shootmoon';
  return '';
}

export default async function DashboardPage() {
  const now        = new Date();
  const { ampm, dateLabel } = formatTodayKo(now);
  const { from, to }        = monthRangeToToday(now);

  const [cardResult, bankResult] = await Promise.all([
    fetchTable<CardTx>(
      'card_transactions',
      (client) =>
        client
          .from('card_transactions')
          .select('amount,used_date,card_label,company_code,source_type,is_cancelled')
          .gte('used_date', from)
          .lte('used_date', to)
          .eq('is_cancelled', false)
          .gt('amount', 0) as any,
    ),
    fetchTable<BankTx>(
      'bank_transactions',
      (client) =>
        client
          .from('bank_transactions')
          .select('company_code,source_type,balance,transaction_date,transaction_time')
          .not('balance', 'is', null)
          .order('transaction_date', { ascending: false })
          .order('transaction_time', { ascending: false })
          .limit(5000) as any,
    ),
  ]);

  const cardRows    = cardResult.status === 'ok' ? buildCardUsageRows(cardResult.data) : [];
  const balanceMap  = bankResult.status === 'ok' ? buildLatestBalanceMap(bankResult.data) : new Map();
  const balanceRows = buildBalanceRows(balanceMap);
  const totalKrw    = sumKrwBalances(balanceRows);
  const hasData     = cardRows.length > 0 || balanceRows.some(r => r.balance != null);

  return (
    <div className="page page-dashboard">
      <h1 className="page-title">대시보드</h1>
      <p className="page-sub">이번 달 카드 사용액 · 계좌 현재잔액</p>

      {cardResult.status === 'env_missing' && (
        <div className="env-warn">
          <strong>⚠️ Supabase 환경변수가 설정되지 않았습니다.</strong><br />
          Vercel Dashboard → Settings → Environment Variables 에 3개를 등록하고 <strong>Redeploy</strong> 하세요.
        </div>
      )}

      {(cardResult.status === 'db_error' || cardResult.status === 'table_missing') && (
        <div className="env-warn" style={{ background: '#fef2f2', borderColor: '#fca5a5' }}>
          <strong>⚠️ DB 조회 오류</strong>
          {'message' in cardResult && cardResult.message && (
            <><br /><code style={{ fontSize: 12 }}>{cardResult.message}</code></>
          )}
        </div>
      )}

      {cardResult.status === 'ok' && !hasData && (
        <div className="table-wrap">
          <div className="empty">
            <p className="empty-title">표시할 데이터가 없습니다</p>
            <p>은행·카드 파일을 업로드하거나 <code>npm run db:import</code>를 실행하세요.</p>
          </div>
        </div>
      )}

      {cardResult.status === 'ok' && (
        <div className="dashboard-board">
          {/* ── 신용카드 이번 달 사용액 ── */}
          <section className="dash-section">
            <div className="dash-section-header">
              <span className="dash-ampm">{ampm}</span>
              <span className="dash-date">{dateLabel}</span>
            </div>
            <table className="dash-card-table">
              <tbody>
                {cardRows.map(row => (
                  <tr key={row.label} className={companyRowClass(row.companyCode)}>
                    <td className="dash-card-label">{row.label}</td>
                    <td className="dash-card-amount num">{fmtCardAmt(row.amount)}</td>
                  </tr>
                ))}
                {cardRows.length === 0 && (
                  <tr>
                    <td colSpan={2} className="dash-empty-cell">이번 달 카드 사용 내역 없음</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {/* ── 계좌 현재잔액 ── */}
          <section className="dash-section">
            <table className="dash-balance-table">
              <thead>
                <tr>
                  <th className="dash-balance-co">상 호</th>
                  <th className="dash-balance-acct" />
                  <th className="dash-balance-amt num">현재잔액</th>
                </tr>
              </thead>
              <tbody>
                {balanceRows.map((row, i) => (
                  <tr key={`${row.companyCode}-${row.accountLabel}-${i}`} className={companyRowClass(row.companyCode)}>
                    {row.showCompany && (
                      <td className="dash-balance-co" rowSpan={row.rowSpan}>
                        {row.companyLabel}
                      </td>
                    )}
                    <td className="dash-balance-acct">{row.accountLabel}</td>
                    <td className="dash-balance-amt num">
                      {row.currency === 'USD' ? fmtUsd() : fmtKrw(row.balance)}
                    </td>
                  </tr>
                ))}
                {balanceRows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="dash-empty-cell">잔액 데이터 없음</td>
                  </tr>
                )}
              </tbody>
              {balanceRows.length > 0 && (
                <tfoot>
                  <tr className="dash-total-row">
                    <td colSpan={2} className="dash-balance-co">합 계</td>
                    <td className="dash-balance-amt num dash-total-amt">
                      {new Intl.NumberFormat('ko-KR').format(totalKrw)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </section>
        </div>
      )}
    </div>
  );
}

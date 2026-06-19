export const dynamic   = 'force-dynamic';
export const revalidate = 0;

import { fetchTable } from '@/src/lib/supabase/server';

type Entry = {
  company_code: string;
  match_status: string;
  category: string;
  income_amount: number;
  expense_amount: number;
};

function groupCount<T>(arr: T[], key: keyof T): Record<string, number> {
  const map: Record<string, number> = {};
  arr.forEach(item => {
    const v = String(item[key] ?? 'null');
    map[v] = (map[v] ?? 0) + 1;
  });
  return map;
}

function sumBy<T>(arr: T[], key: keyof T): number {
  return arr.reduce((s, item) => s + ((item[key] as number) ?? 0), 0);
}

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(n);
}

const COMPANY_LABEL: Record<string, string> = {
  feedback:  '피드백',
  sangsaeng: '상생',
  shootmoon: '슛문',
};

const STATUS_ORDER = ['AUTO_MATCHED', 'MANUAL_REVIEW', 'UNMATCHED', 'USER_CONFIRMED', 'USER_EDITED', 'EXCLUDED'];
const STATUS_COLOR: Record<string, string> = {
  AUTO_MATCHED:   '#16a34a',
  MANUAL_REVIEW:  '#d97706',
  UNMATCHED:      '#dc2626',
  USER_CONFIRMED: '#2563eb',
  USER_EDITED:    '#7c3aed',
  EXCLUDED:       '#64748b',
};

export default async function DashboardPage() {
  const result = await fetchTable<Entry>(
    'cashflow_entries',
    (client) =>
      client
        .from('cashflow_entries')
        .select('company_code,match_status,category,income_amount,expense_amount') as any,
  );

  return (
    <div className="page">
      <h1 className="page-title">대시보드</h1>
      <p className="page-sub">전체 자금수지현황 요약</p>

      {result.status === 'env_missing' && (
        <div className="env-warn">
          <strong>⚠️ Supabase 환경변수가 설정되지 않았습니다.</strong><br />
          Vercel Dashboard → Settings → Environment Variables 에 아래 3개를 등록하고 <strong>Redeploy</strong> 하세요.<br /><br />
          &nbsp;• NEXT_PUBLIC_SUPABASE_URL<br />
          &nbsp;• NEXT_PUBLIC_SUPABASE_ANON_KEY<br />
          &nbsp;• SUPABASE_SERVICE_ROLE_KEY<br /><br />
          진단: <a href="/api/env-check" target="_blank" style={{ color: '#92400e', textDecoration: 'underline' }}>/api/env-check</a>
          &nbsp;·&nbsp;
          <a href="/api/db-check" target="_blank" style={{ color: '#92400e', textDecoration: 'underline' }}>/api/db-check</a>
        </div>
      )}

      {(result.status === 'db_error' || result.status === 'table_missing') && (
        <div className="env-warn" style={{ background: '#fef2f2', borderColor: '#fca5a5' }}>
          <strong>⚠️ {result.status === 'table_missing' ? 'cashflow_entries 테이블을 찾을 수 없습니다. migration 실행 여부를 확인하세요.' : 'Supabase 연결은 됐지만 DB 조회 중 오류가 발생했습니다.'}</strong><br />
          {'message' in result && result.message && <><code style={{ fontSize: 12 }}>{result.message}</code><br /></>}
          진단: <a href="/api/db-check" target="_blank" style={{ color: '#991b1b', textDecoration: 'underline' }}>/api/db-check</a>
        </div>
      )}

      {result.status === 'ok' && result.data.length === 0 && (
        <div className="table-wrap">
          <div className="empty">
            <p className="empty-title">아직 적재된 데이터가 없습니다</p>
            <p>로컬에서 <code>npm run db:import</code>를 실행한 뒤 다시 확인하세요.</p>
          </div>
        </div>
      )}

      {result.status === 'ok' && result.data.length > 0 && (() => {
        const entries     = result.data;
        const total       = entries.length;
        const totalIncome  = sumBy(entries, 'income_amount');
        const totalExpense = sumBy(entries, 'expense_amount');
        const byCompany    = groupCount(entries, 'company_code');
        const byStatus     = groupCount(entries, 'match_status');
        const byCategory   = groupCount(entries, 'category');

        return (
          <>
            <div className="card-grid">
              <div className="card">
                <p className="card-label">총 건수</p>
                <p className="card-value">{fmt(total)}</p>
              </div>
              <div className="card">
                <p className="card-label">총 입금액</p>
                <p className="card-value" style={{ fontSize: 18, color: '#16a34a' }}>{fmt(totalIncome)}</p>
              </div>
              <div className="card">
                <p className="card-label">총 지출액</p>
                <p className="card-value" style={{ fontSize: 18, color: '#dc2626' }}>{fmt(totalExpense)}</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th colSpan={2}>회사별 건수</th></tr>
                    <tr><th>회사</th><th className="num">건수</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(byCompany).map(([co, cnt]) => (
                      <tr key={co}>
                        <td>{COMPANY_LABEL[co] ?? co}</td>
                        <td className="num">{fmt(cnt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th colSpan={3}>매칭 상태별</th></tr>
                    <tr><th>상태</th><th className="num">건수</th><th className="num">비율</th></tr>
                  </thead>
                  <tbody>
                    {STATUS_ORDER.filter(s => byStatus[s] !== undefined).map(s => (
                      <tr key={s}>
                        <td><span style={{ color: STATUS_COLOR[s], fontWeight: 600 }}>{s}</span></td>
                        <td className="num">{fmt(byStatus[s])}</td>
                        <td className="num" style={{ color: '#64748b' }}>
                          {total > 0 ? `${((byStatus[s] / total) * 100).toFixed(1)}%` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th colSpan={3}>구분(category)별</th></tr>
                    <tr><th>구분</th><th className="num">건수</th><th className="num">비율</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(byCategory)
                      .sort((a, b) => b[1] - a[1])
                      .map(([cat, cnt]) => (
                        <tr key={cat}>
                          <td>{cat}</td>
                          <td className="num">{fmt(cnt)}</td>
                          <td className="num" style={{ color: '#64748b' }}>
                            {total > 0 ? `${((cnt / total) * 100).toFixed(1)}%` : ''}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

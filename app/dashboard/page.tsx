export const dynamic = 'force-dynamic';

import { createServerClient } from '@/src/lib/supabase/server';

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

async function getAll() {
  const client = createServerClient();
  if (!client) return null;

  const { data, error } = await client
    .from('cashflow_entries')
    .select('company_code,match_status,category,income_amount,expense_amount');

  if (error) return null;
  return data as Entry[];
}

export default async function DashboardPage() {
  const entries = await getAll();

  if (entries === null) {
    return (
      <div className="page">
        <h1 className="page-title">대시보드</h1>
        <div className="env-warn">
          ⚠️ Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)를 설정해주세요.
        </div>
      </div>
    );
  }

  const total         = entries.length;
  const totalIncome   = sumBy(entries, 'income_amount');
  const totalExpense  = sumBy(entries, 'expense_amount');
  const byCompany     = groupCount(entries, 'company_code');
  const byStatus      = groupCount(entries, 'match_status');
  const byCategory    = groupCount(entries, 'category');

  const STATUS_ORDER = ['AUTO_MATCHED', 'MANUAL_REVIEW', 'UNMATCHED', 'USER_CONFIRMED', 'USER_EDITED', 'EXCLUDED'];
  const STATUS_COLOR: Record<string, string> = {
    AUTO_MATCHED:   '#16a34a',
    MANUAL_REVIEW:  '#d97706',
    UNMATCHED:      '#dc2626',
    USER_CONFIRMED: '#2563eb',
    USER_EDITED:    '#7c3aed',
    EXCLUDED:       '#64748b',
  };

  return (
    <div className="page">
      <h1 className="page-title">대시보드</h1>
      <p className="page-sub">전체 자금수지현황 요약</p>

      {/* 전체 요약 */}
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

        {/* 회사별 */}
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

        {/* 매칭 상태별 */}
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

        {/* 구분별 */}
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
    </div>
  );
}

export const dynamic = 'force-dynamic';

import { createServerClient } from '@/src/lib/supabase/server';

const COMPANY_LABEL: Record<string, string> = {
  feedback:  '피드백',
  sangsaeng: '상생',
  shootmoon: '슛문',
};

const STATUS_BADGE: Record<string, string> = {
  AUTO_MATCHED:   'badge-green',
  MANUAL_REVIEW:  'badge-yellow',
  UNMATCHED:      'badge-red',
  USER_CONFIRMED: 'badge-green',
  USER_EDITED:    'badge-green',
  EXCLUDED:       'badge-gray',
};

function fmt(n: number) {
  return n > 0 ? new Intl.NumberFormat('ko-KR').format(n) : '';
}

async function getEntries() {
  const client = createServerClient();
  if (!client) return null;

  const { data, error } = await client
    .from('cashflow_entries')
    .select('id,company_code,entry_date,vendor_name,category,sub_category,income_amount,expense_amount,match_status')
    .order('entry_date', { ascending: false })
    .limit(100);

  if (error) return null;
  return data as any[];
}

export default async function CashflowPage() {
  const entries = await getEntries();

  return (
    <div className="page">
      <h1 className="page-title">자금수지현황표</h1>
      <p className="page-sub">최근 100건 · 날짜 내림차순</p>

      {entries === null && (
        <div className="env-warn">
          ⚠️ Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)를 설정해주세요.
        </div>
      )}

      {entries !== null && entries.length === 0 && (
        <div className="table-wrap">
          <div className="empty">
            <p className="empty-title">아직 적재된 데이터가 없습니다</p>
            <p>npm run db:import 를 실행해 데이터를 적재하세요.</p>
          </div>
        </div>
      )}

      {entries !== null && entries.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>회사</th>
                <th>날짜</th>
                <th>거래처</th>
                <th>구분</th>
                <th>세부</th>
                <th className="num">입금액</th>
                <th className="num">지출액</th>
                <th>매칭상태</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{COMPANY_LABEL[e.company_code] ?? e.company_code}</td>
                  <td>{e.entry_date}</td>
                  <td>{e.vendor_name}</td>
                  <td>{e.category}</td>
                  <td style={{ color: '#64748b' }}>{e.sub_category}</td>
                  <td className="num" style={{ color: '#16a34a' }}>{fmt(e.income_amount)}</td>
                  <td className="num" style={{ color: '#dc2626' }}>{fmt(e.expense_amount)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[e.match_status] ?? 'badge-gray'}`}>
                      {e.match_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

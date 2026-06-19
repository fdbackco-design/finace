export const dynamic   = 'force-dynamic';
export const revalidate = 0;

import { fetchTable } from '@/src/lib/supabase/server';

type CashflowRow = {
  id: string;
  company_code: string;
  entry_date: string;
  vendor_name: string;
  category: string;
  sub_category: string | null;
  income_amount: number;
  expense_amount: number;
  match_status: string;
};

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

function EnvWarn() {
  return (
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
  );
}

function DbErrorWarn({ message, code }: { message: string; code?: string }) {
  const isTableMissing = code === '42P01' || code === 'PGRST200';
  return (
    <div className="env-warn" style={{ background: '#fef2f2', borderColor: '#fca5a5' }}>
      {isTableMissing ? (
        <>
          <strong>⚠️ cashflow_entries 테이블을 찾을 수 없습니다.</strong><br />
          Supabase Dashboard → SQL Editor 에서 <code>001_init_finance_schema.sql</code> migration을 실행했는지 확인하세요.<br /><br />
          진단: <a href="/api/db-check" target="_blank" style={{ color: '#991b1b', textDecoration: 'underline' }}>/api/db-check</a>
        </>
      ) : (
        <>
          <strong>⚠️ Supabase 연결은 됐지만 DB 조회 중 오류가 발생했습니다.</strong><br />
          {message && <><code style={{ fontSize: 12 }}>{message}</code><br /></>}
          진단: <a href="/api/db-check" target="_blank" style={{ color: '#991b1b', textDecoration: 'underline' }}>/api/db-check</a>
        </>
      )}
    </div>
  );
}

export default async function CashflowPage() {
  const result = await fetchTable<CashflowRow>(
    'cashflow_entries',
    (client) =>
      client
        .from('cashflow_entries')
        .select('id,company_code,entry_date,vendor_name,category,sub_category,income_amount,expense_amount,match_status')
        .order('entry_date', { ascending: false })
        .limit(100) as any,
  );

  return (
    <div className="page">
      <h1 className="page-title">자금수지현황표</h1>
      <p className="page-sub">최근 100건 · 날짜 내림차순</p>

      {result.status === 'env_missing'    && <EnvWarn />}
      {result.status === 'table_missing'  && <DbErrorWarn message="테이블이 없습니다" code="42P01" />}
      {result.status === 'db_error'       && <DbErrorWarn message={result.message} code={result.code} />}

      {result.status === 'ok' && result.data.length === 0 && (
        <div className="table-wrap">
          <div className="empty">
            <p className="empty-title">아직 적재된 데이터가 없습니다</p>
            <p>로컬에서 <code>npm run db:import</code>를 실행한 뒤 다시 확인하세요.</p>
          </div>
        </div>
      )}

      {result.status === 'ok' && result.data.length > 0 && (
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
              {result.data.map((e) => (
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

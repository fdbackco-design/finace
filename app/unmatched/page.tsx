export const dynamic   = 'force-dynamic';
export const revalidate = 0;

import { fetchTable } from '@/src/lib/supabase/server';
import { formatMatchReason } from '@/src/lib/matching/formatMatchReason';

type UnmatchedRow = {
  id: string;
  company_code: string;
  entry_date: string;
  vendor_name: string;
  category: string;
  sub_category: string | null;
  income_amount: number;
  expense_amount: number;
  match_status: string;
  match_reason: string | null;
  source_type: string;
};

const COMPANY_LABEL: Record<string, string> = {
  feedback:  '피드백',
  sangsaeng: '상생',
  shootmoon: '슛문',
};

function fmt(n: number) {
  return n > 0 ? new Intl.NumberFormat('ko-KR').format(n) : '';
}

export default async function UnmatchedPage() {
  const result = await fetchTable<UnmatchedRow>(
    'cashflow_entries',
    (client) =>
      client
        .from('cashflow_entries')
        .select('id,company_code,entry_date,vendor_name,category,sub_category,income_amount,expense_amount,match_status,match_reason,source_type')
        .in('match_status', ['MANUAL_REVIEW', 'UNMATCHED'])
        .neq('category', '카드지출')       // 카드 내역은 자금수지현황에서 별도 관리
        .order('entry_date', { ascending: false })
        .limit(200) as any,
  );

  const data         = result.status === 'ok' ? result.data : [];
  const manualCount  = data.filter(e => e.match_status === 'MANUAL_REVIEW').length;
  const unmatchCount = data.filter(e => e.match_status === 'UNMATCHED').length;

  return (
    <div className="page page-unmatched">
      <h1 className="page-title">미매칭 검토</h1>
      <p className="page-sub">MANUAL_REVIEW + UNMATCHED 항목 (최대 200건)</p>

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

      {result.status === 'ok' && (
        <>
          <div className="card-grid" style={{ marginBottom: 20 }}>
            <div className="card">
              <p className="card-label">수동검토 필요</p>
              <p className="card-value" style={{ color: '#d97706' }}>{manualCount}</p>
            </div>
            <div className="card">
              <p className="card-label">미매칭</p>
              <p className="card-value" style={{ color: '#dc2626' }}>{unmatchCount}</p>
            </div>
          </div>

          {result.data.length === 0 ? (
            <div className="table-wrap">
              <div className="empty">
                <p className="empty-title">미매칭 항목이 없습니다</p>
                <p>모든 거래가 매칭 완료됐거나, 아직 <code>npm run db:import</code>를 실행하지 않았습니다.</p>
              </div>
            </div>
          ) : (
            <div className="table-wrap unmatched-table-wrap">
              <table className="unmatched-table">
                <thead>
                  <tr>
                    <th className="col-status">상태</th>
                    <th className="col-company">회사</th>
                    <th className="col-date">날짜</th>
                    <th className="col-vendor">거래처</th>
                    <th className="col-category">구분</th>
                    <th className="col-source">원천</th>
                    <th className="num col-amount">입금액</th>
                    <th className="num col-amount">지출액</th>
                    <th className="col-reason">매칭근거</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((e) => (
                    <tr key={e.id}>
                      <td className="col-status">
                        <span className={`badge ${e.match_status === 'MANUAL_REVIEW' ? 'badge-yellow' : 'badge-red'}`}>
                          {e.match_status === 'MANUAL_REVIEW' ? '검토필요' : '미매칭'}
                        </span>
                      </td>
                      <td className="col-company">{COMPANY_LABEL[e.company_code] ?? e.company_code}</td>
                      <td className="col-date">{e.entry_date}</td>
                      <td className="col-vendor">{e.vendor_name}</td>
                      <td className="col-category">{e.category}</td>
                      <td className="col-source">{e.source_type}</td>
                      <td className="num col-amount" style={{ color: '#16a34a' }}>{fmt(e.income_amount)}</td>
                      <td className="num col-amount" style={{ color: '#dc2626' }}>{fmt(e.expense_amount)}</td>
                      <td className="col-reason">{formatMatchReason(e.match_reason)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

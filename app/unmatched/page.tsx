export const dynamic = 'force-dynamic';

import { createServerClient } from '@/src/lib/supabase/server';

const COMPANY_LABEL: Record<string, string> = {
  feedback:  '피드백',
  sangsaeng: '상생',
  shootmoon: '슛문',
};

function fmt(n: number) {
  return n > 0 ? new Intl.NumberFormat('ko-KR').format(n) : '';
}

async function getUnmatched() {
  const client = createServerClient();
  if (!client) return null;

  const { data, error } = await client
    .from('cashflow_entries')
    .select('id,company_code,entry_date,vendor_name,category,sub_category,income_amount,expense_amount,match_status,match_reason,source_type')
    .in('match_status', ['MANUAL_REVIEW', 'UNMATCHED'])
    .order('entry_date', { ascending: false })
    .limit(200);

  if (error) return null;
  return data as any[];
}

export default async function UnmatchedPage() {
  const entries = await getUnmatched();

  const manualCount  = entries?.filter(e => e.match_status === 'MANUAL_REVIEW').length ?? 0;
  const unmatchCount = entries?.filter(e => e.match_status === 'UNMATCHED').length ?? 0;

  return (
    <div className="page">
      <h1 className="page-title">미매칭 검토</h1>
      <p className="page-sub">MANUAL_REVIEW + UNMATCHED 항목 (최대 200건)</p>

      {entries === null && (
        <div className="env-warn">
          <strong>⚠️ Supabase 환경변수가 설정되지 않았습니다.</strong><br />
          Vercel Dashboard → Settings → Environment Variables 에 아래 3개를 등록하고 <strong>Redeploy</strong> 하세요.<br /><br />
          &nbsp;• NEXT_PUBLIC_SUPABASE_URL<br />
          &nbsp;• NEXT_PUBLIC_SUPABASE_ANON_KEY<br />
          &nbsp;• SUPABASE_SERVICE_ROLE_KEY<br /><br />
          등록 확인: <a href="/api/env-check" target="_blank" style={{ color: '#92400e', textDecoration: 'underline' }}>/api/env-check</a>
        </div>
      )}

      {entries !== null && (
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

          {entries.length === 0 ? (
            <div className="table-wrap">
              <div className="empty">
                <p className="empty-title">미매칭 항목이 없습니다 🎉</p>
                <p>모든 거래가 매칭 완료되었습니다.</p>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>상태</th>
                    <th>회사</th>
                    <th>날짜</th>
                    <th>거래처</th>
                    <th>구분</th>
                    <th>원천</th>
                    <th className="num">입금액</th>
                    <th className="num">지출액</th>
                    <th>매칭근거</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <span className={`badge ${e.match_status === 'MANUAL_REVIEW' ? 'badge-yellow' : 'badge-red'}`}>
                          {e.match_status === 'MANUAL_REVIEW' ? '검토필요' : '미매칭'}
                        </span>
                      </td>
                      <td>{COMPANY_LABEL[e.company_code] ?? e.company_code}</td>
                      <td>{e.entry_date}</td>
                      <td>{e.vendor_name}</td>
                      <td>{e.category}</td>
                      <td style={{ color: '#64748b', fontSize: 12 }}>{e.source_type}</td>
                      <td className="num" style={{ color: '#16a34a' }}>{fmt(e.income_amount)}</td>
                      <td className="num" style={{ color: '#dc2626' }}>{fmt(e.expense_amount)}</td>
                      <td style={{ color: '#64748b', fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.match_reason}
                      </td>
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

export const dynamic    = 'force-dynamic';
export const revalidate = 0;

import { fetchTable } from '@/src/lib/supabase/server';

type Row = {
  id: string;
  company_code: string;
  entry_date: string;
  vendor_name: string;
  category: string;
  sub_category: string | null;
  income_amount: number;
  expense_amount: number;
  match_status: string;
  source_type: string;
};

const COMPANY: Record<string, string> = {
  feedback:  '피드백',
  sangsaeng: '상생',
  shootmoon: '슛문',
};

const STATUS_CLS: Record<string, string> = {
  MATCHED:       'badge badge-green',
  MANUAL_REVIEW: 'badge badge-yellow',
  UNMATCHED:     'badge badge-red',
  IMPORTED:      'badge badge-gray',
};

function fmtKRW(v: number) {
  return v > 0 ? new Intl.NumberFormat('ko-KR').format(v) : '';
}

function EnvWarn() {
  return (
    <div className="env-warn">
      <strong>⚠️ Supabase 환경변수가 설정되지 않았습니다.</strong><br />
      Vercel Dashboard → Settings → Environment Variables 에 3개를 등록하고 Redeploy 하세요.
    </div>
  );
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TransactionsPage({ searchParams }: Props) {
  const params  = await searchParams;
  const rawPage = typeof params.page === 'string' ? parseInt(params.page, 10) : 1;
  const page    = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const limit   = 100;
  const offset  = (page - 1) * limit;

  const result = await fetchTable<Row>(
    'cashflow_entries',
    (client) =>
      client
        .from('cashflow_entries')
        .select('id,company_code,entry_date,vendor_name,category,sub_category,income_amount,expense_amount,match_status,source_type')
        .order('entry_date', { ascending: false })
        .range(offset, offset + limit - 1) as any,
  );

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 className="page-title">전체 원장</h1>
          <p className="page-sub">cashflow_entries — 최신순, 100건씩</p>
        </div>
        <a href="/cashflow" style={{ fontSize: 12, color: '#64748b', textDecoration: 'underline' }}>
          ← 자금수지현황표
        </a>
      </div>

      {result.status === 'env_missing'   && <EnvWarn />}
      {result.status === 'table_missing' && (
        <div className="env-warn" style={{ background: '#fef2f2', borderColor: '#fca5a5' }}>
          <strong>⚠️ cashflow_entries 테이블이 없습니다.</strong> migration을 먼저 실행하세요.
        </div>
      )}
      {result.status === 'db_error' && (
        <div className="env-warn" style={{ background: '#fef2f2', borderColor: '#fca5a5' }}>
          <strong>⚠️ DB 조회 오류:</strong> <code style={{ fontSize: 11 }}>{result.message}</code>
        </div>
      )}

      {result.status === 'ok' && result.data.length === 0 && (
        <div className="empty">
          <p className="empty-title">데이터가 없습니다</p>
          <p>먼저 <code>npm run db:import</code>를 실행하세요.</p>
        </div>
      )}

      {result.status === 'ok' && result.data.length > 0 && (
        <>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            {offset + 1}–{offset + result.data.length}건 표시
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>회사</th>
                  <th>구분</th>
                  <th>거래처</th>
                  <th>출처</th>
                  <th className="num">입금</th>
                  <th className="num">출금</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((row) => (
                  <tr key={row.id}>
                    <td style={{ whiteSpace: 'nowrap', color: '#475569' }}>{row.entry_date}</td>
                    <td>{COMPANY[row.company_code] ?? row.company_code}</td>
                    <td>{row.category}{row.sub_category ? ` / ${row.sub_category}` : ''}</td>
                    <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.vendor_name}
                    </td>
                    <td style={{ fontSize: 11, color: '#94a3b8' }}>{row.source_type}</td>
                    <td className="num" style={{ color: '#16a34a' }}>{fmtKRW(row.income_amount)}</td>
                    <td className="num" style={{ color: '#dc2626' }}>{fmtKRW(row.expense_amount)}</td>
                    <td>
                      <span className={STATUS_CLS[row.match_status] ?? 'badge badge-gray'}>
                        {row.match_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 16, justifyContent: 'center' }}>
            {page > 1 && (
              <a href={`/transactions?page=${page - 1}`} className="btn btn-outline" style={{ padding: '8px 20px', fontSize: 13 }}>
                ◀ 이전
              </a>
            )}
            {result.data.length === limit && (
              <a href={`/transactions?page=${page + 1}`} className="btn btn-outline" style={{ padding: '8px 20px', fontSize: 13 }}>
                다음 ▶
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}

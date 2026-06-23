/**
 * /cashflow/matched — 매칭 완료 내역 페이지
 * 납부 날짜 오름차순, 납부 날짜 없으면 목록 하단
 */
export const dynamic    = 'force-dynamic';
export const revalidate = 0;

import { fetchTable } from '@/src/lib/supabase/server';
import MatchedTable from './MatchedTable';

type MatchedEntry = {
  id:               string;
  company_code:     string;
  entry_date:       string;
  vendor_name:      string;
  vendor_name_override: string | null;
  display_category: string | null;
  category:         string;
  income_amount:    number;
  expense_amount:   number;
  actual_date:      string | null;
  amount_status:    string | null;
  completed_at:     string | null;
  completed_by:     string | null;
  completed_method: string | null;
  match_status:     string;
  invoice_amount:   number;
  actual_amount:    number;
  remaining_amount: number;
};

function fmtDate(d: string | null): string {
  if (!d) return '';
  return d.slice(0, 10);
}

function fmtKrw(n: number): string {
  if (!n) return '-';
  return new Intl.NumberFormat('ko-KR').format(Math.abs(n));
}

function parseMonth(raw: string | undefined): string {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) return raw;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MatchedPage({ searchParams }: Props) {
  const params       = await searchParams;
  const rawMonth     = typeof params.month === 'string' ? params.month : undefined;
  const month        = parseMonth(rawMonth);
  const [y, m]       = month.split('-').map(Number);
  const daysInMonth  = new Date(y, m, 0).getDate();
  const startDate    = `${month}-01`;
  const endDate      = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  const result = await fetchTable<MatchedEntry>(
    'cashflow_entries',
    (client) =>
      client
        .from('cashflow_entries')
        .select([
          'id,company_code,entry_date,vendor_name,vendor_name_override',
          'display_category,category,income_amount,expense_amount',
          'actual_date,amount_status,completed_at,completed_by,completed_method',
          'match_status,invoice_amount,actual_amount,remaining_amount',
        ].join(','))
        .eq('is_completed', true)
        .gte('entry_date', startDate)
        .lte('entry_date', endDate)
        .order('actual_date', { ascending: true, nullsFirst: false }) as any,
  );

  const entries: MatchedEntry[] = result.status === 'ok' ? result.data : [];

  // 납부 날짜 있는 것 → 오름차순, 없는 것 → 하단
  const withDate    = entries.filter(e => e.actual_date).sort((a, b) => (a.actual_date ?? '').localeCompare(b.actual_date ?? ''));
  const withoutDate = entries.filter(e => !e.actual_date);
  const sorted      = [...withDate, ...withoutDate];

  // 월 내비게이션
  function monthStr(year: number, mo: number) {
    return `${year}-${String(mo).padStart(2, '0')}`;
  }
  const prev = m === 1  ? monthStr(y - 1, 12) : monthStr(y, m - 1);
  const next = m === 12 ? monthStr(y + 1, 1)  : monthStr(y, m + 1);

  return (
    <div className="page" style={{ maxWidth: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 className="page-title">매칭 완료 내역</h1>
          <p className="page-sub">처리 완료된 항목 · 복원 가능</p>
        </div>
        <a href="/cashflow" style={{ fontSize: 12, color: '#7c3aed', textDecoration: 'underline', fontWeight: 600 }}>
          ← 자금수지현황표
        </a>
      </div>

      {/* 월 내비게이션 */}
      <div className="month-nav">
        <a href={`/cashflow/matched?month=${prev}`}>◀ {prev}</a>
        <span className="month-label">{y}년 {m}월</span>
        <a href={`/cashflow/matched?month=${next}`}>{next} ▶</a>
      </div>

      {result.status === 'env_missing' && (
        <div className="env-warn">⚠️ Supabase 환경변수가 설정되지 않았습니다.</div>
      )}

      {sorted.length === 0 ? (
        <div className="empty" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 48 }}>
          <p className="empty-title">이 달의 매칭 완료 내역이 없습니다</p>
          <p>자금수지현황표에서 항목을 선택하고 매칭 완료 처리하세요.</p>
        </div>
      ) : (
        <MatchedTable entries={sorted} />
      )}
    </div>
  );
}

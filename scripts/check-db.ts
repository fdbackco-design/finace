import * as dotenv from 'dotenv';
import * as path   from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Env ────────────────────────────────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  .env.local 에 NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}) as any;

// ── Helpers ────────────────────────────────────────────────────────────────
async function count(table: string, filter?: Record<string, string>): Promise<number> {
  let q = db.from(table).select('*', { count: 'exact', head: true });
  if (filter) {
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  }
  const { count: n, error } = await q;
  if (error) throw new Error(`[${table}] count 오류: ${error.message}`);
  return n ?? 0;
}

async function groupCount(
  table: string,
  column: string
): Promise<{ value: string; cnt: number }[]> {
  const { data, error } = await db.from(table).select(column);
  if (error) throw new Error(`[${table}] select 오류: ${error.message}`);
  const map: Record<string, number> = {};
  (data as any[]).forEach(row => {
    const v = String(row[column] ?? 'null');
    map[v] = (map[v] ?? 0) + 1;
  });
  return Object.entries(map)
    .map(([value, cnt]) => ({ value, cnt }))
    .sort((a, b) => b.cnt - a.cnt);
}

function table(title: string, rows: { label: string; value: string | number }[]) {
  const w = Math.max(...rows.map(r => r.label.length), title.length);
  console.log(`\n  ┌${'─'.repeat(w + 2)}┬${'─'.repeat(10)}┐`);
  console.log(`  │ ${title.padEnd(w)} │ ${'건수'.padStart(8)} │`);
  console.log(`  ├${'─'.repeat(w + 2)}┼${'─'.repeat(10)}┤`);
  rows.forEach(r => {
    console.log(`  │ ${r.label.padEnd(w)} │ ${String(r.value).padStart(8)} │`);
  });
  console.log(`  └${'─'.repeat(w + 2)}┴${'─'.repeat(10)}┘`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== DB 상태 점검 ===');
  console.log(`URL: ${SUPABASE_URL}\n`);

  const companies = ['feedback', 'sangsaeng', 'shootmoon'];

  // ── 1. 테이블별 전체 건수 ─────────────────────────────────────────────
  const tables = [
    'companies', 'upload_sessions', 'source_files',
    'bank_transactions', 'card_transactions', 'hometax_invoices',
    'fixed_cost_rules', 'cashflow_entries',
  ];
  const totalRows = await Promise.all(tables.map(async t => ({
    label: t,
    value: await count(t),
  })));
  table('테이블', totalRows);

  // ── 2. 회사별 건수 ────────────────────────────────────────────────────
  for (const tbl of ['bank_transactions', 'card_transactions', 'hometax_invoices', 'cashflow_entries']) {
    const rows = await Promise.all(companies.map(async c => ({
      label: c,
      value: await count(tbl, { company_code: c }),
    })));
    table(tbl, rows);
  }

  // ── 3. cashflow_entries — match_status 별 ─────────────────────────────
  const statusGroups = await groupCount('cashflow_entries', 'match_status');
  table('match_status', statusGroups.map(r => ({ label: r.value, value: r.cnt })));

  // ── 4. cashflow_entries — category 별 ────────────────────────────────
  const catGroups = await groupCount('cashflow_entries', 'category');
  table('category', catGroups.map(r => ({ label: r.value, value: r.cnt })));

  // ── 5. cashflow_entries — 회사 × match_status ─────────────────────────
  console.log('\n  회사 × match_status:');
  const statuses = ['AUTO_MATCHED', 'MANUAL_REVIEW', 'UNMATCHED'];
  const header   = ['회사'.padEnd(12), ...statuses.map(s => s.padStart(16))].join('');
  console.log(`  ${header}`);
  for (const co of companies) {
    const vals = await Promise.all(statuses.map(st => count('cashflow_entries', { company_code: co, match_status: st })));
    const row = [co.padEnd(12), ...vals.map(v => String(v).padStart(16))].join('');
    console.log(`  ${row}`);
  }

  // ── 6. 미매칭 건 요약 ─────────────────────────────────────────────────
  const { data: unmatched, error: uErr } = await db
    .from('cashflow_entries')
    .select('company_code, category, expense_amount, income_amount')
    .eq('match_status', 'UNMATCHED')
    .order('expense_amount', { ascending: false })
    .limit(10);
  if (uErr) throw new Error(`unmatched 조회 오류: ${uErr.message}`);

  if ((unmatched as any[]).length > 0) {
    console.log('\n  미매칭 상위 10건 (UNMATCHED):');
    (unmatched as any[]).forEach((r: any) => {
      const amt = r.expense_amount > 0 ? `-${r.expense_amount.toLocaleString()}` : `+${r.income_amount.toLocaleString()}`;
      console.log(`    [${r.company_code}] ${r.category.padEnd(10)}  ${amt}원`);
    });
  }

  // ── 7. HT 연결 누락 확인 ─────────────────────────────────────────────
  const { count: htLinked } = await db
    .from('cashflow_entries')
    .select('*', { count: 'exact', head: true })
    .not('hometax_invoice_id', 'is', null);
  const { count: bankLinked } = await db
    .from('cashflow_entries')
    .select('*', { count: 'exact', head: true })
    .not('bank_transaction_id', 'is', null);

  console.log('\n  FK 연결 현황:');
  console.log(`    hometax_invoice_id  연결됨: ${htLinked ?? 0}건`);
  console.log(`    bank_transaction_id 연결됨: ${bankLinked ?? 0}건`);

  console.log('\n✅ DB 점검 완료\n');
}

main().catch(err => {
  console.error('\n❌ DB 점검 실패:', err.message);
  process.exit(1);
});

/**
 * diagnose-card-woori.ts  — CARD_WOORI 미표시 원인 진단
 * 실행: npx ts-node -P tsconfig.scripts.json scripts/diagnose-card-woori.ts
 */
import * as path   from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
) as any;

async function main() {
  console.log('\n=== CARD_WOORI 미표시 원인 진단 ===\n');

  // 1. cashflow_entries: CARD_WOORI entry_date 분포
  console.log('── 1. cashflow_entries CARD_WOORI entry_date 월별 분포 ──');
  const { data: cfWoori } = await db
    .from('cashflow_entries')
    .select('entry_date, company_code, expense_amount')
    .eq('source_type', 'CARD_WOORI')
    .eq('category', '카드지출');

  const monthMap: Record<string, { cnt: number; total: number }> = {};
  for (const r of (cfWoori ?? [])) {
    const m = String(r.entry_date ?? '').substring(0, 7);
    if (!monthMap[m]) monthMap[m] = { cnt: 0, total: 0 };
    monthMap[m].cnt++;
    monthMap[m].total += Number(r.expense_amount);
  }
  for (const [m, s] of Object.entries(monthMap).sort()) {
    console.log(`  ${m}: ${s.cnt}건 / ${s.total.toLocaleString()}원`);
  }

  // 2. cashflow_entries: CARD_WOORI company_code 분포
  console.log('\n── 2. cashflow_entries CARD_WOORI company_code 분포 ──');
  const compMap: Record<string, number> = {};
  for (const r of (cfWoori ?? [])) {
    const c = String(r.company_code ?? 'null');
    compMap[c] = (compMap[c] ?? 0) + 1;
  }
  for (const [c, n] of Object.entries(compMap).sort()) {
    console.log(`  company_code="${c}": ${n}건`);
  }

  // 3. card_transactions: CARD_WOORI used_date 분포
  console.log('\n── 3. card_transactions CARD_WOORI used_date 월별 분포 ──');
  const { data: ctWoori } = await db
    .from('card_transactions')
    .select('used_date, company_code, card_label, card_no, amount')
    .eq('source_type', 'CARD_WOORI')
    .eq('is_cancelled', false)
    .gt('amount', 0);

  const usedMap: Record<string, { cnt: number; total: number }> = {};
  for (const r of (ctWoori ?? [])) {
    const m = String(r.used_date ?? '').substring(0, 7);
    if (!usedMap[m]) usedMap[m] = { cnt: 0, total: 0 };
    usedMap[m].cnt++;
    usedMap[m].total += Number(r.amount);
  }
  for (const [m, s] of Object.entries(usedMap).sort()) {
    console.log(`  ${m}: ${s.cnt}건 / ${s.total.toLocaleString()}원`);
  }

  // 4. card_transactions: card_label 분포
  console.log('\n── 4. card_transactions CARD_WOORI card_label 분포 ──');
  const labelMap: Record<string, number> = {};
  for (const r of (ctWoori ?? [])) {
    const l = String(r.card_label ?? 'NULL');
    labelMap[l] = (labelMap[l] ?? 0) + 1;
  }
  for (const [l, n] of Object.entries(labelMap).sort()) {
    console.log(`  card_label="${l}": ${n}건`);
  }

  // 5. card_transactions: company_code 분포
  console.log('\n── 5. card_transactions CARD_WOORI company_code 분포 ──');
  const ctCompMap: Record<string, number> = {};
  for (const r of (ctWoori ?? [])) {
    const c = String(r.company_code ?? 'null');
    ctCompMap[c] = (ctCompMap[c] ?? 0) + 1;
  }
  for (const [c, n] of Object.entries(ctCompMap).sort()) {
    console.log(`  company_code="${c}": ${n}건`);
  }

  // 6. card_transactions: card_no 패턴 분포
  console.log('\n── 6. card_transactions CARD_WOORI card_no 마지막4자리 분포 ──');
  const cardNoMap: Record<string, number> = {};
  for (const r of (ctWoori ?? [])) {
    const raw = String(r.card_no ?? '');
    const last4 = raw.split(/[\-\s]/).pop()?.replace(/\D/g, '') ?? 'unknown';
    cardNoMap[last4] = (cardNoMap[last4] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(cardNoMap).sort()) {
    console.log(`  last4="${k}": ${n}건`);
  }

  console.log('\n─── 핵심 진단 결론 ───');
  const cfJuly = (cfWoori ?? []).filter((r: any) => String(r.entry_date ?? '').startsWith('2026-07'));
  const cfJune = (cfWoori ?? []).filter((r: any) => String(r.entry_date ?? '').startsWith('2026-06'));
  console.log(`  cashflow_entries 6월 entry_date: ${cfJune.length}건`);
  console.log(`  cashflow_entries 7월 entry_date: ${cfJuly.length}건`);
  const ctJune = (ctWoori ?? []).filter((r: any) => String(r.used_date ?? '').startsWith('2026-06'));
  const ctJuly = (ctWoori ?? []).filter((r: any) => String(r.used_date ?? '').startsWith('2026-07'));
  console.log(`  card_transactions 6월 used_date: ${ctJune.length}건`);
  console.log(`  card_transactions 7월 used_date: ${ctJuly.length}건`);
}

main().catch(err => { console.error('진단 실패:', err.message); process.exit(1); });

/**
 * fix-card-settlement.ts
 *
 * 카드 결제일 통일 백필:
 *   - card_transactions.payment_due_date: 사용일 기준 재계산
 *   - cashflow_entries.entry_date: card_transaction_id 조인으로 동기화
 *
 * 실행: npx ts-node -P tsconfig.scripts.json scripts/fix-card-settlement.ts
 */

import * as path   from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { calcCardPaymentDueDate, getCardSettlementPeriod } from '../src/lib/cards/settlement';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
) as any;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  console.log('\n=== 카드 결제일 통일 작업 시작 ===\n');

  // ── Step 1: card_transactions.payment_due_date 재계산 ──────────────────
  console.log('── 1. card_transactions payment_due_date 재계산 ──');

  const { data: cards, error: cErr } = await db
    .from('card_transactions')
    .select('id, used_date, payment_due_date, source_type')
    .in('source_type', ['CARD_IBK', 'CARD_WOORI'])
    .not('used_date', 'is', null);

  if (cErr) { console.error('조회 실패:', cErr.message); process.exit(1); }

  const toUpdate: { id: string; correctDate: string; oldDate: string | null }[] = [];
  for (const c of (cards ?? [])) {
    const usedDate = String(c.used_date ?? '').substring(0, 10);
    if (!usedDate) continue;
    const correctDate = calcCardPaymentDueDate(usedDate);
    const oldDate = c.payment_due_date ? String(c.payment_due_date).substring(0, 10) : null;
    if (correctDate !== oldDate) {
      toUpdate.push({ id: c.id, correctDate, oldDate });
    }
  }

  console.log(`  전체 카드: ${(cards ?? []).length}건`);
  console.log(`  변경 필요: ${toUpdate.length}건`);

  // 변경 내용 샘플 출력
  if (toUpdate.length > 0) {
    console.log('  샘플 변경 (최대 5건):');
    toUpdate.slice(0, 5).forEach(r =>
      console.log(`    id=${r.id.substring(0, 8)}... ${r.oldDate ?? 'NULL'} → ${r.correctDate}`)
    );
  }

  // 배치 업데이트
  let updatedCount = 0;
  for (const batch of chunk(toUpdate, 100)) {
    for (const r of batch) {
      const { error } = await db
        .from('card_transactions')
        .update({ payment_due_date: r.correctDate })
        .eq('id', r.id);
      if (error) {
        console.error(`  ❌ 업데이트 실패 id=${r.id}: ${error.message}`);
      } else {
        updatedCount++;
      }
    }
  }
  console.log(`  ✅ card_transactions 업데이트: ${updatedCount}건\n`);

  // ── Step 2: cashflow_entries.entry_date 동기화 ─────────────────────────
  console.log('── 2. cashflow_entries entry_date 동기화 ──');

  const { data: cfCards, error: cfErr } = await db
    .from('cashflow_entries')
    .select('id, entry_date, card_transaction_id')
    .eq('category', '카드지출')
    .not('card_transaction_id', 'is', null);

  if (cfErr) { console.error('조회 실패:', cfErr.message); process.exit(1); }

  // card_transaction_id → correct payment_due_date 맵
  const { data: updCards } = await db
    .from('card_transactions')
    .select('id, payment_due_date')
    .in('source_type', ['CARD_IBK', 'CARD_WOORI'])
    .not('payment_due_date', 'is', null);

  const pdMap: Record<string, string> = {};
  for (const c of (updCards ?? [])) {
    pdMap[c.id] = String(c.payment_due_date).substring(0, 10);
  }

  const cfToUpdate: { id: string; newDate: string; oldDate: string }[] = [];
  for (const e of (cfCards ?? [])) {
    const newDate = pdMap[e.card_transaction_id];
    if (!newDate) continue;
    const oldDate = String(e.entry_date ?? '').substring(0, 10);
    if (newDate !== oldDate) {
      cfToUpdate.push({ id: e.id, newDate, oldDate });
    }
  }

  console.log(`  전체 카드지출 항목: ${(cfCards ?? []).length}건`);
  console.log(`  변경 필요: ${cfToUpdate.length}건`);

  if (cfToUpdate.length > 0) {
    console.log('  샘플 변경 (최대 5건):');
    cfToUpdate.slice(0, 5).forEach(r =>
      console.log(`    id=${r.id.substring(0, 8)}... ${r.oldDate} → ${r.newDate}`)
    );
  }

  let cfUpdatedCount = 0;
  for (const r of cfToUpdate) {
    const { error } = await db
      .from('cashflow_entries')
      .update({ entry_date: r.newDate })
      .eq('id', r.id);
    if (error) {
      console.error(`  ❌ 업데이트 실패: ${error.message}`);
    } else {
      cfUpdatedCount++;
    }
  }
  console.log(`  ✅ cashflow_entries 업데이트: ${cfUpdatedCount}건\n`);

  // ── Step 3: 결과 검증 ────────────────────────────────────────────────
  console.log('── 3. 최종 검증 ──');

  const { data: cfFinal } = await db
    .from('cashflow_entries')
    .select('entry_date, source_type, expense_amount')
    .eq('category', '카드지출');

  const summary: Record<string, { cnt: number; total: number }> = {};
  for (const r of (cfFinal ?? [])) {
    const k = `${r.entry_date}|${r.source_type}`;
    if (!summary[k]) summary[k] = { cnt: 0, total: 0 };
    summary[k].cnt++;
    summary[k].total += Number(r.expense_amount);
  }

  console.log('  cashflow_entries 카드지출 entry_date 분포:');
  for (const [k, v] of Object.entries(summary).sort()) {
    const [date, st] = k.split('|');
    console.log(`  ${date} | ${st}: ${v.cnt}건 / ${v.total.toLocaleString()}원`);
  }

  // ── 보고 형식 ─────────────────────────────────────────────────────────
  console.log('\n─'.repeat(60));
  console.log('완료 보고');

  // 6월 자금수지: settlement period for 2026-06
  const junePeriod = getCardSettlementPeriod(2026, 6);
  console.log(`\n[6월 자금수지 카드 결제 기준]`);
  console.log(`  결제일: ${junePeriod.settlementDate}`);
  console.log(`  사용 기간: ${junePeriod.usedDateFrom} ~ ${junePeriod.usedDateTo}`);

  const { data: juneCards } = await db
    .from('card_transactions')
    .select('card_label, company_code, source_type, amount, used_date')
    .gte('used_date', junePeriod.usedDateFrom)
    .lte('used_date', junePeriod.usedDateTo)
    .eq('is_cancelled', false)
    .gt('amount', 0);

  const VALID_LABELS = new Set(['상생 우리카드', '상생 기업카드', '피드백 우리카드', '피드백 기업카드']);
  const CF_MAP: Record<string, string> = {
    'sangsaeng:CARD_WOORI': '상생 우리카드',
    'sangsaeng:CARD_IBK':   '상생 기업카드',
    'feedback:CARD_WOORI':  '피드백 우리카드',
    'feedback:CARD_IBK':    '피드백 기업카드',
  };

  const groupMap: Record<string, { cnt: number; total: number }> = {};
  for (const r of (juneCards ?? [])) {
    const label = (r.card_label && VALID_LABELS.has(r.card_label))
      ? r.card_label
      : (CF_MAP[`${r.company_code}:${r.source_type}`] ?? '분류불가');
    if (!groupMap[label]) groupMap[label] = { cnt: 0, total: 0 };
    groupMap[label].cnt++;
    groupMap[label].total += Number(r.amount);
  }

  console.log('\n  카드별 집계:');
  for (const [label, v] of Object.entries(groupMap).sort()) {
    console.log(`    ${label}: ${v.cnt}건 / ${v.total.toLocaleString()}원`);
  }

  // 7월 자금수지
  const julPeriod = getCardSettlementPeriod(2026, 7);
  console.log(`\n[7월 자금수지 카드 결제 기준]`);
  console.log(`  결제일: ${julPeriod.settlementDate}`);
  console.log(`  사용 기간: ${julPeriod.usedDateFrom} ~ ${julPeriod.usedDateTo}`);

  const { data: julCards } = await db
    .from('card_transactions')
    .select('card_label, company_code, source_type, amount')
    .gte('used_date', julPeriod.usedDateFrom)
    .lte('used_date', julPeriod.usedDateTo)
    .eq('is_cancelled', false)
    .gt('amount', 0);

  const jMap: Record<string, { cnt: number; total: number }> = {};
  for (const r of (julCards ?? [])) {
    const label = (r.card_label && VALID_LABELS.has(r.card_label))
      ? r.card_label
      : (CF_MAP[`${r.company_code}:${r.source_type}`] ?? '분류불가');
    if (!jMap[label]) jMap[label] = { cnt: 0, total: 0 };
    jMap[label].cnt++;
    jMap[label].total += Number(r.amount);
  }

  console.log('\n  카드별 집계:');
  for (const [label, v] of Object.entries(jMap).sort()) {
    console.log(`    ${label}: ${v.cnt}건 / ${v.total.toLocaleString()}원`);
  }
}

main().catch(err => {
  console.error('\n❌ 실패:', err.message);
  process.exit(1);
});

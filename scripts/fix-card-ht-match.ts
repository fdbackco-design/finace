/**
 * fix-card-ht-match.ts
 *
 * 카드-홈택스 매입계산서 매칭 건의 entry_date 보정
 * 규칙: 카드 거래가 홈택스 매입계산서와 매칭된 경우 entry_date = 계산서 작성일
 *
 * 현재 대상: 1건
 *   cashflow_entry id = 7710b79c...  entry_date 2026-06-04 → 2026-06-03
 *   (홈택스 매입계산서 id = 87de27fc, issue_date = 2026-06-03, 거래처: 구글클라우드 코리아 유한회사)
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('❌ 환경변수 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  console.error('   .env.local 또는 환경변수를 먼저 설정하세요.');
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  console.log('── 카드-홈택스 매칭 entry_date 보정 시작 ──');

  // 1) 현재 상태 확인: card_transaction_id 가 있고 category='매입'인 cashflow_entries
  const { data: matched, error: fetchErr } = await supabase
    .from('cashflow_entries')
    .select('id, entry_date, category, vendor_name, card_transaction_id, hometax_invoice_id')
    .eq('category', '매입')
    .not('card_transaction_id', 'is', null);

  if (fetchErr) {
    console.error('❌ 조회 오류:', fetchErr.message);
    process.exit(1);
  }

  if (!matched || matched.length === 0) {
    console.log('ℹ 카드-홈택스 매칭 cashflow_entry 없음. 작업 종료.');
    return;
  }

  console.log(`\n현재 카드-매입 매칭 항목 ${matched.length}건:`);
  for (const e of matched) {
    console.log(`  entry id: ${e.id}`);
    console.log(`    entry_date: ${e.entry_date}`);
    console.log(`    vendor: ${e.vendor_name}`);
    console.log(`    card_tx_id: ${e.card_transaction_id}`);
    console.log(`    ht_invoice_id: ${e.hometax_invoice_id}`);
  }

  // 2) 각 항목에 대해 홈택스 계산서의 issue_date 를 가져와 entry_date 와 비교
  let updatedCount = 0;

  for (const e of matched) {
    if (!e.hometax_invoice_id) {
      console.log(`  ⚠ entry ${e.id}: hometax_invoice_id 없음 → skip`);
      continue;
    }

    const { data: ht, error: htErr } = await supabase
      .from('hometax_invoices')
      .select('id, issue_date, vendor_name')
      .eq('id', e.hometax_invoice_id)
      .single();

    if (htErr || !ht) {
      console.log(`  ⚠ entry ${e.id}: 홈택스 계산서 조회 실패 → skip`);
      continue;
    }

    const correctDate = ht.issue_date;

    if (e.entry_date === correctDate) {
      console.log(`  ✅ entry ${e.id} (${e.vendor_name}): entry_date=${e.entry_date} 이미 정확`);
      continue;
    }

    console.log(`  🔧 entry ${e.id} (${e.vendor_name}): ${e.entry_date} → ${correctDate} (계산서 작성일)`);

    const { error: upErr } = await supabase
      .from('cashflow_entries')
      .update({ entry_date: correctDate })
      .eq('id', e.id);

    if (upErr) {
      console.error(`  ❌ UPDATE 실패: ${upErr.message}`);
    } else {
      updatedCount++;
    }
  }

  console.log(`\n── 완료: ${updatedCount}건 수정, ${matched.length - updatedCount}건 변경 없음 ──`);
}

main().catch(e => {
  console.error('❌ 오류:', e);
  process.exit(1);
});

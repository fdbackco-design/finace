/**
 * backfill-card-classification.ts
 *
 * 기존 card_transactions 레코드에 card_provider / card_label 을 백필한다.
 * 실행: npx ts-node -P tsconfig.scripts.json scripts/backfill-card-classification.ts
 *
 * 사전 조건: 002_card_classification.sql 마이그레이션이 실행되어 있어야 한다.
 */

import * as path   from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { classifyCard } from '../src/lib/cards/classifyCard';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ .env.local 에 NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type CardRow = {
  id: string;
  source_type: 'CARD_IBK' | 'CARD_WOORI';
  card_no: string | null;
  card_label: string | null;
};

async function main() {
  console.log('\n=== 카드 분류 백필 시작 ===\n');

  // 미분류(card_label NULL) 카드 거래 전체 조회
  const { data, error } = await (supabase as any)
    .from('card_transactions')
    .select('id, source_type, card_no, card_label')
    .is('card_label', null);

  if (error) {
    console.error('❌ 조회 실패:', error.message);
    process.exit(1);
  }

  const rows: CardRow[] = data ?? [];
  console.log(`미분류 카드 거래: ${rows.length}건\n`);

  const stats: Record<string, number> = {
    '상생 우리카드':  0,
    '상생 기업카드':  0,
    '피드백 우리카드': 0,
    '피드백 기업카드': 0,
    '분류불가':       0,
  };
  const unclassified: CardRow[] = [];

  // 분류 결과 그룹화
  const byLabel: Record<string, string[]> = {};

  for (const row of rows) {
    const source = row.source_type === 'CARD_IBK' || row.source_type === 'CARD_WOORI'
      ? row.source_type
      : null;

    if (!source) {
      stats['분류불가']++;
      unclassified.push(row);
      continue;
    }

    const result = classifyCard({ source, cardNo: row.card_no });
    if (!result) {
      stats['분류불가']++;
      unclassified.push(row);
      continue;
    }

    stats[result.cardLabel] = (stats[result.cardLabel] ?? 0) + 1;
    if (!byLabel[result.cardLabel]) byLabel[result.cardLabel] = [];
    byLabel[result.cardLabel].push(row.id);
  }

  // 라벨별 업데이트
  for (const [label, ids] of Object.entries(byLabel)) {
    if (ids.length === 0) continue;

    const provider = label.includes('우리카드') ? '우리카드' : '기업카드';

    // 500건씩 배치 업데이트
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const { error: updErr } = await (supabase as any)
        .from('card_transactions')
        .update({ card_label: label, card_provider: provider })
        .in('id', batch);

      if (updErr) {
        console.error(`❌ 업데이트 실패 [${label}]:`, updErr.message);
      }
    }

    console.log(`✅ ${label}: ${ids.length}건 업데이트`);
  }

  // 분류 불가 건 출력
  if (unclassified.length > 0) {
    console.log(`\n⚠️  분류 불가: ${unclassified.length}건`);
    console.log('샘플 (최대 10건):');
    unclassified.slice(0, 10).forEach(r => {
      console.log(`  id=${r.id}  source=${r.source_type}  card_no=${r.card_no}`);
    });
  }

  // 최종 집계 출력
  console.log('\n─'.repeat(50));
  console.log('백필 완료 요약:');
  for (const [label, cnt] of Object.entries(stats)) {
    if (cnt > 0) console.log(`  ${label}: ${cnt}건`);
  }

  // DB 검증 쿼리 실행
  console.log('\n─'.repeat(50));
  console.log('DB 최종 집계:');
  const { data: summary } = await (supabase as any)
    .from('card_transactions')
    .select('card_label, is_cancelled, amount')
    .eq('is_cancelled', false);

  const dbStats: Record<string, { count: number; total: number }> = {};
  for (const r of (summary ?? [])) {
    const key = r.card_label ?? '미분류';
    if (!dbStats[key]) dbStats[key] = { count: 0, total: 0 };
    dbStats[key].count++;
    dbStats[key].total += Number(r.amount);
  }
  for (const [label, s] of Object.entries(dbStats).sort(([a], [b]) => a.localeCompare(b, 'ko'))) {
    console.log(`  ${label}: ${s.count}건 / ${s.total.toLocaleString()}원`);
  }
}

main().catch(err => {
  console.error('\n❌ 백필 실패:', err.message);
  process.exit(1);
});

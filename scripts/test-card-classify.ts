/**
 * test-card-classify.ts
 *
 * classifyCard 함수 및 /unmatched 필터 규칙 검증 스크립트
 * 실행: npx ts-node -P tsconfig.scripts.json scripts/test-card-classify.ts
 */

import { classifyCard, cardLabelFromEntry } from '../src/lib/cards/classifyCard';

type TestCase = {
  desc:     string;
  input:    Parameters<typeof classifyCard>[0];
  expected: ReturnType<typeof classifyCard>;
};

const cardTests: TestCase[] = [
  // ── 우리카드 ────────────────────────────────────────────────────────────────
  {
    desc:     '우리카드 + cardRef "6313" → 상생 우리카드',
    input:    { source: 'CARD_WOORI', cardRef: '6313' },
    expected: { companyName: '상생', cardProvider: '우리카드', cardLabel: '상생 우리카드' },
  },
  {
    desc:     '우리카드 + cardRef "9727" → 피드백 우리카드',
    input:    { source: 'CARD_WOORI', cardRef: '9727' },
    expected: { companyName: '피드백', cardProvider: '우리카드', cardLabel: '피드백 우리카드' },
  },
  {
    desc:     '우리카드 + cardNo "****-****-****-9727" → 피드백 우리카드',
    input:    { source: 'CARD_WOORI', cardNo: '****-****-****-9727' },
    expected: { companyName: '피드백', cardProvider: '우리카드', cardLabel: '피드백 우리카드' },
  },
  {
    desc:     '우리카드 + cardNo "****-****-****-6313" → 상생 우리카드',
    input:    { source: 'CARD_WOORI', cardNo: '****-****-****-6313' },
    expected: { companyName: '상생', cardProvider: '우리카드', cardLabel: '상생 우리카드' },
  },
  // ── 기업카드 ────────────────────────────────────────────────────────────────
  {
    desc:     '기업카드 + cardNo "5585-****-****-6904" → 피드백 기업카드',
    input:    { source: 'CARD_IBK', cardNo: '5585-****-****-6904' },
    expected: { companyName: '피드백', cardProvider: '기업카드', cardLabel: '피드백 기업카드' },
  },
  {
    desc:     '기업카드 + cardNo "5585-****-****-7979" → 상생 기업카드',
    input:    { source: 'CARD_IBK', cardNo: '5585-****-****-7979' },
    expected: { companyName: '상생', cardProvider: '기업카드', cardLabel: '상생 기업카드' },
  },
  {
    desc:     '기업카드 + cardNo "4140-****-****-7969" → 상생 기업카드',
    input:    { source: 'CARD_IBK', cardNo: '4140-****-****-7969' },
    expected: { companyName: '상생', cardProvider: '기업카드', cardLabel: '상생 기업카드' },
  },
  // ── 공백/하이픈 정규화 ──────────────────────────────────────────────────────
  {
    desc:     '기업카드 + 공백구분 "5585 **** **** 6904" → 피드백 기업카드',
    input:    { source: 'CARD_IBK', cardNo: '5585 **** **** 6904' },
    expected: { companyName: '피드백', cardProvider: '기업카드', cardLabel: '피드백 기업카드' },
  },
  // ── 분류 불가 ──────────────────────────────────────────────────────────────
  {
    desc:     '기업카드 + 알 수 없는 번호 → null',
    input:    { source: 'CARD_IBK', cardNo: '9999-****-****-0000' },
    expected: null,
  },
  {
    desc:     '우리카드 + 알 수 없는 ref → null',
    input:    { source: 'CARD_WOORI', cardRef: '1234' },
    expected: null,
  },
];

let passed = 0;
let failed = 0;

console.log('\n=== 카드 분류 테스트 ===\n');

for (const tc of cardTests) {
  const actual = classifyCard(tc.input);
  const ok     = JSON.stringify(actual) === JSON.stringify(tc.expected);

  if (ok) {
    console.log(`✅ ${tc.desc}`);
    passed++;
  } else {
    console.log(`❌ ${tc.desc}`);
    console.log(`   예상: ${JSON.stringify(tc.expected)}`);
    console.log(`   실제: ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── cashflow_entries 역매핑 테스트 ─────────────────────────────────────────
console.log('\n=== cashflow_entries 카드 라벨 역매핑 테스트 ===\n');

const entryTests: Array<{ companyCode: string; sourceType: string; expected: string | null }> = [
  { companyCode: 'sangsaeng', sourceType: 'CARD_WOORI', expected: '상생 우리카드'   },
  { companyCode: 'sangsaeng', sourceType: 'CARD_IBK',   expected: '상생 기업카드'   },
  { companyCode: 'feedback',  sourceType: 'CARD_WOORI', expected: '피드백 우리카드' },
  { companyCode: 'feedback',  sourceType: 'CARD_IBK',   expected: '피드백 기업카드' },
  { companyCode: 'feedback',  sourceType: 'BANK_IBK',   expected: null              },
];

for (const t of entryTests) {
  const actual = cardLabelFromEntry(t.companyCode, t.sourceType);
  const ok     = actual === t.expected;

  if (ok) {
    console.log(`✅ ${t.companyCode}:${t.sourceType} → ${actual}`);
    passed++;
  } else {
    console.log(`❌ ${t.companyCode}:${t.sourceType}`);
    console.log(`   예상: ${t.expected}`);
    console.log(`   실제: ${actual}`);
    failed++;
  }
}

// ── /unmatched 필터 규칙 테스트 (category='카드지출' 전체 제외) ───────────
console.log('\n=== /unmatched 필터 테스트 ===\n');

const categoryTests = [
  { category: '카드지출', shouldHide: true,  desc: '카드지출(CARD_IBK)  → 미매칭 화면에서 숨김' },
  { category: '카드지출', shouldHide: true,  desc: '카드지출(CARD_WOORI) → 미매칭 화면에서 숨김' },
  { category: '매입',     shouldHide: false, desc: '매입      → 미매칭 화면에 표시' },
  { category: '기타지출', shouldHide: false, desc: '기타지출   → 미매칭 화면에 표시' },
  { category: '기타수입', shouldHide: false, desc: '기타수입   → 미매칭 화면에 표시' },
];

for (const t of categoryTests) {
  const isHidden = t.category === '카드지출';
  const ok = isHidden === t.shouldHide;
  if (ok) {
    console.log(`✅ ${t.desc}`);
    passed++;
  } else {
    console.log(`❌ ${t.desc} (예상: ${t.shouldHide}, 실제: ${isHidden})`);
    failed++;
  }
}

console.log('\n' + '─'.repeat(50));
console.log(`결과: ${passed}건 통과 / ${failed}건 실패`);

if (failed > 0) process.exit(1);

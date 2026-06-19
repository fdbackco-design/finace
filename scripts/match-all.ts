import * as fs   from 'fs';
import * as path from 'path';

import { loadFixedCosts }  from '../src/matching/loadFixedCosts';
import { MatchingEngine }  from '../src/matching/engine';
import { BankTransaction, CardTransaction, HometaxInvoice } from '../src/lib/types';
import { CashflowEntry }   from '../src/matching/matcherTypes';

const BASE_DIR   = path.resolve(__dirname, '..');
const PARSED_DIR = path.join(BASE_DIR, 'parsed');
const GOAL_XLSX  = path.join(BASE_DIR, 'goal.xlsx');

function read<T>(name: string): T[] {
  return JSON.parse(fs.readFileSync(path.join(PARSED_DIR, name), 'utf-8')) as T[];
}

function write(name: string, data: unknown) {
  fs.writeFileSync(path.join(PARSED_DIR, name), JSON.stringify(data, null, 2), 'utf-8');
}

function main() {
  console.log('\n=== 자동 매칭 엔진 시작 ===\n');

  // ── Load inputs ─────────────────────────────────────────────────────────
  const banks  = read<BankTransaction>('bank-transactions.json');
  const cards  = read<CardTransaction>('card-transactions.json');
  const hts    = read<HometaxInvoice>('hometax-invoices.json');
  const fcs    = loadFixedCosts(GOAL_XLSX);

  console.log(`입력 데이터:`);
  console.log(`  은행 거래:   ${banks.length}건`);
  console.log(`  카드 거래:   ${cards.length}건`);
  console.log(`  홈텍스:      ${hts.length}건`);
  console.log(`  고정비항목:  ${fcs.length}건`);
  console.log();

  // ── Run matching engine ─────────────────────────────────────────────────
  const engine = new MatchingEngine(banks, cards, hts, fcs);
  engine.run();

  const cashflow    = engine.cashflow;
  const matched     = engine.matched;
  const unmatchedB  = engine.getUnmatchedBanks();
  const unmatchedC  = engine.getUnmatchedCards();
  const unmatchedH  = engine.getUnmatchedHts();

  // ── Write outputs ───────────────────────────────────────────────────────
  write('cashflow-draft.json',                cashflow);
  write('matched-transactions.json',          matched);
  write('unmatched-bank-transactions.json',   unmatchedB);
  write('unmatched-card-transactions.json',   unmatchedC);
  write('unmatched-hometax-invoices.json',    unmatchedH);
  write('matching-errors.json',               []);

  // ── Stats ───────────────────────────────────────────────────────────────
  const htTotal      = hts.length;
  const htMatched    = cashflow.filter(c => c.hometaxInvoiceId && c.matchStatus !== 'UNMATCHED').length;
  const htManual     = cashflow.filter(c => c.hometaxInvoiceId && c.matchStatus === 'MANUAL_REVIEW').length;
  const htUnmatched  = unmatchedH.length;

  const provisional  = cashflow.filter(c => c.category === '가수금').length;
  const fixedMatched = matched.filter(m => m.matchType === 'FIXED_COST-BANK').length;

  const autoCount    = cashflow.filter(c => c.matchStatus === 'AUTO_MATCHED').length;
  const manualCount  = cashflow.filter(c => c.matchStatus === 'MANUAL_REVIEW').length;
  const unmatchedCount = cashflow.filter(c => c.matchStatus === 'UNMATCHED').length;

  const byCompany = (arr: CashflowEntry[]) =>
    ['feedback', 'sangsaeng', 'shootmoon'].map(c =>
      `  ${c}: ${arr.filter(x => x.company === c).length}건`
    ).join('\n');

  const byCategory = (arr: CashflowEntry[]) => {
    const counts: Record<string, number> = {};
    arr.forEach(x => { counts[x.category] = (counts[x.category] || 0) + 1; });
    return Object.entries(counts).map(([k, v]) => `  ${k}: ${v}건`).join('\n');
  };

  const bankOut = unmatchedB.filter(b => b.withdrawAmount > 0).length;
  const bankIn  = unmatchedB.filter(b => b.depositAmount  > 0).length;
  const cardOut = unmatchedC.filter(c => !c.isCancelled && c.amount > 0).length;

  const now = new Date().toISOString().split('T')[0];
  const md  = [
    `# 매칭 결과 요약 — ${now}`,
    '',
    '## cashflow-draft 전체 현황',
    `| 상태 | 건수 |`,
    `|------|------|`,
    `| AUTO_MATCHED | ${autoCount} |`,
    `| MANUAL_REVIEW | ${manualCount} |`,
    `| UNMATCHED | ${unmatchedCount} |`,
    `| **합계** | **${cashflow.length}** |`,
    '',
    '## 홈텍스 매칭',
    `| | |`,
    `|---|---|`,
    `| 전체 홈텍스 계산서 | ${htTotal} |`,
    `| 자동 매칭 성공 | ${htMatched - htManual} |`,
    `| MANUAL_REVIEW | ${htManual} |`,
    `| 미매칭 (홈텍스) | ${htUnmatched} |`,
    '',
    '## 특수 항목',
    `- 가수금 감지: ${provisional}건`,
    `- 고정비 매칭: ${fixedMatched}건`,
    '',
    '## 미매칭 잔여',
    `- 은행 출금 미매칭: ${bankOut}건`,
    `- 은행 입금 미매칭: ${bankIn}건`,
    `- 카드 미매칭: ${cardOut}건`,
    `- 홈텍스 미매칭: ${htUnmatched}건`,
    '',
    '## 회사별 cashflow row',
    byCompany(cashflow),
    '',
    '## 구분별 cashflow row',
    byCategory(cashflow),
  ].join('\n');

  write('matching-summary.md', md);

  // ── Console output ───────────────────────────────────────────────────────
  console.log('─'.repeat(56));
  console.log('결과:');
  console.log(`  cashflow-draft 총 건수:    ${cashflow.length}건`);
  console.log(`  자동 매칭 (AUTO_MATCHED):  ${autoCount}건`);
  console.log(`  수동 검토 (MANUAL_REVIEW): ${manualCount}건`);
  console.log(`  미매칭 (UNMATCHED):        ${unmatchedCount}건`);
  console.log();
  console.log('홈텍스:');
  console.log(`  전체:          ${htTotal}건`);
  console.log(`  자동 매칭:     ${htMatched - htManual}건`);
  console.log(`  수동 검토:     ${htManual}건`);
  console.log(`  미매칭:        ${htUnmatched}건`);
  console.log();
  console.log('특수:');
  console.log(`  가수금:        ${provisional}건`);
  console.log(`  고정비 매칭:   ${fixedMatched}건`);
  console.log();
  console.log('미매칭 잔여:');
  console.log(`  은행 출금:     ${bankOut}건`);
  console.log(`  은행 입금:     ${bankIn}건`);
  console.log(`  카드:          ${cardOut}건`);
  console.log(`  홈텍스:        ${htUnmatched}건`);
  console.log('─'.repeat(56));
  console.log();

  console.log('회사별 cashflow row:');
  ['feedback', 'sangsaeng', 'shootmoon'].forEach(c => {
    console.log(`  ${c}: ${cashflow.filter(x => x.company === c).length}건`);
  });
  console.log();

  console.log('구분별 cashflow row:');
  const cats: Record<string, number> = {};
  cashflow.forEach(x => { cats[x.category] = (cats[x.category] || 0) + 1; });
  Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}건`);
  });
  console.log();
  console.log(`✅ 출력 위치: ${PARSED_DIR}/`);
}

main();

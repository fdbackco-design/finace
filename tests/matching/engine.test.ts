import { describe, it, expect } from 'vitest';
import { MatchingEngine } from '../../src/matching/engine';
import type { BankTransaction, CardTransaction, HometaxInvoice } from '../../src/lib/types';
import type { FixedCostEntry } from '../../src/matching/matcherTypes';
import banks from '../fixtures/bankTransactions.json';
import hts   from '../fixtures/hometaxInvoices.json';

const bankFixtures  = banks  as unknown as BankTransaction[];
const htFixtures    = hts    as unknown as HometaxInvoice[];
const noCards:       CardTransaction[]  = [];
const noFixedCosts:  FixedCostEntry[]   = [];

// ── Step3: HT 매입 vs 은행 출금 매칭 ──────────────────────────────────────
describe('MatchingEngine step3 (HT매입-은행출금)', () => {
  it('매입세금계산서 금액과 은행 출금이 일치하면 AUTO_MATCHED 또는 MANUAL_REVIEW', () => {
    const engine = new MatchingEngine(bankFixtures, noCards, htFixtures, noFixedCosts);
    engine.run();

    const purchase = engine.cashflow.find(
      e => e.sourceType === 'HT_PURCHASE_TAX' && e.vendorName === '테스트공급사'
    );
    expect(purchase).toBeDefined();
    expect(purchase?.matchStatus).toMatch(/AUTO_MATCHED|MANUAL_REVIEW/);
    expect(purchase?.expenseAmount).toBe(110000);
  });

  it('매칭된 항목은 engine.matched에 기록됨 (Step3/4만 해당)', () => {
    const engine = new MatchingEngine(bankFixtures, noCards, htFixtures, noFixedCosts);
    engine.run();
    // matched 배열이 있으면 각 항목에 matchType 있어야 함
    for (const m of engine.matched) {
      expect(m.matchType).toBeTruthy();
    }
  });
});

// ── Step4: HT 매출 vs 은행 입금 매칭 ─────────────────────────────────────
describe('MatchingEngine step4 (HT매출-은행입금)', () => {
  it('매출세금계산서 금액과 은행 입금이 일치하면 cashflow에 포함', () => {
    const engine = new MatchingEngine(bankFixtures, noCards, htFixtures, noFixedCosts);
    engine.run();

    const sales = engine.cashflow.find(
      e => e.sourceType === 'HT_SALES_TAX'
    );
    expect(sales).toBeDefined();
    expect(sales?.incomeAmount).toBeGreaterThanOrEqual(0);
  });
});

// ── USER_EDITED / USER_CONFIRMED 불변 원칙 (engine 레벨 검증) ────────────
// engine 자체는 DB 상태를 모름; runRematch가 deleteByFk에서 보호함
// 여기서는 engine이 cashflow 항목을 정상 생성하는지만 확인

describe('MatchingEngine cashflow 생성', () => {
  it('모든 HT 계산서는 cashflow 항목으로 변환됨', () => {
    const engine = new MatchingEngine(bankFixtures, noCards, htFixtures, noFixedCosts);
    engine.run();

    const htCashflows = engine.cashflow.filter(
      e => e.sourceType === 'HT_PURCHASE_TAX' || e.sourceType === 'HT_SALES_TAX'
    );
    expect(htCashflows.length).toBeGreaterThanOrEqual(htFixtures.length);
  });

  it('UNMATCHED 항목의 showInCashflow는 true', () => {
    const engine = new MatchingEngine(bankFixtures, noCards, htFixtures, noFixedCosts);
    engine.run();

    const unmatched = engine.cashflow.filter(e => e.matchStatus === 'UNMATCHED');
    for (const e of unmatched) {
      expect(e.showInCashflow).toBe(true);
    }
  });
});

// ── sourceRowNumber / sourceSheetName 전파 확인 ───────────────────────────
describe('source 추적 필드', () => {
  it('bankFixtures에 sourceRowNumber와 sourceSheetName이 있음', () => {
    for (const b of bankFixtures) {
      expect(b.sourceRowNumber).toBeDefined();
      expect(b.sourceSheetName).toBeDefined();
    }
  });

  it('sourceRowNumber는 1 이상의 정수 (1-based)', () => {
    for (const b of bankFixtures) {
      expect(b.sourceRowNumber).toBeGreaterThanOrEqual(1);
    }
    for (const h of htFixtures) {
      expect(h.sourceRowNumber).toBeGreaterThanOrEqual(1);
    }
  });
});

/**
 * projectNT 단위 테스트
 *
 * DB 없이 NT 투영 로직만 검증.
 * Supabase 클라이언트를 mock으로 대체.
 */

import { describe, it, expect, vi } from 'vitest';
import { projectNormalizedTransactions } from '../../src/lib/phase2/projectNT';
import type { ProjectNTOptions } from '../../src/lib/phase2/projectNT';

// ── Mock 유틸 ─────────────────────────────────────────────────────────────────

/**
 * Supabase 쿼리 빌더를 모방하는 객체.
 * 모든 체인 메서드가 `this`를 반환하고, await 가능하도록 `then`을 구현.
 */
function makeQueryMock(data: unknown[], error: { message: string } | null = null) {
  const mock: Record<string, unknown> = {};
  // await 가능하게: Promise.resolve({data, error})와 동일하게 동작
  mock.then = (onfulfilled: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(onfulfilled);
  // 체인 메서드: 모두 this 반환
  mock.select = () => mock;
  mock.eq     = () => mock;
  mock.not    = () => mock;
  mock.in     = () => mock;
  mock.lt     = () => mock;
  mock.gte    = () => mock;
  mock.lte    = () => mock;
  mock.single = () => mock;
  mock.limit  = () => mock;
  return mock;
}

function makeUpsertMock(captureRef: { rows: unknown[] | null }, count = 0) {
  return (rows: unknown[]) => {
    captureRef.rows = rows;
    return Promise.resolve({ error: null, count: rows.length || count });
  };
}

/**
 * from(table) 에 따라 다른 mock 반환.
 * bank/card/ht 소스 테이블과 normalized_transactions(check + upsert) 지원.
 */
function buildMockSupabase(opts: {
  bankRows?: unknown[];
  cardRows?: unknown[];
  htRows?:   unknown[];
  upsertCapture?: { rows: unknown[] | null };
  upsertError?: string;
}) {
  const { bankRows = [], cardRows = [], htRows = [], upsertCapture, upsertError } = opts;

  const bankMock = makeQueryMock(bankRows);
  const cardMock = makeQueryMock(cardRows);
  const htMock   = makeQueryMock(htRows);

  // normalized_transactions: 기존 체크는 빈 배열, upsert는 capture/error
  const existingMock = makeQueryMock([]);
  const upsertFn = upsertCapture
    ? makeUpsertMock(upsertCapture)
    : (_rows: unknown[]) => Promise.resolve({ error: upsertError ? { message: upsertError } : null, count: 0 });

  let ntCallCount = 0;
  const ntMock = {
    select: () => existingMock,
    eq:     () => existingMock,
    not:    () => existingMock,
    upsert: upsertFn,
  };

  return {
    from: (table: string) => {
      if (table === 'bank_transactions')      return bankMock;
      if (table === 'card_transactions')      return cardMock;
      if (table === 'hometax_invoices')       return htMock;
      if (table === 'normalized_transactions') return ntMock;
      return makeQueryMock([]);
    },
  } as unknown as Parameters<typeof projectNormalizedTransactions>[0];
}

// ── 테스트 케이스 ──────────────────────────────────────────────────────────────

const BASE_OPTS: ProjectNTOptions = {
  companyId:   'company-001',
  companyCode: 'feedback',
};

describe('projectNormalizedTransactions', () => {
  it('빈 소스 데이터 → 0 생성, 에러 없음', async () => {
    const supabase = buildMockSupabase({});
    const result = await projectNormalizedTransactions(supabase, BASE_OPTS);
    expect(result.bank).toBe(0);
    expect(result.card).toBe(0);
    expect(result.ht).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('은행 입금 → event_type=REALIZED_INFLOW', async () => {
    const capture = { rows: null as unknown[] | null };
    const supabase = buildMockSupabase({
      bankRows: [{
        id: 'bank-001', transaction_date: '2026-06-10',
        amount: 1100000, transaction_type: 'deposit',
        description: '(주)테스트', account_no: '123-456', source_type: 'BANK_IBK',
      }],
      upsertCapture: capture,
    });

    await projectNormalizedTransactions(supabase, BASE_OPTS);

    expect(capture.rows).not.toBeNull();
    const row = (capture.rows as Array<{ event_type: string }>)[0];
    expect(row.event_type).toBe('REALIZED_INFLOW');
  });

  it('은행 출금 → event_type=REALIZED_OUTFLOW', async () => {
    const capture = { rows: null as unknown[] | null };
    const supabase = buildMockSupabase({
      bankRows: [{
        id: 'bank-002', transaction_date: '2026-06-15',
        amount: -550000, transaction_type: 'withdrawal',
        description: null, account_no: null, source_type: null,
      }],
      upsertCapture: capture,
    });

    await projectNormalizedTransactions(supabase, BASE_OPTS);

    const row = (capture.rows as Array<{ event_type: string }>)[0];
    expect(row.event_type).toBe('REALIZED_OUTFLOW');
  });

  it('은행 gross_amount는 절댓값', async () => {
    const capture = { rows: null as unknown[] | null };
    const supabase = buildMockSupabase({
      bankRows: [{
        id: 'bank-003', transaction_date: '2026-06-15',
        amount: -550000, transaction_type: 'withdrawal',
        description: null, account_no: null, source_type: null,
      }],
      upsertCapture: capture,
    });

    await projectNormalizedTransactions(supabase, BASE_OPTS);

    const row = (capture.rows as Array<{ gross_amount: number }>)[0];
    expect(row.gross_amount).toBe(550000);
  });

  it('홈택스 매출(sales) → event_type=EXPECTED_INFLOW', async () => {
    const capture = { rows: null as unknown[] | null };
    const supabase = buildMockSupabase({
      htRows: [{
        id: 'ht-001', issue_date: '2026-06-08',
        supply_amount: 1000000, tax_amount: 100000,
        invoice_direction: 'sales',
        counterparty: '(주)고객사', business_no: '111-22-33333',
      }],
      upsertCapture: capture,
    });

    await projectNormalizedTransactions(supabase, BASE_OPTS);

    const row = (capture.rows as Array<{ event_type: string }>)[0];
    expect(row.event_type).toBe('EXPECTED_INFLOW');
  });

  it('홈택스 매입(purchase) → event_type=EXPECTED_OUTFLOW', async () => {
    const capture = { rows: null as unknown[] | null };
    const supabase = buildMockSupabase({
      htRows: [{
        id: 'ht-002', issue_date: '2026-06-12',
        supply_amount: 500000, tax_amount: 50000,
        invoice_direction: 'purchase',
        counterparty: '(주)공급사', business_no: '222-33-44444',
      }],
      upsertCapture: capture,
    });

    await projectNormalizedTransactions(supabase, BASE_OPTS);

    const row = (capture.rows as Array<{ event_type: string }>)[0];
    expect(row.event_type).toBe('EXPECTED_OUTFLOW');
  });

  it('홈택스 gross_amount = supply + tax', async () => {
    const capture = { rows: null as unknown[] | null };
    const supabase = buildMockSupabase({
      htRows: [{
        id: 'ht-003', issue_date: '2026-06-08',
        supply_amount: 1000000, tax_amount: 100000,
        invoice_direction: 'sales', counterparty: null, business_no: null,
      }],
      upsertCapture: capture,
    });

    await projectNormalizedTransactions(supabase, BASE_OPTS);

    const row = (capture.rows as Array<{ gross_amount: number }>)[0];
    expect(row.gross_amount).toBe(1100000);
  });

  it('카드 거래 → event_type=EXPECTED_OUTFLOW', async () => {
    const capture = { rows: null as unknown[] | null };
    const supabase = buildMockSupabase({
      cardRows: [{
        id: 'card-001', transaction_date: '2026-05-30',
        amount: 88000, merchant_name: '스타벅스', business_no: null,
      }],
      upsertCapture: capture,
    });

    await projectNormalizedTransactions(supabase, BASE_OPTS);

    const row = (capture.rows as Array<{ event_type: string }>)[0];
    expect(row.event_type).toBe('EXPECTED_OUTFLOW');
  });

  it('upsert DB 에러 → errors 배열에 메시지 포함', async () => {
    const supabase = buildMockSupabase({
      bankRows: [{
        id: 'bank-err', transaction_date: '2026-06-10',
        amount: 1000, transaction_type: 'deposit',
        description: null, account_no: null, source_type: null,
      }],
      upsertError: 'DB 연결 실패',
    });

    const result = await projectNormalizedTransactions(supabase, BASE_OPTS);
    expect(result.errors.some(e => e.includes('DB 연결 실패'))).toBe(true);
  });

  it('특정 bankIds 지정 시 기존 NT 조회 생략', async () => {
    const capture = { rows: null as unknown[] | null };
    const supabase = buildMockSupabase({
      bankRows: [{
        id: 'bank-specific', transaction_date: '2026-06-20',
        amount: 200000, transaction_type: 'deposit',
        description: null, account_no: null, source_type: null,
      }],
      upsertCapture: capture,
    });

    await projectNormalizedTransactions(supabase, { ...BASE_OPTS, bankIds: ['bank-specific'] });

    expect(capture.rows).not.toBeNull();
    expect((capture.rows as unknown[]).length).toBe(1);
  });
});

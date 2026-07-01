/**
 * proposeAllocations 자동확정 통합 경로 테스트 (FINDING-A/B 회귀 방지)
 *
 * 기존 unit 테스트는 헬퍼(방향/금액/날짜)를 산술 단위로만 검증하여
 * "cash_event 거래처 미로딩 → 자동확정 미발화" 버그를 잡지 못했다.
 * 이 테스트는 proposeAllocations의 실제 자동확정 판정 경로를 dryRun으로 실행한다.
 *
 * mock Supabase: from(table)→select/eq/in 체인 후 await 시 tables[table] 반환.
 * dryRun=true라 INSERT 경로는 타지 않고, 읽기 3개(cash/obl/allocations)만 사용.
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { proposeAllocations, determineReviewType } from '../../src/lib/phase2/proposeAllocations';

const CID = 'aaaaaaaa-0000-0000-0000-000000000001';

type Row = Record<string, unknown>;

/** 테이블별 반환 데이터를 주는 thenable 쿼리빌더 mock. selectSpy에 select 컬럼 문자열 기록. */
function makeSupabase(
  tables: Record<string, Row[]>,
  selectSpy?: Record<string, string>,
): SupabaseClient {
  const api = {
    from(table: string) {
      const builder = {
        select(cols: string) { if (selectSpy) selectSpy[table] = cols; return builder; },
        eq() { return builder; },
        in() { return builder; },
        not() { return builder; },
        lt() { return builder; },
        insert() { return builder; },
        then(resolve: (v: { data: Row[]; error: null }) => unknown) {
          return resolve({ data: tables[table] ?? [], error: null });
        },
      };
      return builder;
    },
  };
  return api as unknown as SupabaseClient;
}

// 강한 매칭 기본 쌍 (거래처 일치, 금액 정확, 날짜 1일)
const strongCe = (over: Row = {}): Row => ({
  id: 'ce1', company_id: CID, event_type: 'INFLOW', event_date: '2026-06-10',
  gross_amount: 1_000_000, unallocated_amount: 1_000_000, cash_status: 'UNALLOCATED',
  counterparty_name: '(주)에이비씨', ...over,
});
const strongObl = (over: Row = {}): Row => ({
  id: 'obl1', company_id: CID, obligation_type: 'RECEIVABLE', due_date: '2026-06-11',
  gross_amount: 1_000_000, remaining_amount: 1_000_000, lifecycle_status: 'OPEN',
  counterparty_name: '(주)에이비씨', counterparty_business_no: null, ...over,
});

describe('proposeAllocations 자동확정 경로', () => {
  it('(a) 거래처 일치 + 금액±10 + 날짜±3 + 단일후보 + 플래그 on → AUTO_CONFIRMED', async () => {
    const supa = makeSupabase({
      v_cash_event_balance: [strongCe()],
      v_obligation_balance: [strongObl()],
      match_allocations: [],
    });
    const res = await proposeAllocations(supa, {
      companyId: CID, companyCode: 'feedback', dryRun: true, autoConfirmEnabled: true,
    });
    expect(res.dryRunRows).toHaveLength(1);
    expect(res.dryRunRows![0].allocation_status).toBe('AUTO_CONFIRMED');
    expect(res.autoConfirmed).toBe(1);
    expect(res.reviewItems).toBe(0);
    // 거래처가 실제로 로딩·비교되었음을 증명 (VENDOR_STRONG_MATCH 통과)
    const vendorCheck = res.dryRunRows![0].auto_confirm_checks.find(c => c.code === 'VENDOR_STRONG_MATCH');
    expect(vendorCheck?.passed).toBe(true);
  });

  it('(b) 동일 조건이나 강한 후보 2건 → PROPOSED + MULTIPLE_CANDIDATES (오배분 회귀)', async () => {
    const supa = makeSupabase({
      v_cash_event_balance: [strongCe()],
      v_obligation_balance: [strongObl({ id: 'obl1' }), strongObl({ id: 'obl2' })],
      match_allocations: [],
    });
    const res = await proposeAllocations(supa, {
      companyId: CID, companyCode: 'feedback', dryRun: true, autoConfirmEnabled: true,
    });
    expect(res.autoConfirmed).toBe(0);
    expect(res.dryRunRows!.every(r => r.allocation_status === 'PROPOSED')).toBe(true);
    // SINGLE_CANDIDATE 실패로 review 대상
    expect(res.reviewItems).toBe(2);
    const row = res.dryRunRows![0];
    expect(row.match_reason_codes).toContain('FAIL_SINGLE_CANDIDATE');
    expect(determineReviewType('SINGLE_CANDIDATE, SINGLE_ALLOCATION')).toBe('MULTIPLE_CANDIDATES');
  });

  it('(c) 거래처 결손 → vendorMatch 0.5 → VENDOR_STRONG_MATCH 실패 → PROPOSED', async () => {
    const supa = makeSupabase({
      v_cash_event_balance: [strongCe({ counterparty_name: null })],
      v_obligation_balance: [strongObl()],
      match_allocations: [],
    });
    const res = await proposeAllocations(supa, {
      companyId: CID, companyCode: 'feedback', dryRun: true, autoConfirmEnabled: true,
    });
    expect(res.autoConfirmed).toBe(0);
    expect(res.dryRunRows![0].allocation_status).toBe('PROPOSED');
    const vendorCheck = res.dryRunRows![0].auto_confirm_checks.find(c => c.code === 'VENDOR_STRONG_MATCH');
    expect(vendorCheck?.passed).toBe(false);
  });

  it('(d) (a)와 동일 조건이나 플래그 off → 조건은 모두 통과하지만 PROPOSED', async () => {
    const supa = makeSupabase({
      v_cash_event_balance: [strongCe()],
      v_obligation_balance: [strongObl()],
      match_allocations: [],
    });
    const res = await proposeAllocations(supa, {
      companyId: CID, companyCode: 'feedback', dryRun: true, autoConfirmEnabled: false,
    });
    expect(res.autoConfirmed).toBe(0);
    expect(res.dryRunRows![0].allocation_status).toBe('PROPOSED');
    // 게이팅 검증: 9개 체크 자체는 전부 통과 (플래그만이 승격을 막음)
    expect(res.dryRunRows![0].auto_confirm_checks.every(c => c.passed)).toBe(true);
    // 클린 매칭이므로 review 대상 아님
    expect(res.reviewItems).toBe(0);
  });

  it('(e) 회귀 방지: cash_event select에 counterparty_name이 포함되어야 함', async () => {
    const selectSpy: Record<string, string> = {};
    const supa = makeSupabase({
      v_cash_event_balance: [strongCe()],
      v_obligation_balance: [strongObl()],
      match_allocations: [],
    }, selectSpy);
    await proposeAllocations(supa, {
      companyId: CID, companyCode: 'feedback', dryRun: true, autoConfirmEnabled: true,
    });
    expect(selectSpy.v_cash_event_balance).toContain('counterparty_name');
  });
});

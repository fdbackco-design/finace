/**
 * 잔액 계산 단위 테스트
 *
 * v_obligation_balance / v_cash_event_balance View 로직과 동일한 계산을
 * 픽스처 데이터로 검증한다. (DB 없이 순수 수식 검증)
 */

import { describe, it, expect } from 'vitest';
import {
  OBL_BALANCE_OPEN,
  OBL_BALANCE_PARTIAL,
  OBL_BALANCE_SETTLED,
  CE_BALANCE_UNALLOCATED,
  CE_BALANCE_PARTIAL,
  CE_BALANCE_FULL,
  OBL_RECEIVABLE,
  OBL_PAYABLE,
} from './golden-dataset.fixtures';

// ── remaining_amount 공식 ─────────────────────────────────────────────────────
// remaining_amount = gross_amount - confirmed_allocated - confirmed_adjusted

describe('remaining_amount 계산', () => {
  it('OPEN: 배분 없음 → remaining = gross', () => {
    const { gross_amount, confirmed_allocated_amount, confirmed_adjusted_amount, remaining_amount } = OBL_BALANCE_OPEN;
    expect(remaining_amount).toBe(gross_amount - confirmed_allocated_amount - confirmed_adjusted_amount);
    expect(remaining_amount).toBe(gross_amount);
  });

  it('PARTIALLY_SETTLED: 부분 배분 → remaining < gross', () => {
    const { gross_amount, confirmed_allocated_amount, confirmed_adjusted_amount, remaining_amount } = OBL_BALANCE_PARTIAL;
    expect(remaining_amount).toBe(gross_amount - confirmed_allocated_amount - confirmed_adjusted_amount);
    expect(remaining_amount).toBeLessThan(gross_amount);
    expect(remaining_amount).toBeGreaterThan(0);
  });

  it('SETTLED: 전액 배분 → remaining = 0', () => {
    const { remaining_amount } = OBL_BALANCE_SETTLED;
    expect(remaining_amount).toBe(0);
  });
});

// ── lifecycle_status 파생 로직 ────────────────────────────────────────────────

function deriveLifecycleStatus(
  isCancelled:  boolean,
  isSuperseded: boolean,
  remaining:    number,
  allocated:    number,
  adjusted:     number,
): string {
  if (isCancelled)  return 'CANCELLED';
  if (isSuperseded) return 'SUPERSEDED';
  if (remaining <= 0) return 'SETTLED';
  if (allocated + adjusted > 0) return 'PARTIALLY_SETTLED';
  return 'OPEN';
}

describe('lifecycle_status 파생', () => {
  it('is_cancelled=true → CANCELLED (우선순위 최고)', () => {
    expect(deriveLifecycleStatus(true, false, 0, 1000, 0)).toBe('CANCELLED');
  });

  it('is_superseded=true → SUPERSEDED', () => {
    expect(deriveLifecycleStatus(false, true, 500000, 0, 0)).toBe('SUPERSEDED');
  });

  it('remaining <= 0 → SETTLED', () => {
    expect(deriveLifecycleStatus(false, false, 0, 1100000, 0)).toBe('SETTLED');
  });

  it('allocated > 0, remaining > 0 → PARTIALLY_SETTLED', () => {
    expect(deriveLifecycleStatus(false, false, 250000, 300000, 0)).toBe('PARTIALLY_SETTLED');
  });

  it('allocated = 0, adjusted = 0 → OPEN', () => {
    expect(deriveLifecycleStatus(false, false, 1100000, 0, 0)).toBe('OPEN');
  });

  it('픽스처: OBL_BALANCE_OPEN lifecycle_status 검증', () => {
    const { is_cancelled, is_superseded, remaining_amount, confirmed_allocated_amount, confirmed_adjusted_amount, lifecycle_status } = OBL_BALANCE_OPEN;
    const derived = deriveLifecycleStatus(is_cancelled, is_superseded, remaining_amount, confirmed_allocated_amount, confirmed_adjusted_amount);
    expect(derived).toBe(lifecycle_status);
  });

  it('픽스처: OBL_BALANCE_PARTIAL lifecycle_status 검증', () => {
    const { is_cancelled, is_superseded, remaining_amount, confirmed_allocated_amount, confirmed_adjusted_amount, lifecycle_status } = OBL_BALANCE_PARTIAL;
    const derived = deriveLifecycleStatus(is_cancelled, is_superseded, remaining_amount, confirmed_allocated_amount, confirmed_adjusted_amount);
    expect(derived).toBe(lifecycle_status);
  });
});

// ── unallocated_amount 공식 ───────────────────────────────────────────────────
// unallocated_amount = gross_amount - confirmed_allocated

describe('unallocated_amount 계산', () => {
  it('UNALLOCATED: unallocated = gross', () => {
    const { gross_amount, confirmed_allocated_amount, unallocated_amount } = CE_BALANCE_UNALLOCATED;
    expect(unallocated_amount).toBe(gross_amount - confirmed_allocated_amount);
    expect(unallocated_amount).toBe(gross_amount);
  });

  it('PARTIALLY_ALLOCATED: 0 < unallocated < gross', () => {
    const { gross_amount, confirmed_allocated_amount, unallocated_amount } = CE_BALANCE_PARTIAL;
    expect(unallocated_amount).toBe(gross_amount - confirmed_allocated_amount);
    expect(unallocated_amount).toBeGreaterThan(0);
    expect(unallocated_amount).toBeLessThan(gross_amount);
  });

  it('FULLY_ALLOCATED: unallocated = 0', () => {
    const { unallocated_amount } = CE_BALANCE_FULL;
    expect(unallocated_amount).toBe(0);
  });
});

// ── cash_status 파생 로직 ─────────────────────────────────────────────────────

function deriveCashStatus(gross: number, allocated: number): string {
  if (allocated === 0)       return 'UNALLOCATED';
  if (allocated > gross)     return 'OVER_ALLOCATED';
  if (allocated === gross)   return 'FULLY_ALLOCATED';
  return 'PARTIALLY_ALLOCATED';
}

describe('cash_status 파생', () => {
  it('allocated = 0 → UNALLOCATED', () => {
    expect(deriveCashStatus(1100000, 0)).toBe('UNALLOCATED');
  });

  it('0 < allocated < gross → PARTIALLY_ALLOCATED', () => {
    expect(deriveCashStatus(550000, 300000)).toBe('PARTIALLY_ALLOCATED');
  });

  it('allocated = gross → FULLY_ALLOCATED', () => {
    expect(deriveCashStatus(1100000, 1100000)).toBe('FULLY_ALLOCATED');
  });

  it('allocated > gross → OVER_ALLOCATED', () => {
    expect(deriveCashStatus(1000000, 1100000)).toBe('OVER_ALLOCATED');
  });

  it('픽스처: CE_BALANCE_UNALLOCATED cash_status 검증', () => {
    const { gross_amount, confirmed_allocated_amount, cash_status } = CE_BALANCE_UNALLOCATED;
    expect(deriveCashStatus(gross_amount, confirmed_allocated_amount)).toBe(cash_status);
  });

  it('픽스처: CE_BALANCE_FULL cash_status 검증', () => {
    const { gross_amount, confirmed_allocated_amount, cash_status } = CE_BALANCE_FULL;
    expect(deriveCashStatus(gross_amount, confirmed_allocated_amount)).toBe(cash_status);
  });
});

// ── 요약 통계 ─────────────────────────────────────────────────────────────────

describe('연체 감지 로직', () => {
  it('due_date < today → 연체', () => {
    const today   = '2026-06-25';
    const dueDate = '2026-05-01';
    expect(dueDate < today).toBe(true);
  });

  it('due_date >= today → 연체 아님', () => {
    const today   = '2026-06-25';
    const dueDate = '2026-06-30';
    expect(dueDate < today).toBe(false);
  });

  it('SETTLED obligation은 연체 대상 아님', () => {
    const openStatuses = ['OPEN', 'PARTIALLY_SETTLED'];
    expect(openStatuses.includes(OBL_BALANCE_SETTLED.lifecycle_status)).toBe(false);
  });
});

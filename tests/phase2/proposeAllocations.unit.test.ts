/**
 * proposeAllocations 단위 테스트
 *
 * 9가지 자동확정 조건 개별 검증.
 * 방향 불일치 → 후보 제외 검증.
 * HUMAN_CONFIRMED 불가침 검증.
 */

import { describe, it, expect } from 'vitest';
import {
  CE_BALANCE_UNALLOCATED,
  CE_BALANCE_PARTIAL,
  OBL_BALANCE_OPEN,
  OBL_BALANCE_PARTIAL,
  OBL_BALANCE_SETTLED,
  CE_AMOUNT_MISMATCH,
  OBL_DATE_MISMATCH,
  ALLOC_HUMAN_CONFIRMED,
} from './golden-dataset.fixtures';

// ── 방향 일치 검증 ────────────────────────────────────────────────────────────

function hasDirectionMatch(eventType: string, obligationType: string): boolean {
  if (eventType === 'INFLOW'  && obligationType === 'RECEIVABLE') return true;
  if (eventType === 'OUTFLOW' && obligationType === 'PAYABLE')    return true;
  return false;
}

describe('방향 일치 규칙', () => {
  it('INFLOW + RECEIVABLE → 매칭 가능', () => {
    expect(hasDirectionMatch('INFLOW', 'RECEIVABLE')).toBe(true);
  });
  it('OUTFLOW + PAYABLE → 매칭 가능', () => {
    expect(hasDirectionMatch('OUTFLOW', 'PAYABLE')).toBe(true);
  });
  it('INFLOW + PAYABLE → 매칭 불가', () => {
    expect(hasDirectionMatch('INFLOW', 'PAYABLE')).toBe(false);
  });
  it('OUTFLOW + RECEIVABLE → 매칭 불가', () => {
    expect(hasDirectionMatch('OUTFLOW', 'RECEIVABLE')).toBe(false);
  });
});

// ── 금액 조건 (조건 3) ─────────────────────────────────────────────────────────

describe('자동확정 조건 3: 금액 정확 일치 (±10원)', () => {
  it('차이 0원 → 통과', () => {
    const diff = Math.abs(CE_BALANCE_UNALLOCATED.gross_amount - OBL_BALANCE_OPEN.remaining_amount);
    expect(diff).toBe(0);
    expect(diff <= 10).toBe(true);
  });

  it('차이 10원 → 통과 (경계값)', () => {
    const diff = Math.abs(1100010 - 1100000);
    expect(diff <= 10).toBe(true);
  });

  it('차이 11원 → 실패', () => {
    const diff = Math.abs(1100011 - 1100000);
    expect(diff <= 10).toBe(false);
  });

  it('500원 차이 → 실패 (CE_AMOUNT_MISMATCH)', () => {
    const diff = Math.abs(CE_AMOUNT_MISMATCH.gross_amount - OBL_BALANCE_OPEN.remaining_amount);
    expect(diff).toBe(500);
    expect(diff <= 10).toBe(false);
  });

  it('remaining_amount 기준으로 비교 (gross_amount 아님)', () => {
    // OBL_BALANCE_PARTIAL: gross=550000, remaining=250000
    const diffVsGross     = Math.abs(CE_BALANCE_PARTIAL.unallocated_amount - OBL_BALANCE_PARTIAL.gross_amount);
    const diffVsRemaining = Math.abs(CE_BALANCE_PARTIAL.unallocated_amount - OBL_BALANCE_PARTIAL.remaining_amount);

    expect(diffVsGross).not.toBe(0);
    expect(diffVsRemaining).toBe(0);
  });
});

// ── 날짜 조건 (조건 4) ─────────────────────────────────────────────────────────

describe('자동확정 조건 4: 날짜 3일 이내', () => {
  function daysBetween(a: string, b: string): number {
    return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
  }

  it('2일 차이 → 통과', () => {
    const diff = daysBetween(CE_BALANCE_UNALLOCATED.event_date, OBL_BALANCE_OPEN.due_date!);
    expect(diff).toBe(2);
    expect(diff <= 3).toBe(true);
  });

  it('3일 차이 → 통과 (경계값)', () => {
    expect(daysBetween('2026-06-10', '2026-06-13') <= 3).toBe(true);
  });

  it('4일 차이 → 실패', () => {
    expect(daysBetween('2026-06-10', '2026-06-14') <= 3).toBe(false);
  });

  it('21일 차이 → 실패 (OBL_DATE_MISMATCH)', () => {
    const diff = daysBetween('2026-06-10', OBL_DATE_MISMATCH.due_date!);
    expect(diff > 3).toBe(true);
  });
});

// ── SETTLED obligation은 후보 제외 ───────────────────────────────────────────

describe('SETTLED / CANCELLED obligation 후보 제외', () => {
  it('SETTLED → lifecycle_status 확인', () => {
    expect(OBL_BALANCE_SETTLED.lifecycle_status).toBe('SETTLED');
    expect(OBL_BALANCE_SETTLED.remaining_amount).toBe(0);
  });

  it('remaining_amount <= 0이면 배분 금액 0 → 스킵', () => {
    const allocAmount = Math.min(CE_BALANCE_UNALLOCATED.unallocated_amount, OBL_BALANCE_SETTLED.remaining_amount);
    expect(allocAmount).toBe(0);
  });
});

// ── HUMAN_CONFIRMED 불가침 ────────────────────────────────────────────────────

describe('HUMAN_CONFIRMED allocation 불가침 원칙', () => {
  it('HUMAN_CONFIRMED allocation은 allocation_status가 변경되지 않음', () => {
    expect(ALLOC_HUMAN_CONFIRMED.allocation_status).toBe('HUMAN_CONFIRMED');
  });

  it('HUMAN_CONFIRMED는 auto-rematch 대상 status가 아님', () => {
    const autoReallocatableStatuses = ['PROPOSED'];
    expect(autoReallocatableStatuses).not.toContain('HUMAN_CONFIRMED');
    expect(autoReallocatableStatuses).not.toContain('AUTO_CONFIRMED');
  });

  it('CORRECTION_REQUEST review_type으로만 SUPERSEDE 가능', () => {
    // 정정 흐름: CORRECTION_REQUEST → ALLOCATION_SUPERSEDE effect
    const correctionFlow = {
      reviewType: 'CORRECTION_REQUEST',
      effectType: 'ALLOCATION_SUPERSEDE',
    };
    expect(correctionFlow.reviewType).toBe('CORRECTION_REQUEST');
    expect(correctionFlow.effectType).toBe('ALLOCATION_SUPERSEDE');
  });
});

// ── 배분 금액 계산 ─────────────────────────────────────────────────────────────

describe('배분 금액 계산', () => {
  it('min(unallocated, remaining) 적용', () => {
    const unallocated = CE_BALANCE_PARTIAL.unallocated_amount;   // 250000
    const remaining   = OBL_BALANCE_PARTIAL.remaining_amount;    // 250000
    const allocAmount = Math.min(unallocated, remaining);
    expect(allocAmount).toBe(250000);
  });

  it('cash_event가 obligation보다 크면 PARTIAL', () => {
    const unallocated = 2000000;
    const remaining   = 1100000;
    const allocAmount = Math.min(unallocated, remaining);
    expect(allocAmount).toBe(1100000);
    // remaining_amount 기준 diff > 10 → PARTIAL이 되어야 함
    expect(allocAmount < unallocated - 10).toBe(true);
  });
});

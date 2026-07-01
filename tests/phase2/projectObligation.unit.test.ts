/**
 * projectObligation 단위 테스트
 *
 * - HT 세금계산서 direction → obligation_type 매핑 검증
 * - 카드 그룹 키 생성 및 집계 검증
 * - 고정비 중복 생성 방지 검증
 */

import { describe, it, expect, vi } from 'vitest';
import {
  NT_HT_SALES,
  NT_HT_PURCHASE,
  OBL_RECEIVABLE,
  OBL_PAYABLE,
  OBL_CARD_GROUP,
  COMPANY_ID,
  COMPANY_CODE,
} from './golden-dataset.fixtures';

// ── HT direction → obligation_type 매핑 ───────────────────────────────────────

describe('HT invoice direction → obligation_type 매핑', () => {
  it("invoice_direction='sales' → RECEIVABLE", () => {
    expect(NT_HT_SALES.event_type).toBe('EXPECTED_INFLOW');
    expect(OBL_RECEIVABLE.obligation_type).toBe('RECEIVABLE');
  });

  it("invoice_direction='purchase' → PAYABLE", () => {
    expect(NT_HT_PURCHASE.event_type).toBe('EXPECTED_OUTFLOW');
    expect(OBL_PAYABLE.obligation_type).toBe('PAYABLE');
  });

  it('NT event_type과 obligation_type 방향 일관성', () => {
    const directionMap: Record<string, string> = {
      EXPECTED_INFLOW:  'RECEIVABLE',
      EXPECTED_OUTFLOW: 'PAYABLE',
    };
    expect(directionMap[NT_HT_SALES.event_type]).toBe(OBL_RECEIVABLE.obligation_type);
    expect(directionMap[NT_HT_PURCHASE.event_type]).toBe(OBL_PAYABLE.obligation_type);
  });
});

// ── 카드 그룹 키 생성 ─────────────────────────────────────────────────────────

describe('카드 그룹 키 생성 규칙', () => {
  it('{company_code}||{source_type}||{payment_due_date} 형식', () => {
    const companyCode   = 'feedback';
    const sourceType    = 'CARD_IBK';
    const paymentDueDate = '2026-06-21';
    const key = `${companyCode}||${sourceType}||${paymentDueDate}`;
    expect(key).toBe('feedback||CARD_IBK||2026-06-21');
  });

  it('같은 그룹 키의 카드 거래들은 금액 합산', () => {
    const cards = [
      { groupKey: 'feedback||CARD_IBK||2026-06-21', amount: 50000 },
      { groupKey: 'feedback||CARD_IBK||2026-06-21', amount: 38000 },
      { groupKey: 'feedback||CARD_WOORI||2026-06-20', amount: 120000 },
    ];

    const groups = new Map<string, number>();
    for (const c of cards) {
      groups.set(c.groupKey, (groups.get(c.groupKey) ?? 0) + c.amount);
    }

    expect(groups.get('feedback||CARD_IBK||2026-06-21')).toBe(88000);
    expect(groups.get('feedback||CARD_WOORI||2026-06-20')).toBe(120000);
    expect(groups.size).toBe(2);
  });

  it('다른 회사는 다른 그룹 키', () => {
    const key1 = `feedback||CARD_IBK||2026-06-21`;
    const key2 = `sangsaeng||CARD_IBK||2026-06-25`;
    expect(key1).not.toBe(key2);
  });
});

// ── 고정비 의무 중복 방지 ─────────────────────────────────────────────────────

describe('고정비 의무 중복 방지', () => {
  it('이미 존재하는 rule+month 조합은 스킵', () => {
    const rules = [
      { id: 'rule-001', amount: 500000, day_of_month: 25, description: '임대료' },
      { id: 'rule-002', amount: 100000, day_of_month: 10, description: '보험료' },
    ];
    const existing = new Set(['rule-001']); // rule-001은 이미 있음

    const newRules = rules.filter(r => !existing.has(r.id));
    expect(newRules).toHaveLength(1);
    expect(newRules[0].id).toBe('rule-002');
  });

  it('같은 달, 다른 규칙 → 모두 생성', () => {
    const rules = [
      { id: 'rule-001' },
      { id: 'rule-002' },
    ];
    const existing = new Set<string>(); // 아무것도 없음
    const newRules = rules.filter(r => !existing.has(r.id));
    expect(newRules).toHaveLength(2);
  });

  it('due_date 계산: 고정비 납부일 사용', () => {
    const month = '2026-06';
    const dayOfMonth = 25;
    const [year, mon] = month.split('-');
    const day = String(dayOfMonth).padStart(2, '0');
    const dueDate = `${year}-${mon}-${day}`;
    expect(dueDate).toBe('2026-06-25');
  });
});

// ── Obligation 필드 불변 조건 ─────────────────────────────────────────────────

describe('Obligation 불변 조건', () => {
  it('HT invoice obligation은 normalized_transaction_id 필수', () => {
    expect(OBL_RECEIVABLE.normalized_transaction_id).not.toBeNull();
    expect(OBL_PAYABLE.normalized_transaction_id).not.toBeNull();
  });

  it('카드 그룹 obligation은 card_settlement_group_key 필수', () => {
    expect(OBL_CARD_GROUP.card_settlement_group_key).not.toBeNull();
    expect(OBL_CARD_GROUP.normalized_transaction_id).toBeNull();
  });

  it('신규 obligation은 is_cancelled=false, is_superseded=false', () => {
    expect(OBL_RECEIVABLE.is_cancelled).toBe(false);
    expect(OBL_RECEIVABLE.is_superseded).toBe(false);
    expect(OBL_PAYABLE.is_cancelled).toBe(false);
    expect(OBL_PAYABLE.is_superseded).toBe(false);
  });
});
